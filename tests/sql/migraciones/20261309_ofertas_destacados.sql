-- 20261309 · Ofertas («antes $20.000, ahora $15.000») y productos destacados
-- (Necesita 20261228 «ventas extra» por las promociones, y 20261108 por catalog__items.)
--
--   · erp_product_offers: por producto, precio de oferta (opcional, con fecha de fin), etiqueta («Oferta»,
--     «Liquidación», «Nuevo precio»…) y si es destacado.
--   · product_offer_get / product_offer_save(p_store, p_product, p_offer_price, p_ends_on, p_featured, p_label):
--     poner o quitar la oferta exige «Cambiar precios» (products_prices). La oferta se guarda además como
--     promoción de precio fijo del producto (erp_promotions): así el POS la cobra sola y respeta los límites.
--     Al vencer deja de aplicar sola (en catálogos y POS) y vuelve el precio normal. Los precios 1-5 NO cambian.
--   · catalog__items: ahora aplica las promociones vigentes (las de esta pantalla y las de «Promociones»):
--     el catálogo muestra, cobra y valida el pedido con el precio de oferta. La lógica anterior queda igual en
--     catalog__items_raw (se usa para el «precio de antes»). Los destacados salen primero en el catálogo.
--   · store_public_offers(p_store, p_catalog, p_key): para el catálogo y la página del producto: por producto,
--     precio de antes, precio de ahora, % de descuento, fin, etiqueta y destacado (solo lo que ya es público).
-- No cambia precios guardados, costos, existencias ni permisos. Se puede correr varias veces.

