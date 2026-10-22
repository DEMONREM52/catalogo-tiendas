-- =====================================================================
-- REMHUB · Plata y control
--
--   1. Ventas por debajo del costo: cada venta del POS que lleva un producto
--      más barato que su costo queda registrada (quién, dónde, cuánto) y se
--      avisa al celular de quien maneja la plata (dueño, admin de la tienda,
--      «Ver costos», «Rentabilidad» o «Aprobar precios»).
--      erp_below_cost_check: el POS pregunta antes de cobrar (sin revelar el costo).
--   2. Cierre del día: erp_daily_close (pantalla) y erp_daily_close_digest
--      (para el aviso de las 9 p. m.): ventas por punto, quién vendió más,
--      cómo cerró cada caja, traslados pendientes y lo que se agotó hoy.
--   3. Productos quietos: erp_stale_stock — con unidades y sin ventas en N días,
--      con la plata parada (el valor solo con «Ver costos»).
--   4. Margen real por producto: erp_product_margins — qué deja cada producto.
--   5. Precios por debajo del costo: erp_prices_below_cost.
-- No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- 1. alertas
create table if not exists public.erp_cost_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null,
  point_id uuid,
  product_id uuid,
  product_name text,
  qty integer not null default 1,
  price numeric not null default 0,
  cost numeric not null default 0,
  seller_id uuid,
  seller_name text,
  doc_number text,
  seen_at timestamptz,
  seen_by uuid,
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);
create index if not exists erp_cost_alerts_store on public.erp_cost_alerts (store_id, created_at desc);
alter table public.erp_cost_alerts enable row level security;
revoke all on public.erp_cost_alerts from anon, authenticated;

-- Quién se entera de la plata (costos, rentabilidad o aprobar precios; el dueño siempre).
create or replace function public.erp__money_watcher(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.erp_can(p_store, 'costs_view') or public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'price_approve'));
$$;
grant execute on function public.erp__money_watcher(uuid) to authenticated;

-- Al etiquetar una venta del POS (número del punto) se revisa cada producto contra su costo.
create or replace function public.erp__capture_cost_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  begin
    insert into public.erp_cost_alerts (store_id, order_id, point_id, product_id, product_name, qty, price, cost, seller_id, seller_name, doc_number)
    select new.store_id, new.order_id, new.point_id, oi.product_id, p.name, sum(oi.quantity)::integer, min(oi.price), coalesce(p.cost_price, 0),
           new.seller_id, new.seller_name, new.doc_number
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = new.order_id and coalesce(p.cost_price, 0) > 0 and oi.price < p.cost_price
    group by oi.product_id, p.name, p.cost_price
    on conflict (order_id, product_id) do nothing;
    get diagnostics n = row_count;
    -- Aviso al celular (pg_net), si está instalado. Nunca frena la venta.
    if n > 0 and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
      perform net.http_post(
        url := 'https://remhub.co/api/push/cost-alerts',
        body := jsonb_build_object('order_id', new.order_id),
        headers := '{"Content-Type": "application/json"}'::jsonb);
    end if;
  exception when others then
    null; -- una alerta nunca puede impedir facturar
  end;
  return new;
end;
$$;
drop trigger if exists zzz_erp_cost_alerts on public.erp_order_meta;
create trigger zzz_erp_cost_alerts after insert on public.erp_order_meta
  for each row execute function public.erp__capture_cost_alerts();

-- El POS pregunta antes de cobrar: qué productos quedan por debajo del costo (sin decir el costo).
create or replace function public.erp_below_cost_check(p_store uuid, p_items jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name) order by p.name)
      from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
      join public.products p on p.id = (x->>'product_id')::uuid and p.store_id = p_store
      where coalesce(p.cost_price, 0) > 0 and coalesce((x->>'price')::numeric, 0) < p.cost_price
    ), '[]'::jsonb) end;
$$;
revoke all on function public.erp_below_cost_check(uuid, jsonb) from public, anon;
grant execute on function public.erp_below_cost_check(uuid, jsonb) to authenticated;

