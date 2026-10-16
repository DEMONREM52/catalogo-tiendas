// Pruebas de 20261122: alertas de cuentas por pagar (reglas, recordatorio propio, «ya lo vi», resumen diario).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_cxp_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261118_compras_desde_punto.sql", "20261122_alertas_cuentas_por_pagar.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const U = (n) => `c6000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), VEND = U(3), CONT = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values
  ($1,$2,'seller','{purchases,payables}',$3,'SARA'), ($1,$4,'seller','{pos}',$3,'VENDEDOR'), ($1,$5,'seller','{payables}',null,'CONTADOR')`, [A, SARA, Z, VEND, CONT]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active, phone) values ($1, 'AURO TECHNOLOGY', true, '3001234567') returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock) values ($1, 'OLLAS', 0) returning id", [A]);

const today = (await raw("select public.erp__bogota_today()::text d"))[0].d;
const plus = (n) => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let k = 0;
// Crea la compra a crédito y luego fija el vencimiento (relativo a hoy).
async function payable(user, wh, dueIn, unit = 1000) {
  await as(user, "select public.erp_receive_invoice($1, $2, $3, current_date, 'credit', current_date + 30, null, 'X', $4::jsonb)",
    [A, SUP, `F-${++k}`, JSON.stringify([{ product_id: P, qty: 10, unit_cost: unit, warehouse_id: wh }])]);
  const [{ id }] = await raw("select a.id from erp_payables a join erp_purchases p on p.id = a.purchase_id where p.invoice_ref = $1", [`F-${k}`]);
  await raw("update erp_payables set due_date = $2::date where id = $1", [id, plus(dueIn)]);
  return id;
}
const board = async (u, only = false) => (await as(u, "select public.erp_payables_board($1, $2) b", [A, only]))[0].b;
const row = (b, id) => b.rows.find((r) => r.id === id);

const in7 = await payable(OWNER, B, 7);
const in5 = await payable(OWNER, B, 5);
const today0 = await payable(OWNER, B, 0);
const late1 = await payable(OWNER, B, -1);
const late2 = await payable(OWNER, B, -2);
const zam3 = await payable(SARA, Z, 3);

console.log("1. Reglas por defecto (7, 3, 1 y el mismo día; vencidas todos los días)");
let b = await board(OWNER);
ok(b.ok && b.rows.length === 6, "El dueño ve las 6 cuentas", b);
ok(row(b, in7).reason === "before" && row(b, in7).days_left === 7, "Vence en 7 días → avisa");
ok(row(b, in5).reason === null, "Vence en 5 días → hoy no avisa");
ok(row(b, today0).reason === "today", "Vence hoy → avisa");
ok(row(b, late1).reason === "overdue" && row(b, late2).reason === "overdue", "Vencidas → avisa cada día");
ok(row(b, in7).supplier_name === "AURO TECHNOLOGY" && row(b, in7).purchase_number != null, "Trae proveedor y número de ingreso");

console.log("2. Reglas de la tienda");
ok(/tienda madre/.test((await err(SARA, "select public.erp_payable_alert_settings_save($1, $2::jsonb)", [A, JSON.stringify({ days_before: [5] })])) ?? ""), "Un usuario de punto no cambia las reglas");
await as(CONT, "select public.erp_payable_alert_settings_save($1, $2::jsonb)", [A, JSON.stringify({ days_before: [5, 5, 0, 200, "x"], overdue_every_days: 2, from_hour: 0, min_amount: 0 })]);
b = await board(OWNER);
ok(JSON.stringify(b.settings.days_before) === "[5,0]", "Días limpios: sin repetidos ni valores raros", b.settings.days_before);
ok(row(b, in5).reason === "before" && row(b, in7).reason === null, "Ahora avisa a los 5 días y no a los 7");
ok(row(b, late1).reason === "overdue" && row(b, late2).reason === null, "Vencidas: cada 2 días (día 1 sí, día 2 no)");
await as(CONT, "select public.erp_payable_alert_settings_save($1, $2::jsonb)", [A, JSON.stringify({ days_before: [7, 3, 1, 0], overdue_every_days: 1, from_hour: 0, min_amount: 50000 })]);
b = await board(OWNER);
ok(row(b, in7).reason === null, "Monto mínimo $50.000: una cuenta de $10.000 no avisa");
await as(CONT, "select public.erp_payable_alert_settings_save($1, $2::jsonb)", [A, JSON.stringify({ days_before: [7, 3, 1, 0], overdue_every_days: 1, from_hour: 0, min_amount: 0 })]);

console.log("3. Recordatorio propio de una cuenta");
await as(OWNER, "select public.erp_payable_reminder_save($1, $2::jsonb)", [in5, JSON.stringify({ remind_on: [today], note: "Pagar con la transferencia del lunes" })]);
b = await board(OWNER);
ok(row(b, in5).reason === "date" && row(b, in5).reminder.note.includes("lunes"), "Fecha exacta: hoy avisa, con su nota");
await as(OWNER, "select public.erp_payable_reminder_save($1, $2::jsonb)", [late1, JSON.stringify({ muted: true })]);
await as(OWNER, "select public.erp_payable_reminder_save($1, $2::jsonb)", [today0, JSON.stringify({ snooze_until: plus(1) })]);
await as(OWNER, "select public.erp_payable_reminder_save($1, $2::jsonb)", [in7, JSON.stringify({ days_before: [6] })]);
b = await board(OWNER);
ok(row(b, late1).reason === null, "Silenciada: no avisa");
ok(row(b, today0).reason === null, "Pospuesta hasta mañana: hoy no avisa");
ok(row(b, in7).reason === null, "Días propios (6): a los 7 no avisa");
await as(OWNER, "select public.erp_payable_reminder_save($1, null)", [late1]);
ok(row(await board(OWNER), late1).reason === "overdue" && row(await board(OWNER), late1).reminder === null, "«Como la tienda» la vuelve a las reglas generales");
ok(/frecuencia/.test((await err(OWNER, "select public.erp_payable_reminder_save($1, $2::jsonb)", [in7, JSON.stringify({ overdue_every_days: 99 })])) ?? ""), "Frecuencia fuera de rango → rechazada");

console.log("4. Punto y permisos");
b = await board(SARA);
ok(b.rows.length === 1 && b.rows[0].id === zam3 && b.can_config === false, "SARA solo ve la de su punto y no configura la tienda", b.rows.map((r) => r.warehouse_name));
ok(/otro punto/.test((await err(SARA, "select public.erp_payable_reminder_save($1, $2::jsonb)", [in7, "{}"])) ?? ""), "No pone recordatorios a cuentas de otro punto");
ok((await board(VEND)).ok === false, "Un vendedor sin el permiso no ve nada");
ok(/permission denied/.test((await err(SARA, "select * from erp_payable_reminders")) ?? ""), "Las tablas nuevas no se leen directo");

console.log("5. «Ya lo vi hoy» y «recuérdame en un rato» son de cada persona");
const alerts = async (u) => (await board(u, true)).rows.map((r) => r.id);
ok((await alerts(OWNER)).includes(in5), "Al dueño le salta el aviso");
await as(OWNER, "select public.erp_payable_alert_ack($1, null)", [in5]);
ok(!(await alerts(OWNER)).includes(in5), "Marcó «ya lo vi»: hoy no le vuelve a salir");
ok((await alerts(CONT)).includes(in5), "…pero al contador sí le sigue saliendo");
await as(CONT, "select public.erp_payable_alert_ack($1, 60)", [in5]);
ok(!(await alerts(CONT)).includes(in5), "«En 1 hora» lo calla por ahora");
await raw("update erp_payable_alert_acks set snooze_until = now() - interval '1 minute' where user_id = $1", [CONT]);
ok((await alerts(CONT)).includes(in5), "…y vuelve cuando pasa la hora");

console.log("6. Resumen diario al celular");
const digest = await raw("select * from public.erp_payable_push_digest()");
const by = (u) => digest.find((d) => d.user_id === u);
ok(by(OWNER) && by(CONT), "Lo reciben el dueño y quien tiene «Cuentas por pagar»");
ok(by(SARA) && by(SARA).n === 1, "SARA recibe solo la de su punto", by(SARA));
ok(!by(VEND), "El vendedor no");
ok(/permission denied/.test((await err(OWNER, "select * from public.erp_payable_push_digest()")) ?? ""), "Solo el servidor puede pedir el resumen");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