create table if not exists public.erp_product_offers (
  product_id uuid primary key references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  offer_price numeric(14, 2) check (offer_price is null or offer_price > 0),
  ends_at timestamptz,
  featured boolean not null default false,
  label text,
  promotion_id uuid,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists erp_product_offers_store on public.erp_product_offers (store_id);
alter table public.erp_product_offers enable row level security;
revoke all on public.erp_product_offers from anon, authenticated;

-- ===== Precio de catálogo: la lógica de siempre (sin cambios) =====
create or replace function public.catalog__items_raw(p_catalog uuid, p_ids uuid[] default null::uuid[])
returns table(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    p.id,
    coalesce(cp.catalog_category_id, ccat.id, p.category_id),
    case
      when cp.price_override is not null then cp.price_override
      when coalesce(case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end, 0) > 0
        then case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
      when c.fallback_price_level is not null
        then case when r.id is null then public.catalog__price(p, c.fallback_price_level) else public.erp__point_price(p, c.fallback_price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
      else case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end
    end,
    case when r.id is null then public.catalog__price(p, c.price_level) else public.erp__point_price(p, c.price_level, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) end,
    case
      when c.point_id is not null then greatest(coalesce(sl.qty, 0), 0)
      when p.stock is null then null
      else p.stock
    end,
    coalesce(cp.featured, false),
    coalesce(cp.sort_order, 0),
    coalesce(not ecat.visible, false)
  from public.store_catalogs c
  join public.products p on p.store_id = c.store_id and p.active
  left join public.store_catalog_products cp on cp.catalog_id = c.id and cp.product_id = p.id
  left join public.store_catalog_categories ccat on ccat.catalog_id = c.id and ccat.category_id = p.category_id
  left join public.store_catalog_categories ecat on ecat.id = coalesce(cp.catalog_category_id, ccat.id)
  left join public.erp_stock_levels sl on c.point_id is not null and sl.warehouse_id = c.point_id and sl.product_id = p.id
  left join public.erp_profit_settings s on s.store_id = c.store_id
  left join lateral (
    select x.* from public.erp__rule_for(c.store_id, c.point_id, p.id) x
    where c.point_id is not null
      and exists (select 1 from public.erp_price_rules pr where pr.store_id = c.store_id and pr.point_id = c.point_id and pr.status = 'active')
  ) r on true
  where c.id = p_catalog
    and (p_ids is null or p.id = any (p_ids))
    and case when c.include_all_products then coalesce(cp.included, true) else coalesce(cp.included, false) end;
$function$;

-- Precio de promoción vigente para un producto en un catálogo (null = no hay). Se calcula sobre el precio del catálogo.
create or replace function public.catalog__promo_price(p_store uuid, p_point uuid, p_product uuid, p_category uuid, p_price numeric)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $$
  select min(case when pr.kind = 'price' then pr.value else round(p_price * (1 - pr.value / 100)) end)
  from public.erp_promotions pr
  where pr.store_id = p_store and pr.active and now() between pr.starts_at and pr.ends_at
    and (cardinality(pr.point_ids) = 0 or (p_point is not null and p_point = any (pr.point_ids)))
    and (pr.scope = 'all'
         or (pr.scope = 'product' and p_product = any (pr.product_ids))
         or (pr.scope = 'category' and (p_category = pr.category_id
              or exists (select 1 from public.product_category_links l where l.product_id = p_product and l.category_id = pr.category_id))));
$$;

-- ===== Precio de catálogo con ofertas (la usan el catálogo, el carrito y el pedido) =====
create or replace function public.catalog__items(p_catalog uuid, p_ids uuid[] default null::uuid[])
returns table(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.product_id, r.category_key,
         case when o.v is not null and o.v > 0 and o.v < r.price then o.v else r.price end,
         r.base_price, r.stock,
         r.featured or coalesce(f.featured, false),
         r.sort_order, r.category_hidden
  from public.catalog__items_raw(p_catalog, p_ids) r
  join public.store_catalogs c on c.id = p_catalog
  join public.products p on p.id = r.product_id
  left join public.erp_product_offers f on f.product_id = r.product_id
  left join lateral (
    select case when to_regclass('public.erp_promotions') is null or coalesce(r.price, 0) <= 0 then null
                else public.catalog__promo_price(c.store_id, c.point_id, r.product_id, p.category_id, r.price) end as v
  ) o on true;
$function$;

-- ===== Guardar y leer la oferta de un producto =====
create or replace function public.product_offer_get(p_store uuid, p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['products', 'products_prices']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  return jsonb_build_object('ok', true, 'can_edit', public.erp_can(p_store, 'products_prices'), 'offer', (
    select jsonb_build_object('offer_price', o.offer_price, 'ends_at', o.ends_at, 'featured', o.featured, 'label', o.label,
             'running', o.offer_price is not null and (o.ends_at is null or o.ends_at > now()))
    from public.erp_product_offers o join public.products p on p.id = o.product_id
    where o.product_id = p_product and p.store_id = p_store));
end;
$$;

create or replace function public.product_offer_save(p_store uuid, p_product uuid, p_offer_price numeric, p_ends_on date, p_featured boolean, p_label text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text; v_promo uuid; v_end timestamptz; v_who text;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products_prices') then
    return jsonb_build_object('ok', false, 'message', 'Poner ofertas y destacados requiere el permiso «Cambiar precios».');
  end if;
  select p.name into v_name from public.products p where p.id = p_product and p.store_id = p_store;
  if v_name is null then return jsonb_build_object('ok', false, 'message', 'Ese producto no es de tu tienda.'); end if;
  if p_offer_price is not null and p_offer_price <= 0 then
    return jsonb_build_object('ok', false, 'message', 'El precio de oferta debe ser mayor que cero.');
  end if;
  -- Hasta el final de ese día (hora Colombia).
  v_end := case when p_ends_on is null then null else ((p_ends_on + 1)::timestamp at time zone 'America/Bogota') end;
  if v_end is not null and v_end <= now() then
    return jsonb_build_object('ok', false, 'message', 'La fecha de fin ya pasó.');
  end if;

  select o.promotion_id into v_promo from public.erp_product_offers o where o.product_id = p_product;
  if to_regclass('public.erp_promotions') is not null then
    if p_offer_price is null then
      if v_promo is not null then delete from public.erp_promotions where id = v_promo and store_id = p_store; end if;
      v_promo := null;
    else
      v_who := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) else public.pub__user_name(p_store) end;
      if v_promo is not null and exists (select 1 from public.erp_promotions where id = v_promo and store_id = p_store) then
        update public.erp_promotions set name = left('Oferta · ' || btrim(v_name), 80), kind = 'price', value = p_offer_price, scope = 'product',
          product_ids = array[p_product], point_ids = '{}', starts_at = least(starts_at, now()), ends_at = coalesce(v_end, '2100-01-01'::timestamptz), active = true
        where id = v_promo;
      else
        insert into public.erp_promotions (store_id, name, kind, value, scope, product_ids, point_ids, starts_at, ends_at, active, created_by, created_by_name)
        values (p_store, left('Oferta · ' || btrim(v_name), 80), 'price', p_offer_price, 'product', array[p_product], '{}', now(),
                coalesce(v_end, '2100-01-01'::timestamptz), true, auth.uid(), v_who)
        returning id into v_promo;
      end if;
    end if;
  end if;

  if p_offer_price is null and not coalesce(p_featured, false) and nullif(btrim(coalesce(p_label, '')), '') is null then
    delete from public.erp_product_offers where product_id = p_product;
  else
    insert into public.erp_product_offers (product_id, store_id, offer_price, ends_at, featured, label, promotion_id, updated_by, updated_at)
    values (p_product, p_store, p_offer_price, case when p_offer_price is null then null else v_end end, coalesce(p_featured, false),
            nullif(left(btrim(coalesce(p_label, '')), 30), ''), v_promo, auth.uid(), now())
    on conflict (product_id) do update set offer_price = excluded.offer_price, ends_at = excluded.ends_at, featured = excluded.featured,
      label = excluded.label, promotion_id = excluded.promotion_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  if to_regprocedure('public.erp_audit(uuid,text,text,uuid,jsonb)') is not null then
    perform public.erp_audit(p_store, 'product.offer', 'products', p_product,
      jsonb_build_object('offer_price', p_offer_price, 'ends_on', p_ends_on, 'featured', coalesce(p_featured, false), 'label', p_label));
  end if;
  return public.product_offer_get(p_store, p_product);
end;
$$;

-- ===== Público: ofertas y destacados de un catálogo =====
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
      and (i.price < r.price or coalesce(f.featured, false) or nullif(f.label, '') is not null)));
end;
$$;

revoke all on function public.catalog__items_raw(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.catalog__promo_price(uuid, uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.product_offer_get(uuid, uuid) from public, anon;
revoke all on function public.product_offer_save(uuid, uuid, numeric, date, boolean, text) from public, anon;
revoke all on function public.store_public_offers(text, text, text) from public;
grant execute on function public.product_offer_get(uuid, uuid) to authenticated;
grant execute on function public.product_offer_save(uuid, uuid, numeric, date, boolean, text) to authenticated;
grant execute on function public.store_public_offers(text, text, text) to anon, authenticated;