create or replace function public.erp_cost_alerts_list(p_store uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not public.erp__money_watcher(p_store) then return jsonb_build_object('ok', false, 'error', 'Solo quien maneja costos o rentabilidad.'); end if;
  select jsonb_build_object('ok', true,
    'unseen', count(*) filter (where a.seen_at is null),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'order_id', a.order_id, 'product', a.product_name, 'qty', a.qty, 'price', a.price, 'cost', a.cost,
      'loss', round((a.cost - a.price) * a.qty), 'seller', a.seller_name, 'doc', a.doc_number, 'point', w.name,
      'token', o.token, 'at', a.created_at, 'seen', a.seen_at is not null) order by a.created_at desc), '[]'::jsonb))
  into r
  from public.erp_cost_alerts a
  left join public.erp_warehouses w on w.id = a.point_id
  left join public.orders o on o.id = a.order_id
  where a.store_id = p_store and a.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  return r;
end;
$$;
revoke all on function public.erp_cost_alerts_list(uuid, integer) from public, anon;
grant execute on function public.erp_cost_alerts_list(uuid, integer) to authenticated;

create or replace function public.erp_cost_alerts_seen(p_store uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.erp__money_watcher(p_store) then return jsonb_build_object('ok', false); end if;
  update public.erp_cost_alerts set seen_at = now(), seen_by = auth.uid() where store_id = p_store and seen_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'seen', n);
end;
$$;
revoke all on function public.erp_cost_alerts_seen(uuid) from public, anon;
grant execute on function public.erp_cost_alerts_seen(uuid) to authenticated;

