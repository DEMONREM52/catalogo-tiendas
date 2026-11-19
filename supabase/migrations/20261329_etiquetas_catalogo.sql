-- =====================================================================
-- REMHUB · Etiquetas del producto en el catálogo
-- (Necesita 20261309 «ofertas y destacados».)
--
-- Desde el producto se eligen, cada una con su «desde» y «hasta»:
--   · new        🆕 Llegó nuevo
--   · price_drop ⬇️ Bajó de precio: el precio «antes» lo ESCRIBE la persona
--                 (decisión del dueño). Solo se muestra tachado si es mayor
--                 que el precio que ese catálogo cobra hoy.
--   · promo      🔥 En promoción (con un texto corto opcional, ej. «2x1»)
--   · featured   ⭐ Destacado: mientras esté activo sale primero, igual
--                 que el destacado de siempre.
-- Fuera de sus fechas no se ven (se apagan solas). No cambian precios,
-- costos ni existencias: lo que se cobra sigue siendo el precio del
-- catálogo (o la oferta de 20261309, si hay).
--
-- Permisos: poner o quitar etiquetas = «Productos» (products). «Bajó de
-- precio» además «Cambiar precios» (products_prices), porque muestra un
-- precio. No cambia permisos existentes. Es idempotente.
--
-- store_public_offers devuelve además las etiquetas activas (badges) y,
-- para «Bajó de precio», el precio de antes y el %. catalog__items cuenta
-- el destacado con fechas. El resto de ambas funciones queda igual.
-- =====================================================================

create table if not exists public.erp_product_badges (
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('new', 'price_drop', 'promo', 'featured')),
  store_id uuid not null references public.stores(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  before_price numeric(14, 2) check (before_price is null or before_price > 0),
  text text check (text is null or char_length(text) <= 30),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (product_id, kind),
  check (ends_at is null or ends_at > starts_at),
  check (kind <> 'price_drop' or before_price is not null)
);
create index if not exists erp_product_badges_store on public.erp_product_badges (store_id);
alter table public.erp_product_badges enable row level security;
revoke all on public.erp_product_badges from anon, authenticated;

-- Etiquetas vigentes de un producto (ahora mismo).
create or replace function public.erp__badges_now(p_product uuid)
returns table (is_new boolean, before_price numeric, is_promo boolean, promo_text text, is_featured boolean, any_on boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(b.kind = 'new'), false),
         max(b.before_price) filter (where b.kind = 'price_drop'),
         coalesce(bool_or(b.kind = 'promo'), false),
         max(b.text) filter (where b.kind = 'promo'),
         coalesce(bool_or(b.kind = 'featured'), false),
         count(*) > 0
  from public.erp_product_badges b
  where b.product_id = p_product and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())
$$;
revoke all on function public.erp__badges_now(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- leer y guardar
create or replace function public.product_badges_get(p_store uuid, p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['products', 'products_prices', 'products_view']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if not exists (select 1 from public.products where id = p_product and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'Ese producto no es de tu tienda.');
  end if;
  return jsonb_build_object('ok', true,
    'can_edit', public.erp_can_any(p_store, array['products']::text[]),
    'can_price', public.erp_can_any(p_store, array['products_prices']::text[]),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', b.kind, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'before_price', b.before_price, 'text', b.text,
        'running', b.starts_at <= now() and (b.ends_at is null or b.ends_at > now()),
        'finished', b.ends_at is not null and b.ends_at <= now()))
      from public.erp_product_badges b where b.product_id = p_product), '[]'::jsonb));
end $$;

