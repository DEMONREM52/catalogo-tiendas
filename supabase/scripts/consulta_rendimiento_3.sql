-- =====================================================================
-- REMHUB · Medición real del catálogo (correr DESPUÉS de 20261203 y 20261204)
-- No cambia datos: crea una función TEMPORAL (desaparece al cerrar el editor),
-- mide cada catálogo activo y devuelve los tiempos. No muestra claves.
-- =====================================================================
create or replace function pg_temp.medir_catalogos() returns jsonb language plpgsql as $$
declare
  r record; t0 timestamptz; out jsonb := '[]'::jsonb;
  n_items integer; ms_items numeric; ms_pagina numeric; ms_busqueda numeric; ms_portada numeric;
begin
  for r in
    select c.id, c.slug, s.slug as store_slug, c.access_key, c.point_id is not null as de_punto,
           exists (select 1 from public.erp_price_rules pr where pr.store_id = c.store_id and pr.point_id = c.point_id and pr.status = 'active') as con_reglas
    from public.store_catalogs c join public.stores s on s.id = c.store_id
    where c.active and s.active order by c.created_at limit 12
  loop
    t0 := clock_timestamp(); select count(*) into n_items from public.catalog__items(r.id);
    ms_items := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
    t0 := clock_timestamp(); perform public.catalog_public_products(r.store_slug, r.slug, r.access_key, null, null, 30, 0);
    ms_pagina := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
    t0 := clock_timestamp(); perform public.catalog_public_products(r.store_slug, r.slug, r.access_key, null, 'camisa', 30, 0);
    ms_busqueda := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
    t0 := clock_timestamp(); perform public.catalog_public(r.store_slug, r.slug, r.access_key);
    ms_portada := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
    out := out || jsonb_build_object('catalogo', r.store_slug || '/' || r.slug, 'de_punto', r.de_punto, 'con_reglas_de_precio', r.con_reglas,
      'productos', n_items, 'ms_calcular_productos', ms_items, 'ms_primera_pagina', ms_pagina, 'ms_buscar_camisa', ms_busqueda,
      'ms_portada_y_categorias', ms_portada);
  end loop;
  return out;
end $$;

select jsonb_build_object(
  'catalogos', pg_temp.medir_catalogos(),
  -- Índices de productos: tamaño y cuántas veces se usaron desde el último reinicio de estadísticas.
  'indices_products', (
    select jsonb_agg(jsonb_build_object('indice', indexrelname, 'tamano', pg_size_pretty(pg_relation_size(indexrelid)), 'usos', idx_scan)
                     order by pg_relation_size(indexrelid) desc)
    from pg_stat_user_indexes where schemaname = 'public' and relname = 'products'),
  'indices_quitados', (select jsonb_agg(index_name) from public.erp_dropped_indexes)
)::text as resultado;
