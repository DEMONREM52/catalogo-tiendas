-- =====================================================================
-- REMHUB · search_path fijo en todas las funciones (aviso de Supabase)
--
-- «Function Search Path Mutable»: funciones de public sin search_path fijo.
-- Se les pone «public, extensions», que es lo mismo que usan hoy por defecto
-- (así siguen encontrando unaccent, pg_trgm, vector… del esquema extensions),
-- pero ya nadie puede cambiárselo para engañarlas.
--
-- Solo toca funciones de public que NO tengan search_path y que no sean de
-- una extensión. No cambia lo que hacen. Es idempotente.
--
-- Se dejan igual las funciones SQL pequeñas (immutable/stable) que se usan por
-- cada fila en búsquedas y precios (norm_text, product__haystack, rh_score…):
-- con search_path fijo Postgres ya no las puede «pegar» dentro de la consulta
-- y el buscador se pondría más lento. Su riesgo es bajo: los usuarios no
-- pueden crear tablas ni funciones en public.
-- Al final muestra cuántas arregló y si alguna no se pudo.
-- =====================================================================

create temporary table if not exists _sp_report (funcion text, resultado text);
truncate _sp_report;

do $$
declare
  f record;
  v_path text := case when exists (select 1 from pg_namespace where nspname = 'extensions') then 'public, extensions' else 'public' end;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as firma, p.prokind,
           (l.lanname = 'sql' and p.provolatile in ('i', 's')) as rapida
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    order by 2
  loop
    if f.rapida then
      insert into _sp_report values (f.firma, 'se deja igual (función rápida de búsquedas)');
      continue;
    end if;
    begin
      execute format('alter %s %s set search_path = %s', case when f.prokind = 'p' then 'procedure' else 'function' end, f.firma, v_path);
      insert into _sp_report values (f.firma, 'ok');
    exception when others then
      insert into _sp_report values (f.firma, 'no se pudo: ' || sqlerrm);
    end;
  end loop;
end $$;

select resultado, count(*) as funciones, (array_agg(funcion order by funcion))[1:5] as ejemplos
from _sp_report group by resultado order by resultado;
