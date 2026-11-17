// Pruebas de 20261323: «por debajo del costo» con el mismo costo que la ganancia del punto.
// Caso real: SECADOR · último costo $30.000 · promedio $43.494 · vendido a $36.512.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
// Lo mínimo de 20261206 (último costo, base de precios) y de 20261287/20261208 (base de costo por punto).
const extra = `
create table if not exists public.erp_cash_sessions (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, number bigint, status text,
  difference numeric, closed_by_name text, closed_at timestamptz);
alter table public.products add column if not exists last_cost numeric(14, 4);
alter table public.erp_profit_settings add column if not exists price_cost_basis text not null default 'last';
create table if not exists public.erp_pool_settings (store_id uuid, point_id uuid, cost_basis text not null default 'average', cost_basis_from timestamptz);
create or replace function public.erp__sale_cost_basis(p_store uuid, p_point uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select case when p_point is not null and exists (
    select 1 from public.erp_pool_settings s
    where s.store_id = p_store and s.point_id = p_point and s.cost_basis = 'last'
      and (s.cost_basis_from is null or p_at >= s.cost_basis_from)) then 'last' else 'average' end;
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_acl_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  extra,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
await db.exec(fs.readFileSync(path.join(MIG, "20261225_plata_y_control.sql"), "utf8"));
const M = fs.readFileSync(path.join(MIG, "20261323_alerta_costo_igual_liquidacion.sql"), "utf8");
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
const U = (n) => `ce700000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELL = U(2), BOSS = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CISNEROS', true, 'point') returning id", [A]);
const [{ id: OTHER }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [U(9)]);
const [{ id: ZB }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'AJENO', true, 'point') returning id", [OTHER]);
await raw("insert into erp_pool_settings (store_id, point_id, cost_basis) values ($1, $2, 'last'), ($3, $4, 'last')", [A, Z, OTHER, ZB]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}'), ($1, $3, 'seller', '{costs_view}')", [A, SELL, BOSS]);
const prod = async (n, avg, last, price) => (await raw(
  "insert into products (store_id, name, sku, cost_price, last_cost, price_1, price_2, price_3, price_4, price_5) values ($1, $2, $2, $3, $4, $5, $5, $5, $5, $5) returning id",
  [A, n, avg, last, price]))[0].id;
const SEC = await prod("SECADOR", 43494, 30000, 36512);
const VIEJO = await prod("SIN COMPRAS", 10000, null, 9000);
const items = (p, price) => JSON.stringify([{ product_id: p, price }]);

console.log("Aviso del POS");
let r = await one(SELL, "select public.erp_below_cost_check($1, $2::jsonb, $3) r", [A, items(SEC, 36512), Z]);
ok(Array.isArray(r) && r.length === 0, "Zamora (último costo): SECADOR a $36.512 NO está bajo el costo de $30.000", r);
r = await one(SELL, "select public.erp_below_cost_check($1, $2::jsonb, $3) r", [A, items(SEC, 29000), Z]);
ok(r.length === 1 && r[0].name === "SECADOR" && !("cost" in r[0]), "…a $29.000 sí (sin decirle el costo al vendedor)", r);
r = await one(SELL, "select public.erp_below_cost_check($1, $2::jsonb, $3) r", [A, items(SEC, 36512), C]);
ok(r.length === 1, "Cisneros (promedio): a $36.512 sí avisa, porque su ganancia se calcula con $43.494", r);
r = await one(SELL, "select public.erp_below_cost_check($1, $2::jsonb) r", [A, items(SEC, 36512)]);
ok(r.length === 1, "Sin punto: como antes (promedio)", r);
r = await one(SELL, "select public.erp_below_cost_check($1, $2::jsonb, $3) r", [A, items(SEC, 36512), ZB]);
ok(r.length === 1, "Un punto de otra tienda no cuenta (se usa el promedio)", r);
r = await one(SELL, "select public.erp_below_cost_check($1, $2::jsonb, $3) r", [A, items(VIEJO, 9000), Z]);
ok(r.length === 1, "Producto sin compras en un punto con último costo: usa el promedio", r);
ok((await one(U(8), "select public.erp_below_cost_check($1, $2::jsonb, $3) r", [A, items(SEC, 1), Z])).length === 0, "Alguien de fuera no averigua nada");

console.log("Alerta al administrador");
const sale = async (wh, p, price) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), $2, 'confirmed', now()) returning id", [A, price]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, $3)", [id, p, price]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, seller_id, seller_name, doc_number) values ($1, $2, $3, $4, 'JUAN', 'X-' || substr(md5(random()::text), 1, 6))", [id, A, wh, SELL]);
  return id;
};
const O1 = await sale(Z, SEC, 36512);
ok((await raw("select * from erp_cost_alerts where order_id = $1", [O1])).length === 0, "Venta en Zamora a $36.512: sin alerta");
const O2 = await sale(Z, SEC, 25000);
const a2 = await raw("select * from erp_cost_alerts where order_id = $1", [O2]);
ok(a2.length === 1 && Number(a2[0].cost) === 30000, "Venta en Zamora a $25.000: alerta con costo $30.000 (pérdida real $5.000)", a2);
const O3 = await sale(C, SEC, 36512);
const a3 = await raw("select * from erp_cost_alerts where order_id = $1", [O3]);
ok(a3.length === 1 && Number(a3[0].cost) === 43494, "Venta en Cisneros (promedio): alerta con $43.494", a3);

console.log("Lista de precios bajo el costo");
r = await one(BOSS, "select public.erp_prices_below_cost($1) r", [A]);
ok(r.ok && r.basis === "last" && !r.items.some((i) => i.name === "SECADOR"), "Con precios por último costo, SECADOR a $36.512 no sale en la lista", r);
ok(r.items.some((i) => i.name === "SIN COMPRAS" && Number(i.cost) === 10000), "SIN COMPRAS ($10.000 promedio, vendido a $9.000) sí sale", r.items);
await raw("insert into erp_profit_settings (store_id, price_cost_basis) values ($1, 'average') on conflict (store_id) do update set price_cost_basis = 'average'", [A]);
r = await one(BOSS, "select public.erp_prices_below_cost($1) r", [A]);
ok(r.basis === "average" && r.items.some((i) => i.name === "SECADOR" && Number(i.cost) === 43494), "Si la tienda calcula precios por promedio, sí sale", r.items);
ok((await one(SELL, "select public.erp_prices_below_cost($1) r", [A])).ok === false, "El vendedor no ve la lista");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
