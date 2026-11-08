-- =====================================================================
-- 20261291 · Informe de ventas, costo y ganancia por rango exacto (fecha y hora)
--
-- Pedido del usuario (2026-11-08): «ventas, costo y ganancia, por ejemplo desde el 12/10/2026 al
-- mediodía hasta el 30/10/2026 al final del día». El tablero de puntos va por meses completos; este
-- informe toma cualquier rango con hora.
--   · Por punto: ventas, costo, ganancia, margen, ganancia del punto y de la bodega, pedidos, unidades,
--     ticket promedio, gastos del rango y ganancia neta.
--   · Día por día, productos más vendidos y por vendedor.
-- Cuenta las ventas confirmadas (la hora es la de confirmación) con su costo congelado al vender.
-- Los costos solo con «Ver costos» o «Ver rentabilidad». Un usuario de punto solo ve sus puntos.
-- Solo lee. No cambia datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_sales_range_report(p_store uuid, p_from timestamptz, p_to timestamptz, p_points uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mine uuid[] := public.erp_my_points(p_store);
  v_costs boolean;
  v_pts uuid[];
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['profit_view', 'reports', 'internal_credit_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Informes de ventas» o «Ver rentabilidad».');
  end if;
  if p_from is null or p_to is null or p_to <= p_from then return jsonb_build_object('ok', false, 'error', 'La fecha final debe ser después de la inicial.'); end if;
  if p_to - p_from > interval '400 days' then return jsonb_build_object('ok', false, 'error', 'El rango máximo es de 400 días.'); end if;
  v_costs := public.erp_can_any(p_store, array['costs_view', 'profit_view']);
  -- Puntos que se pueden ver (los propios si es usuario de punto) y, de esos, los escogidos.
  select coalesce(array_agg(w.id), '{}'::uuid[]) into v_pts
  from public.erp_warehouses w
  where w.store_id = p_store and (v_mine is null or w.id = any (v_mine))
    and (p_points is null or cardinality(p_points) = 0 or w.id = any (p_points));

  return (
    with f as (
      select f.*, coalesce(o.confirmed_at, o.created_at) as sold_at, m.seller_name
      from public.erp_sale_finance f
      join public.orders o on o.id = f.order_id
      left join public.erp_order_meta m on m.order_id = f.order_id
      where f.store_id = p_store and o.status in ('confirmed', 'completed')
        and coalesce(o.confirmed_at, o.created_at) >= p_from and coalesce(o.confirmed_at, o.created_at) < p_to
        and f.point_id = any (v_pts)
    ),
    exp as (
      select e.point_id, sum(e.amount) as expenses
      from public.erp_expenses e
      where e.store_id = p_store and e.status <> 'void' and e.point_id = any (v_pts)
        and e.incurred_on >= (p_from at time zone 'America/Bogota')::date and e.incurred_on <= (p_to at time zone 'America/Bogota')::date
      group by 1
    ),
    by_point as (
      select w.id, w.name, w.kind,
             coalesce(sum(f.revenue), 0) as revenue, coalesce(sum(f.cost_total), 0) as cost, coalesce(sum(f.profit), 0) as profit,
             coalesce(sum(f.point_amount), 0) as point_profit, coalesce(sum(f.mother_amount), 0) as bodega_profit,
             count(distinct f.order_id) as orders, coalesce(sum(f.qty), 0) as units,
             count(*) filter (where f.order_id is not null and coalesce(f.unit_cost, 0) <= 0) as no_cost_lines,
             coalesce((select x.expenses from exp x where x.point_id = w.id), 0) as expenses
      from public.erp_warehouses w
      left join f on f.point_id = w.id
      where w.id = any (v_pts)
      group by w.id, w.name, w.kind
    )
    select jsonb_build_object(
      'ok', true, 'from', p_from, 'to', p_to, 'can_see_costs', v_costs,
      'totals', (select jsonb_build_object(
          'revenue', coalesce(sum(revenue), 0),
          'cost', case when v_costs then coalesce(sum(cost), 0) end,
          'profit', case when v_costs then coalesce(sum(profit), 0) end,
          'point_profit', coalesce(sum(point_profit), 0),
          'bodega_profit', case when v_costs then coalesce(sum(bodega_profit), 0) end,
          'orders', coalesce(sum(orders), 0), 'units', coalesce(sum(units), 0),
          'expenses', coalesce(sum(expenses), 0), 'no_cost_lines', coalesce(sum(no_cost_lines), 0)) from by_point),
      'points', coalesce((select jsonb_agg(jsonb_build_object(
          'point_id', id, 'name', name, 'kind', kind, 'revenue', revenue,
          'cost', case when v_costs then cost end, 'profit', case when v_costs then profit end,
          'point_profit', point_profit, 'bodega_profit', case when v_costs then bodega_profit end,
          'orders', orders, 'units', units, 'expenses', expenses, 'no_cost_lines', no_cost_lines) order by revenue desc, name)
        from by_point where revenue <> 0 or expenses <> 0 or orders > 0), '[]'::jsonb),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'revenue', revenue, 'profit', case when v_costs then profit end, 'orders', orders) order by d)
        from (select (sold_at at time zone 'America/Bogota')::date as d, sum(revenue) as revenue, sum(profit) as profit, count(distinct order_id) as orders
              from f group by 1) q), '[]'::jsonb),
      'products', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'sku', sku, 'qty', qty, 'revenue', revenue,
                                  'cost', case when v_costs then cost end, 'profit', case when v_costs then profit end) order by revenue desc)
        from (select f.product_id, p.name, p.sku, sum(f.qty) as qty, sum(f.revenue) as revenue, sum(f.cost_total) as cost, sum(f.profit) as profit
              from f join public.products p on p.id = f.product_id group by 1, 2, 3 order by sum(f.revenue) desc limit 300) q), '[]'::jsonb),
      'sellers', coalesce((select jsonb_agg(jsonb_build_object('seller', seller, 'revenue', revenue, 'orders', orders, 'units', units,
                                 'profit', case when v_costs then profit end) order by revenue desc)
        from (select coalesce(nullif(btrim(seller_name), ''), 'Sin vendedor') as seller, sum(revenue) as revenue, count(distinct order_id) as orders,
                     sum(qty) as units, sum(profit) as profit
              from f group by 1) q), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.erp_sales_range_report(uuid, timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.erp_sales_range_report(uuid, timestamptz, timestamptz, uuid[]) to authenticated;

notify pgrst, 'reload schema';
