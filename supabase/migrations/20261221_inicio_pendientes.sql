-- =====================================================================
-- REMHUB · Inicio por persona: pendientes y «hoy en tu punto»
--
--   · erp_my_tasks: lo que espera una acción de ESTA persona, según sus
--     permisos y sus puntos: traslados por recibir o por firmar «Revisado»,
--     pedidos internos por atender o por confirmar, reglas de precio por
--     aprobar y productos con unidades pero sin costo.
--   · erp_home_today: ventas de hoy y de ayer en los puntos que ve, las suyas
--     y lo más vendido de los últimos 7 días (para vendedores y puntos).
-- Solo lectura. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_my_tasks(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[];
  v_tasks jsonb := '[]'::jsonb;
  n integer;
  v_old integer;
  can_tr boolean;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then
    return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.');
  end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  can_tr := public.erp_can(p_store, 'transfers') or public.erp_can(p_store, 'inventory');

  -- 1) Traslados que llegan a mis puntos y aún no se reciben.
  if can_tr and v is not null then
    select count(*), count(*) filter (where t.created_at < now() - interval '2 days') into n, v_old
    from public.erp_transfers t where t.store_id = p_store and t.status = 'in_transit' and t.to_warehouse_id = any (v);
    if n > 0 then
      v_tasks := v_tasks || jsonb_build_object('key', 'transfers_receive', 'icon', '📥', 'severity', case when v_old > 0 then 'warning' else 'info' end,
        'count', n, 'title', case when n = 1 then '1 traslado por recibir' else n || ' traslados por recibir' end,
        'body', case when v_old > 0 then v_old || ' lleva(n) más de 2 días en camino. Cuenta y confirma lo que llegó.' else 'Cuenta la mercancía y confirma lo que llegó.' end,
        'href', '/dashboard/inventario?tab=transfers', 'action', 'Recibir');
    end if;
  elsif can_tr then
    select count(*), count(*) filter (where t.created_at < now() - interval '2 days') into n, v_old
    from public.erp_transfers t where t.store_id = p_store and t.status = 'in_transit';
    if n > 0 then
      v_tasks := v_tasks || jsonb_build_object('key', 'transfers_transit', 'icon', '🚚', 'severity', case when v_old > 0 then 'warning' else 'info' end,
        'count', n, 'title', case when n = 1 then '1 traslado en camino' else n || ' traslados en camino' end,
        'body', case when v_old > 0 then v_old || ' lleva(n) más de 2 días sin recibirse.' else 'Aún no los confirma el punto que recibe.' end,
        'href', '/dashboard/inventario?tab=transfers', 'action', 'Ver');
    end if;
  end if;

  -- 2) Traslados que salieron de mis puntos y nadie ha firmado «Revisado».
  if can_tr and to_regclass('public.erp_transfer_signatures') is not null then
    select count(*) into n
    from public.erp_transfers t
    where t.store_id = p_store and t.status = 'in_transit' and (v is null or t.from_warehouse_id = any (v))
      and not exists (select 1 from public.erp_transfer_signatures s where s.transfer_id = t.id and s.step in ('sent', 'delivered', 'received'));
    if n > 0 then
      v_tasks := v_tasks || jsonb_build_object('key', 'transfers_check', 'icon', '✍️', 'severity', 'info', 'count', n,
        'title', case when n = 1 then '1 traslado sin firma de «Revisado»' else n || ' traslados sin firma de «Revisado»' end,
        'body', 'Mientras nadie lo revise todavía se puede corregir.', 'href', '/dashboard/inventario?tab=transfers', 'action', 'Revisar');
    end if;
  end if;

  -- 3) Pedidos internos: por atender (me piden) y por confirmar (ya vienen en camino).
  if to_regclass('public.erp_stock_requests') is not null then
    if public.erp_can(p_store, 'stock_requests_manage') or public.erp_can(p_store, 'transfers') then
      select count(*), count(*) filter (where r.created_at < now() - interval '1 day') into n, v_old
      from public.erp_stock_requests r where r.store_id = p_store and r.status in ('pending', 'preparing') and (v is null or r.to_point_id = any (v));
      if n > 0 then
        v_tasks := v_tasks || jsonb_build_object('key', 'requests_attend', 'icon', '📨', 'severity', case when v_old > 0 then 'warning' else 'info' end, 'count', n,
          'title', case when n = 1 then '1 pedido interno por atender' else n || ' pedidos internos por atender' end,
          'body', case when v_old > 0 then v_old || ' espera(n) desde ayer o antes.' else 'Otro punto te pidió mercancía.' end,
          'href', '/dashboard/pedidos?tab=internos', 'action', 'Atender');
      end if;
    end if;
    if public.erp_can(p_store, 'stock_requests') or public.erp_can(p_store, 'stock_requests_manage') then
      select count(*) into n
      from public.erp_stock_requests r where r.store_id = p_store and r.status = 'dispatched' and (v is null or r.from_point_id = any (v));
      if n > 0 then
        v_tasks := v_tasks || jsonb_build_object('key', 'requests_arriving', 'icon', '🚚', 'severity', 'info', 'count', n,
          'title', case when n = 1 then '1 pedido viene en camino' else n || ' pedidos vienen en camino' end,
          'body', 'Confirma cuando llegue la mercancía.', 'href', '/dashboard/pedidos?tab=internos', 'action', 'Ver');
      end if;
    end if;
  end if;

  -- 4) Reglas de precio por aprobar.
  if to_regclass('public.erp_price_rules') is not null and public.erp_can(p_store, 'profit_approve') then
    select count(*) into n from public.erp_price_rules r where r.store_id = p_store and r.status = 'pending';
    if n > 0 then
      v_tasks := v_tasks || jsonb_build_object('key', 'price_rules', 'icon', '🏷️', 'severity', 'warning', 'count', n,
        'title', case when n = 1 then '1 cambio de precio por aprobar' else n || ' cambios de precio por aprobar' end,
        'body', 'Un punto quiere cambiar sus precios.', 'href', '/dashboard/rentabilidad', 'action', 'Revisar');
    end if;
  end if;

  -- 5) Productos con unidades y sin costo (la ganancia y las liquidaciones salen mal sin él).
  if public.erp_can(p_store, 'products') or public.erp_can(p_store, 'purchases') then
    select count(*) into n from public.products p
    where p.store_id = p_store and coalesce(p.active, true) and coalesce(p.stock, 0) > 0 and coalesce(p.cost_price, 0) <= 0;
    if n > 0 then
      v_tasks := v_tasks || jsonb_build_object('key', 'no_cost', 'icon', '💲', 'severity', 'warning', 'count', n,
        'title', case when n = 1 then '1 producto con unidades y sin costo' else n || ' productos con unidades y sin costo' end,
        'body', 'Sin costo no se puede calcular la ganancia ni liquidar.', 'href', '/dashboard/inventario?tab=stock&sin_costo=1', 'action', 'Completar');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'tasks', v_tasks);
