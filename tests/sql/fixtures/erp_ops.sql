-- =====================================================================
-- REMHUB · ERP Fase 1.5: operación real de bodegas, puntos de venta,
-- ingreso de facturas de proveedor, traslados con responsables y vendedores.
--
-- Requiere haber ejecutado antes supabase/erp_core.sql.
-- Es idempotente: se puede ejecutar varias veces sin romper datos.
-- Ejecuta TODO el archivo en el SQL Editor de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Nombre del responsable (se guarda como foto en cada documento)
-- ---------------------------------------------------------------------
create or replace function public.erp_actor_name(p_store uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(trim(su.display_name), ''), su.username)
       from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()),
    (select u.email::text from auth.users u where u.id = auth.uid()),
    'Sistema'
  );
$$;
grant execute on function public.erp_actor_name(uuid) to authenticated;

alter table public.erp_audit_logs add column if not exists user_name text;

create or replace function public.erp_audit(p_store uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.erp_audit_logs (store_id, user_id, user_name, action, entity, entity_id, detail)
  values (p_store, auth.uid(), public.erp_actor_name(p_store), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end;
$$;
revoke all on function public.erp_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

alter table public.erp_purchases   add column if not exists created_by_name text;
alter table public.erp_transfers   add column if not exists created_by_name text;
alter table public.erp_adjustments add column if not exists created_by_name text;

create or replace function public.erp_set_actor_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by_name := coalesce(new.created_by_name, public.erp_actor_name(new.store_id));
  return new;
end;
$$;
drop trigger if exists erp_purchases_actor on public.erp_purchases;
create trigger erp_purchases_actor before insert on public.erp_purchases
  for each row execute function public.erp_set_actor_name();
drop trigger if exists erp_transfers_actor on public.erp_transfers;
create trigger erp_transfers_actor before insert on public.erp_transfers
  for each row execute function public.erp_set_actor_name();
drop trigger if exists erp_adjustments_actor on public.erp_adjustments;
create trigger erp_adjustments_actor before insert on public.erp_adjustments
  for each row execute function public.erp_set_actor_name();

-- ---------------------------------------------------------------------
-- 1. Puntos de venta y bodegas (misma tabla, con tipo y prefijos propios)
-- ---------------------------------------------------------------------
alter table public.erp_warehouses add column if not exists kind text not null default 'warehouse';
alter table public.erp_warehouses add column if not exists phone text;
alter table public.erp_warehouses add column if not exists invoice_prefix text not null default 'FAC';
alter table public.erp_warehouses add column if not exists remision_prefix text not null default 'REM';
alter table public.erp_warehouses add column if not exists next_invoice_number bigint not null default 1;
alter table public.erp_warehouses add column if not exists next_remision_number bigint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erp_warehouses_kind_check') then
    alter table public.erp_warehouses add constraint erp_warehouses_kind_check check (kind in ('warehouse', 'point'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'erp_warehouses_prefix_check') then
    alter table public.erp_warehouses add constraint erp_warehouses_prefix_check
      check (invoice_prefix ~ '^[A-Za-z0-9-]{0,12}$' and remision_prefix ~ '^[A-Za-z0-9-]{0,12}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'erp_warehouses_next_check') then
    alter table public.erp_warehouses add constraint erp_warehouses_next_check
      check (next_invoice_number >= 1 and next_remision_number >= 1);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Ingreso de factura de proveedor: cada línea elige su bodega destino
-- ---------------------------------------------------------------------
alter table public.erp_purchase_items add column if not exists warehouse_id uuid references public.erp_warehouses(id);
alter table public.erp_purchases add column if not exists invoice_date date;
alter table public.erp_purchases add column if not exists received_by_name text;
alter table public.erp_purchases add column if not exists checked_by_name text;

create or replace function public.erp_receive_invoice(
  p_store uuid, p_supplier uuid, p_invoice_ref text, p_invoice_date date,
  p_payment_type text, p_due_date date, p_notes text, p_checked_by text, p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_num bigint; it jsonb; v_prod uuid; v_qty integer; v_cost numeric; v_tax numeric; v_wh uuid;
  v_first_wh uuid; v_sub numeric := 0; v_taxt numeric := 0; v_stock integer; v_old_cost numeric; v_new_cost numeric;
  v_days integer; v_due date; v_ref text := nullif(trim(p_invoice_ref), '');
begin
  if not public.erp_can(p_store, 'purchases') then raise exception 'No tienes permiso para registrar compras.'; end if;
  if p_payment_type not in ('cash', 'credit') then raise exception 'Tipo de pago inválido.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La factura no tiene productos.'; end if;
  if v_ref is null then raise exception 'Escribe el número de la factura del proveedor.'; end if;
  select payment_days into v_days from public.erp_suppliers where id = p_supplier and store_id = p_store and active;
  if not found then raise exception 'Proveedor no válido.'; end if;
  if exists (select 1 from public.erp_purchases
             where store_id = p_store and supplier_id = p_supplier and lower(invoice_ref) = lower(v_ref) and status = 'received') then
    raise exception 'Ya registraste la factura % de este proveedor.', v_ref;
  end if;

  v_first_wh := nullif(p_items->0->>'warehouse_id', '')::uuid;
  if v_first_wh is null then raise exception 'Elige la bodega destino de cada producto.'; end if;

  v_num := public.erp_next_number(p_store, 'purchase');
  insert into public.erp_purchases
    (store_id, number, supplier_id, warehouse_id, invoice_ref, invoice_date, payment_type, due_date, notes, created_by,
     received_by_name, checked_by_name)
  values
    (p_store, v_num, p_supplier, v_first_wh, v_ref, coalesce(p_invoice_date, current_date), p_payment_type, null,
     nullif(trim(p_notes), ''), auth.uid(), public.erp_actor_name(p_store), nullif(trim(p_checked_by), ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_wh := nullif(it->>'warehouse_id', '')::uuid;
    v_qty := (it->>'qty')::integer;
    v_cost := (it->>'unit_cost')::numeric;
    v_tax := coalesce((it->>'tax_rate')::numeric, 0);
    if v_wh is null then raise exception 'Elige la bodega destino de cada producto.'; end if;
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost < 0 then raise exception 'Cantidad o costo inválido.'; end if;

    select coalesce(stock, 0), coalesce(cost_price, 0) into v_stock, v_old_cost
    from public.products where id = v_prod and store_id = p_store for update;
    if not found then raise exception 'Un producto no pertenece a esta tienda.'; end if;

    insert into public.erp_purchase_items (purchase_id, product_id, qty, unit_cost, tax_rate, line_total, warehouse_id)
    values (v_id, v_prod, v_qty, v_cost, v_tax, round(v_qty * v_cost * (1 + v_tax / 100), 2), v_wh);
    v_sub := v_sub + v_qty * v_cost;
    v_taxt := v_taxt + v_qty * v_cost * v_tax / 100;

    v_new_cost := case when v_stock + v_qty > 0
      then round(((greatest(v_stock, 0) * v_old_cost) + (v_qty * v_cost)) / (greatest(v_stock, 0) + v_qty), 4)
      else v_cost end;

    perform public.erp__move(p_store, v_wh, v_prod, v_qty, 'purchase', 'purchase', v_id, v_cost,
      'Factura ' || v_ref || ' · compra #' || v_num, null, true);
    update public.products set cost_price = v_new_cost, updated_at = now() where id = v_prod;
  end loop;

  v_due := case when p_payment_type = 'credit'
    then coalesce(p_due_date, current_date + coalesce(v_days, 0)) else null end;
  update public.erp_purchases
  set subtotal = round(v_sub, 2), tax = round(v_taxt, 2), total = round(v_sub + v_taxt, 2), due_date = v_due
  where id = v_id;

  if p_payment_type = 'credit' then
    insert into public.erp_payables (store_id, supplier_id, purchase_id, total, balance, due_date)
    values (p_store, p_supplier, v_id, round(v_sub + v_taxt, 2), round(v_sub + v_taxt, 2), v_due);
  end if;

  perform public.erp_audit(p_store, 'purchase.received', 'erp_purchases', v_id,
    jsonb_build_object('number', v_num, 'invoice', v_ref, 'total', round(v_sub + v_taxt, 2),
      'payment_type', p_payment_type, 'items', jsonb_array_length(p_items), 'checked_by', nullif(trim(p_checked_by), '')));
  return v_id;
end;
$$;
grant execute on function public.erp_receive_invoice(uuid, uuid, text, date, text, date, text, text, jsonb) to authenticated;

-- Anular compra: ahora revierte cada línea en SU bodega.
create or replace function public.erp_cancel_purchase(p_purchase uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare pu public.erp_purchases; it record; v_paid numeric;
begin
  select * into pu from public.erp_purchases where id = p_purchase for update;
  if not found then raise exception 'Compra no encontrada.'; end if;
  if not public.erp_can(pu.store_id, 'purchases') then raise exception 'No tienes permiso para anular compras.'; end if;
  if pu.status = 'cancelled' then raise exception 'La compra ya está anulada.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo de la anulación.'; end if;

  select coalesce(sum(pp.amount), 0) into v_paid
  from public.erp_payable_payments pp join public.erp_payables ap on ap.id = pp.payable_id
  where ap.purchase_id = p_purchase;
  if v_paid > 0 then raise exception 'La compra tiene pagos registrados; no se puede anular.'; end if;

  for it in select * from public.erp_purchase_items where purchase_id = p_purchase loop
    perform public.erp__move(pu.store_id, coalesce(it.warehouse_id, pu.warehouse_id), it.product_id, -it.qty, 'purchase_void',
      'purchase', p_purchase, it.unit_cost, 'Anulación compra #' || pu.number, p_reason, true);
  end loop;
  update public.erp_payables set status = 'void', balance = 0, updated_at = now() where purchase_id = p_purchase;
  update public.erp_purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = p_purchase;
  perform public.erp_audit(pu.store_id, 'purchase.cancelled', 'erp_purchases', p_purchase,
    jsonb_build_object('number', pu.number, 'reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Traslados con responsables y distribución a varios puntos
-- ---------------------------------------------------------------------
alter table public.erp_transfers add column if not exists carrier_name text;
alter table public.erp_transfers add column if not exists checked_by_name text;
alter table public.erp_transfers add column if not exists received_by_name text;
alter table public.erp_transfers add column if not exists received_notes text;
alter table public.erp_transfer_items add column if not exists received_qty integer;

-- Un envío puede repartirse entre varios destinos:
-- p_plan = [{"to": "<bodega>", "items": [{"product_id": "...", "qty": 5}]}]
-- Crea un traslado por destino, todo en una sola transacción.
create or replace function public.erp_dispatch_transfers(
  p_store uuid, p_from uuid, p_notes text, p_carrier text, p_checked_by text, p_plan jsonb
) returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := '{}'; leg jsonb; it jsonb; v_to uuid; v_id uuid; v_num bigint; v_prod uuid; v_qty integer;
begin
  if not public.erp_can(p_store, 'transfers') then raise exception 'No tienes permiso para crear traslados.'; end if;
  if jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Agrega al menos un destino.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_from and store_id = p_store and active) then
    raise exception 'Bodega origen no válida.';
  end if;

  for leg in select * from jsonb_array_elements(p_plan) loop
    v_to := (leg->>'to')::uuid;
    if v_to = p_from then raise exception 'El destino no puede ser igual al origen.'; end if;
    if not exists (select 1 from public.erp_warehouses where id = v_to and store_id = p_store and active) then
      raise exception 'Un destino no es válido.';
    end if;
    if jsonb_typeof(leg->'items') <> 'array' or jsonb_array_length(leg->'items') = 0 then
      raise exception 'Cada destino necesita al menos un producto.';
    end if;

    v_num := public.erp_next_number(p_store, 'transfer');
    insert into public.erp_transfers
      (store_id, number, from_warehouse_id, to_warehouse_id, notes, created_by, carrier_name, checked_by_name)
    values
      (p_store, v_num, p_from, v_to, nullif(trim(p_notes), ''), auth.uid(),
       nullif(trim(p_carrier), ''), nullif(trim(p_checked_by), ''))
    returning id into v_id;

    for it in select * from jsonb_array_elements(leg->'items') loop
      v_prod := (it->>'product_id')::uuid;
      v_qty := (it->>'qty')::integer;
      if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida.'; end if;
      insert into public.erp_transfer_items (transfer_id, product_id, qty) values (v_id, v_prod, v_qty);
      perform public.erp__move(p_store, p_from, v_prod, -v_qty, 'transfer_out', 'transfer', v_id, null,
        'Traslado #' || v_num || ' (salida)', null, false);
    end loop;

    perform public.erp_audit(p_store, 'transfer.shipped', 'erp_transfers', v_id,
      jsonb_build_object('number', v_num, 'from', p_from, 'to', v_to, 'items', jsonb_array_length(leg->'items'),
        'carrier', nullif(trim(p_carrier), ''), 'checked_by', nullif(trim(p_checked_by), '')));
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;
grant execute on function public.erp_dispatch_transfers(uuid, uuid, text, text, text, jsonb) to authenticated;

-- Confirmación de recepción: quién recibe, qué llegó realmente y diferencias.
-- p_items = [{"product_id": "...", "received_qty": 4}] (null = llegó todo).
-- Lo que no llegó vuelve a la bodega de origen y queda en el kardex y la auditoría.
create or replace function public.erp_confirm_transfer(p_transfer uuid, p_items jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare tr public.erp_transfers; it record; v_recv integer; v_given jsonb; v_diff_total integer := 0;
begin
  select * into tr from public.erp_transfers where id = p_transfer for update;
  if not found then raise exception 'Traslado no encontrado.'; end if;
  if not public.erp_can(tr.store_id, 'transfers') then raise exception 'No tienes permiso para recibir traslados.'; end if;
  if tr.status <> 'in_transit' then raise exception 'El traslado no está en tránsito.'; end if;

  for it in select * from public.erp_transfer_items where transfer_id = p_transfer loop
    v_recv := it.qty;
    if p_items is not null and jsonb_typeof(p_items) = 'array' then
      select e into v_given from jsonb_array_elements(p_items) e where (e->>'product_id')::uuid = it.product_id limit 1;
      if v_given is not null then v_recv := (v_given->>'received_qty')::integer; end if;
    end if;
    if v_recv is null or v_recv < 0 or v_recv > it.qty then
      raise exception 'La cantidad recibida debe estar entre 0 y la enviada (%).', it.qty;
    end if;

    if v_recv > 0 then
      perform public.erp__move(tr.store_id, tr.to_warehouse_id, it.product_id, v_recv, 'transfer_in', 'transfer', p_transfer, null,
        'Traslado #' || tr.number || ' (entrada)', null, false);
    end if;
    if v_recv < it.qty then
      perform public.erp__move(tr.store_id, tr.from_warehouse_id, it.product_id, it.qty - v_recv, 'transfer_return', 'transfer', p_transfer, null,
        'Traslado #' || tr.number || ' (faltante devuelto al origen)', nullif(trim(p_notes), ''), false);
      v_diff_total := v_diff_total + (it.qty - v_recv);
    end if;
    update public.erp_transfer_items set received_qty = v_recv where id = it.id;
  end loop;

  update public.erp_transfers
  set status = 'received', received_at = now(), received_by = auth.uid(),
      received_by_name = public.erp_actor_name(tr.store_id), received_notes = nullif(trim(p_notes), '')
  where id = p_transfer;
  perform public.erp_audit(tr.store_id, 'transfer.received', 'erp_transfers', p_transfer,
    jsonb_build_object('number', tr.number, 'units_missing', v_diff_total, 'notes', nullif(trim(p_notes), '')));
end;
$$;
grant execute on function public.erp_confirm_transfer(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Vendedores y numeración por punto de venta
-- ---------------------------------------------------------------------
create table if not exists public.erp_order_meta (
  order_id uuid primary key references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id),
  seller_id uuid,
  seller_name text,
  doc_kind text not null default 'factura' check (doc_kind in ('factura', 'remision')),
  doc_prefix text,
  doc_seq bigint,
  doc_number text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists erp_order_meta_doc_unique on public.erp_order_meta (store_id, doc_number);
create index if not exists erp_order_meta_seller on public.erp_order_meta (store_id, seller_id);

alter table public.erp_order_meta enable row level security;
drop policy if exists erp_order_meta_select on public.erp_order_meta;
create policy erp_order_meta_select on public.erp_order_meta for select to authenticated
  using (public.erp_can(store_id, 'pos') or public.erp_can(store_id, 'orders') or public.erp_can(store_id, 'billing'));
revoke insert, update, delete on public.erp_order_meta from anon, authenticated;

-- Vendedores disponibles para facturar (dueño + usuarios internos activos con acceso al POS).
create or replace function public.erp_sellers(p_store uuid)
returns table (user_id uuid, name text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'orders') or public.erp_can(p_store, 'billing')) then
    raise exception 'No tienes permiso para ver los vendedores.';
  end if;
  return query
    select s.owner_id, coalesce((select u.email::text from auth.users u where u.id = s.owner_id), 'Dueño'), 'owner'::text
    from public.stores s where s.id = p_store
    union all
    select su.user_id, coalesce(nullif(trim(su.display_name), ''), su.username, 'Usuario'), su.role
    from public.store_users su
    where su.store_id = p_store and su.active
      and (su.role in ('seller', 'store_admin') or 'pos' = any (su.permissions))
    order by 2;
end;
$$;
grant execute on function public.erp_sellers(uuid) to authenticated;

-- Asigna punto, vendedor y número (prefijo del punto) a un pedido/factura creado en el POS.
create or replace function public.erp_tag_order(p_store uuid, p_token text, p_point uuid, p_seller uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid; v_meta public.erp_order_meta; v_prefix text; v_seq bigint; v_name text; v_num text; v_wh public.erp_warehouses;
begin
  if not public.erp_can(p_store, 'pos') then raise exception 'No tienes permiso para facturar.'; end if;
  if p_kind not in ('factura', 'remision') then raise exception 'Tipo de documento inválido.'; end if;
  select id into v_order from public.orders where token = p_token and store_id = p_store;
  if not found then raise exception 'Pedido no encontrado.'; end if;

  select * into v_meta from public.erp_order_meta where order_id = v_order;
  if found then
    return jsonb_build_object('doc_number', v_meta.doc_number, 'seller_name', v_meta.seller_name);
  end if;

  select * into v_wh from public.erp_warehouses where id = p_point and store_id = p_store and active for update;
  if not found then raise exception 'Elige un punto de venta válido.'; end if;

  if p_seller is not null then
    select name into v_name from public.erp_sellers(p_store) where user_id = p_seller limit 1;
    if v_name is null then raise exception 'El vendedor elegido no es válido.'; end if;
  else
    v_name := public.erp_actor_name(p_store);
    p_seller := auth.uid();
  end if;

  if p_kind = 'factura' then
    v_prefix := v_wh.invoice_prefix; v_seq := v_wh.next_invoice_number;
    update public.erp_warehouses set next_invoice_number = next_invoice_number + 1 where id = v_wh.id;
  else
    v_prefix := v_wh.remision_prefix; v_seq := v_wh.next_remision_number;
    update public.erp_warehouses set next_remision_number = next_remision_number + 1 where id = v_wh.id;
  end if;
  v_num := case when coalesce(v_prefix, '') = '' then lpad(v_seq::text, 5, '0') else v_prefix || '-' || lpad(v_seq::text, 5, '0') end;

  insert into public.erp_order_meta
    (order_id, store_id, point_id, seller_id, seller_name, doc_kind, doc_prefix, doc_seq, doc_number, created_by, created_by_name)
  values
    (v_order, p_store, p_point, p_seller, v_name, p_kind, v_prefix, v_seq, v_num, auth.uid(), public.erp_actor_name(p_store));

  perform public.erp_audit(p_store, 'sale.tagged', 'orders', v_order,
    jsonb_build_object('doc_number', v_num, 'point', v_wh.name, 'seller', v_name, 'kind', p_kind));
  return jsonb_build_object('doc_number', v_num, 'seller_name', v_name);
end;
$$;
grant execute on function public.erp_tag_order(uuid, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Consultas livianas (paginadas / con búsqueda) para no cargar todo el catálogo
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_trgm;
  create index if not exists products_name_trgm on public.products using gin (lower(name) gin_trgm_ops);
exception when others then
  raise notice 'pg_trgm no disponible; la búsqueda funcionará sin índice trigram.';
end $$;
create index if not exists products_store_name on public.products (store_id, name);

create or replace function public.erp_search_products(
  p_store uuid, p_q text, p_warehouse uuid default null, p_in_stock boolean default false, p_limit integer default 20
) returns table (
  id uuid, name text, sku text, barcode text, cost_price numeric, tax_rate numeric, stock integer, wh_qty integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := lower(trim(coalesce(p_q, '')));
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'purchases') or public.erp_can(p_store, 'transfers')
          or public.erp_can(p_store, 'inventory_adjust') or public.erp_can(p_store, 'pos')) then
    raise exception 'No tienes permiso para consultar productos.';
  end if;
  return query
    select p.id, p.name::text, p.sku::text, p.barcode::text, coalesce(p.cost_price, 0)::numeric, coalesce(p.tax_rate, 0)::numeric,
           coalesce(p.stock, 0)::integer, coalesce(l.qty, 0)::integer
    from public.products p
    left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = p_warehouse
    where p.store_id = p_store and coalesce(p.active, true)
      and (v_q = '' or lower(p.name) like '%' || v_q || '%' or lower(coalesce(p.sku, '')) like '%' || v_q || '%'
           or coalesce(p.barcode, '') = v_q)
      and (not p_in_stock or coalesce(l.qty, 0) > 0)
    order by (lower(p.name) like v_q || '%') desc, p.name
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
grant execute on function public.erp_search_products(uuid, text, uuid, boolean, integer) to authenticated;

create or replace function public.erp_stock_page(
  p_store uuid, p_q text, p_only_low boolean, p_limit integer, p_offset integer
) returns table (
  id uuid, name text, sku text, cost_price numeric, total integer, levels jsonb, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := lower(trim(coalesce(p_q, '')));
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'products')) then
    raise exception 'No tienes permiso para ver existencias.';
  end if;
  return query
    with page as (
      select p.id, p.name::text as name, p.sku::text as sku, coalesce(p.cost_price, 0)::numeric as cost_price,
             coalesce(p.stock, 0)::integer as total, count(*) over () as total_count
      from public.products p
      where p.store_id = p_store and coalesce(p.active, true)
        and (v_q = '' or lower(p.name) like '%' || v_q || '%' or lower(coalesce(p.sku, '')) like '%' || v_q || '%')
        and (not p_only_low or coalesce(p.stock, 0) <= 5)
      order by p.name
      limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
    )
    select pg.id, pg.name, pg.sku, pg.cost_price, pg.total,
           coalesce((select jsonb_object_agg(l.warehouse_id::text, l.qty) from public.erp_stock_levels l where l.product_id = pg.id), '{}'::jsonb),
           pg.total_count
    from page pg
    order by pg.name;
end;
$$;
grant execute on function public.erp_stock_page(uuid, text, boolean, integer, integer) to authenticated;
