// Pruebas de 20261337: reabrir EXACTAMENTE una liquidación descartada por error, solo si nada suyo se usó después.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_rl_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql",
  "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261208_liquidacion_ganancia_total.sql", "migraciones/20261286_anticipos_liquidacion.sql",
  "migraciones/20261288_gastos_compartidos_liquidacion.sql", "migraciones/20261289_anticipos_al_costo.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(here, "migraciones/20261337_reabrir_liquidacion.sql"), "utf8");
await db.exec(M);
await db.exec(M);

const U = (n) => `f4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

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
await sale(20000, 2);
const adv = await one(MADRE, "select public.erp_settlement_advance_save($1, $2, 'advance', 'pool', null, null, 10000, now() - interval '30 minutes', 'transfer', null, 'Se le entregó a JAVIER', null) r", [A, Z]);
await one(APPROVER, "select public.erp_settlement_advance_decide($1, 'approve', null) r", [adv.id]);

const s1 = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, 'Cierre semanal') r", [A, Z]);
const snap = async (id) => (await raw("select status, pool_total, assigned_total, advances_total, cost_advances_total, sources_count, number from erp_settlements where id = $1", [id]))[0];
const before = await snap(s1.id);
const lines = async (id) => (await raw("select beneficiary_id, amount from erp_settlement_lines where settlement_id = $1 order by beneficiary_id", [id])).map((l) => `${l.beneficiary_id}:${Number(l.amount)}`).join("|");
const linesBefore = await lines(s1.id);
await one(MADRE, "select public.erp_settlement_transition($1, 'discard', 'Por error') r", [s1.id]);
ok((await snap(s1.id)).status === "rejected", "La #1 quedó descartada");

// Mientras tanto hay otra venta: no debe entrar en la #1 reabierta.
await sale(20000, 1);

ok(/Aprobar liquidaciones/.test(await fails(() => one(MADRE, "select public.erp_settlement_reopen($1, 'La descarté por error') r", [s1.id])) ?? ""), "Quien solo prepara no la reabre: necesita «Aprobar liquidaciones»");
ok(/motivo/i.test(await fails(() => one(APPROVER, "select public.erp_settlement_reopen($1, '') r", [s1.id])) ?? ""), "Pide el motivo");
const r = await one(APPROVER, "select public.erp_settlement_reopen($1, 'La descarté por error, ya estaba liquidada') r", [s1.id]);
const after = await snap(s1.id);
ok(r.ok && after.status === "calculated", "Vuelve a «calculada»", after);
ok(Number(after.pool_total) === Number(before.pool_total) && after.sources_count === before.sources_count && Number(after.advances_total) + Number(after.cost_advances_total) === Number(before.advances_total) + Number(before.cost_advances_total),
  "Exactamente igual: mismas ventas, mismo total y mismo anticipo (no se recalculó con la venta nueva)", { before, after });
ok(await lines(s1.id) === linesBefore, "El reparto entre beneficiarios es el mismo");
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'settlement.reopened'"))[0].n === 1, "Queda en auditoría");
ok(/rechazada o descartada/.test(await fails(() => one(APPROVER, "select public.erp_settlement_reopen($1, 'otra vez') r", [s1.id])) ?? ""), "Solo se reabre una rechazada");
const ap = await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', null) r", [s1.id]);
ok(ap.ok && ["approved", "paid"].includes(ap.status), "Se aprueba normal", ap);

// Si después se hizo otra liquidación que tomó lo mismo, no se reabre.
const s2 = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);
await one(APPROVER, "select public.erp_settlement_transition($1, 'reject', 'No sirve') r", [s2.id]);
const s3 = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);
ok(/abierta/.test(await fails(() => one(APPROVER, "select public.erp_settlement_reopen($1, 'por error') r", [s2.id])) ?? ""), "Con otra abierta en el pozo no se reabre");
await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', null) r", [s3.id]);
ok(/Después se hizo la liquidación/.test(await fails(() => one(APPROVER, "select public.erp_settlement_reopen($1, 'por error') r", [s2.id])) ?? ""), "Con una posterior aprobada (que ya tomó esas ventas) no se reabre");
await one(APPROVER, "select public.erp_settlement_transition($1, 'revert', 'Se aprobó mal') r", [s3.id]);
ok((await one(APPROVER, "select public.erp_settlement_reopen($1, 'por error') r", [s2.id])).ok, "Si la posterior se revirtió, sí");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
