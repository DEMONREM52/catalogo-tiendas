// Pruebas de 20261287: la ganancia de las ventas de un punto con el ÚLTIMO costo (el del precio), y la
// corrección de ventas ya hechas sin tocar las que están en liquidaciones aprobadas.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_cu_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261113_inventario_precios_devoluciones.sql", "20261118_compras_desde_punto.sql",
      "20261119_costo_promedio_y_precio_directo.sql", "20261206_precio_ultimo_costo.sql", "20261109_repartos_liquidaciones.sql", "20261110_gastos_presupuestos_nomina.sql",
      "20261208_liquidacion_ganancia_total.sql", "20261286_anticipos_liquidacion.sql", "20261287_costo_ultimo_en_liquidacion.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const U = (n) => `c7000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), MADRE = U(3), APPROVER = U(4), ZUSER = U(5);
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid]); await db.exec("set role authenticated"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (uid, s, p) => { try { await as(uid, s, p); return null; } catch (e) { return e.message; } };
const n = (v) => Number(v);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'LA VITRINA', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'SEDE ZAMORA', true, 'point') returning id", [A]);
const member = (uid, perms, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', $3, $4)", [A, uid, perms, point]);
await member(SELLER, ["pos"], Z);
await member(MADRE, ["profit_beneficiaries", "profit_settle", "profit_view"], null);
await member(APPROVER, ["profit_settle_approve", "profit_view"], null);
await member(ZUSER, ["profit_settle", "profit_view"], Z);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROVEEDOR', true) returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, stock, markup_1, markup_2, markup_3, markup_4, markup_5) values ($1, 'CARRITO ORGANIZADOR DE 4 NIVELES RHOG131', 0, 0, 0, 0, 0, 0, 0) returning id", [A]);
const invoice = (ref, wh, qty, cost) => as(OWNER, "select public.erp_receive_invoice(p_store => $1, p_supplier => $2, p_invoice_ref => $3, p_invoice_date => current_date, p_payment_type => 'cash', p_due_date => null, p_notes => null, p_checked_by => 'X', p_items => $4::jsonb) r",
  [A, SUP, ref, JSON.stringify([{ product_id: P, qty, unit_cost: cost, warehouse_id: wh }])]);
const sale = async (price) => {
  const r = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty: 1, price }])]);
  const [{ id }] = await raw("select id from orders where token = $1", [r.token]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, Z]);
  await raw("update orders set status = 'confirmed', confirmed_at = now() - interval '1 minute' where id = $1", [id]);
  await raw("select public.erp__apply_order_stock($1)", [id]);
  return id;
};
const fin = async (order) => (await raw("select unit_cost::float u, profit::float p, cost_source s from erp_sale_finance where order_id = $1", [order]))[0];

console.log("Tu caso: inventario inicial en Zamora a $33.800 y después la madre compra a $20.000");
await invoice("INICIAL", Z, 10, 33800);
await raw("select pg_sleep(0.01)");
await invoice("F-2", B, 10, 20000);
// Las facturas son de antes de las ventas (la prueba corre en segundos).
await raw("update erp_purchases set created_at = created_at - interval '2 hours' where store_id = $1", [A]);
const pr = (await raw("select cost_price::float avg, last_cost::float last from products where id = $1", [P]))[0];
ok(pr.avg === 26900 && pr.last === 20000, "Costo promedio $26.900 · último costo $20.000", pr);
ok(n((await raw("select public.erp__last_cost_at($1, now()) c", [P]))[0].c) === 20000, "Último costo a hoy: el de la factura más reciente");

const s1 = await sale(23000);
ok((await fin(s1)).u === 26900 && (await fin(s1)).p === -3900, "Como hoy (promedio): vendido a $23.000 sale con pérdida de $3.900", await fin(s1));

