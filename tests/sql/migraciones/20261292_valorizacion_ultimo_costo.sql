-- =====================================================================
-- 20261292 · Liquidación del punto (mercancía valorizada) con el ÚLTIMO costo de factura
--
-- Pedido del usuario (2026-11-08): SEDE ZAMORA entró su inventario inicial como factura propia, así que
-- su precio de bodega se calculaba con el costo PROMEDIO (que arrastra las unidades viejas más caras),
-- mientras su precio de venta ya usa el último costo de la madre. Resultado: «pérdidas» que no existen.
--   · Si el punto tiene activado «Último costo» (20261287), la mercancía se valoriza con el costo de la
--     última factura y el precio de bodega se calcula sobre ese costo (costo + % de la bodega).
--   · Lo que llegó por TRASLADO conserva el precio de bodega fijado al trasladar: es la deuda real.
--   · Se puede pedir una u otra base para comparar (p_basis 'last' | 'average'; vacío = la del punto).
--   · Cada producto trae además su costo promedio, su último costo y la fecha de la última factura,
--     para detectar costos mal digitados.
-- Reemplaza erp_point_valuation(uuid, uuid, integer) de 20261209. Solo lee. Es idempotente.
-- Requiere 20261209, 20261206 y 20261287.
-- =====================================================================

drop function if exists public.erp_point_valuation(uuid, uuid, integer);
create or replace function public.erp_point_valuation(p_store uuid, p_point uuid, p_level integer default 3, p_basis text default null)
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
  v_basis text;
  v_point_basis text;
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
  v_point_basis := public.erp__sale_cost_basis(p_store, p_point, now());
  v_basis := case when p_basis in ('last', 'average') then p_basis else v_point_basis end;
  select * into s from public.erp_profit_settings where store_id = p_store;

  with st as (
    select l.product_id, l.qty from public.erp_stock_levels l where l.warehouse_id = p_point and l.qty > 0
  ), base as (
    select p as prod, p.id, p.name, p.sku, p.image_url, p.last_cost_at, st.qty,
           coalesce(p.cost_price, 0) as avg_cost,
           coalesce(p.last_cost, 0) as last_cost_v,
           (select c.avg_cost from public.erp_point_costs c where c.point_id = p_point and c.product_id = p.id and c.avg_cost > 0) as frozen
    from st join public.products p on p.id = st.product_id and p.store_id = p_store
  ), x as (
    select b.id, b.name, b.sku, b.image_url, b.qty, b.avg_cost, b.last_cost_v, b.last_cost_at, b.frozen,
           case when v_basis = 'last' and b.last_cost_v > 0 then b.last_cost_v else b.avg_cost end as cost,
           coalesce(b.frozen,
                    case when v_basis = 'last' and b.last_cost_v > 0
                         then public.erp__round_up(b.last_cost_v * (1 + public.erp__internal_pct(p_store, p_point, b.id) / 100),
                                                  (public.erp__internal_settings(p_store)).round_step)
                         else public.erp__internal_unit(p_store, p_point, b.id) end, 0) as internal,
           coalesce(public.erp__point_price(b.prod, v_level, public.erp__rule_for(p_store, p_point, b.id),
                                            coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')), 0) as sale
    from base b
  )
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'sku', sku, 'image_url', image_url, 'qty', qty,
        'cost', case when v_costs then cost end, 'internal', internal, 'sale', sale,
        'avg_cost', case when v_costs then avg_cost end, 'last_cost', case when v_costs then nullif(last_cost_v, 0) end,
        'last_cost_at', case when v_costs then last_cost_at end, 'frozen', frozen is not null)
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
    'ok', true, 'level', v_level, 'credit', v_credit, 'can_see_costs', v_costs, 'basis', v_basis, 'point_basis', v_point_basis,
    'point', (select jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind) from public.erp_warehouses w where w.id = p_point),
    'summary', case when v_credit then public.erp__internal_summary(p_store, p_point) end) || v;
end;
$$;
revoke all on function public.erp_point_valuation(uuid, uuid, integer, text) from public, anon;
grant execute on function public.erp_point_valuation(uuid, uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
