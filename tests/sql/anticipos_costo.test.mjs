// Pruebas de 20261289: los anticipos se abonan al costo de la mercancía (no tocan la ganancia);
// lo que sobra pasa a la siguiente liquidación; los gastos siguen restándose de la ganancia.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_ac_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql",
  "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261208_liquidacion_ganancia_total.sql", "migraciones/20261286_anticipos_liquidacion.sql",
  "migraciones/20261288_gastos_compartidos_liquidacion.sql", "migraciones/20261289_anticipos_al_costo.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
await db.exec(fs.readFileSync(path.join(here, "migraciones/20261289_anticipos_al_costo.sql"), "utf8")); // se puede correr dos veces

const U = (n) => `f3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), MADRE = U(2), APPROVER = U(3), SELLER = U(7);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const n = (v) => Number(v);
const close = (a, b) => Math.abs(n(a) - n(b)) < 0.006;

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const member = (uid, perms, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', $3, $4)", [A, uid, perms, point]);
await member(MADRE, ["profit_beneficiaries", "profit_settle", "profit_view"], null);
await member(APPROVER, ["profit_settle_approve", "profit_pay", "profit_view"], null);
await member(SELLER, ["pos"], Z);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ORGANIZADOR', 15000, 20000, 17000, 15750, 18000, 19000, 100) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [Z, P, A]);
const sale = async (price, qty) => {
  const r = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty, price }])]);
  const [{ id }] = await raw("select id from orders where token = $1", [r.token]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, Z]);
  await raw("update orders set status = 'confirmed', confirmed_at = now() - interval '1 minute' where id = $1", [id]);
  await raw("select public.erp__apply_order_stock($1)", [id]);
};
const ben = (name) => one(MADRE, "select public.erp_beneficiary_save($1, null, $2, $3, 'partner', null, null, true) r", [A, Z, name]);
const bM = (await ben("LOS MELLOS")).id, bR = (await ben("ROBIN Y JUAN")).id;
await one(MADRE, "select public.erp_split_save($1, $2, $3::jsonb, 'Acuerdo') r", [A, Z, JSON.stringify([{ beneficiary_id: bM, pct: 50 }, { beneficiary_id: bR, pct: 50 }])]);
await one(MADRE, "select public.erp_pool_settings_save($1, $2, 'total', now() - interval '1 day', false, null) r", [A, Z]);
await sale(18112.5, 2); // costo 30.000 · ganancia 6.225

const save = async (kind, split, b, amount, note) => {
  const r = await one(MADRE, "select public.erp_settlement_advance_save($1, $2, $3, $4, $5, null, $6, now() - interval '30 minutes', 'cash', null, $7, null) r", [A, Z, kind, split, b, amount, note]);
  await one(APPROVER, "select public.erp_settlement_advance_decide($1, 'approve', null) r", [r.id]);
  return r;
};
const ov = async () => (await one(MADRE, "select public.erp_pool_overview($1, $2) r", [A, Z])).pending;
const line = (lines, b) => lines.find((l) => l.beneficiary_id === b);

console.log("1. El anticipo se abona al costo, no a la ganancia");
const a1 = await save("advance", "one", bR, 20000, "La sede entregó para pagar mercancía");
let p = await ov();
ok(n(p.merch_cost) === 30000, "Costo de la mercancía del período: $30.000", p);
ok(n(p.cost_advances_total) === 20000 && n(p.cost_due) === 10000, "Costo $30.000 − anticipo $20.000 = falta entregar $10.000", p);
ok(close(line(p.lines, bM).amount, 3112.5) && close(line(p.lines, bR).amount, 3112.5), "La ganancia se reparte completa: $3.112,50 cada uno (el anticipo no les resta)", p.lines);
const saved = (await raw("select split, beneficiary_id from erp_settlement_advances where id = $1", [a1.id]))[0];
ok(saved.split === null && saved.beneficiary_id === null, "Un anticipo no guarda reparto ni beneficiario", saved);

console.log("2. Los gastos sí se restan de la ganancia");
await save("expense", "equal", null, 1000, "Transporte");
p = await ov();
ok(close(line(p.lines, bM).amount, 2612.5) && close(line(p.lines, bR).amount, 2612.5), "Gasto de $1.000 mitad y mitad: $2.612,50 cada uno", p.lines);
ok(n(p.cost_due) === 10000, "El gasto no toca el costo", p);

console.log("3. Lo que sobra de un anticipo pasa a la siguiente");
await save("advance", "pool", null, 25000, "Otro abono");
p = await ov();
ok(n(p.cost_advances_total) === 30000 && n(p.cost_due) === 0, "Se abona hasta cubrir el costo: $30.000 (falta entregar $0)", p);
ok(n(p.advances_pending_cost) === 45000, "Anticipos con saldo: $45.000 en total antes de liquidar", p);
const s1 = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);
await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', null) r", [s1.id]);
const st = (await raw("select merch_cost::float, cost_advances_total::float c, cost_due::float d from erp_settlements where id = $1", [s1.id]))[0];
ok(st.merch_cost === 30000 && st.c === 30000 && st.d === 0, "La liquidación guarda costo, abonos y lo que falta entregar", st);
p = await ov();
ok(n(p.advances_pending_cost) === 15000, "Quedan $15.000 del segundo anticipo para la siguiente", p);
const L = await one(MADRE, "select public.erp_settlement_advances_list($1, $2) r", [A, Z]);
const second = L.find((x) => x.note === "Otro abono");
ok(n(second.used) === 10000, "En la lista se ve cuánto se ha abonado de cada anticipo ($10.000 de $25.000)", second);

console.log("4. En la siguiente liquidación se abona el resto");
await sale(20000, 1); // costo 15.000
p = await ov();
ok(n(p.merch_cost) === 15000 && n(p.cost_advances_total) === 15000 && n(p.cost_due) === 0, "Costo $15.000 cubierto con el saldo del anticipo", p);
ok(close(line(p.lines, bM).amount, 2500) && close(line(p.lines, bR).amount, 2500), "La ganancia nueva ($5.000) se reparte completa", p.lines);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