-- Para el aviso al celular (solo el servidor): la alerta de una venta y a quién avisar.
create or replace function public.erp_cost_alert_push(p_order uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $f$
  with a as (
    select a.*, w.name as point_name from public.erp_cost_alerts a left join public.erp_warehouses w on w.id = a.point_id where a.order_id = p_order
  ), s as (select (array_agg(store_id))[1] as store_id from a)
  select case when (select store_id from s) is null then null else jsonb_build_object(
    'store_id', (select store_id from s),
    'created_at', (select max(created_at) from a),
    'doc', (select max(doc_number) from a), 'seller', (select max(seller_name) from a), 'point', (select max(point_name) from a),
    'items', (select jsonb_agg(jsonb_build_object('product', product_name, 'qty', qty, 'price', price, 'cost', cost)) from a),
    'loss', (select round(sum((cost - price) * qty)) from a),
    'users', (select coalesce(jsonb_agg(distinct u), '[]'::jsonb) from (
        select st.owner_id as u from public.stores st where st.id = (select store_id from s)
        union
        select su.user_id from public.store_users su
        where su.store_id = (select store_id from s) and su.active
          and (su.role = 'store_admin' or su.permissions && array['costs_view', 'profit_view', 'price_approve']::text[])
      ) x where u is not null)) end;
$f$;
revoke all on function public.erp_cost_alert_push(uuid) from public, anon, authenticated;
grant execute on function public.erp_cost_alert_push(uuid) to service_role;

-- ---------------------------------------------------------------- 2. cierre del día
create or replace function public.erp__daily_close(p_store uuid, p_day date, p_points uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select (p_day::timestamp at time zone 'America/Bogota') as t0, ((p_day + 1)::timestamp at time zone 'America/Bogota') as t1
  ),
  sales as (
    select o.id, o.total, m.point_id, coalesce(nullif(btrim(m.seller_name), ''), 'Sin vendedor') as seller
    from public.orders o join public.erp_order_meta m on m.order_id = o.id, bounds b
    where o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= b.t0 and coalesce(o.confirmed_at, o.created_at) < b.t1
      and (p_points is null or m.point_id = any (p_points))
  ),
  by_point as (
    select w.name, count(*)::integer as n, coalesce(sum(s.total), 0) as total
    from sales s join public.erp_warehouses w on w.id = s.point_id group by w.name
  ),
  by_seller as (
    select s.seller, count(*)::integer as n, coalesce(sum(s.total), 0) as total from sales s group by s.seller
  ),
  cash as (
    select w.name, c.number, c.status, c.difference, c.closed_by_name
    from public.erp_cash_sessions c join public.erp_warehouses w on w.id = c.point_id, bounds b
    where c.store_id = p_store
      and c.closed_at >= b.t0 and c.closed_at < b.t1 and (p_points is null or c.point_id = any (p_points))
  ),
  open_cash as (
    select w.name from public.erp_cash_sessions c join public.erp_warehouses w on w.id = c.point_id
    where c.store_id = p_store and c.status = 'open' and (p_points is null or c.point_id = any (p_points))
  ),
  out_today as (
    select distinct p.name
    from public.inventory_movements mv join public.products p on p.id = mv.product_id, bounds b
    where mv.store_id = p_store and mv.created_at >= b.t0 and mv.created_at < b.t1
      and mv.qty_after = 0 and mv.kind = 'out' and (p_points is null or mv.warehouse_id = any (p_points))
      and not exists (select 1 from public.erp_stock_levels sl where sl.product_id = mv.product_id and sl.warehouse_id = mv.warehouse_id and sl.qty > 0)
  )
  select jsonb_build_object('ok', true, 'day', p_day,
    'total', (select coalesce(sum(total), 0) from sales),
    'count', (select count(*) from sales),
    'points', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n, 'total', round(total)) order by total desc) from by_point), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('name', seller, 'count', n, 'total', round(total)) order by total desc) from (select * from by_seller order by total desc limit 5) z), '[]'::jsonb),
    'cash', coalesce((select jsonb_agg(jsonb_build_object('point', name, 'number', number, 'status', status, 'difference', round(coalesce(difference, 0)), 'by', closed_by_name)) from cash), '[]'::jsonb),
    'cash_open', coalesce((select jsonb_agg(name) from open_cash), '[]'::jsonb),
    'transfers_pending', (select count(*) from public.erp_transfers t where t.store_id = p_store and t.status = 'in_transit'
                            and (p_points is null or t.from_warehouse_id = any (p_points) or t.to_warehouse_id = any (p_points))),
    'out_of_stock', coalesce((select jsonb_agg(name order by name) from (select name from out_today limit 30) z), '[]'::jsonb),
    'out_count', (select count(*) from out_today),
    'below_cost', (select count(distinct a.order_id) from public.erp_cost_alerts a, bounds b where a.store_id = p_store and a.created_at >= b.t0 and a.created_at < b.t1
                     and (p_points is null or a.point_id = any (p_points))));
$$;
revoke all on function public.erp__daily_close(uuid, date, uuid[]) from public, anon, authenticated;

create or replace function public.erp_daily_close(p_store uuid, p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[];
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'reports') or public.erp_can(p_store, 'cash_manage') or public.erp_can(p_store, 'profit_view')) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Informes de ventas» o «Administrar caja».');
  end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  return public.erp__daily_close(p_store, coalesce(p_day, (now() at time zone 'America/Bogota')::date), v);
end;
$$;
revoke all on function public.erp_daily_close(uuid, date) from public, anon;
grant execute on function public.erp_daily_close(uuid, date) to authenticated;

-- Para el aviso de las 9 p. m. (solo el servidor): cada tienda con ventas hoy y a quién avisar.
create or replace function public.erp_daily_close_digest()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with today as (select (now() at time zone 'America/Bogota')::date as d),
  active as (
    select distinct o.store_id from public.orders o, today
    where coalesce(o.confirmed_at, o.created_at) >= (today.d::timestamp at time zone 'America/Bogota')
      and o.status in ('confirmed', 'completed')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'store_id', a.store_id,
      'summary', public.erp__daily_close(a.store_id, (select d from today), null),
      'users', (select coalesce(jsonb_agg(distinct u), '[]'::jsonb) from (
        select s.owner_id as u from public.stores s where s.id = a.store_id
        union
        select su.user_id from public.store_users su where su.store_id = a.store_id and su.active
          and (su.role = 'store_admin' or su.permissions && array['reports', 'profit_view']::text[])
          and su.point_id is null
      ) x where u is not null))), '[]'::jsonb)
  from active a;
