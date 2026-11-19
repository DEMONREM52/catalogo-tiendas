// Pruebas de 20261330: «¡Volvió!» y productos que llegaron (0 → con unidades), con Avísame y ficha incompleta.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
create table if not exists public.product_category_links (product_id uuid, category_id uuid);
alter table public.products add column if not exists category_id uuid;
create table if not exists public.erp_product_publish (product_id uuid primary key, store_id uuid, last_published_at timestamptz);
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.permissions && p_perms)) $$;
create table if not exists public.erp_stock_waitlist (id uuid primary key default gen_random_uuid(), store_id uuid, product_id uuid, phone text, status text default 'waiting');
`;
const combined = path.join(os.tmpdir(), `remhub_volvio_${process.pid}.sql`);
fs.writeFileSync(combined, [extra, fs.readFileSync(path.join(here, "migraciones/20261330_volvio_y_llegadas.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce400000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [S, SELLER]);
const [{ id: W }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'B', 'B', true) returning id", [S]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'NEXT') returning id", [S]);
const prod = async (n, stock, img = null) => (await raw("insert into products (store_id, name, stock, image_url) values ($1, $2, $3, $4) returning id", [S, n, stock, img]))[0].id;
const buy = async (p) => {
  const [{ id }] = await raw("insert into erp_purchases (store_id, number, supplier_id, warehouse_id) values ($1, (select coalesce(max(number), 0) + 1 from erp_purchases), $2, $3) returning id", [S, SUP, W]);
  await raw("insert into erp_purchase_items (purchase_id, product_id, qty, unit_cost) values ($1, $2, 5, 1000)", [id, p]);
};
const list = (u = OWNER, since = null) => one(u, "select public.erp_product_arrivals_list($1, $2) r", [S, since]);
const item = (r, id) => r.items.find((x) => x.product_id === id);

// 1. Nuevo: se crea en 0 y le entra su primera compra.
const NUEVO = await prod("NUEVO", 0);
await buy(NUEVO);
await raw("update products set stock = 5 where id = $1", [NUEVO]);
// 2. Volvió: ya se había vendido, estaba en 0 y le vuelven a entrar.
const VUELVE = await prod("VUELVE", 0, "https://x/f.png");
await raw("insert into orders (id, store_id, token, total) values (gen_random_uuid(), $1, 'tk1', 1) ", [S]);
await raw("insert into order_items (order_id, product_id, quantity, price) select id, $1, 1, 1 from orders where token = 'tk1'", [VUELVE]);
await raw("insert into erp_stock_waitlist (store_id, product_id, phone) values ($1, $2, '300'), ($1, $2, '301'), ($1, $2, '302')", [S, VUELVE]);
await raw("update erp_stock_waitlist set status = 'notified' where phone = '302'");
await raw("update products set stock = 3 where id = $1", [VUELVE]);
// 3. Con unidades que suben más: no es «llegada».
const SIEMPRE = await prod("SIEMPRE", 4);
await raw("update products set stock = 9 where id = $1", [SIEMPRE]);

console.log("Anotar llegadas");
let r = await list();
ok(r.ok && r.items.length === 2, "Solo los que pasaron de 0 a tener unidades", r.items?.map((x) => x.name));
ok(item(r, NUEVO)?.kind === "new" && item(r, NUEVO).no_photo === true && item(r, NUEVO).no_category === true, "NUEVO: llegó por primera vez, sin foto ni categoría", item(r, NUEVO));
ok(item(r, VUELVE)?.kind === "back" && item(r, VUELVE).waiting === 2 && item(r, VUELVE).no_photo === false, "VUELVE: ¡Volvió!, 2 clientes esperando (el ya avisado no cuenta)", item(r, VUELVE));
await raw("update products set stock = 0 where id = $1", [VUELVE]);
await raw("update products set stock = 2 where id = $1", [VUELVE]);
ok((await raw("select count(*)::int n from erp_product_arrivals where product_id = $1", [VUELVE]))[0].n === 1, "Una sola vez por día aunque suba y baje");
ok(!item(await list(OWNER, new Date(Date.now() + 60_000).toISOString()), VUELVE), "«Desde» una hora posterior: no sale");
await raw("insert into erp_product_publish (product_id, store_id, last_published_at) values ($1, $2, now() + interval '1 second')", [VUELVE, S]);
ok(item(await list(), VUELVE).published === true, "Sabe si ya se publicó después de llegar");

console.log("Nunca frena el movimiento");
await raw("alter table erp_product_arrivals add constraint frena check (kind = 'nada') not valid");
const ROTO = await prod("ROTO", 0);
let err = null;
try { await raw("update products set stock = 1 where id = $1", [ROTO]); } catch (e) { err = e.message; }
ok(err === null && (await raw("select stock from products where id = $1", [ROTO]))[0].stock === 1, "Si falla el registro de la llegada, las unidades igual entran", err);
await raw("alter table erp_product_arrivals drop constraint frena");

console.log("Permisos");
ok((await list(SELLER)).ok === false, "Solo con POS: no ve la lista");
ok((await list(U(9))).ok === false, "Alguien de fuera tampoco");
ok(await as(OWNER, "select * from erp_product_arrivals").then((x) => x.length === 0, () => true), "La tabla no se lee directo");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
