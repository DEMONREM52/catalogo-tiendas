-- =====================================================================
-- REMHUB · Lista general de productos con el precio del punto
--
-- Antes la lista mostraba siempre el precio 1 de la madre. Ahora muestra el
-- precio 1 del punto que se está viendo, con la regla de ese punto (% o
-- fijo, por producto, categoría o punto) y el redondeo de la tienda, igual
-- que el POS. Si el usuario no tiene permiso en el punto que mira, sale el
-- precio de SU punto. Entrega también el precio de la madre («base_price»)
-- y si el producto tiene regla, para mostrarlos al dueño.
-- Igual a 20261031 en todo lo demás. No borra datos. No cambia permisos.
-- Es idempotente.
-- =====================================================================

create or replace function public.erp_product_catalog_browse(p_store uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 40, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_q text := nullif(btrim(coalesce(f ->> 'q', '')), '');
  v_point uuid := nullif(f ->> 'point_id', '')::uuid;
  v_cat uuid := nullif(f ->> 'category_id', '')::uuid;
  v_stock text := coalesce(nullif(f ->> 'stock', ''), 'all');
  v_status text := coalesce(nullif(f ->> 'status', ''), 'active');
  v_sort text := coalesce(nullif(f ->> 'sort', ''), 'name');
  v_cost boolean := public.erp_can_any(p_store, array['inventory', 'purchases']::text[]);
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
  v_price_point uuid;
  s public.erp_profit_settings;
begin
  if not public.erp_can_any(p_store, array['products', 'products_view', 'inventory', 'stock_requests', 'stock_requests_manage', 'transfers', 'pos']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para ver la lista general de productos.');
  end if;
  if v_point is not null and not exists (select 1 from public.erp_warehouses w where w.id = v_point and w.store_id = p_store) then
    v_point := null;
  end if;
  if v_point is null then
    v_point := public.erp_my_point(p_store);
  end if;
  if v_point is null then
    select w.id into v_point from public.erp_warehouses w
    where w.store_id = p_store and w.active
    order by w.is_default desc, (w.kind = 'point') asc, w.name limit 1;
  end if;

  -- Precio del punto que se está viendo (con su regla: % o fijo, por producto, categoría o punto). Si ese punto no
  -- es tuyo, el de tu punto; si no tienes punto (dueño, administración), el del punto que se está viendo.
  v_price_point := case when public.erp_point_allowed(p_store, v_point) then v_point else coalesce(public.erp_my_point(p_store), v_point) end;
  select * into s from public.erp_profit_settings where store_id = p_store;

  with base as (
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active, p.price_1, p.cost_price,
      public.erp__point_price(p, 1, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) as point_price,
      r.id is not null as has_rule,
      public.product__rank(p.name, p.sku, p.barcode, p.product_no, v_q) as rank,
      coalesce((select sl.qty from public.erp_stock_levels sl where sl.warehouse_id = v_point and sl.product_id = p.id), 0) as here,
      coalesce((select sum(greatest(sl.qty, 0)) from public.erp_stock_levels sl
                where sl.product_id = p.id and sl.store_id = p_store and sl.warehouse_id is distinct from v_point), 0) as elsewhere,
      coalesce((select sum(greatest(sl.qty, 0)) from public.erp_stock_levels sl where sl.product_id = p.id and sl.store_id = p_store), 0) as total
    from public.products p
    left join lateral public.erp__rule_for(p_store, v_price_point, p.id) r on true
    where p.store_id = p_store
      and (v_status = 'all' or (v_status = 'active' and coalesce(p.active, true)) or (v_status = 'inactive' and not coalesce(p.active, true)))
      and (v_cat is null or p.category_id = v_cat
           or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = v_cat))
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, null, v_q)
  ), counts as (
    select count(*) as all_n,
      count(*) filter (where here > 0) as has_n,
      count(*) filter (where here <= 0) as missing_n,
      count(*) filter (where here <= 0 and elsewhere > 0) as elsewhere_n
    from base
  ), filtered as (
    select * from base
    where v_stock = 'all' or (v_stock = 'has' and here > 0) or (v_stock = 'missing' and here <= 0)
       or (v_stock = 'elsewhere' and here <= 0 and elsewhere > 0)
  ), page as (
    select * from filtered
    order by
      case when v_sort = 'here' then here end asc nulls last,
      case when v_sort = 'elsewhere' then elsewhere end desc nulls last,
      case when v_sort = 'total' then total end desc nulls last,
      rank desc,
      name
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from filtered),
    'counts', (select jsonb_build_object('all', all_n, 'has', has_n, 'missing', missing_n, 'elsewhere', elsewhere_n) from counts),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'name', pg.name, 'sku', pg.sku, 'barcode', pg.barcode, 'product_no', pg.product_no, 'image_url', pg.image_url, 'active', pg.active,
        'price', pg.point_price, 'base_price', pg.price_1, 'has_rule', pg.has_rule, 'cost', case when v_cost then pg.cost_price end,
        'here', pg.here, 'elsewhere', pg.elsewhere, 'total', pg.total,
        'levels', coalesce((select jsonb_object_agg(sl.warehouse_id::text, sl.qty) from public.erp_stock_levels sl
                            where sl.product_id = pg.id and sl.store_id = p_store and sl.qty <> 0), '{}'::jsonb))
        order by
          case when v_sort = 'here' then pg.here end asc nulls last,
          case when v_sort = 'elsewhere' then pg.elsewhere end desc nulls last,
          case when v_sort = 'total' then pg.total end desc nulls last,
          pg.rank desc,
          pg.name) from page pg), '[]'::jsonb),
    'points', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind, 'is_default', w.is_default)
                 order by w.kind desc, w.name), '[]'::jsonb)
               from public.erp_warehouses w where w.store_id = p_store and w.active),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
                   from public.product_categories c where c.store_id = p_store),
    'my_point', public.erp_my_point(p_store),
    'point_id', v_point,
    'price_point_id', v_price_point,
    'price_point_name', (select w.name from public.erp_warehouses w where w.id = v_price_point),
    'can_edit', public.erp_can(p_store, 'products'),
    'can_request', public.erp_can_any(p_store, array['stock_requests', 'stock_requests_manage']::text[]),
    'show_cost', v_cost)
  into v_result;
  return v_result;
end;
$$;
grant execute on function public.erp_product_catalog_browse(uuid, jsonb, integer, integer) to authenticated;

notify pgrst, 'reload schema';
