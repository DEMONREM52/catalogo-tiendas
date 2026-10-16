-- =====================================================================
-- REMHUB · Búsquedas y catálogo más rápidos (mismos resultados)
--
-- Problema (pg_stat_statements de producción):
--   · catalog_public_products: ~511 ms por página del catálogo.
--   · search_products_pro (buscador del panel): ~342 ms.
--   · store_public_search (buscador del catálogo): ~900 ms.
--   · erp_search_products (buscador del POS / ingresos): ~136–326 ms.
-- Causa: product__matches / product__rank reciben el TEXTO buscado y, por
-- cada producto (13.000+), lo vuelven a partir en palabras, normalizar y
-- sacar el código. Pasa también sin búsqueda (la visita normal al catálogo).
--
-- Solución: el texto se prepara UNA sola vez (palabras, código y texto
-- normalizado) y cada producto solo se compara. Es exactamente la misma
-- lógica de product__matches y product__rank (mismas funciones internas,
-- mismo orden de reglas), así que los resultados y el orden no cambian.
-- Sin búsqueda, la comparación se salta por completo.
--
-- También: índices para las búsquedas por documento (líneas de factura,
-- traslado, ajuste, pagos) que hoy recorren la tabla completa.
-- No cambia datos ni permisos. Es idempotente. Para volver atrás: correr de
-- nuevo la definición anterior de cada función (quedan en
-- supabase/scripts/consulta_rendimiento.sql → «funciones»).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Productos del catálogo público (lo más usado: cada página del catálogo)
-- ---------------------------------------------------------------------
create or replace function public.catalog_public_products(p_store text, p_catalog text, p_key text default null::text, p_category uuid default null::uuid,
  p_q text default null::text, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $function$
declare
  v_catalog uuid;
  v_rules boolean;
  v_result jsonb;
begin
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  select wholesale_rules into v_rules from public.store_catalogs where id = v_catalog;

  with q as materialized (
    -- La búsqueda se prepara una sola vez (antes se repetía por cada producto).
    select public.product__tokens(p_q) as tokens, public.product__code_key(p_q) as code,
           public.erp__norm_text(btrim(coalesce(p_q, ''))) as norm
  ),
  items as (
    select i.*, p.name, p.description, p.image_url, p.product_details, p.min_wholesale, p.sku, p.product_no,
           (case
              when cardinality(q.tokens) = 0 then 0
              when public.product__code_hit(p.sku, p.barcode, p.product_no, q.code) then 100
              when public.erp__norm_text(p.name) = q.norm then 90
              when public.erp__norm_text(p.name) like q.norm || '%' then 70
              when public.product__has_tokens(public.erp__norm_text(p.name), q.tokens) then 50
              when public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens) then 40
              else 10 + 20 * public.product__fuzzy(q.norm, public.erp__norm_text(p.name))
            end)::real as rank
    from q
    cross join public.catalog__items(v_catalog) i
    join public.products p on p.id = i.product_id
    where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
      and (p_category is null or i.category_key = p_category)
      and (cardinality(q.tokens) = 0
           or public.product__code_hit(p.sku, p.barcode, p.product_no, q.code)
           or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, p.description), q.tokens)
           or (length(q.norm) >= 4 and public.product__fuzzy(q.norm, public.erp__norm_text(p.name)) >= 0.5))
  ),
  page as (
    select items.*, count(*) over () as total_count
    from items
    order by items.rank desc, items.featured desc, items.sort_order, items.name, items.product_id
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', coalesce(max(page.total_count), 0),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', page.product_id, 'name', page.name, 'description', page.description, 'image_url', page.image_url,
      'price', page.price, 'price_retail', page.price, 'price_wholesale', page.price,
      'min_wholesale', case when v_rules then greatest(1, coalesce(page.min_wholesale, 1)) end,
      'stock', page.stock, 'category_id', page.category_key, 'featured', page.featured,
      'active', true, 'product_details', page.product_details, 'code', page.sku
    ) order by page.rank desc, page.featured desc, page.sort_order, page.name, page.product_id), '[]'::jsonb)
  )
  into v_result
  from page;
  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. Buscador de productos del panel (lo llama search_products_safe)
-- ---------------------------------------------------------------------
create or replace function public.search_products_pro(p_store_id uuid, p_query text, p_limit integer default 50, p_offset integer default 0,
  p_status text default 'all'::text, p_category_id uuid default null::uuid)
returns setof products language sql stable set search_path to 'public', 'extensions' as $function$
  with q as materialized (
    select public.product__tokens(p_query) as tokens, public.product__code_key(p_query) as code,
           public.erp__norm_text(btrim(coalesce(p_query, ''))) as norm
  )
  select p.*
  from q cross join public.products p
  where p.store_id = p_store_id
    and (coalesce(p_status, 'all') not in ('active', 'inactive')
         or (p_status = 'active' and coalesce(p.active, true))
         or (p_status = 'inactive' and not coalesce(p.active, true)))
    and (p_category_id is null or p.category_id = p_category_id
         or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = p_category_id))
    and (cardinality(q.tokens) = 0
         or public.product__code_hit(p.sku, p.barcode, p.product_no, q.code)
         or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, p.description), q.tokens)
         or (length(q.norm) >= 4 and public.product__fuzzy(q.norm, public.erp__norm_text(p.name)) >= 0.5))
  order by (case
              when cardinality(q.tokens) = 0 then 0
              when public.product__code_hit(p.sku, p.barcode, p.product_no, q.code) then 100
              when public.erp__norm_text(p.name) = q.norm then 90
              when public.erp__norm_text(p.name) like q.norm || '%' then 70
              when public.product__has_tokens(public.erp__norm_text(p.name), q.tokens) then 50
              when public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens) then 40
              else 10 + 20 * public.product__fuzzy(q.norm, public.erp__norm_text(p.name))
            end)::real desc, p.name, p.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

