-- 20261304 · Centro de operaciones en vivo
--
-- ops_center(p_store, p_days, p_point) devuelve en una sola llamada:
--   · kpis: ventas de hoy y de ayer (cantidad y total), ventas por hora de hoy, pedidos por confirmar
--     y por completar, pedidos internos abiertos (y urgentes), traslados en camino, cajas abiertas,
--     compras del mes y gastos del mes.
--   · points: ventas de hoy por punto.
--   · feed: los últimos movimientos (máx. 200) de los últimos p_days días: ventas y remisiones, pedidos,
--     pedidos internos, traslados, ingresos de factura, ajustes, gastos y cajas; cada uno con su enlace.
-- Cada parte sale solo si el usuario tiene el permiso correspondiente, y solo con los puntos que puede ver
-- (erp_my_points). Las columnas que pueden no existir en algunas bases se leen con to_jsonb (sin fallar).
-- Solo lectura: no cambia datos ni permisos. Se puede correr varias veces.

create or replace function public.ops__tz_day(p_ts timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select (date_trunc('day', p_ts at time zone 'America/Bogota')) at time zone 'America/Bogota';
$$;

create or replace function public.ops_center(p_store uuid, p_days integer default 7, p_point uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[] := public.erp_my_points(p_store);
  v_today timestamptz := public.ops__tz_day(now());
  v_yday timestamptz := public.ops__tz_day(now()) - interval '1 day';
  v_month timestamptz := (date_trunc('month', now() at time zone 'America/Bogota')) at time zone 'America/Bogota';
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 60)));
  can_sales boolean := public.erp_can_any(p_store, array['orders', 'pos', 'audit', 'reports']::text[]);
  can_sr boolean := public.erp_can_any(p_store, array['stock_requests', 'stock_requests_manage', 'transfers']::text[]);
  can_tr boolean := public.erp_can_any(p_store, array['transfers', 'inventory']::text[]);
  can_pu boolean := public.erp_can_any(p_store, array['purchases']::text[]);
  can_adj boolean := public.erp_can_any(p_store, array['inventory', 'inventory_adjust']::text[]);
  can_exp boolean := public.erp_can_any(p_store, array['expenses', 'expenses_pay']::text[]);
  can_cash boolean := public.erp_can_any(p_store, array['cash', 'cash_manage']::text[]);
  pts uuid[];
  k jsonb := '{}'::jsonb;
  feed jsonb := '[]'::jsonb;
  by_point jsonb := '[]'::jsonb;
  r jsonb;