end;
$$;
revoke all on function public.erp_my_tasks(uuid) from public, anon;
grant execute on function public.erp_my_tasks(uuid) to authenticated;

create or replace function public.erp_home_today(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[];
  v_today timestamptz := ((now() at time zone 'America/Bogota')::date)::timestamp at time zone 'America/Bogota';
  r jsonb;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then
    return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.');
  end if;
  if not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'reports') or public.erp_can(p_store, 'orders')) then
    return jsonb_build_object('ok', false, 'error', 'Sin permiso de ventas.');
  end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  with sales as (
    select o.id, o.total, coalesce(o.confirmed_at, o.created_at) as at, m.seller_id
    from public.orders o
    join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= v_today - interval '7 days'
      and (v is null or m.point_id = any (v))
  ),
  top as (
    select p.name, sum(oi.quantity)::integer as qty
    from sales s join public.order_items oi on oi.order_id = s.id join public.products p on p.id = oi.product_id
    group by p.name order by 2 desc, 1 limit 5
  )
  select jsonb_build_object('ok', true,
    'points', coalesce((select jsonb_agg(w.name order by w.name) from public.erp_warehouses w where v is not null and w.id = any (v)), '[]'::jsonb),
    'today', jsonb_build_object('count', count(*) filter (where s.at >= v_today), 'total', coalesce(sum(s.total) filter (where s.at >= v_today), 0)),
    'yesterday', jsonb_build_object('count', count(*) filter (where s.at >= v_today - interval '1 day' and s.at < v_today),
                                    'total', coalesce(sum(s.total) filter (where s.at >= v_today - interval '1 day' and s.at < v_today), 0)),
    'mine', jsonb_build_object('count', count(*) filter (where s.at >= v_today and s.seller_id = auth.uid()),
                               'total', coalesce(sum(s.total) filter (where s.at >= v_today and s.seller_id = auth.uid()), 0)),
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'qty', t.qty)) from top t), '[]'::jsonb))
  into r
  from sales s;
  return r;
end;
$$;
revoke all on function public.erp_home_today(uuid) from public, anon;
grant execute on function public.erp_home_today(uuid) to authenticated;

notify pgrst, 'reload schema';
