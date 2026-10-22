-- =====================================================================
-- REMHUB · Inventario: ayudas opcionales
--
--   1. Qué comprar: erp_purchase_suggestions — con lo vendido en 30 días en
--      toda la tienda, lo que hay (bodegas + puntos + lo que va en camino) y
--      cuántos días alcanza, propone cuánto comprar para cubrir N días, con
--      el último proveedor y el último costo (el costo solo con «Ver costos»).
--   2. Vencimientos: erp_product_lots — al ingresar mercancía que vence se
--      anota el lote y la fecha (opcional). Avisa lo que vence pronto y se
--      marca cuando se vendió, se retiró o se dañó. No cambia existencias.
-- Nada de esto es obligatorio: los procesos normales siguen igual.
-- No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- 1. qué comprar
create or replace function public.erp_purchase_suggestions(p_store uuid, p_cover integer default 30, p_supplier uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cover integer := least(greatest(coalesce(p_cover, 30), 7), 180);
  can_cost boolean;
  r jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso de compras.');
  end if;
  can_cost := public.erp_can(p_store, 'costs_view');
  with sold as (
    select oi.product_id, sum(oi.quantity)::numeric as qty
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= now() - interval '30 days'
    group by 1
  ),
  stock as (
    select sl.product_id, sum(greatest(sl.qty, 0))::numeric as qty from public.erp_stock_levels sl where sl.store_id = p_store group by 1
  ),
  transit as (
    select i.product_id, sum(i.qty)::numeric as qty
    from public.erp_transfers t join public.erp_transfer_items i on i.transfer_id = t.id
    where t.store_id = p_store and t.status = 'in_transit' group by 1
  ),
  last_buy as (
    select distinct on (pi.product_id) pi.product_id, pu.supplier_id, s.name as supplier, pi.unit_cost, pu.created_at
    from public.erp_purchase_items pi
    join public.erp_purchases pu on pu.id = pi.purchase_id and pu.store_id = p_store and pu.status = 'received'
    left join public.erp_suppliers s on s.id = pu.supplier_id
    order by pi.product_id, pu.created_at desc
  ),
  need as (
    select p.id, p.name, p.sku, p.image_url, so.qty as sold_30, round(so.qty / 30.0, 2) as per_day,
           coalesce(st.qty, 0) as stock, coalesce(tr.qty, 0) as transit,
           round((coalesce(st.qty, 0) + coalesce(tr.qty, 0)) / nullif(so.qty / 30.0, 0), 1) as days_left,
           greatest(0, ceil(so.qty / 30.0 * v_cover) - coalesce(st.qty, 0) - coalesce(tr.qty, 0))::integer as qty,
           lb.supplier_id, lb.supplier, lb.unit_cost, lb.created_at as last_buy
    from sold so
    join public.products p on p.id = so.product_id and p.store_id = p_store and coalesce(p.active, true)
    left join stock st on st.product_id = so.product_id
    left join transit tr on tr.product_id = so.product_id
    left join last_buy lb on lb.product_id = so.product_id
    where p_supplier is null or lb.supplier_id = p_supplier
  )
  select jsonb_build_object('ok', true, 'cover', v_cover, 'can_cost', can_cost,
    'suppliers', coalesce((select jsonb_agg(distinct jsonb_build_object('id', supplier_id, 'name', supplier)) from need where qty > 0 and supplier_id is not null), '[]'::jsonb),
    'total', case when can_cost then round(coalesce(sum(qty * coalesce(unit_cost, 0)), 0)) end,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'product_id', id, 'name', name, 'sku', sku, 'image_url', image_url, 'sold_30', sold_30, 'per_day', per_day,
      'stock', stock, 'transit', transit, 'days_left', days_left, 'qty', qty,
      'supplier_id', supplier_id, 'supplier', supplier, 'last_buy', last_buy,
      'unit_cost', case when can_cost then unit_cost end) order by days_left nulls first, qty desc), '[]'::jsonb))
  into r
  from (select * from need where qty > 0 order by days_left nulls first limit 500) x;
  return r;
end;
$$;
revoke all on function public.erp_purchase_suggestions(uuid, integer, uuid) from public, anon;
grant execute on function public.erp_purchase_suggestions(uuid, integer, uuid) to authenticated;

