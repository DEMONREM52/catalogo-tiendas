// Pruebas de 20261250: nómina electrónica como módulo aparte de la nómina interna.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_nomina_e_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261027_fiscal_multipunto.sql", "20261106_rentabilidad_precios_punto.sql", "20261110_gastos_presupuestos_nomina.sql", "20261250_nomina_electronica.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
const report = (e) => { console.error("FALLA:", e?.message, e?.where ?? "", e?.query ? "\nSQL: " + String(e.query).slice(0, 300) : ""); process.exit(2); };
process.on("unhandledRejection", report);
process.on("uncaughtException", report);
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `e9a00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), NOMINA = U(2), ENOM = U(3), CAJA = U(4);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
async function service(sql, params) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("set role service_role");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims', '', false)"); }
}

for (const id of [OWNER, NOMINA, ENOM, CAJA]) await raw("insert into auth.users (id, email) values ($1, $2)", [id, id.slice(-2) + "@x.co"]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina', 'LA VITRINA', $1) returning id", [OWNER]);
await raw(`insert into store_users (store_id, user_id, role, permissions, username) values
  ($1, $2, 'seller', '{payroll,payroll_approve}', 'nomina'), ($1, $3, 'seller', '{payroll_electronic}', 'enomina'), ($1, $4, 'seller', '{pos}', 'caja')`, [A, NOMINA, ENOM, CAJA]);
ok((await raw("select 'payroll_electronic' = any (public.erp__known_permissions()) r"))[0].r, "Permiso propio «payroll_electronic» registrado");

await one(OWNER, "select public.erp_org_settings_save($1, '{\"fiscal_enabled\": true}'::jsonb, 'Inicio') r", [A]);
const ent = await one(OWNER, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [A, JSON.stringify({
  person_type: "juridica", legal_name: "LA VITRINA SAS", document_type: "NIT", document_number: "900373913", tax_regime: "responsable_iva",
  tax_responsibilities: ["O-13"], economic_activities: ["4755"], fiscal_address: "CALLE 10 # 20-30", city: "Medellín", department: "Antioquia", email: "nomina@vitrina.co", status: "active" })]);
if (!ent.ok) throw new Error("entidad: " + ent.message);
const acc = await one(OWNER, "select public.fiscal_provider_account_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: ent.id, provider: "sandbox", environment: "sandbox", label: "Pruebas" })]);
if (!acc.ok) throw new Error("acc: " + acc.message);

// Nómina interna (aparte): una quincena aprobada de octubre
await one(NOMINA, "select public.erp_finance_setup($1) r", [A]);
const ana = await one(NOMINA, "select public.erp_employee_save($1, null, $2::jsonb) r", [A, JSON.stringify({ full_name: "Ana María Pérez Gómez", document_type: "CC", document: "1017555", base_salary: 2000000, pay_frequency: "biweekly", transport_aid: true, hired_on: "2025-01-01" })]);
const run = await one(NOMINA, "select public.erp_payroll_create($1, null, 'biweekly', '2026-10-01', '2026-10-15', null) r", [A]);
await raw("update erp_payroll_runs set created_by = $1 where id = $2", [OWNER, run.id]);
const tr = await one(NOMINA, "select public.erp_payroll_transition($1, 'approve', null) r", [run.id]);
ok(tr?.ok !== false, "La nómina interna se aprueba como siempre", tr);

console.log("1. Permisos y configuración");
ok((await one(NOMINA, "select public.erp_epayroll_overview($1, '2026-10-01') r", [A])).ok === false, "Quien hace la nómina interna NO entra a la electrónica sin su permiso");
ok((await one(CAJA, "select public.erp_epayroll_overview($1, '2026-10-01') r", [A])).ok === false, "   ni un cajero");
let o = await one(ENOM, "select public.erp_epayroll_overview($1, '2026-10-17') r", [A]);
ok(o.ok && o.period === "2026-10-01" && o.employees.length === 1 && o.settings === null && o.entities.length === 1, "Tablero del mes con los trabajadores y el empleador", o);
ok(!(await one(ENOM, "select public.erp_epayroll_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ city_code: "123" })])).ok, "El municipio va con código DANE de 5 dígitos");

console.log("2. Traer de la nómina interna y preparar");
const pre = await one(ENOM, "select public.erp_epayroll_prefill($1, $2, '2026-10-01') r", [A, ana.id]);
const amt = (code) => Number(pre.items.find((i) => i.code === code)?.amount ?? 0);
ok(pre.ok && amt("SALARIO") === 1000000 && amt("SALUD") === 40000 && Number(pre.days) === 15 && pre.runs.length === 1, "Trae salario, salud y días de la quincena aprobada", pre);
let r = await one(ENOM, "select public.erp_epayroll_doc_save($1, $2, '2026-10-01', $3::jsonb, $4::jsonb) r", [A, ana.id, JSON.stringify({ days: 15, salary: 1000000 }), JSON.stringify({ devengados: 1000000, deducciones: 80000, total: 920000 })]);
ok(r.ok && r.status === "DRAFT", "Guarda el borrador del mes", r);
const DOC = r.id;
ok(!(await one(ENOM, "select public.erp_epayroll_doc_save($1, $2, '2027-01-01', '{}'::jsonb, '{}'::jsonb) r", [A, ana.id])).ok, "No se prepara un mes que no ha empezado");
r = await one(ENOM, "select public.erp_epayroll_queue($1) r", [DOC]);
ok(!r.ok && /empleador/.test(r.message), "Sin configurar el empleador no se envía", r);
ok((await one(ENOM, "select public.erp_epayroll_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ fiscal_entity_id: ent.id, provider_account_id: acc.id, environment: "sandbox", city_code: "05001", address: "CALLE 10 # 20-30", prefix: "ne", next_number: 5 })])).ok, "Configura empleador, Alanube, municipio y consecutivo");
r = await one(ENOM, "select public.erp_epayroll_queue($1) r", [DOC]);
ok(r.ok && r.prefix === "NE" && Number(r.number) === 5 && r.status === "QUEUED", "Queda en cola como NE5", r);
ok((await one(ENOM, "select public.erp_epayroll_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ fiscal_entity_id: ent.id, provider_account_id: acc.id, city_code: "05001", address: "X", next_number: 1 })])).ok, "Guardar otra vez la configuración…");
ok(Number((await raw("select next_number from erp_epayroll_settings where store_id = $1", [A]))[0].next_number) === 6, "   …nunca devuelve el consecutivo (sigue en 6)");
ok(!(await one(ENOM, "select public.erp_epayroll_doc_save($1, $2, '2026-10-01', '{}'::jsonb, '{}'::jsonb) r", [A, ana.id])).ok, "En cola ya no se edita");

console.log("3. Envío (servidor), reemplazo y anulación");
ok((await one(CAJA, "select public.erp_epayroll_can_send($1) r", [DOC])).ok === false, "El cajero no puede transmitirla");
let c = (await service("select public.erp_epayroll__claim($1) r", [DOC]))[0].r;
ok(c.ok && c.doc.number === 5 && c.employer.legal_name === "LA VITRINA SAS" && c.employee.full_name.toUpperCase() === "ANA MARÍA PÉREZ GÓMEZ" && c.account.provider === "sandbox", "El servidor recibe empleador, trabajador y cuenta", { employer: c.employer, name: c.employee?.full_name, acc: c.account });
ok((await service("select public.erp_epayroll__claim($1) r", [DOC]))[0].r.code === "BUSY", "   no se envía dos veces a la vez");
await service("select public.erp_epayroll__record($1, $2::jsonb) r", [DOC, JSON.stringify({ status: "ACCEPTED", cune: "CUNE-1", provider_document_id: "alanube-p1" })]);
ok((await raw("select status, cune from erp_epayroll_docs where id = $1", [DOC]))[0].cune === "CUNE-1", "Queda aceptada con su CUNE");
r = await one(ENOM, "select public.erp_epayroll_adjust($1, 'replace', $2::jsonb, $3::jsonb) r", [DOC, JSON.stringify({ days: 15, salary: 1000000, bonus_ns: 50000 }), JSON.stringify({ devengados: 1050000, deducciones: 80000, total: 970000 })]);
ok(r.ok && r.prefix === "NA" && Number(r.number) === 1, "Reemplazo con su propio consecutivo NA1", r);
ok(!(await one(ENOM, "select public.erp_epayroll_adjust($1, 'cancel', null, null) r", [DOC])).ok, "No hay dos ajustes a la vez");
c = (await service("select public.erp_epayroll__claim($1) r", [r.id]))[0].r;
ok(c.related.provider_document_id === "alanube-p1", "El reemplazo lleva la nómina original");
await service("select public.erp_epayroll__record($1, $2::jsonb) r", [r.id, JSON.stringify({ status: "ACCEPTED", cune: "CUNE-2" })]);
ok((await raw("select status from erp_epayroll_docs where id = $1", [DOC]))[0].status === "REPLACED", "La original queda «reemplazada»");
o = await one(ENOM, "select public.erp_epayroll_overview($1, '2026-10-01') r", [A]);
ok(o.employees[0].docs.length === 2, "El tablero muestra la original y el reemplazo");
const [{ n: internal }] = await raw("select count(*)::int n from erp_payroll_runs where store_id = $1 and status = 'approved'", [A]);
ok(internal === 1, "La nómina interna no se tocó");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
