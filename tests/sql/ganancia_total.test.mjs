// Pruebas de 20261208: liquidar la GANANCIA TOTAL de cada punto (venta − costo), gastos opcionales y bloqueo sin costo.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_gt_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261208_liquidacion_ganancia_total.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `f0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), MADRE = U(2), APPROVER = U(3), JMAN = U(4), JVIEW = U(5), OTHER = U(6), SELLER = U(7);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const n = (v) => Number(v);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1)", [OTHER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, name]))[0].id;
const J = await wh("JAVIER"), M = await wh("MARIA");
const member = (uid, perms, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', $3, $4)", [A, uid, perms, point]);
await member(MADRE, ["profit_beneficiaries", "profit_settle", "profit_view"], null);
await member(APPROVER, ["profit_settle_approve", "profit_pay", "profit_view"], null);
await member(JMAN, ["profit_beneficiaries", "profit_settle", "profit_settle_approve", "profit_pay"], J);
await member(JVIEW, ["profit_view"], J);
await member(SELLER, ["pos"], J);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ORGANIZADOR', 15000, 20000, 17000, 15750, 18000, 19000, 100) returning id", [A]);
for (const w of [J, M]) await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [w, P, A]);
await one(OWNER, "select public.erp_price_rule_save($1, $2, 'point', null, 'pct', 15, null, null, 'Punto JAVIER') r", [A, J]);

const sale = async (point, price, qty) => {
  const r = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty, price }])]);
  const [{ id }] = await raw("select id from orders where token = $1", [r.token]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, point]);
  await raw("update orders set status = 'confirmed', confirmed_at = now() - interval '1 minute' where id = $1", [id]);
  await raw("select public.erp__apply_order_stock($1)", [id]);
  return id;
};
const o1 = await sale(J, 18112.5, 2); // contado: madre 1.500 · punto 4.725
const o2 = await sale(J, 18112.5, 1); // crédito: madre 750 · punto 2.362,50
const o3 = await sale(M, 20000, 1);   // contado en MARÍA (sin regla): madre 5.000
const [{ id: R2 }] = await raw("insert into erp_receivables (store_id, order_id, total, balance, status) values ($1, $2, 18112.5, 18112.5, 'open') returning id", [A, o2]);

const ben = (uid, point, name) => one(uid, "select public.erp_beneficiary_save($1, null, $2, $3, 'partner', null, null, true) r", [A, point, name]);
const split = (uid, point, shares) => one(uid, "select public.erp_split_save($1, $2, $3::jsonb, 'Acuerdo de socios') r", [A, point, JSON.stringify(shares)]);
const bA = (await ben(MADRE, null, "Socio madre")).id;
await split(MADRE, null, [{ beneficiary_id: bA, pct: 100 }]);
const bX = (await ben(MADRE, J, "LOS MELLOS")).id, bY = (await ben(MADRE, J, "ROBIN Y JUAN")).id;
await split(MADRE, J, [{ beneficiary_id: bX, pct: 50 }, { beneficiary_id: bY, pct: 50 }]);
const ovJ = async () => (await one(MADRE, "select public.erp_pool_overview($1, $2) r", [A, J])).pending;
const ovM = async () => (await one(MADRE, "select public.erp_pool_overview($1, null) r", [A])).pending;
const settings = (uid, mode, deduct, from = "yesterday") =>
  one(uid, `select public.erp_pool_settings_save($1, $2, $3, now() - interval '1 day', $4, ${from === "yesterday" ? "now() - interval '1 day'" : "null"}) r`, [A, J, mode, deduct]);

console.log("Como antes (modo «sobre el precio de la madre»)");
ok(n((await ovJ()).pool_total) === 4725, "JAVIER reparte solo lo que agrega sobre la madre ($4.725)", await ovJ());
ok(n((await ovM()).pool_total) === 6500, "La madre: $1.500 de JAVIER + $5.000 de MARÍA", await ovM());

console.log("Ganancia total del punto (venta − costo)");
ok(/tienda madre/.test((await err(JMAN, "select public.erp_pool_settings_save($1, $2, 'total', null, false, null)", [A, J])) ?? ""), "El encargado del punto no puede cambiar cómo se liquida");
ok(/puntos/.test((await err(MADRE, "select public.erp_pool_settings_save($1, null, 'total', null, false, null)", [A])) ?? ""), "La madre no usa el modo ganancia total (es para los puntos)");
await settings(MADRE, "total", false);
let pj = await ovJ();
ok(n(pj.pool_total) === 6225 && n(pj.gross_total) === 6225, "JAVIER: 2 und. × ($18.112,50 − $15.000) = $6.225 de ganancia total", pj);
const pm = await ovM();
ok(n(pm.pool_total) === 5000, "La madre ya no se lleva nada de las ventas de JAVIER (solo los $5.000 de MARÍA)", pm);
ok(pj.lines.length === 2 && pj.lines.every((l) => n(l.amount) === 3112.5), "Reparto 50/50 entre LOS MELLOS y ROBIN Y JUAN: $3.112,50 cada uno", pj.lines);

