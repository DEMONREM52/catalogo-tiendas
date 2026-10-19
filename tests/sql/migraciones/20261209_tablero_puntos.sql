-- =====================================================================
-- REMHUB · Tablero de puntos y liquidación del punto
--
-- 1. erp_point_valuation: la mercancía que hay hoy en un punto, valorizada
--    a costo real, a precio de bodega (lo que el punto debe por ella) y a
--    su precio de venta (lista P1-P5 con la regla del punto), con la
--    ganancia de la bodega y la del punto, más el resumen de su deuda.
-- 2. erp_points_dashboard: ventas, costo, ganancia (total, del punto y de
--    la bodega), gastos, nómina, traslados cobrados y abonos de cada punto
--    mes a mes, más su deuda e inventario de hoy. La pantalla compara meses
--    y arma el semáforo con las reglas que cada quien configure.
--
-- Solo lee. No cambia tablas ni datos. Es idempotente.
-- Permisos: «Ver rentabilidad», «Cuenta con la bodega» o «Administrar
-- cuenta con puntos». Los costos solo con «Ver costos» o «Ver rentabilidad».
-- Un usuario de punto solo ve sus puntos.
-- Requiere 20261106, 20261110, 20261124, 20261125 y 20261126.
-- =====================================================================

do $$
begin
  if to_regclass('public.erp_internal_points') is null then raise exception 'Primero ejecuta 20261124_credito_traslados.sql.'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_internal_docs' and column_name = 'creditor_id') then
    raise exception 'Primero ejecuta 20261126_varias_bodegas.sql.';
  end if;
  if to_regclass('public.erp_expenses') is null then raise exception 'Primero ejecuta 20261110_gastos_presupuestos_nomina.sql.'; end if;
end $$;

-- 1. Mercancía de un punto valorizada.
create or replace function public.erp_point_valuation(p_store uuid, p_point uuid, p_level integer default 3)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costs boolean;
  v_level integer := least(greatest(coalesce(p_level, 3), 1), 5);
  v_credit boolean;
  s public.erp_profit_settings;
  v jsonb;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage', 'profit_view']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Cuenta con la bodega» o «Ver rentabilidad».');
  end if;
  if not exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store) then
    return jsonb_build_object('ok', false, 'error', 'Ese punto no es de esta tienda.');
  end if;
  if not public.erp_point_allowed(p_store, p_point) then
    return jsonb_build_object('ok', false, 'error', 'Solo puedes ver tu punto.');
  end if;
  v_costs := public.erp_can_any(p_store, array['costs_view', 'profit_view']);
  v_credit := exists (select 1 from public.erp_internal_points ip where ip.store_id = p_store and ip.point_id = p_point and ip.enabled);
  select * into s from public.erp_profit_settings where store_id = p_store;

  with st as (
    select l.product_id, l.qty from public.erp_stock_levels l where l.warehouse_id = p_point and l.qty > 0
  ), x as (
    select p.id, p.name, p.sku, p.image_url, st.qty,
           coalesce(p.cost_price, 0) as cost,
           coalesce((select c.avg_cost from public.erp_point_costs c where c.point_id = p_point and c.product_id = p.id and c.avg_cost > 0),
                    public.erp__internal_unit(p_store, p_point, p.id), 0) as internal,
           coalesce(public.erp__point_price(p, v_level, public.erp__rule_for(p_store, p_point, p.id),
                                            coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')), 0) as sale
    from st join public.products p on p.id = st.product_id and p.store_id = p_store
  )
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'sku', sku, 'image_url', image_url, 'qty', qty,
        'cost', case when v_costs then cost end, 'internal', internal, 'sale', sale)
      order by qty * sale desc, name), '[]'::jsonb),
    'totals', jsonb_build_object(
      'products', count(*),
      'units', coalesce(sum(qty), 0),
      'cost', case when v_costs then coalesce(sum(qty * cost), 0) end,
      'internal', coalesce(sum(qty * internal), 0),
      'sale', coalesce(sum(qty * sale), 0),
      'no_cost', count(*) filter (where cost <= 0),
      'no_price', count(*) filter (where sale <= 0)))
  into v from x;

  return jsonb_build_object(
    'ok', true, 'level', v_level, 'credit', v_credit, 'can_see_costs', v_costs,
    'point', (select jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind) from public.erp_warehouses w where w.id = p_point),
    'summary', case when v_credit then public.erp__internal_summary(p_store, p_point) end) || v;
end;
$$;
revoke all on function public.erp_point_valuation(uuid, uuid, integer) from public, anon;
grant execute on function public.erp_point_valuation(uuid, uuid, integer) to authenticated;

