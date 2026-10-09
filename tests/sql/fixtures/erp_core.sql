-- =====================================================================
-- REMHUB · ERP CORE · Fase 1 (Bodegas, Kardex, Traslados, Ajustes,
-- Proveedores, Compras, Cuentas por pagar, Auditoría, Permisos)
-- Idempotente: se puede ejecutar varias veces. No borra datos.
-- Ejecutar completo en Supabase → SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Permisos: ¿puede el usuario actual hacer X en la tienda?
--    Dueño, admin de plataforma y store_admin pueden todo.
--    El resto necesita la clave en store_users.permissions.
-- ---------------------------------------------------------------------
create or replace function public.erp_can(p_store uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
    or exists (
      select 1 from public.store_users su
      where su.store_id = p_store and su.user_id = auth.uid() and su.active
        and (su.role = 'store_admin' or p_perm = any (su.permissions))
    )
  );
$$;
grant execute on function public.erp_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------
create table if not exists public.erp_warehouses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  name text not null,
  address text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, code)
);
create unique index if not exists erp_warehouses_one_default
  on public.erp_warehouses (store_id) where is_default;

create table if not exists public.erp_stock_levels (
  warehouse_id uuid not null references public.erp_warehouses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  qty integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, product_id)
);
create index if not exists erp_stock_levels_store_product on public.erp_stock_levels (store_id, product_id);

create table if not exists public.erp_counters (
  store_id uuid not null references public.stores(id) on delete cascade,
  key text not null,
  next_number bigint not null default 1,
  primary key (store_id, key)
);

create table if not exists public.erp_suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  nit text,
  contact_name text,
  phone text,
  email text,
  address text,
  payment_days integer not null default 0 check (payment_days >= 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists erp_suppliers_store on public.erp_suppliers (store_id, name);

create table if not exists public.erp_purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  supplier_id uuid not null references public.erp_suppliers(id),
  warehouse_id uuid not null references public.erp_warehouses(id),
  status text not null default 'received' check (status in ('received', 'cancelled')),
  invoice_ref text,
  payment_type text not null default 'cash' check (payment_type in ('cash', 'credit')),
  due_date date,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  unique (store_id, number)
);
create index if not exists erp_purchases_store_date on public.erp_purchases (store_id, created_at desc);

create table if not exists public.erp_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.erp_purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty integer not null check (qty > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  tax_rate numeric not null default 0,
  line_total numeric not null default 0
);

