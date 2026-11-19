-- =====================================================================
-- REMHUB · Órdenes de compra
--
-- Lo que se le pide al proveedor ANTES de que llegue la factura. Cuando la
-- mercancía llega, se registra el ingreso como siempre (erp_receive_invoice)
-- y se le asocia la orden: RemHub compara lo pedido con lo recibido
-- (faltó, sobró, cambió el costo, llegó algo que no se pidió).
--
-- Una orden NO mueve inventario, costos ni cuentas por pagar: eso lo hace
-- solo el ingreso de la factura.
-- Estados: open (abierta) → partial (llegó una parte) → received (llegó
-- todo). closed = se cierra aunque falte (ya no llegará). cancelled =
-- anulada (solo si no tiene facturas asociadas).
-- Permiso: Ingresos (purchases). No cambia datos ni permisos existentes.
-- Es idempotente.
-- =====================================================================

create table if not exists public.erp_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  supplier_id uuid not null references public.erp_suppliers(id),
  status text not null default 'open' check (status in ('open', 'partial', 'received', 'closed', 'cancelled')),
  expected_date date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, number)
);
create index if not exists erp_purchase_orders_store on public.erp_purchase_orders (store_id, created_at desc);

create table if not exists public.erp_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty integer not null check (qty > 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  unique (order_id, product_id)
);

create table if not exists public.erp_purchase_order_links (
  order_id uuid not null references public.erp_purchase_orders(id) on delete cascade,
  purchase_id uuid not null references public.erp_purchases(id) on delete cascade,
  linked_by uuid,
  created_at timestamptz not null default now(),
  primary key (order_id, purchase_id)
);
create index if not exists erp_purchase_order_links_purchase on public.erp_purchase_order_links (purchase_id);

alter table public.erp_purchase_orders enable row level security;
alter table public.erp_purchase_order_items enable row level security;
alter table public.erp_purchase_order_links enable row level security;
-- Sin políticas: todo pasa por las funciones de abajo (revisan tienda y permiso).

-- Lo recibido de cada producto en las facturas asociadas (sin las anuladas).
create or replace function public.erp__po_received(p_order uuid)
returns table (product_id uuid, qty bigint, avg_cost numeric)
language sql stable security definer set search_path = public as $$
  select it.product_id, sum(it.qty)::bigint, round(sum(it.qty * it.unit_cost) / nullif(sum(it.qty), 0), 2)
  from public.erp_purchase_order_links k
  join public.erp_purchases pu on pu.id = k.purchase_id and pu.status <> 'cancelled'
  join public.erp_purchase_items it on it.purchase_id = pu.id
  where k.order_id = p_order
  group by it.product_id
$$;

