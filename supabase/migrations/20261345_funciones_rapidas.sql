-- =====================================================================
-- REMHUB · Funciones de la base más rápidas (mismos resultados) — consulta 5, 2026-11-26
--
-- Evidencia: consulta_rendimiento_4.sql (pg_stat_statements de producción) y el código que corre hoy
-- (consulta_rendimiento_5.sql). En todas el patrón es el mismo: algo que vale lo mismo para toda la
-- consulta (los permisos de quien pregunta, si la tienda tiene promociones) se volvía a calcular por cada
-- fila: por cada pedido, por cada mensaje o por cada producto de la tienda.
--
--   · Pedidos internos (erp_stock_requests_list 331 ms, erp_stock_inbox 91.842 llamadas, campana):
--     erp__sr_access hacía 1 + 4 revisiones de permiso (cada una con 3 consultas) POR PEDIDO, y la campana
--     lo repetía POR MENSAJE sin leer. Ahora los permisos se leen una vez (erp__sr_perms) y cada pedido
--     solo compara puntos (erp__sr_access_of, sin consultas). erp__sr_access queda igual por fuera.
--   · Existencias (erp_stock_browse 1,4 s): «¿puede ver costos?» se preguntaba por cada producto.
--   · Catálogos (catalog_admin_summary 0,85 s): armaba la lista de productos de cada catálogo 3 veces.
--   · Buscador del panel (erp_product_finder 0,64 s): partía el texto buscado por cada producto (lo mismo
--     que ya se arregló en 20261204 para los demás buscadores).
--   · Catálogo público (catalog__items, que usan catalog_public_products, catalog_public y
--     store_public_offers): buscaba promociones por cada producto aunque la tienda no tenga ninguna
--     vigente. Ahora pregunta una vez; si hay, sigue igual que antes. store_public_offers ya no llama una
--     función por producto para las etiquetas (misma consulta, escrita en línea).
--   · Campana de pedidos y de ventas sin conexión: el punto de quien pregunta se leía por cada fila.
--
-- Qué NO cambia: lo que devuelve cada función (las pruebas comparan con la versión de producción),
-- permisos, datos, RLS. Las funciones siguen siendo security definer con search_path = public.
-- Se puede correr varias veces. Para volver atrás: correr la versión anterior de cada función
-- (tests/sql/fixtures/prod_rendimiento_5.sql, con el nombre sin «_old»).
-- Pruebas: tests/sql/funciones_rapidas.test.mjs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pedidos internos: permisos una sola vez
-- ---------------------------------------------------------------------
-- Lo que no depende del pedido: punto de quien pregunta y sus permisos (una sola lectura).
create or replace function public.erp__sr_perms(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'pt', public.erp_my_point(p_store),
    'manage', public.erp_can(p_store, 'stock_requests_manage'),
    'transfers', public.erp_can(p_store, 'transfers'),
    'req', public.erp_can(p_store, 'stock_requests'),
    'audit', public.erp_can(p_store, 'audit'));
end;
$$;
revoke all on function public.erp__sr_perms(uuid) from public, anon, authenticated;

-- Lo que sí depende del pedido (sin consultas): las mismas reglas de erp__sr_access.
create or replace function public.erp__sr_access_of(p jsonb, p_from uuid, p_to uuid)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'attend', ((p->>'manage')::boolean or (p->>'transfers')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_to),
    'request', ((p->>'req')::boolean or (p->>'manage')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_from),
    'view', (((p->>'manage')::boolean or (p->>'transfers')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_to))
         or (((p->>'req')::boolean or (p->>'manage')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_from))
         or ((p->>'manage')::boolean and (p->>'pt') is null)
         or ((p->>'audit')::boolean and (p->>'pt') is null));
$$;
revoke all on function public.erp__sr_access_of(jsonb, uuid, uuid) from public, anon, authenticated;

-- Misma firma y mismo resultado; por dentro usa las dos de arriba.
create or replace function public.erp__sr_access(p_store uuid, p_from uuid, p_to uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  return public.erp__sr_access_of(public.erp__sr_perms(p_store), p_from, p_to);
end;
$function$;

create or replace function public.erp_stock_requests_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb; v_perms jsonb := public.erp__sr_perms(p_store);
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
    cross join lateral (select public.erp__sr_access_of(v_perms, r.from_point_id, r.to_point_id) as acc) a
    where r.store_id = p_store and (a.acc->>'view')::boolean
      and (r.status in ('pending', 'preparing', 'dispatched') or r.created_at > now() - interval '120 days')
    order by r.created_at desc
    limit 300
  ) s;
  return v;
end;
$function$;

