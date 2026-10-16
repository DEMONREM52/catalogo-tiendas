-- =====================================================================
-- REMHUB · Rentabilidad de la cadena: proveedor → bodega → puntos
--
-- Con el crédito en traslados (20261124), en cada venta de un punto con
-- crédito:
--   · costo del punto  = lo que la bodega le cobró (su costo propio);
--   · ganancia del punto = venta − costo del punto;
--   · ganancia de la bodega = costo del punto − costo real del proveedor.
--   Ej.: proveedor $18M → bodega cobra $20M → Cisneros vende $23M:
--        bodega gana $2M y Cisneros $3M. La suma es la ganancia total ($5M).
-- Los repartos siguen la regla de siempre: se reparte lo vendido y COBRADO.
-- Puntos sin crédito o productos sin costo propio: siguen igual que hoy.
--
-- Además: costo real en cada documento interno (para ver lo que la bodega
-- gana y lo que pierde en novedades) y el informe de la cadena.
--
-- La función de ventas NO se reescribe: se toma la de la base y solo se le
-- agrega el paso del costo propio; si algo no coincide, no cambia nada.
-- Requiere 20261124. No borra datos. Es idempotente.
-- =====================================================================

do $$
begin
  if to_regclass('public.erp_internal_points') is null then
    raise exception 'Primero ejecuta 20261124_credito_traslados.sql.';
  end if;
end $$;

-- 1. Costo real de cada documento interno (y se completa en los que ya existen).
alter table public.erp_internal_docs add column if not exists cost_amount numeric;
update public.erp_internal_docs d
set cost_amount = (select round(sum(coalesce(i.received_qty, i.qty) * coalesce(i.unit_cost, 0)), 2)
                   from public.erp_transfer_items i where i.transfer_id = d.transfer_id)
where d.cost_amount is null and d.transfer_id is not null;
update public.erp_internal_docs d
set cost_amount = (select round(cl.qty * coalesce(p.cost_price, 0), 2)
                   from public.erp_internal_claims cl join public.products p on p.id = cl.product_id where cl.id = d.claim_id)
where d.cost_amount is null and d.claim_id is not null;

-- Documentos internos con su costo real (mismas funciones de 20261124 + costo).
create or replace function public.erp__transfer_internal_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_to public.erp_internal_points;
  v_from public.erp_internal_points;
  it record;
  v_val numeric := 0;
  v_cost numeric := 0;
  v_missing integer := 0;
  v_unit numeric;
  v_recv integer;
  v_before integer;
  v_avg numeric;
  v_term integer;
  v_note text;
begin
  if new.status <> 'received' or old.status = 'received' then return null; end if;
  v_to := public.erp__internal_point(new.store_id, new.to_warehouse_id);
  v_from := public.erp__internal_point(new.store_id, new.from_warehouse_id);
  if v_to.point_id is null and v_from.point_id is null then return null; end if;

  for it in select * from public.erp_transfer_items where transfer_id = new.id loop
    v_recv := coalesce(it.received_qty, it.qty);
    if v_recv <= 0 then continue; end if;
    v_unit := coalesce(it.internal_price,
      case when v_from.point_id is not null then
        (select c.avg_cost from public.erp_point_costs c where c.point_id = new.from_warehouse_id and c.product_id = it.product_id and c.avg_cost > 0) end,
      public.erp__internal_unit(new.store_id, coalesce(v_to.point_id, v_from.point_id), it.product_id));
    if v_unit is null then v_missing := v_missing + 1; continue; end if;
    v_val := v_val + v_recv * v_unit;
    v_cost := v_cost + v_recv * coalesce(it.unit_cost, 0);

    if v_to.point_id is not null then
      -- Costo propio del punto: promedio entre lo que tenía y lo que llega.
      select coalesce(l.qty, 0) into v_before from public.erp_stock_levels l
      where l.warehouse_id = new.to_warehouse_id and l.product_id = it.product_id;
      v_before := greatest(coalesce(v_before, 0) - v_recv, 0);
      select c.avg_cost into v_avg from public.erp_point_costs c where c.point_id = new.to_warehouse_id and c.product_id = it.product_id;
      insert into public.erp_point_costs as c (point_id, product_id, store_id, avg_cost)
      values (new.to_warehouse_id, it.product_id, new.store_id, v_unit)
      on conflict (point_id, product_id) do update
        set avg_cost = round((v_before * coalesce(v_avg, v_unit) + v_recv * v_unit) / (v_before + v_recv), 4), updated_at = now();
    end if;
  end loop;

  v_val := round(v_val, 2);
  if v_val <= 0 then return null; end if;
  v_note := 'Traslado #' || new.number || case when v_missing > 0 then ' · ' || v_missing || ' producto(s) sin costo no se cobraron' else '' end;

  if v_from.point_id is not null then
    insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, cost_amount, transfer_id, note, created_by, created_by_name)
    values (new.store_id, new.from_warehouse_id, public.erp_next_number(new.store_id, 'internal_doc'),
            case when v_to.point_id is null then 'return' else 'transfer_out' end, -1, v_val, round(v_cost, 2), new.id, v_note, auth.uid(),
            coalesce(new.received_by_name, 'Sistema'))
    on conflict do nothing;
  end if;
  if v_to.point_id is not null then
    v_term := coalesce(v_to.term_days, (public.erp__internal_settings(new.store_id)).default_term_days);
    insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, cost_amount, due_date, transfer_id, note, created_by, created_by_name)
    values (new.store_id, new.to_warehouse_id, public.erp_next_number(new.store_id, 'internal_doc'), 'transfer', 1, v_val, round(v_cost, 2),
            public.erp__internal_today() + v_term, new.id, v_note, auth.uid(), coalesce(new.received_by_name, 'Sistema'))
    on conflict do nothing;
  end if;
  return null;
