// Pruebas de 20261123: «Ver costos», «Informes de ventas», «Cambiar precios», «Anular compras» y huecos de punto.
// Las funciones son las de PRODUCCIÓN (fixtures/prod_permisos.sql), con saltos de línea de Windows como en la base real.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const M23 = fs.readFileSync(path.join(MIG, "20261123_permisos_costos_informes.sql"), "utf8");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
-- Buscador (20261016): versiones simples; las pruebas no buscan texto.
create or replace function public.rh_norm(p text) returns text language sql immutable as $$ select lower(coalesce(p, '')) $$;
create or replace function public.rh_tokens(p text) returns text[] language sql immutable as $$ select case when coalesce(btrim(p), '') = '' then '{}'::text[] else string_to_array(lower(btrim(p)), ' ') end $$;
create or replace function public.rh_score(p_hay text, p_tokens text[], p_phrase text default null) returns numeric language sql immutable as $$ select 0::numeric $$;
create or replace function public.erp__in_category(p_product uuid, p_category uuid, p_filter uuid) returns boolean language sql stable as $$ select p_filter is null or p_category = p_filter $$;
alter table public.products add column if not exists markup_1 numeric(9, 4);
alter table public.products add column if not exists markup_2 numeric(9, 4);
alter table public.products add column if not exists markup_3 numeric(9, 4);
alter table public.products add column if not exists markup_4 numeric(9, 4);
alter table public.products add column if not exists markup_5 numeric(9, 4);
alter table public.erp_purchases add column if not exists cancelled_at timestamptz;
alter table public.erp_purchases add column if not exists cancelled_by uuid;
`;
const combined = path.join(os.tmpdir(), `remhub_pc_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261118_compras_desde_punto.sql", "20261120_permisos_exportar_y_punto.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_permisos.sql"), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
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

// Como en producción (20261107/20261114): el costo no se lee directo.
await db.exec(`revoke select on public.products from authenticated;
  grant select (id, store_id, name, sku, barcode, stock, active, image_url, category_id, created_at, updated_at, track_inventory, tax_rate,
    price_1, price_2, price_3, price_4, price_5, price_retail, price_wholesale, markup_1, markup_2, markup_3, markup_4, markup_5) on public.products to authenticated;
  grant update (name, price_1, price_2, price_3, price_4, price_5, price_retail, price_wholesale, markup_1, markup_2, markup_3, markup_4, markup_5, active) on public.products to authenticated;`);

const U = (n) => `c7000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PROD = U(2), AUD = U(3), COMPRAS = U(4), VEND = U(5), SARA = U(6), CREADOR = U(7);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CISNEROS', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id) values
  ($1,$2,'seller','{products,inventory}',null), ($1,$3,'seller','{audit}',null), ($1,$4,'seller','{purchases,payables,suppliers}',null),
  ($1,$5,'seller','{pos}',null), ($1,$6,'seller','{purchases,payables,inventory,costs_view}',$8), ($1,$7,'seller','{products}',null)`,
  [A, PROD, AUD, COMPRAS, VEND, SARA, CREADOR, Z]);
const perms = async (u) => (await raw("select permissions from store_users where user_id = $1", [u]))[0].permissions;

console.log("1. La migración se aplica sobre las funciones reales de producción");
await db.exec(M23);
ok(true, "Se aplicó sin errores (saltos de línea de Windows)");
ok((await perms(PROD)).includes("costs_view") && (await perms(PROD)).includes("products_prices"), "Quien editaba productos conserva costos y precios");
ok((await perms(AUD)).includes("reports"), "Quien tenía Auditoría recibe «Informes de ventas»");
ok((await perms(COMPRAS)).includes("costs_view") && (await perms(COMPRAS)).includes("purchases_void"), "Compras conserva costos y «Anular compras»");
ok(!(await perms(VEND)).some((p) => ["costs_view", "reports", "products_prices", "purchases_void"].includes(p)), "Un vendedor de POS no recibe nada nuevo");
// El dueño le quita permisos al «creador de productos»; volver a correr la migración no se los devuelve.
await raw("update store_users set permissions = '{products}' where user_id = $1", [CREADOR]);
await db.exec(M23);
ok(JSON.stringify(await perms(CREADOR)) === '["products"]', "Correrla otra vez no devuelve permisos quitados", await perms(CREADOR));
const def = async (fn) => (await raw("select string_agg(pg_get_functiondef(p.oid), ' ') d from pg_proc p where p.proname = $1", [fn]))[0].d;
ok((await def("erp_report")).includes("'reports'") && (await def("erp_report")).includes("erp__mask_report"), "Informe: permiso propio + costos ocultos");
ok((await def("erp_update_purchase")).includes("Costo promedio"), "Lo que no se debía tocar sigue igual");

