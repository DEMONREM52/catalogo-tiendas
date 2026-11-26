-- Versiones de PRODUCCIÓN (consulta_rendimiento_5.sql, 2026-11-26) de las funciones que cambia 20261345,
-- renombradas con «_old» para comparar en tests/sql/funciones_rapidas.test.mjs. Para volver atrás en Supabase:
-- correr la función que se quiera con el nombre sin «_old» (y sus llamadas internas sin «_old»).

-- erp__sr_access
CREATE OR REPLACE FUNCTION public.erp__sr_access_old(p_store uuid, p_from uuid, p_to uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pt uuid := public.erp_my_point(p_store);
  v_manage boolean := public.erp_can(p_store, 'stock_requests_manage');
  v_attend boolean;
  v_request boolean;
begin
  v_attend := (v_manage or public.erp_can(p_store, 'transfers')) and (v_pt is null or v_pt = p_to);
  v_request := (public.erp_can(p_store, 'stock_requests') or v_manage) and (v_pt is null or v_pt = p_from);
  return jsonb_build_object(
    'attend', v_attend,
    'request', v_request,
    'view', v_attend or v_request or (v_manage and v_pt is null) or (public.erp_can(p_store, 'audit') and v_pt is null));
end;
$function$;

-- erp_sr_can_view
CREATE OR REPLACE FUNCTION public.erp_sr_can_view_old(p_request uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select (public.erp__sr_access_old(r.store_id, r.from_point_id, r.to_point_id)->>'view')::boolean
                   from public.erp_stock_requests r where r.id = p_request), false);
$function$;

-- erp_stock_requests_list
CREATE OR REPLACE FUNCTION public.erp_stock_requests_list_old(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  select coalesce(jsonb_agg(x order by (x->>'sort_open')::int, x->>'updated_at' desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', r.id, 'number', r.number, 'status', r.status, 'priority', r.priority, 'note', r.note, 'needed_by', r.needed_by,
      'from_point_id', r.from_point_id, 'from_name', wf.name, 'to_point_id', r.to_point_id, 'to_name', wt.name,
      'requested_by_name', r.requested_by_name, 'handled_by_name', r.handled_by_name,
      'created_at', r.created_at, 'updated_at', coalesce(r.last_message_at, r.updated_at), 'closed_at', r.closed_at,
      'items', (select count(*) from public.erp_stock_request_items i where i.request_id = r.id),
      'units', (select coalesce(sum(i.qty_requested), 0) from public.erp_stock_request_items i where i.request_id = r.id),
      'last_message', (select jsonb_build_object('body', m.body, 'user_name', m.user_name, 'kind', m.kind, 'created_at', m.created_at)
                       from public.erp_stock_request_messages m where m.request_id = r.id order by m.created_at desc limit 1),
      'unread', (select count(*) from public.erp_stock_request_messages m
                 where m.request_id = r.id and m.user_id is distinct from auth.uid()
                   and m.created_at > coalesce((select rd.last_read_at from public.erp_stock_request_reads rd where rd.request_id = r.id and rd.user_id = auth.uid()), '-infinity')),
      'access', a.acc,
      'sort_open', case when r.status in ('pending', 'preparing', 'dispatched') then 0 else 1 end
    ) as x
    from public.erp_stock_requests r
    join public.erp_warehouses wf on wf.id = r.from_point_id
    join public.erp_warehouses wt on wt.id = r.to_point_id
    cross join lateral (select public.erp__sr_access_old(r.store_id, r.from_point_id, r.to_point_id) as acc) a
    where r.store_id = p_store and (a.acc->>'view')::boolean
      and (r.status in ('pending', 'preparing', 'dispatched') or r.created_at > now() - interval '120 days')
    order by r.created_at desc
    limit 300
  ) s;
  return v;
end;
$function$;

-- erp_stock_inbox
CREATE OR REPLACE FUNCTION public.erp_stock_inbox_old(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'incoming', coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'from_name', wf.name, 'to_name', wt.name, 'priority', r.priority,
        'created_at', r.created_at, 'items', (select count(*) from public.erp_stock_request_items i where i.request_id = r.id)) order by r.created_at desc)
        filter (where r.status = 'pending' and (a.acc->>'attend')::boolean), '[]'::jsonb),
    'arriving', count(*) filter (where r.status = 'dispatched' and (a.acc->>'request')::boolean),
    'unread', coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'from_name', wf.name, 'to_name', wt.name, 'count', u.n,
        'last', (select m.body from public.erp_stock_request_messages m where m.request_id = r.id order by m.created_at desc limit 1),
        'last_user', (select m.user_name from public.erp_stock_request_messages m where m.request_id = r.id order by m.created_at desc limit 1),
        'last_at', r.last_message_at))
        filter (where u.n > 0 and r.status in ('pending', 'preparing', 'dispatched')), '[]'::jsonb))
  into v
  from public.erp_stock_requests r
  join public.erp_warehouses wf on wf.id = r.from_point_id
  join public.erp_warehouses wt on wt.id = r.to_point_id
  cross join lateral (select public.erp__sr_access_old(r.store_id, r.from_point_id, r.to_point_id) as acc) a
  cross join lateral (
    select count(*) as n from public.erp_stock_request_messages m
    where m.request_id = r.id and m.user_id is distinct from auth.uid()
      and m.created_at > coalesce((select rd.last_read_at from public.erp_stock_request_reads rd where rd.request_id = r.id and rd.user_id = auth.uid()), '-infinity')
  ) u
  where r.store_id = p_store and r.status in ('pending', 'preparing', 'dispatched')
    and ((a.acc->>'attend')::boolean or (a.acc->>'request')::boolean);
  return v;
