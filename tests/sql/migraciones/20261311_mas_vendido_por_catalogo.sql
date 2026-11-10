-- 20261311 · «Lo más vendido» independiente por catálogo
-- (Necesita 20261308.)
--
--   · Configuración GENERAL (erp_best_sellers_config): ahora también catalog_slugs (en qué catálogos sale; vacío =
--     en todos), max_items (cuántos, 3 a 30), subtitle (texto pequeño) e icon (emoji del título).
--   · Configuración POR CATÁLOGO (erp_best_sellers_catalog): un catálogo puede tener la suya propia (modo, productos
--     fijados o escogidos, título, días, insignias, cantidad, subtítulo, emoji). Si no tiene, usa la general.
--   · En automático, un catálogo con punto (p. ej. Zamora) cuenta las ventas de ESE punto; sin punto, las de toda la
--     tienda. Así cada catálogo muestra lo suyo. Los precios siguen siendo los de cada catálogo.
--   · best_sellers_config_get (general + los de cada catálogo), best_sellers_config_save (general),
--     best_sellers_catalog_save / best_sellers_catalog_reset (por catálogo).
--   · store_public_best_sellers(p_store, p_limit, p_catalog): usa la del catálogo o la general.
-- No cambia productos, precios, existencias ni permisos. Se puede correr varias veces.

alter table public.erp_best_sellers_config add column if not exists catalog_slugs text[] not null default '{}';
alter table public.erp_best_sellers_config add column if not exists max_items integer not null default 12;
alter table public.erp_best_sellers_config add column if not exists subtitle text;
alter table public.erp_best_sellers_config add column if not exists icon text;
do $$ begin
  alter table public.erp_best_sellers_config add constraint erp_best_sellers_max_items check (max_items between 3 and 30);
exception when duplicate_object then null; end $$;

create table if not exists public.erp_best_sellers_catalog (
  store_id uuid not null references public.stores(id) on delete cascade,
  catalog_slug text not null check (catalog_slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  mode text not null default 'auto' check (mode in ('auto', 'manual', 'off')),
  title text,
  product_ids uuid[] not null default '{}',
  days integer not null default 60 check (days between 7 and 365),
  show_badges boolean not null default true,
  max_items integer not null default 12 check (max_items between 3 and 30),
  subtitle text,
  icon text,
  updated_at timestamptz not null default now(),
  primary key (store_id, catalog_slug)
);
alter table public.erp_best_sellers_catalog enable row level security;
revoke all on public.erp_best_sellers_catalog from anon, authenticated;

-- Productos de la tienda, sin repetir y en el orden escogido (máx. 30).
create or replace function public.bs__clean_ids(p_store uuid, p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x.id order by x.ord), '{}')
  from (select distinct on (u.id) u.id, u.ord
        from unnest(coalesce(p_ids, '{}')) with ordinality u(id, ord)
        join public.products p on p.id = u.id and p.store_id = p_store
        order by u.id, u.ord) x
