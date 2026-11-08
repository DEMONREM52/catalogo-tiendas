-- =====================================================================
-- 20261296 · Mercancía del punto también a costo real
--
-- Decisión del usuario (2026-11-08): el punto le debe a la bodega costo + % de la bodega (se queda así),
-- pero en «Cuenta con puntos» también se quiere ver lo que vale el inventario del punto a COSTO REAL.
--   · erp__point_stock_cost: existencias > 0 × costo (último de factura si el punto liquida con último
--     costo; si no, costo promedio). Mismo costo que la columna «Costo real» de la liquidación (20261292).
--   · erp_internal_board agrega 'stock_cost' a cada punto, solo para quien puede ver costos (costs_view).
-- No borra datos. Es idempotente. Requiere 20261287 y 20261295.
-- =====================================================================

create or replace function public.erp__point_stock_cost(p_store uuid, p_point uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_basis text := public.erp__sale_cost_basis(p_store, p_point, now()); v numeric;
begin
  select coalesce(sum(l.qty * case when v_basis = 'last' and coalesce(p.last_cost, 0) > 0 then p.last_cost else coalesce(p.cost_price, 0) end), 0)
  into v
  from public.erp_stock_levels l join public.products p on p.id = l.product_id and p.store_id = p_store
  where l.warehouse_id = p_point and l.qty > 0;
  return v;
end $$;
revoke all on function public.erp__point_stock_cost(uuid, uuid) from public, anon, authenticated;

create or replace function public.erp_internal_board(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pts uuid[] := public.erp_my_points(p_store); s public.erp_internal_settings; v_manage boolean; v_costs boolean := public.erp_can(p_store, 'costs_view');
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Cuenta con la bodega».');
  end if;
  s := public.erp__internal_settings(p_store);
  v_manage := public.erp__internal_manager(p_store);
  return jsonb_build_object(
    'ok', true,
    'today', public.erp__internal_today(),
    'can_manage', v_manage,
    'can_see_costs', public.erp_can(p_store, 'costs_view'),
    'creditors', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'is_default', w.is_default) order by w.is_default desc, w.name)
      from public.erp_warehouses w
      where w.store_id = p_store and w.active and (w.is_default or coalesce(w.kind, 'warehouse') <> 'point')
        and not exists (select 1 from public.erp_internal_points ip where ip.point_id = w.id and ip.enabled)), '[]'::jsonb),
    'settings', jsonb_build_object('default_pct', s.default_pct, 'round_step', s.round_step, 'default_term_days', s.default_term_days),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
          'point_id', w.id, 'name', w.name, 'kind', w.kind, 'is_default', w.is_default,
          'configured', ip.point_id is not null, 'enabled', coalesce(ip.enabled, false),
          'pct', ip.pct, 'term_days', ip.term_days, 'credit_limit', ip.credit_limit, 'started_at', ip.started_at)
        || case when ip.point_id is not null then public.erp__internal_summary(p_store, w.id) else '{}'::jsonb end
        || case when ip.point_id is not null and v_costs then jsonb_build_object('stock_cost', public.erp__point_stock_cost(p_store, w.id)) else '{}'::jsonb end
        order by (ip.point_id is null), w.is_default, w.name)
      from public.erp_warehouses w
      left join public.erp_internal_points ip on ip.point_id = w.id
      where w.store_id = p_store and w.active
        and (v_pts is null and v_manage or (ip.point_id is not null and (v_pts is null or w.id = any (v_pts))))), '[]'::jsonb),
    'rules', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'pct', r.pct, 'category_id', r.category_id, 'category', c.name,
                                          'product_id', r.product_id, 'product', p.name) order by c.name nulls last, p.name)
      from public.erp_internal_pct_rules r
      left join public.product_categories c on c.id = r.category_id
      left join public.products p on p.id = r.product_id
      where r.store_id = p_store), '[]'::jsonb) end,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'point_id', cl.point_id, 'point', w.name, 'product', p.name, 'image_url', p.image_url,
                                          'qty', cl.qty, 'reason', cl.reason, 'note', cl.note, 'photo_url', cl.photo_url,
                                          'value', cl.qty * coalesce(cl.unit_value, 0), 'by', cl.created_by_name, 'at', cl.created_at) order by cl.created_at)
      from public.erp_internal_claims cl
      join public.erp_warehouses w on w.id = cl.point_id
      join public.products p on p.id = cl.product_id
      where cl.store_id = p_store and cl.status = 'pending' and (v_pts is null or cl.point_id = any (v_pts))), '[]'::jsonb));
end $$;
revoke all on function public.erp_internal_board(uuid) from public, anon;
grant execute on function public.erp_internal_board(uuid) to authenticated;

notify pgrst, 'reload schema';