end;
$function$;

-- erp_alerts
CREATE OR REPLACE FUNCTION public.erp_alerts_old(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_point uuid := public.erp_my_point(p_store);
  v_audit boolean := public.erp_can(p_store, 'audit');
  v_inventory boolean := v_audit or public.erp_can(p_store, 'inventory');
  v_orders boolean := v_audit or public.erp_can(p_store, 'orders');
  v_payables boolean := v_point is null and (v_audit or public.erp_can(p_store, 'payables'));
  v_recv boolean := v_audit or public.erp_can(p_store, 'receivables') or public.erp_can(p_store, 'credit');
  v_sr boolean := public.erp_can(p_store, 'stock_requests') or public.erp_can(p_store, 'stock_requests_manage') or public.erp_can(p_store, 'transfers');
  v jsonb := '[]'::jsonb;
  s public.stores;
  r record;
  v_n integer;
  v_total numeric;
  v_days integer;
begin
  if not (v_audit or v_inventory or v_orders or v_payables or v_recv or v_sr) then return v; end if;
  select * into s from public.stores where id = p_store;

  if v_point is null and s.active_until is not null then
    v_days := ceil(extract(epoch from (s.active_until - now())) / 86400.0)::integer;
    if v_days <= 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'plan-expired', 'severity', 'critical', 'icon', 'calendar',
        'title', 'Tu plan está vencido', 'body', 'Los catálogos están inactivos. Renueva para volver a vender en línea.', 'href', '/dashboard/store'));
    elsif v_days <= 10 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'plan-' || v_days, 'severity', 'serious', 'icon', 'calendar',
        'title', 'Tu plan vence en ' || v_days || ' día' || case when v_days = 1 then '' else 's' end,
        'body', 'Renueva a tiempo para que tus catálogos sigan activos.', 'href', '/dashboard/store'));
    end if;
  end if;

  if v_payables then
    select count(*), coalesce(sum(balance), 0) into v_n, v_total from public.erp_payables
    where store_id = p_store and status = 'open' and balance > 0 and due_date < current_date;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'payables-overdue-' || v_n || '-' || v_total, 'severity', 'critical', 'icon', 'wallet',
        'title', v_n || ' cuenta' || case when v_n = 1 then '' else 's' end || ' por pagar vencida' || case when v_n = 1 then '' else 's' end,
        'body', 'Saldo vencido con proveedores: $' || to_char(v_total, 'FM999G999G999G999'), 'href', '/dashboard/inventario', 'count', v_n));
    end if;
    select count(*), coalesce(sum(balance), 0) into v_n, v_total from public.erp_payables
    where store_id = p_store and status = 'open' and balance > 0 and due_date between current_date and current_date + 7;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'payables-soon-' || current_date || '-' || v_n, 'severity', 'warning', 'icon', 'wallet',
        'title', v_n || ' pago' || case when v_n = 1 then '' else 's' end || ' a proveedores esta semana',
        'body', 'Vencen en los próximos 7 días: $' || to_char(v_total, 'FM999G999G999G999'), 'href', '/dashboard/inventario', 'count', v_n));
    end if;
  end if;

  if v_inventory then
    for r in
      select w.id, w.name, count(*) as n
      from public.erp_stock_levels l
      join public.erp_warehouses w on w.id = l.warehouse_id and w.active
      join public.products p on p.id = l.product_id and p.active
      where l.store_id = p_store and l.qty <= 0 and (v_point is null or w.id = v_point)
      group by w.id, w.name
      order by count(*) desc
      limit 6
    loop
      v := v || jsonb_build_array(jsonb_build_object('key', 'out-' || r.id || '-' || r.n, 'severity', 'warning', 'icon', 'box',
        'title', r.name || ': ' || r.n || ' producto' || case when r.n = 1 then '' else 's' end || ' agotado' || case when r.n = 1 then '' else 's' end,
        'body', 'Haz un traslado o un ingreso de factura para reponerlos.', 'href', '/dashboard/inventario', 'count', r.n));
    end loop;

    select count(*) into v_n
    from public.erp_stock_levels l join public.products p on p.id = l.product_id and p.active
    where l.store_id = p_store and l.qty between 1 and 5 and (v_point is null or l.warehouse_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'low-' || current_date || '-' || v_n, 'severity', 'info', 'icon', 'trending-down',
        'title', v_n || ' producto' || case when v_n = 1 then '' else 's' end || ' con pocas unidades',
        'body', 'Quedan 5 unidades o menos. Revisa Existencias.', 'href', '/dashboard/inventario', 'count', v_n));
    end if;

    select count(*) into v_n from public.erp_transfers
    where store_id = p_store and status = 'in_transit' and created_at < now() - interval '48 hours'
      and (v_point is null or v_point in (from_warehouse_id, to_warehouse_id));
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'transfers-late-' || v_n, 'severity', 'serious', 'icon', 'truck',
        'title', v_n || ' traslado' || case when v_n = 1 then '' else 's' end || ' lleva' || case when v_n = 1 then '' else 'n' end || ' más de 2 días en tránsito',
        'body', 'Revisa el enlace de seguimiento para ver quién falta por firmar.', 'href', '/dashboard/inventario', 'count', v_n));
    end if;
  end if;

  if v_orders then
    select count(*) into v_n
    from public.orders o left join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('draft', 'sent')
      and o.created_at between now() - interval '30 days' and now() - interval '24 hours'
      and (v_point is null or m.point_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'orders-pending-' || current_date || '-' || v_n, 'severity', 'warning', 'icon', 'receipt',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' sin confirmar hace más de un día',
        'body', 'Confírmalos o anúlalos para mantener el inventario al día.', 'href', '/dashboard/pedidos', 'count', v_n));
    end if;

    select count(*), coalesce(sum(o.total), 0) into v_n, v_total
    from public.store_catalog_orders co join public.orders o on o.id = co.order_id
    left join public.erp_order_meta m on m.order_id = o.id
    where co.store_id = p_store and co.created_at > now() - interval '24 hours'
      and (v_point is null or m.point_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'catalog-orders-' || current_date || '-' || v_n, 'severity', 'good', 'icon', 'shopping-bag',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' nuevo' || case when v_n = 1 then '' else 's' end || ' desde tus catálogos',
        'body', 'En las últimas 24 horas por $' || to_char(v_total, 'FM999G999G999G999') || '.', 'href', '/dashboard/pedidos', 'count', v_n));
    end if;
  end if;

  if v_audit and v_point is null then
    select count(*) into v_n from public.products where store_id = p_store and active and coalesce(cost_price, 0) <= 0;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'no-cost-' || v_n, 'severity', 'info', 'icon', 'tag',
        'title', v_n || ' producto' || case when v_n = 1 then '' else 's' end || ' sin costo',
        'body', 'Agrega el costo en Productos para calcular bien la ganancia.', 'href', '/dashboard/products', 'count', v_n));
    end if;
  end if;

  if v_recv then
    select count(*), coalesce(sum(balance), 0) into v_n, v_total from public.erp_receivables
    where store_id = p_store and status = 'open' and due_date < current_date and (v_point is null or point_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'receivables-overdue-' || current_date || '-' || v_n, 'severity', 'critical', 'icon', 'wallet',
        'title', v_n || ' factura' || case when v_n = 1 then '' else 's' end || ' de clientes vencida' || case when v_n = 1 then '' else 's' end,
        'body', 'Cartera vencida por $' || to_char(v_total, 'FM999G999G999G999') || '. Revisa y cobra en Terceros y cartera.',
        'href', '/dashboard/clientes?tab=cartera', 'count', v_n));
    end if;
    select count(*), coalesce(sum(balance), 0) into v_n, v_total from public.erp_receivables
    where store_id = p_store and status = 'open' and due_date between current_date and current_date + 3 and (v_point is null or point_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'receivables-soon-' || current_date || '-' || v_n, 'severity', 'warning', 'icon', 'calendar',
        'title', v_n || ' cobro' || case when v_n = 1 then '' else 's' end || ' vence' || case when v_n = 1 then '' else 'n' end || ' en los próximos 3 días',
        'body', 'Por $' || to_char(v_total, 'FM999G999G999G999') || '. Un recordatorio a tiempo evita la mora.',
        'href', '/dashboard/clientes?tab=cartera', 'count', v_n));
    end if;
    select count(*) into v_n from (
      select c.id from public.billing_customers c join public.erp_receivables rc on rc.customer_id = c.id and rc.status = 'open'
      where c.store_id = p_store and c.credit_enabled
      group by c.id having sum(rc.balance) > max(c.credit_limit)) x;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'credit-over-' || current_date || '-' || v_n, 'severity', 'serious', 'icon', 'wallet',
        'title', v_n || ' cliente' || case when v_n = 1 then '' else 's' end || ' sobre su cupo de crédito',
        'body', 'Su deuda supera el cupo aprobado. Revisa antes de venderles a crédito.',
        'href', '/dashboard/clientes?tab=cartera', 'count', v_n));
    end if;
  end if;

  if v_sr then
    select count(*), count(*) filter (where sr.priority = 'urgent') into v_n, v_days from public.erp_stock_requests sr
    where sr.store_id = p_store and sr.status = 'pending'
      and (public.erp__sr_access_old(sr.store_id, sr.from_point_id, sr.to_point_id)->>'attend')::boolean;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'stock-req-pending-' || v_n || '-' || (select max(number) from public.erp_stock_requests where store_id = p_store),
        'severity', 'critical', 'icon', 'truck',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' interno' || case when v_n = 1 then '' else 's' end || ' por atender'
          || case when v_days > 0 then ' (' || v_days || ' urgente' || case when v_days = 1 then '' else 's' end || ')' else '' end,
        'body', 'Otro punto necesita mercancía. Revisa existencias y prepáralo.', 'href', '/dashboard/pedidos?tab=internos', 'count', v_n));
    end if;
    select count(*) into v_n from public.erp_stock_requests sr
    where sr.store_id = p_store and sr.status = 'dispatched'
      and (public.erp__sr_access_old(sr.store_id, sr.from_point_id, sr.to_point_id)->>'request')::boolean;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'stock-req-arriving-' || v_n, 'severity', 'serious', 'icon', 'truck',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' interno' || case when v_n = 1 then '' else 's' end || ' en camino a tu punto',
        'body', 'Cuando llegue la mercancía, confirma lo recibido.', 'href', '/dashboard/pedidos?tab=internos', 'count', v_n));
    end if;
    select count(distinct m.request_id) into v_n
    from public.erp_stock_request_messages m join public.erp_stock_requests sr on sr.id = m.request_id
    where sr.store_id = p_store and sr.status in ('pending', 'preparing', 'dispatched') and m.user_id is distinct from auth.uid()
      and m.created_at > coalesce((select rd.last_read_at from public.erp_stock_request_reads rd where rd.request_id = sr.id and rd.user_id = auth.uid()), '-infinity')
      and public.erp_sr_can_view_old(sr.id);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'stock-req-msg-' || v_n || '-' || now()::date, 'severity', 'warning', 'icon', 'receipt',
        'title', 'Mensajes nuevos en ' || v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' interno' || case when v_n = 1 then '' else 's' end,
        'body', 'Te escribieron en el chat del pedido.', 'href', '/dashboard/pedidos?tab=internos', 'count', v_n));
    end if;
  end if;

  return v;
