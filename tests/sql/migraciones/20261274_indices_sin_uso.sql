-- =====================================================================
-- REMHUB · Quitar índices de búsqueda que nunca se usan (sobre 20261203)
--
-- La medición del 2026-10-30 (consulta_rendimiento_3.sql) mostró que estos
-- índices de texto de products tienen 0 usos: la búsqueda filtra primero por
-- tienda y compara con erp__norm_text(...), que no coincide con ninguno de
-- ellos. Ocupan unos 50 MB y se actualizan en cada cambio de un producto
-- (importar, editar precios), sin acelerar nada.
--
--   · Solo se quita si existe, no es único, no sostiene una regla y sigue
--     con 0 usos al momento de correr esto.
--   · La definición queda en public.erp_dropped_indexes: para volver atrás,
--     select public.erp_restore_dropped_indexes();
-- No toca datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_dropped_indexes (
  index_name text primary key,
  table_name text not null,
  definition text not null,
  kept_index text not null,
  dropped_at timestamptz not null default now()
);
alter table public.erp_dropped_indexes enable row level security;
revoke all on public.erp_dropped_indexes from anon, authenticated;

do $$
declare r record;
begin
  for r in
    select c.relname as index_name, t.relname as table_name, pg_get_indexdef(i.indexrelid) as definition
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
    where n.nspname = 'public' and t.relname = 'products'
      and c.relname in ('idx_products_search_trgm', 'products_desc_trgm_idx', 'products_name_trgm', 'products_name_trgm_idx',
                        'idx_products_search_fts', 'products_sku_trgm_idx', 'products_barcode_trgm_idx')
      and not i.indisunique and not i.indisprimary
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
      and coalesce(s.idx_scan, 0) = 0
  loop
    insert into public.erp_dropped_indexes (index_name, table_name, definition, kept_index)
    values (r.index_name, r.table_name, r.definition, '(sin uso)')
    on conflict (index_name) do update set definition = excluded.definition, kept_index = excluded.kept_index, dropped_at = now();
    execute format('drop index if exists public.%I', r.index_name);
    raise notice 'Índice sin uso quitado: %', r.index_name;
  end loop;
end $$;

-- Volver atrás: recrea los índices quitados (si no existen).
create or replace function public.erp_restore_dropped_indexes()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select * from public.erp_dropped_indexes loop
    if to_regclass('public.' || quote_ident(r.index_name)) is null then
      execute r.definition;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.erp_restore_dropped_indexes() from public, anon, authenticated;
