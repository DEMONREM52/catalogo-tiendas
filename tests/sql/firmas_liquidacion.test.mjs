// Pruebas de 20261290: firmas virtuales de las liquidaciones y a quién va la revisión.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_fl_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql",
  "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261208_liquidacion_ganancia_total.sql", "migraciones/20261286_anticipos_liquidacion.sql",
  "migraciones/20261288_gastos_compartidos_liquidacion.sql", "migraciones/20261289_anticipos_al_costo.sql", "migraciones/20261290_firmas_liquidacion.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
await db.exec(fs.readFileSync(path.join(here, "migraciones/20261290_firmas_liquidacion.sql"), "utf8")); // se puede correr dos veces

const U = (n) => `f4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), MADRE = U(2), APPROVER = U(3), OTHERPT = U(4), SELLER = U(7);
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
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, name]))[0].id;
const Z = await wh("ZAMORA"), M = await wh("MARIA");
const member = (uid, perms, point, name) => raw("insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values ($1, $2, 'seller', $3, $4, $5)", [A, uid, perms, point, name]);
await member(MADRE, ["profit_beneficiaries", "profit_settle", "profit_view"], null, "SARA");
await member(APPROVER, ["profit_settle_approve", "profit_view"], null, "JAVIER");
await member(OTHERPT, ["profit_settle_approve", "profit_view"], M, "ANA DE MARIA");
await member(SELLER, ["pos"], Z, "VENDEDOR");
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ORGANIZADOR', 15000, 20000, 17000, 15750, 18000, 19000, 100) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [Z, P, A]);
const r = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty: 2, price: 18112.5 }])]);
const [{ id: O }] = await raw("select id from orders where token = $1", [r.token]);
await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [O, A, Z]);
await raw("update orders set status = 'confirmed', confirmed_at = now() - interval '1 minute' where id = $1", [O]);
await raw("select public.erp__apply_order_stock($1)", [O]);
const ben = (name) => one(MADRE, "select public.erp_beneficiary_save($1, null, $2, $3, 'partner', null, null, true) r", [A, Z, name]);
const bM = (await ben("LOS MELLOS")).id, bR = (await ben("ROBIN Y JUAN")).id;
await one(MADRE, "select public.erp_split_save($1, $2, $3::jsonb, 'Acuerdo') r", [A, Z, JSON.stringify([{ beneficiary_id: bM, pct: 50 }, { beneficiary_id: bR, pct: 50 }])]);
await one(MADRE, "select public.erp_pool_settings_save($1, $2, 'total', now() - interval '1 day', false, null) r", [A, Z]);
const s = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);

console.log("1. A quién va la revisión");
let signs = await one(MADRE, "select public.erp_settlement_signs($1) r", [s.id]);
const names = signs.approvers.map((a) => a.name);
ok(names.includes("JAVIER") && !names.includes("SARA"), "Aprueban JAVIER (y el dueño); SARA no, porque la preparó", names);
ok(!names.includes("ANA DE MARIA"), "Un aprobador de otro punto (MARÍA) no aprueba las de ZAMORA", names);
await one(MADRE, "select public.erp_settlement_transition($1, 'submit', null) r", [s.id]);
const aud = (await raw("select user_id from public.erp_settlement_push_audience($1, 'submitted')", [s.id])).map((x) => x.user_id);
ok(aud.includes(APPROVER) && aud.includes(OWNER) && !aud.includes(MADRE), "Al enviar a revisión se avisa a los que aprueban", aud);

console.log("2. Enlace y firmas");
const link = await one(MADRE, "select public.erp_settlement_sign_link($1) r", [s.id]);
ok(/^[a-f0-9]{64}$/.test(link.token), "Enlace para firmar", link);
let g = await one(null, "select public.settlement_sign_get($1) r", [link.token]);
ok(g.ok && g.terms.lines.length === 2 && !g.can_sign_prepared, "Sin sesión se ve la liquidación pero no se firma como responsable", g.terms);
ok(/sesión de RemHub/.test((await err(null, "select public.settlement_sign($1, 'prepared', null, 'SARA', null, $2, true)", [link.token, PNG])) ?? ""), "Sin sesión no se firma como quien preparó");
g = await one(MADRE, "select public.settlement_sign($1, 'prepared', null, 'Sara Torres', null, $2, true) r", [link.token, PNG]);
ok(g.signatures.some((x) => x.role === "prepared" && x.name === "SARA TORRES"), "SARA firma como quien preparó", g.signatures);
ok(/ya firmó/.test((await err(MADRE, "select public.settlement_sign($1, 'prepared', null, 'Sara Torres', null, $2, true)", [link.token, PNG])) ?? ""), "No se firma dos veces");
ok(/Primero hay que aprobar/.test((await err(APPROVER, "select public.settlement_sign($1, 'approved', null, 'Javier', null, $2, true)", [link.token, PNG])) ?? ""), "La aprobación se firma después de aprobar");
await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', null) r", [s.id]);
await one(APPROVER, "select public.settlement_sign($1, 'approved', null, 'Javier Garcia', '1053', $2, true) r", [link.token, PNG]);
ok(/cédula/.test((await err(null, "select public.settlement_sign($1, 'beneficiary', $2, 'LOS MELLOS', '', $3, true)", [link.token, bM, PNG])) ?? ""), "El beneficiario debe escribir su cédula o NIT");
ok(/de acuerdo/.test((await err(null, "select public.settlement_sign($1, 'beneficiary', $2, 'LOS MELLOS', '1234567', $3, false)", [link.token, bM, PNG])) ?? ""), "Debe marcar que está de acuerdo");
ok(/beneficiario/.test((await err(null, "select public.settlement_sign($1, 'beneficiary', $2, 'XXXX', '1234567', $3, true)", [link.token, U(99), PNG])) ?? ""), "Solo los beneficiarios de esta liquidación");
await one(null, "select public.settlement_sign($1, 'beneficiary', $2, 'Los Mellos', '1234567', $3, true) r", [link.token, bM, PNG]);
signs = await one(MADRE, "select public.erp_settlement_signs($1) r", [s.id]);
ok(signs.signatures.length === 3 && signs.signatures.every((x) => x.signature.startsWith("data:image/png")), "Quedan 3 firmas con su imagen", signs.signatures.map((x) => x.role));
const audit = await raw("select count(*)::int c from erp_audit_logs where action = 'settlement.signed'").catch(() => [{ c: -1 }]);
ok(audit[0].c !== 0, "Cada firma queda en la auditoría", audit);
const stored = (await raw("select terms, terms_hash from erp_settlement_signatures where role = 'beneficiary'"))[0];
ok(stored.terms.lines.some((l) => l.name === "LOS MELLOS") && stored.terms_hash.length === 32, "Guarda copia de lo que se firmó y su huella", stored.terms);
const aud2 = (await raw("select user_id from public.erp_settlement_push_audience($1, 'approved')", [s.id])).map((x) => x.user_id);
ok(aud2.includes(MADRE), "Al aprobar se le avisa a quien la preparó", aud2);

console.log("3. Rechazada o revertida no se firma");
await one(APPROVER, "select public.erp_settlement_transition($1, 'revert', 'Error en el corte') r", [s.id]);
ok(/rechazada o revertida/.test((await err(null, "select public.settlement_sign($1, 'beneficiary', $2, 'Robin', '7654321', $3, true)", [link.token, bR, PNG])) ?? ""), "Revertida: ya no se firma");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
