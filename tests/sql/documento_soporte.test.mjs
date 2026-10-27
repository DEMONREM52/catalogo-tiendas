// Pruebas de 20261249: documento soporte electrónico desde una compra y su nota de ajuste (sobre 20261027 + 20261243).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Piezas de 20261115 (forma de pago) y 20261128 (caja) que usa la venta sin conexión.
const extra = `
alter table public.erp_order_meta add column if not exists payment jsonb;
alter table public.erp_purchase_items add column if not exists line_no integer;
create table if not exists public.erp_cash_sessions (id uuid primary key default gen_random_uuid(), store_id uuid not null, point_id uuid not null,
  number bigint not null, status text not null default 'open', opened_at timestamptz not null default now(), closed_at timestamptz);
`;
const combined = path.join(os.tmpdir(), `remhub_soporte_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261027_fiscal_multipunto.sql", "20261106_rentabilidad_precios_punto.sql", "20261108_catalogo_punto_y_borradores.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
  extra,
  fs.readFileSync(path.join(MIG, "20261243_trabajar_sin_conexion.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261249_documento_soporte.sql"), "utf8"),
].join("\n"));
const report = (e) => { console.error("FALLA:", e?.message, e?.where ?? "", e?.query ? "\nSQL: " + String(e.query).slice(0, 300) : ""); process.exit(2); };
process.on("unhandledRejection", report);
process.on("uncaughtException", report);
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `f1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CAJA = U(2), CAJA2 = U(3), CONTA = U(4), NOPOS = U(5);
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

// ---------------------------------------------------------------- tienda, puntos y facturación electrónica
for (const id of [OWNER, CAJA, CAJA2, CONTA, NOPOS]) await raw("insert into auth.users (id, email) values ($1, $2)", [id, id.slice(-2) + "@x.co"]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina', 'LA VITRINA', $1) returning id", [OWNER]);
const point = async (name, code) => {
  const r = await one(OWNER, "select public.erp_point_save($1, $2::jsonb, 'prueba') r", [A, JSON.stringify({ name, code, address: "CALLE 1", city: "MEDELLIN", responsible_name: "RESP" })]);
  if (!r.ok) throw new Error("punto " + name + ": " + r.message);
  return r.id;
};
const P1 = await point("Punto Centro", "CEN"), P2 = await point("Punto Sin Fiscal", "SNF"), P3 = await point("Punto Norte", "NOR");
await raw(`insert into store_users (store_id, user_id, role, permissions, username, display_name, point_id) values
  ($1, $2, 'seller', '{pos}', 'caja', 'CAJA CENTRO', $6),
  ($1, $3, 'seller', '{pos}', 'caja2', 'CAJA DOS', $7),
  ($1, $4, 'accounting', '{fiscal,fiscal_config,fiscal_send,fiscal_numbering}', 'conta', 'CONTADORA', null),
  ($1, $5, 'seller', '{orders}', 'nopos', 'SIN POS', $6)`, [A, CAJA, CAJA2, CONTA, NOPOS, P1, P2]);
await one(OWNER, "select public.erp_org_settings_save($1, '{\"fiscal_enabled\": true}'::jsonb, 'Inicio') r", [A]);
const ent = await one(OWNER, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [A, JSON.stringify({
  person_type: "juridica", legal_name: "LA VITRINA SAS", document_type: "NIT", document_number: "900373913", tax_regime: "responsable_iva",
  tax_responsibilities: ["O-13"], economic_activities: ["4755"], fiscal_address: "CALLE 10 # 20-30", city: "Medellín", department: "Antioquia",
  email: "fiscal@vitrina.co", status: "active" })]);
if (!ent.ok) throw new Error("entidad: " + ent.message);
const E = ent.id;
const acc = await one(OWNER, "select public.fiscal_provider_account_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: E, provider: "sandbox", environment: "sandbox", label: "Pruebas" })]);
if (!acc.ok) throw new Error("acc: " + acc.message);
await service("select public.fiscal__provider_set_hints($1, '{\"webhook_secret\": \"••••abcd\"}'::jsonb)", [acc.id]);
await service("select public.fiscal__provider_test_result($1, true, 'Conexión OK', '{}'::jsonb)", [acc.id]);
const est = await one(OWNER, "select public.fiscal_establishment_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: E, point_id: P1, name: "Sede CEN", code: "CEN", address: "CRA 1", city: "MEDELLIN", department: "ANTIOQUIA" })]);
const cfg = await one(OWNER, "select public.fiscal_point_config_save($1, $2::jsonb, null, false) r", [P1, JSON.stringify({ fiscal_entity_id: E, establishment_id: est.id, provider_account_id: acc.id, environment: "sandbox", enabled: true })]);
if (!cfg.ok) throw new Error("cfg: " + cfg.message);
const range = async (type, pre, extra = {}) => {
  const r = await one(OWNER, "select public.fiscal_range_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: E, document_type: type, environment: "sandbox", prefix: pre, range_from: 1, range_to: 100, point_ids: [P1], status: "active", ...extra })]);
  if (!r.ok) throw new Error("rango " + type + ": " + r.message);
};
await raw("update store_users set permissions = '{fiscal,fiscal_config,fiscal_send,fiscal_numbering,fiscal_notes,purchases}' where user_id = $1", [CONTA]);

// Compra a un proveedor persona natural (no obligado a facturar)
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, nit) values ($1, 'JUAN CAMPESINO', '71.234.567') returning id", [A]);
const [{ id: PRD }] = await raw("insert into products (store_id, name, sku) values ($1, 'HUEVOS AA', 'HUE') returning id", [A]);
const [{ id: PRD2 }] = await raw("insert into products (store_id, name, sku) values ($1, 'QUESO', 'QUE') returning id", [A]);
const [{ id: PU }] = await raw("insert into erp_purchases (store_id, number, supplier_id, warehouse_id, status, payment_type, due_date) values ($1, 7, $2, $3, 'received', 'credit', '2026-12-01') returning id", [A, SUP, B]);
await raw("insert into erp_purchase_items (purchase_id, product_id, qty, unit_cost, tax_rate) values ($1, $2, 30, 12000, 0), ($1, $3, 4, 20000, 19)", [PU, PRD, PRD2]);
const supplier = { name: "Juan Campesino", document_type: "CC", document_number: "71234567", address: "VEREDA EL TABLAZO", city_code: "05615", postal_code: "054040", phone: "3001112233" };
const issue = (u, sup = supplier, key = "ds-1", pt = P1) => one(u, "select public.fiscal_issue_support_document($1, $2, $3, $4::jsonb, 'Compra de cosecha', $5) r", [A, PU, pt, JSON.stringify(sup), key]);

console.log("1. Preparar y emitir");
let r = await one(CONTA, "select public.fiscal_support_prepare($1, $2) r", [A, PU]);
ok(r.ok && r.points.length === 1 && r.points[0].has_range === false && r.supplier.nit === "71.234.567", "La ventana trae el punto listo (sin numeración todavía) y el proveedor", r);
ok((await one(CAJA, "select public.fiscal_support_prepare($1, $2) r", [A, PU])).ok === false, "Un cajero no la abre");
r = await issue(CONTA);
ok(!r.ok && /numeración/i.test(r.message), "Sin numeración de documento soporte no se emite", r);
await range("support_document", "DS", { resolution_number: "18764000001", resolution_date: "2026-01-01", valid_from: "2026-01-01", valid_until: "2027-12-31" });
ok((await one(CONTA, "select public.fiscal_support_prepare($1, $2) r", [A, PU])).points[0].has_range === true, "   con la numeración ya aparece listo");
ok(!(await issue(CONTA, { ...supplier, city_code: "" })).ok, "Pide el código DANE del municipio");
ok(!(await issue(CONTA, { ...supplier, postal_code: "12" })).ok, "Pide el código postal");
r = await issue(CONTA, { ...supplier, document_number: "80000000" });
ok(!r.ok && /no coincide/.test(r.message), "No deja emitirlo a nombre de otra persona", r);
ok(!(await issue(CAJA)).ok, "Sin permiso de emitir no");
r = await issue(CONTA);
ok(r.ok && r.full_number === "DS1" && r.status === "QUEUED", "Emite el documento soporte DS1", r);
const DOC = r.document_id;
const [d] = await raw("select * from fiscal_documents where id = $1", [DOC]);
ok(d.document_type === "support_document" && d.source_type === "purchase" && d.payment_form === "credit", "Queda ligado a la compra, a crédito", d);
ok(Number(d.subtotal) === 440000 && Number(d.tax_total) === 15200 && Number(d.total) === 455200, "Costos sin IVA: 30 × 12.000 + 4 × 20.000 + IVA 19 % del queso", [d.subtotal, d.tax_total, d.total]);
ok(d.customer.document_number === "71234567" && d.customer.city === "05615" && d.customer.verification_digit && d.customer.origin === "10", "El proveedor va con su municipio DANE y DV", d.customer);
ok((await issue(CONTA, supplier, "ds-otra")).reused === true, "Una compra tiene un solo documento soporte vigente");
ok((await raw("select data->>'postal_code' pc from erp_supplier_fiscal where supplier_id = $1", [SUP]))[0].pc === "054040", "Se recuerdan los datos del proveedor");
r = await one(CONTA, "select public.fiscal_support_prepare($1, $2) r", [A, PU]);
ok(r.documents.length === 1 && r.saved.city === "05615", "La ventana muestra el documento emitido", r.documents);

console.log("2. Envío (lo toma el servidor) y nota de ajuste");
const claim = (await service("select public.fiscal__claim($1) r", [DOC]))[0].r;
ok(claim.ok && claim.document.document_type === "support_document" && claim.document.customer.name === "JUAN CAMPESINO", "El servidor lo reserva con los datos del proveedor", claim);
r = (await service("select public.fiscal__record_result($1, $2::jsonb) r", [DOC, JSON.stringify({ status: "ACCEPTED", cufe: "cuds-123", provider_document_id: "alanube-1", transmitted: true })]))[0].r;
ok(r.ok, "Queda aceptado", r);
r = await one(CONTA, "select public.fiscal_create_support_adjustment($1, '1', 'Devolvió 5 cubetas', $2::jsonb, 'aj-1') r", [DOC, JSON.stringify([{ line_no: 1, qty: 5 }])]);
ok(!r.ok && /numeración/i.test(r.message), "La nota necesita su propia numeración", r);
await range("support_adjustment", "NADS");
r = await one(CONTA, "select public.fiscal_create_support_adjustment($1, '1', 'Devolvió 5 cubetas', $2::jsonb, 'aj-1') r", [DOC, JSON.stringify([{ line_no: 1, qty: 5 }])]);
ok(r.ok && r.full_number === "NADS1" && Number(r.total) === 60000, "Nota de ajuste por 5 unidades ($60.000)", r);
r = await one(CONTA, "select public.fiscal_create_support_adjustment($1, '1', 'Otra devolución', $2::jsonb, 'aj-2') r", [DOC, JSON.stringify([{ line_no: 1, qty: 26 }])]);
ok(!r.ok && /25/.test(r.message), "No deja ajustar más de lo que queda", r);
ok(!(await one(CAJA, "select public.fiscal_create_support_adjustment($1, '1', 'xxxxxx', null, 'aj-3') r", [DOC])).ok, "Sin permiso de notas no");
ok(!(await one(CONTA, "select public.fiscal_create_support_adjustment($1, '9', 'xxxxxx', null, 'aj-4') r", [DOC])).ok, "Concepto inválido no");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