console.log("2. Datos de prueba");
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROV', true) returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock, price_1) values ($1, 'OLLAS', 0, 30000) returning id", [A]);
let k = 0;
const buy = (u, wh, credit = false) => as(u, `select public.erp_receive_invoice($1, $2, $3, current_date, '${credit ? "credit" : "cash"}', ${credit ? "current_date + 30" : "null"}, null, 'X', $4::jsonb) r`,
  [A, SUP, `F-${++k}`, JSON.stringify([{ product_id: P, qty: 10, unit_cost: 18000, warehouse_id: wh }])]);
await buy(COMPRAS, B, true);
await buy(SARA, Z, true);
ok(Number((await raw("select cost_price c from products where id = $1", [P]))[0].c) === 18000, "Compras sin «Cambiar precios» ingresa facturas (el costo se actualiza)");

console.log("3. Ver costos");
const page = async (u) => (await as(u, "select cost_price from public.erp_stock_page($1, null, false, 10, 0)", [A]))[0]?.cost_price;
ok(Number(await page(PROD)) === 18000, "Con «Ver costos»: existencias muestran el costo");
ok((await page(CREADOR)) === null, "Sin «Ver costos»: el costo llega vacío desde la base");
ok(/permiso/.test((await err(CREADOR, "select * from public.erp_product_costs($1, $2)", [A, [P]])) ?? ""), "Sin «Ver costos»: no puede pedir costos");
ok(Number((await as(PROD, "select cost_price from public.erp_product_costs($1, $2)", [A, [P]]))[0].cost_price) === 18000, "Con «Ver costos»: sí");
ok(/permission denied/.test((await err(CREADOR, "select cost_price from products")) ?? ""), "El costo tampoco se lee directo de la tabla");
ok(/permission denied/.test((await err(CREADOR, "select markup_1 from products")) ?? ""), "Ni el % de ganancia (con él se deduce el costo)");
ok(/permiso/.test((await err(CREADOR, "select * from public.erp_product_markups($1, $2)", [A, [P]])) ?? ""), "El % solo se pide con «Ver costos»");
ok((await as(PROD, "select * from public.erp_product_markups($1, $2)", [A, [P]])).length === 1, "…y con el permiso, sí");
const kardex = async (u, wh) => as(u, "select unit_cost, warehouse_name from public.erp_kardex($1, null, $2, null, null)", [A, wh]);
ok((await kardex(PROD, null)).every((r) => r.unit_cost !== null), "Kardex con «Ver costos»: muestra costo");
await raw("update store_users set permissions = array_remove(permissions, 'costs_view') where user_id = $1", [PROD]);
ok((await kardex(PROD, null)).every((r) => r.unit_cost === null) && (await kardex(PROD, null)).length > 0, "Kardex sin «Ver costos»: movimientos sí, costo no");
const ov = (await as(PROD, "select public.erp_overview($1) r", [A]))[0].r;
ok(ov.inventory_value === null && ov.units > 0, "Resumen sin «Ver costos»: unidades sí, valor no", ov);
await raw("update store_users set permissions = array_append(permissions, 'costs_view') where user_id = $1", [PROD]);
ok(Number((await as(PROD, "select public.erp_overview($1) r", [A]))[0].r.inventory_value) > 0, "Resumen con «Ver costos»: valor del inventario");

console.log("4. Informe de ventas");
ok(/Informes de ventas/.test((await err(VEND, "select public.erp_report($1, now() - interval '1 day', now(), null)", [A])) ?? ""), "Sin «Informes de ventas» no entra");
await raw("select set_config('test.uid', $1, false)", [AUD]);
const masked = (await raw(`select public.erp__mask_report($1, '{"kpis":{"sales":100,"cost":60},"previous":{"cost":5},"series":[{"sales":1,"profit":1}],"by_point":[{"profit":2}],"top_products":[{"profit":3}],"inventory":[{"value":9,"units":2}],"purchases":{"total":7}}'::jsonb) v`, [A]))[0].v;
await raw("select set_config('test.uid', '', false)");
ok(masked.kpis.sales === 100 && masked.kpis.cost === null && masked.series[0].profit === null && masked.inventory[0].value === null
   && masked.inventory[0].units === 2 && masked.purchases === null && masked.costs_hidden, "Sin «Ver costos»: ventas sí; costo, ganancia, valor y compras no", masked);

