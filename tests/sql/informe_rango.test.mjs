// Pruebas de 20261291: informe de ventas, costo y ganancia por rango exacto (fecha y hora, hora Colombia).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_ir_${process.pid}.sql`);
// erp_can_any existe en producción; el esquema base de pruebas no la trae (igual que en permisos_temporales).
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
`;
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261109_repartos_liquidaciones.sql",
  "migraciones/20261110_gastos_presupuestos_nomina.sql"].map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra,
  fs.readFileSync(path.join(here, "migraciones/20261291_informe_rango.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `f5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), REPORTS = U(2), ZUSER = U(3), SELLER = U(7), NOBODY = U(8);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const n = (v) => Number(v);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, name]))[0].id;
const Z = await wh("ZAMORA"), M = await wh("MARIA");
const member = (uid, perms, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', $3, $4)", [A, uid, perms, point]);
await member(REPORTS, ["reports"], null);
await member(ZUSER, ["profit_view"], Z);
await member(SELLER, ["pos"], null);
await member(NOBODY, ["pos"], null);
const [{ id: P }] = await raw("insert into products (store_id, name, sku, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ORGANIZADOR', 'ORG1', 15000, 20000, 17000, 15750, 18000, 19000, 100) returning id", [A]);
for (const w of [Z, M]) await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [w, P, A]);
const sale = async (point, at, qty, seller) => {
  const r = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty, price: 20000 }])]);
  const [{ id }] = await raw("select id from orders where token = $1", [r.token]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, seller_name) values ($1, $2, $3, 'remision', $4)", [id, A, point, seller]);
  await raw("update orders set status = 'confirmed', confirmed_at = $2::timestamptz where id = $1", [id, at]);
  await raw("select public.erp__apply_order_stock($1)", [id]);
};
// Tu ejemplo: del 12/10/2026 al mediodía al 30/10/2026 al final del día (hora Colombia, −05).
await sale(Z, "2026-10-12T11:59:00-05:00", 1, "ANA");  // antes del mediodía → fuera
await sale(Z, "2026-10-12T12:00:00-05:00", 2, "ANA");  // justo al mediodía → dentro
await sale(Z, "2026-10-20T15:30:00-05:00", 1, "LUIS"); // dentro
await sale(M, "2026-10-30T23:59:00-05:00", 3, "LUIS"); // último minuto del 30 → dentro
await sale(Z, "2026-10-31T00:00:00-05:00", 5, "ANA");  // ya es el 31 → fuera
const [{ id: CAT }] = await raw("insert into erp_expense_categories (store_id, name) values ($1, 'Transporte') returning id", [A]).catch(async () => raw("select id from erp_expense_categories limit 1"));
await raw("insert into erp_expenses (store_id, point_id, category_id, number, description, amount, incurred_on, status) values ($1, $2, $3, 1, 'Flete', 7000, '2026-10-15', 'pending')", [A, Z, CAT]);
await raw("insert into erp_expenses (store_id, point_id, category_id, number, description, amount, incurred_on, status) values ($1, $2, $3, 2, 'Fuera', 9000, '2026-11-02', 'pending')", [A, Z, CAT]);

const FROM = "2026-10-12T12:00:00-05:00", TO = "2026-10-31T00:00:00-05:00";
const rep = (uid, pts = null) => one(uid, "select public.erp_sales_range_report($1, $2, $3, $4) r", [A, FROM, TO, pts]);

console.log("1. El rango con hora exacta");
let r = await rep(OWNER);
ok(r.ok && n(r.totals.units) === 6 && n(r.totals.orders) === 3, "Entran 3 ventas (6 unidades): la de las 11:59 del 12 y la del 31 quedan fuera", r.totals);
ok(n(r.totals.revenue) === 120000 && n(r.totals.cost) === 90000 && n(r.totals.profit) === 30000, "Ventas $120.000 · costo $90.000 · ganancia $30.000", r.totals);
ok(n(r.totals.expenses) === 7000, "Gastos del rango: $7.000 (el de noviembre no cuenta)", r.totals);
ok(r.points.length === 2 && n(r.points.find((p) => p.name === "MARIA").revenue) === 60000, "Por punto: MARÍA $60.000 (la venta de las 11:59 p. m. del 30)", r.points);
ok(r.days.map((d) => d.day).join(",") === "2026-10-12,2026-10-20,2026-10-30", "Día por día en hora Colombia", r.days);
ok(r.sellers.find((s) => s.seller === "LUIS").orders === 2 && r.products[0].name === "ORGANIZADOR", "Por vendedor y productos más vendidos", { s: r.sellers, p: r.products });

console.log("2. Permisos y alcance");
r = await rep(REPORTS);
ok(r.ok && r.totals.cost === null && r.totals.profit === null && n(r.totals.revenue) === 120000, "Con «Informes de ventas» sin «Ver costos»: ve ventas pero no costo ni ganancia", r.totals);
r = await rep(ZUSER);
ok(r.ok && r.points.length === 1 && r.points[0].name === "ZAMORA" && n(r.totals.revenue) === 60000, "Un usuario de ZAMORA solo ve ZAMORA", r.points);
r = await rep(ZUSER, [M]);
ok(r.ok && r.points.length === 0 && n(r.totals.revenue) === 0, "Aunque pida otro punto, no lo ve", r.totals);
r = await rep(OWNER, [M]);
ok(n(r.totals.revenue) === 60000, "Filtrar por un punto", r.totals);
r = await rep(NOBODY);
ok(!r.ok, "Sin permiso de informes no ve nada", r);
r = await one(OWNER, "select public.erp_sales_range_report($1, $2, $3, null) r", [A, TO, FROM]);
ok(!r.ok && /después/.test(r.error), "La fecha final debe ser después de la inicial", r);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
