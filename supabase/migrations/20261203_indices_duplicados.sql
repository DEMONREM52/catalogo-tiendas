-- =====================================================================
-- REMHUB · Quitar índices duplicados (exactamente iguales)
--
-- En producción hay índices repetidos (ej. products_store_sku_idx e
-- idx_products_store_sku son el mismo). Cada uno se actualiza en CADA
-- escritura (importar productos, mover existencias, cambiar precios) y
-- ocupa espacio, sin acelerar nada: Postgres solo usa uno.
--
--   · Solo se quita un índice si hay OTRO idéntico en la misma tabla
--     (mismas columnas, mismo orden, mismas condiciones, mismo tipo).
--   · Nunca se quita el que sostiene una llave primaria o una regla
--     única (constraint) ni uno que falte en la otra copia.
--   · La definición exacta de cada índice quitado queda guardada en
--     public.erp_dropped_indexes: para volver atrás, ejecutar la columna
--     «definition» (o la función public.erp_restore_dropped_indexes()).
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
    with idx as (
      select i.indexrelid, i.indrelid, c.relname as index_name, t.relname as table_name,
             pg_get_indexdef(i.indexrelid) as definition,
             -- Firma del índice sin su nombre: columnas, clases de operador, expresiones, condición y si es único.
             i.indrelid::text || '|' || i.indkey::text || '|' || i.indclass::text || '|' || i.indcollation::text || '|'
               || i.indoption::text || '|' || coalesce(pg_get_expr(i.indexprs, i.indrelid), '') || '|'
               || coalesce(pg_get_expr(i.indpred, i.indrelid), '') || '|' || i.indisunique::text || '|' || am.amname as signature,
             exists (select 1 from pg_constraint k where k.conindid = i.indexrelid) as backs_constraint
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_am am on am.oid = c.relam
      where n.nspname = 'public' and i.indisvalid and i.indisready
    ),
    ranked as (
      -- Se conserva primero el que sostiene una regla; si no, el de nombre más antiguo alfabéticamente.
      select *, row_number() over (partition by signature order by backs_constraint desc, index_name) as rn,
             first_value(index_name) over (partition by signature order by backs_constraint desc, index_name) as kept
      from idx
    )
    select * from ranked where rn > 1 and not backs_constraint
  loop
    insert into public.erp_dropped_indexes (index_name, table_name, definition, kept_index)
    values (r.index_name, r.table_name, r.definition, r.kept)
    on conflict (index_name) do update set definition = excluded.definition, kept_index = excluded.kept_index, dropped_at = now();
    execute format('drop index if exists public.%I', r.index_name);
    raise notice 'Índice duplicado quitado: % (igual a %)', r.index_name, r.kept;
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