-- 2. Tablero de puntos mes a mes.
create or replace function public.erp_points_dashboard(p_store uuid, p_months integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pts uuid[] := public.erp_my_points(p_store);
  v_costs boolean;
  v_months integer := least(greatest(coalesce(p_months, 6), 2), 24);
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_from date;
  v_from_ts timestamptz;
  v_points jsonb;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['profit_view', 'internal_credit_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Ver rentabilidad» o «Administrar cuenta con puntos».');
  end if;
  v_costs := public.erp_can_any(p_store, array['costs_view', 'profit_view']);
  v_from := (date_trunc('month', v_today) - make_interval(months => v_months - 1))::date;
  v_from_ts := v_from::timestamp at time zone 'America/Bogota';

  with pts as (
    select w.id, w.name, w.kind, w.is_default,
           exists (select 1 from public.erp_internal_points ip where ip.point_id = w.id and ip.enabled) as credit
    from public.erp_warehouses w
    where w.store_id = p_store and w.active and (v_pts is null or w.id = any (v_pts))
  ), sales as (
    select f.point_id, date_trunc('month', coalesce(o.confirmed_at, o.created_at) at time zone 'America/Bogota')::date as m,
           sum(f.revenue) as revenue, sum(f.cost_total) as cost, sum(f.profit) as profit,
           sum(f.point_amount) as point_profit, sum(f.mother_amount) as bodega_profit,
           count(distinct f.order_id) as orders, sum(f.qty) as units,
           count(*) filter (where f.unit_cost <= 0) as no_cost_lines
    from public.erp_sale_finance f join public.orders o on o.id = f.order_id
    where f.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= v_from_ts
      and f.point_id in (select id from pts)
    group by 1, 2
  ), exp as (
    select e.point_id, date_trunc('month', e.incurred_on)::date as m, sum(e.amount) as expenses
    from public.erp_expenses e
    where e.store_id = p_store and e.status <> 'void' and e.incurred_on >= v_from and e.point_id in (select id from pts)
    group by 1, 2
  ), pay as (
    select r.point_id, date_trunc('month', r.period_end)::date as m, sum(r.total_cost) as payroll
    from public.erp_payroll_runs r
    where r.store_id = p_store and r.status in ('approved', 'partial', 'paid') and r.period_end >= v_from and r.point_id in (select id from pts)
    group by 1, 2
  ), docs as (
    select d.point_id, date_trunc('month', d.created_at at time zone 'America/Bogota')::date as m,
           sum(d.amount) filter (where d.sign = 1) as charged,
           sum(d.cost_amount) filter (where d.sign = 1) as charged_cost,
           sum(d.amount) filter (where d.kind in ('return', 'transfer_out', 'credit')) as credited,
           sum(d.cost_amount) filter (where d.kind = 'loss') as losses
    from public.erp_internal_docs d
    where d.store_id = p_store and d.status = 'active' and d.created_at >= v_from_ts and d.point_id in (select id from pts)
    group by 1, 2
  ), pays as (
    select pm.point_id, date_trunc('month', pm.paid_at)::date as m, sum(pm.amount) as paid
    from public.erp_internal_payments pm
    where pm.store_id = p_store and not pm.voided and pm.paid_at >= v_from and pm.point_id in (select id from pts)
    group by 1, 2
  ), months as (
    select g::date as m from generate_series(v_from, date_trunc('month', v_today)::date, interval '1 month') g
  ), grid as (
    select pts.id as point_id, months.m,
           coalesce(s.revenue, 0) as revenue, coalesce(s.cost, 0) as cost, coalesce(s.profit, 0) as profit,
           coalesce(s.point_profit, 0) as point_profit, coalesce(s.bodega_profit, 0) as bodega_profit,
           coalesce(s.orders, 0) as orders, coalesce(s.units, 0) as units, coalesce(s.no_cost_lines, 0) as no_cost_lines,
           coalesce(e.expenses, 0) as expenses, coalesce(py.payroll, 0) as payroll,
           coalesce(d.charged, 0) as charged, coalesce(d.charged_cost, 0) as charged_cost, coalesce(d.credited, 0) as credited,
           coalesce(d.losses, 0) as losses, coalesce(pa.paid, 0) as paid
    from pts cross join months
    left join sales s on s.point_id = pts.id and s.m = months.m
    left join exp e on e.point_id = pts.id and e.m = months.m
    left join pay py on py.point_id = pts.id and py.m = months.m
    left join docs d on d.point_id = pts.id and d.m = months.m
    left join pays pa on pa.point_id = pts.id and pa.m = months.m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'point_id', pts.id, 'name', pts.name, 'kind', pts.kind, 'is_default', pts.is_default, 'credit', pts.credit,
      'debt', case when pts.credit then (select jsonb_build_object('balance', (x->>'balance')::numeric, 'overdue', (x->>'overdue')::numeric,
                                                                    'overdue_days', (x->>'oldest_overdue_days')::integer, 'in_transit', (x->>'in_transit')::numeric)
                                         from (select public.erp__internal_summary(p_store, pts.id) as x) q) end,
      'stock', (select jsonb_build_object(
                  'units', coalesce(sum(l.qty), 0),
                  'cost', case when v_costs then coalesce(sum(l.qty * coalesce(p.cost_price, 0)), 0) end,
                  'internal', coalesce(sum(l.qty * coalesce(c.avg_cost, 0)), 0))
                from public.erp_stock_levels l
                join public.products p on p.id = l.product_id
                left join public.erp_point_costs c on c.point_id = l.warehouse_id and c.product_id = l.product_id
                where l.warehouse_id = pts.id and l.qty > 0),
      'months', (select jsonb_agg(jsonb_build_object(
                    'm', g.m, 'revenue', g.revenue,
                    'cost', case when v_costs then g.cost end, 'profit', case when v_costs then g.profit end,
                    'point_profit', g.point_profit, 'bodega_profit', case when v_costs then g.bodega_profit end,
                    'orders', g.orders, 'units', g.units, 'no_cost_lines', g.no_cost_lines,
                    'expenses', g.expenses, 'payroll', g.payroll,
                    'charged', g.charged, 'charged_cost', case when v_costs then g.charged_cost end, 'credited', g.credited,
                    'losses', case when v_costs then g.losses end, 'paid', g.paid) order by g.m)
                 from grid g where g.point_id = pts.id))
    order by pts.is_default desc, pts.name), '[]'::jsonb)
  into v_points
  from pts;

  return jsonb_build_object('ok', true, 'today', v_today, 'from', v_from, 'months', v_months, 'can_see_costs', v_costs, 'points', v_points);
end;
$$;
revoke all on function public.erp_points_dashboard(uuid, integer) from public, anon;
grant execute on function public.erp_points_dashboard(uuid, integer) to authenticated;
