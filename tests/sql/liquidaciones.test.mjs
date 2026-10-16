// Pruebas de 20261109_repartos_liquidaciones.sql (sobre 20261106 y las funciones de ventas de producción).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_liq_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql"]
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

console.log("Beneficiarios independientes por pozo");
const ben = (uid, point, name) => one(uid, "select public.erp_beneficiary_save($1, null, $2, $3, 'partner', null, null, true) r", [A, point, name]);
const bA = (await ben(MADRE, null, "Socio A")).id, bB = (await ben(MADRE, null, "Socio B")).id, bC = (await ben(MADRE, null, "Socio C")).id;
ok(Boolean(bA && bB && bC), "La madre crea sus 3 beneficiarios");
ok(/madre/i.test(await err(JMAN, "select public.erp_beneficiary_save($1, null, null, 'Intruso', 'partner', null, null, true)", [A]) ?? ""), "El encargado de un punto no toca los beneficiarios de la madre");
const bX = (await ben(JMAN, J, "Encargado X")).id, bY = (await ben(MADRE, J, "Socia Y")).id;
ok(Boolean(bX && bY), "El punto crea los suyos y la madre también puede (configura todo)");
ok(/tus puntos/i.test(await err(JMAN, "select public.erp_beneficiary_save($1, null, $2, 'Otro', 'partner', null, null, true)", [A, M]) ?? ""), "El encargado de JAVIER no toca el pozo de MARÍA");
ok(/permiso/i.test(await err(SELLER, "select public.erp_beneficiary_save($1, null, $2, 'X', 'partner', null, null, true)", [A, J]) ?? ""), "Un vendedor no crea beneficiarios");

const split = (uid, point, shares) => one(uid, "select public.erp_split_save($1, $2, $3::jsonb, 'Acuerdo de socios') r", [A, point, JSON.stringify(shares)]);
ok(/100/.test(await err(MADRE, "select public.erp_split_save($1, null, $2::jsonb, 'demasiado')", [A, JSON.stringify([{ beneficiary_id: bA, pct: 70 }, { beneficiary_id: bB, pct: 40 }])]) ?? ""), "No se puede repartir más del 100 %");
ok(/beneficiario activo de este pozo/i.test(await err(MADRE, "select public.erp_split_save($1, null, $2::jsonb, 'cruzado')", [A, JSON.stringify([{ beneficiary_id: bX, pct: 10 }])]) ?? ""), "Un beneficiario de un punto no entra en el reparto de la madre");
ok((await split(MADRE, null, [{ beneficiary_id: bA, pct: 50 }, { beneficiary_id: bB, pct: 30 }, { beneficiary_id: bC, pct: 20 }]))?.version === 1, "Reparto de la madre 50/30/20 (versión 1)");
ok((await split(JMAN, J, [{ beneficiary_id: bX, pct: 60 }, { beneficiary_id: bY, pct: 40 }]))?.version === 1, "Reparto de JAVIER 60/40, aparte del de la madre");

console.log("Lo pendiente por liquidar");
const ov = await one(MADRE, "select public.erp_pool_overview($1, null) r", [A]);
ok(n(ov.pending.pool_total) === 6500, "Madre: contado $1.500 + $5.000; el crédito sin cobrar no entra", ov.pending);
const ovJ = await one(JMAN, "select public.erp_pool_overview($1, $2) r", [A, J]);
ok(n(ovJ.pending.pool_total) === 4725, "JAVIER: solo su parte ($4.725)", ovJ.pending);
ok(/acceso/i.test(await err(JMAN, "select public.erp_pool_overview($1, null)", [A]) ?? ""), "El encargado del punto no ve el pozo de la madre");
ok(/acceso/i.test(await err(JVIEW, "select public.erp_pool_overview($1, $2)", [A, M]) ?? ""), "Un usuario de JAVIER no ve el pozo de MARÍA");
ok(/permiso/i.test(await err(OTHER, "select public.erp_pool_overview($1, null)", [A]) ?? ""), "Otra tienda madre no ve nada");

