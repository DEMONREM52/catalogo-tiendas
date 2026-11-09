-- 20261308 · Vender más desde el enlace: catálogo por plantilla y «Lo más vendido» en los catálogos
-- (Necesita 20261307.)
--
--   · erp_publish_templates.catalog_slug: catálogo al que lleva el enlace del mensaje (null = catálogo clásico).
--     publish_template_save ahora recibe p_catalog. publish_templates_list lo devuelve.
--   · erp_best_sellers_config + best_sellers_config_get/save (permiso Catálogos o Productos): «Lo más vendido» en
--     automático (por ventas de N días, con productos fijados primero), a mano (solo los escogidos) o apagado;
--     título propio y si se ven las insignias en las tarjetas.
--   · store_public_best_sellers(p_store, p_limit): {ids, title, badges} según esa configuración; solo activos y con
--     unidades. Devuelve SOLO el orden (ids), nunca cantidades ni montos. La usan los visitantes del catálogo (anon).
-- No cambia productos, precios, existencias ni permisos de nadie. Se puede correr varias veces.

alter table public.erp_publish_templates add column if not exists catalog_slug text;

drop function if exists public.publish_template_save(uuid, uuid, text, text, boolean);
create or replace function public.publish_template_save(p_store uuid, p_id uuid, p_name text, p_body text, p_default boolean default false, p_catalog text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_cat text := nullif(lower(btrim(coalesce(p_catalog, ''))), '');
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('ok', false, 'message', 'Ponle un nombre a la plantilla.');
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return jsonb_build_object('ok', false, 'message', 'Escribe el mensaje.');
  end if;
  if length(p_body) > 4000 then
    return jsonb_build_object('ok', false, 'message', 'El mensaje es muy largo (máximo 4.000 letras).');
  end if;
  if v_cat is not null and v_cat !~ '^[a-z0-9][a-z0-9-]{0,47}$' then
    return jsonb_build_object('ok', false, 'message', 'Catálogo no válido.');
  end if;
  if p_id is null and (select count(*) from public.erp_publish_templates t where t.store_id = p_store) >= 30 then
    return jsonb_build_object('ok', false, 'message', 'Máximo 30 plantillas. Borra alguna que no uses.');
  end if;
  if coalesce(p_default, false) then
    update public.erp_publish_templates set is_default = false where store_id = p_store and is_default and id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.erp_publish_templates (store_id, name, body, is_default, created_by, catalog_slug)
    values (p_store, left(btrim(p_name), 60), p_body, coalesce(p_default, false), auth.uid(), v_cat)
    returning id into v_id;
  else
    update public.erp_publish_templates set name = left(btrim(p_name), 60), body = p_body, is_default = coalesce(p_default, false),
      catalog_slug = v_cat, updated_at = now()
    where id = p_id and store_id = p_store returning id into v_id;
    if v_id is null then return jsonb_build_object('ok', false, 'message', 'Esa plantilla no existe.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.publish_templates_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  return jsonb_build_object('ok', true, 'templates', (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'body', t.body, 'is_default', t.is_default,
                                                 'catalog_slug', t.catalog_slug, 'updated_at', t.updated_at)
                              order by t.is_default desc, t.name), '[]'::jsonb)
    from public.erp_publish_templates t where t.store_id = p_store));
end;
$$;

