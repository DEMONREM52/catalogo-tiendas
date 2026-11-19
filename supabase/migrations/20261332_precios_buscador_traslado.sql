-- =====================================================================
-- REMHUB · Buscador del traslado: precio por mayor y precio en el punto
--
-- erp_transfer_pick_prices(p_store, p_point, p_ids): para los productos
-- que salen en el buscador al armar o corregir un traslado, el precio por
-- mayor de la tienda madre (precio 2) y a cómo queda en el punto que
-- recibe (su regla de producto > categoría > todo el punto, la misma del
-- POS de ese punto y del enlace del traslado). Sin regla, el de la madre.
--
-- Quien arma el traslado suele estar en la bodega y no tiene permiso en
-- el punto que recibe, por eso erp_point_prices no le sirve. Pide el
-- permiso de traslados o inventario y NUNCA entrega costos.
-- Solo lee. No cambia datos ni permisos. Es idempotente.
-- =====================================================================

create or replace function public.erp_transfer_pick_prices(p_store uuid, p_point uuid, p_ids uuid[])
returns table (product_id uuid, price_2 numeric, point_price_2 numeric, has_rule boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.erp_profit_settings;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['transfers', 'inventory']::text[]) then return; end if;
  if p_point is null or not exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store) then return; end if;
  select * into s from public.erp_profit_settings where store_id = p_store;
  return query
    select p.id,
           round(coalesce(public.catalog__price(p, 2), 0), 2),
           public.erp__point_price(p, 2, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
           r.id is not null
    from public.products p
    left join lateral public.erp__rule_for(p_store, p_point, p.id) r on true
    where p.store_id = p_store and p.id = any (coalesce(p_ids[1:100], '{}'::uuid[]));
end $$;

revoke all on function public.erp_transfer_pick_prices(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.erp_transfer_pick_prices(uuid, uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