-- Estado según lo recibido (no toca las cerradas ni las anuladas).
create or replace function public.erp__po_refresh(p_order uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_any boolean; v_all boolean;
begin
  select status into v_status from public.erp_purchase_orders where id = p_order;
  if v_status in ('closed', 'cancelled') then return v_status; end if;
  select coalesce(bool_or(coalesce(r.qty, 0) > 0), false), coalesce(bool_and(coalesce(r.qty, 0) >= i.qty), false)
    into v_any, v_all
  from public.erp_purchase_order_items i
  left join public.erp__po_received(p_order) r on r.product_id = i.product_id
  where i.order_id = p_order;
  v_status := case when v_all then 'received' when v_any then 'partial' else 'open' end;
  update public.erp_purchase_orders set status = v_status, updated_at = now() where id = p_order and status is distinct from v_status;
  return v_status;
end $$;

revoke all on function public.erp__po_received(uuid) from public, anon, authenticated;
revoke all on function public.erp__po_refresh(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- crear / editar
create or replace function public.erp_po_save(p_store uuid, p_order uuid, p_supplier uuid, p_expected date, p_notes text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.erp_purchase_orders;
  n_items integer;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Ingresos.');
  end if;
  if not exists (select 1 from public.erp_suppliers where id = p_supplier and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'Elige un proveedor de esta tienda.');
  end if;
  if jsonb_typeof(coalesce(p_items, 'null')) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 1000 then
    return jsonb_build_object('ok', false, 'message', 'Agrega entre 1 y 1.000 productos.');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    left join public.products p on p.id = (e->>'product_id')::uuid and p.store_id = p_store
    where p.id is null or coalesce((e->>'qty')::numeric, 0) <= 0 or (e->>'qty')::numeric <> floor((e->>'qty')::numeric)
       or coalesce((e->>'unit_cost')::numeric, 0) < 0
  ) then
    return jsonb_build_object('ok', false, 'message', 'Revisa los productos: cada uno debe ser de esta tienda, con cantidad entera mayor que 0 y costo de 0 o más.');
  end if;
  if (select count(distinct e->>'product_id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
    return jsonb_build_object('ok', false, 'message', 'Hay un producto repetido: déjalo una sola vez con la cantidad total.');
  end if;

  if p_order is null then
    insert into public.erp_purchase_orders (store_id, number, supplier_id, expected_date, notes, created_by)
    values (p_store, public.erp_next_number(p_store, 'purchase_order'), p_supplier, p_expected, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
    returning * into o;
  else
    select * into o from public.erp_purchase_orders where id = p_order and store_id = p_store for update;
    if o.id is null then return jsonb_build_object('ok', false, 'message', 'Esa orden no es de esta tienda.'); end if;
    if o.status <> 'open' or exists (select 1 from public.erp_purchase_order_links where order_id = o.id) then
      return jsonb_build_object('ok', false, 'message', 'Esta orden ya tiene mercancía recibida o está cerrada: ya no se edita.');
    end if;
    update public.erp_purchase_orders set supplier_id = p_supplier, expected_date = p_expected,
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now() where id = o.id returning * into o;
    delete from public.erp_purchase_order_items where order_id = o.id;
  end if;

  insert into public.erp_purchase_order_items (order_id, product_id, qty, unit_cost)
  select o.id, (e->>'product_id')::uuid, (e->>'qty')::integer, round(coalesce((e->>'unit_cost')::numeric, 0), 2)
  from jsonb_array_elements(p_items) e;
  get diagnostics n_items = row_count;

  perform public.erp_audit(p_store, case when p_order is null then 'purchase_order.create' else 'purchase_order.update' end,
    'erp_purchase_orders', o.id, jsonb_build_object('number', o.number, 'supplier_id', p_supplier, 'items', n_items));
  return jsonb_build_object('ok', true, 'id', o.id, 'number', o.number);
end $$;

-- ---------------------------------------------------------------- lista
create or replace function public.erp_po_list(p_store uuid, p_status text default null, p_supplier uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Ingresos.');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select o.id, o.number, o.status, o.expected_date, o.notes, o.created_at, o.supplier_id, s.name as supplier,
             (select coalesce(sum(i.qty), 0) from public.erp_purchase_order_items i where i.order_id = o.id) as units,
             (select coalesce(sum(i.qty * i.unit_cost), 0) from public.erp_purchase_order_items i where i.order_id = o.id) as total,
             (select count(*) from public.erp_purchase_order_items i where i.order_id = o.id) as lines,
             (select coalesce(sum(least(coalesce(r.qty, 0), i.qty)), 0) from public.erp_purchase_order_items i
                left join public.erp__po_received(o.id) r on r.product_id = i.product_id where i.order_id = o.id) as units_received,
             (select count(*) from public.erp_purchase_order_links k where k.order_id = o.id) as invoices
      from public.erp_purchase_orders o
      join public.erp_suppliers s on s.id = o.supplier_id
      where o.store_id = p_store
        and (p_status is null or o.status = p_status or (p_status = 'pending' and o.status in ('open', 'partial')))
        and (p_supplier is null or o.supplier_id = p_supplier)
      order by o.created_at desc
      limit 300
    ) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- detalle y comparación
create or replace function public.erp_po_detail(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o public.erp_purchase_orders;
begin
  select * into o from public.erp_purchase_orders where id = p_order;
  if o.id is null or auth.uid() is null or not public.erp_can(o.store_id, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'No encontré esa orden o no tienes el permiso de Ingresos.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'order', (select row_to_json(x)::jsonb from (select o.id, o.number, o.status, o.expected_date, o.notes, o.created_at, o.supplier_id,
                                                          s.name as supplier, s.phone as supplier_phone
                                                   from public.erp_suppliers s where s.id = o.supplier_id) x),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', i.product_id, 'name', p.name, 'sku', p.sku, 'qty', i.qty, 'unit_cost', i.unit_cost,
               'received', coalesce(r.qty, 0), 'received_cost', r.avg_cost,
               'pending', greatest(i.qty - coalesce(r.qty, 0), 0), 'extra', greatest(coalesce(r.qty, 0) - i.qty, 0))
             order by p.name)
      from public.erp_purchase_order_items i
      join public.products p on p.id = i.product_id
      left join public.erp__po_received(o.id) r on r.product_id = i.product_id
      where i.order_id = o.id), '[]'::jsonb),
    -- Llegó en las facturas pero no estaba en la orden.
    'unordered', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', r.product_id, 'name', p.name, 'sku', p.sku, 'received', r.qty, 'received_cost', r.avg_cost) order by p.name)
      from public.erp__po_received(o.id) r
      join public.products p on p.id = r.product_id
      where not exists (select 1 from public.erp_purchase_order_items i where i.order_id = o.id and i.product_id = r.product_id)), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', pu.id, 'number', pu.number, 'invoice_ref', pu.invoice_ref, 'status', pu.status, 'total', pu.total, 'created_at', pu.created_at)
                       order by pu.created_at)
      from public.erp_purchase_order_links k join public.erp_purchases pu on pu.id = k.purchase_id
      where k.order_id = o.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- asociar la factura
