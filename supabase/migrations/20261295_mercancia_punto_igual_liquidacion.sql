-- =====================================================================
-- 20261295 · «Mercancía en el punto» igual a la liquidación
--
-- La tarjeta de «Cuenta con puntos» solo sumaba los productos con precio de bodega fijado
-- (erp_point_costs: los que llegaron por traslado o deuda inicial). Lo que el punto tenía de su
-- ingreso inicial propio quedaba fuera, por eso SEDE ZAMORA mostraba $35,6 M en la tarjeta y
-- $62,5 M a precio de bodega en la liquidación.
-- Ahora la tarjeta usa el mismo cálculo que la liquidación (20261292):
--   por producto con existencias > 0: precio de bodega fijado si lo tiene; si no, costo (último de
--   factura si el punto liquida con último costo, o promedio) + % de la bodega.
-- 'stock_value_frozen' conserva el cálculo anterior (solo lo trasladado) por si se quiere comparar.
-- No borra datos. Es idempotente. Requiere 20261126, 20261287 y 20261292.
-- =====================================================================

create or replace function public.erp__point_stock_value(p_store uuid, p_point uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_basis text := public.erp__sale_cost_basis(p_store, p_point, now()); v numeric;
begin
  select coalesce(sum(l.qty * coalesce(
           (select c.avg_cost from public.erp_point_costs c where c.point_id = p_point and c.product_id = p.id and c.avg_cost > 0),
           case when v_basis = 'last' and coalesce(p.last_cost, 0) > 0
                then public.erp__round_up(p.last_cost * (1 + public.erp__internal_pct(p_store, p_point, p.id) / 100),
                                          (public.erp__internal_settings(p_store)).round_step)
                else public.erp__internal_unit(p_store, p_point, p.id) end, 0)), 0)
  into v
  from public.erp_stock_levels l join public.products p on p.id = l.product_id and p.store_id = p_store
  where l.warehouse_id = p_point and l.qty > 0;
  return v;
end $$;
revoke all on function public.erp__point_stock_value(uuid, uuid) from public, anon, authenticated;

create or replace function public.erp__internal_summary(p_store uuid, p_point uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.erp__internal_today(); v_pool numeric; v_paid numeric; v jsonb;
begin
  select coalesce(sum(amount), 0) into v_paid from public.erp_internal_payments where store_id = p_store and point_id = p_point and not voided;
  select v_paid + coalesce(sum(amount), 0) into v_pool
  from public.erp_internal_docs where store_id = p_store and point_id = p_point and status = 'active' and sign = -1;

  with ch as (
    select d.id, d.amount, d.due_date,
           sum(d.amount) over (order by d.due_date nulls last, d.created_at, d.id) as cum
    from public.erp_internal_docs d
    where d.store_id = p_store and d.point_id = p_point and d.status = 'active' and d.sign = 1
  ), pend as (
    select id, due_date, least(amount, greatest(cum - v_pool, 0)) as pending from ch
  )
  select jsonb_build_object(
    'charged', coalesce((select sum(amount) from ch), 0),
    'paid', v_paid,
    'credits', v_pool - v_paid,
    'balance', coalesce((select sum(amount) from ch), 0) - v_pool,
    'overdue', coalesce((select sum(pending) from pend where due_date < v_today), 0),
    'due_7', coalesce((select sum(pending) from pend where due_date between v_today and v_today + 7), 0),
    'next_due', (select min(due_date) from pend where pending > 0 and due_date >= v_today),
    'oldest_overdue_days', (select v_today - min(due_date) from pend where pending > 0 and due_date < v_today),
    'in_transit', coalesce((select sum(i.qty * coalesce(i.internal_price, 0)) from public.erp_transfer_items i
                            join public.erp_transfers t on t.id = i.transfer_id
                            where t.store_id = p_store and t.to_warehouse_id = p_point and t.status = 'in_transit'), 0),
    'stock_value', public.erp__point_stock_value(p_store, p_point),
    'stock_value_frozen', coalesce((select sum(greatest(l.qty, 0) * c.avg_cost) from public.erp_stock_levels l
                             join public.erp_point_costs c on c.point_id = l.warehouse_id and c.product_id = l.product_id
                             where l.warehouse_id = p_point), 0),
    'pending_claims', (select count(*) from public.erp_internal_claims where store_id = p_store and point_id = p_point and status = 'pending'),
    'by_creditor', coalesce((
      select jsonb_agg(jsonb_build_object('creditor_id', x.cid, 'name', w.name, 'balance', x.bal) order by x.bal desc)
      from (
        select u.cid, sum(u.v) as bal from (
          select coalesce(d.creditor_id, public.erp__internal_default_creditor(p_store)) as cid, d.sign * d.amount as v
          from public.erp_internal_docs d where d.store_id = p_store and d.point_id = p_point and d.status = 'active'
          union all
          select coalesce(pm.creditor_id, public.erp__internal_default_creditor(p_store)), -pm.amount
          from public.erp_internal_payments pm where pm.store_id = p_store and pm.point_id = p_point and not pm.voided
        ) u group by u.cid
      ) x left join public.erp_warehouses w on w.id = x.cid
      where x.bal <> 0), '[]'::jsonb)
  ) into v;
  return v;
end $$;

create or replace function public.erp_internal_doc_add(p_store uuid, p_point uuid, p_kind text, p_amount numeric, p_due date, p_note text, p_creditor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ip public.erp_internal_points; v_id uuid; v_sign smallint; v_cred uuid;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» registra esto.'; end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;
  if not found then raise exception 'Primero activa el crédito para ese punto.'; end if;
  if p_kind not in ('opening', 'charge', 'credit') then raise exception 'Tipo inválido.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Escribe el valor.'; end if;
  if p_kind <> 'opening' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Escribe el motivo.'; end if;
  v_cred := public.erp__internal_creditor(p_store, p_point, p_creditor);
  v_sign := case when p_kind = 'credit' then -1 else 1 end;
  insert into public.erp_internal_docs (store_id, point_id, creditor_id, number, kind, sign, amount, due_date, note, created_by, created_by_name)
  values (p_store, p_point, v_cred, public.erp_next_number(p_store, 'internal_doc'), p_kind, v_sign, round(p_amount, 2),
          case when v_sign = 1 then coalesce(p_due, public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days)) end,
          left(nullif(btrim(coalesce(p_note, '')), ''), 300), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.doc_' || p_kind, 'erp_internal_docs', v_id, jsonb_build_object('point_id', p_point, 'amount', p_amount, 'note', p_note));
  return v_id;
end $$;

create or replace function public.erp_internal_payment_add(p_store uuid, p_point uuid, p_amount numeric, p_method text, p_reference text, p_paid_at date, p_note text, p_creditor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre registra abonos.'; end if;
  if not exists (select 1 from public.erp_internal_points where store_id = p_store and point_id = p_point) then raise exception 'Ese punto no tiene crédito activo.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Escribe el valor del abono.'; end if;
  if p_method not in ('cash', 'transfer', 'card', 'other') then raise exception 'Forma de pago inválida.'; end if;
  insert into public.erp_internal_payments (store_id, point_id, creditor_id, amount, method, reference, paid_at, note, created_by, created_by_name)
  values (p_store, p_point, public.erp__internal_creditor(p_store, p_point, p_creditor), round(p_amount, 2), p_method, left(nullif(btrim(coalesce(p_reference, '')), ''), 80),
          coalesce(p_paid_at, public.erp__internal_today()), left(nullif(btrim(coalesce(p_note, '')), ''), 300), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.payment', 'erp_internal_payments', v_id, jsonb_build_object('point_id', p_point, 'amount', p_amount, 'method', p_method));
  return v_id;
end $$;

create or replace function public.erp_internal_board(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pts uuid[] := public.erp_my_points(p_store); s public.erp_internal_settings; v_manage boolean;
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

create or replace function public.erp_internal_statement(p_store uuid, p_point uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.erp__internal_today(); v_pool numeric; ip public.erp_internal_points;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Cuenta con la bodega».');
  end if;
  if not public.erp_point_allowed(p_store, p_point) then return jsonb_build_object('ok', false, 'error', 'Solo puedes ver la cuenta de tu punto.'); end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;

  select coalesce((select sum(amount) from public.erp_internal_payments where store_id = p_store and point_id = p_point and not voided), 0)
       + coalesce((select sum(amount) from public.erp_internal_docs where store_id = p_store and point_id = p_point and status = 'active' and sign = -1), 0)
  into v_pool;

  return jsonb_build_object(
    'ok', true, 'today', v_today,
    'point', (select jsonb_build_object('id', w.id, 'name', w.name, 'phone', w.phone) from public.erp_warehouses w where w.id = p_point),
    'config', case when ip.point_id is null then null else jsonb_build_object('enabled', ip.enabled, 'pct', ip.pct, 'term_days', ip.term_days,
                                                                               'credit_limit', ip.credit_limit, 'started_at', ip.started_at) end,
    'summary', public.erp__internal_summary(p_store, p_point),
    'moves', coalesce((
      select jsonb_agg(m order by m->>'at', m->>'n') from (
        select jsonb_build_object('type', 'doc', 'id', d.id, 'n', lpad(d.number::text, 12, '0'), 'number', d.number, 'kind', d.kind,
                                  'amount', d.sign * d.amount, 'due_date', d.due_date, 'note', d.note, 'status', d.status, 'void_reason', d.void_reason,
                                  'transfer_number', t.number, 'creditor', (select w.name from public.erp_warehouses w where w.id = d.creditor_id), 'by', d.created_by_name, 'at', d.created_at) as m
        from public.erp_internal_docs d left join public.erp_transfers t on t.id = d.transfer_id
        where d.store_id = p_store and d.point_id = p_point
        union all
        select jsonb_build_object('type', 'payment', 'id', pm.id, 'n', '', 'kind', 'payment', 'amount', -pm.amount, 'method', pm.method,
                                  'reference', pm.reference, 'paid_at', pm.paid_at, 'note', pm.note, 'status', case when pm.voided then 'void' else 'active' end,
                                  'void_reason', pm.void_reason, 'creditor', (select w.name from public.erp_warehouses w where w.id = pm.creditor_id), 'by', pm.created_by_name, 'at', pm.created_at)
        from public.erp_internal_payments pm where pm.store_id = p_store and pm.point_id = p_point
      ) x), '[]'::jsonb),
    'charges', coalesce((
      with ch as (
        select d.*, t.number as transfer_number, sum(d.amount) over (order by d.due_date nulls last, d.created_at, d.id) as cum
        from public.erp_internal_docs d left join public.erp_transfers t on t.id = d.transfer_id
        where d.store_id = p_store and d.point_id = p_point and d.status = 'active' and d.sign = 1
      )
      select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'kind', kind, 'amount', amount, 'transfer_number', transfer_number,
                                          'pending', least(amount, greatest(cum - v_pool, 0)), 'due_date', due_date,
                                          'days_late', case when due_date < v_today and least(amount, greatest(cum - v_pool, 0)) > 0 then v_today - due_date end,
                                          'note', note, 'at', created_at) order by due_date nulls last, created_at)
      from ch), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'product', p.name, 'qty', cl.qty, 'reason', cl.reason, 'note', cl.note, 'status', cl.status,
                                          'value', cl.qty * coalesce(cl.unit_value, 0), 'by', cl.created_by_name, 'at', cl.created_at,
                                          'decided_by', cl.decided_by_name, 'decision_note', cl.decision_note) order by cl.created_at desc)
      from public.erp_internal_claims cl join public.products p on p.id = cl.product_id
      where cl.store_id = p_store and cl.point_id = p_point), '[]'::jsonb));
end $$;


create or replace function public.erp_internal_profit(p_store uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pts uuid[] := public.erp_my_points(p_store); v_points jsonb;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['profit_view', 'internal_credit_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Ver rentabilidad» o «Administrar cuenta con puntos».');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    return jsonb_build_object('ok', false, 'error', 'El rango de fechas no es válido.');
  end if;

  with pts as (
    select w.id, w.name from public.erp_internal_points ip join public.erp_warehouses w on w.id = ip.point_id
    where ip.store_id = p_store and (v_pts is null or ip.point_id = any (v_pts))
  ), sales as (
    select f.point_id,
           sum(f.revenue) filter (where f.ref_source = 'internal') as revenue,
           sum(f.ref_total) filter (where f.ref_source = 'internal') as internal_cost,
           sum(f.cost_total) filter (where f.ref_source = 'internal') as real_cost,
           sum(f.point_amount) filter (where f.ref_source = 'internal') as point_profit,
           sum(f.mother_amount) filter (where f.ref_source = 'internal') as bodega_profit,
           sum(f.revenue) filter (where f.ref_source <> 'internal') as other_revenue,
           count(distinct f.order_id) as orders
    from public.erp_sale_finance f join public.orders o on o.id = f.order_id
    where f.store_id = p_store and o.status in ('confirmed', 'completed')
      and (coalesce(o.confirmed_at, o.created_at) at time zone 'America/Bogota')::date between p_from and p_to
      and f.point_id in (select id from pts)
    group by f.point_id
  ), docs as (
    select d.point_id,
           sum(d.amount) filter (where d.sign = 1) as charged,
           sum(d.cost_amount) filter (where d.sign = 1) as charged_cost,
           sum(d.amount) filter (where d.kind in ('return', 'transfer_out', 'credit')) as credited,
           sum(d.amount) filter (where d.kind = 'loss') as loss_value,
           sum(d.cost_amount) filter (where d.kind = 'loss') as loss_cost
    from public.erp_internal_docs d
    where d.store_id = p_store and d.status = 'active' and d.point_id in (select id from pts)
      and (d.created_at at time zone 'America/Bogota')::date between p_from and p_to
    group by d.point_id
  ), pays as (
    select pm.point_id, sum(pm.amount) as paid
    from public.erp_internal_payments pm
    where pm.store_id = p_store and not pm.voided and pm.point_id in (select id from pts) and pm.paid_at between p_from and p_to
    group by pm.point_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'point_id', pts.id, 'name', pts.name,
      'revenue', coalesce(s.revenue, 0), 'internal_cost', coalesce(s.internal_cost, 0), 'real_cost', coalesce(s.real_cost, 0),
      'point_profit', coalesce(s.point_profit, 0), 'bodega_profit', coalesce(s.bodega_profit, 0),
      'other_revenue', coalesce(s.other_revenue, 0), 'orders', coalesce(s.orders, 0),
      'charged', coalesce(dc.charged, 0), 'charged_cost', coalesce(dc.charged_cost, 0), 'credited', coalesce(dc.credited, 0),
      'loss_value', coalesce(dc.loss_value, 0), 'loss_cost', coalesce(dc.loss_cost, 0),
      'paid', coalesce(py.paid, 0), 'balance', public.erp__internal_balance(p_store, pts.id))
      order by coalesce(s.revenue, 0) desc, pts.name), '[]'::jsonb)
  into v_points
  from pts left join sales s on s.point_id = pts.id left join docs dc on dc.point_id = pts.id left join pays py on py.point_id = pts.id;

  return jsonb_build_object('ok', true, 'from', p_from, 'to', p_to, 'points', v_points,
    'by_creditor', coalesce((
      select jsonb_agg(jsonb_build_object('creditor_id', x.cid, 'name', w.name, 'charged', x.charged, 'charged_cost', x.charged_cost,
                                          'margin', x.charged - x.charged_cost, 'returned', x.returned, 'loss_cost', x.loss_cost, 'paid', coalesce(py.paid, 0))
                       order by x.charged desc)
      from (
        select coalesce(d.creditor_id, public.erp__internal_default_creditor(p_store)) as cid,
               coalesce(sum(d.amount) filter (where d.sign = 1), 0) as charged,
               coalesce(sum(d.cost_amount) filter (where d.sign = 1), 0) as charged_cost,
               coalesce(sum(d.amount) filter (where d.kind = 'return'), 0) as returned,
               coalesce(sum(d.cost_amount) filter (where d.kind = 'loss'), 0) as loss_cost
        from public.erp_internal_docs d
        where d.store_id = p_store and d.status = 'active' and (v_pts is null or d.point_id = any (v_pts))
          and (d.created_at at time zone 'America/Bogota')::date between p_from and p_to
        group by 1
      ) x
      left join public.erp_warehouses w on w.id = x.cid
      left join (
        select coalesce(pm.creditor_id, public.erp__internal_default_creditor(p_store)) as cid, sum(pm.amount) as paid
        from public.erp_internal_payments pm
        where pm.store_id = p_store and not pm.voided and (v_pts is null or pm.point_id = any (v_pts)) and pm.paid_at between p_from and p_to
        group by 1
      ) py on py.cid = x.cid), '[]'::jsonb),
    'totals', (select jsonb_build_object(
      'revenue', coalesce(sum((x->>'revenue')::numeric), 0), 'internal_cost', coalesce(sum((x->>'internal_cost')::numeric), 0),
      'real_cost', coalesce(sum((x->>'real_cost')::numeric), 0), 'point_profit', coalesce(sum((x->>'point_profit')::numeric), 0),
      'bodega_profit', coalesce(sum((x->>'bodega_profit')::numeric), 0), 'loss_cost', coalesce(sum((x->>'loss_cost')::numeric), 0),
      'charged', coalesce(sum((x->>'charged')::numeric), 0), 'paid', coalesce(sum((x->>'paid')::numeric), 0),
      'balance', coalesce(sum((x->>'balance')::numeric), 0))
      from jsonb_array_elements(v_points) x));
end $$;


revoke all on function public.erp__internal_summary(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
