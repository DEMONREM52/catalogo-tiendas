// Pruebas de 20261314 (primeros pasos y tienda demo que se reinicia sola).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'anon') $$;
grant execute on function auth.role() to anon, authenticated, service_role;
alter table public.store_catalogs add column if not exists slug text;
create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$ select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin') $$;
create table if not exists public.saas_payments (id uuid primary key default gen_random_uuid(), store_id uuid, status text);
create table if not exists public.erp_audit_logs_demo_test (id uuid primary key default gen_random_uuid(), store_id uuid, note text);
-- Como en producción: no se puede borrar un producto que tiene ventas.
create or replace function public.test_block_product_delete() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.order_items oi where oi.product_id = old.id) then raise exception 'El producto tiene ventas'; end if;
  return old;
end $$;
create trigger test_block_product_delete before delete on public.products for each row execute function public.test_block_product_delete();
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.permissions && p_perms)) $$;
`;
const combined = path.join(os.tmpdir(), `remhub_demo_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p, role = "authenticated") {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.query("select set_config('test.role', $1, false)", [role]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); await db.query("select set_config('test.role', '', false)"); }
}
const call = async (u, fn, args, role) => (await as(u, `select public.${fn} r`, args, role))[0].r;

const U = (n) => `e0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), DUENO = U(2), DEMO = U(3), OTRO = U(4), DUENO2 = U(5);
await raw("insert into auth.users (id, email) values ($1,'admin@x.co'),($2,'dueno@x.co'),($3,'demo@x.co'),($4,'otro@x.co'),($5,'dueno2@x.co')", [ADMIN, DUENO, DEMO, OTRO, DUENO2]);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('demo', 'Tienda Demo', $1) returning id", [DUENO]);
const [{ id: R }] = await raw("insert into stores (slug, name, owner_id) values ('real', 'Tienda Real', $1) returning id", [DUENO2]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1,$2,'seller','{products,orders}'), ($3,$4,'seller','{products}'), ($1,$4,'seller','{products}')", [S, DEMO, R, OTRO]);
for (const m of ["20261312_vender_mas_opcional.sql", "20261314_arranque_y_demo.sql"]) { const sql = fs.readFileSync(path.join(MIG, m), "utf8"); await db.exec(sql); await db.exec(sql); }

const prod = async (store, name, price) => (await raw("insert into products (store_id, name, price_3, stock, active) values ($1, $2, $3, 5, true) returning id", [store, name, price]))[0].id;
const P1 = await prod(S, "Patineta", 20000), P2 = await prod(S, "Carro", 10000), RP = await prod(R, "Real", 99000);
const [{ id: CAT }] = await raw("insert into store_catalogs (store_id, name, slug) values ($1, 'Detal', 'detal') returning id", [S]);
await raw("insert into store_catalog_products (catalog_id, product_id, store_id) values ($1, $2, $3), ($1, $4, $3)", [CAT, P1, S, P2]);
await raw("insert into erp_audit_logs_demo_test (store_id, note) values ($1, 'antes')", [S]);

console.log("1. Primeros pasos");
let o = await call(DUENO, "saas_onboarding($1)", [S]);
ok(o.ok && o.on && o.steps.some((x) => x.key === "sale" && !x.done) && o.steps.find((x) => x.key === "catalog").done, "Pasos con «primera venta» y catálogo real", o.steps);
await call(DUENO, "store_feature_save($1, 'arranque', false, null)", [S]);
o = await call(DUENO, "saas_onboarding($1)", [S]);
ok(o.ok && o.on === false && o.steps.length === 0, "Apagado: no sale la tarjeta");

console.log("2. Configurar la demo (solo admin, con candados)");
ok((await call(DUENO, "saas_admin_demo_save('demo', 'demo@x.co', 60, true, 'demo')", [])).ok === false, "Un dueño de tienda no configura la demo");
ok(/exactamente/.test((await call(ADMIN, "saas_admin_demo_save('demo', 'demo@x.co', 60, true, 'otra')", [])).message), "Hay que escribir el enlace para confirmar");
ok(/dueño/.test((await call(ADMIN, "saas_admin_demo_save('demo', 'dueno@x.co', 60, true, 'demo')", [])).message), "El usuario demo no puede ser el dueño");
ok(/otra tienda/.test((await call(ADMIN, "saas_admin_demo_save('demo', 'otro@x.co', 60, true, 'demo')", [])).message), "Ni uno que entra a otra tienda");
await raw("insert into saas_payments (store_id, status) values ($1, 'approved')", [R]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{}') on conflict do nothing", [R, DEMO]);
ok(/pagos aprobados|otra tienda/.test((await call(ADMIN, "saas_admin_demo_save('real', 'demo@x.co', 60, true, 'real')", [])).message), "Una tienda con pagos de RemHub no puede ser demo");
await raw("delete from store_users where store_id = $1 and user_id = $2", [R, DEMO]);
let g = await call(ADMIN, "saas_admin_demo_save('demo', 'demo@x.co', 60, true, 'demo')", []);
ok(g.ok && g.config.enabled && g.config.user_email === "demo@x.co" && !g.config.snapshot_at, "Guardada (falta la foto)", g.config);
ok((await call(null, "demo_public_info()", [], "anon")).enabled === false, "Sin foto aún no se ofrece al público");
g = await call(ADMIN, "saas_admin_demo_snapshot()", []);
ok(g.ok && g.rows > 0 && g.config.snapshot_at, "Foto tomada", { rows: g.rows });
const pub = await call(null, "demo_public_info()", [], "anon");
ok(pub.enabled && pub.slug === "demo" && pub.store_name === "Tienda Demo" && !("user_id" in pub), "La página /demo ve el nombre (sin datos privados)", pub);
let denied = false; try { await call(null, "demo_entry()", [], "anon"); } catch { denied = true; }
ok(denied, "demo_entry no es para el público (permiso negado)");
const entry = await call(null, "demo_entry()", [], "service_role");
ok(entry.ok && entry.user_id === DEMO && entry.slug === "demo", "El servidor sabe con qué usuario entrar", entry);
ok((await call(DEMO, "demo_status($1)", [S])).demo === true && (await call(DUENO2, "demo_status($1)", [R])).demo === false, "Aviso «estás en la demo» solo en la demo");

console.log("3. Los visitantes cambian cosas");
await raw("update products set price_3 = 1 where id = $1", [P1]);
await raw("update stores set name = 'Hackeada' where id = $1", [S]);
const P3 = await prod(S, "Nuevo", 5000);
await raw("delete from store_catalog_products where product_id = $1", [P2]);
const [{ id: ORD }] = await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, 'tok-demo', 5000, 'confirmed', 'Visitante') returning id", [S]);
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 5000)", [ORD, P3]);
await raw("insert into erp_audit_logs_demo_test (store_id, note) values ($1, 'después')", [S]);
await raw("update products set price_3 = 1 where id = $1", [RP]);

console.log("4. Reinicio");
ok((await call(null, "erp_demo_reset(false)", [], "service_role")).skipped === "not_due", "Antes de la hora no hace nada");
ok((await call(DEMO, "erp_demo_reset(true)", [])).ok === false, "El usuario demo no puede forzarlo");
let r = await call(ADMIN, "erp_demo_reset(true)", []);
ok(r.ok && r.errors.length === 0, `Reinicio forzado por el admin (modo ${r.mode})`, r);
ok((await raw("select price_3::int p from products where id = $1", [P1]))[0].p === 20000, "El precio cambiado vuelve");
ok((await raw("select count(*)::int n from products where id = $1", [P3]))[0].n === 0, "El producto nuevo desaparece");
ok((await raw("select count(*)::int n from orders where store_id = $1", [S]))[0].n === 0 && (await raw("select count(*)::int n from order_items where order_id = $1", [ORD]))[0].n === 0, "El pedido y sus líneas desaparecen");
ok((await raw("select count(*)::int n from store_catalog_products where store_id = $1", [S]))[0].n === 2, "La lista del catálogo vuelve (tabla sin llave)");
ok((await raw("select name from stores where id = $1", [S]))[0].name === "Tienda Demo", "El nombre de la tienda vuelve");
ok((await raw("select count(*)::int n from erp_audit_logs_demo_test where store_id = $1", [S]))[0].n === 2, "La auditoría nunca se toca");
ok((await raw("select price_3::int p from products where id = $1", [RP]))[0].p === 1, "La otra tienda no se toca");
ok((await raw("select count(*)::int n from store_users where store_id = $1 and user_id = $2", [S, DEMO]))[0].n === 1, "El usuario demo sigue en el equipo");

console.log("5. Sin «replica» (en orden, como en Supabase si no lo permite)");
const P4 = await prod(S, "Otro nuevo", 1000);
const [{ id: ORD2 }] = await raw("insert into orders (store_id, token, total, status) values ($1, 'tok-2', 1000, 'confirmed') returning id", [S]);
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1000)", [ORD2, P4]);
await raw("update products set price_3 = 7 where id = $1", [P2]);
r = (await raw("select public.demo__restore($1, false) r", [S]))[0].r;
ok(r.ok && r.mode === "ordered", "Funciona en orden (primero las líneas, luego el producto que tenía ventas)", r);
ok((await raw("select count(*)::int n from products where id = $1", [P4]))[0].n === 0 && (await raw("select price_3::int p from products where id = $1", [P2]))[0].p === 10000, "Mismo resultado");

console.log("6. Si la tienda cambia de enlace, se apaga sola");
await raw("update stores set slug = 'demo2' where id = $1", [S]);
await raw("update erp_demo_config set last_reset_at = now() - interval '2 hours'");
r = await call(null, "erp_demo_reset(false)", [], "service_role");
ok(r.ok === false && (await raw("select enabled from erp_demo_config"))[0].enabled === false, "No reinicia y se apaga", r);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