create or replace function public.erp_po_link(p_order uuid, p_purchase uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.erp_purchase_orders; pu public.erp_purchases; v_status text;
begin
  select * into o from public.erp_purchase_orders where id = p_order for update;
  if o.id is null or auth.uid() is null or not public.erp_can(o.store_id, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'No encontré esa orden o no tienes el permiso de Ingresos.');
  end if;
  select * into pu from public.erp_purchases where id = p_purchase and store_id = o.store_id;
  if pu.id is null then return jsonb_build_object('ok', false, 'message', 'Ese ingreso no es de esta tienda.'); end if;
  if pu.status = 'cancelled' then return jsonb_build_object('ok', false, 'message', 'Ese ingreso está anulado.'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'message', 'La orden está anulada.'); end if;
  if pu.supplier_id <> o.supplier_id then
    return jsonb_build_object('ok', false, 'message', 'El ingreso es de otro proveedor que la orden.');
  end if;
  insert into public.erp_purchase_order_links (order_id, purchase_id, linked_by) values (o.id, pu.id, auth.uid())
  on conflict do nothing;
  v_status := public.erp__po_refresh(o.id);
  perform public.erp_audit(o.store_id, 'purchase_order.link', 'erp_purchase_orders', o.id,
    jsonb_build_object('number', o.number, 'purchase_id', pu.id, 'purchase_number', pu.number, 'status', v_status));
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- ---------------------------------------------------------------- cerrar, reabrir, anular
create or replace function public.erp_po_status(p_order uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.erp_purchase_orders; v_status text;
begin
  select * into o from public.erp_purchase_orders where id = p_order for update;
  if o.id is null or auth.uid() is null or not public.erp_can(o.store_id, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'No encontré esa orden o no tienes el permiso de Ingresos.');
  end if;
  if p_status not in ('closed', 'cancelled', 'open') then
    return jsonb_build_object('ok', false, 'message', 'Estado no válido.');
  end if;
  if p_status = 'cancelled' and exists (select 1 from public.erp_purchase_order_links where order_id = o.id) then
    return jsonb_build_object('ok', false, 'message', 'Ya tiene facturas asociadas: no se anula, ciérrala.');
  end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'message', 'La orden está anulada.'); end if;
  if p_status = 'open' then
    if o.status <> 'closed' then return jsonb_build_object('ok', false, 'message', 'Solo se reabre una orden cerrada.'); end if;
    update public.erp_purchase_orders set status = 'open', updated_at = now() where id = o.id;
    v_status := public.erp__po_refresh(o.id);
  else
    update public.erp_purchase_orders set status = p_status, updated_at = now() where id = o.id;
    v_status := p_status;
  end if;
  perform public.erp_audit(o.store_id, 'purchase_order.' || p_status, 'erp_purchase_orders', o.id,
    jsonb_build_object('number', o.number, 'from', o.status, 'to', v_status));
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- Si se anula un ingreso asociado, la orden se recalcula (vuelve a quedar pendiente lo que traía).
create or replace function public.erp__po_purchase_cancelled()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    for r in select order_id from public.erp_purchase_order_links where purchase_id = new.id loop
      perform public.erp__po_refresh(r.order_id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists zz_erp_po_purchase_cancelled on public.erp_purchases;
create trigger zz_erp_po_purchase_cancelled after update of status on public.erp_purchases
  for each row execute function public.erp__po_purchase_cancelled();
revoke all on function public.erp__po_purchase_cancelled() from public, anon, authenticated;

revoke all on function public.erp_po_save(uuid, uuid, uuid, date, text, jsonb) from public, anon;
revoke all on function public.erp_po_list(uuid, text, uuid) from public, anon;
revoke all on function public.erp_po_detail(uuid) from public, anon;
revoke all on function public.erp_po_link(uuid, uuid) from public, anon;
revoke all on function public.erp_po_status(uuid, text) from public, anon;
grant execute on function public.erp_po_save(uuid, uuid, uuid, date, text, jsonb) to authenticated;
grant execute on function public.erp_po_list(uuid, text, uuid) to authenticated;
grant execute on function public.erp_po_detail(uuid) to authenticated;
grant execute on function public.erp_po_link(uuid, uuid) to authenticated;
grant execute on function public.erp_po_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