$$;
revoke all on function public.erp_daily_close_digest() from public, anon, authenticated;
grant execute on function public.erp_daily_close_digest() to service_role;

-- ---------------------------------------------------------------- 3. productos quietos
create or replace function public.erp_stale_stock(p_store uuid, p_days integer default 60, p_point uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[];
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 60), 7), 730));
  can_cost boolean;
  r jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'products') or public.erp_can(p_store, 'reports')) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas permiso de inventario.');
  end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  if p_point is not null and v is not null and not (p_point = any (v)) then return jsonb_build_object('ok', false, 'error', 'Ese punto no es tuyo.'); end if;
  can_cost := public.erp_can(p_store, 'costs_view');
  with stock as (
    select sl.product_id, sl.warehouse_id, sl.qty
    from public.erp_stock_levels sl
    where sl.store_id = p_store and sl.qty > 0
      and (p_point is null or sl.warehouse_id = p_point) and (v is null or sl.warehouse_id = any (v))
  ),
  last_sale as (
    select oi.product_id, m.point_id, max(coalesce(o.confirmed_at, o.created_at)) as at, sum(oi.quantity) filter (where coalesce(o.confirmed_at, o.created_at) >= v_since) as sold
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.store_id = p_store and o.status in ('confirmed', 'completed')
    left join public.erp_order_meta m on m.order_id = o.id
    where oi.product_id in (select product_id from stock)
    group by oi.product_id, m.point_id
  ),
  last_in as (
    select mv.product_id, mv.warehouse_id, max(mv.created_at) as at
    from public.inventory_movements mv
    where mv.store_id = p_store and mv.kind = 'in' and mv.product_id in (select product_id from stock)
    group by 1, 2
  ),
  rows as (
    select s.product_id, s.warehouse_id, s.qty, p.name, p.sku, p.image_url, p.cost_price, p.price_3, w.name as point,
           ls.at as last_sale, coalesce(ls.sold, 0) as sold, li.at as last_in
    from stock s
    join public.products p on p.id = s.product_id and coalesce(p.active, true)
    join public.erp_warehouses w on w.id = s.warehouse_id
    left join last_sale ls on ls.product_id = s.product_id and ls.point_id is not distinct from s.warehouse_id
    left join last_in li on li.product_id = s.product_id and li.warehouse_id = s.warehouse_id
    where coalesce(ls.sold, 0) = 0
      and coalesce(li.at, '-infinity'::timestamptz) < v_since   -- lo que acaba de entrar todavía no cuenta como quieto
  )
  select jsonb_build_object('ok', true, 'days', p_days, 'can_cost', can_cost,
    'units', coalesce(sum(qty), 0),
    'value', case when can_cost then round(coalesce(sum(qty * coalesce(cost_price, 0)), 0)) end,
    'retail', round(coalesce(sum(qty * coalesce(price_3, 0)), 0)),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'warehouse_id', warehouse_id, 'name', name, 'sku', sku, 'image_url', image_url, 'point', point,
      'qty', qty, 'last_sale', last_sale, 'last_in', last_in,
      'days', case when last_sale is not null then floor(extract(epoch from now() - last_sale) / 86400)::integer end,
      'value', case when can_cost then round(qty * coalesce(cost_price, 0)) end,
      'retail', round(qty * coalesce(price_3, 0)))
      order by case when can_cost then qty * coalesce(cost_price, 0) else qty * coalesce(price_3, 0) end desc), '[]'::jsonb))
  into r
  from (select * from rows order by case when can_cost then qty * coalesce(cost_price, 0) else qty * coalesce(price_3, 0) end desc limit 1000) x;
  return r;
end;
$$;
revoke all on function public.erp_stale_stock(uuid, integer, uuid) from public, anon;
grant execute on function public.erp_stale_stock(uuid, integer, uuid) to authenticated;

