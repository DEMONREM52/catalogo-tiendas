-- =====================================================================
-- REMHUB · Existencias en vivo y verificación antes de guardar
--
-- Varias personas venden, trasladan y piden al mismo tiempo. La base ya
-- impide sacar más unidades de las que hay (bloquea la fila al descontar);
-- esto agrega lo que faltaba para que nadie se lleve la sorpresa:
--   · erp_stock_levels en tiempo real (Supabase Realtime): cuando Javier
--     vende 5 de 10, la pantalla de Juan pasa a mostrar 5 sin recargar.
--     Cada quien solo recibe lo que su permiso le deja ver (RLS).
--   · erp_stock_check: justo antes de guardar una venta o un traslado,
--     revisa contra la base cuántas quedan de verdad.
--   · erp_stock_request_precheck: antes de enviar un pedido interno, avisa
--     si ese producto ya está pedido en otro pedido abierto (del mismo punto
--     o de otros) y cuánto le queda libre a quien surte.
-- No borra datos. Es idempotente.
-- =====================================================================

-- 1) Tiempo real de existencias.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'erp_stock_levels') then
    execute 'alter publication supabase_realtime add table public.erp_stock_levels';
  end if;
end $$;

-- 2) Verificación antes de guardar: qué productos no alcanzan en esa bodega o punto.
create or replace function public.erp_stock_check(p_store uuid, p_wh uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_short jsonb;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then
    return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.');
  end if;
  if not exists (select 1 from public.erp_warehouses w where w.id = p_wh and w.store_id = p_store) then
    return jsonb_build_object('ok', false, 'error', 'La bodega o punto no existe.');
  end if;
  with want as (
    select (x->>'product_id')::uuid as product_id, sum(greatest(0, coalesce((x->>'qty')::numeric, 0)))::integer as qty
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
    where x ? 'product_id'
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id', w.product_id, 'name', p.name, 'wanted', w.qty, 'available', coalesce(sl.qty, 0))
                            order by p.name), '[]'::jsonb)
  into v_short
  from want w
  join public.products p on p.id = w.product_id and p.store_id = p_store
  left join public.erp_stock_levels sl on sl.warehouse_id = p_wh and sl.product_id = w.product_id
  where w.qty > coalesce(sl.qty, 0);
  return jsonb_build_object('ok', jsonb_array_length(v_short) = 0, 'short', v_short);
end;
$$;
revoke all on function public.erp_stock_check(uuid, uuid, jsonb) from public, anon;
grant execute on function public.erp_stock_check(uuid, uuid, jsonb) to authenticated;

-- 3) Antes de enviar un pedido interno: lo que ya está pedido y sin despachar.
--    p_from = punto que pide (le llega), p_to = quien surte.
create or replace function public.erp_stock_request_precheck(p_store uuid, p_from uuid, p_to uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then
    return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.');
  end if;
  with want as (
    select (x->>'product_id')::uuid as product_id, sum(greatest(0, coalesce((x->>'qty')::numeric, 0)))::integer as qty
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
    where x ? 'product_id'
    group by 1
  ),
  open_lines as (
    -- Pedidos abiertos que aún no salen (enviado o en preparación): esas unidades todavía están en quien surte.
    select i.product_id, r.id as request_id, r.number, r.from_point_id, r.to_point_id,
           coalesce(i.qty_approved, i.qty_requested)::integer as qty
    from public.erp_stock_requests r
    join public.erp_stock_request_items i on i.request_id = r.id
    where r.store_id = p_store and r.status in ('pending', 'preparing')
      and i.product_id in (select product_id from want)
  )
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.name), '[]'::jsonb) into v_rows
  from (
    select w.product_id, p.name, w.qty as wanted,
           coalesce(sl.qty, 0) as source_stock,
           coalesce((select sum(o.qty) from open_lines o where o.product_id = w.product_id and o.to_point_id = p_to), 0)::integer as already_requested,
           greatest(0, coalesce(sl.qty, 0) - coalesce((select sum(o.qty) from open_lines o where o.product_id = w.product_id and o.to_point_id = p_to), 0))::integer as free_stock,
           coalesce((select jsonb_agg(distinct o.number) from open_lines o where o.product_id = w.product_id and o.from_point_id = p_from), '[]'::jsonb) as mine_open
    from want w
    join public.products p on p.id = w.product_id and p.store_id = p_store
    left join public.erp_stock_levels sl on sl.warehouse_id = p_to and sl.product_id = w.product_id
  ) t;
  return jsonb_build_object('ok', true, 'items', v_rows);
end;
$$;
revoke all on function public.erp_stock_request_precheck(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.erp_stock_request_precheck(uuid, uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