create table if not exists public.erp_payables (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid not null references public.erp_suppliers(id),
  purchase_id uuid references public.erp_purchases(id),
  total numeric not null check (total >= 0),
  balance numeric not null check (balance >= 0),
  due_date date,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists erp_payables_store_status on public.erp_payables (store_id, status, due_date);

create table if not exists public.erp_payable_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  payable_id uuid not null references public.erp_payables(id),
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  reference text,
  paid_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.erp_transfers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  from_warehouse_id uuid not null references public.erp_warehouses(id),
  to_warehouse_id uuid not null references public.erp_warehouses(id),
  status text not null default 'in_transit' check (status in ('in_transit', 'received', 'cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  received_at timestamptz,
  received_by uuid,
  cancelled_at timestamptz,
  check (from_warehouse_id <> to_warehouse_id),
  unique (store_id, number)
);

create table if not exists public.erp_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.erp_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty integer not null check (qty > 0)
);

create table if not exists public.erp_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  warehouse_id uuid not null references public.erp_warehouses(id),
  reason text not null check (reason in ('count', 'damage', 'loss', 'expired', 'found', 'correction', 'other')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (store_id, number)
);

create table if not exists public.erp_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.erp_adjustments(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty_before integer not null,
  qty_after integer not null check (qty_after >= 0),
  diff integer not null,
  unit_cost numeric not null default 0
);

create table if not exists public.erp_audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists erp_audit_logs_store_date on public.erp_audit_logs (store_id, created_at desc);

-- Kardex: se extiende la tabla existente sin romper nada.
alter table public.inventory_movements add column if not exists warehouse_id uuid references public.erp_warehouses(id);
alter table public.inventory_movements add column if not exists movement_type text;
alter table public.inventory_movements add column if not exists qty_before integer;
alter table public.inventory_movements add column if not exists qty_after integer;
alter table public.inventory_movements add column if not exists reason text;
create index if not exists inventory_movements_store_product_date
  on public.inventory_movements (store_id, product_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Utilidades internas
-- ---------------------------------------------------------------------
create or replace function public.erp_next_number(p_store uuid, p_key text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  insert into public.erp_counters (store_id, key, next_number) values (p_store, p_key, 2)
  on conflict (store_id, key) do update set next_number = public.erp_counters.next_number + 1
  returning next_number - 1 into v;
  return v;
end;
$$;
revoke all on function public.erp_next_number(uuid, text) from public, anon, authenticated;

create or replace function public.erp_audit(p_store uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.erp_audit_logs (store_id, user_id, action, entity, entity_id, detail)
  values (p_store, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.erp_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.erp_ensure_default_warehouse(p_store uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v uuid;
begin
  select id into v from public.erp_warehouses where store_id = p_store and is_default limit 1;
  if v is null then
    insert into public.erp_warehouses (store_id, code, name, is_default)
    values (p_store, 'PRINCIPAL', 'Bodega principal', true)
    on conflict (store_id, code) do update set is_default = true
    returning id into v;
  end if;
  return v;
end;
$$;
revoke all on function public.erp_ensure_default_warehouse(uuid) from public, anon, authenticated;

-- Aplica un movimiento a una bodega y deja el kardex escrito.
-- p_touch_total: si true también mueve products.stock (compras, ajustes);
-- los traslados no cambian el total de la tienda.
create or replace function public.erp__move(
  p_store uuid, p_wh uuid, p_product uuid, p_delta integer, p_type text,
  p_ref_type text, p_ref_id uuid, p_cost numeric, p_note text, p_reason text, p_touch_total boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_before integer; v_after integer;
begin
  if p_delta = 0 then return; end if;
  if not exists (select 1 from public.products where id = p_product and store_id = p_store) then
    raise exception 'El producto no pertenece a esta tienda.';
  end if;
  if not exists (select 1 from public.erp_warehouses where id = p_wh and store_id = p_store and active) then
    raise exception 'La bodega no existe o está inactiva.';
  end if;

  insert into public.erp_stock_levels (warehouse_id, product_id, store_id, qty)
  values (p_wh, p_product, p_store, 0) on conflict do nothing;

  select qty into v_before from public.erp_stock_levels
  where warehouse_id = p_wh and product_id = p_product for update;
  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'Stock insuficiente en la bodega (disponible %, requerido %).', v_before, abs(p_delta);
  end if;

  update public.erp_stock_levels set qty = v_after, updated_at = now()
  where warehouse_id = p_wh and product_id = p_product;

  if p_touch_total then
    perform set_config('erp.skip_sync', '1', true);
    update public.products set stock = coalesce(stock, 0) + p_delta where id = p_product;
    perform set_config('erp.skip_sync', '0', true);
  end if;

  insert into public.inventory_movements
    (store_id, product_id, kind, qty, note, unit_cost, ref_type, ref_id, created_by,
     warehouse_id, movement_type, qty_before, qty_after, reason)
  values
    (p_store, p_product, case when p_delta > 0 then 'in' else 'out' end, abs(p_delta), p_note, p_cost,
     p_ref_type, p_ref_id, auth.uid(), p_wh, p_type, v_before, v_after, p_reason);
end;
$$;
revoke all on function public.erp__move(uuid, uuid, uuid, integer, text, text, uuid, numeric, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Integración con el flujo existente (POS, pedidos, edición manual):
--    cualquier cambio de products.stock se refleja en la bodega principal
--    y products.stock siempre = suma de las bodegas.
-- ---------------------------------------------------------------------
create or replace function public.erp_sync_product_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_wh uuid; v_delta integer;
begin
  if coalesce(current_setting('erp.skip_sync', true), '0') = '1' then return new; end if;
  v_delta := coalesce(new.stock, 0) - coalesce(old.stock, 0);
  if v_delta = 0 then return new; end if;
  v_wh := public.erp_ensure_default_warehouse(new.store_id);
  insert into public.erp_stock_levels (warehouse_id, product_id, store_id, qty)
  values (v_wh, new.id, new.store_id, v_delta)
  on conflict (warehouse_id, product_id)
  do update set qty = public.erp_stock_levels.qty + v_delta, updated_at = now();
  return new;
end;
$$;
drop trigger if exists erp_products_stock_sync on public.products;
create trigger erp_products_stock_sync
  after update of stock on public.products
  for each row when (old.stock is distinct from new.stock)
  execute function public.erp_sync_product_stock();

-- Los movimientos de flujos anteriores quedan asignados a la bodega principal.
create or replace function public.erp_movement_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.warehouse_id is null then
    new.warehouse_id := public.erp_ensure_default_warehouse(new.store_id);
  end if;
  if new.movement_type is null then
    new.movement_type := case
      when new.order_id is not null or coalesce(new.ref_type, '') in ('order', 'sale', 'document') then
        case when new.kind = 'out' then 'sale' else 'sale_return' end
      else case when new.kind = 'in' then 'manual_in' else 'manual_out' end
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists erp_inventory_movement_defaults on public.inventory_movements;
create trigger erp_inventory_movement_defaults
  before insert on public.inventory_movements
  for each row execute function public.erp_movement_defaults();

-- Carga inicial: bodega principal + existencias actuales por tienda.
do $$
declare s record; wh uuid;
begin
  for s in select id from public.stores loop
    wh := public.erp_ensure_default_warehouse(s.id);
    insert into public.erp_stock_levels (warehouse_id, product_id, store_id, qty)
    select wh, p.id, p.store_id, greatest(coalesce(p.stock, 0), 0)
    from public.products p
    where p.store_id = s.id and coalesce(p.stock, 0) > 0
    on conflict (warehouse_id, product_id) do nothing;
  end loop;
end $$;

-- Toda tienda nueva nace con su bodega principal.
create or replace function public.erp_new_store_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.erp_ensure_default_warehouse(new.id);
  return new;
end;
$$;
drop trigger if exists erp_stores_default_wh on public.stores;
create trigger erp_stores_default_wh after insert on public.stores
  for each row execute function public.erp_new_store_defaults();

-- ---------------------------------------------------------------------
-- 4. Operaciones transaccionales (todo o nada, con permisos y auditoría)
-- ---------------------------------------------------------------------

-- COMPRA: proveedor → inventario → kardex → costo promedio → cuenta por pagar → auditoría
create or replace function public.erp_receive_purchase(
  p_store uuid, p_supplier uuid, p_warehouse uuid, p_invoice_ref text,
  p_payment_type text, p_due_date date, p_notes text, p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_num bigint; it jsonb; v_prod uuid; v_qty integer; v_cost numeric; v_tax numeric;
  v_sub numeric := 0; v_taxt numeric := 0; v_stock integer; v_old_cost numeric; v_new_cost numeric;
  v_days integer; v_due date;
begin
  if not public.erp_can(p_store, 'purchases') then raise exception 'No tienes permiso para registrar compras.'; end if;
  if p_payment_type not in ('cash', 'credit') then raise exception 'Tipo de pago inválido.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La compra no tiene productos.'; end if;
  select payment_days into v_days from public.erp_suppliers where id = p_supplier and store_id = p_store and active;
  if not found then raise exception 'Proveedor no válido.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_warehouse and store_id = p_store and active) then
    raise exception 'Bodega no válida.';
  end if;

  v_num := public.erp_next_number(p_store, 'purchase');
  insert into public.erp_purchases (store_id, number, supplier_id, warehouse_id, invoice_ref, payment_type, due_date, notes, created_by)
  values (p_store, v_num, p_supplier, p_warehouse, nullif(trim(p_invoice_ref), ''), p_payment_type, null, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::integer;
    v_cost := (it->>'unit_cost')::numeric;
    v_tax := coalesce((it->>'tax_rate')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost < 0 then raise exception 'Cantidad o costo inválido.'; end if;

    select coalesce(stock, 0), coalesce(cost_price, 0) into v_stock, v_old_cost
    from public.products where id = v_prod and store_id = p_store for update;
    if not found then raise exception 'Un producto no pertenece a esta tienda.'; end if;

    insert into public.erp_purchase_items (purchase_id, product_id, qty, unit_cost, tax_rate, line_total)
    values (v_id, v_prod, v_qty, v_cost, v_tax, round(v_qty * v_cost * (1 + v_tax / 100), 2));
    v_sub := v_sub + v_qty * v_cost;
    v_taxt := v_taxt + v_qty * v_cost * v_tax / 100;

    -- Costo promedio ponderado
    v_new_cost := case when v_stock + v_qty > 0
      then round(((greatest(v_stock, 0) * v_old_cost) + (v_qty * v_cost)) / (greatest(v_stock, 0) + v_qty), 4)
      else v_cost end;

    perform public.erp__move(p_store, p_warehouse, v_prod, v_qty, 'purchase', 'purchase', v_id, v_cost,
      'Compra #' || v_num, null, true);
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
    jsonb_build_object('number', v_num, 'total', round(v_sub + v_taxt, 2), 'payment_type', p_payment_type, 'items', jsonb_array_length(p_items)));
  return v_id;
end;
$$;

-- Anular compra: revierte inventario (si hay existencias) y anula la cuenta por pagar sin pagos.
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
    perform public.erp__move(pu.store_id, pu.warehouse_id, it.product_id, -it.qty, 'purchase_void', 'purchase', p_purchase,
      it.unit_cost, 'Anulación compra #' || pu.number, p_reason, true);
  end loop;
  update public.erp_payables set status = 'void', balance = 0, updated_at = now() where purchase_id = p_purchase;
  update public.erp_purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = p_purchase;
  perform public.erp_audit(pu.store_id, 'purchase.cancelled', 'erp_purchases', p_purchase,
    jsonb_build_object('number', pu.number, 'reason', p_reason));
end;
$$;

-- PAGO A PROVEEDOR: cuenta por pagar → pago → saldo → auditoría
create or replace function public.erp_pay_supplier(p_payable uuid, p_amount numeric, p_method text, p_reference text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare ap public.erp_payables; v_bal numeric;
begin
  select * into ap from public.erp_payables where id = p_payable for update;
  if not found then raise exception 'Cuenta por pagar no encontrada.'; end if;
  if not public.erp_can(ap.store_id, 'payables') then raise exception 'No tienes permiso para registrar pagos.'; end if;
  if ap.status <> 'open' then raise exception 'La cuenta no está abierta.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Monto inválido.'; end if;
  if p_amount > ap.balance then raise exception 'El pago supera el saldo pendiente (%).', ap.balance; end if;

  insert into public.erp_payable_payments (store_id, payable_id, amount, method, reference, paid_by)
  values (ap.store_id, p_payable, p_amount, coalesce(nullif(trim(p_method), ''), 'cash'), nullif(trim(p_reference), ''), auth.uid());
  v_bal := ap.balance - p_amount;
  update public.erp_payables set balance = v_bal, status = case when v_bal <= 0 then 'paid' else 'open' end, updated_at = now()
  where id = p_payable;
  perform public.erp_audit(ap.store_id, 'payable.payment', 'erp_payables', p_payable,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'balance', v_bal));
end;
$$;

-- TRASLADO: bodega origen → tránsito → bodega destino
create or replace function public.erp_create_transfer(p_store uuid, p_from uuid, p_to uuid, p_notes text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_num bigint; it jsonb; v_prod uuid; v_qty integer;
begin
  if not public.erp_can(p_store, 'transfers') then raise exception 'No tienes permiso para crear traslados.'; end if;
  if p_from = p_to then raise exception 'La bodega de origen y destino deben ser distintas.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El traslado no tiene productos.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_to and store_id = p_store and active) then
    raise exception 'Bodega destino no válida.';
  end if;
  v_num := public.erp_next_number(p_store, 'transfer');
  insert into public.erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, notes, created_by)
  values (p_store, v_num, p_from, p_to, nullif(trim(p_notes), ''), auth.uid()) returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida.'; end if;
    insert into public.erp_transfer_items (transfer_id, product_id, qty) values (v_id, v_prod, v_qty);
    perform public.erp__move(p_store, p_from, v_prod, -v_qty, 'transfer_out', 'transfer', v_id, null,
      'Traslado #' || v_num || ' (salida)', null, false);
  end loop;
  perform public.erp_audit(p_store, 'transfer.shipped', 'erp_transfers', v_id,
    jsonb_build_object('number', v_num, 'from', p_from, 'to', p_to, 'items', jsonb_array_length(p_items)));
  return v_id;
end;
$$;

create or replace function public.erp_receive_transfer(p_transfer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare tr public.erp_transfers; it record;
begin
  select * into tr from public.erp_transfers where id = p_transfer for update;
  if not found then raise exception 'Traslado no encontrado.'; end if;
  if not public.erp_can(tr.store_id, 'transfers') then raise exception 'No tienes permiso para recibir traslados.'; end if;
  if tr.status <> 'in_transit' then raise exception 'El traslado no está en tránsito.'; end if;
  for it in select * from public.erp_transfer_items where transfer_id = p_transfer loop
    perform public.erp__move(tr.store_id, tr.to_warehouse_id, it.product_id, it.qty, 'transfer_in', 'transfer', p_transfer, null,
      'Traslado #' || tr.number || ' (entrada)', null, false);
  end loop;
  update public.erp_transfers set status = 'received', received_at = now(), received_by = auth.uid() where id = p_transfer;
  perform public.erp_audit(tr.store_id, 'transfer.received', 'erp_transfers', p_transfer, jsonb_build_object('number', tr.number));
end;
$$;

create or replace function public.erp_cancel_transfer(p_transfer uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare tr public.erp_transfers; it record;
begin
  select * into tr from public.erp_transfers where id = p_transfer for update;
  if not found then raise exception 'Traslado no encontrado.'; end if;
  if not public.erp_can(tr.store_id, 'transfers') then raise exception 'No tienes permiso para anular traslados.'; end if;
  if tr.status <> 'in_transit' then raise exception 'Solo se pueden anular traslados en tránsito.'; end if;
  for it in select * from public.erp_transfer_items where transfer_id = p_transfer loop
    perform public.erp__move(tr.store_id, tr.from_warehouse_id, it.product_id, it.qty, 'transfer_void', 'transfer', p_transfer, null,
      'Anulación traslado #' || tr.number, p_reason, false);
  end loop;
  update public.erp_transfers set status = 'cancelled', cancelled_at = now() where id = p_transfer;
  perform public.erp_audit(tr.store_id, 'transfer.cancelled', 'erp_transfers', p_transfer,
    jsonb_build_object('number', tr.number, 'reason', p_reason));
end;
$$;

-- AJUSTE: motivo + responsable + diferencia → inventario → kardex → auditoría
create or replace function public.erp_post_adjustment(p_store uuid, p_warehouse uuid, p_reason text, p_notes text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_num bigint; it jsonb; v_prod uuid; v_after integer; v_before integer; v_cost numeric;
begin
  if not public.erp_can(p_store, 'inventory_adjust') then raise exception 'No tienes permiso para ajustar inventario.'; end if;
  if p_reason not in ('count', 'damage', 'loss', 'expired', 'found', 'correction', 'other') then raise exception 'Motivo inválido.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El ajuste no tiene productos.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_warehouse and store_id = p_store and active) then
    raise exception 'Bodega no válida.';
  end if;
  v_num := public.erp_next_number(p_store, 'adjustment');
  insert into public.erp_adjustments (store_id, number, warehouse_id, reason, notes, created_by)
  values (p_store, v_num, p_warehouse, p_reason, nullif(trim(p_notes), ''), auth.uid()) returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_after := (it->>'qty_after')::integer;
    if v_after is null or v_after < 0 then raise exception 'Cantidad contada inválida.'; end if;
    select coalesce(cost_price, 0) into v_cost from public.products where id = v_prod and store_id = p_store;
    if not found then raise exception 'Un producto no pertenece a esta tienda.'; end if;
    select coalesce(qty, 0) into v_before from public.erp_stock_levels where warehouse_id = p_warehouse and product_id = v_prod;
    v_before := coalesce(v_before, 0);
    insert into public.erp_adjustment_items (adjustment_id, product_id, qty_before, qty_after, diff, unit_cost)
    values (v_id, v_prod, v_before, v_after, v_after - v_before, v_cost);
    perform public.erp__move(p_store, p_warehouse, v_prod, v_after - v_before, 'adjustment', 'adjustment', v_id, v_cost,
      'Ajuste #' || v_num, p_reason, true);
  end loop;
  perform public.erp_audit(p_store, 'adjustment.posted', 'erp_adjustments', v_id,
    jsonb_build_object('number', v_num, 'reason', p_reason, 'items', jsonb_array_length(p_items)));
  return v_id;
end;
$$;

-- Consultas de lectura con permiso
create or replace function public.erp_kardex(p_store uuid, p_product uuid, p_warehouse uuid, p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, created_at timestamptz, product_id uuid, product_name text, warehouse_name text, movement_type text,
  kind text, qty integer, qty_before integer, qty_after integer, unit_cost numeric, note text, reason text, created_by uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.erp_can(p_store, 'inventory') then raise exception 'No tienes permiso para ver el kardex.'; end if;
  return query
  select m.id, m.created_at, m.product_id, p.name, w.name, m.movement_type, m.kind, m.qty, m.qty_before, m.qty_after,
         m.unit_cost, m.note, m.reason, m.created_by
  from public.inventory_movements m
  join public.products p on p.id = m.product_id
  left join public.erp_warehouses w on w.id = m.warehouse_id
  where m.store_id = p_store
    and (p_product is null or m.product_id = p_product)
    and (p_warehouse is null or m.warehouse_id = p_warehouse)
    and (p_from is null or m.created_at >= p_from)
    and (p_to is null or m.created_at <= p_to)
  order by m.created_at desc
  limit 500;
end;
$$;

-- Indicadores reales del módulo (sin datos inventados)
create or replace function public.erp_overview(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'purchases') or public.erp_can(p_store, 'payables')) then
    raise exception 'No tienes permiso para ver este resumen.';
  end if;
  select jsonb_build_object(
    'inventory_value', coalesce((select sum(greatest(sl.qty, 0) * coalesce(p.cost_price, 0))
      from public.erp_stock_levels sl join public.products p on p.id = sl.product_id where sl.store_id = p_store), 0),
    'units', coalesce((select sum(greatest(qty, 0)) from public.erp_stock_levels where store_id = p_store), 0),
    'out_of_stock', (select count(*) from public.products p where p.store_id = p_store and p.active and p.track_inventory and coalesce(p.stock, 0) <= 0),
    'low_stock', (select count(*) from public.products p where p.store_id = p_store and p.active and p.track_inventory and coalesce(p.stock, 0) between 1 and 5),
    'transfers_in_transit', (select count(*) from public.erp_transfers where store_id = p_store and status = 'in_transit'),
    'purchases_month', coalesce((select sum(total) from public.erp_purchases where store_id = p_store and status = 'received'
      and created_at >= date_trunc('month', now())), 0),
    'payables_total', coalesce((select sum(balance) from public.erp_payables where store_id = p_store and status = 'open'), 0),
    'payables_overdue', coalesce((select sum(balance) from public.erp_payables where store_id = p_store and status = 'open' and due_date < current_date), 0),
    'receivables_total', coalesce((select sum(balance) from public.pos_ar_accounts where store_id = p_store and coalesce(status, 'open') = 'open'), 0),
    'warehouses', (select count(*) from public.erp_warehouses where store_id = p_store and active),
    'suppliers', (select count(*) from public.erp_suppliers where store_id = p_store and active)
  ) into r;
  return r;
end;
$$;

grant execute on function public.erp_receive_purchase(uuid, uuid, uuid, text, text, date, text, jsonb) to authenticated;
grant execute on function public.erp_cancel_purchase(uuid, text) to authenticated;
grant execute on function public.erp_pay_supplier(uuid, numeric, text, text) to authenticated;
grant execute on function public.erp_create_transfer(uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.erp_receive_transfer(uuid) to authenticated;
grant execute on function public.erp_cancel_transfer(uuid, text) to authenticated;
grant execute on function public.erp_post_adjustment(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.erp_kardex(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.erp_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS: aislamiento por tienda + permiso. Los documentos solo se
--    crean/modifican por las funciones anteriores (no hay INSERT directo).
-- ---------------------------------------------------------------------
alter table public.erp_warehouses enable row level security;
alter table public.erp_stock_levels enable row level security;
alter table public.erp_counters enable row level security;
alter table public.erp_suppliers enable row level security;
alter table public.erp_purchases enable row level security;
alter table public.erp_purchase_items enable row level security;
alter table public.erp_payables enable row level security;
alter table public.erp_payable_payments enable row level security;
alter table public.erp_transfers enable row level security;
alter table public.erp_transfer_items enable row level security;
alter table public.erp_adjustments enable row level security;
alter table public.erp_adjustment_items enable row level security;
alter table public.erp_audit_logs enable row level security;

drop policy if exists erp_wh_select on public.erp_warehouses;
create policy erp_wh_select on public.erp_warehouses for select to authenticated
  using (public.erp_can(store_id, 'inventory') or public.erp_can(store_id, 'pos') or public.erp_can(store_id, 'products'));
drop policy if exists erp_wh_write on public.erp_warehouses;
create policy erp_wh_write on public.erp_warehouses for all to authenticated
  using (public.erp_can(store_id, 'inventory')) with check (public.erp_can(store_id, 'inventory'));

drop policy if exists erp_stock_select on public.erp_stock_levels;
create policy erp_stock_select on public.erp_stock_levels for select to authenticated
  using (public.erp_can(store_id, 'inventory') or public.erp_can(store_id, 'products'));

drop policy if exists erp_sup_select on public.erp_suppliers;
create policy erp_sup_select on public.erp_suppliers for select to authenticated
  using (public.erp_can(store_id, 'suppliers') or public.erp_can(store_id, 'purchases'));
drop policy if exists erp_sup_write on public.erp_suppliers;
create policy erp_sup_write on public.erp_suppliers for all to authenticated
  using (public.erp_can(store_id, 'suppliers')) with check (public.erp_can(store_id, 'suppliers'));

drop policy if exists erp_pur_select on public.erp_purchases;
create policy erp_pur_select on public.erp_purchases for select to authenticated
  using (public.erp_can(store_id, 'purchases'));
drop policy if exists erp_puri_select on public.erp_purchase_items;
create policy erp_puri_select on public.erp_purchase_items for select to authenticated
  using (exists (select 1 from public.erp_purchases pu where pu.id = purchase_id and public.erp_can(pu.store_id, 'purchases')));

drop policy if exists erp_ap_select on public.erp_payables;
create policy erp_ap_select on public.erp_payables for select to authenticated
  using (public.erp_can(store_id, 'payables'));
drop policy if exists erp_app_select on public.erp_payable_payments;
create policy erp_app_select on public.erp_payable_payments for select to authenticated
  using (public.erp_can(store_id, 'payables'));

drop policy if exists erp_tr_select on public.erp_transfers;
create policy erp_tr_select on public.erp_transfers for select to authenticated
  using (public.erp_can(store_id, 'transfers') or public.erp_can(store_id, 'inventory'));
drop policy if exists erp_tri_select on public.erp_transfer_items;
create policy erp_tri_select on public.erp_transfer_items for select to authenticated
  using (exists (select 1 from public.erp_transfers t where t.id = transfer_id
    and (public.erp_can(t.store_id, 'transfers') or public.erp_can(t.store_id, 'inventory'))));

drop policy if exists erp_adj_select on public.erp_adjustments;
create policy erp_adj_select on public.erp_adjustments for select to authenticated
  using (public.erp_can(store_id, 'inventory_adjust') or public.erp_can(store_id, 'inventory'));
drop policy if exists erp_adji_select on public.erp_adjustment_items;
create policy erp_adji_select on public.erp_adjustment_items for select to authenticated
  using (exists (select 1 from public.erp_adjustments a where a.id = adjustment_id
    and (public.erp_can(a.store_id, 'inventory_adjust') or public.erp_can(a.store_id, 'inventory'))));

drop policy if exists erp_audit_select on public.erp_audit_logs;
create policy erp_audit_select on public.erp_audit_logs for select to authenticated
  using (public.erp_can(store_id, 'audit'));

-- Los documentos son inmutables: nadie edita ni borra directamente.
revoke insert, update, delete on public.erp_stock_levels, public.erp_purchases, public.erp_purchase_items,
  public.erp_payables, public.erp_payable_payments, public.erp_transfers, public.erp_transfer_items,
  public.erp_adjustments, public.erp_adjustment_items, public.erp_audit_logs, public.erp_counters
  from anon, authenticated;
revoke all on public.erp_counters from anon, authenticated;
-- Bodegas y proveedores se desactivan, no se borran (conservan historial).
revoke delete on public.erp_warehouses, public.erp_suppliers from anon, authenticated;

-- Auditoría de cambios de proveedores y bodegas
create or replace function public.erp_audit_master_data()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.erp_audit(coalesce(new.store_id, old.store_id), tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce(new.id, old.id), jsonb_build_object('name', coalesce(new.name, old.name)));
  return coalesce(new, old);
end;
$$;
drop trigger if exists erp_suppliers_audit on public.erp_suppliers;
create trigger erp_suppliers_audit after insert or update or delete on public.erp_suppliers
  for each row execute function public.erp_audit_master_data();
drop trigger if exists erp_warehouses_audit on public.erp_warehouses;
create trigger erp_warehouses_audit after insert or update or delete on public.erp_warehouses
  for each row execute function public.erp_audit_master_data();
