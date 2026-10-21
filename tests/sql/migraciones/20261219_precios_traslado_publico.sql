-- =====================================================================
-- REMHUB · Precios del traslado para cualquiera que tenga el enlace
--
--   · erp_transfer_track_prices(token): precio 2 (por mayor) y precio 3
--     (detal) de los productos de un traslado, con el precio DEL PUNTO
--     QUE RECIBE (su regla de producto > categoría > todo el punto, igual
--     que el POS de ese punto). Sin regla, el precio de la tienda madre.
--   · No pide sesión: basta el enlace del traslado (el mismo que ya deja
--     ver productos y cantidades). Solo sirve para los productos de ESE
--     traslado y nunca entrega costos.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_transfer_track_prices(p_token text)
returns table (product_id uuid, sku text, price_2 numeric, price_3 numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tr public.erp_transfers;
  s public.erp_profit_settings;
begin
  if p_token is null or char_length(p_token) < 8 then return; end if;
  select * into tr from public.erp_transfers t
  where t.track_token::text = p_token
    and (t.track_expires_at is null or t.track_expires_at > now() or t.status <> 'in_transit');
  if not found then return; end if;
  select * into s from public.erp_profit_settings where store_id = tr.store_id;
  return query
    select p.id, p.sku::text,
           public.erp__point_price(p, 2, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
           public.erp__point_price(p, 3, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest'))
    from (select distinct i.product_id from public.erp_transfer_items i where i.transfer_id = tr.id) x
    join public.products p on p.id = x.product_id and p.store_id = tr.store_id
    left join lateral public.erp__rule_for(tr.store_id, tr.to_warehouse_id, p.id) r on true;
end;
$$;
revoke all on function public.erp_transfer_track_prices(text) from public;
grant execute on function public.erp_transfer_track_prices(text) to anon, authenticated;

notify pgrst, 'reload schema';