create or replace function public.erp_stock_inbox(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb; v_perms jsonb := public.erp__sr_perms(p_store);
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
  cross join lateral (select public.erp__sr_access_of(v_perms, r.from_point_id, r.to_point_id) as acc) a
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

-- Campana: igual que en producción; solo cambia la parte de pedidos internos (permisos una vez).
create or replace function public.erp_alerts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_point uuid := public.erp_my_point(p_store);
  v_audit boolean := public.erp_can(p_store, 'audit');
  v_inventory boolean := v_audit or public.erp_can(p_store, 'inventory');
  v_orders boolean := v_audit or public.erp_can(p_store, 'orders');
  v_payables boolean := v_point is null and (v_audit or public.erp_can(p_store, 'payables'));
  v_recv boolean := v_audit or public.erp_can(p_store, 'receivables') or public.erp_can(p_store, 'credit');
  v_sr boolean := public.erp_can(p_store, 'stock_requests') or public.erp_can(p_store, 'stock_requests_manage') or public.erp_can(p_store, 'transfers');
  v_srp jsonb;
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
    v_srp := public.erp__sr_perms(p_store);
    select count(*), count(*) filter (where sr.priority = 'urgent') into v_n, v_days from public.erp_stock_requests sr
    where sr.store_id = p_store and sr.status = 'pending'
      and (public.erp__sr_access_of(v_srp, sr.from_point_id, sr.to_point_id)->>'attend')::boolean;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'stock-req-pending-' || v_n || '-' || (select max(number) from public.erp_stock_requests where store_id = p_store),
        'severity', 'critical', 'icon', 'truck',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' interno' || case when v_n = 1 then '' else 's' end || ' por atender'
          || case when v_days > 0 then ' (' || v_days || ' urgente' || case when v_days = 1 then '' else 's' end || ')' else '' end,
        'body', 'Otro punto necesita mercancía. Revisa existencias y prepáralo.', 'href', '/dashboard/pedidos?tab=internos', 'count', v_n));
    end if;
    select count(*) into v_n from public.erp_stock_requests sr
    where sr.store_id = p_store and sr.status = 'dispatched'
      and (public.erp__sr_access_of(v_srp, sr.from_point_id, sr.to_point_id)->>'request')::boolean;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'stock-req-arriving-' || v_n, 'severity', 'serious', 'icon', 'truck',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' interno' || case when v_n = 1 then '' else 's' end || ' en camino a tu punto',
        'body', 'Cuando llegue la mercancía, confirma lo recibido.', 'href', '/dashboard/pedidos?tab=internos', 'count', v_n));
    end if;
    -- Antes: erp_sr_can_view(sr.id) por cada mensaje (relee el pedido y todos los permisos). Es lo mismo:
    -- el pedido ya está en la consulta y es de esta tienda.
    select count(distinct m.request_id) into v_n
    from public.erp_stock_request_messages m join public.erp_stock_requests sr on sr.id = m.request_id
    where sr.store_id = p_store and sr.status in ('pending', 'preparing', 'dispatched') and m.user_id is distinct from auth.uid()
      and m.created_at > coalesce((select rd.last_read_at from public.erp_stock_request_reads rd where rd.request_id = sr.id and rd.user_id = auth.uid()), '-infinity')
      and coalesce((public.erp__sr_access_of(v_srp, sr.from_point_id, sr.to_point_id)->>'view')::boolean, false);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'stock-req-msg-' || v_n || '-' || now()::date, 'severity', 'warning', 'icon', 'receipt',
        'title', 'Mensajes nuevos en ' || v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' interno' || case when v_n = 1 then '' else 's' end,
        'body', 'Te escribieron en el chat del pedido.', 'href', '/dashboard/pedidos?tab=internos', 'count', v_n));
    end if;
  end if;

  return v;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. Existencias: «¿ve costos?» una vez y la categoría sin llamar una función por producto
