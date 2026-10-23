// Pruebas de 20261238: quitar el acceso sin sesión a funciones con permisos de dueño sin romper lo público.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
grant usage on schema public to anon, service_role;
-- Peligrosa: nadie de afuera la usa, mueve existencias.
create table public.stock_demo (id int primary key, qty int);
insert into public.stock_demo values (1, 10);
grant select on public.stock_demo to anon, authenticated;
create or replace function public.apply_stock_on_confirm(p int) returns int language plpgsql security definer set search_path = public as $$
begin update public.stock_demo set qty = qty - p where id = 1; return (select qty from public.stock_demo where id = 1); end $$;
-- La usa el catálogo público (está en la lista).
create or replace function public.store_public_home(p_slug text) returns text language sql security definer set search_path = public as $$ select 'vitrina ' || p_slug $$;
-- La usa un permiso de tabla (RLS): sin ella el público no vería nada.
create or replace function public.demo_visible(p int) returns boolean language sql stable security definer set search_path = public as $$ select p > 0 $$;
create table public.demo_publico (id int primary key);
alter table public.demo_publico enable row level security;
create policy demo_read on public.demo_publico for select to anon, authenticated using (public.demo_visible(id));
insert into public.demo_publico values (1), (2);
grant select on public.demo_publico to anon, authenticated;
-- Trigger con permisos de dueño: debe seguir funcionando aunque se le quite el acceso sin sesión.
create table public.demo_log (n int);
create table public.demo_pedidos (id serial primary key, total int);
create or replace function public.demo_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.demo_log values (new.total); return new; end $$;
create trigger demo_guard before insert on public.demo_pedidos for each row execute function public.demo_guard();
grant insert, select on public.demo_pedidos to anon, authenticated;
grant usage on sequence public.demo_pedidos_id_seq to anon, authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_anon_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
async function as(role, s) {
  await db.exec(`set role ${role}`);
  try { return { rows: (await db.query(s)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role"); }
}

ok((await as("anon", "select public.apply_stock_on_confirm(3) r")).rows?.[0].r === 7, "Antes: sin sesión cualquiera bajaba existencias (el problema)");

const M = fs.readFileSync(path.join(MIG, "20261238_funciones_sin_sesion.sql"), "utf8");
const res = await db.exec(M);
await db.exec(M);
const report = res[res.length - 1].rows;
ok(!report.some((r) => /no se pudo/.test(r.resultado)), "Sin errores", report);

const danger = await as("anon", "select public.apply_stock_on_confirm(3) r");
ok(danger.err && /permission denied/i.test(danger.err), "Después: sin sesión ya no se puede llamar", danger);
ok((await as("authenticated", "select public.apply_stock_on_confirm(1) r")).rows?.[0].r === 6, "Con sesión sigue funcionando igual");
ok((await as("service_role", "select public.apply_stock_on_confirm(1) r")).rows?.[0].r === 5, "El servidor también");
ok((await as("anon", "select public.store_public_home('lavitrina') r")).rows?.[0].r === "vitrina lavitrina", "La del catálogo público sigue abierta sin sesión");
ok((await as("anon", "select count(*)::int n from public.demo_publico")).rows?.[0].n === 2, "Los permisos de tabla que usan funciones siguen funcionando sin sesión");
const ins = await as("anon", "insert into public.demo_pedidos (total) values (99) returning id");
ok(ins.rows?.length === 1, "Los triggers siguen funcionando aunque se les quite el acceso directo", ins);
ok((await db.query("select count(*)::int n from public.demo_log where n = 99")).rows[0].n === 1, "   (el trigger sí corrió)");
const saved = (await db.query("select firma from remhub_private.anon_revoked order by 1")).rows.map((r) => r.firma);
ok(saved.includes("apply_stock_on_confirm(integer)") && !saved.some((f) => /store_public_home|demo_visible/.test(f)), "Anota lo que cambió para poder devolverlo", saved);
const priv = await as("anon", "select count(*) from remhub_private.anon_revoked");
ok(Boolean(priv.err), "Esa lista no se ve desde la página", priv);

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
