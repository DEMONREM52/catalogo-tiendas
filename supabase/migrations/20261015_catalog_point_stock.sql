-- =====================================================================
-- REMHUB · Catálogos con punto: solo lo que hay en ese punto
--
--   · Si un catálogo tiene un punto o bodega asignado, muestra y vende
--     únicamente los productos con unidades en ese lugar (igual que la
--     facturación del punto).
--   · Los productos sin unidades se ocultan solos y vuelven a aparecer
--     cuando llegan unidades por compra, traslado o ajuste.
--   · Un producto con el stock general vacío ya no se toma como
--     "ilimitado" en estos catálogos: cuenta lo que diga el punto.
--   · El editor de catálogos permite filtrar por existencias del punto y
--     agregar en bloque solo los productos que tienen unidades.
--
-- Ejecutar DESPUÉS de 20261014_catalogs_reports.sql.
-- Es idempotente: se puede ejecutar varias veces.
-- =====================================================================

create or replace function public.catalog__items(p_catalog uuid, p_ids uuid[] default null)
returns table (
  product_id uuid,
  category_key uuid,
  price numeric,
  base_price numeric,
  stock integer,
  featured boolean,
  sort_order integer,
  category_hidden boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(cp.catalog_category_id, ccat.id, p.category_id),
    case
      when cp.price_override is not null then cp.price_override
      when coalesce(public.catalog__price(p, c.price_level), 0) > 0 then public.catalog__price(p, c.price_level)
      when c.fallback_price_level is not null then public.catalog__price(p, c.fallback_price_level)
      else public.catalog__price(p, c.price_level)
    end,
    public.catalog__price(p, c.price_level),
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
  where c.id = p_catalog
    and (p_ids is null or p.id = any (p_ids))
    and case when c.include_all_products then coalesce(cp.included, true) else coalesce(cp.included, false) end;
$$;
revoke all on function public.catalog__items(uuid, uuid[]) from public, anon, authenticated;

-- p_stock: 'all' | 'with' (con unidades) | 'without' (sin unidades)
drop function if exists public.catalog_admin_bulk(uuid, text, uuid, text);
create or replace function public.catalog_admin_bulk(
  p_catalog uuid,
  p_action text,
  p_category uuid default null,
  p_q text default null,
  p_stock text default 'all'
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare c public.store_catalogs; v_q text := lower(nullif(btrim(coalesce(p_q, '')), '')); v_count integer;
begin
  select * into c from public.store_catalogs where id = p_catalog;
  if not found then raise exception 'Catálogo no encontrado.'; end if;
  if not public.erp_can(c.store_id, 'products') then raise exception 'Necesitas el permiso de Productos.'; end if;
  if p_action not in ('include', 'exclude') then raise exception 'Acción no válida.'; end if;

  insert into public.store_catalog_products (catalog_id, product_id, store_id, included)
  select c.id, p.id, c.store_id, p_action = 'include'
  from public.products p
  left join public.erp_stock_levels sl on c.point_id is not null and sl.warehouse_id = c.point_id and sl.product_id = p.id
  where p.store_id = c.store_id and p.active
    and (p_category is null or p.category_id = p_category
         or exists (select 1 from public.store_catalog_categories cc where cc.id = p_category and cc.category_id = p.category_id))
    and (v_q is null or strpos(lower(p.name), v_q) > 0 or strpos(lower(coalesce(p.sku, '')), v_q) > 0
         or strpos(lower(coalesce(p.barcode, '')), v_q) > 0)
    and case coalesce(p_stock, 'all')
      when 'with' then case when c.point_id is not null then coalesce(sl.qty, 0) > 0 else p.stock is null or p.stock > 0 end
      when 'without' then case when c.point_id is not null then coalesce(sl.qty, 0) <= 0 else p.stock is not null and p.stock <= 0 end
      else true end
  on conflict (catalog_id, product_id) do update set included = excluded.included;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.catalog_admin_bulk(uuid, text, uuid, text, text) to authenticated;

drop function if exists public.catalog_admin_products(uuid, text, uuid, text, integer, integer);
create or replace function public.catalog_admin_products(
  p_catalog uuid,
  p_q text default null,
  p_category uuid default null,
  p_filter text default 'all',
  p_stock text default 'all',
  p_limit integer default 40,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.store_catalogs; v_q text := lower(nullif(btrim(coalesce(p_q, '')), '')); v jsonb;
begin
  select * into c from public.store_catalogs where id = p_catalog;
  if not found then raise exception 'Catálogo no encontrado.'; end if;
  if not public.erp_can(c.store_id, 'products') then raise exception 'Necesitas el permiso de Productos.'; end if;

  with base as (
    select p.id, p.name, p.sku, p.image_url, p.category_id, p.stock, p.cost_price,
           p.price_1, p.price_2, p.price_3, p.price_4, p.price_5,
           cp.price_override, cp.catalog_category_id, coalesce(cp.featured, false) as featured,
           case when c.include_all_products then coalesce(cp.included, true) else coalesce(cp.included, false) end as in_catalog,
           case
             when cp.price_override is not null then cp.price_override
             when coalesce(public.catalog__price(p, c.price_level), 0) > 0 then public.catalog__price(p, c.price_level)
             when c.fallback_price_level is not null then public.catalog__price(p, c.fallback_price_level)
             else public.catalog__price(p, c.price_level)
           end as price,
           case
             when c.point_id is not null then greatest(coalesce(sl.qty, 0), 0)
             when p.stock is null then null
             else p.stock
           end as catalog_stock,
           coalesce(not ecat.visible, false) as category_hidden
    from public.products p
    left join public.store_catalog_products cp on cp.catalog_id = c.id and cp.product_id = p.id
    left join public.store_catalog_categories ccat on ccat.catalog_id = c.id and ccat.category_id = p.category_id
    left join public.store_catalog_categories ecat on ecat.id = coalesce(cp.catalog_category_id, ccat.id)
    left join public.erp_stock_levels sl on c.point_id is not null and sl.warehouse_id = c.point_id and sl.product_id = p.id
    where p.store_id = c.store_id and p.active
      and (p_category is null or p.category_id = p_category)
      and (v_q is null or strpos(lower(p.name), v_q) > 0 or strpos(lower(coalesce(p.sku, '')), v_q) > 0
           or strpos(lower(coalesce(p.barcode, '')), v_q) > 0)
  ),
  marked as (
    select base.*,
           (catalog_stock is null or catalog_stock > 0) as has_stock,
           (in_catalog and coalesce(price, 0) > 0 and (catalog_stock is null or catalog_stock > 0) and not category_hidden) as visible
    from base
  ),
  scoped as (
    select * from marked
    where case coalesce(p_stock, 'all')
      when 'with' then has_stock
      when 'without' then not has_stock
      else true end
  ),
  filtered as (
    select * from scoped
    where case coalesce(p_filter, 'all')
      when 'visible' then visible
      when 'in' then in_catalog
      when 'out' then not in_catalog
      when 'special' then price_override is not null
      when 'noprice' then in_catalog and coalesce(price, 0) <= 0
      when 'featured' then featured
      else true end
  ),
  page as (
    select filtered.*, count(*) over () as total_count
    from filtered
    order by featured desc, has_stock desc, name, id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', coalesce((select max(total_count) from page), 0),
    'items', coalesce((select jsonb_agg(to_jsonb(page) - 'total_count' order by page.featured desc, page.has_stock desc, page.name, page.id) from page), '[]'::jsonb),
    'counts', (select jsonb_build_object(
      'all', count(*),
      'visible', count(*) filter (where visible),
      'in', count(*) filter (where in_catalog),
      'out', count(*) filter (where not in_catalog),
      'special', count(*) filter (where price_override is not null),
      'noprice', count(*) filter (where in_catalog and coalesce(price, 0) <= 0),
      'featured', count(*) filter (where featured)) from scoped),
    'stock', (select jsonb_build_object(
      'all', count(*),
      'with', count(*) filter (where has_stock),
      'without', count(*) filter (where not has_stock)) from marked)
  ) into v;
  return v;
end;
$$;
grant execute on function public.catalog_admin_products(uuid, text, uuid, text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
