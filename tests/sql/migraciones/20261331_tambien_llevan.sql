-- =====================================================================
-- REMHUB · POS: «Los que llevan esto también llevan…»
--
-- erp_pos_also_bought(p_store, p_products, p_limit): con lo que hay en el
-- carrito, los productos que más se han vendido JUNTO con ellos en las
-- ventas de los últimos 120 días (confirmadas), sin los que ya están en
-- el carrito ni los inactivos. Solo cuenta si se vendieron juntos al menos
-- 2 veces. Devuelve cuántas veces y de cuántas ventas («3 de cada 10»).
-- El POS los agrega con su precio de siempre (no se calcula precio aquí).
--
-- Solo lee. Permiso: POS, Pedidos o Informes. No cambia datos ni
-- permisos. Es idempotente.
-- =====================================================================

create index if not exists erp_order_items_product_order on public.order_items (product_id, order_id);

create or replace function public.erp_pos_also_bought(p_store uuid, p_products uuid[], p_limit integer default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := (select array_agg(distinct x) from unnest(coalesce(p_products, '{}'::uuid[])) x where x is not null);
  v_base integer;
  v_out jsonb;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['pos', 'orders', 'reports']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso del POS.');
  end if;
  if v_ids is null or cardinality(v_ids) = 0 then return jsonb_build_object('ok', true, 'orders', 0, 'items', '[]'::jsonb); end if;
  v_ids := v_ids[1:50];

  with base as materialized (
    select oi.order_id
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = any (v_ids) and o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) > now() - interval '120 days'
    group by oi.order_id
    order by max(coalesce(o.confirmed_at, o.created_at)) desc
    limit 3000
  ),
  co as (
    select oi.product_id, count(distinct oi.order_id)::integer as n
    from public.order_items oi join base b on b.order_id = oi.order_id
    where not (oi.product_id = any (v_ids))
    group by oi.product_id
  ),
  top as (
    select co.product_id, p.name, co.n
    from co join public.products p on p.id = co.product_id and p.store_id = p_store and coalesce(p.active, true)
    where co.n >= 2
    order by co.n desc, p.name
    limit least(greatest(coalesce(p_limit, 6), 1), 12)
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(jsonb_build_object('product_id', t.product_id, 'name', t.name, 'times', t.n) order by t.n desc, t.name) from top t), '[]'::jsonb)
    into v_base, v_out;
  return jsonb_build_object('ok', true, 'orders', v_base, 'items', v_out);
end $$;

revoke all on function public.erp_pos_also_bought(uuid, uuid[], integer) from public, anon;
grant execute on function public.erp_pos_also_bought(uuid, uuid[], integer) to authenticated;

notify pgrst, 'reload schema';