end $$;

create or replace function public.erp_internal_opening_from_stock(p_store uuid, p_point uuid, p_due date, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ip public.erp_internal_points; l record; v_unit numeric; v_total numeric := 0; v_cost numeric := 0; v_n integer := 0; v_missing integer := 0; v_id uuid;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» registra esto.'; end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;
  if not found then raise exception 'Primero activa el crédito para ese punto.'; end if;
  if exists (select 1 from public.erp_internal_docs where store_id = p_store and point_id = p_point and kind = 'opening' and status = 'active') then
    raise exception 'Este punto ya tiene deuda inicial. Anúlala primero si quieres recalcularla.';
  end if;
  for l in select product_id, qty from public.erp_stock_levels where warehouse_id = p_point and qty > 0 loop
    v_unit := public.erp__internal_unit(p_store, p_point, l.product_id);
    if v_unit is null then v_missing := v_missing + 1; continue; end if;
    v_total := v_total + l.qty * v_unit;
    v_cost := v_cost + l.qty * coalesce((select cost_price from public.products where id = l.product_id), 0);
    v_n := v_n + 1;
    insert into public.erp_point_costs (point_id, product_id, store_id, avg_cost) values (p_point, l.product_id, p_store, v_unit)
    on conflict (point_id, product_id) do update set avg_cost = excluded.avg_cost, updated_at = now();
  end loop;
  if v_total <= 0 then raise exception 'El punto no tiene mercancía con costo para valorizar.'; end if;
  insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, cost_amount, due_date, note, created_by, created_by_name)
  values (p_store, p_point, public.erp_next_number(p_store, 'internal_doc'), 'opening', 1, round(v_total, 2), round(v_cost, 2),
          coalesce(p_due, public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days)),
          coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 300), 'Deuda inicial: mercancía en el punto') ||
            case when v_missing > 0 then ' · ' || v_missing || ' producto(s) sin costo no se cobraron' else '' end,
          auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.opening', 'erp_internal_docs', v_id, jsonb_build_object('point_id', p_point, 'amount', v_total, 'products', v_n));
  return jsonb_build_object('ok', true, 'doc_id', v_id, 'amount', round(v_total, 2), 'products', v_n, 'missing', v_missing);
end $$;

create or replace function public.erp_internal_claim_decide(p_claim uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cl public.erp_internal_claims; v_doc uuid; v_value numeric;
begin
  select * into cl from public.erp_internal_claims where id = p_claim for update;
  if not found then raise exception 'Novedad no encontrada.'; end if;
  if not public.erp__internal_manager(cl.store_id) then raise exception 'Solo la tienda madre aprueba novedades.'; end if;
  if cl.status <> 'pending' then raise exception 'Esa novedad ya se decidió.'; end if;
  if not p_approve and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Escribe por qué se rechaza.'; end if;
  if p_approve then
    -- Sale del inventario del punto (toda la empresa) y baja la deuda: la pérdida la asume la bodega.
    perform public.erp__move(cl.store_id, cl.point_id, cl.product_id, -cl.qty, 'internal_loss', 'internal_claim', cl.id,
      cl.unit_value, 'Novedad aprobada (' || case cl.reason when 'damaged' then 'dañado' when 'lost' then 'perdido' when 'expired' then 'vencido' when 'stolen' then 'robo' else 'otro' end || ')', left(cl.note, 200), true);
    v_value := round(cl.qty * coalesce(cl.unit_value, 0), 2);
    if v_value > 0 then
      insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, cost_amount, claim_id, note, created_by, created_by_name)
      values (cl.store_id, cl.point_id, public.erp_next_number(cl.store_id, 'internal_doc'), 'loss', -1, v_value,
              round(cl.qty * coalesce((select cost_price from public.products where id = cl.product_id), 0), 2), cl.id,
              'Novedad: ' || cl.qty || ' und. (' || case cl.reason when 'damaged' then 'dañado' when 'lost' then 'perdido' when 'expired' then 'vencido' when 'stolen' then 'robo' else 'otro' end || ')', auth.uid(), public.erp_actor_name(cl.store_id))
      returning id into v_doc;
    end if;
  end if;
  update public.erp_internal_claims
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_by_name = public.erp_actor_name(cl.store_id),
      decided_at = now(), decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300), doc_id = v_doc
  where id = p_claim;
  perform public.erp_audit(cl.store_id, case when p_approve then 'internal.claim_approved' else 'internal.claim_rejected' end, 'erp_internal_claims', p_claim,
    jsonb_build_object('value', v_value, 'note', p_note));
  return jsonb_build_object('ok', true, 'value', v_value);
