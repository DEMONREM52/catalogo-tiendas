// Pruebas de 20261113: devoluciones, costo/unidades protegidos, precios por % y alertas de productos sin ingreso.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Piezas de producción que no están en los fixtures (reglas de pedidos y anulaciones).
const prod = `
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancelled_by uuid;
alter table public.orders add column if not exists cancel_reason text;
create table if not exists public.fiscal_documents (id uuid primary key default gen_random_uuid(), store_id uuid, source_id uuid, status text, sent_at timestamptz, voided_at timestamptz, void_reason text);
create table if not exists public.erp_receivable_payments (id uuid primary key default gen_random_uuid(), receivable_id uuid, voided boolean default false);
alter table public.erp_receivables add column if not exists void_reason text;
alter table public.erp_receivables add column if not exists updated_at timestamptz;
create table if not exists public.erp_sale_voids (id uuid primary key default gen_random_uuid(), store_id uuid, order_id uuid, point_id uuid, kind text, doc_kind text, doc_number text,
  status_before text, total numeric, units_returned integer, reason text, detail jsonb, created_by uuid, created_by_name text, created_at timestamptz default now());
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable as $$ select exists (select 1 from unnest(p_perms) x where public.erp_can(p_store, x)) $$;
create or replace function public.erp__audit_insert(p_store uuid, p_point uuid, p_category text, p_severity text, p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb, p_reason text, p_detail jsonb)
returns void language sql as $$ select 1 $$;
create or replace function public.prevent_order_status_downgrade() returns trigger language plpgsql as $$
begin
  if old.status in ('confirmed', 'completed') and new.status not in ('confirmed', 'completed') then
    raise exception 'ORDER_LOCKED: no se puede reabrir un pedido confirmado o completado.';
  end if;
  return new;
end $$;
drop trigger if exists prevent_order_status_downgrade on public.orders;
create trigger prevent_order_status_downgrade before update of status on public.orders for each row execute function public.prevent_order_status_downgrade();
create or replace function public.orders__cancel_guard() returns trigger language plpgsql as $$ begin return new; end $$;
drop trigger if exists orders_cancel_guard on public.orders;
create trigger orders_cancel_guard before update of status on public.orders for each row execute function public.orders__cancel_guard();
`;
const combined = path.join(os.tmpdir(), `remhub_inv_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), prod,
  ...["20261106_rentabilidad_precios_punto.sql", "20261113_inventario_precios_devoluciones.sql"].map((f) => fs.readFileSync(path.join(here, "../../supabase/migrations", f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `d1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), RET = U(3), ALERTS = U(4), EDITOR = U(5);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'SEDE ZAMORA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{pos,sales_void}',$3), ($1,$4,'seller','{pos,sales_return}',$3), ($1,$5,'seller','{inventory_alerts}',null), ($1,$6,'seller','{products}',null)", [A, SELLER, Z, RET, ALERTS, EDITOR]);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'INTERCOMUNICADOR', 104400, 138000, 138000, 138000, 138000, 138000, 6) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 6)", [Z, P, A]);
const qty = async () => Number((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [Z, P]))[0].qty);

console.log("Devolución de venta confirmada");
const r = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CONSUMIDOR FINAL') r", [A, JSON.stringify([{ product_id: P, qty: 1, price: 138000 }])]);
const [{ id: O }] = await raw("select id from orders where token = $1", [r.token]);
await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, doc_number) values ($1, $2, $3, 'remision', 'REMZ-00001')", [O, A, Z]);
await raw("update orders set status = 'confirmed', confirmed_at = now() where id = $1", [O]);
await raw("select public.erp__apply_order_stock($1)", [O]);
ok(await qty() === 5, "La venta descuenta 1 unidad (6 → 5)");
const noPerm = await one(SELLER, "select public.erp_sale_void($1, 'Error al facturar') r", [O]);
ok(noPerm.ok === false && /Devolución de venta/.test(noPerm.message), "Sin el permiso de devolución no se puede", noPerm);
const res = await one(RET, "select public.erp_sale_void($1, 'Error al facturar') r", [O]);
ok(res.ok === true && res.kind === "return" && res.units_returned === 1, "Con el permiso, la devolución pasa (antes: ORDER_LOCKED)", res);
ok(await qty() === 6, "Y el inventario vuelve exacto (5 → 6)");
ok((await raw("select status from orders where id = $1", [O]))[0].status === "cancelled", "El documento queda anulado");
ok((await one(RET, "select public.erp_sale_void($1, 'otra vez') r", [O])).code === "ALREADY", "No se puede devolver dos veces");
const r2 = await one(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'X') r", [A, JSON.stringify([{ product_id: P, qty: 1, price: 138000 }])]);
await raw("update orders set status = 'confirmed' where token = $1", [r2.token]);
ok(/ORDER_LOCKED/.test(await err(OWNER, "update orders set status = 'draft' where token = $1", [r2.token]) ?? ""), "La regla sigue impidiendo reabrir pedidos confirmados");
ok(/ORDER_LOCKED/.test(await err(OWNER, "update orders set status = 'cancelled' where token = $1", [r2.token]) ?? ""), "…y anular por fuera de la devolución autorizada");

