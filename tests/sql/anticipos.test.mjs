// Pruebas de 20261286: anticipos de liquidación (de un beneficiario o de todo el pozo, aprobación de otra persona,
// lo que no alcanza pasa a la siguiente, rechazar/revertir los devuelve).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_ant_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql",
  "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261208_liquidacion_ganancia_total.sql", "migraciones/20261286_anticipos_liquidacion.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `f1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), MADRE = U(2), APPROVER = U(3), JVIEW = U(5), SELLER = U(7), BOTH = U(8);
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

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, name]))[0].id;
const Z = await wh("ZAMORA"), M = await wh("MARIA");
const member = (uid, perms, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', $3, $4)", [A, uid, perms, point]);
await member(MADRE, ["profit_beneficiaries", "profit_settle", "profit_view"], null);
await member(APPROVER, ["profit_settle_approve", "profit_pay", "profit_view"], null);
await member(JVIEW, ["profit_view"], Z);
await member(BOTH, ["profit_settle", "profit_settle_approve", "profit_view"], null);
await member(SELLER, ["pos"], Z);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ORGANIZADOR', 15000, 20000, 17000, 15750, 18000, 19000, 100) returning id", [A]);
for (const w of [Z, M]) await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [w, P, A]);
const sale = async (point, price, qty) => {
  const r = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty, price }])]);
  const [{ id }] = await raw("select id from orders where token = $1", [r.token]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, point]);
  await raw("update orders set status = 'confirmed', confirmed_at = now() - interval '1 minute' where id = $1", [id]);
  await raw("select public.erp__apply_order_stock($1)", [id]);
  return id;
};
const ben = (point, name) => one(MADRE, "select public.erp_beneficiary_save($1, null, $2, $3, 'partner', null, null, true) r", [A, point, name]);
const bMellos = (await ben(Z, "LOS MELLOS")).id, bRobin = (await ben(Z, "ROBIN Y JUAN")).id;
const bOtro = (await ben(M, "OTRO POZO")).id;
await one(MADRE, "select public.erp_split_save($1, $2, $3::jsonb, 'Acuerdo') r", [A, Z, JSON.stringify([{ beneficiary_id: bMellos, pct: 50 }, { beneficiary_id: bRobin, pct: 50 }])]);
await one(MADRE, "select public.erp_pool_settings_save($1, $2, 'total', now() - interval '1 day', false, null) r", [A, Z]);
await sale(Z, 18112.5, 2); // ganancia total 6.225 → 3.112,50 cada uno

const ov = async () => (await one(MADRE, "select public.erp_pool_overview($1, $2) r", [A, Z]));
const line = (lines, b) => lines.find((l) => l.beneficiary_id === b);
const adv = (uid, b, amount, extra = {}) => one(uid, "select public.erp_settlement_advance_save($1, $2, $3, $4, $5, $6, null, $7, null) r",
  [A, Z, b, amount, extra.given ?? null, extra.method ?? "cash", extra.note ?? "Se lo llevó en efectivo"]);
const decide = (uid, id, action, note = null) => one(uid, "select public.erp_settlement_advance_decide($1, $2, $3) r", [id, action, note]);
const list = async () => await one(MADRE, "select public.erp_settlement_advances_list($1, $2) r", [A, Z]);

console.log("1. Registrar y aprobar");
ok(/Preparar liquidaciones/.test((await err(JVIEW, "select public.erp_settlement_advance_save($1, $2, null, 1000, null, 'cash', null, 'x x x', null)", [A, Z])) ?? ""), "Quien solo ve rentabilidad no registra anticipos");
ok(/no es de este pozo/.test((await err(MADRE, "select public.erp_settlement_advance_save($1, $2, $3, 1000, null, 'cash', null, 'Prueba', null)", [A, Z, bOtro])) ?? ""), "No se puede cargar a un beneficiario de otro pozo");
ok(/futura/.test((await err(MADRE, "select public.erp_settlement_advance_save($1, $2, null, 1000, now() + interval '2 days', 'cash', null, 'Prueba', null)", [A, Z])) ?? ""), "La fecha en que salió el dinero no puede ser futura");
const a1 = await adv(BOTH, bRobin, 5000, { note: "ROBIN se llevó plata de la caja" });
ok(a1.ok && n(a1.number) === 1, "Anticipo #1 de ROBIN Y JUAN por $5.000 registrado", a1);
let o = await ov();
ok(n(o.pending.advances_total) === 0 && n(o.advances_waiting) === 1, "Sin aprobar no se descuenta (queda «por aprobar»)", o.pending);
ok(/Otra persona/.test((await err(BOTH, "select public.erp_settlement_advance_decide($1, 'approve', null)", [a1.id])) ?? ""), "Quien lo registró no lo aprueba (aunque tenga el permiso de aprobar)");
await decide(APPROVER, a1.id, "approve");
o = await ov();
ok(n(o.pending.advances_total) === 5000, "Aprobado: ya aparece por descontar", o.pending);
ok(n(line(o.pending.lines, bRobin).amount) === -1887.5 && n(line(o.pending.lines, bRobin).advance_amount) === 5000, "ROBIN Y JUAN: $3.112,50 − $5.000 = −$1.887,50", o.pending.lines);
ok(n(line(o.pending.lines, bMellos).amount) === 3112.5, "LOS MELLOS no se ve afectado: $3.112,50", o.pending.lines);