create or replace function public.product_badge_save(p_store uuid, p_product uuid, p_kind text, p_on boolean,
  p_starts date default null, p_ends date default null, p_before numeric default null, p_text text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text;
  v_start timestamptz;
  v_end timestamptz;
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  if p_kind not in ('new', 'price_drop', 'promo', 'featured') then
    return jsonb_build_object('ok', false, 'message', 'Etiqueta no válida.');
  end if;
  if auth.uid() is null or not public.erp_can_any(p_store, array['products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Poner etiquetas requiere el permiso «Productos».');
  end if;
  if p_kind = 'price_drop' and not public.erp_can_any(p_store, array['products_prices']::text[]) then
    return jsonb_build_object('ok', false, 'message', '«Bajó de precio» muestra un precio: requiere también «Cambiar precios».');
  end if;
  select p.name into v_name from public.products p where p.id = p_product and p.store_id = p_store;
  if v_name is null then return jsonb_build_object('ok', false, 'message', 'Ese producto no es de tu tienda.'); end if;

  if not coalesce(p_on, false) then
    delete from public.erp_product_badges where product_id = p_product and kind = p_kind;
    perform public.erp_audit(p_store, 'product.badge_off', 'products', p_product, jsonb_build_object('kind', p_kind, 'name', v_name));
    return jsonb_build_object('ok', true, 'on', false);
  end if;

  -- Desde el inicio de ese día y hasta el final del día «hasta» (hora Colombia).
  v_start := case when p_starts is null or p_starts <= v_today then now() else (p_starts::timestamp at time zone 'America/Bogota') end;
  v_end := case when p_ends is null then null else ((p_ends + 1)::timestamp at time zone 'America/Bogota') end;
  if v_end is not null and v_end <= now() then
    return jsonb_build_object('ok', false, 'message', 'La fecha «hasta» ya pasó.');
  end if;
  if v_end is not null and v_end <= v_start then
    return jsonb_build_object('ok', false, 'message', '«Hasta» debe ser después de «desde».');
  end if;
  if p_kind = 'price_drop' and (p_before is null or p_before <= 0) then
    return jsonb_build_object('ok', false, 'message', 'Escribe el precio de antes.');
  end if;

  insert into public.erp_product_badges (product_id, kind, store_id, starts_at, ends_at, before_price, text, updated_by, updated_at)
  values (p_product, p_kind, p_store, v_start, v_end,
          case when p_kind = 'price_drop' then round(p_before, 2) end,
          case when p_kind = 'promo' then nullif(left(btrim(coalesce(p_text, '')), 30), '') end,
          auth.uid(), now())
  on conflict (product_id, kind) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    before_price = excluded.before_price, text = excluded.text, updated_by = excluded.updated_by, updated_at = now();
  perform public.erp_audit(p_store, 'product.badge_on', 'products', p_product,
    jsonb_build_object('kind', p_kind, 'name', v_name, 'starts_at', v_start, 'ends_at', v_end, 'before_price', p_before));
  return jsonb_build_object('ok', true, 'on', true, 'starts_at', v_start, 'ends_at', v_end);
end $$;

revoke all on function public.product_badges_get(uuid, uuid) from public, anon;
revoke all on function public.product_badge_save(uuid, uuid, text, boolean, date, date, numeric, text) from public, anon;
grant execute on function public.product_badges_get(uuid, uuid) to authenticated;
grant execute on function public.product_badge_save(uuid, uuid, text, boolean, date, date, numeric, text) to authenticated;

-- ---------------------------------------------------------------- catálogo: destacado con fechas
create or replace function public.catalog__items(p_catalog uuid, p_ids uuid[] default null::uuid[])
returns table(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.product_id, r.category_key,
         case when o.v is not null and o.v > 0 and o.v < r.price then o.v else r.price end,
         r.base_price, r.stock,
         r.featured or coalesce(f.featured, false)
           or exists (select 1 from public.erp_product_badges b where b.product_id = r.product_id and b.kind = 'featured'
                        and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())),
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

-- ---------------------------------------------------------------- catálogo: ofertas + etiquetas
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
             'id', x.product_id, 'now', x.price, 'before', x.before,
             'pct', case when x.before is not null and x.before > 0 then round(100 * (1 - x.price / x.before)) end,
             'ends_at', x.ends_at, 'label', x.label, 'featured', x.featured,
             'badges', to_jsonb(array_remove(array[
                 case when x.is_new then 'new' end,
                 case when x.drop_ok then 'price_drop' end,
                 case when x.is_promo then 'promo' end,
                 case when x.is_featured then 'featured' end], null)),
             'promo_text', x.promo_text)
           order by (x.before is not null) desc, x.featured desc), '[]'::jsonb)
    from (
      select i.product_id, i.price,
             -- Oferta de verdad (20261309) primero; si no, el «antes» escrito en «Bajó de precio».
             case when i.price < r.price then r.price when bd.before_price > i.price then bd.before_price end as before,
             case when i.price < r.price then (
               select min(pr.ends_at) from public.erp_promotions pr
               where pr.store_id = c.store_id and pr.active and now() between pr.starts_at and pr.ends_at and pr.ends_at < '2099-01-01'
                 and pr.scope = 'product' and i.product_id = any (pr.product_ids))
               when bd.before_price > i.price then (
               select b.ends_at from public.erp_product_badges b where b.product_id = i.product_id and b.kind = 'price_drop') end as ends_at,
             case when i.price < r.price then f.label
                  when bd.before_price > i.price then coalesce(nullif(f.label, ''), 'Bajó de precio')
                  else f.label end as label,
             coalesce(f.featured, false) or i.featured as featured,
             bd.is_new, coalesce(bd.before_price > i.price and not (i.price < r.price), false) as drop_ok, bd.is_promo, bd.promo_text,
             bd.is_featured, bd.any_on, r.price as raw_price
      from public.catalog__items(v_catalog) i
      join public.catalog__items_raw(v_catalog) r on r.product_id = i.product_id
      join public.store_catalogs c on c.id = v_catalog
      left join public.erp_product_offers f on f.product_id = i.product_id
      cross join lateral public.erp__badges_now(i.product_id) bd
      where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
        and (i.price < r.price or coalesce(f.featured, false) or nullif(f.label, '') is not null or bd.any_on)
    ) x));
end;
$$;

revoke all on function public.store_public_offers(text, text, text) from public;
grant execute on function public.store_public_offers(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