-- ---------------------------------------------------------------------
-- 3. Buscador del catálogo público (por texto o categoría)
-- ---------------------------------------------------------------------
create or replace function public.store_public_search(p_store uuid, p_q text default null::text, p_category uuid default null::uuid,
  p_limit integer default 30, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path to 'public', 'extensions' as $function$
  with q as materialized (
    select public.product__tokens(p_q) as tokens, public.product__code_key(p_q) as code,
           public.erp__norm_text(btrim(coalesce(p_q, ''))) as norm
  ),
  found as (
    select p.id, p.name,
           (case
              when cardinality(q.tokens) = 0 then 0
              when public.product__code_hit(p.sku, p.barcode, p.product_no, q.code) then 100
              when public.erp__norm_text(p.name) = q.norm then 90
              when public.erp__norm_text(p.name) like q.norm || '%' then 70
              when public.product__has_tokens(public.erp__norm_text(p.name), q.tokens) then 50
              when public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens) then 40
              else 10 + 20 * public.product__fuzzy(q.norm, public.erp__norm_text(p.name))
            end)::real as rank
    from q
    cross join public.products p
    join public.stores s on s.id = p.store_id and s.active and (s.active_until is null or s.active_until > now())
    where p.store_id = p_store and coalesce(p.active, true) and (p.stock is null or p.stock > 0)
      and (p_category is null or p.category_id = p_category
           or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = p_category))
      and (cardinality(q.tokens) = 0
           or public.product__code_hit(p.sku, p.barcode, p.product_no, q.code)
           or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, p.description), q.tokens)
           or (length(q.norm) >= 4 and public.product__fuzzy(q.norm, public.erp__norm_text(p.name)) >= 0.5))
  ), page as (
    select id, rank, name from found
    order by rank desc, name, id
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from found),
    'ids', coalesce((select jsonb_agg(id order by rank desc, name, id) from page), '[]'::jsonb)
  );
$function$;

-- ---------------------------------------------------------------------
-- 4. Buscador del POS, ingresos, traslados y pedidos internos
-- ---------------------------------------------------------------------
create or replace function public.erp_search_products(p_store uuid, p_q text, p_warehouse uuid default null::uuid, p_in_stock boolean default false,
  p_limit integer default 20)
returns table(id uuid, name text, sku text, barcode text, cost_price numeric, tax_rate numeric, stock integer, wh_qty integer, product_no integer)
language plpgsql stable security definer set search_path to 'public', 'extensions' as $function$
begin
  if not public.erp_can_any(p_store, array['inventory', 'purchases', 'transfers', 'inventory_adjust', 'pos', 'stock_requests',
                                           'stock_requests_manage', 'products', 'products_view']::text[]) then
    raise exception 'No tienes permiso para consultar productos.';
  end if;
  return query
    with q as materialized (
      select public.product__tokens(p_q) as tokens, public.product__code_key(p_q) as code,
             public.erp__norm_text(btrim(coalesce(p_q, ''))) as norm
    )
    select p.id, p.name::text, p.sku::text, p.barcode::text, coalesce(p.cost_price, 0)::numeric, coalesce(p.tax_rate, 0)::numeric,
           coalesce(p.stock, 0)::integer, coalesce(l.qty, 0)::integer, p.product_no
    from q
    cross join public.products p
    left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = p_warehouse
    where p.store_id = p_store and coalesce(p.active, true)
      and (cardinality(q.tokens) = 0
           or public.product__code_hit(p.sku, p.barcode, p.product_no, q.code)
           or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens)
           or (length(q.norm) >= 4 and public.product__fuzzy(q.norm, public.erp__norm_text(p.name)) >= 0.5))
      and (not p_in_stock or coalesce(l.qty, 0) > 0)
    order by (case
                when cardinality(q.tokens) = 0 then 0
                when public.product__code_hit(p.sku, p.barcode, p.product_no, q.code) then 100
                when public.erp__norm_text(p.name) = q.norm then 90
                when public.erp__norm_text(p.name) like q.norm || '%' then 70
                when public.product__has_tokens(public.erp__norm_text(p.name), q.tokens) then 50
                when public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens) then 40
                else 10 + 20 * public.product__fuzzy(q.norm, public.erp__norm_text(p.name))
              end)::real desc, p.name
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$function$;

-- ---------------------------------------------------------------------
-- 5. Índices para buscar las líneas de un documento (hoy recorren la tabla completa)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('erp_purchase_items', 'purchase_id'), ('erp_transfer_items', 'transfer_id'), ('erp_adjustment_items', 'adjustment_id'),
    ('erp_payables', 'purchase_id'), ('erp_payable_payments', 'payable_id'), ('erp_cash_moves', 'session_id')
  ) as t(tbl, col)
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = r.col) then
      execute format('create index if not exists %I on public.%I (%I)', r.tbl || '_' || r.col || '_idx', r.tbl, r.col);
    end if;
  end loop;
  -- Reglas de precio activas de un punto: se consultan por cada producto de un catálogo de punto.
  if to_regclass('public.erp_price_rules') is not null then
    execute 'create index if not exists erp_price_rules_point_active_idx on public.erp_price_rules (store_id, point_id) where status = ''active''';
  end if;
end $$;

notify pgrst, 'reload schema';