console.log("2. Del pozo completo (según los %)");
const a2 = await adv(MADRE, null, 2001, { note: "Pago común del local" });
await decide(OWNER, a2.id, "approve");
o = await ov();
const lm = line(o.pending.lines, bMellos), lr = line(o.pending.lines, bRobin);
ok(Math.abs(n(lm.advance_amount) + n(lr.advance_amount) - 5000 - 2001) < 0.001 && Math.abs(n(lm.advance_amount) - (n(lr.advance_amount) - 5000)) <= 0.01, "Se reparte 50/50 y suma exacto ($1.000,50 + $1.000,50)", o.pending.lines);
ok(Math.abs(n(lm.amount) - (3112.5 - n(lm.advance_amount))) < 0.001, "LOS MELLOS asume su parte del anticipo del pozo", lm);

console.log("3. Liquidar: queda registrado y lo que falta pasa a la siguiente");
const s1 = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, 'Con anticipos') r", [A, Z]);
let d = await one(MADRE, "select public.erp_settlement_detail($1) r", [s1.id]);
ok(n(d.settlement.advances_total) === 7001 && d.advances.length === 2, "La liquidación guarda los 2 anticipos ($7.001)", d.settlement);
ok(d.lines.every((l) => Math.abs(n(l.amount) - (n(l.share_amount) + n(l.carried_amount) - n(l.advance_amount))) < 0.001), "Cada línea: período + saldo traído − anticipo", d.lines);
let L = await list();
ok(L.every((x) => x.settlement && n(x.settlement.number) === n(d.settlement.number)), "En la lista: «descontado en la liquidación #N»", L);
ok(/Ya se descontó/.test((await err(APPROVER, "select public.erp_settlement_advance_void($1, 'error')", [a1.id])) ?? ""), "No se anula un anticipo ya descontado (hay que rechazar o revertir la liquidación)");

console.log("4. Rechazar la liquidación lo devuelve");
await one(APPROVER, "select public.erp_settlement_transition($1, 'reject', 'Revisar') r", [s1.id]);
o = await ov();
ok(n(o.pending.advances_total) === 7001, "Rechazada: los anticipos vuelven a quedar por descontar", o.pending);
L = await list();
ok(L.every((x) => !x.settlement), "Y ya no figuran como descontados", L);

console.log("5. Aprobar y compensar en la siguiente");
const s2 = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);
await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', null) r", [s2.id]);
d = await one(MADRE, "select public.erp_settlement_detail($1) r", [s2.id]);
const robin2 = line(d.lines, bRobin);
ok(n(robin2.amount) < 0, "ROBIN Y JUAN queda en contra en esta liquidación", robin2);
o = await ov();
ok(n(o.pending.advances_total) === 0 && Math.abs(n(line(o.pending.lines, bRobin).carried_amount) - n(robin2.amount)) < 0.001, "En la siguiente no se descuenta otra vez: solo arrastra su saldo en contra", o.pending.lines);
await sale(Z, 20000, 3); // ganancia 15.000 → 7.500 cada uno
o = await ov();
ok(Math.abs(n(line(o.pending.lines, bRobin).amount) - (7500 + n(robin2.amount))) < 0.001, "Con ventas nuevas se le compensa lo que faltó", o.pending.lines);
const mellosBefore = line(d.lines, bMellos);
ok(n(line(o.pending.lines, bMellos).amount) === 7500 + Math.min(0, n(mellosBefore.amount)), "A LOS MELLOS le llega lo suyo", o.pending.lines);

console.log("6. Fecha y anulación");
const a3 = await adv(MADRE, bMellos, 1000, { note: "Registrado por error" });
ok(!!(await one(MADRE, "select public.erp_settlement_advance_void($1, 'Me equivoqué') r", [a3.id])), "Quien lo registró puede anular el suyo mientras no se apruebe");
const a4 = await adv(MADRE, bMellos, 1000, { given: new Date(Date.now() - 3600_000).toISOString(), note: "Hace una hora" });
await decide(APPROVER, a4.id, "approve");
const early = await err(MADRE, "select public.erp__settlement_compute($1, $2, now() - interval '2 hours')", [A, Z]);
ok(!!early, "El cálculo interno no se puede llamar desde la app", early);
const preview = await raw("select public.erp__settlement_compute($1, $2, now() - interval '2 hours') r", [A, Z]);
ok(n(preview[0].r.advances_total) === 0, "Un anticipo entra solo en liquidaciones con corte después de que salió el dinero");
ok(/permiso/.test((await err(SELLER, "select public.erp_settlement_advances_list($1, $2)", [A, Z])) ?? ""), "Un vendedor no ve los anticipos");
const rej = await adv(MADRE, bRobin, 500, { note: "Duplicado" });
ok(/motivo/.test((await err(APPROVER, "select public.erp_settlement_advance_decide($1, 'reject', '')", [rej.id])) ?? ""), "Rechazar pide motivo");
await decide(APPROVER, rej.id, "reject", "Duplicado del #1");
o = await ov();
ok(n(o.pending.advances_total) === 1000, "Los rechazados y anulados nunca se descuentan (solo el de $1.000 aprobado)", o.pending);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