console.log("Costo y unidades protegidos");
ok(/permission denied/i.test(await err(EDITOR, "update products set stock = 6 where id = $1", [P]) ?? ""), "Editar el producto ya no cambia las unidades");
ok(/permission denied/i.test(await err(EDITOR, "update products set cost_price = 1 where id = $1", [P]) ?? ""), "…ni el costo");
await as(EDITOR, "update products set name = 'INTERCOMUNICADOR Q58', markup_3 = 20 where id = $1", [P]);
ok((await raw("select name from products where id = $1", [P]))[0].name === "INTERCOMUNICADOR Q58", "Lo demás del producto sí se edita");

console.log("Precios por porcentaje");
const p3 = Number((await raw("select price_3 from products where id = $1", [P]))[0].price_3);
ok(p3 === 125300, "Con 20 % sobre el costo $104.400 → $125.280 → redondeado al $100 más cercano $125.300", p3);
const [{ id: N }] = await raw("insert into products (store_id, name, cost_price, stock, markup_1, markup_2, markup_3, markup_4, markup_5, created_at) values ($1, 'NUEVO', 0, 0, 15, 15, 15, 15, 15, now() - interval '2 hours') returning id", [A]);
ok(Number((await raw("select price_2 from products where id = $1", [N]))[0].price_2) === 0, "Sin costo todavía, sin precio (se calcula al ingresar la factura)");
const pend = await one(ALERTS, "select public.erp_products_pending_entry($1) r", [A]);
ok(pend.ok && pend.rows.some((x) => x.id === N), "Pasada 1 hora sin ingreso: aparece en las alertas", pend);
ok((await one(SELLER, "select public.erp_products_pending_entry($1) r", [A])).ok === false, "Quien no tiene «Alertas de inventario» no las recibe");
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROVEEDOR', true) returning id", [A]);
await one(OWNER, "select public.erp_receive_purchase($1, $2, $3, 'F-1', 'cash', null, null, $4::jsonb) r", [A, SUP, Z, JSON.stringify([{ product_id: N, qty: 10, unit_cost: 43500 }])]);
const np = (await raw("select cost_price, price_1, price_2, price_3, price_5, price_retail, price_wholesale from products where id = $1", [N]))[0];
ok(Number(np.cost_price) === 43500 && Number(np.price_2) === 50000 && Number(np.price_5) === 50000 && Number(np.price_retail) === 50000, "Al ingresar la factura (costo $43.500): precios = $43.500 + 15 % = $50.025 → $50.000", np);
ok(!(await one(ALERTS, "select public.erp_products_pending_entry($1) r", [A])).rows.some((x) => x.id === N), "Con ingreso, sale de las alertas");
await one(OWNER, "select public.erp_product_pricing_save($1, 100, 'up', 15) r", [A]);
await raw("update products set markup_2 = 15.0001 where id = $1", [N]);
ok(Number((await raw("select price_2 from products where id = $1", [N]))[0].price_2) === 50100, "Con redondeo «hacia arriba» → $50.100");
const [{ id: L }] = await raw("insert into products (store_id, name, cost_price, price_3, stock) values ($1, 'SIN PORCENTAJE', 1000, 1990, 5) returning id", [A]);
await raw("update products set cost_price = 1200 where id = $1", [L]);
ok(Number((await raw("select price_3 from products where id = $1", [L]))[0].price_3) === 1990, "Un producto sin % conserva sus precios");
await raw("select set_config('erp.skip_reprice', '1', false)");
await raw("update products set cost_price = 99999 where id = $1", [N]);
await raw("select set_config('erp.skip_reprice', '', false)");
ok(Number((await raw("select price_2 from products where id = $1", [N]))[0].price_2) === 50100, "El ajuste masivo puede pedir no recalcular precios");

console.log("Existencias por punto");
const st = await as(EDITOR, "select * from public.erp_product_stock_by_point($1)", [P]);
ok(st[0]?.name === "SEDE ZAMORA" && st[0].qty === 6 && st.every((x) => x.name === "SEDE ZAMORA" || x.qty === 0), "Muestra cuántas hay en cada punto y bodega (primero las que tienen)", st);
ok(/permission denied/i.test(await err(null, "select * from public.erp_product_stock_by_point($1)", [P]) ?? ""), "Sin sesión: bloqueado");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
