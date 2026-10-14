-- =====================================================================
-- REMHUB · Proteger el costo de los productos
--
-- Hoy cualquier usuario con sesión puede leer products.cost_price directo
-- desde la API (los visitantes sin sesión ya no). Esta migración:
--   1. Crea erp_product_costs: entrega costos solo a quien tiene permiso
--      (Productos, Inventario, Ajustes, Compras o Rentabilidad) y solo de
--      su tienda.
--   2. Quita a «authenticated» el permiso de leer la columna cost_price
--      (todas las demás columnas siguen igual). Escribir el costo (crear,
--      editar productos, compras) sigue funcionando igual.
--
-- ORDEN: primero publica la versión de la app que usa erp_product_costs,
-- después ejecuta esto. No borra ni cambia datos.
-- Para deshacer: supabase/scripts/deshacer_proteger_costo.sql
-- =====================================================================

create or replace function public.erp_product_costs(p_store uuid, p_ids uuid[])
returns table (product_id uuid, cost_price numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'products') or public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_approve')
          or public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'inventory_adjust') or public.erp_can(p_store, 'purchases')) then
    raise exception 'No tienes permiso para ver costos.';
  end if;
  if coalesce(cardinality(p_ids), 0) > 2000 then raise exception 'Pide máximo 2000 productos a la vez.'; end if;
  return query select p.id, p.cost_price from public.products p where p.store_id = p_store and p.id = any (p_ids);
end;
$$;
revoke all on function public.erp_product_costs(uuid, uuid[]) from public, anon;
grant execute on function public.erp_product_costs(uuid, uuid[]) to authenticated;

-- Aviso: funciones «invoker» (corren con los permisos de quien llama) que leen products con * o cost_price.
do $$
declare r record;
begin
  for r in
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not p.prosecdef and p.prokind = 'f'
      and p.prosrc ~* 'products' and (p.prosrc ~* 'cost_price' or p.prosrc ~* 'select\s+\*')
  loop
    raise notice 'Revisa la función % (corre con los permisos del usuario y lee productos).', r.proname;
  end loop;
end $$;

-- Lectura por columnas para «authenticated»: todas menos cost_price.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name <> 'cost_price';
  revoke select on public.products from authenticated;
  revoke select (cost_price) on public.products from authenticated;
  execute format('grant select (%s) on public.products to authenticated', cols);
end $$;

notify pgrst, 'reload schema';
