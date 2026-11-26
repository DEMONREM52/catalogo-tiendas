-- =====================================================================
-- REMHUB · Diagnóstico 5: código actual de las funciones más lentas y los índices (auditoría 2026-11-26)
-- UNA sola consulta, solo lectura: no cambia nada y no muestra datos de clientes (solo el código de las
-- funciones, la definición de los índices y cuántas filas tiene cada tabla).
-- Por qué: varias de estas funciones no están en el repositorio (se crearon antes o fuera de git); para
-- acelerarlas sin cambiar lo que devuelven hay que partir de la versión que corre hoy en producción.
-- Pegar en Supabase → SQL Editor → Run → (arriba del resultado) Copy → JSON, y mandar lo copiado.
--
-- Filas que trae:
--   · funcion:     las más costosas o lentas según consulta_rendimiento_4.sql (todas sus versiones).
--   · ayudante:    las funciones de public que esas llaman directamente.
--   · indices:     índices de cada tabla de public con 300 filas o más (con su tamaño y filas).
--   · extensiones: las instaladas (pg_trgm, unaccent, vector… deciden qué índice sirve para buscar).
-- =====================================================================
with objetivo(orden, nombre) as (
  values
    (1, 'catalog_public_products'), (2, 'erp_stock_requests_list'), (3, 'store_public_offers'), (4, 'erp_alerts'),
    (5, 'erp_stock_inbox'), (6, 'catalog_public'), (7, 'erp_extra_alerts'), (8, 'erp_offline_alerts'),
    (9, 'erp_order_alerts'), (10, 'store_public_search'), (11, 'erp_stock_browse'), (12, 'catalog_admin_summary'),
    (13, 'erp_product_finder'), (14, 'product_image_pending'), (15, 'erp_point_valuation'), (16, 'product_radar'),
    (17, 'erp_product_catalog_browse'), (18, 'catalog_public_image_search'), (19, 'erp_product_image_search'),
    (20, 'store_public_image_search'), (21, 'erp_dm_list'), (22, 'erp_products_pending_entry'), (23, 'erp_payables_board'),
    (24, 'erp_stock_request_detail')
),
fn as (
  select o.orden, p.oid, p.proname::text as nombre, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
  from objetivo o
  join pg_proc p on p.proname = o.nombre
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
),
ayuda as (
  select min(f.orden) + 100 as orden, h.oid, h.proname::text as nombre, pg_get_function_identity_arguments(h.oid) as args, pg_get_functiondef(h.oid) as def
  from fn f
  join pg_proc h on h.prokind = 'f' and h.pronamespace = 'public'::regnamespace
  where h.oid not in (select oid from fn)
    and f.def ~ ('\m' || h.proname || '\s*\(')
  group by h.oid, h.proname
)
select tipo, orden, nombre, argumentos, contenido
from (
  select 'funcion' as tipo, orden, nombre, args as argumentos, def as contenido from fn
  union all
  select 'ayudante', orden, nombre, args, def from ayuda
  union all
  select 'indices', 900, t.relname::text,
         pg_size_pretty(pg_total_relation_size(t.relid)) || ' · ' || greatest(t.n_live_tup, c.reltuples::bigint) || ' filas',
         (select string_agg(pg_get_indexdef(i.indexrelid), E'\n' order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid = t.relid)
  from pg_stat_user_tables t
  join pg_class c on c.oid = t.relid
  where t.schemaname = 'public' and greatest(t.n_live_tup, c.reltuples::bigint) >= 300
  union all
  select 'extensiones', 999, 'extensiones', null,
         (select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension)
) x
order by orden, nombre, argumentos;