console.log("5. Usuario de punto (SARA, Zamora)");
ok((await kardex(SARA, B)).length === 0 && (await kardex(SARA, Z)).length > 0, "Kardex: no ve la bodega, sí su punto");
ok((await kardex(SARA, null)).every((r) => r.warehouse_name === "ZAMORA"), "Kardex sin filtro: solo Zamora");
ok(/solo para la tienda madre/.test((await err(SARA, "select public.erp_overview($1)", [A])) ?? ""), "Resumen general: solo la madre");
const [{ id: apB }] = await raw("select a.id from erp_payables a join erp_purchases p on p.id = a.purchase_id where p.warehouse_id = $1", [B]);
ok(/otro punto/.test((await err(SARA, "select public.erp_pay_supplier($1, 1000, 'cash', null)", [apB])) ?? ""), "No puede pagar una cuenta de la bodega");
const [{ id: apZ }] = await raw("select a.id from erp_payables a join erp_purchases p on p.id = a.purchase_id where p.warehouse_id = $1", [Z]);
await as(SARA, "select public.erp_pay_supplier($1, 1000, 'cash', null)", [apZ]);
ok(Number((await raw("select balance from erp_payables where id = $1", [apZ]))[0].balance) === 179000, "Sí paga la de su punto");
await raw(`insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id) values ($1, 1, $2, $3), ($1, 2, $2, $4)`, [A, B, Z, C]);
await raw(`insert into erp_adjustments (store_id, number, warehouse_id, reason) values ($1, 1, $2, 'count'), ($1, 2, $3, 'count')`, [A, Z, C]);
ok((await as(SARA, "select number from erp_transfers")).map((r) => Number(r.number)).join() === "1", "Traslados: solo los de su punto");
ok((await as(OWNER, "select number from erp_transfers")).length === 2, "La madre los ve todos");
ok((await as(SARA, "select number from erp_adjustments")).length === 1, "Ajustes: solo los de su punto");
ok((await as(SARA, "update erp_warehouses set name = 'X' where id = $1 returning id", [C])).length === 0, "No puede cambiar otro punto");
ok((await as(SARA, "update erp_warehouses set phone = '300' where id = $1 returning id", [Z])).length === 1, "Sí edita los datos de su propio punto");
ok(/row-level security|violates/.test((await err(SARA, "insert into erp_warehouses (store_id, code, name, kind) values ($1, 'N', 'NUEVO', 'point')", [A])) ?? ""), "No puede crear puntos");
ok((await as(PROD, "update erp_warehouses set name = 'CISNEROS 2' where id = $1 returning id", [C])).length === 1, "La madre con «Inventario» sí");

console.log("6. Precios y anulación de compras");
ok(/Cambiar precios/.test((await err(CREADOR, "update products set price_1 = 1 where id = $1", [P])) ?? ""), "Sin «Cambiar precios»: no cambia el precio");
ok(/Cambiar precios/.test((await err(CREADOR, "update products set markup_1 = 50 where id = $1", [P])) ?? ""), "…ni el %");
ok((await as(CREADOR, "update products set name = 'OLLAS X' where id = $1 returning id", [P])).length === 1, "…pero sí edita el nombre");
ok((await as(PROD, "update products set price_1 = 31000 where id = $1 returning id", [P])).length === 1, "Con «Cambiar precios»: sí");
const [{ id: NEWP }] = await as(CREADOR, "insert into products (store_id, name, markup_1, markup_2) values ($1, 'NUEVO', 500, 300) returning id", [A]);
const nm = (await raw("select markup_1, markup_2, markup_5 from products where id = $1", [NEWP]))[0];
ok(Number(nm.markup_1) === 15 && Number(nm.markup_2) === 15 && Number(nm.markup_5) === 15, "Al crear sin «Cambiar precios» se usa el % de la tienda, no el que mandó", nm);
const [{ id: NEWQ }] = await as(PROD, "insert into products (store_id, name, markup_1) values ($1, 'NUEVO 2', 40) returning id", [A]);
ok(Number((await raw("select markup_1 from products where id = $1", [NEWQ]))[0].markup_1) === 40, "Con «Cambiar precios» respeta el % escogido");
const [{ id: purB }] = await raw("select id from erp_purchases where warehouse_id = $1", [B]);
await raw("update store_users set permissions = array_remove(permissions, 'purchases_void') where user_id = $1", [COMPRAS]);
ok(/Anular compras/.test((await err(COMPRAS, "select public.erp_cancel_purchase($1, 'error')", [purB])) ?? ""), "Sin «Anular compras» no anula");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
