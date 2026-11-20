// Pruebas de 20261335: nota crédito con devolución de productos sobre una venta a crédito confirmada.
// Usa las reglas de producción (ORDER_LOCKED y orders_sync_receivable) tal como estaban antes de la migración.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$fn$;
create or replace function public.erp_can(p_store uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $fn$ select public.erp_can_any(p_store, array[p_perm]) $fn$;
create table if not exists public.erp_audit_logs (id bigserial primary key, store_id uuid, user_id uuid, action text, entity text, entity_id uuid, detail jsonb, created_at timestamptz default now());
create or replace function public.erp_audit(p_store uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $fn$
  insert into public.erp_audit_logs (store_id, user_id, action, entity, entity_id, detail) values (p_store, auth.uid(), p_action, p_entity, p_entity_id, p_detail);
$fn$;
alter table public.erp_receivables add column if not exists kind text default 'sale';
alter table public.erp_receivables add column if not exists doc_number text;
alter table public.erp_receivables add column if not exists description text;
alter table public.erp_receivables add column if not exists issue_date date default current_date;
alter table public.erp_receivables add column if not exists due_date date default current_date + 30;
alter table public.erp_receivables add column if not exists void_reason text;
alter table public.erp_receivables add column if not exists created_at timestamptz default now();
alter table public.erp_receivables add column if not exists updated_at timestamptz default now();
create table if not exists public.erp_receivable_payments (id uuid primary key default gen_random_uuid(), receivable_id uuid, amount numeric, method text,
  paid_at timestamptz default now(), voided boolean default false);
alter table public.billing_customers add column if not exists credit_enabled boolean default false;
alter table public.billing_customers add column if not exists credit_limit numeric default 0;
alter table public.billing_customers add column if not exists credit_days integer default 30;
create table if not exists public.fiscal_documents (id uuid primary key default gen_random_uuid(), store_id uuid, source_id uuid, status text, sent_at timestamptz);

-- Reglas de producción (copiadas del diagnóstico del 20/11/2026).
create or replace function public.prevent_confirmed_order_item_changes() returns trigger language plpgsql security definer set search_path to 'public', 'auth' as $fn$
declare affected_order_id uuid; order_status text;
begin
  if tg_op = 'DELETE' then affected_order_id := old.order_id; else affected_order_id := new.order_id; end if;
  select status::text into order_status from public.orders where id = affected_order_id;
  if order_status in ('confirmed', 'completed') then
    raise exception 'ORDER_LOCKED: el pedido ya fue confirmado y no admite cambios.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
create trigger prevent_confirmed_order_item_changes before insert or delete or update on public.order_items
  for each row execute function public.prevent_confirmed_order_item_changes();
create or replace function public.orders_sync_receivable() returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.total is distinct from old.total then
    update public.erp_receivables r
    set total = new.total, balance = greatest(new.total - (r.total - r.balance), 0),
        status = case when greatest(new.total - (r.total - r.balance), 0) <= 0 then 'paid' else 'open' end, updated_at = now()
    where r.order_id = new.id and r.status <> 'void';
  end if;
  return new;
end $fn$;
create trigger orders_sync_receivable after update of total on public.orders for each row execute function public.orders_sync_receivable();
`;
const combined = path.join(os.tmpdir(), `remhub_dp_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261334_credito_completo.sql", "20261335_devolucion_parcial_credito.sql"]) {
  const sql = fs.readFileSync(path.join(MIG, f), "utf8");
  await db.exec(sql);
  await db.exec(sql);
}

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return (await db.query(s, p)).rows; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const U = (n) => `dd000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CREDIT_ONLY = U(2);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into auth.users (id, email) values ($1, 'c@x.co')", [CREDIT_ONLY]);
await raw("insert into store_users (store_id, user_id, role, permissions, active) values ($1, $2, 'seller', '{credit,receivables}', true)", [S, CREDIT_ONLY]);
const [{ id: W }] = await raw("insert into erp_warehouses (store_id, code, name) values ($1, 'PT1', 'Punto 1') returning id", [S]);
const [{ id: A }] = await raw("insert into products (store_id, name, stock, cost_price) values ($1, 'CASTILLO', 10, 50000) returning id", [S]);
const [{ id: B }] = await raw("insert into products (store_id, name, stock, cost_price) values ($1, 'IRRIGADOR', 10, 8000) returning id", [S]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 10), ($1, $4, $3, 10)", [W, A, S, B]);
const [{ id: C }] = await raw("insert into billing_customers (store_id, name, document_number) values ($1, 'JULIETH MARIN', '1152695048') returning id", [S]);

// Venta a crédito: 2 castillos a 95.000 y 1 irrigador a 20.000, confirmada (sale del Punto 1).
const [{ id: O }] = await raw("insert into orders (store_id, token, status, total) values ($1, 'tok-devolucion-01', 'draft', 210000) returning id", [S]);
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 2, 95000), ($1, $3, 1, 20000)", [O, A, B]);
await raw("update orders set status = 'confirmed' where id = $1", [O]);
await raw("select erp__move($1, $2, $3, -2, 'sale', 'order', $4, null, 'Venta', null, true)", [S, W, A, O]);
await raw("select erp__move($1, $2, $3, -1, 'sale', 'order', $4, null, 'Venta', null, true)", [S, W, B, O]);
const [{ id: R }] = await raw("insert into erp_receivables (store_id, customer_id, order_id, point_id, total, balance, doc_number) values ($1, $2, $3, $4, 210000, 210000, 'REMB-00009') returning id", [S, C, O, W]);

ok(/ORDER_LOCKED/.test(await fails(() => raw("update order_items set quantity = 1 where order_id = $1 and product_id = $2", [O, A])) ?? ""), "Sin la devolución, el documento confirmado sigue bloqueado");

const ret = (uid, items, reason = "Llegó con una pieza rota") => as(uid, "select public.erp_receivable_return_items($1, $2::jsonb, $3) r", [R, JSON.stringify(items), reason]).then((x) => x[0].r);
const [{ r: lines }] = await as(OWNER, "select public.erp_receivable_return_lines($1) r", [R]);
ok(lines.ok && lines.can_return && lines.lines.length === 2, "Lista los productos del documento para elegir", lines);
ok((await ret(CREDIT_ONLY, [{ product_id: A, qty: 1 }])).code === "FORBIDDEN", "Solo con «Créditos» no alcanza: también «Devolución de venta»");
ok((await ret(OWNER, [{ product_id: A, qty: 3 }])).code === "OVER_QTY", "No devuelve más de lo vendido");
ok((await ret(OWNER, [{ product_id: A, qty: 2 }, { product_id: B, qty: 1 }])).code === "ALL_ITEMS", "Devolver todo: se usa «Devolución» del documento");

// Primero una nota de dinero (descuento) y luego la devolución: las dos se respetan.
const nc1 = (await as(OWNER, "select public.erp_receivable_note($1, 'credit', 10000, 'descuento', 'Descuento acordado') r", [R]))[0].r;
ok(nc1.ok && Number(nc1.balance) === 200000, "Nota de dinero: saldo 200.000", nc1);
const nc2 = await ret(OWNER, [{ product_id: A, qty: 1 }]);
ok(nc2.ok && nc2.number === "NC-00002" && Number(nc2.amount) === 95000 && Number(nc2.balance) === 105000, "Devuelve 1 castillo: NC-00002 por 95.000, saldo 105.000", nc2);
const [stock] = await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [W, A]);
ok(stock.qty === 9, "La unidad volvió al Punto 1 (8 → 9)", stock);
const [mv] = await raw("select movement_type, kind, qty from inventory_movements where product_id = $1 and movement_type = 'sale_return'", [A]);
ok(mv && mv.kind === "in" && mv.qty === 1, "Queda en el kardex como devolución", mv);
const items = await raw("select product_id, quantity from order_items where order_id = $1 order by quantity", [O]);
ok(items.length === 2 && items.every((i) => i.quantity === 1), "El documento queda con 1 castillo y 1 irrigador", items);
const [ord] = await raw("select total, status from orders where id = $1", [O]);
ok(Number(ord.total) === 115000 && ord.status === "confirmed", "El total del documento baja a 115.000 y sigue confirmado", ord);
let [rc] = await raw("select total, balance, status from erp_receivables where id = $1", [R]);
ok(Number(rc.total) === 105000 && Number(rc.balance) === 105000, "Cartera: 115.000 − descuento 10.000 = 105.000 (no se pierde la nota de dinero)", rc);
ok(/ORDER_LOCKED/.test(await fails(() => raw("update order_items set quantity = 5 where order_id = $1 and product_id = $2", [O, A])) ?? ""), "Después, el candado sigue igual");

// Abono y luego intentar devolver por más que el saldo.
await raw("insert into erp_receivable_payments (receivable_id, amount, method) values ($1, 100000, 'efectivo')", [R]);
await raw("update erp_receivables set balance = 5000 where id = $1", [R]);
ok((await ret(OWNER, [{ product_id: B, qty: 1 }])).code === "OVER_BALANCE", "Lo devuelto no puede pasar del saldo (sin saldo a favor)");
ok((await as(OWNER, "select public.erp_receivable_note_void($1, 'Me equivoqué') r", [nc2.id]))[0].r.code === "HAS_ITEMS", "La devolución de productos no se anula");

// Si cambia el total del pedido por otra vía, la cartera conserva notas y abonos.
await raw("update orders set total = 125000 where id = $1", [O]);
[rc] = await raw("select total, balance from erp_receivables where id = $1", [R]);
ok(Number(rc.total) === 115000 && Number(rc.balance) === 15000, "orders_sync_receivable respeta notas y abonos", rc);
await raw("update orders set total = 115000 where id = $1", [O]);

const [{ p: pay }] = await as(null, "select public.erp_order_payment_by_token('tok-devolucion-01') p");
ok(pay.credit.notes.length === 2 && pay.credit.notes.some((n) => n.items?.[0]?.name === "CASTILLO"), "El comprobante lista las notas y lo devuelto", pay.credit.notes);
const [{ r: list }] = await as(OWNER, "select public.erp_customer_receivable_notes($1) r", [C]);
ok(list.find((n) => n.number === "NC-00002")?.items?.[0]?.qty === 1, "La lista de notas trae los productos devueltos", list);
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'receivable.return_note'"))[0].n === 1, "Queda en auditoría");

// Factura electrónica enviada: no.
await raw("insert into fiscal_documents (store_id, source_id, status) values ($1, $2, 'ACCEPTED')", [S, O]);
await raw("update erp_receivables set balance = 115000 where id = $1", [R]);
ok((await ret(OWNER, [{ product_id: B, qty: 1 }])).code === "FISCAL", "Con factura electrónica enviada va por la DIAN");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