console.log("Restar gastos (opcional)");
const [{ id: CAT }] = await raw("insert into erp_expense_categories (store_id, name) values ($1, 'Arriendo') returning id", [A]);
const [{ id: E1 }] = await raw("insert into erp_expenses (store_id, point_id, category_id, number, description, amount, incurred_on) values ($1, $2, $3, 1, 'Arriendo local', 1000, current_date) returning id", [A, J, CAT]);
await raw("insert into erp_payroll_runs (store_id, point_id, number, period_kind, period_start, period_end, status, total_cost) values ($1, $2, 1, 'biweekly', current_date - 14, current_date, 'approved', 500)", [A, J]);
await raw("insert into erp_payroll_runs (store_id, point_id, number, period_kind, period_start, period_end, status, total_cost) values ($1, $2, 2, 'biweekly', current_date - 14, current_date, 'draft', 9999)", [A, J]);
ok(n((await ovJ()).pool_total) === 6225, "Apagado: los gastos no se restan (solo ganancias)");
await settings(MADRE, "total", true);
pj = await ovJ();
ok(n(pj.gross_total) === 6225 && n(pj.expenses_total) === 1500 && n(pj.pool_total) === 4725 && pj.expenses === 2,
  "Encendido: $6.225 − arriendo $1.000 − nómina $500 = $4.725 (la nómina en borrador no cuenta)", pj);

console.log("Productos vendidos sin costo");
const [{ id: P0 }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'SIN COSTO', 0, 10000, 10000, 10000, 10000, 10000, 10) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 10)", [J, P0, A]);
const r0 = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P0, qty: 1, price: 11500 }])]);
const [{ id: o0 }] = await raw("select id from orders where token = $1", [r0.token]);
await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [o0, A, J]);
await raw("update orders set status = 'confirmed', confirmed_at = now() - interval '1 minute' where id = $1", [o0]);
await raw("select public.erp__apply_order_stock($1)", [o0]);
pj = await ovJ();
ok(pj.no_cost.length === 1 && pj.no_cost[0].name === "SIN COSTO", "Se avisa que hay un producto vendido sin costo", pj.no_cost);
ok(/sin costo: SIN COSTO/.test((await err(MADRE, "select public.erp_settlement_calculate($1, $2, now(), null)", [A, J])) ?? ""), "No deja liquidar mientras haya productos sin costo");
await raw("update products set cost_price = 8000 where id = $1", [P0]);
const fix = await one(MADRE, "select public.erp_sale_finance_fix_costs($1, $2) r", [A, J]);
ok(fix.fixed === 1 && fix.left === 0, "«Tomar el costo actual» corrige la venta (costo $8.000)", fix);
pj = await ovJ();
ok(pj.no_cost.length === 0 && n(pj.gross_total) === 6225 + 3500, "Ahora la ganancia incluye esa venta: + ($11.500 − $8.000)", pj);

console.log("Liquidar y no repetir");
const s = await one(MADRE, "select public.erp_settlement_calculate($1, $2, now(), null) r", [A, J]);
const st = (await raw("select gross_total::float g, expenses_total::float e, pool_total::float p, mode, deducted from erp_settlements where id = $1", [s.id]))[0];
ok(st.g === 9725 && st.e === 1500 && st.p === 8225 && st.mode === "total" && st.deducted, "La liquidación guarda: bruto $9.725 − gastos $1.500 = $8.225 a repartir", st);
const bd = await one(MADRE, "select public.erp_settlement_breakdown($1, $2, null, $3) r", [A, J, s.id]);
const line1 = bd.orders.flatMap((o) => o.lines).find((l) => l.name === "ORGANIZADOR");
ok(bd.orders.length === 2 && bd.expenses.length === 2 && line1 && n(line1.revenue) === 36225 && n(line1.cost) === 30000 && n(line1.profit) === 6225,
  "El detalle muestra cada venta con sus productos: venta $36.225, costo $30.000, ganancia $6.225; y los 2 gastos", bd);
ok(bd.orders.flatMap((o) => o.lines).find((l) => l.name === "SIN COSTO")?.cost_source === "fixed_later", "…y marca el costo que se puso después");
await one(MADRE, "select public.erp_settlement_transition($1, 'submit', null) r", [s.id]);
await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', 'ok') r", [s.id]);
pj = await ovJ();
ok(n(pj.pool_total) === 0 && n(pj.expenses_total) === 0, "Después de liquidar no queda nada repetido (ni ventas ni gastos)", pj);
await raw("update erp_expenses set status = 'void' where id = $1", [E1]);
pj = await ovJ();
ok(n(pj.expenses_total) === -1000 && n(pj.pool_total) === 1000, "Si se anula un gasto ya restado, la siguiente liquidación lo devuelve (+$1.000)", pj);

console.log("Volver al modo anterior");
await settings(MADRE, "margin", false, "keep");
pj = await ovJ();
ok(n(pj.expenses_total) === 0, "Apagar «restar gastos» no deshace lo ya liquidado");
ok(n(pj.gross_total) === 0, "Volver al modo anterior NO recalcula las ventas ya liquidadas con ganancia total", pj);
const periods = await raw("select ended_at is not null closed from erp_pool_mode_periods where point_id = $1", [J]);
ok(periods.length === 1 && periods[0].closed, "Queda el historial: el período de ganancia total se cerró", periods);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
