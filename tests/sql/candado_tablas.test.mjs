// Pruebas de 20261234: candado (RLS) en las tablas viejas sin romper la app ni los consecutivos viejos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'); $$;
grant execute on function public.erp_is_platform_admin() to authenticated;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
grant usage on schema public to anon;
-- Tablas viejas abiertas (como en producción).
create table public.billing_counters (store_id uuid primary key, last_number integer not null default 0);
create table public.pos_customers (id uuid primary key default gen_random_uuid(), name text);
create table public.pos_invoices (id uuid primary key default gen_random_uuid(), total numeric);
grant all on public.billing_counters, public.pos_customers, public.pos_invoices to anon, authenticated;
-- Función vieja (sin permisos de dueño) que escribe en una tabla vieja.
create or replace function public.billing_next_doc_number(p_store uuid) returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.billing_counters (store_id, last_number) values (p_store, 1)
  on conflict (store_id) do update set last_number = public.billing_counters.last_number + 1
  returning last_number into v;
  return v;
end $$;
grant execute on function public.billing_next_doc_number(uuid) to anon, authenticated;
-- Tabla que la app usa sin RLS: no se debe tocar.
create table public.themes (id serial primary key, name text);
grant all on public.themes to anon, authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_rls_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(role, uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const U = (n) => `cea00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), OWNER = U(2);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('s', 'S', $1) returning id", [OWNER]);
await db.exec("insert into pos_customers (name) values ('VIEJO'); insert into pos_invoices (total) values (1000); insert into themes (name) values ('oscuro')");

ok((await as("anon", null, "select count(*)::int n from public.pos_customers"))[0].n === 1, "Antes: cualquiera sin sesión lee los clientes viejos (el problema)");

const M = fs.readFileSync(path.join(MIG, "20261234_candado_tablas_viejas.sql"), "utf8");
const results = await db.exec(M);
await db.exec(M);
const report = results[results.length - 1].rows;
ok(report.some((r) => r.tabla === "pos_customers" && /candado/.test(r.accion)), "Pone candado a las tablas viejas", report);
ok(report.some((r) => r.tabla === "themes" && /REVISAR/.test(r.accion)), "La tabla que usa la app no se toca: queda para revisar", report);
ok(report.some((r) => /billing_next_doc_number/.test(r.tabla)), "Reporta la función vieja", report);

ok((await as("anon", null, "select count(*)::int n from public.pos_customers"))[0].n === 0, "Después: sin sesión ya no se leen");
ok((await as("authenticated", OWNER, "select count(*)::int n from public.pos_invoices"))[0].n === 0, "   ni un usuario cualquiera");
const denied = await (async () => { try { await as("anon", null, "insert into public.pos_customers (name) values ('HACK')"); return false; } catch { return true; } })();
ok(denied, "   ni se pueden escribir");
ok((await as("authenticated", ADMIN, "select count(*)::int n from public.pos_invoices"))[0].n === 1, "El administrador de RemHub sí las lee (panel de admin)");
ok((await as("anon", null, "select count(*)::int n from public.themes"))[0].n === 1, "La tabla de la app sigue funcionando igual");
const n1 = (await as("authenticated", OWNER, "select public.billing_next_doc_number($1) r", [S]))[0].r;
const n2 = (await as("authenticated", OWNER, "select public.billing_next_doc_number($1) r", [S]))[0].r;
ok(n1 === 1 && n2 === 2, "La función vieja de consecutivos sigue funcionando con el candado", [n1, n2]);
ok((await raw("select relrowsecurity r from pg_class where relname = 'billing_counters'"))[0].r === true, "Su tabla de contadores quedó con candado");

console.log("pos_payments (20261235)");
await db.exec("create table public.pos_payments (id uuid primary key default gen_random_uuid(), amount numeric); grant all on public.pos_payments to anon, authenticated; insert into public.pos_payments (amount) values (500);");
ok((await as("anon", null, "select count(*)::int n from public.pos_payments"))[0].n === 1, "Antes: pos_payments se lee sin sesión");
const M2 = fs.readFileSync(path.join(MIG, "20261235_candado_pos_payments.sql"), "utf8");
await db.exec(M2);
await db.exec(M2);
ok((await as("anon", null, "select count(*)::int n from public.pos_payments"))[0].n === 0, "Después: ya no se lee sin sesión");
ok((await as("authenticated", OWNER, "select count(*)::int n from public.pos_payments"))[0].n === 0, "   ni un usuario cualquiera");
ok((await as("authenticated", ADMIN, "select count(*)::int n from public.pos_payments"))[0].n === 1, "   y el admin de RemHub la sigue viendo");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
