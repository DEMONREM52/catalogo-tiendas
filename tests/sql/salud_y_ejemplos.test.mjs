// Pruebas de 20261224: salud de las tiendas (administrador) y productos de ejemplo.
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
create table if not exists public.saas_subscriptions (store_id uuid primary key, plan_id text, status text, trial_ends_at timestamptz, current_period_end timestamptz);
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table public.products add column if not exists category_id uuid;
alter table public.product_categories add column if not exists active boolean default true;
alter table public.stores add column if not exists created_at timestamptz default now();
`;
const combined = path.join(os.tmpdir(), `remhub_se_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261224_salud_y_ejemplos.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce500000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), O1 = U(2), O2 = U(3), O3 = U(4), SELLER = U(5);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
await raw("insert into auth.users (id, email, last_sign_in_at) values ($1, 'a@x.co', now()), ($2, 'b@x.co', now() - interval '20 days'), ($3, 'c@x.co', now())", [O1, O2, O3]);
const [{ id: S1 }] = await raw("insert into stores (slug, name, owner_id, created_at) values ('s1', 'VENDE BIEN', $1, now() - interval '90 days') returning id", [O1]);
const [{ id: S2 }] = await raw("insert into stores (slug, name, owner_id, created_at) values ('s2', 'DORMIDA', $1, now() - interval '90 days') returning id", [O2]);
const [{ id: S3 }] = await raw("insert into stores (slug, name, owner_id, created_at) values ('s3', 'NUEVA', $1, now() - interval '3 days') returning id", [O3]);
await raw("insert into saas_subscriptions (store_id, plan_id, status) values ($1, 'pro', 'active'), ($2, 'pro', 'active'), ($3, 'pro', 'trialing')", [S1, S2, S3]);
await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, 't1', 50000, 'confirmed', now() - interval '1 day')", [S1]);
for (let i = 0; i < 6; i++) await raw("insert into products (store_id, name) values ($1, 'P' || $2)", [S1, i]);
await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, 't2', 10000, 'confirmed', now() - interval '40 days')", [S2]);

let r = await one(ADMIN, "select public.saas_admin_store_health() r");
const h = (n) => r.stores.find((s) => s.name === n);
ok(r.ok && h("VENDE BIEN")?.health === "ok" && h("VENDE BIEN").sales_7 === 1, "La que vende y entra seguido: 🟢 saludable", h("VENDE BIEN"));
ok(h("DORMIDA")?.health === "risk" && /no entra/.test(h("DORMIDA").reason), "El dueño no entra hace 20 días: 🔴 en riesgo", h("DORMIDA"));
ok(h("NUEVA")?.health === "start" && /productos/.test(h("NUEVA").reason), "Nueva sin productos: 🟡 sin arrancar", h("NUEVA"));
ok(r.stores[0].health === "risk", "Primero las que están en riesgo", r.stores.map((s) => s.health));
ok((await one(O1, "select public.saas_admin_store_health() r")).ok === false, "Un dueño de tienda no puede verlo");

console.log("Productos de ejemplo");
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [S3, SELLER]);
ok((await one(SELLER, "select public.store_seed_examples($1) r", [S3])).ok === false, "Sin permiso de productos no puede cargarlos");
r = await one(O3, "select public.store_seed_examples($1) r", [S3]);
ok(r.ok && r.created === 8, "El dueño carga 8 productos de ejemplo", r);
const ex = await raw("select p.name, p.active, p.price_3, c.name cat from products p join product_categories c on c.id = p.category_id where p.store_id = $1", [S3]);
ok(ex.length === 8 && ex.every((p) => p.active && p.cat === "EJEMPLOS" && Number(p.price_3) > 0 && /EJEMPLO/.test(p.name)), "Activos, con precio y en la categoría EJEMPLOS", ex);
ok((await one(O3, "select public.store_seed_examples($1) r", [S3])).ok === false, "No se cargan dos veces");
r = await one(ADMIN, "select public.saas_admin_store_health() r");
ok(r.stores.find((s) => s.name === "NUEVA").products === 0, "La salud no cuenta los ejemplos como productos reales");
const [{ id: used }] = await raw("select id from products where store_id = $1 and sku = 'EJEMPLO-001'", [S3]);
await raw("insert into orders (store_id, token, total, status) values ($1, 't3', 1, 'confirmed')", [S3]);
await raw("insert into order_items (order_id, product_id, quantity, price) select id, $1, 1, 1 from orders where token = 't3'", [used]);
await raw("insert into products (store_id, name, sku) values ($1, 'MI PRODUCTO REAL', 'REAL-1')", [S3]);
r = await one(O3, "select public.store_clear_examples($1) r", [S3]);
ok(r.ok && r.deleted === 7 && r.deactivated === 1, "Quitar: borra 7 y desactiva el que ya se vendió", r);
const left = await raw("select name, active from products where store_id = $1 order by name", [S3]);
ok(left.length === 2 && left.some((p) => p.name === "MI PRODUCTO REAL" && p.active), "Los productos reales no se tocan", left);
ok((await raw("select count(*)::int n from product_categories where store_id = $1 and name = 'EJEMPLOS'", [S3]))[0].n === 1, "La categoría se queda mientras tenga el producto desactivado");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