end;
$function$;

-- erp_stock_browse
CREATE OR REPLACE FUNCTION public.erp_stock_browse_old(p_store uuid, p_q text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_warehouse uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_low integer DEFAULT 5, p_cost text DEFAULT 'all'::text, p_active text DEFAULT 'active'::text, p_sort text DEFAULT 'name'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
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
    select p.id, p.name, p.sku, p.barcode, p.image_url, p.category_id, (case when public.erp_can(p_store, 'costs_view') then coalesce(p.cost_price, 0) else 0 end)::numeric as cost, p.created_at, p.active,
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
    'value', case when public.erp_can(p_store, 'costs_view') then coalesce((select sum(greatest(qty, 0) * cost) from filtered), 0) end,
    'negative', coalesce((select count(*) from filtered where qty < 0), 0),
    'out', coalesce((select count(*) from filtered where qty = 0), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'name', pg.name, 'sku', pg.sku, 'barcode', pg.barcode, 'image_url', pg.image_url, 'active', pg.active,
        'category', (select c.name from public.product_categories c where c.id = pg.category_id),
        'cost_price', case when public.erp_can(p_store, 'costs_view') then pg.cost end, 'total', pg.total_qty, 'qty', pg.qty,
        'levels', coalesce((select jsonb_object_agg(l.warehouse_id::text, l.qty) from public.erp_stock_levels l
                            where l.product_id = pg.id and (v_pt is null or l.warehouse_id = v_pt)), '{}'::jsonb))
      order by pg.rn) from page pg), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

