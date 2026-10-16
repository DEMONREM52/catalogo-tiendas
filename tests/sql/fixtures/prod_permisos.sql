-- Funciones de PRODUCCIÓN (consulta_permisos.sql, 2026-10-15) para probar los parches de permisos.
CREATE OR REPLACE FUNCTION public.erp_cancel_purchase(p_purchase uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pu public.erp_purchases; it record; v_paid numeric;
begin
  select * into pu from public.erp_purchases where id = p_purchase for update;
  if not found then raise exception 'Compra no encontrada.'; end if;
  if not public.erp_can(pu.store_id, 'purchases') then raise exception 'No tienes permiso para anular compras.'; end if;
  if pu.status = 'cancelled' then raise exception 'La compra ya está anulada.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo de la anulación.'; end if;

  select coalesce(sum(pp.amount), 0) into v_paid
  from public.erp_payable_payments pp join public.erp_payables ap on ap.id = pp.payable_id
  where ap.purchase_id = p_purchase;
  if v_paid > 0 then raise exception 'La compra tiene pagos registrados; no se puede anular.'; end if;

  for it in select * from public.erp_purchase_items where purchase_id = p_purchase loop
    perform public.erp__move(pu.store_id, pu.warehouse_id, it.product_id, -it.qty, 'purchase_void', 'purchase', p_purchase,
      it.unit_cost, 'Anulación compra #' || pu.number, p_reason, true);
  end loop;
  update public.erp_payables set status = 'void', balance = 0, updated_at = now() where purchase_id = p_purchase;
  update public.erp_purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = p_purchase;
  perform public.erp_audit(pu.store_id, 'purchase.cancelled', 'erp_purchases', p_purchase,
    jsonb_build_object('number', pu.number, 'reason', p_reason));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_kardex(p_store uuid, p_product uuid, p_warehouse uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, product_id uuid, product_name text, warehouse_name text, movement_type text, kind text, qty integer, qty_before integer, qty_after integer, unit_cost numeric, note text, reason text, created_by uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.erp_can(p_store, 'inventory') then raise exception 'No tienes permiso para ver el kardex.'; end if;
  return query
  select m.id, m.created_at, m.product_id, p.name, w.name, m.movement_type, m.kind, m.qty, m.qty_before, m.qty_after,
         m.unit_cost, m.note, m.reason, m.created_by
  from public.inventory_movements m
  join public.products p on p.id = m.product_id
  left join public.erp_warehouses w on w.id = m.warehouse_id
  where m.store_id = p_store
    and (p_product is null or m.product_id = p_product)
    and (p_warehouse is null or m.warehouse_id = p_warehouse)
    and (p_from is null or m.created_at >= p_from)
    and (p_to is null or m.created_at <= p_to)
  order by m.created_at desc
  limit 500;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_overview(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'purchases') or public.erp_can(p_store, 'payables')) then
    raise exception 'No tienes permiso para ver este resumen.';
  end if;
  select jsonb_build_object(
    'inventory_value', coalesce((select sum(greatest(sl.qty, 0) * coalesce(p.cost_price, 0))
      from public.erp_stock_levels sl join public.products p on p.id = sl.product_id where sl.store_id = p_store), 0),
    'units', coalesce((select sum(greatest(qty, 0)) from public.erp_stock_levels where store_id = p_store), 0),
    'out_of_stock', (select count(*) from public.products p where p.store_id = p_store and p.active and p.track_inventory and coalesce(p.stock, 0) <= 0),
    'low_stock', (select count(*) from public.products p where p.store_id = p_store and p.active and p.track_inventory and coalesce(p.stock, 0) between 1 and 5),
    'transfers_in_transit', (select count(*) from public.erp_transfers where store_id = p_store and status = 'in_transit'),
    'purchases_month', coalesce((select sum(total) from public.erp_purchases where store_id = p_store and status = 'received'
      and created_at >= date_trunc('month', now())), 0),
    'payables_total', coalesce((select sum(balance) from public.erp_payables where store_id = p_store and status = 'open'), 0),
    'payables_overdue', coalesce((select sum(balance) from public.erp_payables where store_id = p_store and status = 'open' and due_date < current_date), 0),
    'receivables_total', coalesce((select sum(balance) from public.pos_ar_accounts where store_id = p_store and coalesce(status, 'open') = 'open'), 0),
    'warehouses', (select count(*) from public.erp_warehouses where store_id = p_store and active),
    'suppliers', (select count(*) from public.erp_suppliers where store_id = p_store and active)
  ) into r;
  return r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_pay_supplier(p_payable uuid, p_amount numeric, p_method text, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ap public.erp_payables; v_bal numeric;
begin
  select * into ap from public.erp_payables where id = p_payable for update;
  if not found then raise exception 'Cuenta por pagar no encontrada.'; end if;
  if not public.erp_can(ap.store_id, 'payables') then raise exception 'No tienes permiso para registrar pagos.'; end if;
  if ap.status <> 'open' then raise exception 'La cuenta no está abierta.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Monto inválido.'; end if;
  if p_amount > ap.balance then raise exception 'El pago supera el saldo pendiente (%).', ap.balance; end if;

  insert into public.erp_payable_payments (store_id, payable_id, amount, method, reference, paid_by)
  values (ap.store_id, p_payable, p_amount, coalesce(nullif(trim(p_method), ''), 'cash'), nullif(trim(p_reference), ''), auth.uid());
  v_bal := ap.balance - p_amount;
  update public.erp_payables set balance = v_bal, status = case when v_bal <= 0 then 'paid' else 'open' end, updated_at = now()
  where id = p_payable;
  perform public.erp_audit(ap.store_id, 'payable.payment', 'erp_payables', p_payable,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'balance', v_bal));
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_post_adjustment(p_store uuid, p_warehouse uuid, p_reason text, p_notes text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_num bigint; it jsonb; v_prod uuid; v_after integer; v_before integer; v_cost numeric;
begin
  if not public.erp_can(p_store, 'inventory_adjust') then raise exception 'No tienes permiso para ajustar inventario.'; end if;
  if p_reason not in ('count', 'damage', 'loss', 'expired', 'found', 'correction', 'other') then raise exception 'Motivo inválido.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El ajuste no tiene productos.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_warehouse and store_id = p_store and active) then
    raise exception 'Bodega no válida.';
  end if;
  v_num := public.erp_next_number(p_store, 'adjustment');
  insert into public.erp_adjustments (store_id, number, warehouse_id, reason, notes, created_by)
  values (p_store, v_num, p_warehouse, p_reason, nullif(trim(p_notes), ''), auth.uid()) returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_after := (it->>'qty_after')::integer;
    if v_after is null or v_after < 0 then raise exception 'Cantidad contada inválida.'; end if;
    select coalesce(cost_price, 0) into v_cost from public.products where id = v_prod and store_id = p_store;
    if not found then raise exception 'Un producto no pertenece a esta tienda.'; end if;
    select coalesce(qty, 0) into v_before from public.erp_stock_levels where warehouse_id = p_warehouse and product_id = v_prod;
    v_before := coalesce(v_before, 0);
    insert into public.erp_adjustment_items (adjustment_id, product_id, qty_before, qty_after, diff, unit_cost)
    values (v_id, v_prod, v_before, v_after, v_after - v_before, v_cost);
    perform public.erp__move(p_store, p_warehouse, v_prod, v_after - v_before, 'adjustment', 'adjustment', v_id, v_cost,
      'Ajuste #' || v_num, p_reason, true);
  end loop;
  perform public.erp_audit(p_store, 'adjustment.posted', 'erp_adjustments', v_id,
    jsonb_build_object('number', v_num, 'reason', p_reason, 'items', jsonb_array_length(p_items)));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_product_costs(p_store uuid, p_ids uuid[])
 RETURNS TABLE(product_id uuid, cost_price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.erp_can(p_store, 'products') or public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_approve')
          or public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'inventory_adjust') or public.erp_can(p_store, 'purchases')) then
    raise exception 'No tienes permiso para ver costos.';
  end if;
  if coalesce(cardinality(p_ids), 0) > 2000 then raise exception 'Pide máximo 2000 productos a la vez.'; end if;
  return query select p.id, p.cost_price from public.products p where p.store_id = p_store and p.id = any (p_ids);
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_report(p_store uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_point uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_point uuid := coalesce(public.erp_my_point(p_store), p_point);
  v_len interval := p_to - p_from;
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_bucket text;
  v_tz text := 'America/Bogota';
  v_admin boolean := public.erp_my_point(p_store) is null;
  v jsonb;
begin
  if not public.erp_can(p_store, 'audit') then raise exception 'Necesitas el permiso de Auditoría e informes.'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'El rango de fechas no es válido.'; end if;
  if v_len > interval '3 years 2 days' then raise exception 'El rango máximo es de 3 años.'; end if;
  v_bucket := case
    when v_len <= interval '2 days' then 'hour'
    when v_len <= interval '92 days' then 'day'
    when v_len <= interval '400 days' then 'week'
    else 'month' end;

  with cur as (select * from public.erp__sale_lines(p_store, p_from, p_to, v_point)),
       prev as (select * from public.erp__sale_lines(p_store, v_prev_from, p_from, v_point))
  select jsonb_build_object(
    'meta', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_prev_from, 'bucket', v_bucket, 'tz', v_tz,
      'point', (select jsonb_build_object('id', w.id, 'name', w.name) from public.erp_warehouses w where w.id = v_point),
      'point_locked', public.erp_my_point(p_store) is not null, 'generated_at', now()),
    'kpis', (select jsonb_build_object(
      'sales', coalesce(sum(revenue), 0), 'cost', coalesce(sum(cost), 0), 'units', coalesce(sum(qty), 0),
      'orders', count(distinct order_id),
      'customers', count(distinct customer_name) filter (where customer_name is not null and customer_name <> 'CONSUMIDOR FINAL'))
      from cur),
    'previous', (select jsonb_build_object(
      'sales', coalesce(sum(revenue), 0), 'cost', coalesce(sum(cost), 0), 'units', coalesce(sum(qty), 0),
      'orders', count(distinct order_id))
      from prev),
    'series', (
      with b as (
        select g as k, row_number() over (order by g) as idx
        from generate_series(date_trunc(v_bucket, p_from at time zone v_tz),
                             date_trunc(v_bucket, (p_to - interval '1 second') at time zone v_tz),
                             ('1 ' || v_bucket)::interval) g
      ),
      pb as (
        select g as k, row_number() over (order by g) as idx
        from generate_series(date_trunc(v_bucket, v_prev_from at time zone v_tz),
                             date_trunc(v_bucket, (p_from - interval '1 second') at time zone v_tz),
                             ('1 ' || v_bucket)::interval) g
      ),
      cs as (select date_trunc(v_bucket, sold_at at time zone v_tz) as k, sum(revenue) as rev, sum(revenue - cost) as profit,
                    count(distinct order_id) as n from cur group by 1),
      ps as (select date_trunc(v_bucket, sold_at at time zone v_tz) as k, sum(revenue) as rev from prev group by 1)
      select coalesce(jsonb_agg(jsonb_build_object('t', b.k, 'sales', coalesce(cs.rev, 0), 'profit', coalesce(cs.profit, 0),
               'orders', coalesce(cs.n, 0), 'prev', coalesce(ps.rev, 0)) order by b.idx), '[]'::jsonb)
      from b
      left join cs on cs.k = b.k
      left join pb on pb.idx = b.idx
      left join ps on ps.k = pb.k
    ),
    'by_point', (
      select coalesce(jsonb_agg(jsonb_build_object('point_id', x.point_id, 'name', coalesce(w.name, 'En línea / sin punto'),
               'kind', w.kind, 'sales', x.rev, 'orders', x.n, 'units', x.u, 'profit', x.rev - x.cost) order by x.rev desc), '[]'::jsonb)
      from (select point_id, sum(revenue) as rev, count(distinct order_id) as n, sum(qty) as u, sum(cost) as cost from cur group by point_id) x
      left join public.erp_warehouses w on w.id = x.point_id
    ),
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', x.channel, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select channel, sum(revenue) as rev, count(distinct order_id) as n from cur group by channel) x
    ),
    'by_catalog', (
      select coalesce(jsonb_agg(jsonb_build_object('catalog_id', x.catalog_id, 'name', x.name, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select catalog_id, coalesce(max(catalog_name), 'Catálogo') as name, sum(revenue) as rev, count(distinct order_id) as n
            from cur where channel = 'catalog' group by catalog_id) x
    ),
    'top_products', (
      select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'name', coalesce(p.name, 'Producto'), 'image_url', p.image_url,
               'units', x.u, 'sales', x.rev, 'profit', x.rev - x.cost) order by x.rev desc), '[]'::jsonb)
      from (select product_id, sum(qty) as u, sum(revenue) as rev, sum(cost) as cost from cur group by product_id order by sum(revenue) desc limit 10) x
      left join public.products p on p.id = x.product_id
    ),
    'top_customers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.customer_name, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select customer_name, sum(revenue) as rev, count(distinct order_id) as n from cur
            where customer_name is not null and customer_name <> 'CONSUMIDOR FINAL'
            group by customer_name order by sum(revenue) desc limit 8) x
    ),
    'sellers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.seller_name, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select seller_name, sum(revenue) as rev, count(distinct order_id) as n from cur
            where seller_name is not null group by seller_name order by sum(revenue) desc limit 8) x
    ),
    'pending_orders', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(o.total), 0), 'oldest', min(o.created_at))
      from public.orders o
      left join public.erp_order_meta m on m.order_id = o.id
      where o.store_id = p_store and o.status in ('draft', 'sent') and o.created_at > now() - interval '60 days'
        and (v_point is null or m.point_id = v_point)
    ),
    'inventory', (
      select coalesce(jsonb_agg(jsonb_build_object('point_id', w.id, 'name', w.name, 'kind', w.kind, 'is_default', w.is_default,
               'units', coalesce(s.units, 0), 'value', coalesce(s.value, 0), 'skus', coalesce(s.skus, 0),
               'out', coalesce(s.out_n, 0), 'low', coalesce(s.low_n, 0)) order by w.is_default desc, w.name), '[]'::jsonb)
      from public.erp_warehouses w
      left join (
        select l.warehouse_id, sum(greatest(l.qty, 0)) as units, sum(greatest(l.qty, 0) * coalesce(p.cost_price, 0)) as value,
               count(*) filter (where l.qty > 0) as skus, count(*) filter (where l.qty <= 0) as out_n,
               count(*) filter (where l.qty between 1 and 5) as low_n
        from public.erp_stock_levels l
        join public.products p on p.id = l.product_id and p.active
        where l.store_id = p_store
        group by l.warehouse_id
      ) s on s.warehouse_id = w.id
      where w.store_id = p_store and w.active and (v_point is null or w.id = v_point)
    ),
    'purchases', (
      select jsonb_build_object(
        'count', count(*), 'total', coalesce(sum(pu.total), 0),
        'top_suppliers', coalesce((
          select jsonb_agg(jsonb_build_object('name', y.name, 'total', y.total, 'count', y.n) order by y.total desc)
          from (select coalesce(sp.name, 'Proveedor') as name, sum(p2.total) as total, count(*) as n
                from public.erp_purchases p2 left join public.erp_suppliers sp on sp.id = p2.supplier_id
                where p2.store_id = p_store and p2.status = 'received' and p2.created_at >= p_from and p2.created_at < p_to
                  and (v_point is null or p2.warehouse_id = v_point)
                group by 1 order by sum(p2.total) desc limit 5) y), '[]'::jsonb))
      from public.erp_purchases pu
      where pu.store_id = p_store and pu.status = 'received' and pu.created_at >= p_from and pu.created_at < p_to
        and (v_point is null or pu.warehouse_id = v_point)
    ),
    'payables', case when v_admin then (
      select jsonb_build_object(
        'open', coalesce(sum(ap.balance), 0), 'open_count', count(*),
        'overdue', coalesce(sum(ap.balance) filter (where ap.due_date < current_date), 0),
        'overdue_count', count(*) filter (where ap.due_date < current_date),
        'due_soon', coalesce(sum(ap.balance) filter (where ap.due_date between current_date and current_date + 7), 0),
        'due_soon_count', count(*) filter (where ap.due_date between current_date and current_date + 7),
        'upcoming', coalesce((
          select jsonb_agg(jsonb_build_object('supplier', y.name, 'balance', y.balance, 'due_date', y.due_date) order by y.due_date nulls last)
          from (select coalesce(sp.name, 'Proveedor') as name, a2.balance, a2.due_date
                from public.erp_payables a2 left join public.erp_suppliers sp on sp.id = a2.supplier_id
                where a2.store_id = p_store and a2.status = 'open' and a2.balance > 0
                order by a2.due_date nulls last limit 6) y), '[]'::jsonb))
      from public.erp_payables ap
      where ap.store_id = p_store and ap.status = 'open' and ap.balance > 0
    ) end,
    'transfers', (
      select jsonb_build_object('in_transit', count(*), 'list', coalesce((
        select jsonb_agg(jsonb_build_object('number', y.number, 'from', y.from_name, 'to', y.to_name, 'created_at', y.created_at,
                 'signatures', y.sigs) order by y.created_at)
        from (select t2.number, wf.name as from_name, wt.name as to_name, t2.created_at,
                     (select count(*) from public.erp_transfer_signatures sg where sg.transfer_id = t2.id) as sigs
              from public.erp_transfers t2
              join public.erp_warehouses wf on wf.id = t2.from_warehouse_id
              join public.erp_warehouses wt on wt.id = t2.to_warehouse_id
              where t2.store_id = p_store and t2.status = 'in_transit'
                and (v_point is null or v_point in (t2.from_warehouse_id, t2.to_warehouse_id))
              order by t2.created_at limit 6) y), '[]'::jsonb))
      from public.erp_transfers t
      where t.store_id = p_store and t.status = 'in_transit'
        and (v_point is null or v_point in (t.from_warehouse_id, t.to_warehouse_id))
    ),
    'customers', (
      select jsonb_build_object('total', count(*), 'new', count(*) filter (where bc.created_at >= p_from and bc.created_at < p_to))
      from public.billing_customers bc where bc.store_id = p_store
    ),
    'catalogs', (select count(*) from public.store_catalogs sc where sc.store_id = p_store and sc.active)
  ) into v;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_stock_browse(p_store uuid, p_q text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_warehouse uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_low integer DEFAULT 5, p_cost text DEFAULT 'all'::text, p_active text DEFAULT 'active'::text, p_sort text DEFAULT 'name'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pt uuid := public.erp_my_point(p_store);
  v_wh uuid;
  v_tokens text[] := public.rh_tokens(p_q);
  v_phrase text := public.rh_norm(p_q);
  v_low integer := greatest(coalesce(p_low, 5), 0);
  v jsonb;
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'products')) then
    raise exception 'No tienes permiso para ver existencias.';
  end if;
  -- Un usuario de punto solo consulta su punto.
  v_wh := coalesce(v_pt, p_warehouse);

  with base as (
    select p.id, p.name, p.sku, p.barcode, p.image_url, p.category_id, coalesce(p.cost_price, 0)::numeric as cost, p.created_at, p.active,
           case when cardinality(v_tokens) = 0 then 0
                else public.rh_score(public.rh_norm(concat_ws(' ', p.name, p.sku, p.barcode)), v_tokens, v_phrase) end as score,
           coalesce((select sum(l.qty) from public.erp_stock_levels l where l.product_id = p.id and (v_pt is null or l.warehouse_id = v_pt)), 0)::integer as total_qty,
           case when v_wh is null then null
                else coalesce((select l.qty from public.erp_stock_levels l where l.product_id = p.id and l.warehouse_id = v_wh), 0) end::integer as wh_qty,
           case when v_wh is null then false
                else exists (select 1 from public.erp_stock_levels l where l.product_id = p.id and l.warehouse_id <> v_wh and l.qty > 0) end as elsewhere
    from public.products p
    where p.store_id = p_store
      and case coalesce(p_active, 'active') when 'active' then coalesce(p.active, true) when 'inactive' then not coalesce(p.active, true) else true end
      and public.erp__in_category(p.id, p.category_id, p_category)
      and case coalesce(p_cost, 'all') when 'with' then coalesce(p.cost_price, 0) > 0 when 'without' then coalesce(p.cost_price, 0) <= 0 else true end
  ),
  need as (select coalesce(max(floor(b.score)), 0) as n from base b),
  scoped as (
    select b.*, coalesce(b.wh_qty, b.total_qty) as qty
    from base b cross join need
    where cardinality(v_tokens) = 0 or (need.n > 0 and floor(b.score) >= need.n)
  ),
  filtered as (
    select s.* from scoped s
    where case coalesce(p_status, 'all')
      when 'in' then s.qty > 0
      when 'out' then s.qty = 0
      when 'negative' then s.qty < 0
      when 'low' then s.qty between 1 and v_low
      when 'over' then s.qty > v_low
      when 'elsewhere' then s.qty <= 0 and s.elsewhere
      else true end
  ),
  ordered as (
    select f.*, row_number() over (order by case when cardinality(v_tokens) > 0 and coalesce(p_sort, 'name') = 'name' then f.score end desc nulls last, case p_sort when 'qty_desc' then f.qty end desc nulls last, case p_sort when 'qty_asc' then f.qty end asc nulls last, case p_sort when 'value_desc' then greatest(f.qty, 0) * f.cost end desc nulls last, case p_sort when 'cost_desc' then f.cost end desc nulls last, case p_sort when 'recent' then f.created_at end desc nulls last, f.name, f.id) as rn
    from filtered f
  ),
  page as (
    select o.* from ordered o
    order by o.rn
    limit least(greatest(coalesce(p_limit, 25), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', coalesce((select count(*) from filtered), 0),
    'units', coalesce((select sum(qty) from filtered), 0),
    'value', coalesce((select sum(greatest(qty, 0) * cost) from filtered), 0),
    'negative', coalesce((select count(*) from filtered where qty < 0), 0),
    'out', coalesce((select count(*) from filtered where qty = 0), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'name', pg.name, 'sku', pg.sku, 'barcode', pg.barcode, 'image_url', pg.image_url, 'active', pg.active,
        'category', (select c.name from public.product_categories c where c.id = pg.category_id),
        'cost_price', pg.cost, 'total', pg.total_qty, 'qty', pg.qty,
        'levels', coalesce((select jsonb_object_agg(l.warehouse_id::text, l.qty) from public.erp_stock_levels l
                            where l.product_id = pg.id and (v_pt is null or l.warehouse_id = v_pt)), '{}'::jsonb))
      order by pg.rn) from page pg), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_stock_page(p_store uuid, p_q text, p_only_low boolean, p_limit integer, p_offset integer)
 RETURNS TABLE(id uuid, name text, sku text, cost_price numeric, total integer, levels jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_tokens text[] := public.rh_tokens(p_q);
  v_phrase text := public.rh_norm(p_q);
  v_pt uuid := public.erp_my_point(p_store);
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'products')) then
    raise exception 'No tienes permiso para ver existencias.';
  end if;
  return query
    with base as (
      select p.id as pid, p.name::text as pname, p.sku::text as psku, coalesce(p.cost_price, 0)::numeric as pcost,
             case when v_pt is null then coalesce(p.stock, 0) else coalesce(l.qty, 0) end::integer as ptotal,
             case when cardinality(v_tokens) = 0 then 0
                  else public.rh_score(public.rh_norm(concat_ws(' ', p.name, p.sku, p.barcode)), v_tokens, v_phrase) end as score
      from public.products p
      left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = v_pt
      where p.store_id = p_store and coalesce(p.active, true)
    ),
    scoped as (
      select b.* from base b where not coalesce(p_only_low, false) or b.ptotal <= 5
    ),
    need as (select coalesce(max(floor(s.score)), 0) as n from scoped s),
    page as (
      select s.*, count(*) over () as cnt
      from scoped s cross join need
      where cardinality(v_tokens) = 0 or (need.n > 0 and floor(s.score) >= need.n)
      order by s.score desc, s.pname
      limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
    )
    select pg.pid, pg.pname, pg.psku, pg.pcost, pg.ptotal,
           coalesce((select jsonb_object_agg(l.warehouse_id::text, l.qty) from public.erp_stock_levels l
                     where l.product_id = pg.pid and (v_pt is null or l.warehouse_id = v_pt)), '{}'::jsonb),
           pg.cnt
    from page pg
    order by pg.score desc, pg.pname;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_update_purchase(p_purchase uuid, p_supplier uuid, p_invoice_ref text, p_invoice_date date, p_payment_type text, p_due_date date, p_notes text, p_checked_by text, p_items jsonb, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pu public.erp_purchases;
  ap public.erp_payables;
  it jsonb;
  r record;
  v_ref text := nullif(btrim(coalesce(p_invoice_ref, '')), '');
  v_days integer;
  v_paid numeric := 0;
  v_sub numeric := 0;
  v_taxt numeric := 0;
  v_total numeric;
  v_due date;
  v_first_wh uuid;
  v_stock integer;
  v_cost numeric;
  v_base_q numeric;
  v_base_v numeric;
  v_new_cost numeric;
  v_before jsonb;
  v_note text;
  v_new jsonb := '[]'::jsonb;
  v_old jsonb;
begin
  select * into pu from public.erp_purchases where id = p_purchase for update;
  if not found then raise exception 'Ingreso no encontrado.'; end if;
  if not public.erp_can(pu.store_id, 'purchases') then raise exception 'No tienes permiso para editar compras.'; end if;
  if not coalesce(public.erp__my_point_ok(pu.store_id, pu.warehouse_id), false)
     or exists (select 1 from public.erp_purchase_items i
                where i.purchase_id = pu.id
                  and not coalesce(public.erp__my_point_ok(pu.store_id, coalesce(i.warehouse_id, pu.warehouse_id)), false)) then
    raise exception 'Este ingreso es de otro punto: solo lo puede editar la tienda madre.';
  end if;
  if pu.status <> 'received' then raise exception 'Solo se pueden editar ingresos vigentes (este está anulado).'; end if;
  if p_payment_type not in ('cash', 'credit') then raise exception 'Tipo de pago inválido.'; end if;
  if v_ref is null then raise exception 'Escribe el número de la factura del proveedor.'; end if;
  if nullif(btrim(coalesce(p_checked_by, '')), '') is null then raise exception 'Indica quién revisó la mercancía.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La factura no tiene productos.'; end if;

  select payment_days into v_days from public.erp_suppliers where id = p_supplier and store_id = pu.store_id and active;
  if not found then raise exception 'Proveedor no válido.'; end if;
  if exists (select 1 from public.erp_purchases
             where store_id = pu.store_id and supplier_id = p_supplier and lower(invoice_ref) = lower(v_ref)
               and status = 'received' and id <> pu.id) then
    raise exception 'Ya registraste la factura % de este proveedor.', v_ref;
  end if;

  select coalesce(sum(pp.amount), 0) into v_paid
  from public.erp_payable_payments pp join public.erp_payables a on a.id = pp.payable_id
  where a.purchase_id = pu.id;
  if v_paid > 0 and p_supplier is distinct from pu.supplier_id then
    raise exception 'Esta compra ya tiene pagos registrados; no se puede cambiar el proveedor.';
  end if;

  -- Validar y normalizar las líneas nuevas.
  for it in select e.value from jsonb_array_elements(p_items) with ordinality as e(value, ord) order by e.ord loop
    if nullif(it->>'warehouse_id', '') is null then raise exception 'Elige la bodega destino de cada producto.'; end if;
    if nullif(it->>'qty', '') is null or (it->>'qty')::numeric <= 0 or (it->>'qty')::numeric <> trunc((it->>'qty')::numeric)
       or nullif(it->>'unit_cost', '') is null or (it->>'unit_cost')::numeric < 0 then
      raise exception 'Cantidad o costo inválido.';
    end if;
    if not exists (select 1 from public.products where id = (it->>'product_id')::uuid and store_id = pu.store_id) then
      raise exception 'Un producto no pertenece a esta tienda.';
    end if;
    if not exists (select 1 from public.erp_warehouses where id = (it->>'warehouse_id')::uuid and store_id = pu.store_id and active) then
      raise exception 'Una bodega destino no es válida o está inactiva.';
    end if;
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'product_id', (it->>'product_id')::uuid,
      'warehouse_id', (it->>'warehouse_id')::uuid,
      'qty', (it->>'qty')::integer,
      'unit_cost', (it->>'unit_cost')::numeric,
      'tax_rate', least(100, greatest(0, coalesce(nullif(it->>'tax_rate', '')::numeric, 0))),
      'ord', jsonb_array_length(v_new)));
  end loop;
  v_first_wh := (v_new->0->>'warehouse_id')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'warehouse_id', coalesce(i.warehouse_id, pu.warehouse_id),
           'qty', i.qty, 'unit_cost', i.unit_cost, 'tax_rate', i.tax_rate)), '[]'::jsonb)
  into v_old
  from public.erp_purchase_items i where i.purchase_id = pu.id;

  v_before := jsonb_build_object(
    'supplier_id', pu.supplier_id, 'invoice_ref', pu.invoice_ref, 'invoice_date', pu.invoice_date,
    'payment_type', pu.payment_type, 'due_date', pu.due_date, 'total', pu.total, 'items', v_old);

  -- 1) Costo promedio: se quita lo que aportó la versión anterior y se suma la nueva.
  for r in
    with o as (select x.product_id, sum(x.qty) as q, sum(x.qty * x.unit_cost) as val
               from jsonb_to_recordset(v_old) as x(product_id uuid, qty integer, unit_cost numeric) group by x.product_id),
         n as (select x.product_id, sum(x.qty) as q, sum(x.qty * x.unit_cost) as val
               from jsonb_to_recordset(v_new) as x(product_id uuid, qty integer, unit_cost numeric) group by x.product_id)
    select coalesce(o.product_id, n.product_id) as product_id,
           coalesce(o.q, 0) as old_q, coalesce(o.val, 0) as old_v,
           coalesce(n.q, 0) as new_q, coalesce(n.val, 0) as new_v
    from o full join n on n.product_id = o.product_id
  loop
    if r.old_q = r.new_q and r.old_v = r.new_v then continue; end if;
    select coalesce(stock, 0), coalesce(cost_price, 0) into v_stock, v_cost
    from public.products where id = r.product_id for update;
    v_base_q := greatest(v_stock, 0) - r.old_q;
    v_base_v := greatest(v_stock, 0) * v_cost - r.old_v;
    if v_base_q <= 0 or v_base_v < 0 then
      v_new_cost := case when r.new_q > 0 then r.new_v / r.new_q else v_cost end;
    elsif v_base_q + r.new_q > 0 then
      v_new_cost := (v_base_v + r.new_v) / (v_base_q + r.new_q);
    else
      v_new_cost := v_cost;
    end if;
    update public.products set cost_price = round(greatest(v_new_cost, 0), 4), updated_at = now() where id = r.product_id;
  end loop;

  -- 2) Inventario: solo se mueve la diferencia por producto y bodega (primero las entradas).
  v_note := 'Edición de la compra #' || pu.number || ' (factura ' || v_ref || ')';
  for r in
    with o as (select x.product_id, x.warehouse_id, sum(x.qty) as q, max(x.unit_cost) as c
               from jsonb_to_recordset(v_old) as x(product_id uuid, warehouse_id uuid, qty integer, unit_cost numeric) group by 1, 2),
         n as (select x.product_id, x.warehouse_id, sum(x.qty) as q, max(x.unit_cost) as c
               from jsonb_to_recordset(v_new) as x(product_id uuid, warehouse_id uuid, qty integer, unit_cost numeric) group by 1, 2)
    select coalesce(o.product_id, n.product_id) as product_id, coalesce(o.warehouse_id, n.warehouse_id) as warehouse_id,
           coalesce(n.q, 0) - coalesce(o.q, 0) as delta, coalesce(n.c, o.c, 0) as cost
    from o full join n on n.product_id = o.product_id and n.warehouse_id = o.warehouse_id
    order by 3 desc
  loop
    if r.delta = 0 then continue; end if;
    perform public.erp__move(pu.store_id, r.warehouse_id, r.product_id, r.delta::integer,
      case when r.delta > 0 then 'purchase' else 'purchase_void' end,
      'purchase', pu.id, r.cost, v_note, nullif(btrim(coalesce(p_reason, '')), ''), true);
  end loop;

  -- 3) Líneas y totales.
  delete from public.erp_purchase_items where purchase_id = pu.id;
  insert into public.erp_purchase_items (purchase_id, product_id, qty, unit_cost, tax_rate, line_total, warehouse_id)
  select pu.id, x.product_id, x.qty, x.unit_cost, x.tax_rate, round(x.qty * x.unit_cost * (1 + x.tax_rate / 100), 2), x.warehouse_id
  from jsonb_to_recordset(v_new) as x(product_id uuid, warehouse_id uuid, qty integer, unit_cost numeric, tax_rate numeric, ord integer)
  order by x.ord;

  select coalesce(sum(x.qty * x.unit_cost), 0), coalesce(sum(x.qty * x.unit_cost * x.tax_rate / 100), 0)
  into v_sub, v_taxt
  from jsonb_to_recordset(v_new) as x(qty integer, unit_cost numeric, tax_rate numeric);
  v_total := round(v_sub + v_taxt, 2);
  v_due := case when p_payment_type = 'credit'
    then coalesce(p_due_date, pu.due_date, pu.created_at::date + coalesce(v_days, 0)) else null end;

  update public.erp_purchases
  set supplier_id = p_supplier,
      warehouse_id = coalesce(v_first_wh, warehouse_id),
      invoice_ref = v_ref,
      invoice_date = coalesce(p_invoice_date, invoice_date),
      payment_type = p_payment_type,
      due_date = v_due,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      checked_by_name = nullif(btrim(coalesce(p_checked_by, '')), ''),
      subtotal = round(v_sub, 2), tax = round(v_taxt, 2), total = v_total,
      edited_at = now(), edited_by_name = public.erp_actor_name(pu.store_id), edit_count = coalesce(edit_count, 0) + 1
  where id = pu.id;

  -- 4) Cuenta por pagar.
  select * into ap from public.erp_payables where purchase_id = pu.id and status <> 'void' order by created_at desc limit 1;
  if p_payment_type = 'credit' then
    if v_paid > v_total then
      raise exception 'Ya se pagaron % a este proveedor y el nuevo total (%) es menor. Ajusta los valores.', v_paid, v_total;
    end if;
    if ap.id is not null then
      update public.erp_payables
      set supplier_id = p_supplier, total = v_total, balance = round(v_total - v_paid, 2), due_date = v_due,
          status = case when v_total - v_paid <= 0 then 'paid' else 'open' end, updated_at = now()
      where id = ap.id;
    else
      insert into public.erp_payables (store_id, supplier_id, purchase_id, total, balance, due_date)
      values (pu.store_id, p_supplier, pu.id, v_total, v_total, v_due);
    end if;
  elsif ap.id is not null then
    if v_paid > 0 then
      raise exception 'Esta compra a crédito ya tiene pagos; no se puede cambiar a contado.';
    end if;
    update public.erp_payables set status = 'void', balance = 0, updated_at = now() where id = ap.id;
  end if;

  perform public.erp_audit(pu.store_id, 'purchase.edited', 'erp_purchases', pu.id,
    jsonb_build_object('number', pu.number, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'before', v_before,
      'after', jsonb_build_object('supplier_id', p_supplier, 'invoice_ref', v_ref, 'invoice_date', p_invoice_date,
        'payment_type', p_payment_type, 'due_date', v_due, 'total', v_total, 'items', p_items)));
  return pu.id;
end;
$function$;
