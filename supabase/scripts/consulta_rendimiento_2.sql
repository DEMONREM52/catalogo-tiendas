-- =====================================================================
-- REMHUB · Diagnóstico de rendimiento 2 (SOLO LECTURA: no cambia nada)
-- Supabase → SQL Editor → pega todo → Run → copia la celda del resultado.
-- Sale en una sola línea (compacta) para que no se corte al pegarla.
-- No incluye datos de clientes ni claves.
-- =====================================================================
select jsonb_build_object(
  -- 1. ¿Por qué «products» pesa 80 MB con ~13.000 filas? Tamaño promedio y máximo de cada columna.
  'products_columnas', (
    select jsonb_object_agg(col, jsonb_build_object('prom_bytes', prom, 'max_bytes', mx, 'total', pg_size_pretty(tot)))
    from (
      select 'image_url' col, round(avg(pg_column_size(image_url))) prom, max(pg_column_size(image_url)) mx, sum(pg_column_size(image_url))::bigint tot from public.products
      union all select 'description', round(avg(pg_column_size(description))), max(pg_column_size(description)), sum(pg_column_size(description))::bigint from public.products
      union all select 'product_details', round(avg(pg_column_size(product_details))), max(pg_column_size(product_details)), sum(pg_column_size(product_details))::bigint from public.products
      union all select 'name', round(avg(pg_column_size(name))), max(pg_column_size(name)), sum(pg_column_size(name))::bigint from public.products
      union all select 'fila_completa', round(avg(pg_column_size(p.*))), max(pg_column_size(p.*)), sum(pg_column_size(p.*))::bigint from public.products p
    ) q
  ),
  'products_imagenes', (
    select jsonb_build_object(
      'total', count(*),
      'con_imagen', count(*) filter (where nullif(image_url, '') is not null),
      'imagen_como_texto_base64', count(*) filter (where image_url like 'data:%'),
      'en_supabase_storage', count(*) filter (where image_url like '%/storage/v1/object/%'),
      'externas', count(*) filter (where image_url like 'http%' and image_url not like '%/storage/v1/object/%'))
    from public.products
  ),
  'products_tamano', jsonb_build_object(
    'tabla', pg_size_pretty(pg_table_size('public.products')),
    'indices', pg_size_pretty(pg_indexes_size('public.products')),
    'toast', pg_size_pretty(coalesce(pg_total_relation_size(nullif((select reltoastrelid from pg_class where oid = 'public.products'::regclass), 0)), 0))),
  -- 2. Código de las funciones que faltaron (la más lenta: catalog_public_products).
  'funciones', (
    select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             jsonb_build_object('dueno', pg_get_userbyid(p.proowner), 'definer', p.prosecdef, 'codigo', pg_get_functiondef(p.oid)))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'catalog_public_products', 'catalog__keys', 'catalog__store_by_slug', 'catalog__price', 'catalog__access',
      'product__matches', 'product__rank', 'norm_text', 'erp__rule_for', 'erp__round_step', 'search_products_pro', 'search_products_safe')
  ),
  -- 3. Reglas de seguridad (RLS) de products: si llaman funciones por cada fila, son lentas.
  'products_rls', (select jsonb_agg(jsonb_build_object('nombre', policyname, 'para', cmd, 'roles', roles, 'tipo', permissive, 'usando', qual, 'revisa', with_check))
                   from pg_policies where schemaname = 'public' and tablename = 'products'),
  'postgres_salta_rls', (select rolbypassrls from pg_roles where rolname = 'postgres'),
  -- 4. Llaves foráneas sin índice (cada búsqueda por ellas recorre la tabla completa).
  'fk_sin_indice', (
    select jsonb_agg(jsonb_build_object('tabla', c.conrelid::regclass::text, 'columnas', (
      select string_agg(a.attname, ', ') from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)))
    from pg_constraint c join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey)
  ),
  -- 5. Almacenamiento: total por carpeta y los 15 archivos de imagen más pesados (solo informe).
  'almacenamiento', (
    select jsonb_build_object(
      'por_carpeta', (select jsonb_agg(jsonb_build_object('carpeta', bucket_id, 'archivos', n, 'tamano', pg_size_pretty(b), 'imagenes_mayores_500kb', big) order by b desc)
                      from (select bucket_id, count(*) n, sum(coalesce((metadata->>'size')::bigint, 0)) b,
                                   count(*) filter (where coalesce((metadata->>'size')::bigint, 0) > 512000 and metadata->>'mimetype' like 'image/%') big
                            from storage.objects group by bucket_id) q),
      'mas_pesados', (select jsonb_agg(jsonb_build_object('carpeta', bucket_id, 'archivo', right(name, 80), 'tamano', pg_size_pretty((metadata->>'size')::bigint),
                                                          'tipo', metadata->>'mimetype', 'cache', metadata->>'cacheControl'))
                      from (select * from storage.objects where metadata->>'mimetype' like 'image/%'
                            order by coalesce((metadata->>'size')::bigint, 0) desc limit 15) q))
  ),
  -- 6. Desde cuándo se acumulan las estadísticas de consultas.
  'estadisticas_desde', (select stats_reset from pg_stat_statements_info)
)::text as resultado;
