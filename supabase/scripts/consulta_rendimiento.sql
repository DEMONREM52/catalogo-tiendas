-- =====================================================================
-- REMHUB · Diagnóstico de rendimiento (SOLO LECTURA: no cambia nada)
-- Supabase → SQL Editor → pega todo → Run → copia el resultado (una sola celda JSON).
-- No incluye datos de clientes, contraseñas ni claves: solo código de funciones,
-- índices, tamaños de tablas y estadísticas de consultas.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  -- Código de las funciones más lentas (y las que ellas usan).
  'funciones', (
    select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'catalog_public_products', 'catalog_public', 'catalog__items', 'catalog_public_stock', 'catalog_public_meta',
      'search_products_pro', 'search_products_safe', 'store_public_search', 'erp_search_products', 'catalog_admin_products',
      'erp__point_price', 'erp_my_points', 'erp_can', 'erp__can_base', 'erp_can_any', 'erp__is_store_member')
  ),
  -- Índices de las tablas que tocan esas funciones.
  'indices', (
    select jsonb_object_agg(t.relname, (select jsonb_agg(pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid = t.oid))
    from pg_class t join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relkind = 'r' and t.relname in (
      'products', 'store_catalogs', 'store_catalog_products', 'store_catalog_categories', 'product_categories',
      'erp_stock', 'erp_stock_levels', 'erp_product_stock', 'inventory_movements', 'erp_warehouses', 'store_users', 'stores',
      'product_images', 'product_variants', 'erp_point_prices')
  ),
  -- Tablas más grandes: filas, tamaño y cuántas veces se recorren completas (seq_scan) vs. por índice.
  'tablas', (
    select jsonb_agg(x order by (x->>'bytes')::bigint desc) from (
      select jsonb_build_object('tabla', s.relname, 'filas', s.n_live_tup, 'bytes', pg_total_relation_size(s.relid),
        'tamano', pg_size_pretty(pg_total_relation_size(s.relid)), 'seq_scan', s.seq_scan, 'idx_scan', s.idx_scan) as x
      from pg_stat_user_tables s where s.schemaname = 'public'
      order by pg_total_relation_size(s.relid) desc limit 30) q
  ),
  -- Tablas con Realtime encendido (cada cambio en ellas se revisa para los que escuchan).
  'realtime', (select jsonb_agg(schemaname || '.' || tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  'extensiones', (select jsonb_agg(extname || ' ' || extversion) from pg_extension),
  -- Almacenamiento: total por carpeta y los 20 archivos más pesados (solo el informe; no se borra nada).
  'almacenamiento', (
    select jsonb_build_object(
      'por_carpeta', (select jsonb_agg(jsonb_build_object('carpeta', bucket_id, 'archivos', n, 'tamano', pg_size_pretty(b), 'imagenes_mayores_500kb', big) order by b desc)
                      from (select bucket_id, count(*) n, sum(coalesce((metadata->>'size')::bigint, 0)) b,
                                   count(*) filter (where coalesce((metadata->>'size')::bigint, 0) > 512000 and metadata->>'mimetype' like 'image/%') big
                            from storage.objects group by bucket_id) q),
      'mas_pesados', (select jsonb_agg(jsonb_build_object('carpeta', bucket_id, 'archivo', name, 'tamano', pg_size_pretty((metadata->>'size')::bigint),
                                                          'tipo', metadata->>'mimetype', 'cache', metadata->>'cacheControl'))
                      from (select * from storage.objects where metadata->>'mimetype' like 'image/%'
                            order by coalesce((metadata->>'size')::bigint, 0) desc limit 20) q))
  ),
  -- Las 12 consultas que más tiempo gastan, con su texto completo (sin valores: Postgres los cambia por $1, $2…).
  'consultas', (
    select jsonb_agg(jsonb_build_object('calls', calls, 'ms_total', round(total_exec_time::numeric), 'ms_prom', round(mean_exec_time::numeric, 1),
                                        'filas_prom', round(rows::numeric / greatest(calls, 1), 1), 'consulta', left(query, 1500)))
    from (select * from pg_stat_statements order by total_exec_time desc limit 12) q
  )
));