-- ---------------------------------------------------------------- 4. margen por producto
create or replace function public.erp_product_margins(p_store uuid, p_from timestamptz, p_to timestamptz, p_point uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[];
  r jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'costs_view')) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Ver costos» o «Rentabilidad».');
  end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  if p_point is not null and v is not null and not (p_point = any (v)) then return jsonb_build_object('ok', false, 'error', 'Ese punto no es tuyo.'); end if;
  with lines as (
    select l.product_id, sum(l.qty)::integer as qty, sum(l.revenue) as revenue, sum(l.cost) as cost, count(distinct l.order_id)::integer as orders
    from public.erp__sale_lines(p_store, p_from, p_to, p_point) l
    where l.product_id is not null and (v is null or l.point_id = any (v))
    group by l.product_id
  ),
  ranked as (
    select x.*, p.name, p.sku, p.image_url, coalesce(p.cost_price, 0) as cost_now,
           x.revenue - x.cost as profit,
           case when x.revenue > 0 then round((x.revenue - x.cost) / x.revenue * 100, 1) end as margin,
           rank() over (order by x.qty desc) as rank_qty,
           rank() over (order by x.revenue - x.cost desc) as rank_profit
    from lines x join public.products p on p.id = x.product_id
  )
  select jsonb_build_object('ok', true,
    'revenue', round(coalesce(sum(revenue), 0)), 'cost', round(coalesce(sum(cost), 0)), 'profit', round(coalesce(sum(profit), 0)),
    'margin', case when sum(revenue) > 0 then round(sum(profit) / sum(revenue) * 100, 1) end,
    'no_cost', count(*) filter (where cost_now <= 0),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'name', name, 'sku', sku, 'image_url', image_url, 'qty', qty, 'orders', orders,
      'revenue', round(revenue), 'cost', round(cost), 'profit', round(profit), 'margin', margin,
      'rank_qty', rank_qty, 'rank_profit', rank_profit, 'no_cost', cost_now <= 0,
      -- «Se vende mucho y deja poco»: entre los 20 más vendidos pero con margen bajo (menos del 15 %).
      'sells_but_low', rank_qty <= 20 and coalesce(margin, 0) < 15)
      order by profit desc), '[]'::jsonb))
  into r
  from (select * from ranked order by profit desc limit 2000) z;
  return r;
end;
$$;
revoke all on function public.erp_product_margins(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.erp_product_margins(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------- 5. precios bajo el costo
create or replace function public.erp_prices_below_cost(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'costs_view') or public.erp_can(p_store, 'profit_view')) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Ver costos».');
  end if;
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(jsonb_build_object(
      'product_id', p.id, 'name', p.name, 'sku', p.sku, 'cost', p.cost_price,
      'levels', (select jsonb_agg(l) from unnest(array[1, 2, 3, 4, 5]) l
                 where coalesce(case l when 1 then p.price_1 when 2 then p.price_2 when 3 then p.price_3 when 4 then p.price_4 else p.price_5 end, 0) between 0.01 and p.cost_price - 0.01),
      'prices', jsonb_build_array(p.price_1, p.price_2, p.price_3, p.price_4, p.price_5)) order by p.name), '[]'::jsonb))
  into r
  from public.products p
  where p.store_id = p_store and coalesce(p.active, true) and coalesce(p.cost_price, 0) > 0
    and (   (coalesce(p.price_1, 0) > 0 and p.price_1 < p.cost_price) or (coalesce(p.price_2, 0) > 0 and p.price_2 < p.cost_price)
         or (coalesce(p.price_3, 0) > 0 and p.price_3 < p.cost_price) or (coalesce(p.price_4, 0) > 0 and p.price_4 < p.cost_price)
         or (coalesce(p.price_5, 0) > 0 and p.price_5 < p.cost_price));
  return r;
end;
$$;
revoke all on function public.erp_prices_below_cost(uuid) from public, anon;
grant execute on function public.erp_prices_below_cost(uuid) to authenticated;

notify pgrst, 'reload schema';