begin
  if auth.uid() is null or not (can_sales or can_sr or can_tr or can_pu or can_adj or can_exp or can_cash) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permisos para el centro de operaciones.');
  end if;
  -- Puntos a mirar: los propios (o todos) y, si se eligió uno, solo ese.
  if p_point is not null then
    if v is not null and not (p_point = any (v)) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes acceso a ese punto.');
    end if;
    pts := array[p_point];
  else
    pts := v;
  end if;

  -- ===== Ventas =====
  if can_sales then
    with s as (
      select o.id, o.total, o.status, o.created_at
      from public.orders o left join public.erp_order_meta m on m.order_id = o.id
      where o.store_id = p_store and o.created_at >= v_yday
        and o.status in ('confirmed', 'completed')
        and (pts is null or m.point_id = any (pts))
    )
    select jsonb_build_object(
      'sales_today', jsonb_build_object('count', count(*) filter (where created_at >= v_today), 'total', coalesce(sum(total) filter (where created_at >= v_today), 0)),
      -- Ayer completo y ayer hasta esta misma hora (para comparar justo).
      'sales_yesterday', jsonb_build_object(
        'count', count(*) filter (where created_at < v_today),
        'total', coalesce(sum(total) filter (where created_at < v_today), 0),
        'count_same_hour', count(*) filter (where created_at < v_today and created_at < now() - interval '1 day'),
        'total_same_hour', coalesce(sum(total) filter (where created_at < v_today and created_at < now() - interval '1 day'), 0)),
      'by_hour', (select coalesce(jsonb_agg(coalesce(h.t, 0) order by g.hh), '[]'::jsonb)
                  from generate_series(0, 23) g(hh)
                  left join (select extract(hour from created_at at time zone 'America/Bogota')::int hh, sum(total) t from s where created_at >= v_today group by 1) h on h.hh = g.hh)
    ) into r from s;
    k := k || r;

    select jsonb_build_object(
      'to_confirm', count(*) filter (where o.status in ('draft', 'sent')),
      'to_complete', count(*) filter (where o.status = 'confirmed'))
    into r
    from public.orders o left join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('draft', 'sent', 'confirmed') and o.created_at > now() - interval '60 days'
      and (pts is null or m.point_id = any (pts));
    k := k || r;

    select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) into by_point from (
      select w.id, w.name, count(*) as count, coalesce(sum(o.total), 0) as total
      from public.orders o join public.erp_order_meta m on m.order_id = o.id join public.erp_warehouses w on w.id = m.point_id
      where o.store_id = p_store and o.created_at >= v_today and o.status in ('confirmed', 'completed')
        and (pts is null or m.point_id = any (pts))
      group by w.id, w.name) x;

    select coalesce(jsonb_agg(e), '[]'::jsonb) || feed into feed from (
      select jsonb_build_object(
        'kind', case when o.status in ('draft', 'sent') then 'order' when m.doc_kind = 'remision' then 'remision' when m.order_id is null then 'order' else 'factura' end,
        'id', o.id,
        'ref', coalesce(m.doc_number, case when o.receipt_no is not null then '#' || o.receipt_no end, 'Pedido'),
        'title', coalesce(nullif(btrim(o.customer_name), ''), 'Consumidor final'),
        'sub', concat_ws(' · ', w.name, nullif(m.seller_name, '')),
        'amount', o.total, 'status', o.status, 'at', o.created_at, 'point_id', m.point_id,
        'href', '/pedido/' || o.token) e
      from public.orders o left join public.erp_order_meta m on m.order_id = o.id left join public.erp_warehouses w on w.id = m.point_id
      where o.store_id = p_store and o.created_at >= v_from and (pts is null or m.point_id = any (pts))
      order by o.created_at desc limit 120) z;
  end if;

  -- ===== Pedidos internos =====
  if can_sr then
    select jsonb_build_object(
      'sr_open', count(*) filter (where q.status in ('pending', 'preparing', 'dispatched')),
      'sr_urgent', count(*) filter (where q.status in ('pending', 'preparing', 'dispatched') and to_jsonb(q) ->> 'priority' = 'urgent'))
    into r from public.erp_stock_requests q
    where q.store_id = p_store and (pts is null or q.from_point_id = any (pts) or q.to_point_id = any (pts));
    k := k || r;

    select feed || coalesce(jsonb_agg(e), '[]'::jsonb) into feed from (
      select jsonb_build_object('kind', 'stock_request', 'id', q.id,
        'ref', 'Pedido interno #' || coalesce(to_jsonb(q) ->> 'number', '—'),
        'title', coalesce(f.name, '—') || ' ← ' || coalesce(t.name, '—'),
        'sub', case when to_jsonb(q) ->> 'priority' = 'urgent' then 'Urgente' else null end,
        'amount', null, 'status', q.status, 'at', q.created_at, 'point_id', q.from_point_id,
        'href', '/dashboard/pedidos?tab=internos&pedido=' || q.id) e
      from public.erp_stock_requests q
      left join public.erp_warehouses f on f.id = q.from_point_id left join public.erp_warehouses t on t.id = q.to_point_id
      where q.store_id = p_store and q.created_at >= v_from and (pts is null or q.from_point_id = any (pts) or q.to_point_id = any (pts))
      order by q.created_at desc limit 60) z;
  end if;

  -- ===== Traslados =====
  if can_tr then
    select jsonb_build_object('transfers_in_transit', count(*)) into r
    from public.erp_transfers t
    where t.store_id = p_store and t.status = 'in_transit' and (pts is null or t.from_warehouse_id = any (pts) or t.to_warehouse_id = any (pts));
    k := k || r;

    select feed || coalesce(jsonb_agg(e), '[]'::jsonb) into feed from (
      select jsonb_build_object('kind', 'transfer', 'id', t.id, 'ref', 'Traslado #' || t.number,
        'title', coalesce(a.name, '—') || ' → ' || coalesce(b.name, '—'), 'sub', nullif(left(coalesce(t.notes, ''), 80), ''),
        'amount', null, 'status', t.status, 'at', t.created_at, 'point_id', t.to_warehouse_id,
        'href', case when to_jsonb(t) ->> 'track_token' is not null then '/traslado/' || (to_jsonb(t) ->> 'track_token') else '/dashboard/inventario?tab=transfers' end) e
      from public.erp_transfers t
      left join public.erp_warehouses a on a.id = t.from_warehouse_id left join public.erp_warehouses b on b.id = t.to_warehouse_id
      where t.store_id = p_store and t.created_at >= v_from and (pts is null or t.from_warehouse_id = any (pts) or t.to_warehouse_id = any (pts))
      order by t.created_at desc limit 60) z;
  end if;

  -- ===== Ingresos de factura (compras) =====
  if can_pu then
    select jsonb_build_object('purchases_month', jsonb_build_object('count', count(*), 'total', coalesce(sum(p.total), 0))) into r
    from public.erp_purchases p
    where p.store_id = p_store and p.status = 'received' and p.created_at >= v_month and (pts is null or p.warehouse_id = any (pts));
    k := k || r;

    select feed || coalesce(jsonb_agg(e), '[]'::jsonb) into feed from (
      select jsonb_build_object('kind', 'purchase', 'id', p.id, 'ref', 'Ingreso #' || p.number,
        'title', coalesce(s.name, 'Proveedor'), 'sub', concat_ws(' · ', w.name, nullif(p.invoice_ref, '')),
        'amount', p.total, 'status', p.status, 'at', p.created_at, 'point_id', p.warehouse_id,
        'href', '/dashboard/inventario?tab=purchases') e
      from public.erp_purchases p
      left join public.erp_suppliers s on s.id = p.supplier_id left join public.erp_warehouses w on w.id = p.warehouse_id
      where p.store_id = p_store and p.created_at >= v_from and (pts is null or p.warehouse_id = any (pts))
      order by p.created_at desc limit 40) z;
  end if;

  -- ===== Ajustes de inventario =====
  if can_adj then
    select feed || coalesce(jsonb_agg(e), '[]'::jsonb) into feed from (
      select jsonb_build_object('kind', 'adjustment', 'id', a.id, 'ref', 'Ajuste #' || a.number,
        'title', case a.reason when 'count' then 'Conteo' when 'damage' then 'Daño' when 'loss' then 'Pérdida' when 'expired' then 'Vencido'
                   when 'found' then 'Encontrado' when 'correction' then 'Corrección' else 'Otro' end,
        'sub', concat_ws(' · ', w.name, nullif(left(coalesce(a.notes, ''), 60), '')),
        'amount', null, 'status', 'done', 'at', a.created_at, 'point_id', a.warehouse_id,
        'href', '/dashboard/inventario?tab=adjustments') e
      from public.erp_adjustments a left join public.erp_warehouses w on w.id = a.warehouse_id
      where a.store_id = p_store and a.created_at >= v_from and (pts is null or a.warehouse_id = any (pts))
      order by a.created_at desc limit 40) z;
  end if;

  -- ===== Gastos =====
  if can_exp and to_regclass('public.erp_expenses') is not null then
    execute $q$
      select jsonb_build_object('expenses_month', jsonb_build_object('count', count(*), 'total', coalesce(sum(x.amount), 0)))
      from public.erp_expenses x
      where x.store_id = $1 and x.status <> 'void' and x.created_at >= $2 and ($3::uuid[] is null or x.point_id = any ($3))
    $q$ into r using p_store, v_month, pts;
    k := k || r;
    execute $q$
      select coalesce(jsonb_agg(e), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'expense', 'id', x.id, 'ref', 'Gasto #' || x.number, 'title', x.description,
          'sub', concat_ws(' · ', w.name, nullif(x.payee_name, '')), 'amount', x.amount, 'status', x.status, 'at', x.created_at,
          'point_id', x.point_id, 'href', '/dashboard/gastos') e
        from public.erp_expenses x left join public.erp_warehouses w on w.id = x.point_id
        where x.store_id = $1 and x.created_at >= $2 and ($3::uuid[] is null or x.point_id = any ($3))
        order by x.created_at desc limit 40) z
    $q$ into r using p_store, v_from, pts;
    feed := feed || r;
  end if;

  -- ===== Cajas =====
  if can_cash and to_regclass('public.erp_cash_sessions') is not null then
    execute $q$
      select jsonb_build_object('cash_open', count(*) filter (where c.status = 'open'), 'cash_review', count(*) filter (where c.status = 'review'))
      from public.erp_cash_sessions c where c.store_id = $1 and ($2::uuid[] is null or c.point_id = any ($2))
    $q$ into r using p_store, pts;
    k := k || r;
    execute $q$
      select coalesce(jsonb_agg(e), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'cash', 'id', c.id, 'ref', 'Caja #' || c.number,
          'title', case c.status when 'open' then 'Caja abierta' when 'review' then 'Caja por revisar' else 'Caja cerrada' end,
          'sub', concat_ws(' · ', w.name, coalesce(c.closed_by_name, c.opened_by_name)),
          'amount', coalesce(c.counted_amount, c.opening_amount), 'status', c.status, 'at', coalesce(c.closed_at, c.opened_at),
          'point_id', c.point_id, 'href', '/dashboard/caja') e
        from public.erp_cash_sessions c left join public.erp_warehouses w on w.id = c.point_id
        where c.store_id = $1 and coalesce(c.closed_at, c.opened_at) >= $2 and ($3::uuid[] is null or c.point_id = any ($3))
        order by coalesce(c.closed_at, c.opened_at) desc limit 30) z
    $q$ into r using p_store, v_from, pts;
    feed := feed || r;
  end if;

  -- Feed ordenado del más reciente al más viejo (máx. 200).
  select coalesce(jsonb_agg(e order by (e ->> 'at')::timestamptz desc), '[]'::jsonb) into feed
  from (select e from jsonb_array_elements(feed) e order by (e ->> 'at')::timestamptz desc limit 200) z;

  return jsonb_build_object('ok', true, 'now', now(), 'kpis', k, 'points', by_point, 'feed', feed,
    'can', jsonb_build_object('sales', can_sales, 'stock_requests', can_sr, 'transfers', can_tr, 'purchases', can_pu,
      'adjustments', can_adj, 'expenses', can_exp, 'cash', can_cash),
    'my_points', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.name), '[]'::jsonb)
                  from public.erp_warehouses w where w.store_id = p_store and coalesce((to_jsonb(w) ->> 'active')::boolean, true) and (v is null or w.id = any (v))));
end;
$$;

revoke all on function public.ops_center(uuid, integer, uuid) from public, anon;
grant execute on function public.ops_center(uuid, integer, uuid) to authenticated;