$$;
revoke all on function public.bs__clean_ids(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.best_sellers_config_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['catalogs', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Catálogos.');
  end if;
  return jsonb_build_object('ok', true,
    'config', coalesce(
      (select jsonb_build_object('mode', c.mode, 'title', c.title, 'product_ids', to_jsonb(c.product_ids), 'days', c.days, 'show_badges', c.show_badges,
               'catalog_slugs', to_jsonb(c.catalog_slugs), 'max_items', c.max_items, 'subtitle', c.subtitle, 'icon', c.icon)
         from public.erp_best_sellers_config c where c.store_id = p_store),
      jsonb_build_object('mode', 'auto', 'title', null, 'product_ids', '[]'::jsonb, 'days', 60, 'show_badges', true,
               'catalog_slugs', '[]'::jsonb, 'max_items', 12, 'subtitle', null, 'icon', null)),
    'catalogs', (select coalesce(jsonb_object_agg(k.catalog_slug, jsonb_build_object('mode', k.mode, 'title', k.title, 'product_ids', to_jsonb(k.product_ids),
               'days', k.days, 'show_badges', k.show_badges, 'max_items', k.max_items, 'subtitle', k.subtitle, 'icon', k.icon)), '{}'::jsonb)
                 from public.erp_best_sellers_catalog k where k.store_id = p_store));
end;
$$;

drop function if exists public.best_sellers_config_save(uuid, text, text, uuid[], integer, boolean);
drop function if exists public.best_sellers_config_save(uuid, text, text, uuid[], integer, boolean, text[], integer, text, text);
create or replace function public.best_sellers_config_save(p_store uuid, p_mode text, p_title text, p_product_ids uuid[], p_days integer, p_show_badges boolean,
  p_catalog_slugs text[] default '{}', p_max_items integer default 12, p_subtitle text default null, p_icon text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_cats text[];
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['catalogs', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Catálogos.');
  end if;
  if coalesce(p_mode, '') not in ('auto', 'manual', 'off') then return jsonb_build_object('ok', false, 'message', 'Modo no válido.'); end if;
  if coalesce(p_days, 60) not between 7 and 365 then return jsonb_build_object('ok', false, 'message', 'Los días van de 7 a 365.'); end if;
  if coalesce(p_max_items, 12) not between 3 and 30 then return jsonb_build_object('ok', false, 'message', 'Se muestran de 3 a 30 productos.'); end if;
  if coalesce(cardinality(p_product_ids), 0) > 30 then return jsonb_build_object('ok', false, 'message', 'Máximo 30 productos.'); end if;
  select coalesce(array_agg(distinct lower(btrim(s))) filter (where lower(btrim(s)) ~ '^[a-z0-9][a-z0-9-]{0,47}$'), '{}') into v_cats
  from unnest(coalesce(p_catalog_slugs, '{}')) s;
  insert into public.erp_best_sellers_config (store_id, mode, title, product_ids, days, show_badges, catalog_slugs, max_items, subtitle, icon, updated_at)
  values (p_store, p_mode, nullif(left(btrim(coalesce(p_title, '')), 60), ''), public.bs__clean_ids(p_store, p_product_ids), coalesce(p_days, 60),
          coalesce(p_show_badges, true), v_cats, coalesce(p_max_items, 12), nullif(left(btrim(coalesce(p_subtitle, '')), 80), ''),
          nullif(left(btrim(coalesce(p_icon, '')), 16), ''), now())
  on conflict (store_id) do update set mode = excluded.mode, title = excluded.title, product_ids = excluded.product_ids,
    days = excluded.days, show_badges = excluded.show_badges, catalog_slugs = excluded.catalog_slugs, max_items = excluded.max_items,
    subtitle = excluded.subtitle, icon = excluded.icon, updated_at = excluded.updated_at;
  return public.best_sellers_config_get(p_store);
end;
$$;

create or replace function public.best_sellers_catalog_save(p_store uuid, p_catalog text, p_mode text, p_title text, p_product_ids uuid[], p_days integer,
  p_show_badges boolean, p_max_items integer, p_subtitle text, p_icon text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_cat text := lower(btrim(coalesce(p_catalog, '')));
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['catalogs', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Catálogos.');
  end if;
  if v_cat !~ '^[a-z0-9][a-z0-9-]{0,47}$' then return jsonb_build_object('ok', false, 'message', 'Catálogo no válido.'); end if;
  if coalesce(p_mode, '') not in ('auto', 'manual', 'off') then return jsonb_build_object('ok', false, 'message', 'Modo no válido.'); end if;
  if coalesce(p_days, 60) not between 7 and 365 then return jsonb_build_object('ok', false, 'message', 'Los días van de 7 a 365.'); end if;
  if coalesce(p_max_items, 12) not between 3 and 30 then return jsonb_build_object('ok', false, 'message', 'Se muestran de 3 a 30 productos.'); end if;
  if coalesce(cardinality(p_product_ids), 0) > 30 then return jsonb_build_object('ok', false, 'message', 'Máximo 30 productos.'); end if;
  insert into public.erp_best_sellers_catalog (store_id, catalog_slug, mode, title, product_ids, days, show_badges, max_items, subtitle, icon, updated_at)
  values (p_store, v_cat, p_mode, nullif(left(btrim(coalesce(p_title, '')), 60), ''), public.bs__clean_ids(p_store, p_product_ids), coalesce(p_days, 60),
          coalesce(p_show_badges, true), coalesce(p_max_items, 12), nullif(left(btrim(coalesce(p_subtitle, '')), 80), ''),
          nullif(left(btrim(coalesce(p_icon, '')), 16), ''), now())
  on conflict (store_id, catalog_slug) do update set mode = excluded.mode, title = excluded.title, product_ids = excluded.product_ids,
    days = excluded.days, show_badges = excluded.show_badges, max_items = excluded.max_items, subtitle = excluded.subtitle, icon = excluded.icon,
    updated_at = excluded.updated_at;
  return public.best_sellers_config_get(p_store);
end;
$$;

create or replace function public.best_sellers_catalog_reset(p_store uuid, p_catalog text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['catalogs', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Catálogos.');
  end if;
  delete from public.erp_best_sellers_catalog where store_id = p_store and catalog_slug = lower(btrim(coalesce(p_catalog, '')));
  return public.best_sellers_config_get(p_store);
end;
$$;

drop function if exists public.store_public_best_sellers(text, integer);
drop function if exists public.store_public_best_sellers(text, integer, text);
create or replace function public.store_public_best_sellers(p_store text, p_limit integer default 12, p_catalog text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_cat text := nullif(lower(btrim(coalesce(p_catalog, ''))), '');
  g public.erp_best_sellers_config%rowtype;
  k public.erp_best_sellers_catalog%rowtype;
  v_mode text; v_title text; v_ids_cfg uuid[]; v_days integer; v_badges boolean; v_max integer; v_sub text; v_icon text;
  v_point uuid;
  v_lim integer;
  v_ids jsonb;
begin
  select st.id into v_store from public.stores st where st.slug = lower(btrim(p_store)) and coalesce(st.active, true) limit 1;
  if v_store is null then return jsonb_build_object('ids', '[]'::jsonb); end if;
  select * into g from public.erp_best_sellers_config x where x.store_id = v_store;
  if v_cat is not null then select * into k from public.erp_best_sellers_catalog x where x.store_id = v_store and x.catalog_slug = v_cat; end if;

  if k.store_id is not null then
    -- Este catálogo tiene la suya.
    v_mode := k.mode; v_title := k.title; v_ids_cfg := k.product_ids; v_days := k.days; v_badges := k.show_badges;
    v_max := k.max_items; v_sub := k.subtitle; v_icon := k.icon;
  else
    -- La general (y solo en los catálogos escogidos).
    if v_cat is not null and coalesce(cardinality(g.catalog_slugs), 0) > 0 and not (v_cat = any (g.catalog_slugs)) then
      return jsonb_build_object('ids', '[]'::jsonb, 'hidden', true);
    end if;
    v_mode := coalesce(g.mode, 'auto'); v_title := g.title; v_ids_cfg := coalesce(g.product_ids, '{}'); v_days := coalesce(g.days, 60);
    v_badges := coalesce(g.show_badges, true); v_max := coalesce(g.max_items, 12); v_sub := g.subtitle; v_icon := g.icon;
  end if;
  if v_mode = 'off' then return jsonb_build_object('ids', '[]'::jsonb, 'off', true); end if;

  -- Catálogo con punto: cuenta las ventas de ese punto.
  if v_cat is not null then
    select c.point_id into v_point from public.store_catalogs c where c.store_id = v_store and lower(c.slug) = v_cat limit 1;
  end if;
  v_lim := greatest(1, least(coalesce(p_limit, 12), v_max, 30));
  with pinned as (
    select u.id, u.ord from unnest(coalesce(v_ids_cfg, '{}')) with ordinality u(id, ord)
    join public.products p on p.id = u.id and p.store_id = v_store
    where coalesce(p.active, true) and (p.stock is null or p.stock > 0)
  ), ranked as (
    select oi.product_id as id, sum(oi.quantity) as q
    from public.orders o join public.order_items oi on oi.order_id = o.id
    join public.products p on p.id = oi.product_id and p.store_id = v_store
    left join public.erp_order_meta m on m.order_id = o.id
    where v_mode = 'auto' and o.store_id = v_store and o.status in ('confirmed', 'completed')
      and o.created_at >= now() - make_interval(days => v_days)
      and (v_point is null or m.point_id = v_point)
      and coalesce(p.active, true) and (p.stock is null or p.stock > 0)
      and not exists (select 1 from pinned pn where pn.id = oi.product_id)
    group by oi.product_id having sum(oi.quantity) > 0
  ), all_ids as (
    select id, 0 as grp, ord::numeric as kk from pinned
    union all select id, 1, -q from ranked
  )
  select coalesce(jsonb_agg(a.id order by a.grp, a.kk, a.id), '[]'::jsonb) into v_ids
  from (select * from all_ids order by grp, kk, id limit v_lim) a;
  return jsonb_build_object('ids', v_ids, 'title', v_title, 'badges', v_badges, 'subtitle', v_sub, 'icon', v_icon, 'own', k.store_id is not null);
end;
$$;

revoke all on function public.best_sellers_config_save(uuid, text, text, uuid[], integer, boolean, text[], integer, text, text) from public, anon;
revoke all on function public.best_sellers_catalog_save(uuid, text, text, text, uuid[], integer, boolean, integer, text, text) from public, anon;
revoke all on function public.best_sellers_catalog_reset(uuid, text) from public, anon;
revoke all on function public.store_public_best_sellers(text, integer, text) from public;
grant execute on function public.best_sellers_config_save(uuid, text, text, uuid[], integer, boolean, text[], integer, text, text) to authenticated;
grant execute on function public.best_sellers_catalog_save(uuid, text, text, text, uuid[], integer, boolean, integer, text, text) to authenticated;
grant execute on function public.best_sellers_catalog_reset(uuid, text) to authenticated;
grant execute on function public.store_public_best_sellers(text, integer, text) to anon, authenticated;