console.log("Liquidación de la madre");
const calc = (uid, point) => one(uid, "select public.erp_settlement_calculate($1, $2, now(), null) r", [A, point]);
const s1 = await calc(MADRE, null);
const d1 = await one(MADRE, "select public.erp_settlement_detail($1) r", [s1.id]);
const amt = (d, b) => n(d.lines.find((l) => l.beneficiary_id === b)?.amount);
ok(amt(d1, bA) === 3250 && amt(d1, bB) === 1950 && amt(d1, bC) === 1300, "50/30/20 de $6.500 = $3.250 / $1.950 / $1.300", d1.lines);
ok(d1.lines.reduce((s, l) => s + n(l.amount), 0) === 6500 && d1.sources.length === 2, "Las partes suman exacto y muestra las 2 ventas de origen");
ok(/abierta/i.test(await err(MADRE, "select public.erp_settlement_calculate($1, null, now(), null)", [A]) ?? ""), "No se pueden tener dos liquidaciones abiertas del mismo pozo");
ok(/permiso/i.test(await err(MADRE, "select public.erp_settlement_transition($1, 'approve', null)", [s1.id]) ?? ""), "Quien solo prepara liquidaciones no puede aprobarlas");
await one(MADRE, "select public.erp_settlement_transition($1, 'submit', null) r", [s1.id]);
ok((await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', 'ok') r", [s1.id]))?.status === "approved", "Otra persona la aprueba");

const lineA = d1.lines.find((l) => l.beneficiary_id === bA).id;
const pay = (uid, line, amount, key) => one(uid, "select public.erp_settlement_pay($1, $2, 'transfer', 'REF', null, now(), $3) r", [line, amount, key]);
const p1 = await pay(APPROVER, lineA, 1000, "pago-socio-a-0001");
const p1b = await pay(APPROVER, lineA, 1000, "pago-socio-a-0001");
ok(p1.ok && p1b.already && p1b.payment_id === p1.payment_id, "Un pago repetido (mismo envío) no se registra dos veces");
ok(/supera/i.test(await err(APPROVER, "select public.erp_settlement_pay($1, 5000, 'transfer', null, null, now(), 'pago-socio-a-0002')", [lineA]) ?? ""), "No se puede pagar más del saldo");
ok(/permiso/i.test(await err(MADRE, "select public.erp_settlement_pay($1, 10, 'transfer', null, null, now(), 'pago-socio-a-0003')", [lineA]) ?? ""), "Sin permiso de pagos no se registra el pago");
ok((await raw("select status from erp_settlements where id = $1", [s1.id]))[0].status === "partially_paid", "Queda en pago parcial");
ok(/pagos registrados/i.test(await err(APPROVER, "select public.erp_settlement_transition($1, 'revert', 'error')", [s1.id]) ?? ""), "Con pagos no se puede revertir");
for (const l of d1.lines) {
  const left = n(l.amount) - (l.id === lineA ? 1000 : 0);
  await pay(APPROVER, l.id, left, "pago-total-" + l.id);
}
ok((await raw("select status from erp_settlements where id = $1", [s1.id]))[0].status === "paid", "Pagado completo");

console.log("Cobros de crédito y anulaciones después de liquidar");
await raw("update erp_receivables set balance = 9056.25 where id = $1", [R2]); // se cobró la mitad
await raw("update orders set status = 'cancelled' where id = $1", [o3]);  // se anuló una venta ya liquidada
const ov2 = await one(MADRE, "select public.erp_pool_overview($1, null) r", [A]);
ok(n(ov2.pending.pool_total) === 375 - 5000, "Nuevo por liquidar: +$375 (mitad cobrada) − $5.000 (anulada) = −$4.625", ov2.pending);
const s2 = await calc(MADRE, null);
const d2 = await one(MADRE, "select public.erp_settlement_detail($1) r", [s2.id]);
ok(amt(d2, bA) === -2312.5 && amt(d2, bB) === -1387.5 && amt(d2, bC) === -925, "El ajuste negativo se reparte con los mismos %", d2.lines);
await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', 'ajuste') r", [s2.id]);
ok((await raw("select status from erp_settlements where id = $1", [s2.id]))[0].status === "paid", "Sin nada que pagar queda cerrada (el saldo en contra pasa a la siguiente)");
await raw("update erp_receivables set balance = 0, status = 'paid' where id = $1", [R2]);
const s3 = await calc(MADRE, null);
const d3 = await one(MADRE, "select public.erp_settlement_detail($1) r", [s3.id]);
const lA = d3.lines.find((l) => l.beneficiary_id === bA);
ok(n(lA.share_amount) === 187.5 && n(lA.carried_amount) === -2312.5 && n(lA.amount) === -2125, "Lo cobrado después ($375) se compensa con el saldo en contra", lA);
const [{ c }] = await raw("select count(*)::int c from erp_settlement_lines where settlement_id = $1 and carried_into = $2", [s2.id, s3.id]);
ok(c === 3, "Los saldos en contra quedan marcados como compensados (no se cuentan dos veces)");
await one(MADRE, "select public.erp_settlement_transition($1, 'discard', 'Lo hago a fin de mes') r", [s3.id]);
const [{ c: c2 }] = await raw("select count(*)::int c from erp_settlement_lines where carried_into is not null", []);
ok(c2 === 0, "Al descartar, los saldos vuelven a quedar pendientes");

console.log("Pozo del punto (independiente)");
const sj = await calc(JMAN, J);
const dj = await one(JMAN, "select public.erp_settlement_detail($1) r", [sj.id]);
ok(amt(dj, bX) === 4252.5 && amt(dj, bY) === 2835, "JAVIER: $4.725 + $2.362,50 cobrado = $7.087,50 → 60/40", dj.lines);
ok(/acceso/i.test(await err(JVIEW, "select public.erp_settlement_detail($1)", [s1.id]) ?? ""), "Un usuario del punto no ve la liquidación de la madre");
ok(/permiso/i.test(await err(OTHER, "select public.erp_settlement_detail($1)", [sj.id]) ?? ""), "Otra tienda no ve la liquidación del punto");
ok(/permission denied/i.test(await err(null, "select public.erp_settlements_list($1, null)", [A]) ?? ""), "Sin sesión: bloqueado");

console.log("Reversión con historial");
const appr = await err(JMAN, "select public.erp_settlement_transition($1, 'approve', null)", [sj.id]);
ok(/otra persona/i.test(appr ?? ""), "Aunque tenga permiso de aprobar, nadie aprueba la que él mismo preparó", appr);
await one(OWNER, "select public.erp_settlement_transition($1, 'approve', 'dueño') r", [sj.id]);
const lineX = dj.lines.find((l) => l.beneficiary_id === bX).id;
const px = await pay(JMAN, lineX, 100, "pago-x-000000001");
await one(OWNER, "select public.erp_settlement_payment_void($1, 'Me equivoqué de valor') r", [px.payment_id]);
ok((await one(OWNER, "select public.erp_settlement_transition($1, 'revert', 'Se recalcula') r", [sj.id]))?.status === "reverted", "Anulado el pago, se puede revertir");
const [{ v }] = await raw("select count(*)::int v from erp_settlement_payments where voided", []);
ok(v === 1, "El pago anulado queda en el historial");
const ovJ2 = await one(JMAN, "select public.erp_pool_overview($1, $2) r", [A, J]);
ok(n(ovJ2.pending.pool_total) === 7087.5, "Revertida, el dinero vuelve a estar pendiente por liquidar", ovJ2.pending);

const cfg = await one(JMAN, "select public.erp_profit_settings_get($1) r", [A]);
ok(Array.isArray(cfg.my_points) && cfg.my_points[0] === J, "Quien solo maneja liquidaciones sabe cuáles son sus puntos", cfg.my_points);

console.log("Redondeo");
const dist = await raw("select sum(amount) s from public.erp__distribute(100.01, $1::jsonb)", [JSON.stringify([{ beneficiary_id: bA, pct: 33.3333 }, { beneficiary_id: bB, pct: 33.3333 }, { beneficiary_id: bC, pct: 33.3334 }])]);
ok(n(dist[0].s) === 100.01, "Tres partes de un tercio suman exacto $100,01");
const [{ a }] = await raw("select count(*)::int a from erp_audit_logs where store_id = $1 and (action like 'settlement.%' or action like 'beneficiary.%' or action like 'profit_split.%')", [A]);
ok(a >= 15, "Cada paso queda en auditoría", a);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