-- ---------------------------------------------------------------- 2. vencimientos
create table if not exists public.erp_product_lots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid references public.erp_warehouses(id) on delete set null,
  purchase_id uuid,
  lot text,
  qty integer not null default 0 check (qty >= 0),
  expires_on date not null,
  status text not null default 'active' check (status in ('active', 'sold', 'removed', 'damaged')),
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_name text
);
create index if not exists erp_product_lots_store on public.erp_product_lots (store_id, status, expires_on);
alter table public.erp_product_lots enable row level security;
revoke all on public.erp_product_lots from anon, authenticated;

create or replace function public.erp__lots_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'purchases') or public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'products'));
$$;
grant execute on function public.erp__lots_allowed(uuid) to authenticated;

create or replace function public.erp_lot_save(p_store uuid, p_items jsonb, p_purchase uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  n integer := 0;
  v_name text;
begin
  if not public.erp__lots_allowed(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  v_name := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end;
  for it in select * from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) loop
    if (it->>'expires_on') is null or (it->>'product_id') is null then continue; end if;
    if not exists (select 1 from public.products p where p.id = (it->>'product_id')::uuid and p.store_id = p_store) then continue; end if;
    insert into public.erp_product_lots (store_id, product_id, warehouse_id, purchase_id, lot, qty, expires_on, note, created_by, created_by_name)
    values (p_store, (it->>'product_id')::uuid, nullif(it->>'warehouse_id', '')::uuid, p_purchase, nullif(btrim(coalesce(it->>'lot', '')), ''),
            greatest(0, coalesce((it->>'qty')::integer, 0)), (it->>'expires_on')::date, nullif(btrim(coalesce(it->>'note', '')), ''), auth.uid(), v_name);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'saved', n);
end;
$$;
revoke all on function public.erp_lot_save(uuid, jsonb, uuid) from public, anon;
grant execute on function public.erp_lot_save(uuid, jsonb, uuid) to authenticated;

create or replace function public.erp_lots_list(p_store uuid, p_days integer default 60, p_all boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb; v uuid[];
begin
  if not public.erp__lots_allowed(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  select jsonb_build_object('ok', true,
    'expired', count(*) filter (where l.status = 'active' and l.expires_on < current_date),
    'soon', count(*) filter (where l.status = 'active' and l.expires_on between current_date and current_date + 30),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'product_id', l.product_id, 'name', p.name, 'sku', p.sku, 'image_url', p.image_url, 'point', w.name,
      'lot', l.lot, 'qty', l.qty, 'expires_on', l.expires_on, 'days', l.expires_on - current_date, 'status', l.status,
      'note', l.note, 'by', l.created_by_name, 'created_at', l.created_at) order by l.expires_on), '[]'::jsonb))
  into r
  from public.erp_product_lots l
  join public.products p on p.id = l.product_id
  left join public.erp_warehouses w on w.id = l.warehouse_id
  where l.store_id = p_store and (v is null or l.warehouse_id = any (v))
    and (p_all or (l.status = 'active' and l.expires_on <= current_date + least(greatest(coalesce(p_days, 60), 1), 730)));
  return r;
end;
$$;
revoke all on function public.erp_lots_list(uuid, integer, boolean) from public, anon;
grant execute on function public.erp_lots_list(uuid, integer, boolean) to authenticated;

create or replace function public.erp_lot_close(p_lot uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.erp_product_lots;
begin
  select * into l from public.erp_product_lots where id = p_lot;
  if not found or not public.erp__lots_allowed(l.store_id) then return jsonb_build_object('ok', false, 'error', 'No encontrado.'); end if;
  if p_status not in ('sold', 'removed', 'damaged', 'active') then return jsonb_build_object('ok', false, 'error', 'Estado no válido.'); end if;
  update public.erp_product_lots set status = p_status, note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
    closed_at = case when p_status = 'active' then null else now() end,
    closed_by_name = case when p_status = 'active' then null when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(l.store_id) end
  where id = p_lot;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_lot_close(uuid, text, text) from public, anon;
grant execute on function public.erp_lot_close(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
