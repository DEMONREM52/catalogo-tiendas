-- =====================================================================
-- REMHUB · Informe de traslados personalizable (sobre 20261278)
--
--   erp_transfer_report: agrupa los traslados como se pida y lo calcula en
--   la base (sin el límite de 1.000 filas):
--     · Agrupar por: punto que recibe, punto que envía, ruta (de → a),
--       producto, categoría, día, semana, mes, quién envió, quién recibió,
--       quién trasladó.
--     · Filtros: fechas (hora de Colombia), puntos que envían, puntos que
--       reciben, estado (en tránsito, recibidos, con diferencias, anulados),
--       categoría y texto (producto, referencia o número).
--     · Por grupo: traslados, productos, unidades enviadas, recibidas,
--       faltantes, de más, valor a precio interno y (solo con «Ver costos»)
--       valor a costo.
--     · Además: totales, unidades por día, los productos más trasladados y
--       la matriz de rutas.
--   Cada punto solo ve los traslados donde participa (erp__scope_ok).
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_transfer_report(
  p_store uuid, p_from date default null, p_to date default null,
  p_origins uuid[] default null, p_dests uuid[] default null, p_status text default 'all',
  p_group text default 'dest', p_q text default null, p_category uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cost boolean;
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_num bigint;
  v jsonb;
begin
  if not (public.erp_can(p_store, 'transfers') or public.erp_can(p_store, 'reports') or public.erp_can(p_store, 'inventory')) then
    raise exception 'No tienes permiso para ver los traslados.';
  end if;
  if p_group not in ('dest', 'origin', 'route', 'product', 'category', 'day', 'week', 'month', 'sender', 'receiver', 'carrier') then
    raise exception 'Agrupación no válida.';
  end if;
  v_cost := public.erp_can(p_store, 'costs_view');
  if v_q ~ '^#?\d{1,9}$' then v_num := replace(v_q, '#', '')::bigint; end if;

  with erp_tr_report_rows as materialized (
  select t.id as transfer_id, t.number, (t.created_at at time zone 'America/Bogota')::date as day, t.status, t.from_warehouse_id as from_id, t.to_warehouse_id as to_id, wf.name as from_name, wt.name as to_name,
         coalesce(nullif(t.created_by_name, ''), '—') as sender, coalesce(nullif(t.received_by_name, ''), '—') as receiver, coalesce(nullif(t.carrier_name, ''), '—') as carrier,
         i.product_id, p.name as product_name, p.sku, p.category_id, coalesce(c.name, 'Sin categoría') as category_name,
         i.qty, i.received_qty as received, i.unit_cost, i.internal_price
  from public.erp_transfers t
  join public.erp_transfer_items i on i.transfer_id = t.id
  join public.products p on p.id = i.product_id
  left join public.product_categories c on c.id = p.category_id
  join public.erp_warehouses wf on wf.id = t.from_warehouse_id
  join public.erp_warehouses wt on wt.id = t.to_warehouse_id
  where t.store_id = p_store
    and (public.erp__scope_ok(p_store, t.from_warehouse_id) or public.erp__scope_ok(p_store, t.to_warehouse_id))
    and (p_from is null or (t.created_at at time zone 'America/Bogota')::date >= p_from)
    and (p_to is null or (t.created_at at time zone 'America/Bogota')::date <= p_to)
    and (coalesce(cardinality(p_origins), 0) = 0 or t.from_warehouse_id = any (p_origins))
    and (coalesce(cardinality(p_dests), 0) = 0 or t.to_warehouse_id = any (p_dests))
    and (p_category is null or p.category_id = p_category)
    and case coalesce(p_status, 'all')
          when 'all' then t.status <> 'cancelled'
          when 'in_transit' then t.status = 'in_transit'
          when 'received' then t.status = 'received'
          when 'cancelled' then t.status = 'cancelled'
          when 'diff' then t.status = 'received' and exists (select 1 from public.erp_transfer_items d where d.transfer_id = t.id and d.received_qty is not null and d.received_qty <> d.qty)
          else t.status <> 'cancelled' end
    and (v_q is null or t.number = v_num or p.name ilike '%' || v_q || '%' or p.sku ilike '%' || v_q || '%')
  )
  select jsonb_build_object(
    'can_cost', v_cost,
    'group', p_group,
    'totals', (select jsonb_build_object(
        'transfers', count(distinct transfer_id), 'products', count(distinct product_id), 'lines', count(*),
        'units', coalesce(sum(qty), 0), 'received', coalesce(sum(received), 0),
        'missing', coalesce(sum(greatest(qty - received, 0)) filter (where received is not null), 0),
        'extra', coalesce(sum(greatest(received - qty, 0)) filter (where received is not null), 0),
        'in_transit', count(distinct transfer_id) filter (where status = 'in_transit'),
        'value', round(coalesce(sum(qty * internal_price), 0), 0),
        'cost', case when v_cost then round(coalesce(sum(qty * unit_cost), 0), 0) end,
        'points_to', count(distinct to_id), 'points_from', count(distinct from_id))
      from erp_tr_report_rows),
    'groups', coalesce((select jsonb_agg(g order by (g ->> 'units')::numeric desc) from (
        select jsonb_strip_nulls(jsonb_build_object(
          'key', k.key, 'label', k.label, 'sub', k.sub,
          'transfers', count(distinct r.transfer_id), 'products', count(distinct r.product_id),
          'units', sum(r.qty), 'received', coalesce(sum(r.received), 0),
          'missing', coalesce(sum(greatest(r.qty - r.received, 0)) filter (where r.received is not null), 0),
          'extra', coalesce(sum(greatest(r.received - r.qty, 0)) filter (where r.received is not null), 0),
          'value', round(coalesce(sum(r.qty * r.internal_price), 0), 0),
          'cost', case when v_cost then round(coalesce(sum(r.qty * r.unit_cost), 0), 0) end,
          'first', min(r.day), 'last', max(r.day))) g
        from erp_tr_report_rows r,
        lateral (select
          case p_group
            when 'dest' then r.to_id::text when 'origin' then r.from_id::text when 'route' then r.from_id::text || '>' || r.to_id::text
            when 'product' then r.product_id::text when 'category' then coalesce(r.category_id::text, '-')
            when 'day' then r.day::text when 'week' then date_trunc('week', r.day)::date::text when 'month' then to_char(r.day, 'YYYY-MM')
            when 'sender' then r.sender when 'receiver' then r.receiver else r.carrier end as key,
          case p_group
            when 'dest' then r.to_name when 'origin' then r.from_name when 'route' then r.from_name || ' → ' || r.to_name
            when 'product' then r.product_name when 'category' then r.category_name
            when 'day' then to_char(r.day, 'DD/MM/YYYY') when 'week' then 'Semana del ' || to_char(date_trunc('week', r.day), 'DD/MM/YYYY')
            when 'month' then to_char(r.day, 'MM/YYYY')
            when 'sender' then r.sender when 'receiver' then r.receiver else r.carrier end as label,
          case p_group when 'product' then r.sku else null end as sub) k
        group by k.key, k.label, k.sub
        limit 1000) x), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'units', units, 'transfers', transfers) order by day)
        from (select day, sum(qty) units, count(distinct transfer_id) transfers from erp_tr_report_rows group by day) s), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'sku', sku, 'units', units, 'transfers', transfers, 'points', points) order by units desc)
        from (select product_name name, max(sku) sku, sum(qty) units, count(distinct transfer_id) transfers, count(distinct to_id) points
              from erp_tr_report_rows group by product_id, product_name order by sum(qty) desc limit 15) tp), '[]'::jsonb),
    'matrix', coalesce((select jsonb_agg(jsonb_build_object('from', from_name, 'to', to_name, 'units', units, 'transfers', transfers))
        from (select from_name, to_name, sum(qty) units, count(distinct transfer_id) transfers from erp_tr_report_rows group by from_name, to_name) m), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.erp_transfer_report(uuid, date, date, uuid[], uuid[], text, text, text, uuid) from public, anon;
grant execute on function public.erp_transfer_report(uuid, date, date, uuid[], uuid[], text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
