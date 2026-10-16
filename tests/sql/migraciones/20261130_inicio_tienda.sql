-- =====================================================================
-- REMHUB · Página de inicio de cada tienda y un dominio por catálogo
--
--   · La tienda escoge qué abre mitienda.remhub.co (y su dominio):
--       detal, mayor, un catálogo de campaña, o «inicio» = vitrina con
--       todos sus catálogos públicos para que el cliente escoja.
--   · Cada dominio propio puede abrir un catálogo distinto
--     (navidad.mitienda.com → campaña de Navidad).
--   · Solo se muestran catálogos públicos (activos y sin clave).
-- Requiere 20261129. No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.store_site (
  store_id uuid primary key references public.stores(id) on delete cascade,
  home_target text not null default 'detal' check (home_target ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.store_site enable row level security;
revoke all on public.store_site from anon, authenticated;

-- Catálogos públicos de una tienda (para la vitrina y para escoger el inicio).
create or replace function public.store__public_catalogs(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'ord'), '[]'::jsonb) from (
    select jsonb_build_object('slug', 'detal', 'name', 'Catálogo', 'kind', 'retail', 'logo_url', s.logo_url, 'headline', null, 'ord', '0') as x
    from public.stores s where s.id = p_store and coalesce(s.catalog_retail, true)
    union all
    select jsonb_build_object('slug', 'mayor', 'name', 'Mayoristas', 'kind', 'wholesale', 'logo_url', s.logo_url, 'headline', null, 'ord', '1')
    from public.stores s where s.id = p_store and coalesce(s.catalog_wholesale, false) and nullif(btrim(coalesce(s.wholesale_key, '')), '') is null
    union all
    select jsonb_build_object('slug', c.slug, 'name', c.name, 'kind', 'catalog', 'logo_url', coalesce(c.logo_url, s.logo_url), 'headline', c.headline,
                              'ord', '2' || lpad(c.sort_order::text, 6, '0') || c.slug)
    from public.store_catalogs c join public.stores s on s.id = c.store_id
    where c.store_id = p_store and c.active and c.access_key is null
  ) t;
$$;
revoke all on function public.store__public_catalogs(uuid) from public, anon, authenticated;

-- ¿Ese catálogo puede ser inicio? (inicio = vitrina; si no, debe ser público)
create or replace function public.store__valid_target(p_store uuid, p_target text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_target = 'inicio'
      or exists (select 1 from jsonb_array_elements(public.store__public_catalogs(p_store)) x where x->>'slug' = p_target);
$$;
revoke all on function public.store__valid_target(uuid, text) from public, anon, authenticated;

-- Panel: inicio actual y catálogos para escoger.
create or replace function public.store_site_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true,
    'home_target', coalesce((select home_target from public.store_site where store_id = p_store), 'detal'),
    'catalogs', public.store__public_catalogs(p_store));
end $$;

create or replace function public.store_site_save(p_store uuid, p_home_target text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_target text := lower(btrim(coalesce(p_home_target, '')));
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then raise exception 'Necesitas el permiso «Mi tienda».'; end if;
  if not public.store__valid_target(p_store, v_target) then raise exception 'Ese catálogo no es público o no existe.'; end if;
  insert into public.store_site (store_id, home_target, updated_by) values (p_store, v_target, auth.uid())
  on conflict (store_id) do update set home_target = excluded.home_target, updated_by = excluded.updated_by, updated_at = now();
  perform public.erp_audit(p_store, 'store.home_target', 'store_site', null, jsonb_build_object('home_target', v_target));
  return jsonb_build_object('ok', true);
end $$;

-- Qué catálogo abre cada dominio propio.
create or replace function public.store_domain_set_target(p_store uuid, p_domain text, p_target text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_target text := lower(btrim(coalesce(p_target, '')));
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then raise exception 'Necesitas el permiso «Mi tienda».'; end if;
  if not public.store__valid_target(p_store, v_target) then raise exception 'Ese catálogo no es público o no existe.'; end if;
  update public.store_domains set target = v_target where store_id = p_store and domain = public.store__clean_domain(p_domain);
  if not found then raise exception 'Ese dominio no está en tu tienda.'; end if;
  perform public.erp_audit(p_store, 'store.domain_target', 'store_domains', null, jsonb_build_object('domain', p_domain, 'target', v_target));
  return jsonb_build_object('ok', true);
end $$;

-- Público: qué abre la raíz de la tienda (lo usa proxy.ts para mitienda.remhub.co).
create or replace function public.store_home_target(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(ss.home_target, 'detal')
  from public.stores s left join public.store_site ss on ss.store_id = s.id
  where lower(s.slug) = lower(p_slug) and coalesce(s.active, true)
  limit 1;
$$;

-- Público: vitrina de la tienda (sus catálogos públicos).
create or replace function public.store_public_home(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', s.name, 'slug', s.slug, 'logo_url', s.logo_url, 'banner_url', s.banner_url, 'whatsapp', s.whatsapp,
                            'home_target', coalesce(ss.home_target, 'detal'), 'catalogs', public.store__public_catalogs(s.id))
  from public.stores s left join public.store_site ss on ss.store_id = s.id
  where lower(s.slug) = lower(p_slug) and coalesce(s.active, true)
  limit 1;
$$;

do $$
declare f text;
begin
  foreach f in array array['store_site_get(uuid)', 'store_site_save(uuid, text)', 'store_domain_set_target(uuid, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['store_home_target(text)', 'store_public_home(text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