console.log("Activar el último costo en Zamora");
ok(/tienda madre/.test((await err(ZUSER, "select public.erp_pool_cost_basis_save($1, $2, 'last')", [A, Z])) ?? ""), "Un usuario del punto no lo cambia");
await one(MADRE, "select public.erp_pool_cost_basis_save($1, $2, 'last') r", [A, Z]);
const cfg = await one(MADRE, "select public.erp_pool_cost_basis_get($1, $2) r", [A, Z]);
ok(cfg.basis === "last" && cfg.can_edit, "Queda activado y la madre lo puede editar", cfg);
const s2 = await sale(23000);
ok((await fin(s2)).u === 20000 && (await fin(s2)).p === 3000, "Venta nueva: costo $20.000 → ganancia $3.000", await fin(s2));
ok((await fin(s1)).u === 26900, "La venta anterior no cambia sola");

console.log("Corregir ventas ya hechas");
let pv = await one(MADRE, "select public.erp_sale_finance_recost_last($1, $2, now() - interval '1 day', false) r", [A, Z]);
ok(pv.lines === 1 && n(pv.profit_change) === 6900 && !pv.applied, "Vista previa: 1 venta, la ganancia sube $6.900 (de −$3.900 a $3.000)", pv);
ok((await fin(s1)).u === 26900, "La vista previa no cambia nada");

// Una liquidación abierta frena la corrección.
const bX = (await one(MADRE, "select public.erp_beneficiary_save($1, null, $2, 'LOS MELLOS', 'partner', null, null, true) r", [A, Z])).id;
await one(MADRE, "select public.erp_split_save($1, $2, $3::jsonb, 'Acuerdo') r", [A, Z, JSON.stringify([{ beneficiary_id: bX, pct: 100 }])]);
await one(MADRE, "select public.erp_pool_settings_save($1, $2, 'total', now() - interval '1 day', false, null) r", [A, Z]);
const open = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);
ok(/descarta la liquidaci/i.test((await err(MADRE, "select public.erp_sale_finance_recost_last($1, $2, now() - interval '1 day', true)", [A, Z])) ?? ""), "Con una liquidación abierta pide descartarla primero");
await one(MADRE, "select public.erp_settlement_transition($1, 'discard', 'Corregir costos') r", [open.id]);

const ap = await one(MADRE, "select public.erp_sale_finance_recost_last($1, $2, now() - interval '1 day', true) r", [A, Z]);
ok(ap.applied && ap.lines === 1, "Corregida", ap);
ok((await fin(s1)).u === 20000 && (await fin(s1)).p === 3000 && (await fin(s1)).s === "last_cost", "La venta vieja ahora: costo $20.000, ganancia $3.000, marcada «último costo»", await fin(s1));
const audit = await raw("select count(*)::int c from erp_audit_logs where action = 'sale_finance.recost_last'").catch(() => [{ c: -1 }]);
ok(audit[0].c !== 0, "Queda en la auditoría", audit);

console.log("Lo aprobado no se toca");
const s3 = await sale(23000);
const s4 = await sale(23000);
await raw("update erp_sale_finance set unit_cost = 26900, cost_total = 26900, profit = -3900, mother_amount = -3900 - point_amount where order_id = any($1)", [[s3, s4]]);
const st = await one(MADRE, "select public.erp_settlement_calculate($1, $2, null, null) r", [A, Z]);
await one(APPROVER, "select public.erp_settlement_transition($1, 'approve', null) r", [st.id]);
await raw("update erp_sale_finance set unit_cost = 26900, cost_total = 26900, profit = -3900, mother_amount = -3900 - point_amount where order_id = $1", [s2]);
pv = await one(MADRE, "select public.erp_sale_finance_recost_last($1, $2, now() - interval '1 day', true) r", [A, Z]);
ok(pv.lines === 0 && pv.skipped_approved >= 2, "Las ventas de una liquidación aprobada se saltan (las reporta como «no tocadas»)", pv);
ok((await fin(s3)).u === 26900, "Su costo queda igual");
ok(/tienda madre/.test((await err(ZUSER, "select public.erp_sale_finance_recost_last($1, $2, now() - interval '1 day', false)", [A, Z])) ?? ""), "Un usuario del punto no corrige ventas");

console.log("Apagar");
await one(MADRE, "select public.erp_pool_cost_basis_save($1, $2, 'average') r", [A, Z]);
const s5 = await sale(23000);
ok((await fin(s5)).u === 26900, "Apagado: las ventas nuevas vuelven al promedio", await fin(s5));

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
