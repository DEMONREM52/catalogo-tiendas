-- 20261310 · Destacar varios productos a la vez (Radar) y destacados del catálogo en la franja pública
-- (Necesita 20261309.)
--
--   · product_featured_set(p_store, p_products[], p_featured): marca o quita «⭐ Destacado» sin tocar la oferta.
--     Requiere «Cambiar precios» (igual que las ofertas). Destacado = sale primero y resaltado en todos los catálogos.
--   · store_public_offers: ahora también trae los destacados propios de cada catálogo (Catálogos → Productos).
-- No cambia precios, existencias ni permisos. Se puede correr varias veces.

create or replace function public.product_featured_set(p_store uuid, p_products uuid[], p_featured boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products_prices') then
    return jsonb_build_object('ok', false, 'message', 'Destacar productos requiere el permiso «Cambiar precios».');
  end if;
  if coalesce(cardinality(p_products), 0) = 0 or cardinality(p_products) > 2000 then
    return jsonb_build_object('ok', false, 'message', 'Escoge entre 1 y 2.000 productos.');
  end if;
  select array_agg(p.id) into v_ids from public.products p where p.store_id = p_store and p.id = any (p_products);
  if v_ids is null then return jsonb_build_object('ok', false, 'message', 'Esos productos no son de tu tienda.'); end if;

  if coalesce(p_featured, false) then
    insert into public.erp_product_offers (product_id, store_id, featured, updated_by, updated_at)
    select id, p_store, true, auth.uid(), now() from unnest(v_ids) id
    on conflict (product_id) do update set featured = true, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  else
    update public.erp_product_offers set featured = false, updated_by = auth.uid(), updated_at = now()
    where product_id = any (v_ids) and store_id = p_store;
    -- Sin oferta ni etiqueta ya no hace falta la fila.
    delete from public.erp_product_offers
    where product_id = any (v_ids) and store_id = p_store and not featured and offer_price is null and nullif(btrim(coalesce(label, '')), '') is null;
  end if;
  return jsonb_build_object('ok', true, 'count', cardinality(v_ids));
end;
$$;

create or replace function public.store_public_offers(p_store text, p_catalog text, p_key text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_catalog uuid;
begin
  begin
    v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  exception when others then
    v_catalog := null;
  end;
  if v_catalog is null then return jsonb_build_object('items', '[]'::jsonb); end if;
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.product_id, 'now', i.price, 'before', case when i.price < r.price then r.price end,
             'pct', case when i.price < r.price and r.price > 0 then round(100 * (1 - i.price / r.price)) end,
             'ends_at', case when i.price < r.price then (
               select min(pr.ends_at) from public.erp_promotions pr
               where pr.store_id = c.store_id and pr.active and now() between pr.starts_at and pr.ends_at and pr.ends_at < '2099-01-01'
                 and pr.scope = 'product' and i.product_id = any (pr.product_ids)) end,
             'label', f.label, 'featured', coalesce(f.featured, false) or i.featured)
           order by (i.price < r.price) desc, i.featured desc), '[]'::jsonb)
    from public.catalog__items(v_catalog) i
    join public.catalog__items_raw(v_catalog) r on r.product_id = i.product_id
    join public.store_catalogs c on c.id = v_catalog
    left join public.erp_product_offers f on f.product_id = i.product_id
    where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
      and (i.price < r.price or i.featured or coalesce(f.featured, false) or nullif(f.label, '') is not null)));
end;
$$;

revoke all on function public.product_featured_set(uuid, uuid[], boolean) from public, anon;
grant execute on function public.product_featured_set(uuid, uuid[], boolean) to authenticated;
revoke all on function public.store_public_offers(text, text, text) from public;
grant execute on function public.store_public_offers(text, text, text) to anon, authenticated;
