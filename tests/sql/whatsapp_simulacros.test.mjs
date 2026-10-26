// Pruebas de 20261244: avisos por WhatsApp del plazo de contingencia y simulacro mensual sin internet.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
alter table public.erp_order_meta add column if not exists payment jsonb;
create table if not exists public.erp_cash_sessions (id uuid primary key default gen_random_uuid(), store_id uuid not null, point_id uuid not null,
  number bigint not null, status text not null default 'open', opened_at timestamptz not null default now(), closed_at timestamptz);
`;
const combined = path.join(os.tmpdir(), `remhub_wa_drills_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261027_fiscal_multipunto.sql", "20261106_rentabilidad_precios_punto.sql", "20261108_catalogo_punto_y_borradores.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
  extra,
  ...["20261243_trabajar_sin_conexion.sql", "20261244_whatsapp_y_simulacros.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
const report = (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); };
process.on("unhandledRejection", report);
process.on("uncaughtException", report);
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `f2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CAJA = U(2), CAJA2 = U(3), CONTA = U(4), ADMIN = U(5);
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
async function service(sql, params) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("set role service_role");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims', '', false)"); }
}

// ---------------------------------------------------------------- tienda con un punto electrónico
for (const id of [OWNER, CAJA, CAJA2, CONTA, ADMIN]) await raw("insert into auth.users (id, email) values ($1, $2)", [id, id.slice(-2) + "@x.co"]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina', 'LA VITRINA', $1) returning id", [OWNER]);
const pt = await one(OWNER, "select public.erp_point_save($1, $2::jsonb, 'prueba') r", [A, JSON.stringify({ name: "Punto Centro", code: "CEN", address: "CALLE 1", city: "MEDELLIN", responsible_name: "RESP" })]);
const P1 = pt.id;
await raw(`insert into store_users (store_id, user_id, role, permissions, username, display_name, point_id) values
  ($1, $2, 'seller', '{pos}', 'caja', 'CAJA UNO', $6),
  ($1, $3, 'seller', '{pos}', 'caja2', 'CAJA DOS', $6),
  ($1, $4, 'accounting', '{fiscal,fiscal_config,fiscal_send,fiscal_numbering}', 'conta', 'CONTADORA', null),
  ($1, $5, 'store_admin', '{}', 'admin', 'ADMIN', null)`, [A, CAJA, CAJA2, CONTA, ADMIN, P1]);
await one(OWNER, "select public.erp_org_settings_save($1, '{\"fiscal_enabled\": true}'::jsonb, 'Inicio') r", [A]);
const ent = await one(OWNER, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [A, JSON.stringify({
  person_type: "juridica", legal_name: "LA VITRINA SAS", document_type: "NIT", document_number: "900373913", tax_regime: "responsable_iva",
  tax_responsibilities: ["O-13"], economic_activities: ["4755"], fiscal_address: "CALLE 10", city: "Medellín", department: "Antioquia", email: "f@v.co", status: "active" })]);
const acc = await one(OWNER, "select public.fiscal_provider_account_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: ent.id, provider: "sandbox", environment: "sandbox", label: "Pruebas" })]);
await service("select public.fiscal__provider_set_hints($1, '{\"webhook_secret\": \"••••abcd\"}'::jsonb)", [acc.id]);
await service("select public.fiscal__provider_test_result($1, true, 'OK', '{}'::jsonb)", [acc.id]);
const est = await one(OWNER, "select public.fiscal_establishment_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: ent.id, point_id: P1, name: "Sede", code: "S1", address: "CRA 1", city: "MEDELLIN", department: "ANTIOQUIA" })]);
await one(OWNER, "select public.fiscal_point_config_save($1, $2::jsonb, null, false) r", [P1, JSON.stringify({ fiscal_entity_id: ent.id, establishment_id: est.id, provider_account_id: acc.id, environment: "sandbox", enabled: true })]);
for (const [type, prefix] of [["invoice", "FE"], ["contingency_invoice", "CONT"]]) {
  const r = await one(OWNER, "select public.fiscal_range_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: ent.id, document_type: type, environment: "sandbox", resolution_number: "18760001", resolution_date: "2026-01-01", valid_from: "2026-01-01", valid_until: "2027-12-31", prefix, range_from: 1, range_to: 100, point_ids: [P1], status: "active" })]);
  if (!r.ok) throw new Error(r.message);
}
const [{ id: PROD }] = await raw("insert into products (store_id, name, tax_rate, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'LICUADORA', 19, 119000, 119000, 119000, 119000, 119000, 50) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [P1, PROD, A]);

console.log("1. Configurar WhatsApp");
ok(!(await one(CAJA, "select public.erp_whatsapp_settings_get($1) r", [A])).ok, "Un cajero no ve ni cambia los avisos");
let s = await one(OWNER, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, provider: "remhub", numbers: ["300 123 4567", "+57 310-000-0000"] })]);
ok(s.ok && s.enabled && s.numbers.map((n) => n.number).join() === "573001234567,573100000000", "El dueño guarda 2 celulares (se normalizan con el 57)", s);
s = await one(OWNER, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, numbers: ["123"] })]);
ok(!s.ok && /no es un celular/.test(s.message), "Un número inválido no se guarda", s);
s = await one(OWNER, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, numbers: ["3001111111", "3002222222", "3003333333", "3004444444"] })]);
ok(!s.ok && /Máximo 3/.test(s.message), "Máximo 3 números", s);
s = await one(OWNER, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, provider: "callmebot", numbers: ["3001234567"] })]);
ok(!s.ok && /clave/.test(s.message), "Con CallMeBot cada número necesita su clave", s);
s = await one(CONTA, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, provider: "callmebot", numbers: ["3001234567"], keys: { "573001234567": "kQ9x7Wz2" } })]);
ok(s.ok && s.provider === "callmebot" && s.numbers[0].has_key === true, "La contadora (facturación) lo deja con CallMeBot y su clave", s);
ok(!JSON.stringify(s).includes("kQ9x7Wz2"), "   La clave nunca vuelve al navegador");
ok(/permission denied/i.test((await err(OWNER, "select * from public.erp_whatsapp_keys")) ?? ""), "   ni se puede leer la tabla de claves");

console.log("2. ¿A quién avisar y cuándo? (plazo de 48 horas)");
ok(/permission denied/i.test((await err(OWNER, "select * from public.erp_contingency_watch()")) ?? ""), "Solo el servidor consulta los avisos pendientes");
ok((await service("select * from public.erp_contingency_watch()")).length === 0, "Sin facturas de contingencia: nadie que avisar");
const res = await one(CAJA, "select public.fiscal_offline_reserve($1, $2, 10) r", [P1, "equipo-caja-uno-0001"]);
const sub = await one(CAJA, "select public.erp_pos_submit_offline_v2($1, $2::jsonb) r", [A, JSON.stringify({
  id: "e3000000-0000-0000-0000-000000000001", point_id: P1, kind: "contingencia", device_id: "equipo-caja-uno-0001", created_at: new Date(Date.now() - 3600_000).toISOString(),
  total: 119000, items: [{ product_id: PROD, qty: 1, price: 119000, level: 3 }], customer: { name: "CONSUMIDOR FINAL" },
  payment: { method: "efectivo", parts: [{ method: "efectivo", amount: 119000 }], received: 119000, change: 0 },
  fiscal: { block_id: res.blocks[0].id, number: 1, full_number: "CONT1" } })]);
ok(sub.ok && sub.doc_number === "CONT1", "Una factura de contingencia registrada", sub);
ok((await service("select * from public.erp_contingency_watch()")).length === 0, "   Recién registrada (faltan 48 h): aún no se avisa");
const stageAt = async (hours) => {
  await raw("update fiscal_documents set created_at = now() - make_interval(hours => $1) where full_number = 'CONT1'", [hours]);
  return (await service("select * from public.erp_contingency_watch()"))[0];
};
let w = await stageAt(30);
ok(w?.stage === "h24" && w.docs === 1 && Number(w.hours_left) > 17 && Number(w.hours_left) < 19, "Quedan 18 h: aviso de 24 horas", w);
ok(w.recipients.includes(OWNER) && w.recipients.includes(CONTA) && w.recipients.includes(ADMIN) && !w.recipients.includes(CAJA), "   Se avisa al dueño, al administrador y a la contadora (no a los cajeros)", w.recipients);
w = await stageAt(44);
ok(w?.stage === "h6", "Quedan 4 h: aviso urgente", w);
w = await stageAt(49);
ok(w?.stage === "overdue" && Number(w.hours_left) < 0, "Pasó el plazo: vencida", w);
await raw("insert into erp_pos_offline_issues (client_id, store_id, point_id, kind, total, code, message, first_at) values ('e3000000-0000-0000-0000-000000000009', $1, $2, 'contingencia', 5000, 'OUT_OF_STOCK', 'x', now() - interval '50 hours')", [A, P1]);
w = (await service("select * from public.erp_contingency_watch()"))[0];
ok(w.docs === 1 && w.issues === 1 && w.first_id === "e3000000-0000-0000-0000-000000000009", "También cuentan las facturas en papel que no se han podido registrar (la más vieja manda)", w);

console.log("3. Simulacro del mes");
let st = await one(CAJA, "select public.erp_drill_status($1) r", [A]);
ok(st.ok && st.enabled && st.must && st.mine === null && !st.manager, "El cajero lo tiene pendiente", st);
ok((await one(OWNER, "select public.erp_drill_status($1) r", [A])).must === false, "El dueño no está obligado (pero puede hacerlo)");
let alerts = await one(CAJA, "select public.erp_offline_alerts($1) r", [A]);
ok(alerts.some((a) => a.key.startsWith("drill-mine-")), "La campana del cajero le recuerda el simulacro", alerts.map((a) => a.key));
ok(!(await one(CAJA, "select public.erp_drill_complete($1, '{\"sale\": true}'::jsonb, 60) r", [A])).ok, "No se completa sin empezar");
ok((await one(CAJA, "select public.erp_drill_start($1, $2) r", [A, P1])).ok, "Empieza el simulacro");
ok(!(await one(CAJA, "select public.erp_drill_complete($1, '{\"sale\": false}'::jsonb, 60) r", [A])).ok, "Sin la venta de práctica no queda hecho");
const done = await one(CAJA, "select public.erp_drill_complete($1, $2::jsonb, 95) r", [A, JSON.stringify({ sale: true, contingency: true, print: "skip", ended: true })]);
ok(done.ok, "Con la venta de práctica queda hecho", done);
st = await one(CAJA, "select public.erp_drill_status($1) r", [A]);
ok(st.mine?.completed_at && st.mine.seconds === 95 && st.mine.steps.contingency === true, "   Queda registrado con sus pasos y su tiempo", st.mine);
alerts = await one(CAJA, "select public.erp_offline_alerts($1) r", [A]);
ok(!alerts.some((a) => a.key.startsWith("drill-mine-")), "   y la campana deja de recordarlo");
const team = (await one(OWNER, "select public.erp_drill_status($1) r", [A])).team;
ok(team.length === 2 && team.find((t) => t.user_id === CAJA)?.completed_at && !team.find((t) => t.user_id === CAJA2)?.completed_at, "El dueño ve quién lo hizo y quién no", team);
ok(!(await one(CAJA, "select public.erp_drill_settings_save($1, true, 5, true) r", [A])).ok, "Un cajero no cambia la configuración");
ok((await one(ADMIN, "select public.erp_drill_settings_save($1, true, 15, false) r", [A])).ok, "El administrador cambia el día límite");
ok(!(await one(ADMIN, "select public.erp_drill_settings_save($1, true, 30, false) r", [A])).ok, "   (del 1 al 28)");

console.log("4. Recordatorios al celular");
const today = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", day: "numeric" }).format(new Date()));
ok(/permission denied/i.test((await err(OWNER, "select * from public.erp_drill_digest()")) ?? ""), "Solo el servidor arma los recordatorios");
if (today >= 1 && today <= 28) {
  await raw("update erp_drill_settings set due_day = $1 where store_id = $2", [today, A]);
  const due = await service("select * from public.erp_drill_digest()");
  ok(due.length === 1 && due[0].user_id === CAJA2 && due[0].kind === (today === 1 ? "start" : "due") && due[0].pending === 1, "El día límite: recordatorio solo a quien le falta", due);
}
if (today >= 2 && today <= 29) {
  await raw("update erp_drill_settings set due_day = $1 where store_id = $2", [today - 1, A]);
  const mgr = await service("select * from public.erp_drill_digest()");
  ok(mgr.length === 2 && mgr.every((m) => m.kind === "manager" && m.pending === 1 && m.total === 2) && mgr.some((m) => m.user_id === OWNER), "Al día siguiente: resumen al dueño y al administrador", mgr);
  alerts = await one(OWNER, "select public.erp_offline_alerts($1) r", [A]);
  ok(alerts.some((a) => a.key.startsWith("drill-team-") && /1 de 2/.test(a.title)), "   y su campana muestra «1 de 2 lo hicieron»", alerts.map((a) => a.title));
}
await raw("update erp_drill_settings set enabled = false where store_id = $1", [A]);
ok((await service("select * from public.erp_drill_digest()")).length === 0, "Apagado: no hay recordatorios");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