-- ---------------------------------------------------------------------
create or replace function public.erp_stock_browse(p_store uuid, p_q text default null::text, p_category uuid default null::uuid,
  p_warehouse uuid default null::uuid, p_status text default 'all'::text, p_low integer default 5, p_cost text default 'all'::text,
  p_active text default 'active'::text, p_sort text default 'name'::text, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_pt uuid := public.erp_my_point(p_store);
  v_wh uuid;
  v_tokens text[] := public.rh_tokens(p_q);
  v_phrase text := public.rh_norm(p_q);
  v_low integer := greatest(coalesce(p_low, 5), 0);
  v_costs boolean;
  v jsonb;
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'products')) then
    raise exception 'No tienes permiso para ver existencias.';
  end if;
  v_costs := public.erp_can(p_store, 'costs_view');
  -- Un usuario de punto solo consulta su punto.
  v_wh := coalesce(v_pt, p_warehouse);

  with base as (
    select p.id, p.name, p.sku, p.barcode, p.image_url, p.category_id, (case when v_costs then coalesce(p.cost_price, 0) else 0 end)::numeric as cost, p.created_at, p.active,
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
      -- Igual que erp__in_category(p.id, p.category_id, p_category).
      and (p_category is null or p.category_id = p_category
           or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = p_category))
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
    'value', case when v_costs then coalesce((select sum(greatest(qty, 0) * cost) from filtered), 0) end,
    'negative', coalesce((select count(*) from filtered where qty < 0), 0),
    'out', coalesce((select count(*) from filtered where qty = 0), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'name', pg.name, 'sku', pg.sku, 'barcode', pg.barcode, 'image_url', pg.image_url, 'active', pg.active,
        'category', (select c.name from public.product_categories c where c.id = pg.category_id),
        'cost_price', case when v_costs then pg.cost end, 'total', pg.total_qty, 'qty', pg.qty,
        'levels', coalesce((select jsonb_object_agg(l.warehouse_id::text, l.qty) from public.erp_stock_levels l
                            where l.product_id = pg.id and (v_pt is null or l.warehouse_id = v_pt)), '{}'::jsonb))
      order by pg.rn) from page pg), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Catálogos (panel): la lista de cada catálogo se arma una vez, no tres
-- ---------------------------------------------------------------------
create or replace function public.catalog_admin_summary(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  if not (public.erp_can_any(p_store, array['products', 'catalogs']::text[]) or public.erp_can(p_store, 'audit')) then
    raise exception 'Necesitas el permiso de Productos.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'catalog_id', c.id,
    'products', k.products,
    'available', k.available,
    'without_price', k.without_price,
    'orders_30d', (select count(*) from public.store_catalog_orders co where co.catalog_id = c.id and co.created_at > now() - interval '30 days')
  )), '[]'::jsonb)
  into v
  from public.store_catalogs c
  cross join lateral (
    select count(*) filter (where not i.category_hidden and i.price > 0) as products,
           count(*) filter (where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)) as available,
           count(*) filter (where coalesce(i.price, 0) <= 0) as without_price
    from public.catalog__items(c.id) i
  ) k
  where c.store_id = p_store;
  return v;
end;
$function$;

-- ---------------------------------------------------------------------
-- 4. Buscador del panel: el texto se prepara una vez (como 20261204)
-- ---------------------------------------------------------------------
create or replace function public.erp_product_finder(p_store uuid, p_q text, p_active_only boolean default false, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $function$
declare v jsonb;
begin
  if not public.product__can_index(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para buscar productos.');
  end if;
  with q as materialized (
    select public.product__tokens(p_q) as tokens, public.product__code_key(p_q) as code,
           public.erp__norm_text(btrim(coalesce(p_q, ''))) as norm
  )
  select coalesce(jsonb_agg(to_jsonb(t) - 'rank' order by t.rank desc, t.name), '[]'::jsonb) into v
  from (
    -- Mismas reglas que product__rank y product__matches (con la descripción y la ficha como texto extra).
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active,
           p.price_1, p.price_3, p.stock,
           (case
              when public.product__code_hit(p.sku, p.barcode, p.product_no, q.code) then 100
              when public.erp__norm_text(p.name) = q.norm then 90
              when public.erp__norm_text(p.name) like q.norm || '%' then 70
              when public.product__has_tokens(public.erp__norm_text(p.name), q.tokens) then 50
              when public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens) then 40
              else 10 + 20 * public.product__fuzzy(q.norm, public.erp__norm_text(p.name))
            end)::real as rank
    from q
    cross join public.products p
    where p.store_id = p_store
      and (not coalesce(p_active_only, false) or coalesce(p.active, true))
      and cardinality(q.tokens) > 0
      and (public.product__code_hit(p.sku, p.barcode, p.product_no, q.code)
           or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, public.product__blob(p.description, p.product_details)), q.tokens)
           or (length(q.norm) >= 4 and public.product__fuzzy(q.norm, public.erp__norm_text(p.name)) >= 0.5))
    order by rank desc, p.name
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
  ) t;
  return jsonb_build_object('ok', true, 'items', v);
end;
$function$;

