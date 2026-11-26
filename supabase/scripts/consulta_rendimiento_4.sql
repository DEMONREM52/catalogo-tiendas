-- =====================================================================
-- REMHUB · Diagnóstico de rendimiento y aislamiento (auditoría 2026-11-26)
-- UNA sola consulta, solo lectura: no cambia nada, no crea nada y no muestra claves ni datos de clientes
-- (de las consultas solo salen los primeros 300 caracteres del texto, con los valores reemplazados por $1, $2…).
-- Pegar en Supabase → SQL Editor → Run, y mandar el resultado (una celda de texto JSON).
--
-- Qué trae:
--   · consultas_mas_costosas / mas_lentas_en_promedio: de pg_stat_statements (desde estadisticas_desde).
--   · tablas_leidas_completas: tablas grandes que se recorren enteras (candidatas a índice).
--   · indices_sin_uso: índices de más de 1 MB que nunca se usaron (candidatos a quitar, con vuelta atrás).
--   · tablas_mas_grandes, cache (aciertos en memoria), conexiones, realtime (tablas publicadas).
--   · aislamiento: tablas de public sin RLS que anon o authenticated pueden leer, y funciones SECURITY DEFINER
--     sin search_path fijo. Deben salir vacías.
-- Para medir desde cero después de desplegar: select pg_stat_statements_reset();  (borra solo las estadísticas)
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'estadisticas_desde', (select stats_reset from pg_stat_statements_info),

  'consultas_mas_costosas', (
    select jsonb_agg(x order by (x->>'total_s')::numeric desc) from (
      select jsonb_build_object(
        'consulta', left(regexp_replace(s.query, '\s+', ' ', 'g'), 300),
        'llamadas', s.calls,
        'total_s', round((s.total_exec_time / 1000)::numeric, 1),
        'promedio_ms', round(s.mean_exec_time::numeric, 1),
        'max_ms', round(s.max_exec_time::numeric, 0),
        'filas_por_llamada', round((s.rows::numeric / greatest(s.calls, 1)), 1),
        'aciertos_cache_pct', round(100.0 * s.shared_blks_hit / greatest(s.shared_blks_hit + s.shared_blks_read, 1), 1)
      ) as x
      from pg_stat_statements s
      join pg_roles r on r.oid = s.userid
      where r.rolname in ('authenticated', 'anon', 'service_role', 'authenticator', 'postgres')
        and s.query !~* '^\s*(begin|commit|set |show |select pg_stat|select \$1|listen|notify|with recursive pgrst_source)'
        and s.query !~* 'pg_stat_statements|realtime\.list_changes|pg_catalog\.|information_schema'
      order by s.total_exec_time desc limit 25) q),

  'mas_lentas_en_promedio', (
    select jsonb_agg(x order by (x->>'promedio_ms')::numeric desc) from (
      select jsonb_build_object(
        'consulta', left(regexp_replace(s.query, '\s+', ' ', 'g'), 300),
        'llamadas', s.calls,
        'promedio_ms', round(s.mean_exec_time::numeric, 1),
        'max_ms', round(s.max_exec_time::numeric, 0)
      ) as x
      from pg_stat_statements s
      where s.calls >= 20 and s.query !~* 'pg_stat_statements|realtime\.list_changes|pg_catalog\.|information_schema|^\s*(begin|commit|set |show )'
      order by s.mean_exec_time desc limit 15) q),

  'tablas_leidas_completas', (
    select jsonb_agg(jsonb_build_object(
      'tabla', relname, 'filas', n_live_tup, 'lecturas_completas', seq_scan, 'filas_leidas_asi', seq_tup_read,
      'lecturas_por_indice', coalesce(idx_scan, 0), 'tamano', pg_size_pretty(pg_total_relation_size(relid)))
      order by seq_tup_read desc)
    from (select * from pg_stat_user_tables where schemaname = 'public' and n_live_tup > 2000 and seq_scan > 50
          order by seq_tup_read desc limit 15) t),

  'indices_sin_uso', (
    select jsonb_agg(jsonb_build_object('indice', i.indexrelname, 'tabla', i.relname, 'tamano', pg_size_pretty(pg_relation_size(i.indexrelid)))
      order by pg_relation_size(i.indexrelid) desc)
    from pg_stat_user_indexes i
    join pg_index x on x.indexrelid = i.indexrelid
    where i.schemaname = 'public' and i.idx_scan = 0 and not x.indisunique and not x.indisprimary
      and pg_relation_size(i.indexrelid) > 1024 * 1024),

  'tablas_mas_grandes', (
    select jsonb_agg(jsonb_build_object('tabla', relname, 'filas', n_live_tup, 'total', pg_size_pretty(pg_total_relation_size(relid)),
      'indices', pg_size_pretty(pg_indexes_size(relid))) order by pg_total_relation_size(relid) desc)
    from (select * from pg_stat_user_tables where schemaname = 'public' order by pg_total_relation_size(relid) desc limit 15) t),

  'cache', (
    select jsonb_build_object(
      'tablas_aciertos_pct', round(100.0 * sum(heap_blks_hit) / greatest(sum(heap_blks_hit) + sum(heap_blks_read), 1), 2),
      'indices_aciertos_pct', round(100.0 * sum(idx_blks_hit) / greatest(sum(idx_blks_hit) + sum(idx_blks_read), 1), 2))
    from pg_statio_user_tables),

  'conexiones', (
    select jsonb_build_object(
      'maximo', current_setting('max_connections')::int,
      'por_estado', (select jsonb_object_agg(coalesce(state, 'sin estado'), n) from (select state, count(*) n from pg_stat_activity group by state) s),
      'por_aplicacion', (select jsonb_object_agg(coalesce(nullif(application_name, ''), 'sin nombre'), n)
                         from (select application_name, count(*) n from pg_stat_activity group by application_name order by 2 desc limit 10) a))),

  'realtime', (
    select jsonb_agg(schemaname || '.' || tablename order by tablename)
    from pg_publication_tables where pubname = 'supabase_realtime'),

  'aislamiento', jsonb_build_object(
    'tablas_sin_rls_legibles', (
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
        and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))),
    'funciones_definer_sin_search_path', (
      select jsonb_agg(p.proname order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')))
))::text as resultado;
