// Pruebas de 20261209: tablero de puntos (mes a mes) y liquidación del punto (mercancía valorizada).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
create table if not exists public.erp_transfer_signatures (id uuid primary key default gen_random_uuid(), transfer_id uuid, store_id uuid, step text,
  signer_name text, notes text, via text, user_id uuid, created_at timestamptz default now(), unique (transfer_id, step));
alter table public.erp_transfers add column if not exists checked_by_name text;
alter table public.erp_warehouses add column if not exists phone text;
`;
const combined = path.join(os.tmpdir(), `remhub_tp_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261109_repartos_liquidaciones.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261110_gastos_presupuestos_nomina.sql"), "utf8"),
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_finanzas.sql"), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
  ...["20261124_credito_traslados.sql", "20261125_rentabilidad_cadena.sql", "20261126_varias_bodegas.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261209_tablero_puntos.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const n = (v) => Number(v);

const U = (n) => `cb000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ZUSER = U(2), SELLER = U(3), CREDIT_ONLY = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const wh = async (code, kind) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, $3) returning id", [A, code, kind]))[0].id;
const Z = await wh("ZAMORA", "point"), C = await wh("CISNEROS", "point");
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{profit_view,internal_credit}',$3)", [A, ZUSER, Z]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{pos}',$3)", [A, SELLER, Z]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{internal_credit}',$3)", [A, CREDIT_ONLY, Z]);
const [{ id: P }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3, price_4, price_5) values ($1, 'ZAPATERO', 'BX1', 0, 10000, 20000, 18000, 16000, 15000, 14000) returning id", [A]);
await raw("select public.erp__move($1, $2, $3, 100, 'purchase', 'test', null, 10000, 'carga', null, true)", [A, B1, P]);

// Crédito con 15 % (por defecto) y redondeo a 100; regla de precio del punto: +15 %.
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true}'::jsonb)", [A, Z]);
await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, status, reason, valid_from) values ($1, $2, 'point', 'pct', 15, 'active', 'margen', now() - interval '1 day')", [A, Z]);
const [{ id: tr }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: P, qty: 10 }])]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [tr]);

console.log("1. Liquidación del punto (mercancía valorizada)");
const v = await one(OWNER, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(v.ok && v.credit === true && n(v.totals.units) === 10, "Ve las 10 unidades de Zamora", v);
ok(n(v.totals.cost) === 100000, "A costo real: 10 × 10.000 = 100.000", v.totals);
ok(n(v.totals.internal) === 115000, "A precio de bodega: 10 × 11.500 = 115.000 (costo + 15 %)", v.totals);
ok(n(v.totals.sale) === 184000, "A precio de venta P3 con la regla: 10 × 18.400 = 184.000 (16.000 + 15 %)", v.totals);
ok(n(v.summary.balance) === 115000, "La deuda del punto es 115.000", v.summary);
const v1 = await one(OWNER, "select public.erp_point_valuation($1, $2, 1) r", [A, Z]);
ok(n(v1.totals.sale) === 230000 && v1.level === 1, "Con la lista P1: 10 × 23.000 = 230.000", v1.totals);
const vz = await one(ZUSER, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(vz.ok && n(vz.totals.sale) === 184000, "El usuario de Zamora ve su punto");
const vc = await one(ZUSER, "select public.erp_point_valuation($1, $2, 3) r", [A, C]);
ok(vc.ok === false, "…pero no el de Cisneros", vc);
const vs = await one(SELLER, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(vs.ok === false, "Un vendedor sin permiso no lo ve", vs);
const vco = await one(CREDIT_ONLY, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(vco.ok && vco.totals.cost === null && vco.lines[0].cost === null && n(vco.totals.internal) === 115000, "Sin «Ver costos» no ve el costo real (sí el precio de bodega)", vco.totals);

console.log("2. Tablero mes a mes");
// Ventas: este mes 5 unidades de Zamora y el mes pasado 2.
const sale = async (qty, revenue, cost, when, point) => {
  const [{ id: o }] = await raw("insert into orders (store_id, token, total, status, confirmed_at, created_at) values ($1, md5(random()::text), $2, 'confirmed', $3, $3) returning id", [A, revenue, when]);
  await raw(`insert into erp_sale_finance (order_id, product_id, store_id, point_id, qty, revenue, unit_cost, cost_total, ref_total, mother_amount, point_amount, profit, ref_source)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'internal')`,
    [o, P, A, point, qty, revenue, cost / qty, cost, qty * 11500, qty * 11500 - cost, revenue - qty * 11500, revenue - cost]);
};
const now = new Date();
const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 2), 17)).toISOString();
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 17)).toISOString();
await sale(5, 92000, 50000, thisMonth, Z);
await sale(2, 36800, 20000, lastMonth, Z);
const [{ id: cat }] = await raw("insert into erp_expense_categories (store_id, name) values ($1, 'Arriendo') returning id", [A]).catch(async () => raw("select id from erp_expense_categories where store_id = $1 limit 1", [A]));
await raw("insert into erp_expenses (store_id, point_id, category_id, number, description, amount, incurred_on) values ($1, $2, $3, 1, 'Arriendo', 30000, $4)", [A, Z, cat, thisMonth.slice(0, 10)]);
await as(OWNER, "select public.erp_internal_payment_add($1, $2, 40000, 'cash', null, null, 'abono', null)", [A, Z]);

const d = await one(OWNER, "select public.erp_points_dashboard($1, 6) r", [A]);
ok(d.ok && d.months === 6 && d.can_see_costs === true, "Responde con 6 meses", { ok: d.ok, months: d.months });
const dz = d.points.find((p) => p.point_id === Z);
ok(dz && dz.months.length === 6, "Zamora tiene sus 6 meses", dz?.months?.length);
const cur = dz.months[5], prev = dz.months[4];
ok(n(cur.revenue) === 92000 && n(cur.cost) === 50000 && n(cur.profit) === 42000, "Este mes: venta 92.000, costo 50.000, ganancia 42.000", cur);
ok(n(cur.point_profit) === 34500 && n(cur.bodega_profit) === 7500, "…del punto 34.500 y de la bodega 7.500", cur);
ok(n(cur.expenses) === 30000, "…gastos 30.000", cur);
ok(n(cur.charged) === 115000 && n(cur.charged_cost) === 100000 && n(cur.paid) === 40000, "…trasladado 115.000 (costo 100.000) y abonó 40.000", cur);
ok(n(prev.revenue) === 36800 && n(prev.orders) === 1, "Mes pasado: venta 36.800", prev);
ok(n(dz.debt.balance) === 75000, "Debe 75.000 (115.000 − 40.000)", dz.debt);
ok(n(dz.stock.units) === 10 && n(dz.stock.cost) === 100000, "Inventario de hoy: 10 unidades, 100.000 a costo", dz.stock);
const dzu = await one(ZUSER, "select public.erp_points_dashboard($1, 6) r", [A]);
ok(dzu.ok && dzu.points.length === 1 && dzu.points[0].point_id === Z, "El usuario de Zamora solo ve Zamora", dzu.points?.map((p) => p.name));
const dco = await one(CREDIT_ONLY, "select public.erp_points_dashboard($1, 6) r", [A]);
ok(dco.ok === false, "«Cuenta con la bodega» sola no abre el tablero (necesita ver rentabilidad)", dco);
const d24 = await one(OWNER, "select public.erp_points_dashboard($1, 99) r", [A]);
ok(d24.months === 24 && d24.points[0].months.length === 24, "Máximo 24 meses", d24.months);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