-- ---------------------------------------------------------------------
-- 5. Catálogo público: promociones solo si la tienda tiene alguna vigente
-- ---------------------------------------------------------------------
-- catalog__promo_price devuelve null cuando la tienda no tiene promociones activas hoy; ahora eso se
-- pregunta una vez por catálogo (offset 0: se calcula una sola vez) y no por cada producto.
create or replace function public.catalog__items(p_catalog uuid, p_ids uuid[] default null::uuid[])
returns table(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
language sql stable security definer set search_path to 'public' as $function$
  select r.product_id, r.category_key,
         case when o.v is not null and o.v > 0 and o.v < r.price then o.v else r.price end,
         r.base_price, r.stock,
         r.featured or coalesce(f.featured, false)
           or exists (select 1 from public.erp_product_badges b where b.product_id = r.product_id and b.kind = 'featured'
                        and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())),
         r.sort_order, r.category_hidden
  from public.catalog__items_raw(p_catalog, p_ids) r
  join (
    select c.id, c.store_id, c.point_id,
           to_regclass('public.erp_promotions') is not null
             and exists (select 1 from public.erp_promotions pr
                         where pr.store_id = c.store_id and pr.active and now() between pr.starts_at and pr.ends_at) as has_promo
    from public.store_catalogs c where c.id = p_catalog
    offset 0
  ) c on true
  join public.products p on p.id = r.product_id
  left join public.erp_product_offers f on f.product_id = r.product_id
  left join lateral (
    select case when not c.has_promo or coalesce(r.price, 0) <= 0 then null
                else public.catalog__promo_price(c.store_id, c.point_id, r.product_id, p.category_id, r.price) end as v
  ) o on true;
$function$;

-- Ofertas del catálogo: igual que en producción; las etiquetas vigentes se leen en la misma consulta
-- (antes, una llamada a erp__badges_now por producto). Mismo cálculo que erp__badges_now.
create or replace function public.store_public_offers(p_store text, p_catalog text, p_key text default null::text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
      from public.catalog__items(v_catalog) i
      join public.catalog__items_raw(v_catalog) r on r.product_id = i.product_id
      join public.store_catalogs c on c.id = v_catalog
      left join public.erp_product_offers f on f.product_id = i.product_id
      cross join lateral (
        select coalesce(bool_or(b.kind = 'new'), false) as is_new,
               max(b.before_price) filter (where b.kind = 'price_drop') as before_price,
               coalesce(bool_or(b.kind = 'promo'), false) as is_promo,
               max(b.text) filter (where b.kind = 'promo') as promo_text,
               coalesce(bool_or(b.kind = 'featured'), false) as is_featured,
               count(*) > 0 as any_on
        from public.erp_product_badges b
        where b.product_id = i.product_id and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())
      ) bd
      where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
        and (i.price < r.price or coalesce(f.featured, false) or nullif(f.label, '') is not null or bd.any_on)
    ) x));
end;
$function$;

-- ---------------------------------------------------------------------
-- 6. Campana de pedidos y de ventas sin conexión: el punto de quien pregunta una vez
-- ---------------------------------------------------------------------
create or replace function public.erp_order_alerts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_out jsonb := '[]'::jsonb;
  c_conf integer; c_conf_old integer; t_conf numeric;
  c_comp integer; c_comp_old integer; t_comp numeric;
  fmt text;
  v_pts uuid[];
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['orders', 'pos']::text[]) then
    return '[]'::jsonb;
  end if;
  v_pts := public.erp_my_points(p_store);

  -- Igual que erp__order_visible(p_store, o.id), con los puntos leídos una vez.
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
    and (v_pts is null
         or exists (select 1 from public.erp_order_meta m where m.order_id = o.id and m.point_id = any (v_pts))
         or exists (select 1 from public.store_catalog_orders co
                    join public.store_catalogs c on c.id = co.catalog_id
                    where co.order_id = o.id and c.point_id = any (v_pts)));

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

create or replace function public.erp_offline_alerts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_fiscal boolean;
  v_pos boolean;
  v_n integer;
  v_hours numeric;
  v_issues integer;
  v_issues_c integer;
  r record;
  v_pts uuid[];
begin
  if not public.erp__is_member(p_store) then return '[]'::jsonb; end if;
  v_fiscal := public.erp_can_any(p_store, public.fiscal__view_perms());
  v_pos := public.erp_can(p_store, 'pos');
  -- Igual que erp_point_allowed(p_store, x): null = todos los puntos; si no, x tiene que estar en la lista.
  v_pts := public.erp_my_points(p_store);

  if v_fiscal or v_pos then
    select count(*), min(extract(epoch from (d.created_at + interval '48 hours' - now())) / 3600) into v_n, v_hours
    from public.fiscal_documents d
    where d.store_id = p_store and d.document_type = 'contingency_invoice'
      and d.status not in ('ACCEPTED', 'VOID', 'CANCELLED', 'CANCEL_PENDING')
      and (v_pts is null or coalesce(d.point_id = any (v_pts), false));
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
    where i.store_id = p_store and i.resolved_at is null and (v_pts is null or coalesce(i.point_id = any (v_pts), false));
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
      where c.store_id = p_store and c.enabled and (v_pts is null or coalesce(c.point_id = any (v_pts), false))
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