-- catalog_admin_summary
CREATE OR REPLACE FUNCTION public.catalog_admin_summary_old(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not (public.erp_can_any(p_store, array['products', 'catalogs']::text[]) or public.erp_can(p_store, 'audit')) then
    raise exception 'Necesitas el permiso de Productos.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'catalog_id', c.id,
    'products', (select count(*) from public.catalog__items_old(c.id) i where not i.category_hidden and i.price > 0),
    'available', (select count(*) from public.catalog__items_old(c.id) i where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)),
    'without_price', (select count(*) from public.catalog__items_old(c.id) i where coalesce(i.price, 0) <= 0),
    'orders_30d', (select count(*) from public.store_catalog_orders co where co.catalog_id = c.id and co.created_at > now() - interval '30 days')
  )), '[]'::jsonb)
  into v
  from public.store_catalogs c where c.store_id = p_store;
  return v;
end;
$function$;

-- erp_product_finder
CREATE OR REPLACE FUNCTION public.erp_product_finder_old(p_store uuid, p_q text, p_active_only boolean DEFAULT false, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v jsonb;
begin
  if not public.product__can_index(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para buscar productos.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) - 'rank' order by t.rank desc, t.name), '[]'::jsonb) into v
  from (
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active,
           p.price_1, p.price_3, p.stock, public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_q) as rank
    from public.products p
    where p.store_id = p_store
      and (not coalesce(p_active_only, false) or coalesce(p.active, true))
      and cardinality(public.product__tokens(p_q)) > 0
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, public.product__blob(p.description, p.product_details), p_q)
    order by rank desc, p.name
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
  ) t;
  return jsonb_build_object('ok', true, 'items', v);
end;
$function$;

-- catalog__items
CREATE OR REPLACE FUNCTION public.catalog__items_old(p_catalog uuid, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.product_id, r.category_key,
         case when o.v is not null and o.v > 0 and o.v < r.price then o.v else r.price end,
         r.base_price, r.stock,
         r.featured or coalesce(f.featured, false)
           or exists (select 1 from public.erp_product_badges b where b.product_id = r.product_id and b.kind = 'featured'
                        and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())),
         r.sort_order, r.category_hidden
  from public.catalog__items_raw(p_catalog, p_ids) r
  join public.store_catalogs c on c.id = p_catalog
  join public.products p on p.id = r.product_id
  left join public.erp_product_offers f on f.product_id = r.product_id
  left join lateral (
    select case when to_regclass('public.erp_promotions') is null or coalesce(r.price, 0) <= 0 then null
                else public.catalog__promo_price(c.store_id, c.point_id, r.product_id, p.category_id, r.price) end as v
  ) o on true;
