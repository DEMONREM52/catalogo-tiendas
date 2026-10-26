// Pruebas de 20261243: ventas sin conexión registradas tal como se cobraron y facturas de contingencia
// con números separados por equipo (sobre 20261027 fiscal + 20261106/20261108 borradores).
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
create table if not exists public.erp_cash_sessions (id uuid primary key default gen_random_uuid(), store_id uuid not null, point_id uuid not null,
  number bigint not null, status text not null default 'open', opened_at timestamptz not null default now(), closed_at timestamptz);
`;
const combined = path.join(os.tmpdir(), `remhub_sin_conexion_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261027_fiscal_multipunto.sql", "20261106_rentabilidad_precios_punto.sql", "20261108_catalogo_punto_y_borradores.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
  extra,
  fs.readFileSync(path.join(MIG, "20261243_trabajar_sin_conexion.sql"), "utf8"),
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
const fiscalPoint = async (pt, prefix, contingency) => {
  const est = await one(OWNER, "select public.fiscal_establishment_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: E, point_id: pt, name: "Sede " + prefix, code: prefix, address: "CRA 1", city: "MEDELLIN", department: "ANTIOQUIA" })]);
  if (!est.ok) throw new Error("est: " + est.message);
  const cfg = await one(OWNER, "select public.fiscal_point_config_save($1, $2::jsonb, null, false) r", [pt, JSON.stringify({ fiscal_entity_id: E, establishment_id: est.id, provider_account_id: acc.id, environment: "sandbox", enabled: true })]);
  if (!cfg.ok) throw new Error("cfg: " + cfg.message);
  const range = async (type, pre, from, to) => {
    const r = await one(OWNER, "select public.fiscal_range_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: E, document_type: type, environment: "sandbox", resolution_number: "1876000" + pre.length, resolution_date: "2026-01-01", valid_from: "2026-01-01", valid_until: "2027-12-31", prefix: pre, range_from: from, range_to: to, point_ids: [pt], status: "active" })]);
    if (!r.ok) throw new Error("rango " + pre + ": " + r.message);
    return r.id;
  };
  await range("invoice", prefix, 1, 100);
  return contingency ? range("contingency_invoice", contingency, 1, 30) : null;
};
const R_CONT = await fiscalPoint(P1, "FE", "CONT");
await fiscalPoint(P3, "FN", null);

const prod = async (name, price, stock, tax = 19) => {
  const [{ id }] = await raw("insert into products (store_id, name, sku, tax_rate, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, $2, $3, $4, 50000, $5, $5, $5, $5, $5, $6) returning id", [A, name, name.slice(0, 3), tax, price, stock]);
  for (const w of [P1, P2, P3]) await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, $4)", [w, id, A, stock]);
  return id;
};
const LIC = await prod("LICUADORA", 119000, 50);
const POCO = await prod("ULTIMA UNIDAD", 30000, 1, 0);

const DEV_A = "equipo-aaaa-1111-centro", DEV_B = "equipo-bbbb-2222-centro";
const draft = (n, over = {}) => ({
  id: `e2000000-0000-0000-0000-${String(n).padStart(12, "0")}`, point_id: P1, kind: "contingencia", device_id: DEV_A,
  created_at: new Date(Date.now() - 3 * 3600_000).toISOString(), total: 238000,
  items: [{ product_id: LIC, qty: 2, price: 119000, level: 3 }],
  customer: { name: "CONSUMIDOR FINAL", doc: "", note: "", whatsapp: "" },
  payment: { method: "efectivo", parts: [{ method: "efectivo", amount: 238000 }], received: 250000, change: 12000 },
  ...over,
});
const submit = (u, d) => one(u, "select public.erp_pos_submit_offline_v2($1, $2::jsonb) r", [A, JSON.stringify(d)]);

console.log("1. Separar números de contingencia por equipo");
const resA = await one(CAJA, "select public.fiscal_offline_reserve($1, $2, 10) r", [P1, DEV_A]);
ok(resA.ok && resA.enabled && resA.blocks.length === 1 && resA.blocks[0].free.length === 10 && resA.blocks[0].free[0] === 1,
  "El equipo A separa CONT1 a CONT10", resA);
ok(resA.issuer?.legal_name === "LA VITRINA SAS" && resA.blocks[0].resolution_number && resA.final_consumer?.doc === "222222222222",
  "   …con lo necesario para imprimir sin conexión (emisor, resolución, consumidor final)", resA.issuer);
const resA2 = await one(CAJA, "select public.fiscal_offline_reserve($1, $2, 10) r", [P1, DEV_A]);
ok(resA2.blocks.length === 1 && resA2.blocks[0].id === resA.blocks[0].id, "Pedir otra vez no separa más (aún tiene números)", resA2.blocks);
const resB = await one(CAJA, "select public.fiscal_offline_reserve($1, $2, 10) r", [P1, DEV_B]);
ok(resB.blocks[0].free[0] === 11 && resB.blocks[0].free.length === 10, "Otro equipo recibe CONT11 a CONT20 (nunca se repiten)", resB.blocks);
ok(Number((await raw("select next_number from fiscal_numbering_ranges where id = $1", [R_CONT]))[0].next_number) === 21, "La numeración sigue en el 21");
ok((await one(CAJA2, "select public.fiscal_offline_reserve($1, $2, 10) r", [P2, DEV_A])).enabled === false, "Punto sin facturación electrónica: no aplica");
ok((await one(CAJA, "select public.fiscal_offline_reserve($1, $2, 10) r", [P2, DEV_A])).code === "FORBIDDEN", "No se separan números de otro punto");
ok((await one(CAJA, "select public.fiscal_offline_reserve($1, $2, 10) r", [P1, "corto"])).code === "INVALID", "Equipo no válido");
const noCont = await one(OWNER, "select public.fiscal_offline_reserve($1, $2, 10) r", [P3, DEV_A]);
ok(noCont.enabled && noCont.configured === false && /contingencia/i.test(noCont.reason ?? ""), "Punto electrónico sin numeración de contingencia: lo dice", noCont);

console.log("2. Factura de contingencia hecha sin conexión");
const block = resA.blocks[0].id;
const d1 = draft(1, { fiscal: { block_id: block, number: 1, full_number: "CONT1" } });
const s1 = await submit(CAJA, d1);
ok(s1.ok && !s1.already && s1.doc_number === "CONT1" && s1.fiscal?.document_type === "contingency_invoice" && s1.fiscal?.status === "QUEUED",
  "Se registra con el número de la factura en papel y queda en cola para la DIAN", s1);
const [doc] = await raw("select * from fiscal_documents where id = $1", [s1.fiscal.document_id]);
ok(Math.abs(new Date(doc.issue_date) - new Date(d1.created_at)) < 1000 && doc.metadata.paper_number === "CONT1" && doc.metadata.offline === true,
  "   La fecha del documento es la hora real de la venta y guarda la factura en papel", { issue: doc.issue_date, meta: doc.metadata });
ok(Number(doc.total) === 238000 && Number(doc.tax_total) === 38000, "   Totales e IVA correctos", { total: doc.total, tax: doc.tax_total });
const [cont] = await raw("select * from fiscal_contingencies where id = $1", [doc.contingency_id]);
ok(cont?.status === "closed" && cont.kind === "connectivity" && cont.metadata.auto === "offline_pos", "   Queda la contingencia registrada (cerrada: no frena el envío)", cont);
const [alloc] = await raw("select document_id, status from fiscal_number_allocations where range_id = $1 and number = 1", [R_CONT]);
ok(alloc.document_id === doc.id && alloc.status === "assigned", "   El número 1 queda ligado a su documento", alloc);
const [meta] = await raw("select doc_kind, doc_number, payment from erp_order_meta m join orders o on o.id = m.order_id where o.token = $1", [s1.token]);
ok(meta.doc_kind === "factura" && meta.doc_number === "CONT1", "   La venta lleva el mismo número (una sola numeración)", meta);
ok(meta.payment?.offline === true && Math.abs(new Date(meta.payment.at) - new Date(d1.created_at)) < 1000 && Number(meta.payment.change) === 12000,
  "   Forma de pago con la hora real (la caja la cuenta en su turno) y el vuelto", meta.payment);
const again = await submit(CAJA, d1);
ok(again.ok && again.already && again.token === s1.token && again.fiscal?.document_id === s1.fiscal.document_id, "Reintentar no crea otra venta ni otra factura", again);
ok((await raw("select count(*)::int n from orders where store_id = $1", [A]))[0].n === 1, "   Solo existe una venta");

console.log("3. Lo que no se puede registrar solo queda a la vista");
const dup = await submit(CAJA, draft(2, { fiscal: { block_id: block, number: 1, full_number: "CONT1" } }));
ok(!dup.ok && dup.code === "FISCAL_NUMBER_USED", "El mismo número en otra venta: no se registra", dup);
ok((await raw("select count(*)::int n from orders where store_id = $1", [A]))[0].n === 1, "   …y no deja una venta a medias");
const foreign = await submit(CAJA, draft(3, { fiscal: { block_id: block, number: 25, full_number: "CONT25" } }));
ok(!foreign.ok && foreign.code === "FISCAL_NUMBER_NOT_RESERVED", "Un número que el equipo no separó: no se registra", foreign);
const stock = await submit(CAJA, draft(4, { kind: "remision", items: [{ product_id: POCO, qty: 5, price: 30000, level: 3 }], total: 150000, fiscal: undefined }));
ok(!stock.ok && stock.code === "OUT_OF_STOCK" && /ULTIMA UNIDAD/.test(stock.message), "Sin inventario en el sistema: lo explica con el producto", stock);
const issues = await one(CAJA, "select public.erp_pos_offline_issues_list($1) r", [A]);
ok(issues.ok && issues.items.length === 3 && issues.items.some((i) => i.kind === "contingencia" && i.fiscal_number === "CONT1"),
  "Las 3 quedan en «por revisar» (visibles desde cualquier equipo)", issues.items?.map((i) => i.code));
const retry = await submit(CAJA, draft(4, { kind: "remision", items: [{ product_id: POCO, qty: 5, price: 30000, level: 3 }], total: 150000, fiscal: undefined }));
ok((await raw("select attempts from erp_pos_offline_issues where client_id = $1", [draft(4).id]))[0].attempts === 2 && !retry.ok, "   Cada reintento suma intentos");
ok(!(await one(CAJA, "select public.erp_pos_offline_issue_resolve($1, 'la registré a mano') r", [draft(2).id])).ok,
  "   Una factura de contingencia por revisar no la cierra un cajero");
ok((await one(OWNER, "select public.erp_pos_offline_issue_resolve($1, 'número repetido: se anuló la venta duplicada') r", [draft(2).id])).ok,
  "   …la cierra quien maneja la facturación");
ok((await one(CAJA, "select public.erp_pos_offline_issue_resolve($1, 'se registró a mano') r", [draft(4).id])).ok, "   Una remisión la puede cerrar el cajero");
const gone = await submit(CAJA, draft(14, { fiscal: { block_id: block, number: 2, full_number: "CONT2" },
  items: [{ product_id: "e9000000-0000-0000-0000-000000000099", qty: 1, price: 5000, level: 3, name: "PRODUCTO BORRADO" }], total: 5000 }));
ok(!gone.ok && gone.code === "INVALID_ITEM" && /PRODUCTO BORRADO/.test(gone.message), "Producto borrado mientras no había conexión: queda por revisar con su nombre", gone);
ok((await raw("select count(*)::int n from erp_pos_offline_issues where client_id = $1 and kind = 'contingencia'", [draft(14).id]))[0].n === 1, "   …y el administrador la ve (no se pierde la factura en papel)");
const nothing = await one(OWNER, "select public.erp_pos_offline_issue_resolve($1, 'nada que cerrar') r", ["e2000000-0000-0000-0000-000000000999"]);
ok(!nothing.ok && nothing.missing, "No se «cierra» algo que no está registrado en el panel", nothing);

console.log("4. Remisión, factura interna y factura electrónica al volver");
const now = await one(CAJA2, "select public.erp_pos_submit_offline_v2($1, $2::jsonb) r", [A, JSON.stringify(draft(5, {
  point_id: P2, kind: "remision", fiscal: undefined, items: [{ product_id: LIC, qty: 1, price: 110000, level: 3 }], total: 110000,
  payment: { method: "transferencia", parts: [{ method: "transferencia", amount: 110000 }], received: 110000, change: 0 } }))]);
ok(now.ok && now.kind === "remision" && now.doc_number && Number(now.total) === 110000, "Remisión: con el precio COBRADO (no el de la lista)", now);
ok(now.price_changes.length === 1 && Number(now.price_changes[0].list) === 119000, "   …y la diferencia con la lista queda anotada", now.price_changes);
const fint = await one(CAJA2, "select public.erp_pos_submit_offline_v2($1, $2::jsonb) r", [A, JSON.stringify(draft(6, { point_id: P2, kind: "factura", fiscal: undefined }))]);
ok(fint.ok && fint.kind === "factura" && fint.fiscal === null && fint.doc_number, "Punto sin facturación electrónica: factura interna con su número", fint);
const fe = await submit(CAJA, draft(7, { kind: "factura", fiscal: undefined }));
ok(fe.ok && fe.fiscal?.document_type === "invoice" && fe.doc_number === "FE1", "Punto electrónico sin número de contingencia: la factura electrónica se emite al volver (FE1)", fe);

console.log("5. Reloj del equipo y caja ya cerrada");
await raw("insert into erp_cash_sessions (store_id, point_id, number, status, opened_at, closed_at) values ($1, $2, 7, 'closed', now() - interval '10 hours', now() - interval '1 hour')", [A, P2]);
const late = await one(CAJA2, "select public.erp_pos_submit_offline_v2($1, $2::jsonb) r", [A, JSON.stringify(draft(8, { point_id: P2, kind: "remision", fiscal: undefined }))]);
ok(late.ok && late.warnings.some((w) => /caja N\.º 7 ya estaba cerrada/.test(w) && /238\.000/.test(w)), "Venta que cae en una caja cerrada: avisa el sobrante", late.warnings);
const clock = await one(CAJA2, "select public.erp_pos_submit_offline_v2($1, $2::jsonb) r", [A, JSON.stringify(draft(9, { point_id: P2, kind: "remision", fiscal: undefined, created_at: "2020-01-01T10:00:00Z" }))]);
const [sub9] = await raw("select created_offline_at from erp_pos_offline_submissions where client_id = $1", [draft(9).id]);
ok(clock.ok && clock.warnings.some((w) => /fecha del equipo/.test(w)) && Date.now() - new Date(sub9.created_offline_at) < 60_000, "Fecha del equipo mal: usa la hora de llegada y avisa", clock.warnings);

console.log("6. Liberar números de un equipo perdido");
ok((await one(CAJA, "select public.fiscal_offline_blocks_list($1) r", [A])).code === "FORBIDDEN", "El cajero no ve ni libera los números separados");
const list = await one(CONTA, "select public.fiscal_offline_blocks_list($1) r", [A]);
ok(list.ok && list.items.length === 2 && list.items.find((b) => b.from === 1)?.used === 1, "La contadora ve los bloques por equipo (usados y libres)", list.items);
const blockB = resB.blocks[0].id;
ok((await one(CONTA, "select public.fiscal_offline_release($1, 'x') r", [blockB])).code === "VALIDATION", "Pide el motivo");
const rel = await one(CONTA, "select public.fiscal_offline_release($1, 'Celular del punto perdido') r", [blockB]);
ok(rel.ok && rel.voided === 10, "Libera los 10 números (quedan anulados sin transmitir)", rel);
const revived = await submit(CAJA, draft(10, { device_id: DEV_B, fiscal: { block_id: blockB, number: 11, full_number: "CONT11" } }));
const [a11] = await raw("select status, document_id from fiscal_number_allocations where range_id = $1 and number = 11", [R_CONT]);
ok(revived.ok && revived.doc_number === "CONT11" && a11.status === "assigned" && a11.document_id, "Si ese equipo ya había facturado en papel, la factura manda: el número se recupera", { revived, a11 });

console.log("7. Plazo de 48 horas y avisos");
const pend = await one(CONTA, "select public.fiscal_contingency_pending($1) r", [A]);
ok(pend.ok && pend.items.length === 2 && pend.items.every((i) => Number(i.hours_left) > 47), "Facturas de contingencia por aceptar con sus horas de plazo", pend.items);
const alerts = await one(OWNER, "select public.erp_offline_alerts($1) r", [A]);
const keys = alerts.map((a) => a.key);
ok(keys.includes("offline-contingency-pending") && keys.includes("offline-sale-issues"), "La campana avisa contingencias pendientes y ventas por revisar", keys);
ok(keys.includes(`fiscal-no-contingency-${P3}`) && !keys.includes(`fiscal-no-contingency-${P1}`), "   y el punto electrónico que no tiene numeración de contingencia", keys);
ok((await one(NOPOS, "select public.erp_offline_alerts($1) r", [A])).length === 0, "   Quien no vende ni factura no recibe estos avisos");

console.log("8. Permisos");
ok(/permiso/i.test((await err(NOPOS, "select public.erp_pos_submit_offline_v2($1, $2::jsonb)", [A, JSON.stringify(draft(11, { kind: "remision", fiscal: undefined }))])) ?? ""), "Sin permiso de POS: bloqueado");
ok(/tus puntos/i.test((await err(CAJA2, "select public.erp_pos_submit_offline_v2($1, $2::jsonb)", [A, JSON.stringify(draft(12, { kind: "remision", fiscal: undefined }))])) ?? ""), "No se registra a nombre de otro punto");
ok(/permission denied/i.test((await err(null, "select public.erp_pos_submit_offline_v2($1, $2::jsonb)", [A, JSON.stringify(draft(13))])) ?? ""), "Sin sesión: bloqueado");
ok(/permission denied/i.test((await err(CAJA, "select public.fiscal__offline_contingency(null, null, null, null, null, null, null, null, null, null, null)")) ?? ""), "Las piezas internas no se llaman desde la página");
ok(/permission denied/i.test((await err(CAJA, "select count(*) from public.fiscal_offline_blocks")) ?? ""), "La tabla de números separados no se lee directo");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
