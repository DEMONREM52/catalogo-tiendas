// Pruebas de 20261245: bandeja «Avisos del día» (cartera por vencer) y qué avisos automáticos quiere cada tienda.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
alter table public.erp_order_meta add column if not exists payment jsonb;
alter table public.erp_receivables add column if not exists doc_number text;
alter table public.erp_receivables add column if not exists description text;
alter table public.erp_receivables add column if not exists due_date date;
`;
const combined = path.join(os.tmpdir(), `remhub_bandeja_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261027_fiscal_multipunto.sql", "20261106_rentabilidad_precios_punto.sql", "20261108_catalogo_punto_y_borradores.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
  extra,
  ...["20261243_trabajar_sin_conexion.sql", "20261244_whatsapp_y_simulacros.sql", "20261245_bandeja_avisos.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `f3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CARTERA = U(2), CAJA = U(3), OTRO = U(4);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina', 'LA VITRINA', $1) returning id", [OWNER]);
const [{ id: P1 }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'CEN', 'CENTRO', true, 'point') returning id", [A]);
const [{ id: P2 }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'NOR', 'NORTE', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, username, point_id) values
  ($1, $2, 'seller', '{receivables}', 'cartera', null), ($1, $3, 'seller', '{pos}', 'caja', $5), ($1, $4, 'seller', '{receivables}', 'otro', $6)`, [A, CARTERA, CAJA, OTRO, P1, P2]);
const cust = async (name, mobile) => (await raw("insert into billing_customers (store_id, name, mobile) values ($1, $2, $3) returning id", [A, name, mobile]))[0].id;
const ANA = await cust("ANA PÉREZ", "300 123 4567"), LUIS = await cust("LUIS", null);
const rec = async (customer, point, days, balance, status = "open") => (await raw(
  "insert into erp_receivables (store_id, customer_id, point_id, total, balance, status, doc_number, due_date) values ($1, $2, $3, $4, $4, $5, 'REM-' || floor(random()*1000), ((now() at time zone 'America/Bogota')::date + $6::integer)) returning id",
  [A, customer, point, balance, status, days]))[0].id;
const R_SOON = await rec(ANA, P1, 2, 150000), R_LATE = await rec(LUIS, P1, -5, 80000), R_FAR = await rec(ANA, P1, 20, 50000);
await rec(ANA, P1, 1, 90000, "void");
const R_N = await rec(ANA, P2, 1, 30000);

console.log("1. Bandeja de avisos del día");
ok(!(await one(CAJA, "select public.erp_notice_tray($1) r", [A])).ok, "Sin permiso de cartera no se ve");
let t = await one(CARTERA, "select public.erp_notice_tray($1) r", [A]);
const ids = t.items.map((i) => i.id);
ok(t.ok && ids.includes(R_SOON) && ids.includes(R_LATE) && ids.includes(R_N) && !ids.includes(R_FAR) && ids.length === 3, "Trae lo que vence en 3 días y lo vencido (no lo lejano ni lo anulado)", t.items);
ok(t.items[0].id === R_LATE && t.items[0].days_left === -5, "Lo más vencido va primero", t.items[0]);
ok(t.items.find((i) => i.id === R_SOON).phone === "300 123 4567" && t.items.find((i) => i.id === R_LATE).phone === null, "Con el celular del cliente (o sin él, para avisar)");
ok(/\{cliente\}/.test(t.template_due) && /\{dias\}/.test(t.template_overdue), "Plantillas por defecto con los datos a reemplazar");
ok((await one(OTRO, "select public.erp_notice_tray($1) r", [A])).items.every((i) => i.id === R_N), "Un usuario de punto ve solo su punto");
ok((await one(CARTERA, "select public.erp_notice_mark_sent($1, $2, '3001234567') r", [A, R_SOON])).ok, "Marca como enviado");
await one(CARTERA, "select public.erp_notice_mark_sent($1, $2, '3001234567') r", [A, R_SOON]);
ok((await raw("select count(*)::int n from erp_notice_sends where ref_id = $1", [R_SOON]))[0].n === 1, "   (una vez por día)");
t = await one(CARTERA, "select public.erp_notice_tray($1) r", [A]);
ok(t.items.find((i) => i.id === R_SOON).sent_today === true, "   y la bandeja lo muestra enviado hoy");
ok(!(await one(OTRO, "select public.erp_notice_mark_sent($1, $2, '1') r", [A, R_SOON])).ok, "No se marca una cuenta de otro punto");
ok((await one(CARTERA, "select public.erp_notice_settings_save($1, 25, false, 'Hola {cliente}', null) r", [A])).ok, "Se cambian los días y la plantilla");
t = await one(CARTERA, "select public.erp_notice_tray($1) r", [A]);
ok(t.items.some((i) => i.id === R_FAR) && !t.items.some((i) => i.id === R_LATE) && t.template_due === "Hola {cliente}", "   25 días, sin vencidas y con su texto", t.items.map((i) => i.days_left));
ok(!(await one(CARTERA, "select public.erp_notice_settings_save($1, 40, true, null, null) r", [A])).ok, "   (máximo 30 días)");

console.log("2. Qué avisos automáticos quiere la tienda");
let s = await one(OWNER, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, provider: "remhub", numbers: ["3001234567"], events: ["payables", "daily_close", "otro"] })]);
ok(s.ok && s.events.sort().join() === "daily_close,payables", "Guarda los avisos elegidos (ignora los que no existen)", s.events);
s = await one(OWNER, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, provider: "remhub", numbers: ["3001234567"] })]);
ok(s.ok && s.events.sort().join() === "daily_close,payables", "Si no se mandan, se conservan", s.events);
s = await one(OWNER, "select public.erp_whatsapp_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, numbers: ["3001234567"], events: [] })]);
ok(!s.ok && /al menos un aviso/.test(s.message), "Activado sin ningún aviso: no", s);

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