end $$;

-- 2. Las ventas aceptan el origen «internal» (costo propio del punto).
do $$
declare c record;
begin
  for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint
           where conrelid = 'public.erp_sale_finance'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%ref_source%' loop
    if c.def not like '%internal%' then
      execute format('alter table public.erp_sale_finance drop constraint %I', c.conname);
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.erp_sale_finance'::regclass and contype = 'c'
                 and pg_get_constraintdef(oid) like '%ref_source%') then
    alter table public.erp_sale_finance add constraint erp_sale_finance_ref_source_check
      check (ref_source in ('level', 'point_rule', 'sold_price', 'internal'));
  end if;
end $$;

-- 3. Foto financiera de cada venta: en un punto con crédito, el costo del punto es su costo propio.
create or replace function pg_temp.patch(p_fn text, p_marker text, p_pattern text, p_replacement text)
returns void language plpgsql as $$
declare r record; v_def text; v_new text; n integer := 0;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_fn loop
    n := n + 1;
    v_def := pg_get_functiondef(r.oid);
    if position(p_marker in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, p_pattern, p_replacement);
    if v_new = v_def then
      raise exception 'No pude ajustar % (no encontré: %). No se cambió nada.', p_fn, left(p_pattern, 80);
    end if;
    execute v_new;
  end loop;
  if n = 0 then raise exception 'No existe la función % en esta base. No se cambió nada.', p_fn; end if;
end $$;

do $$
begin
  perform pg_temp.patch('erp__capture_sale_finance', 'v_icost numeric',
    'v_cost_total\s+numeric;',
    'v_cost_total numeric; v_icost numeric;');
  perform pg_temp.patch('erp__capture_sale_finance', 'v_src := ''internal''',
    '(if\s+v_lvl\s+is\s+null\s+then\s+v_ref\s*:=\s*round\(it\.unit_price,\s*2\);\s*r\s*:=\s*null;\s*end\s+if;)',
    '\1
      -- Punto con crédito de la bodega (20261125): su costo es lo que la bodega le cobró.
      if v_point is not null and exists (select 1 from public.erp_internal_points ip where ip.point_id = v_point and ip.enabled) then
        select c.avg_cost into v_icost from public.erp_point_costs c where c.point_id = v_point and c.product_id = it.product_id and c.avg_cost > 0;
        if v_icost is not null then v_ref := round(v_icost, 2); v_src := ''internal''; r := null; end if;
      end if;');
end $$;

-- 4. Informe de la cadena (para el tablero): lo vendido, lo que gana cada uno, lo cobrado y lo perdido.
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
    'totals', (select jsonb_build_object(
      'revenue', coalesce(sum((x->>'revenue')::numeric), 0), 'internal_cost', coalesce(sum((x->>'internal_cost')::numeric), 0),
      'real_cost', coalesce(sum((x->>'real_cost')::numeric), 0), 'point_profit', coalesce(sum((x->>'point_profit')::numeric), 0),
      'bodega_profit', coalesce(sum((x->>'bodega_profit')::numeric), 0), 'loss_cost', coalesce(sum((x->>'loss_cost')::numeric), 0),
      'charged', coalesce(sum((x->>'charged')::numeric), 0), 'paid', coalesce(sum((x->>'paid')::numeric), 0),
      'balance', coalesce(sum((x->>'balance')::numeric), 0))
      from jsonb_array_elements(v_points) x));
end $$;
revoke all on function public.erp_internal_profit(uuid, date, date) from public, anon;
grant execute on function public.erp_internal_profit(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