$function$;

-- store_public_offers
CREATE OR REPLACE FUNCTION public.store_public_offers_old(p_store text, p_catalog text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_catalog uuid;
begin
  begin
    v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  exception when others then
    v_catalog := null;
  end;
  if v_catalog is null then return jsonb_build_object('items', '[]'::jsonb); end if;
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', x.product_id, 'now', x.price, 'before', x.before,
             'pct', case when x.before is not null and x.before > 0 then round(100 * (1 - x.price / x.before)) end,
             'ends_at', x.ends_at, 'label', x.label, 'featured', x.featured,
             'badges', to_jsonb(array_remove(array[
                 case when x.is_new then 'new' end,
                 case when x.drop_ok then 'price_drop' end,
                 case when x.is_promo then 'promo' end,
                 case when x.is_featured then 'featured' end], null)),
             'promo_text', x.promo_text)
           order by (x.before is not null) desc, x.featured desc), '[]'::jsonb)
    from (
      select i.product_id, i.price,
             -- Oferta de verdad (20261309) primero; si no, el «antes» escrito en «Bajó de precio».
             case when i.price < r.price then r.price when bd.before_price > i.price then bd.before_price end as before,
             case when i.price < r.price then (
               select min(pr.ends_at) from public.erp_promotions pr
               where pr.store_id = c.store_id and pr.active and now() between pr.starts_at and pr.ends_at and pr.ends_at < '2099-01-01'
                 and pr.scope = 'product' and i.product_id = any (pr.product_ids))
               when bd.before_price > i.price then (
               select b.ends_at from public.erp_product_badges b where b.product_id = i.product_id and b.kind = 'price_drop') end as ends_at,
             case when i.price < r.price then f.label
                  when bd.before_price > i.price then coalesce(nullif(f.label, ''), 'Bajó de precio')
                  else f.label end as label,
             coalesce(f.featured, false) or i.featured as featured,
             bd.is_new, coalesce(bd.before_price > i.price and not (i.price < r.price), false) as drop_ok, bd.is_promo, bd.promo_text,
             bd.is_featured, bd.any_on, r.price as raw_price
      from public.catalog__items_old(v_catalog) i
      join public.catalog__items_raw(v_catalog) r on r.product_id = i.product_id
      join public.store_catalogs c on c.id = v_catalog
      left join public.erp_product_offers f on f.product_id = i.product_id
      cross join lateral public.erp__badges_now(i.product_id) bd
      where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
        and (i.price < r.price or coalesce(f.featured, false) or nullif(f.label, '') is not null or bd.any_on)
    ) x));
end;
$function$;

-- erp_order_alerts
CREATE OR REPLACE FUNCTION public.erp_order_alerts_old(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out jsonb := '[]'::jsonb;
  c_conf integer; c_conf_old integer; t_conf numeric;
  c_comp integer; c_comp_old integer; t_comp numeric;
  fmt text;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['orders', 'pos']::text[]) then
    return '[]'::jsonb;
  end if;

  select count(*) filter (where o.status in ('draft', 'sent')),
         count(*) filter (where o.status in ('draft', 'sent') and o.created_at < now() - interval '24 hours'),
         coalesce(sum(o.total) filter (where o.status in ('draft', 'sent')), 0),
         count(*) filter (where o.status = 'confirmed'),
         count(*) filter (where o.status = 'confirmed' and coalesce(o.confirmed_at, o.created_at) < now() - interval '24 hours'),
         coalesce(sum(o.total) filter (where o.status = 'confirmed'), 0)
    into c_conf, c_conf_old, t_conf, c_comp, c_comp_old, t_comp
  from public.orders o
  where o.store_id = p_store
    and o.status in ('draft', 'sent', 'confirmed')
    and o.created_at > now() - interval '60 days'
    and public.erp__order_visible(p_store, o.id);

  if c_conf > 0 then
    fmt := '$' || replace(to_char(round(t_conf), 'FM999,999,999,990'), ',', '.');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'orders-to-confirm-' || c_conf,
      'severity', case when c_conf_old > 0 then 'warning' else 'info' end,
      'icon', 'receipt',
      'count', c_conf,
      'title', c_conf || ' pedido' || case when c_conf = 1 then '' else 's' end || ' sin confirmar',
      'body', fmt || case when c_conf_old > 0 then ' · ' || c_conf_old || ' lleva' || case when c_conf_old = 1 then '' else 'n' end || ' más de un día. ' else '. ' end
              || 'Confírmalos o anúlalos para mantener el inventario al día.',
      'href', '/dashboard/pedidos?ver=to_confirm'));
  end if;

  if c_comp > 0 then
    fmt := '$' || replace(to_char(round(t_comp), 'FM999,999,999,990'), ',', '.');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'orders-to-complete-' || c_comp,
      'severity', case when c_comp_old > 0 then 'warning' else 'info' end,
      'icon', 'shopping-bag',
      'count', c_comp,
      'title', c_comp || ' pedido' || case when c_comp = 1 then '' else 's' end || ' sin completar',
      'body', fmt || case when c_comp_old > 0 then ' · ' || c_comp_old || ' confirmado' || case when c_comp_old = 1 then '' else 's' end || ' hace más de un día. ' else '. ' end
              || 'Márcalos como completados cuando se entreguen.',
      'href', '/dashboard/pedidos?ver=to_complete'));
  end if;

  return v_out;
