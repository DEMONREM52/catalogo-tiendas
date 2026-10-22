// Pruebas de 20261225: ventas bajo costo, cierre del día, productos quietos, margen por producto y precios bajo costo.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create table if not exists public.erp_cash_sessions (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, number bigint, status text,
  difference numeric, closed_by_name text, closed_at timestamptz);
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
grant usage on schema public to service_role;
`;
const combined = path.join(os.tmpdir(), `remhub_pc_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  extra,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261225_plata_y_control.sql"), "utf8");
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
async function service(s, p) {
  await db.exec("set role service_role");
  try { return (await db.query(s, p)).rows[0]?.r; } finally { await db.exec("reset role"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce600000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELL = U(2), BOSS = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}'), ($1, $3, 'seller', '{costs_view,reports,inventory}')", [A, SELL, BOSS]);
const prod = async (n, cost, p3) => (await raw("insert into products (store_id, name, sku, cost_price, price_1, price_2, price_3, price_4, price_5) values ($1, $2, $2, $3, $4, $4, $4, $4, $4) returning id", [A, n, cost, p3]))[0].id;
const P = await prod("ALCOHOL", 10000, 15000), Q = await prod("GUANTES", 5000, 4000), R = await prod("QUIETO", 20000, 30000), S = await prod("NUEVO", 1000, 2000);

console.log("Ventas bajo el costo");
let r = await one(SELL, "select public.erp_below_cost_check($1, $2::jsonb) r", [A, JSON.stringify([{ product_id: P, price: 9000 }, { product_id: Q, price: 6000 }])]);
ok(r.length === 1 && r[0].name === "ALCOHOL" && !("cost" in r[0]), "El POS sabe que ALCOHOL a $9.000 queda bajo el costo (sin ver el costo)", r);
const sale = async (wh, items, ago = "0 hours", seller = SELL) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), $2, 'confirmed', now() - $3::interval) returning id", [A, items.reduce((s, i) => s + i[1] * i[2], 0), ago]);
  for (const [p, price, qty] of items) await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, $4)", [id, p, qty, price]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, seller_id, seller_name, doc_number) values ($1, $2, $3, $4, 'JUAN', 'Z-' || substr(md5(random()::text), 1, 6))", [id, A, wh, seller]);
  return id;
};
const O1 = await sale(Z, [[P, 9000, 2], [Q, 6000, 1]]);
const alerts = await raw("select * from erp_cost_alerts where order_id = $1", [O1]);
ok(alerts.length === 1 && alerts[0].product_name === "ALCOHOL" && Number(alerts[0].price) === 9000 && alerts[0].seller_name === "JUAN", "Al facturar queda la alerta con quién vendió", alerts);
r = await one(OWNER, "select public.erp_cost_alerts_list($1, 30) r", [A]);
ok(r.ok && r.unseen === 1 && Number(r.items[0].loss) === 2000 && r.items[0].point === "ZAMORA", "El dueño ve la alerta: pérdida $2.000 en Zamora", r);
ok((await one(SELL, "select public.erp_cost_alerts_list($1, 30) r", [A])).ok === false, "El vendedor no ve las alertas");
ok((await one(BOSS, "select public.erp_cost_alerts_list($1, 30) r", [A])).ok === true, "Quien tiene «Ver costos» sí las ve");
await one(OWNER, "select public.erp_cost_alerts_seen($1) r", [A]);
ok((await one(OWNER, "select public.erp_cost_alerts_list($1, 30) r", [A])).unseen === 0, "Marcar como vistas");
const push = await service("select public.erp_cost_alert_push($1) r", [O1]);
ok(push.users.includes(OWNER) && push.users.includes(BOSS) && !push.users.includes(SELL), "El aviso al celular va al dueño y a «Ver costos», no al vendedor", push);

console.log("Cierre del día");
await sale(B, [[P, 15000, 1]], "0 hours", OWNER);
await sale(Z, [[P, 15000, 3]], "2 days");
await raw("insert into erp_cash_sessions (store_id, point_id, number, status, difference, closed_by_name, closed_at) values ($1, $2, 4, 'review', -5000, 'JUAN', now())", [A, Z]);
await raw("insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id) values ($1, 1, $2, $3)", [A, B, Z]);
r = await one(OWNER, "select public.erp_daily_close($1) r", [A]);
ok(r.ok && Number(r.total) === 39000 && r.count === 2, "Ventas de hoy: $39.000 en 2 ventas (no cuenta la de hace 2 días)", r);
ok(r.points[0].name === "ZAMORA" && r.sellers.length >= 1, "Por punto y por vendedor", r.points);
ok(Number(r.cash[0]?.difference) === -5000 && r.transfers_pending === 1 && r.below_cost === 1, "Caja con faltante, traslados pendientes y ventas bajo costo", r);
ok((await one(SELL, "select public.erp_daily_close($1) r", [A])).ok === false, "El vendedor sin informes no lo ve");
const dig = await service("select public.erp_daily_close_digest() r");
ok(dig.length === 1 && dig[0].users.includes(OWNER) && dig[0].users.includes(BOSS) && Number(dig[0].summary.total) === 39000, "El aviso de las 9 p. m. va a quien ve informes", dig);

console.log("Productos quietos");
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 5), ($1, $4, $3, 8), ($1, $5, $3, 3)", [Z, R, A, P, S]);
await raw("insert into inventory_movements (store_id, product_id, kind, qty, warehouse_id, created_at) values ($1, $2, 'in', 5, $3, now() - interval '200 days'), ($1, $4, 'in', 3, $3, now() - interval '2 days')", [A, R, Z, S]);
r = await one(BOSS, "select public.erp_stale_stock($1, 60, null) r", [A]);
ok(r.ok && r.items.length === 1 && r.items[0].name === "QUIETO" && Number(r.items[0].value) === 100000, "QUIETO: 5 und. sin vender, $100.000 parados (lo que se vende y lo que acaba de llegar no cuentan)", r.items);
r = await one(OWNER, "select public.erp_stale_stock($1, 60, $2) r", [A, B]);
ok(r.ok && r.items.length === 0, "Filtrar por punto");

console.log("Margen por producto");
r = await one(BOSS, "select public.erp_product_margins($1, now() - interval '30 days', now() + interval '1 day', null) r", [A]);
const m = (n) => r.items.find((i) => i.name === n);
ok(r.ok && m("ALCOHOL")?.qty === 6 && Number(m("GUANTES")?.profit) === 1000, "Ganancia por producto (venta − costo)", r.items);
ok((await one(SELL, "select public.erp_product_margins($1, now() - interval '30 days', now(), null) r", [A])).ok === false, "Sin «Ver costos» no se ve");

console.log("Precios bajo costo");
r = await one(BOSS, "select public.erp_prices_below_cost($1) r", [A]);
ok(r.ok && r.items.length === 1 && r.items[0].name === "GUANTES" && r.items[0].levels.length === 5, "GUANTES cuesta $5.000 y se vende a $4.000 en los 5 precios", r.items);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
