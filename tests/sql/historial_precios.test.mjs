// Pruebas de 20261333: historial de cambios de precio y «precio de antes» real para la etiqueta «Bajó de precio».
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$fn$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
alter table public.store_catalogs add column if not exists slug text;
alter table public.orders add column if not exists confirmed_at timestamptz;
`;
const combined = path.join(os.tmpdir(), `remhub_hp_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261333_historial_precios.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return (await db.query(s, p)).rows; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const U = (n) => `cd000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: P }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3) values ($1, 'VASO', 'V1', 5, 3000, 9000, 8000, 10000) returning id", [S]);
await raw("insert into auth.users (id, email) values ($1, 's@x.co')", [SELLER]);
await raw("insert into store_users (store_id, user_id, role, permissions, active) values ($1, $2, 'seller', '{pos}', true)", [S, SELLER]);

// Cambios de precio: el detal pasa 10.000 → 9.000 → 7.000; el stock solo no deja rastro.
await as(OWNER, "update products set price_3 = 9000 where id = $1", [P]);
await raw("update products set stock = 20 where id = $1", [P]);
await as(OWNER, "update products set price_3 = 7000, price_2 = 6500 where id = $1", [P]);
const hist = await raw("select level, old_price, new_price, changed_by from erp_product_price_history where product_id = $1 order by id", [P]);
ok(hist.length === 3, "Guarda cada precio que cambió (2 del detal + 1 del por mayor), no el cambio de stock", hist);
ok(hist[0].level === 3 && Number(hist[0].old_price) === 10000 && Number(hist[0].new_price) === 9000 && hist[0].changed_by === OWNER, "Con antes, después y quién", hist[0]);

// Ventas del catálogo Detal a 8.500 (mayor que hoy) y a 6.000 (menor: no sirve como «antes»).
const [{ id: C }] = await raw("insert into store_catalogs (store_id, name, slug) values ($1, 'Detal', 'detal') returning id", [S]);
const order = async (price, days) => {
  const [{ id }] = await raw("insert into orders (store_id, token, status, total, confirmed_at) values ($1, gen_random_uuid()::text, 'confirmed', $2, now() - ($3 || ' days')::interval) returning id", [S, price, String(days)]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, $3)", [id, P, price]);
  await raw("insert into store_catalog_orders (order_id, catalog_id, store_id) values ($1, $2, $3)", [id, C, S]);
};
await order(8500, 5); await order(6000, 2); await order(9500, 400);

const call = "select public.product_price_before($1, $2, 3, 'detal') r";
const [{ r }] = await as(OWNER, call, [S, P]);
ok(r.ok && Number(r.now) === 7000, "Precio de hoy del detal: 7.000", r);
ok(r.history.length === 2 && Number(r.history[0].price) === 9000 && Number(r.history[1].price) === 10000, "Precios que tuvo, el más reciente primero: 9.000 y 10.000", r.history);
ok(r.sold.length === 1 && Number(r.sold[0].price) === 8500, "Vendido en el catálogo a 8.500 hace 5 días (no el de 6.000 ni el de hace más de 180 días)", r.sold);
ok(r.tracking_since !== null, "Dice desde cuándo se guarda el historial");
const [{ r: r2 }] = await as(OWNER, "select public.product_price_before($1, $2, 2, null) r", [S, P]);
ok(r2.history.length === 1 && Number(r2.history[0].price) === 8000 && r2.sold.length === 0, "Por mayor: su propio historial; sin catálogo no busca ventas", r2);
ok(!JSON.stringify(r).includes("3000"), "Nunca entrega el costo");
const [{ r: denied }] = await as(SELLER, call, [S, P]);
ok(denied.ok === false, "Sin permiso de productos: no", denied);
const [{ r: anon }] = await as(null, call, [S, P]);
ok(anon.ok === false, "Sin sesión: no");

// Si el historial falla, el producto igual se guarda.
await raw("alter table erp_product_price_history add constraint t_fail check (old_price < 0) not valid");
await as(OWNER, "update products set price_3 = 6800 where id = $1", [P]);
ok(Number((await raw("select price_3 from products where id = $1", [P]))[0].price_3) === 6800, "Si el historial falla, el cambio de precio se guarda igual");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
