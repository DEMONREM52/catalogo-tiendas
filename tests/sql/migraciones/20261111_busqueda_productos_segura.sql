-- =====================================================================
-- REMHUB · Búsqueda de productos compatible con el costo protegido
--
-- Después de 20261107 (costo protegido) la búsqueda search_products_pro
-- falla con «permission denied for table products», porque corre con los
-- permisos del usuario y devuelve el producto completo (incluido el costo).
--
-- search_products_safe llama la misma búsqueda (sin cambiarla), revisa que
-- quien busca pertenezca a la tienda y devuelve cada resultado SIN el costo.
-- La app usa esta función desde la versión que acompaña este archivo.
--
-- No borra ni cambia datos ni la función original. Es idempotente.
-- =====================================================================

create or replace function public.search_products_safe(
  p_store_id uuid, p_query text, p_limit integer, p_offset integer, p_status text, p_category_id uuid
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp__is_store_member(p_store_id) or public.erp_is_platform_admin()) then
    raise exception 'No perteneces a esta tienda.';
  end if;
  return query
    select to_jsonb(x) - 'cost_price'
    from public.search_products_pro(
      p_store_id => p_store_id, p_query => p_query,
      p_limit => least(greatest(coalesce(p_limit, 50), 1), 200), p_offset => greatest(coalesce(p_offset, 0), 0),
      p_status => p_status, p_category_id => p_category_id
    ) x;
end;
$$;
revoke all on function public.search_products_safe(uuid, text, integer, integer, text, uuid) from public, anon;
grant execute on function public.search_products_safe(uuid, text, integer, integer, text, uuid) to authenticated;

-- Aviso: otras funciones que corren con los permisos del usuario y leen productos completos.
do $$
declare r record;
begin
  for r in
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not p.prosecdef and p.prokind = 'f'
      and p.prosrc ~* 'products' and (p.prosrc ~* 'cost_price' or p.prosrc ~* 'select\s+\*' or p.prosrc ~* 'setof\s+(public\.)?products')
      and p.proname <> 'search_products_pro'
  loop
    raise notice 'Revisa la función % (corre con los permisos del usuario y lee productos).', r.proname;
  end loop;
end $$;

notify pgrst, 'reload schema';
