// Pruebas del módulo fiscal multipunto sobre PGlite (Postgres real en memoria).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const report = (e) => {
  console.error("FALLA:", e?.message, e?.query ? "\nSQL: " + e.query.slice(0, 300) : "", e?.where ? "\nDónde: " + e.where : "");
  process.exit(2);
};
process.on("uncaughtException", report);
process.on("unhandledRejection", report);

const MIGRATION = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261027_fiscal_multipunto.sql");
const { db } = await makeDb(MIGRATION);
const U = (n) => `a0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), OWNER_A = U(2), OWNER_B = U(3), ROBIN = U(4), MARIA = U(5), JAVIER = U(6), CONTADOR = U(7), CAJERO = U(8), SARA = U(9);

let pass = 0, fail = 0;
const results = [];
function ok(cond, label, extra) {
  if (cond) { pass++; results.push("  ✔ " + label); }
  else { fail++; results.push("  ✘ " + label + (extra !== undefined ? " → " + JSON.stringify(extra).slice(0, 400) : "")); }
}
const raw = async (sql, params) => (await db.query(sql, params)).rows;
async function as(uid, sql, params) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
async function asErr(uid, sql, params) {
  try { await as(uid, sql, params); return null; } catch (e) { return e.message; }
}
const one = async (uid, sql, params) => (await as(uid, sql, params))[0]?.r;
async function service(sql, params, actor) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
  await db.query("select set_config('request.headers', $1, false)", [JSON.stringify(actor ? { "x-remhub-actor": actor, "x-remhub-actor-name": "SERVIDOR PRUEBA", "x-remhub-client-ip": "10.0.0.9" } : {})]);
  await db.exec("set role service_role");
  try { return (await db.query(sql, params)).rows; }
  finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
    await db.query("select set_config('request.headers', '', false)");
  }
}

// ---------------------------------------------------------------- datos base
for (const [id, email] of [[ADMIN, "admin@remhub.co"], [OWNER_A, "distribuidoralamisericordia@gmail.com"], [OWNER_B, "otra@tienda.co"],
  [ROBIN, "robin@x"], [MARIA, "maria@x"], [JAVIER, "javier@x"], [CONTADOR, "contador@x"], [CAJERO, "cajero@x"], [SARA, "sara@x"]]) {
  await raw("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}
await raw("insert into public.user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
const [{ id: A }] = await raw("insert into public.stores (slug, name, owner_id) values ('misericordia', 'DISTRIBUIDORA LA MISERICORDIA', $1) returning id", [OWNER_A]);
const [{ id: B }] = await raw("insert into public.stores (slug, name, owner_id) values ('otra', 'TIENDA MADRE B', $1) returning id", [OWNER_B]);
ok((await raw("select count(*)::int n from public.erp_org_settings where store_id in ($1, $2)", [A, B]))[0].n === 2, "Tiendas nuevas reciben configuración por defecto");

// Puntos creados con la función de administración (dueño de la tienda madre)
const mk = async (store, owner, name, code) => {
  const r = await one(owner, "select public.erp_point_save($1, $2::jsonb, 'prueba') r", [store, JSON.stringify({ name, code, address: "CALLE 1", city: "MEDELLIN", responsible_name: "RESP " + name })]);
  if (!r.ok) throw new Error("punto " + name + ": " + r.message);
  return r.id;
};
const P_ROBIN = await mk(A, OWNER_A, "Punto Robin", "ROBIN");
const P_MARIA = await mk(A, OWNER_A, "Punto María", "MARIA");
const P_JAVIER = await mk(A, OWNER_A, "Punto Javier", "JAVIER");
const P_SARA = await mk(A, OWNER_A, "Punto Sara", "SARA");
const P_B1 = await mk(B, OWNER_B, "Punto B1", "B1");
ok((await raw("select status, active from public.erp_warehouses where id = $1", [P_MARIA]))[0].active === true, "Punto creado activo (estado y «active» sincronizados)");

await raw(`insert into public.store_users (store_id, user_id, role, permissions, username, display_name, point_id, point_ids) values
  ($1, $2, 'seller', '{pos,fiscal,fiscal_send,audit,fiscal_audit,orders}', 'robin', 'ROBIN', null, '{}'),
  ($1, $3, 'seller', '{pos,fiscal,fiscal_send,orders,clients}', 'maria', 'MARÍA', $6, '{}'),
  ($1, $4, 'seller', '{pos,fiscal,fiscal_send,orders,clients}', 'javier', 'JAVIER', $7, '{}'),
  ($1, $5, 'accounting', '{fiscal,fiscal_config,fiscal_numbering,fiscal_provider,fiscal_notes,fiscal_download,fiscal_audit,audit,users}', 'contador', 'CONTADORA', null, '{}'),
  ($1, $8, 'seller', '{pos}', 'cajero', 'CAJERO MARÍA', $6, '{}'),
  ($1, $9, 'seller', '{fiscal}', 'sara', 'SARA', $10, '{}')`,
  [A, ROBIN, MARIA, JAVIER, CONTADOR, P_MARIA, P_JAVIER, CAJERO, SARA, P_SARA]);

// Alcance «varios puntos»: Sara (punto Sara) también consulta el punto María.
const xp = await one(OWNER_A, "select public.erp_user_set_extra_points($1, $2, $3::uuid[]) r", [A, SARA, [P_MARIA]]);
ok(xp.ok, "Dueño asigna puntos adicionales de consulta", xp);
const scopeSara = await one(SARA, "select public.erp_my_scope($1) r", [A]);
ok(scopeSara.scope === "points" && scopeSara.point_ids.length === 2, "Alcance de Sara = varios puntos", scopeSara);
ok((await one(OWNER_A, "select public.erp_my_scope($1) r", [A])).scope === "organization", "Alcance del dueño = toda la tienda madre");
ok((await one(ADMIN, "select public.erp_my_scope($1) r", [A])).scope === "global", "Alcance del super admin = global");

// Configuración de la tienda madre
let r = await one(MARIA, "select public.erp_org_settings_save($1, '{\"fiscal_enabled\": true}'::jsonb, 'x') r", [A]);
ok(!r.ok && r.code === "FORBIDDEN", "Usuario de punto no cambia la configuración de la tienda madre", r);
r = await one(OWNER_A, "select public.erp_org_settings_save($1, '{\"fiscal_enabled\": true}'::jsonb, 'Inicio facturación') r", [A]);
ok(r.ok && r.settings.fiscal_enabled, "Dueño activa la facturación electrónica de la tienda", r);
await one(OWNER_B, "select public.erp_org_settings_save($1, '{\"fiscal_enabled\": true}'::jsonb, 'x') r", [B]);

// Contribuyentes (cada punto con su propio NIT)
const nit = async (n) => (await raw("select public.fiscal_nit_dv($1) dv", [n]))[0].dv;
const jsDv = (doc) => { const W = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]; let sum = 0; for (let i = 0; i < doc.length; i++) sum += Number(doc[doc.length - 1 - i]) * W[i]; const m = sum % 11; return String(m > 1 ? 11 - m : m); };
let dvOk = true; for (const n of ["901147931", "900373913", "830114921", "71234567", "43123456", "1020304050", "800197268"]) if ((await nit(n)) !== jsDv(n)) dvOk = false;
ok(dvOk, "DV DIAN en la base = DV de la interfaz (mismo algoritmo)");
const entity = async (owner, store, legal, doc, person = "juridica") => {
  const res = await one(owner, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [store, JSON.stringify({
    person_type: person, legal_name: legal, document_type: "NIT", document_number: doc, tax_regime: "responsable_iva",
    tax_responsibilities: ["O-13"], economic_activities: ["4755"], fiscal_address: "CALLE 10 # 20-30", city: "Medellín",
    department: "Antioquia", email: "fiscal@" + doc + ".co", status: "active" })]);
  if (!res.ok) throw new Error("entidad " + legal + ": " + res.message);
  return res.id;
};
const E_ROBIN = await entity(OWNER_A, A, "Robin Pérez", "71234567", "natural");
const E_MARIA = await entity(OWNER_A, A, "María Gómez", "43123456", "natural");
const E_JAVIER = await entity(OWNER_A, A, "Javier Ruiz SAS", "900373913");
const E_B = await entity(OWNER_B, B, "Tienda B SAS", "830114921");
r = await one(OWNER_A, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [A, JSON.stringify({ legal_name: "MAL DV", document_type: "NIT", document_number: "900373913", verification_digit: "1" })]);
ok(!r.ok, "NIT con DV incorrecto se rechaza", r);
r = await one(OWNER_A, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [A, JSON.stringify({ person_type: "juridica", legal_name: "SIN NIT", document_type: "CC", document_number: "123456" })]);
ok(!r.ok && /jurídica/.test(r.message), "Persona jurídica sin NIT se rechaza", r);

const setupPoint = async (point, ent, prefix, from, to, store = A, owner = OWNER_A) => {
  const est = await one(owner, "select public.fiscal_establishment_save($1, $2::jsonb, null) r", [store, JSON.stringify({ fiscal_entity_id: ent, point_id: point, name: "Sede " + prefix, code: prefix, address: "CRA 1", city: "MEDELLIN", department: "ANTIOQUIA" })]);
  if (!est.ok) throw new Error("est: " + est.message);
  const acc = await one(owner, "select public.fiscal_provider_account_save($1, $2::jsonb, null) r", [store, JSON.stringify({ fiscal_entity_id: ent, provider: "sandbox", environment: "sandbox", label: "Pruebas " + prefix })]);
  if (!acc.ok) throw new Error("acc: " + acc.message);
  await service("select public.fiscal__provider_set_hints($1, '{\"webhook_secret\": \"••••abcd\"}'::jsonb)", [acc.id]);
  await service("select public.fiscal__provider_test_result($1, true, 'Conexión OK', '{}'::jsonb)", [acc.id], owner);
  const cfg = await one(owner, "select public.fiscal_point_config_save($1, $2::jsonb, null, false) r", [point, JSON.stringify({ fiscal_entity_id: ent, establishment_id: est.id, provider_account_id: acc.id, environment: "sandbox", enabled: true })]);
  if (!cfg.ok) throw new Error("cfg: " + cfg.message);
  const rng = await one(owner, "select public.fiscal_range_save($1, $2::jsonb, null) r", [store, JSON.stringify({ fiscal_entity_id: ent, document_type: "invoice", environment: "sandbox", resolution_number: "18760000" + prefix.length, resolution_date: "2026-01-01", valid_from: "2026-01-01", valid_until: "2027-12-31", prefix, range_from: from, range_to: to, point_ids: [point], status: "active" })]);
  if (!rng.ok) throw new Error("rng: " + rng.message);
  return { est: est.id, acc: acc.id, range: rng.id };
};
await setupPoint(P_ROBIN, E_ROBIN, "RB", 1, 100);
const S_MARIA = await setupPoint(P_MARIA, E_MARIA, "MA", 1, 1000);
const S_JAVIER = await setupPoint(P_JAVIER, E_JAVIER, "JA", 1, 50);
await setupPoint(P_B1, E_B, "B", 1, 100, B, OWNER_B);
const ncm = await one(CONTADOR, "select public.fiscal_range_save($1, $2::jsonb, null) r", [A, JSON.stringify({ fiscal_entity_id: E_MARIA, document_type: "credit_note", environment: "sandbox", prefix: "NCM", range_from: 1, range_to: 100, point_ids: [P_MARIA], status: "active" })]);
ok(ncm.ok, "Numeración de notas crédito sin resolución obligatoria", ncm);

const rdy = await one(MARIA, "select public.fiscal_point_readiness($1) r", [P_MARIA]);
ok(rdy.ok && rdy.ready === true, "Punto María: 🟢 listo para facturar", rdy.missing);
const rdyS = await one(OWNER_A, "select public.fiscal_point_readiness($1) r", [P_SARA]);
ok(rdyS.ready === false && rdyS.missing.length > 0, "Punto Sara sin configurar: 🔴 muestra exactamente qué falta", rdyS.missing);
ok((await one(JAVIER, "select public.fiscal_point_readiness($1) r", [P_MARIA])).code === "FORBIDDEN", "Javier no consulta la configuración de María");

// Productos y ventas
const [{ id: P1 }] = await raw("insert into public.products (store_id, name, sku, tax_rate) values ($1, 'Licuadora', 'LIC-1', 19) returning id", [A]);
const [{ id: P2 }] = await raw("insert into public.products (store_id, name, sku, tax_rate) values ($1, 'Arroz', 'ARZ-1', 0) returning id", [A]);
const [{ id: PB }] = await raw("insert into public.products (store_id, name, sku, tax_rate) values ($1, 'Producto B', 'PB', 19) returning id", [B]);
let seq = 0;
const sale = async (store, items) => {
  seq++;
  const token = "tok-" + seq;
  const total = items.reduce((s, [, q, p]) => s + q * p, 0);
  const [{ id }] = await raw("insert into public.orders (store_id, token, receipt_no, total, customer_name) values ($1, $2, $3, $4, $5) returning id", [store, token, seq, total, "CLIENTE " + seq]);
  for (const [prod, q, p] of items) await raw("insert into public.order_items (order_id, product_id, quantity, price) values ($1, $2, $3, $4)", [id, prod, q, p]);
  return { id, token, total };
};
const issue = (uid, store, token, point, key) =>
  one(uid, "select public.fiscal_issue_from_order($1, $2, $3, null, null, null, $4) r", [store, token, point, key ?? "k-" + token]);

// 1-2. Robin y María facturan correctamente
const sR = await sale(A, [[P1, 1, 119000]]);
let res = await issue(ROBIN, A, sR.token, P_ROBIN);
ok(res.ok && res.full_number === "RB1" && res.status === "QUEUED", "1. Robin factura correctamente (RB1)", res);
const sM = await sale(A, [[P1, 2, 119000], [P2, 3, 5000]]);
res = await issue(MARIA, A, sM.token, P_JAVIER);
ok(res.ok && res.full_number === "MA1", "2. María factura correctamente (MA1, su punto aunque pida otro)", res);
const DOC_M1 = res.document_id;
const docM1 = (await raw("select * from public.fiscal_documents where id = $1", [DOC_M1]))[0];
ok(Number(docM1.total) === 253000 && Number(docM1.tax_total) === 38000 && docM1.issuer.document_number === "43123456",
  "Totales e impuestos correctos (IVA incluido) y emisor = NIT de María", { total: docM1.total, tax: docM1.tax_total });
const meta = (await raw("select doc_kind, doc_number from public.erp_order_meta where order_id = $1", [sM.id]))[0];
ok(meta.doc_kind === "factura" && meta.doc_number === "MA1", "El número de la venta es el número fiscal (una sola numeración)", meta);
res = await issue(MARIA, A, sM.token, P_MARIA, "otra-llave");
ok(res.ok && res.reused && res.document_id === DOC_M1, "Doble clic / reintento: no crea dos facturas para la misma venta", res);
res = await issue(MARIA, A, sM.token, P_MARIA, "k-" + sM.token);
ok(res.reused === true, "Idempotencia por llave", res);

// 3. María no puede facturar como Javier
const sJ = await sale(A, [[P2, 1, 10000]]);
await raw("insert into public.erp_order_meta (order_id, store_id, point_id, doc_kind, doc_number) values ($1, $2, $3, 'remision', 'REMJ-1')", [sJ.id, A, P_JAVIER]);
res = await issue(MARIA, A, sJ.token, P_JAVIER);
ok(!res.ok && res.code === "POINT_FORBIDDEN", "3. María no puede facturar una venta del punto de Javier", res);
const secM = (await raw("select count(*)::int n from public.erp_audit_logs where category = 'security' and action = 'security.fiscal_cross_point' and user_id = $1", [MARIA]))[0].n;
ok(secM === 1, "   …y el intento queda en el registro de seguridad (crítico)", secM);
res = await issue(CAJERO, A, sJ.token, P_JAVIER);
ok(!res.ok, "   El cajero de María tampoco", res);

// 4. Javier no ve facturas de María
const seenJ = await as(JAVIER, "select count(*)::int n from public.fiscal_documents where point_id = $1", [P_MARIA]);
ok(seenJ[0].n === 0, "4. Javier no puede ver facturas de María (RLS)", seenJ);
ok((await one(JAVIER, "select public.fiscal_document_detail($1) r", [DOC_M1])).code === "FORBIDDEN", "   ni su detalle");
const searchJ = await one(JAVIER, "select public.fiscal_documents_search($1, '{}'::jsonb, 50, null) r", [A]);
ok(searchJ.items.every((d) => d.point_id !== P_MARIA), "   ni en la búsqueda", searchJ.items.length);
ok((await as(JAVIER, "select count(*)::int n from public.fiscal_entities where id = $1", [E_MARIA]))[0].n === 0, "   ni el NIT/contribuyente de María");
ok((await as(MARIA, "select count(*)::int n from public.fiscal_documents where point_id = $1", [P_MARIA]))[0].n === 1, "   María sí ve los suyos");
ok((await as(SARA, "select count(*)::int n from public.fiscal_documents where point_id = $1", [P_MARIA]))[0].n === 1, "   Sara (alcance varios puntos) ve los de María");
ok((await as(SARA, "select count(*)::int n from public.fiscal_documents where point_id = $1", [P_ROBIN]))[0].n === 0, "   pero no los de Robin");

// 5. Tienda madre ve sus puntos; 16. no ve la tienda B
const ownerSees = await as(OWNER_A, "select count(distinct point_id)::int n from public.fiscal_documents where store_id = $1", [A]);
ok(ownerSees[0].n === 2, "5. La tienda madre ve los documentos de todos sus puntos", ownerSees);
const ov = await one(OWNER_A, "select public.fiscal_overview($1) r", [A]);
ok(ov.ok && ov.points.length >= 4, "   Resumen fiscal con la salud de cada punto", ov.points?.length);
const sB = await sale(B, [[PB, 1, 50000]]);
res = await issue(OWNER_B, B, sB.token, P_B1);
ok(res.ok && res.full_number === "B1", "Tienda B factura con su propia numeración", res);
ok((await as(OWNER_A, "select count(*)::int n from public.fiscal_documents where store_id = $1", [B]))[0].n === 0, "16. Tienda madre A no puede consultar la tienda madre B");
ok((await one(OWNER_A, "select public.fiscal_overview($1) r", [B])).code === "FORBIDDEN", "    ni su centro fiscal");
ok((await one(OWNER_A, "select public.erp_point_dossier($1) r", [P_B1])).code === "FORBIDDEN", "    ni el expediente de sus puntos");
res = await issue(OWNER_A, A, sB.token, P_B1);
ok(!res.ok, "    ni facturar sus ventas", res);

// 6. Super admin ve todo
const adm = await one(ADMIN, "select public.admin_fiscal_documents('{}'::jsonb, 100, null) r");
ok(adm.ok && new Set(adm.items.map((d) => d.store_id)).size === 2, "6. Super admin ve los documentos de todas las tiendas", adm.items?.length);
const admOv = await one(ADMIN, "select public.admin_fiscal_overview(null, null) r");
ok(admOv.ok && admOv.kpis.points_active >= 5 && admOv.kpis.documents >= 3, "   Dashboard super admin con indicadores", admOv.kpis);
ok((await one(OWNER_A, "select public.admin_fiscal_overview(null, null) r")).code === "FORBIDDEN", "   El dueño de una tienda no entra al panel global");
const pts = await one(ADMIN, "select public.admin_fiscal_points('', 100, 0) r");
ok(pts.ok && pts.items.length >= 5, "   Super admin ve la salud fiscal de todos los puntos", pts.items?.length);
const post = await one(ADMIN, "select public.admin_security_posture() r");
ok(post.ok && Array.isArray(post.tables_without_rls), "   Postura de seguridad (tablas sin RLS)", post.tables_without_rls);

// 7. Consecutivos: nunca duplicados, sin saltos, y se respeta el rango
const nums = [];
for (let i = 0; i < 49; i++) {
  const s = await sale(A, [[P2, 1, 1000]]);
  const x = await issue(JAVIER, A, s.token, P_JAVIER);
  if (x.ok) nums.push(x.number);
}
const sameAll = (await raw("select count(*)::int n, count(distinct number)::int d, min(number)::int mi, max(number)::int ma from public.fiscal_documents where range_id = $1", [S_JAVIER.range]))[0];
ok(sameAll.n === 49 && sameAll.d === 49 && sameAll.mi === 1 && sameAll.ma === 49, "7. 49 facturas seguidas → números 1..49 sin duplicados ni saltos", sameAll);
const dupErr = await raw("select 1").then(async () => {
  try { await raw("insert into public.fiscal_number_allocations (range_id, store_id, fiscal_entity_id, document_type, environment, prefix, number) values ($1, $2, $3, 'invoice', 'sandbox', 'JA', 5)", [S_JAVIER.range, A, E_JAVIER]); return null; }
  catch (e) { return e.message; }
});
ok(dupErr && /duplicate|unique/i.test(dupErr), "   Un número repetido es imposible (restricción única en la base)", dupErr);
const s50 = await sale(A, [[P2, 1, 1000]]);
const r50 = await issue(JAVIER, A, s50.token, P_JAVIER);
const s51 = await sale(A, [[P2, 1, 1000]]);
const r51 = await issue(JAVIER, A, s51.token, P_JAVIER);
ok(r50.ok && r50.number === 50 && !r51.ok && r51.code === "NOT_READY", "   Rango agotado: no se emite fuera del rango autorizado", { r50: r50.number, r51 });
ok((await raw("select status from public.fiscal_numbering_ranges where id = $1", [S_JAVIER.range]))[0].status === "exhausted", "   La numeración queda marcada como agotada");
ok((await raw("select count(*)::int n from public.fiscal_documents where source_id = $1", [s51.id]))[0].n === 0, "   y la venta rechazada no consumió consecutivo");

// 15. Punto A no puede usar numeración del punto B
const e15 = await raw("select 1").then(async () => {
  try { await raw("select public.fiscal__allocate_number($1, gen_random_uuid(), $2, 'invoice', 'sandbox', $3)", [S_JAVIER.range, P_MARIA, E_MARIA]); return null; }
  catch (e) { return e.message; }
});
ok(e15 && /otro contribuyente|no está autorizada/.test(e15), "15. El punto María no puede usar la numeración del punto Javier", e15);
r = await one(MARIA, "select public.fiscal_range_save($1, $2::jsonb, 'x') r", [A, JSON.stringify({ id: S_JAVIER.range, point_ids: [P_MARIA] })]);
ok(!r.ok && r.code === "FORBIDDEN", "    ni apropiársela desde su usuario", r);
r = await one(OWNER_A, "select public.fiscal_range_save($1, $2::jsonb, 'Unificar') r", [A, JSON.stringify({ fiscal_entity_id: E_MARIA, document_type: "invoice", environment: "sandbox", prefix: "MA", range_from: 500, range_to: 1500, resolution_number: "X", resolution_date: "2026-01-01", valid_until: "2027-01-01", point_ids: [P_MARIA] })]);
ok(!r.ok && /se cruza/.test(r.message), "    Dos rangos que se cruzan (mismo prefijo) se rechazan", r);

// Configuración: María no puede facturar con el NIT de Javier
await raw("update public.store_users set permissions = array_append(permissions, 'fiscal_config') where user_id = $1", [MARIA]);
r = await one(MARIA, "select public.fiscal_point_config_save($1, $2::jsonb, 'cambio', false) r", [P_MARIA, JSON.stringify({ fiscal_entity_id: E_JAVIER })]);
ok(!r.ok && r.code === "FORBIDDEN", "Regla principal: María no puede asignar a su punto la identidad fiscal de Javier", r);
r = await one(MARIA, "select public.fiscal_entity_save($1, $2::jsonb, 'cambio') r", [A, JSON.stringify({ id: E_JAVIER, legal_name: "OTRO" })]);
ok(!r.ok && r.code === "FORBIDDEN", "   ni editar el contribuyente de Javier", r);
await raw("update public.store_users set permissions = array_remove(permissions, 'fiscal_config') where user_id = $1", [MARIA]);

// 10. Sin permiso no se modifica la resolución; 11. ni el NIT
r = await one(JAVIER, "select public.fiscal_range_save($1, $2::jsonb, 'x') r", [A, JSON.stringify({ id: S_MARIA.range, valid_until: "2030-01-01" })]);
ok(!r.ok && r.code === "FORBIDDEN", "10. Usuario sin permiso no puede modificar la resolución", r);
let err = await asErr(JAVIER, "update public.fiscal_numbering_ranges set valid_until = '2030-01-01' where id = $1", [S_MARIA.range]);
ok(err && /permission denied/i.test(err), "    ni directamente en la tabla", err);
r = await one(JAVIER, "select public.fiscal_entity_save($1, $2::jsonb, 'x') r", [A, JSON.stringify({ id: E_JAVIER, document_number: "900000001" })]);
ok(!r.ok && r.code === "FORBIDDEN", "11. Usuario sin permiso no puede cambiar el NIT", r);
err = await asErr(JAVIER, "update public.fiscal_entities set document_number = '1' where id = $1", [E_JAVIER]);
ok(err && /permission denied/i.test(err), "    ni directamente en la tabla", err);
r = await one(CONTADOR, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [A, JSON.stringify({ id: E_ROBIN, legal_name: "ROBIN PEREZ CAMBIO" })]);
ok(!r.ok && r.code === "REASON_REQUIRED", "    Con permiso, cambiar razón social exige motivo", r);
r = await one(CONTADOR, "select public.fiscal_entity_save($1, $2::jsonb, null) r", [A, JSON.stringify({ id: E_MARIA, document_number: "43999999" })]);
ok(!r.ok && r.code === "REASON_REQUIRED", "    …y el NIT también", r);
r = await one(CONTADOR, "select public.fiscal_entity_save($1, $2::jsonb, 'Error de digitación en el RUT') r", [A, JSON.stringify({ id: E_MARIA, document_number: "43999999" })]);
ok(!r.ok && /ya tiene documentos numerados/.test(r.message), "    Un NIT que ya facturó no se cambia (se crea otro contribuyente)", r);
r = await one(CONTADOR, "select public.fiscal_entity_save($1, $2::jsonb, 'Cambio de razón social en el RUT') r", [A, JSON.stringify({ id: E_ROBIN, legal_name: "Robin Pérez Gómez" })]);
ok(r.ok, "    Cambio con motivo se guarda", r);
const aud = (await raw("select before, after, reason, user_id, severity from public.erp_audit_logs where entity = 'contribuyente' and entity_id = $1 and action = 'contribuyente.update' order by created_at desc limit 1", [E_ROBIN]))[0];
ok(aud && aud.before.legal_name === "ROBIN PÉREZ" && aud.after.legal_name === "ROBIN PÉREZ GÓMEZ" && aud.reason === "Cambio de razón social en el RUT" && aud.user_id === CONTADOR && aud.severity === "warning",
  "    Auditoría: valor anterior, nuevo, motivo, usuario y severidad", aud);

// Envío al proveedor (simulado como lo hace el servidor) — 8. rechazo y corrección
let claim = (await service("select public.fiscal__claim($1) r", [DOC_M1], MARIA))[0].r;
ok(claim.ok && claim.mode === "send" && claim.document.status === "PROCESSING" && claim.lines.length === 2, "Envío: el documento pasa a PROCESANDO con sus líneas", claim.code);
let busy = (await service("select public.fiscal__claim($1) r", [DOC_M1]))[0].r;
ok(!busy.ok && busy.code === "BUSY", "   Doble envío simultáneo: «El documento ya fue enviado y está siendo procesado»", busy);
await service("select public.fiscal__record_result($1, $2::jsonb) r", [DOC_M1, JSON.stringify({ status: "REJECTED", error_code: "FAJ44", error_message: "Correo del adquiriente inválido", transmitted: true })]);
ok((await raw("select status from public.fiscal_documents where id = $1", [DOC_M1]))[0].status === "REJECTED", "8. Factura rechazada queda REJECTED con su motivo");
claim = (await service("select public.fiscal__claim($1) r", [DOC_M1], CONTADOR))[0].r;
ok(claim.ok && claim.document.attempts === 2, "   Se puede corregir y reenviar (mismo número, nuevo intento)", claim);
await service("select public.fiscal__record_result($1, $2::jsonb) r", [DOC_M1, JSON.stringify({ status: "ACCEPTED", cufe: "SIM-abc123", provider_document_id: "prov-1", dian_status: "Aceptado" })]);
const acc1 = (await raw("select status, cufe, attempts from public.fiscal_documents where id = $1", [DOC_M1]))[0];
ok(acc1.status === "ACCEPTED" && acc1.cufe === "SIM-abc123", "   y queda ACEPTADA con CUFE", acc1);
const evs = (await raw("select event from public.fiscal_document_events where document_id = $1 order by id", [DOC_M1])).map((x) => x.event);
ok(evs.includes("rejected") && evs.includes("accepted") && evs.filter((e) => e === "send_started").length === 2, "   Línea de tiempo completa (creado, número, envíos, rechazo, aceptación)", evs);

// 9. Factura aceptada no se borra ni se modifica
err = await raw("select 1").then(async () => { try { await raw("delete from public.fiscal_documents where id = $1", [DOC_M1]); return null; } catch (e) { return e.message; } });
ok(err && /no se borran/.test(err), "9. Factura aceptada no puede ser eliminada (ni siquiera con acceso total a la base)", err);
err = await raw("select 1").then(async () => { try { await raw("update public.fiscal_documents set total = 1 where id = $1", [DOC_M1]); return null; } catch (e) { return e.message; } });
ok(err && /nota crédito/.test(err), "   ni modificada (se corrige con nota crédito/débito)", err);
err = await asErr(OWNER_A, "delete from public.fiscal_documents where id = $1", [DOC_M1]);
ok(err && /permission denied/i.test(err), "   El dueño tampoco puede borrarla desde el navegador", err);
err = await raw("select 1").then(async () => { try { await raw("update public.order_items set quantity = 9 where order_id = $1", [sM.id]); return null; } catch (e) { return e.message; } });
ok(err && /documento electrónico/.test(err), "   La venta facturada ya no se puede editar", err);

// 12. Descargar XML requiere permiso
r = await one(MARIA, "select public.fiscal_download_access($1, 'xml') r", [DOC_M1]);
ok(!r.ok && r.code === "FORBIDDEN", "12. Usuario sin permiso no puede descargar el XML", r);
r = await one(CONTADOR, "select public.fiscal_download_access($1, 'xml') r", [DOC_M1]);
ok(r.ok, "    La contadora sí (y queda registrado)", r);
ok((await raw("select count(*)::int n from public.erp_audit_logs where action = 'fiscal.download_xml' and user_id = $1", [CONTADOR]))[0].n === 1, "    Descarga auditada");

// Notas crédito: total → la factura original queda cancelada (se conserva)
r = await one(MARIA, "select public.fiscal_create_note($1, 'credit_note', '2', 'Devolución total', null, 'nc-1') r", [DOC_M1]);
ok(!r.ok && r.code === "FORBIDDEN", "María (sin permiso de notas) no anula facturas", r);
const LIC = (await raw("select line_no from public.fiscal_document_lines where document_id = $1 and sku = 'LIC-1'", [DOC_M1]))[0].line_no;
r = await one(CONTADOR, "select public.fiscal_create_note($1, 'credit_note', '1', 'Devolución parcial licuadora', $2::jsonb, 'nc-p') r", [DOC_M1, JSON.stringify([{ line_no: LIC, qty: 1 }])]);
ok(r.ok && r.full_number === "NCM1" && Number(r.total) === 119000, "Nota crédito parcial con su propia numeración (NCM1)", r);
const NC1 = r.document_id;
await service("select public.fiscal__claim($1)", [NC1]);
await service("select public.fiscal__record_result($1, '{\"status\":\"ACCEPTED\",\"cufe\":\"SIM-nc1\"}'::jsonb)", [NC1]);
ok((await raw("select status from public.fiscal_documents where id = $1", [DOC_M1]))[0].status === "ACCEPTED", "   Factura sigue aceptada tras una nota parcial");
r = await one(CONTADOR, "select public.fiscal_create_note($1, 'credit_note', '1', 'Otra devolución', $2::jsonb, 'nc-x') r", [DOC_M1, JSON.stringify([{ line_no: LIC, qty: 2 }])]);
ok(!r.ok && r.code === "QTY_EXCEEDED", "   No se acredita más de lo facturado", r);
r = await one(CONTADOR, "select public.fiscal_create_note($1, 'credit_note', '2', 'Anulación del saldo', null, 'nc-2') r", [DOC_M1]);
ok(r.ok && Number(r.total) === 134000, "   Nota por el saldo pendiente", r);
await service("select public.fiscal__claim($1)", [r.document_id]);
await service("select public.fiscal__record_result($1, '{\"status\":\"ACCEPTED\"}'::jsonb)", [r.document_id]);
ok((await raw("select status from public.fiscal_documents where id = $1", [DOC_M1]))[0].status === "CANCELLED", "   Con el total acreditado la factura queda CANCELADA (y se conserva)");

// Anular sin transmitir: el número queda registrado como no usado
const sV = await sale(A, [[P2, 1, 2000]]);
res = await issue(MARIA, A, sV.token, P_MARIA);
r = await one(CONTADOR, "select public.fiscal_void_unsent($1, 'Error en el cliente') r", [res.document_id]);
ok(r.ok, "Anular un documento que nunca se transmitió", r);
ok((await raw("select status from public.fiscal_number_allocations where document_id = $1", [res.document_id]))[0].status === "voided_unsent", "   El número queda marcado «anulado sin transmitir»");
const re = await issue(MARIA, A, sV.token, P_MARIA, "re-1");
ok(re.ok && re.number === res.number + 1 && (await raw("select doc_number from public.erp_order_meta where order_id = $1", [sV.id]))[0].doc_number === re.full_number,
  "   Se puede volver a facturar la venta con un número nuevo", re);
r = await one(CONTADOR, "select public.fiscal_void_unsent($1, 'no aplica') r", [DOC_M1]);
ok(!r.ok, "   Un documento aceptado no se anula así (va por nota crédito)", r);

// 13-14. Webhooks: duplicado y firma inválida
const D2 = re.document_id;
await service("select public.fiscal__claim($1)", [D2]);
await service("select public.fiscal__record_result($1, '{\"status\":\"SENT\",\"provider_document_id\":\"prov-2\"}'::jsonb)", [D2]);
const w1 = (await service("select public.fiscal__webhook_store($1, 'sandbox', 'evt-1', 'document.accepted', '{\"a\":1}'::jsonb, 'h1', true, '{}'::jsonb, '1.2.3.4') r", [S_MARIA.acc]))[0].r;
const w2 = (await service("select public.fiscal__webhook_store($1, 'sandbox', 'evt-1', 'document.accepted', '{\"a\":1}'::jsonb, 'h1', true, '{}'::jsonb, '1.2.3.4') r", [S_MARIA.acc]))[0].r;
ok(!w1.duplicate && w2.duplicate && w1.id === w2.id, "13. Webhook duplicado no duplica eventos", { w1, w2 });
ok((await raw("select count(*)::int n from public.fiscal_webhook_events where external_event_id = 'evt-1'"))[0].n === 1, "    (una sola fila)");
const ap = (await service("select public.fiscal__webhook_apply($1, $2::jsonb) r", [w1.id, JSON.stringify({ kind: "document_status", provider_document_id: "prov-2", status: "ACCEPTED", cufe: "SIM-xyz" })]))[0].r;
ok(ap.ok && (await raw("select status from public.fiscal_documents where id = $1", [D2]))[0].status === "ACCEPTED", "    El webhook verificado actualiza el documento", ap);
const ap2 = (await service("select public.fiscal__webhook_apply($1, $2::jsonb) r", [w1.id, JSON.stringify({ kind: "document_status", provider_document_id: "prov-2", status: "ACCEPTED" })]))[0].r;
ok(ap2.already === true, "    Reprocesar el mismo evento no hace nada", ap2);
const bad = (await service("select public.fiscal__webhook_store($1, 'sandbox', 'evt-9', 'document.accepted', '{\"b\":2}'::jsonb, 'h9', false, '{}'::jsonb, '6.6.6.6') r", [S_MARIA.acc]))[0].r;
ok((await raw("select status, payload from public.fiscal_webhook_events where id = $1", [bad.id]))[0].status === "rejected", "14. Webhook mal firmado se rechaza (sin guardar su contenido)");
ok((await raw("select count(*)::int n from public.erp_audit_logs where action = 'security.webhook_bad_signature'"))[0].n === 1, "    y genera alerta de seguridad");
const badApply = (await service("select public.fiscal__webhook_apply($1, '{\"kind\":\"document_status\",\"provider_document_id\":\"prov-2\",\"status\":\"REJECTED\"}'::jsonb) r", [bad.id]))[0].r;
ok(!badApply.ok && badApply.code === "REJECTED", "    Un evento sin firma válida nunca se procesa", badApply);
const legit = (await service("select public.fiscal__webhook_store($1, 'sandbox', null, 'x', '{\"b\":2}'::jsonb, 'h9', true, '{}'::jsonb, '1.1.1.1') r", [S_MARIA.acc]))[0].r;
ok(!legit.duplicate, "    Un rechazo previo no bloquea un evento legítimo idéntico", legit);
const wNo = (await service("select public.fiscal__webhook_store($1, 'sandbox', 'evt-404', 'x', '{}'::jsonb, 'h404', true, '{}'::jsonb, '1.1.1.1') r", [S_MARIA.acc]))[0].r;
await service("select public.fiscal__webhook_apply($1, '{\"kind\":\"document_status\",\"provider_document_id\":\"no-existe\",\"status\":\"ACCEPTED\"}'::jsonb)", [wNo.id]);
const wf = (await raw("select status, attempts, next_retry_at is not null as retry from public.fiscal_webhook_events where id = $1", [wNo.id]))[0];
ok(wf.status === "failed" && wf.retry, "    Webhook que falla queda para reintento con espera", wf);
r = await one(MARIA, "select public.fiscal_webhook_retry($1) r", [wNo.id]);
ok(!r.ok, "    Reintento manual requiere permiso del proveedor", r);
r = await one(CONTADOR, "select public.fiscal_webhook_retry($1) r", [wNo.id]);
ok(r.ok, "    La contadora lo reintenta desde el panel", r);

// Reglas de POS: factura interna bloqueada en puntos habilitados; remisiones según la regla
const sT = await sale(A, [[P2, 1, 3000]]);
err = await asErr(MARIA, "select public.erp_tag_order($1, $2, $3, null, 'factura')", [A, sT.token, P_MARIA]);
ok(err && /facturas son electrónicas/.test(err), "En un punto habilitado no se puede emitir «factura» interna (evita doble numeración)", err);
const tag = await as(MARIA, "select public.erp_tag_order($1, $2, $3, null, 'remision') r", [A, sT.token, P_MARIA]);
ok(tag[0].r.doc_number, "Remisión permitida con la regla «avisar»", tag[0].r);
await raw("update public.orders set created_at = now() - interval '10 days' where id = $1", [sT.id]);
const pend = await one(CONTADOR, "select public.fiscal_pending_sales($1, null, 50) r", [A]);
ok(pend.ok && pend.items.some((x) => x.order_id === sT.id && x.overdue), "Centro fiscal: remisión de venta pendiente de facturar (vencida según la regla)", pend.items?.length);
const alerts = await one(OWNER_A, "select public.erp_extra_alerts($1) r", [A]);
ok(alerts.some((x) => x.key === "fiscal-pending-sales") && alerts.some((x) => x.key === "security-critical"), "Alertas: remisiones sin facturar e intentos sospechosos", alerts.map((x) => x.key));
res = await issue(MARIA, A, sT.token, P_MARIA);
ok(res.ok && (await raw("select source_number from public.fiscal_documents where id = $1", [res.document_id]))[0].source_number === tag[0].r.doc_number, "Pedido → remisión → factura quedan relacionados", res);
await one(OWNER_A, "select public.erp_org_settings_save($1, '{\"remission_policy\": \"block\"}'::jsonb, 'Decisión contable') r", [A]);
const sT2 = await sale(A, [[P2, 1, 3000]]);
err = await asErr(MARIA, "select public.erp_tag_order($1, $2, $3, null, 'remision')", [A, sT2.token, P_MARIA]);
ok(err && /remisiones de venta bloqueadas/.test(err), "Regla «bloquear»: la remisión no se usa para evitar facturar", err);
await one(OWNER_A, "select public.erp_org_settings_save($1, '{\"remission_policy\": \"warn\"}'::jsonb, 'x') r", [A]);

// Aislamiento operativo (ventas, clientes)
const oM = await as(MARIA, "select count(*)::int n from public.orders where store_id = $1", [A]);
const oA = await as(OWNER_A, "select count(*)::int n from public.orders where store_id = $1", [A]);
ok(oM[0].n > 0 && oM[0].n < oA[0].n, "María solo ve las ventas de su punto; la tienda madre ve todas", { maria: oM[0].n, owner: oA[0].n });
const itemsJ = await as(JAVIER, "select count(*)::int n from public.order_items where order_id = $1", [sM.id]);
ok(itemsJ[0].n === 0, "Javier no ve los productos de una venta de María", itemsJ);
await as(JAVIER, "insert into public.billing_customers (store_id, name, document_number) values ($1, 'CLIENTE DE JAVIER', '1001')", [A]);
ok((await raw("select point_id from public.billing_customers where name = 'CLIENTE DE JAVIER'"))[0].point_id === P_JAVIER, "Cliente creado por Javier queda en su punto");
ok((await as(MARIA, "select count(*)::int n from public.billing_customers where name = 'CLIENTE DE JAVIER'"))[0].n === 0, "Clientes separados por defecto: María no lo ve");
await one(OWNER_A, "select public.erp_org_settings_save($1, '{\"shared_customers\": true}'::jsonb, 'Clientes comunes') r", [A]);
ok((await as(MARIA, "select count(*)::int n from public.billing_customers where name = 'CLIENTE DE JAVIER'"))[0].n === 1, "Con «clientes compartidos» María sí lo ve (y queda auditado)");
ok((await raw("select count(*)::int n from public.erp_audit_logs where entity = 'configuracion_tienda' and after ? 'shared_customers'"))[0].n >= 1, "   cambio de configuración auditado");

// Auditoría inmutable y atribución del servidor
err = await raw("select 1").then(async () => { try { await raw("update public.erp_audit_logs set action = 'x'"); return null; } catch (e) { return e.message; } });
ok(err && /no se puede modificar/.test(err), "Auditoría inmutable: no se modifica", err);
err = await raw("select 1").then(async () => { try { await raw("delete from public.erp_audit_logs"); return null; } catch (e) { return e.message; } });
ok(err && /no se puede modificar ni borrar/.test(err), "   ni se borra", err);
const t = (await raw("select user_id, ip from public.erp_audit_logs where action = 'fiscal.provider_test' order by created_at limit 1"))[0];
ok(t.user_id === OWNER_A && t.ip === "10.0.0.9", "Acciones del servidor quedan a nombre del usuario real, con su IP", t);
await as(MARIA, "select public.erp_audit_client_event($1, 'auth.login', '{\"via\":\"web\"}'::jsonb)", [A]);
ok((await raw("select count(*)::int n from public.erp_audit_logs where action = 'auth.login' and user_id = $1", [MARIA]))[0].n === 1, "Inicio de sesión auditado");
const audM = await one(MARIA, "select public.fiscal_audit_search($1, '{}'::jsonb, 50, null) r", [A]);
ok(audM.code === "FORBIDDEN", "Auditoría solo con permiso", audM.code);
const audC = await one(CONTADOR, "select public.fiscal_audit_search($1, '{\"categories\":[\"security\"]}'::jsonb, 50, null) r", [A]);
ok(audC.ok && audC.items.length >= 3, "La contadora (tienda madre) ve los eventos de seguridad", audC.items?.length);

// Búsqueda con paginación por cursor
const p1 = await one(OWNER_A, "select public.fiscal_documents_search($1, '{\"with_totals\": true}'::jsonb, 5, null) r", [A]);
const p2 = await one(OWNER_A, "select public.fiscal_documents_search($1, '{}'::jsonb, 5, $2::jsonb) r", [A, JSON.stringify(p1.next_cursor)]);
ok(p1.items.length === 5 && p1.next_cursor && p2.items.length === 5 && !p2.items.some((x) => p1.items.find((y) => y.id === x.id)) && p1.totals.count > 10,
  "Búsqueda paginada por cursor (sin repetir) con totales", { c: p1.totals });
const q = await one(OWNER_A, "select public.fiscal_documents_search($1, '{\"q\": \"NCM\"}'::jsonb, 10, null) r", [A]);
ok(q.items.length === 2, "Búsqueda por prefijo/número", q.items.length);
const det = await one(CONTADOR, "select public.fiscal_document_detail($1) r", [DOC_M1]);
ok(det.ok && det.related.length === 2 && det.range.prefix === "MA" && det.events.length > 5 && det.audit.length > 0,
  "Detalle con trazabilidad: notas relacionadas, resolución, eventos y auditoría", { rel: det.related?.length });

// Contingencia
r = await one(CONTADOR, "select public.fiscal_contingency_start($1, $2, 'provider', 'Proveedor caído') r", [A, P_MARIA]);
const CT = r.id;
const sC = await sale(A, [[P2, 1, 4000]]);
res = await issue(MARIA, A, sC.token, P_MARIA);
ok(res.ok && res.status === "CONTINGENCY", "En contingencia el documento queda en cola (CONTINGENCY)", res);
const cl = (await service("select public.fiscal__claim($1) r", [res.document_id]))[0].r;
ok(!cl.ok && cl.code === "CONTINGENCY", "   y no se transmite mientras siga abierta", cl);
r = await one(CONTADOR, "select public.fiscal_contingency_end($1, 'Proveedor restablecido') r", [CT]);
ok(r.ok && r.requeued === 1, "   Al cerrarla, vuelve a la cola para transmitirse", r);
const due = (await service("select array_agg(x)::text[] ids from public.fiscal__due_documents(50) x"))[0].ids ?? [];
ok(due.includes(res.document_id), "   El proceso automático lo toma", due.length);

// Envío: permisos del servidor
r = await one(JAVIER, "select public.fiscal_can_send($1) r", [res.document_id]);
ok(!r.ok, "Javier no puede enviar documentos de María", r);
r = await one(CAJERO, "select public.fiscal_can_send($1) r", [res.document_id]);
ok(!r.ok, "El cajero no reenvía lo que no emitió", r);

// Puntos: estados, asistente y expediente
r = await one(MARIA, "select public.erp_point_set_status($1, 'suspended', 'probar') r", [P_MARIA]);
ok(!r.ok && r.code === "FORBIDDEN", "Un usuario de punto no suspende puntos", r);
r = await one(OWNER_A, "select public.erp_point_set_status($1, 'suspended', null) r", [P_SARA]);
ok(!r.ok && r.code === "REASON_REQUIRED", "Suspender exige motivo", r);
r = await one(OWNER_A, "select public.erp_point_set_status($1, 'suspended', 'Remodelación del local') r", [P_SARA]);
ok(r.ok && (await raw("select active from public.erp_warehouses where id = $1", [P_SARA]))[0].active === false, "Punto suspendido deja de operar", r);
const wizBad = await one(OWNER_A, "select public.erp_point_wizard_create($1, $2::jsonb) r", [A, JSON.stringify({
  point: { name: "Punto Juan", code: "JUAN" },
  entity: { mode: "new", person_type: "natural", legal_name: "Juan Díaz", document_type: "NIT", document_number: "1020304050" },
  numbering: { mode: "new", document_type: "invoice", prefix: "JU", range_from: 100, range_to: 1 } })]);
ok(!wizBad.ok && (await raw("select count(*)::int n from public.erp_warehouses where code = 'JUAN'"))[0].n === 0, "Asistente: si un paso falla no queda nada a medias", wizBad);
const wiz = await one(OWNER_A, "select public.erp_point_wizard_create($1, $2::jsonb) r", [A, JSON.stringify({
  point: { name: "Punto Juan", code: "JUAN", address: "CALLE 5", responsible_name: "Juan Díaz" },
  entity: { mode: "new", person_type: "natural", legal_name: "Juan Díaz", document_type: "NIT", document_number: "1020304050", tax_regime: "simple",
            tax_responsibilities: ["O-47"], economic_activities: ["4719"], fiscal_address: "CALLE 5", city: "Bello", department: "Antioquia", email: "juan@x.co", status: "active" },
  establishment: { mode: "new", name: "Sede Juan", code: "01", address: "CALLE 5", city: "Bello", department: "Antioquia" },
  provider: { mode: "new", provider: "sandbox", environment: "sandbox", label: "Pruebas Juan" },
  numbering: { mode: "new", document_type: "invoice", prefix: "JU", range_from: 1, range_to: 500, resolution_number: "18764000001", resolution_date: "2026-01-01", valid_from: "2026-01-01", valid_until: "2027-06-30", status: "active" },
  users: [{ user_id: CAJERO }], activate: true })]);
ok(wiz.ok && wiz.readiness.ready === false && wiz.readiness.checks.find((c) => c.key === "connection").ok === false, "Asistente crea el punto completo; queda pendiente solo la prueba de conexión/activación", wiz.readiness?.missing);
ok((await raw("select point_id from public.store_users where user_id = $1", [CAJERO]))[0].point_id === wiz.point_id, "   y asigna los usuarios elegidos");
const dos = await one(OWNER_A, "select public.erp_point_dossier($1) r", [P_MARIA]);
ok(dos.ok && dos.readiness && dos.users && dos.inventory && dos.sales && dos.audit, "Expediente del punto con todas las secciones", Object.keys(dos));
const dosJ = await one(JAVIER, "select public.erp_point_dossier($1) r", [P_JAVIER]);
ok(dosJ.ok && dosJ.users === undefined, "Expediente: cada sección según permisos", Object.keys(dosJ));
const pov = await one(OWNER_A, "select public.erp_points_overview($1) r", [A]);
ok(pov.ok && pov.points.length >= 6, "Lista de puntos de la tienda madre", pov.points?.length);
const povM = await one(MARIA, "select public.erp_points_overview($1) r", [A]);
ok(povM.ok && povM.points.length === 1, "Un usuario de punto solo ve su punto", povM.points?.length);

// Expediente fiscal exportable y centro de operaciones
const dsr = await one(CONTADOR, "select public.fiscal_dossier($1, $2, current_date - 5, current_date, null, null) r", [A, P_MARIA]);
ok(dsr.ok && dsr.documents_count >= 5 && dsr.ranges.some((x) => x.voided_unsent.length === 1), "Expediente fiscal del punto (documentos, numeración, anulados sin transmitir)", dsr.documents_count);
r = await one(MARIA, "select public.fiscal_dossier($1, $2, current_date - 5, current_date, null, null) r", [A, P_MARIA]);
ok(!r.ok, "Exportar exige permiso", r);
const ops = await one(MARIA, "select public.ops_overview($1) r", [A]);
ok(ops.ok && ops.remisiones, "Centro de operaciones separado del fiscal", Object.keys(ops));

// Roles personalizados
r = await one(CONTADOR, "select public.erp_role_template_save($1, null, 'Auditor externo', '🔎', null, array['audit','fiscal_audit','fiscal_download']) r", [A]);
ok(r.ok, "Rol personalizado con permisos combinados", r);
r = await one(CONTADOR, "select public.erp_role_template_save($1, null, 'Super rol', null, null, array['pos','points']) r", [A]);
ok(!r.ok && r.code === "FORBIDDEN", "Nadie crea roles con permisos que no tiene", r);

// Ambientes: producción exige confirmación; el simulador nunca en producción
r = await one(OWNER_A, "select public.fiscal_point_config_save($1, '{\"environment\":\"production\"}'::jsonb, null, false) r", [P_MARIA]);
ok(!r.ok && r.code === "CONFIRM_PRODUCTION", "Pasar a producción exige confirmación y motivo", r);
r = await one(OWNER_A, "select public.fiscal_point_config_save($1, '{\"environment\":\"production\"}'::jsonb, 'Habilitación DIAN aprobada', true) r", [P_MARIA]);
ok(!r.ok && /no se mezclan ambientes/.test(r.message), "No se mezclan credenciales de pruebas con producción", r);
r = await one(OWNER_A, "select public.fiscal_provider_account_save($1, '{\"fiscal_entity_id\":\"" + E_MARIA + "\",\"provider\":\"sandbox\",\"environment\":\"production\"}'::jsonb, null) r", [A]);
ok(!r.ok && /producción/.test(r.message), "El simulador no se puede usar en producción", r);
r = await one(OWNER_A, "select public.fiscal_provider_account_save($1, '{\"fiscal_entity_id\":\"" + E_MARIA + "\",\"provider\":\"alegra\",\"environment\":\"sandbox\",\"settings\":{\"api_token\":\"123\"}}'::jsonb, null) r", [A]);
ok(!r.ok && /secreto/.test(r.message), "Los secretos nunca van en la configuración visible", r);

const rcpt = await (async () => { await db.exec("set role anon"); try { return (await db.query("select public.fiscal_public_receipt($1) r", [sM.token])).rows[0].r; } finally { await db.exec("reset role"); } })();
ok(rcpt && rcpt.full_number === "MA1" && rcpt.issuer.document_number === "43123456" && rcpt.resolution.number, "El comprobante público muestra número fiscal, NIT y resolución", rcpt);
// Lectura pública (anónimo)
const anonQ = async (sql) => {
  await db.exec("set role anon");
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role"); }
};
ok((await anonQ("select count(*)::int n from public.orders")).rows?.[0].n === 0, "Un visitante anónimo no puede leer las ventas (nombres/WhatsApp de clientes)");
ok((await anonQ("select count(*)::int n from public.order_items")).rows?.[0].n === 0, "   ni sus líneas");
const anonP = await anonQ("select id, name, price_retail, stock, image_url from public.products limit 1");
ok(anonP.rows && anonP.rows.length === 1, "El catálogo público sigue leyendo nombre, precio público y existencias", anonP.err);
const anonC = await anonQ("select cost_price from public.products limit 1");
ok(anonC.err && /permission denied/i.test(anonC.err), "   pero no el costo de los productos", anonC.err);
ok((await as(OWNER_B, "select count(*)::int n from public.orders where store_id = $1", [A]))[0].n === 0, "Un usuario de otra tienda no lee las ventas de la tienda A");

console.log(results.join("\n"));
console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