-- ===== Lo más vendido: configuración (Catálogos y campañas) =====
create table if not exists public.erp_best_sellers_config (
  store_id uuid primary key references public.stores(id) on delete cascade,
  mode text not null default 'auto' check (mode in ('auto', 'manual', 'off')),
  title text,
  product_ids uuid[] not null default '{}',
  days integer not null default 60 check (days between 7 and 365),
  show_badges boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.erp_best_sellers_config enable row level security;
revoke all on public.erp_best_sellers_config from anon, authenticated;

create or replace function public.best_sellers_config_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['catalogs', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Catálogos.');
  end if;
  return jsonb_build_object('ok', true, 'config', coalesce(
    (select jsonb_build_object('mode', c.mode, 'title', c.title, 'product_ids', to_jsonb(c.product_ids), 'days', c.days, 'show_badges', c.show_badges)
       from public.erp_best_sellers_config c where c.store_id = p_store),
    jsonb_build_object('mode', 'auto', 'title', null, 'product_ids', '[]'::jsonb, 'days', 60, 'show_badges', true)));
end;
$$;

create or replace function public.best_sellers_config_save(p_store uuid, p_mode text, p_title text, p_product_ids uuid[], p_days integer, p_show_badges boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['catalogs', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Catálogos.');
  end if;
  if coalesce(p_mode, '') not in ('auto', 'manual', 'off') then
    return jsonb_build_object('ok', false, 'message', 'Modo no válido.');
  end if;
  if coalesce(p_days, 60) not between 7 and 365 then
    return jsonb_build_object('ok', false, 'message', 'Los días van de 7 a 365.');
  end if;
  if coalesce(cardinality(p_product_ids), 0) > 30 then
    return jsonb_build_object('ok', false, 'message', 'Máximo 30 productos.');
  end if;
  -- Solo productos de la tienda, sin repetir y en el orden escogido.
  select coalesce(array_agg(x.id order by x.ord), '{}') into v_ids
  from (select distinct on (u.id) u.id, u.ord
        from unnest(coalesce(p_product_ids, '{}')) with ordinality u(id, ord)
        join public.products p on p.id = u.id and p.store_id = p_store
        order by u.id, u.ord) x;
  insert into public.erp_best_sellers_config (store_id, mode, title, product_ids, days, show_badges, updated_at)
  values (p_store, p_mode, nullif(left(btrim(coalesce(p_title, '')), 60), ''), v_ids, coalesce(p_days, 60), coalesce(p_show_badges, true), now())
  on conflict (store_id) do update set mode = excluded.mode, title = excluded.title, product_ids = excluded.product_ids,
    days = excluded.days, show_badges = excluded.show_badges, updated_at = excluded.updated_at;
  return public.best_sellers_config_get(p_store);
end;
$$;

-- ===== Lo más vendido (público: solo el orden, nunca cantidades) =====
drop function if exists public.store_public_best_sellers(text, integer);
create or replace function public.store_public_best_sellers(p_store text, p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store uuid;
  c public.erp_best_sellers_config%rowtype;
  v_lim integer := greatest(1, least(coalesce(p_limit, 12), 30));
  v_ids jsonb;
begin
  select st.id into v_store from public.stores st where st.slug = lower(btrim(p_store)) and coalesce(st.active, true) limit 1;
  if v_store is null then return jsonb_build_object('ids', '[]'::jsonb); end if;
  select * into c from public.erp_best_sellers_config x where x.store_id = v_store;
  if coalesce(c.mode, 'auto') = 'off' then
    return jsonb_build_object('ids', '[]'::jsonb, 'off', true);
  end if;
  with pinned as (
    select u.id, u.ord from unnest(coalesce(c.product_ids, '{}')) with ordinality u(id, ord)
    join public.products p on p.id = u.id and p.store_id = v_store
    where coalesce(p.active, true) and (p.stock is null or p.stock > 0)
  ), ranked as (
    select oi.product_id as id, sum(oi.quantity) as q
    from public.orders o join public.order_items oi on oi.order_id = o.id
    join public.products p on p.id = oi.product_id and p.store_id = v_store
    where coalesce(c.mode, 'auto') = 'auto' and o.store_id = v_store and o.status in ('confirmed', 'completed')
      and o.created_at >= now() - make_interval(days => coalesce(c.days, 60))
      and coalesce(p.active, true) and (p.stock is null or p.stock > 0)
      and not exists (select 1 from pinned pn where pn.id = oi.product_id)
    group by oi.product_id having sum(oi.quantity) > 0
  ), all_ids as (
    select id, 0 as grp, ord::numeric as k from pinned
    union all select id, 1, -q from ranked
  )
  select coalesce(jsonb_agg(a.id order by a.grp, a.k, a.id), '[]'::jsonb) into v_ids
  from (select * from all_ids order by grp, k, id limit v_lim) a;
  return jsonb_build_object('ids', v_ids, 'title', c.title, 'badges', coalesce(c.show_badges, true));
end;
$$;

revoke all on function public.publish_template_save(uuid, uuid, text, text, boolean, text) from public, anon;
revoke all on function public.publish_templates_list(uuid) from public, anon;
revoke all on function public.best_sellers_config_get(uuid) from public, anon;
revoke all on function public.best_sellers_config_save(uuid, text, text, uuid[], integer, boolean) from public, anon;
revoke all on function public.store_public_best_sellers(text, integer) from public;
grant execute on function public.publish_template_save(uuid, uuid, text, text, boolean, text) to authenticated;
grant execute on function public.publish_templates_list(uuid) to authenticated;
grant execute on function public.best_sellers_config_get(uuid) to authenticated;
grant execute on function public.best_sellers_config_save(uuid, text, text, uuid[], integer, boolean) to authenticated;
grant execute on function public.store_public_best_sellers(text, integer) to anon, authenticated;
