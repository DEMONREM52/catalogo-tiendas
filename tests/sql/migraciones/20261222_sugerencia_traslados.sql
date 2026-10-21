-- =====================================================================
-- REMHUB · Sugerencia de traslado según lo que vende cada punto
--
--   · erp_restock_suggestions(store, origen, destinos, días): por cada punto
--     de destino mira lo vendido en los últimos 30 días, cuánto tiene hoy y
--     cuántos días le alcanza. Propone enviar lo necesario para cubrir
--     «días» (15 por defecto), sin pasar de lo que hay en el origen
--     (repartido entre destinos: primero al que se agota antes).
--   · Solo propone: la persona revisa y cambia las cantidades antes de enviar.
-- Solo lectura. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_restock_suggestions(p_store uuid, p_from uuid, p_targets uuid[], p_days integer default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 15), 1), 120);
  v_since timestamptz := now() - interval '30 days';
  r jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'transfers') or public.erp_can(p_store, 'inventory')) then
    return jsonb_build_object('ok', false, 'error', 'No tienes permiso de traslados.');
  end if;
  if to_regprocedure('public.erp_point_allowed(uuid, uuid)') is not null and not public.erp_point_allowed(p_store, p_from) then
    return jsonb_build_object('ok', false, 'error', 'No puedes enviar desde ese punto.');
  end if;
  with dest as (
    select w.id from public.erp_warehouses w
    where w.store_id = p_store and w.active and w.id = any (coalesce(p_targets, '{}')) and w.id <> p_from
  ),
  sold as (
    select m.point_id, oi.product_id, sum(oi.quantity)::numeric as qty
    from public.orders o
    join public.erp_order_meta m on m.order_id = o.id
    join public.order_items oi on oi.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= v_since
      and m.point_id in (select id from dest)
    group by 1, 2
  ),
  need as (
    select s.point_id, s.product_id, s.qty as sold_30, round(s.qty / 30.0, 2) as per_day,
           coalesce(sl.qty, 0) as have,
           greatest(0, ceil(s.qty / 30.0 * v_days) - coalesce(sl.qty, 0))::integer as want,
           case when s.qty > 0 then round(coalesce(sl.qty, 0) / (s.qty / 30.0), 1) end as days_left
    from sold s
    left join public.erp_stock_levels sl on sl.warehouse_id = s.point_id and sl.product_id = s.product_id
  ),
  origin as (
    select sl.product_id, sl.qty from public.erp_stock_levels sl where sl.warehouse_id = p_from and sl.qty > 0
  ),
  ranked as (
    -- El origen se reparte primero al punto que se queda sin unidades antes.
    select n.*, o.qty as origin_qty,
           coalesce(sum(n.want) over (partition by n.product_id order by n.days_left nulls last, n.point_id rows between unbounded preceding and 1 preceding), 0) as before_me
    from need n join origin o on o.product_id = n.product_id
    where n.want > 0
  )
  select jsonb_build_object('ok', true, 'days', v_days, 'items', coalesce(jsonb_agg(jsonb_build_object(
      'point_id', x.point_id, 'product_id', x.product_id, 'name', p.name, 'sku', p.sku,
      'sold_30', x.sold_30, 'per_day', x.per_day, 'have', x.have, 'days_left', x.days_left,
      'origin_qty', x.origin_qty, 'qty', least(x.want, greatest(0, x.origin_qty - x.before_me)::integer))
    order by x.days_left nulls last, p.name), '[]'::jsonb))
  into r
  from ranked x join public.products p on p.id = x.product_id
  where least(x.want, greatest(0, x.origin_qty - x.before_me)) > 0;
  return r;
end;
$$;
revoke all on function public.erp_restock_suggestions(uuid, uuid, uuid[], integer) from public, anon;
grant execute on function public.erp_restock_suggestions(uuid, uuid, uuid[], integer) to authenticated;

notify pgrst, 'reload schema';
