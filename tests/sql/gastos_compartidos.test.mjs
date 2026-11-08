// Pruebas de 20261288: gastos compartidos en la liquidación y cómo se reparte cada anticipo o gasto
// (según el reparto, partes iguales, % propios o uno solo).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_gc_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql",
  "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261208_liquidacion_ganancia_total.sql", "migraciones/20261286_anticipos_liquidacion.sql",
  "migraciones/20261288_gastos_compartidos_liquidacion.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
// 20261288 se puede correr dos veces.
await db.exec(fs.readFileSync(path.join(here, "migraciones/20261288_gastos_compartidos_liquidacion.sql"), "utf8"));

const U = (n) => `f2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const n = (v) => Number(v);
const close = (a, b) => Math.abs(n(a) - n(b)) < 0.006;

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, name]))[0].id;
const Z = await wh("ZAMORA"), M = await wh("MARIA");
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
const ben = (point, name) => one(MADRE, "select public.erp_beneficiary_save($1, null, $2, $3, 'partner', null, null, true) r", [A, point, name]);
const bM = (await ben(Z, "LOS MELLOS")).id, bR = (await ben(Z, "ROBIN Y JUAN")).id, bO = (await ben(M, "OTRO")).id;
await one(MADRE, "select public.erp_split_save($1, $2, $3::jsonb, 'Acuerdo') r", [A, Z, JSON.stringify([{ beneficiary_id: bM, pct: 50 }, { beneficiary_id: bR, pct: 50 }])]);
await one(MADRE, "select public.erp_pool_settings_save($1, $2, 'total', now() - interval '1 day', false, null) r", [A, Z]);
await sale(18112.5, 2); // ganancia 6.225 → 3.112,50 cada uno

const save = (kind, split, b, shares, amount, note = "Transporte de mercancía") =>
  one(MADRE, "select public.erp_settlement_advance_save($1, $2, $3, $4, $5, $6::jsonb, $7, null, 'cash', null, $8, null) r",
    [A, Z, kind, split, b, shares ? JSON.stringify(shares) : null, amount, note]);
const saveErr = (kind, split, b, shares, amount) =>
  err(MADRE, "select public.erp_settlement_advance_save($1, $2, $3, $4, $5, $6::jsonb, $7, null, 'cash', null, 'Prueba', null)",
    [A, Z, kind, split, b, shares ? JSON.stringify(shares) : null, amount]);
const approve = (id) => one(APPROVER, "select public.erp_settlement_advance_decide($1, 'approve', null) r", [id]);
const ov = async () => (await one(MADRE, "select public.erp_pool_overview($1, $2) r", [A, Z])).pending;
const line = (lines, b) => lines.find((l) => l.beneficiary_id === b);

console.log("1. Validaciones");
ok(/sumar 100/.test((await saveErr("expense", "custom", null, [{ beneficiary_id: bM, pct: 60 }, { beneficiary_id: bR, pct: 30 }], 1000)) ?? ""), "Los % propios deben sumar 100");
ok(/no es de este pozo/.test((await saveErr("expense", "custom", null, [{ beneficiary_id: bM, pct: 50 }, { beneficiary_id: bO, pct: 50 }], 1000)) ?? ""), "No se puede repartir con un beneficiario de otro pozo");
ok(/a quién/.test((await saveErr("advance", "one", null, null, 1000)) ?? ""), "«Uno solo» pide escoger a quién");
ok(/anticipo o un gasto/.test((await saveErr("otro", "pool", null, null, 1000)) ?? ""), "El tipo debe ser anticipo o gasto");

console.log("2. Cada uno se reparte como se escogió");
const g1 = await save("expense", "custom", null, [{ beneficiary_id: bM, pct: 70 }, { beneficiary_id: bR, pct: 30 }], 1000, "Mecatos del equipo");
const g2 = await save("expense", "equal", null, null, 1001, "Transporte");
const a1 = await save("advance", "one", bR, null, 500, "Se llevó para el bus");
for (const x of [g1, g2, a1]) await approve(x.id);
let p = await ov();
const lm = line(p.lines, bM), lr = line(p.lines, bR);
ok(close(lm.advance_amount, 700 + 500.5) && close(lr.advance_amount, 300 + 500.5 + 500), "LOS MELLOS −$1.200,50 (70 % + mitad) · ROBIN −$1.300,50 (30 % + mitad + su anticipo)", p.lines);
ok(close(lm.amount, 3112.5 - 1200.5) && close(lr.amount, 3112.5 - 1300.5), "A cada uno se le resta de su parte", p.lines);
ok(n(p.advances_total) === 2501, "Total descontado: $2.501", p);
ok(p.advances.some((x) => x.kind === "expense" && x.split === "custom") && p.advances.some((x) => x.kind === "advance" && x.split === "one"), "Se ve el tipo y cómo se reparte cada uno", p.advances);

console.log("3. Los anticipos que ya existían siguen igual");
await raw("insert into erp_settlement_advances (store_id, point_id, number, beneficiary_id, amount, given_at, note, status) values ($1, $2, 99, null, 2000, now() - interval '1 hour', 'Viejo sin tipo', 'approved')", [A, Z]);
p = await ov();
ok(close(line(p.lines, bM).advance_amount, 1200.5 + 1000), "Sin tipo ni reparto: se toma «según el reparto» (50/50)", p.lines);

console.log("4. Liquidar y ver el detalle");
const s = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);
const d = await one(MADRE, "select public.erp_settlement_detail($1) r", [s.id]);
ok(d.advances.length === 4 && d.advances.filter((x) => x.kind === "expense").length === 2, "El detalle trae los 4 (2 gastos y 2 anticipos) con su tipo", d.advances);
ok(d.lines.every((l) => close(l.amount, n(l.share_amount) + n(l.carried_amount) - n(l.advance_amount))), "Cada línea cuadra: parte + saldo − descuentos", d.lines);
const L = await one(MADRE, "select public.erp_settlement_advances_list($1, $2) r", [A, Z]);
ok(L.length === 4 && L.every((x) => x.settlement) && L.some((x) => Array.isArray(x.shares)), "La lista los muestra descontados y con los % propios", L.map((x) => [x.kind, x.split, x.shares]));

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