end;
$function$;

-- erp_offline_alerts
CREATE OR REPLACE FUNCTION public.erp_offline_alerts_old(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_fiscal boolean;
  v_pos boolean;
  v_n integer;
  v_hours numeric;
  v_issues integer;
  v_issues_c integer;
  r record;
begin
  if not public.erp__is_member(p_store) then return '[]'::jsonb; end if;
  v_fiscal := public.erp_can_any(p_store, public.fiscal__view_perms());
  v_pos := public.erp_can(p_store, 'pos');

  if v_fiscal or v_pos then
    select count(*), min(extract(epoch from (d.created_at + interval '48 hours' - now())) / 3600) into v_n, v_hours
    from public.fiscal_documents d
    where d.store_id = p_store and d.document_type = 'contingency_invoice'
      and d.status not in ('ACCEPTED', 'VOID', 'CANCELLED', 'CANCEL_PENDING')
      and public.erp_point_allowed(p_store, d.point_id);
    if v_n > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-contingency-pending',
        'severity', case when v_hours < 12 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_n,
        'title', v_n || case when v_n = 1 then ' factura de contingencia sin aceptar' else ' facturas de contingencia sin aceptar' end,
        'body', case when v_hours <= 0 then 'Ya pasó el plazo de 48 horas de la DIAN: revísalas ya en el Centro fiscal.'
                     else 'Quedan ' || greatest(floor(v_hours)::integer, 0) || ' horas del plazo de la DIAN. Revísalas en el Centro fiscal.' end,
        'href', '/dashboard/fiscal?tab=contingencias'));
    end if;
  end if;

  if v_pos then
    select count(*), count(*) filter (where i.kind = 'contingencia') into v_issues, v_issues_c
    from public.erp_pos_offline_issues i
    where i.store_id = p_store and i.resolved_at is null and public.erp_point_allowed(p_store, i.point_id);
    if v_issues > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-sale-issues',
        'severity', case when v_issues_c > 0 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_issues,
        'title', v_issues || case when v_issues = 1 then ' venta sin conexión por revisar' else ' ventas sin conexión por revisar' end,
        'body', case when v_issues_c > 0 then 'Hay facturas de contingencia entregadas en papel que aún no quedan registradas. Ábrelas en el POS.'
                     else 'No se pudieron registrar solas (inventario, precio o permisos). Ábrelas en el POS.' end,
        'href', '/dashboard/pos'));
    end if;
  end if;

  if v_fiscal then
    for r in
      select w.id, w.name
      from public.fiscal_point_configs c
      join public.erp_warehouses w on w.id = c.point_id
      join public.erp_org_settings os on os.store_id = c.store_id and os.fiscal_enabled
      where c.store_id = p_store and c.enabled and public.erp_point_allowed(p_store, c.point_id)
        and public.fiscal__pick_range(c.point_id, c.fiscal_entity_id, 'contingency_invoice', c.environment) is null
      order by w.name
      limit 5
    loop
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'fiscal-no-contingency-' || r.id, 'severity', 'warning', 'icon', 'hash',
        'title', 'Sin numeración de contingencia: ' || r.name,
        'body', 'Si se cae el internet no podrás facturar en papel. Pídela a la DIAN y cárgala en Centro fiscal → Numeración.',
        'href', '/dashboard/fiscal?tab=numeracion'));
    end loop;
  end if;

  return v_out;
end;
$function$;


-- ===== Ayudantes de producción que no cambian (los usan ambas versiones en la prueba) =====

-- catalog__items_raw
CREATE OR REPLACE FUNCTION public.catalog__items_raw(p_catalog uuid, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.id,
    coalesce(cp.catalog_category_id, ccat.id, p.category_id),
    case
      when cp.price_override is not null then cp.price_override
      when coalesce(case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end, 0) > 0
        then case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
      when c.fallback_price_level is not null
        then case when r.id is null then public.catalog__price(p, c.fallback_price_level) else public.erp__point_price(p, c.fallback_price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
      else case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
    end,
    case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end,
    case
      when c.point_id is not null then greatest(coalesce(sl.qty, 0), 0)
      when p.stock is null then null
      else p.stock
    end,
    coalesce(cp.featured, false),
    coalesce(cp.sort_order, 0),
    coalesce(not ecat.visible, false)
  from public.store_catalogs c
  join public.products p on p.store_id = c.store_id and p.active
  left join public.store_catalog_products cp on cp.catalog_id = c.id and cp.product_id = p.id
  left join public.store_catalog_categories ccat on ccat.catalog_id = c.id and ccat.category_id = p.category_id
  left join public.store_catalog_categories ecat on ecat.id = coalesce(cp.catalog_category_id, ccat.id)
  left join public.erp_stock_levels sl on c.point_id is not null and sl.warehouse_id = c.point_id and sl.product_id = p.id
  left join public.erp_profit_settings s on s.store_id = c.store_id
  left join lateral (
    select x.* from public.erp__rule_for(c.store_id, c.point_id, p.id) x
    where c.point_id is not null
      and exists (select 1 from public.erp_price_rules pr where pr.store_id = c.store_id and pr.point_id = c.point_id and pr.status = 'active')
  ) r on true
  where c.id = p_catalog
    and (p_ids is null or p.id = any (p_ids))
    and case when c.include_all_products then coalesce(cp.included, true) else coalesce(cp.included, false) end;
$function$;

-- erp__norm_text
CREATE OR REPLACE FUNCTION public.erp__norm_text(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select translate(lower(coalesce(p, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou');
$function$;

-- product__tokens
CREATE OR REPLACE FUNCTION public.product__tokens(p_q text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(array(
    select t from unnest(regexp_split_to_array(public.erp__norm_text(btrim(coalesce(p_q, ''))), '\s+')) as t where t <> ''
  ), '{}'::text[]);
$function$;

-- product__code_key
CREATE OR REPLACE FUNCTION public.product__code_key(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select regexp_replace(regexp_replace(public.erp__norm_text(btrim(coalesce(p, ''))), '^#+', ''), '\s+', '', 'g');
$function$;

-- product__code_hit
CREATE OR REPLACE FUNCTION public.product__code_hit(p_sku text, p_barcode text, p_no integer, p_code text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(p_code, '') <> ''
    and (public.product__code_key(p_sku) = p_code or p_no::text = p_code or public.product__code_key(p_barcode) = p_code);
$function$;

-- product__haystack
CREATE OR REPLACE FUNCTION public.product__haystack(p_name text, p_sku text, p_barcode text, p_extra text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select public.erp__norm_text(concat_ws(' ', p_name, p_sku, p_barcode, p_extra));
$function$;

-- product__has_tokens
CREATE OR REPLACE FUNCTION public.product__has_tokens(p_text text, p_tokens text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select not exists (select 1 from unnest(coalesce(p_tokens, '{}'::text[])) as t where strpos(coalesce(p_text, ''), t) = 0);
$function$;

-- product__fuzzy
CREATE OR REPLACE FUNCTION public.product__fuzzy(p_q text, p_text text)
 RETURNS real
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$ select word_similarity(coalesce(p_q, ''), coalesce(p_text, '')) $function$;

-- product__matches
CREATE OR REPLACE FUNCTION public.product__matches(p_name text, p_sku text, p_barcode text, p_no integer, p_extra text, p_q text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select cardinality(public.product__tokens(p_q)) = 0
    or public.product__code_hit(p_sku, p_barcode, p_no, public.product__code_key(p_q))
    or public.product__has_tokens(public.product__haystack(p_name, p_sku, p_barcode, p_extra), public.product__tokens(p_q))
    or (length(public.erp__norm_text(btrim(coalesce(p_q, '')))) >= 4
        and public.product__fuzzy(public.erp__norm_text(btrim(p_q)), public.erp__norm_text(p_name)) >= 0.5);
$function$;

-- product__rank
CREATE OR REPLACE FUNCTION public.product__rank(p_name text, p_sku text, p_barcode text, p_no integer, p_q text)
 RETURNS real
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select case
    when cardinality(public.product__tokens(p_q)) = 0 then 0
    when public.product__code_hit(p_sku, p_barcode, p_no, public.product__code_key(p_q)) then 100
    when public.erp__norm_text(p_name) = public.erp__norm_text(btrim(p_q)) then 90
    when public.erp__norm_text(p_name) like public.erp__norm_text(btrim(p_q)) || '%' then 70
    when public.product__has_tokens(public.erp__norm_text(p_name), public.product__tokens(p_q)) then 50
    when public.product__has_tokens(public.product__haystack(p_name, p_sku, p_barcode, null), public.product__tokens(p_q)) then 40
    else 10 + 20 * public.product__fuzzy(public.erp__norm_text(btrim(p_q)), public.erp__norm_text(p_name))
  end::real;
$function$;

-- product__blob
CREATE OR REPLACE FUNCTION public.product__blob(p_description text, p_details jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select public.erp__norm_text(concat_ws(' ',
    p_description,
    case when jsonb_typeof(p_details) = 'object' then p_details ->> 'long_description' end,
    case when jsonb_typeof(p_details -> 'highlights') = 'array'
      then (select string_agg(x, ' ') from jsonb_array_elements_text(p_details -> 'highlights') as x) end,
    case when jsonb_typeof(p_details -> 'specifications') = 'array'
      then (select string_agg(concat_ws(' ', s ->> 'name', s ->> 'value'), ' ') from jsonb_array_elements(p_details -> 'specifications') as s) end
  ));
$function$;

-- product__can_index
CREATE OR REPLACE FUNCTION public.product__can_index(p_store uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.erp_can_any(p_store, array['products', 'products_view', 'inventory', 'purchases', 'pos', 'stock_requests', 'stock_requests_manage', 'transfers']::text[]);
$function$;

-- erp__in_category
CREATE OR REPLACE FUNCTION public.erp__in_category(p_product uuid, p_primary uuid, p_category uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        select p_category is null or p_primary = p_category
          or exists (select 1 from public.product_category_links l where l.product_id = p_product and l.category_id = p_category);
      $function$;

-- rh_norm
CREATE OR REPLACE FUNCTION public.rh_norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÄÂÃÅáàäâãåÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')), '[^a-z0-9]+', ' ', 'g'));
$function$;

-- rh_tokens
CREATE OR REPLACE FUNCTION public.rh_tokens(p text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  with words as (
    select w, min(ord) as o
    from regexp_split_to_table(public.rh_norm(p), ' ') with ordinality as x(w, ord)
    where w <> ''
    group by w
  ),
  useful as (
    select w, o from words where length(w) > 1 or w ~ '^[0-9]$'
  ),
  chosen as (
    select w, o from useful
    union all
    select w, o from words where not exists (select 1 from useful)
  )
  select coalesce((select array_agg(w order by o) from (select w, o from chosen order by o limit 8) z), '{}'::text[]);
$function$;

-- rh_score
CREATE OR REPLACE FUNCTION public.rh_score(p_hay text, p_tokens text[], p_phrase text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
      with t as (
        select case
          when p_hay ~ ('(^| )' || tok) then 1.0
          when strpos(p_hay, tok) > 0 then 0.75
          when length(tok) >= 4 and strpos(p_hay, public.rh_stem(tok)) > 0 then 0.6
          -- Palabra partida con espacios: "agua cate" ≈ "aguacate".
          when length(tok) >= 4 and strpos(replace(p_hay, ' ', ''), tok) > 0 then 0.55
          when length(tok) >= 4 and exists (
         with a as (select string_to_array(p_hay, ' ') as w),
              cand as (
                select x as w from a, unnest(a.w) x
                union all select a.w[i] || a.w[i + 1] from a, generate_series(1, cardinality(a.w) - 1) i
                union all select a.w[i] || a.w[i + 1] || a.w[i + 2] from a, generate_series(1, cardinality(a.w) - 2) i
              )
         select 1 from cand
         where length(cand.w) >= 3
           and (public.levenshtein_less_equal(tok, cand.w, case when length(tok) >= 7 then 2 else 1 end) <= case when length(tok) >= 7 then 2 else 1 end
                or (length(cand.w) > length(tok)
                    and public.levenshtein_less_equal(tok, left(cand.w, length(tok)), case when length(tok) >= 7 then 2 else 1 end) <= case when length(tok) >= 7 then 2 else 1 end))
       ) then 0.45
          else 0 end::numeric as q
        from unnest(p_tokens) tok
      )
      select case when coalesce(cardinality(p_tokens), 0) = 0 then 0::numeric
        else (select count(*) filter (where q > 0) from t)::numeric
           + least(0.99, ((select coalesce(sum(q), 0) from t)
               + case when p_phrase is not null and length(p_phrase) > 2 and strpos(coalesce(p_hay, ''), p_phrase) > 0 then 1 else 0 end)
             / (cardinality(p_tokens) + 2))
      end;
    $function$;

-- erp_my_point
CREATE OR REPLACE FUNCTION public.erp_my_point(p_store uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select su.point_id
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    and su.role <> 'store_admin'
  limit 1;
$function$;

-- erp_my_points
CREATE OR REPLACE FUNCTION public.erp_my_points(p_store uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
           when su.point_id is null then null
           else array(select distinct x from unnest(array_cat(array_prepend(su.point_id, coalesce(su.point_ids, '{}'::uuid[])),
                                                              coalesce(su.sell_point_ids, '{}'::uuid[]))) as x where x is not null)
         end
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active
    and su.role <> 'store_admin'
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    and not exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
  limit 1;
$function$;

-- erp__is_member
CREATE OR REPLACE FUNCTION public.erp__is_member(p_store uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and coalesce(su.active, true)))
$function$;

-- erp__order_visible
CREATE OR REPLACE FUNCTION public.erp__order_visible(p_store uuid, p_order uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if v is null then return true; end if;
  return exists (select 1 from public.erp_order_meta m where m.order_id = p_order and m.point_id = any (v))
      or exists (select 1 from public.store_catalog_orders co
                 join public.store_catalogs c on c.id = co.catalog_id
                 where co.order_id = p_order and c.point_id = any (v));
end;
$function$;

-- erp_point_allowed
CREATE OR REPLACE FUNCTION public.erp_point_allowed(p_store uuid, p_point uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if v is null then return true; end if;
  return p_point is not null and p_point = any (v);
end;
$function$;

-- erp__badges_now
CREATE OR REPLACE FUNCTION public.erp__badges_now(p_product uuid)
 RETURNS TABLE(is_new boolean, before_price numeric, is_promo boolean, promo_text text, is_featured boolean, any_on boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(bool_or(b.kind = 'new'), false),
         max(b.before_price) filter (where b.kind = 'price_drop'),
         coalesce(bool_or(b.kind = 'promo'), false),
         max(b.text) filter (where b.kind = 'promo'),
         coalesce(bool_or(b.kind = 'featured'), false),
         count(*) > 0
  from public.erp_product_badges b
  where b.product_id = p_product and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())
$function$;

