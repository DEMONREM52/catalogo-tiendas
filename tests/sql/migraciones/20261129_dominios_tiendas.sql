-- =====================================================================
-- REMHUB · Dominio propio de cada tienda (multitienda)
--
--   · Cada tienda puede conectar su dominio: catalogo.mitienda.com o
--     mitienda.com abre su catálogo (y sus productos en /producto/…).
--   · Además, toda tienda tiene gratis mitienda.remhub.co (no necesita tabla).
--   · Google ve una sola dirección por página (la del dominio de la tienda).
--
-- Seguridad: solo quien tiene «Mi tienda» agrega o quita dominios; nadie
-- puede usar dominios de RemHub; un dominio pertenece a una sola tienda; el
-- estado lo confirma el servidor (Vercel) con la llave de servicio.
-- La consulta pública solo devuelve el slug de la tienda de ese dominio.
-- Tablas nuevas sin acceso directo. No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.store_domains (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  domain text not null,
  target text not null default 'detal',          -- catálogo que abre en la raíz: detal, mayor o el de un catálogo
  status text not null default 'pending' check (status in ('pending', 'active', 'error')),
  status_detail text,
  dns jsonb,                                      -- registros que debe crear el dueño (los da Vercel)
  is_primary boolean not null default true,
  checked_at timestamptz,
  verified_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint store_domains_format check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$'),
  constraint store_domains_target check (target ~ '^[a-z0-9][a-z0-9-]{0,47}$')
);
create unique index if not exists store_domains_domain on public.store_domains (domain);
create index if not exists store_domains_store on public.store_domains (store_id);
alter table public.store_domains enable row level security;
revoke all on public.store_domains from anon, authenticated;

-- Dominio limpio: sin http(s)://, sin ruta, sin puerto, minúsculas.
create or replace function public.store__clean_domain(p text)
returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^https?://', ''), '[/:?#].*$', '');
$$;

-- Lista para el panel de la tienda.
create or replace function public.store_domain_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Mi tienda».'); end if;
  return jsonb_build_object('ok', true,
    'slug', (select slug from public.stores where id = p_store),
    'domains', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'domain', d.domain, 'target', d.target, 'status', d.status,
                                 'status_detail', d.status_detail, 'dns', d.dns, 'is_primary', d.is_primary, 'checked_at', d.checked_at,
                                 'verified_at', d.verified_at, 'created_at', d.created_at) order by d.created_at)
                         from public.store_domains d where d.store_id = p_store), '[]'::jsonb));
end $$;

create or replace function public.store_domain_add(p_store uuid, p_domain text, p_target text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_domain text := public.store__clean_domain(p_domain); v_target text := lower(coalesce(nullif(btrim(p_target), ''), 'detal')); v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then raise exception 'Necesitas el permiso «Mi tienda».'; end if;
  if v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' then raise exception 'Escribe un dominio válido, por ejemplo catalogo.mitienda.com'; end if;
  if v_domain ~ '(^|\.)remhub\.(co|store|com)$' or v_domain ~ '(^|\.)(vercel\.app|vercel\.com|supabase\.co)$' then
    raise exception 'Ese dominio no se puede usar. Usa uno propio de tu negocio.';
  end if;
  if v_target !~ '^[a-z0-9][a-z0-9-]{0,47}$' then raise exception 'Catálogo inválido.'; end if;
  if exists (select 1 from public.store_domains where domain = v_domain and store_id <> p_store) then
    raise exception 'Ese dominio ya está conectado a otra tienda.';
  end if;
  if (select count(*) from public.store_domains where store_id = p_store) >= 3 and not exists (select 1 from public.store_domains where domain = v_domain) then
    raise exception 'Máximo 3 dominios por tienda.';
  end if;
  insert into public.store_domains (store_id, domain, target, is_primary, created_by, created_by_name)
  values (p_store, v_domain, v_target, not exists (select 1 from public.store_domains where store_id = p_store), auth.uid(), public.erp_actor_name(p_store))
  on conflict (domain) do update set target = excluded.target
  returning id into v_id;
  perform public.erp_audit(p_store, 'store.domain_added', 'store_domains', v_id, jsonb_build_object('domain', v_domain, 'target', v_target));
  return jsonb_build_object('ok', true, 'id', v_id, 'domain', v_domain);
end $$;

create or replace function public.store_domain_remove(p_store uuid, p_domain text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_domain text := public.store__clean_domain(p_domain); d public.store_domains;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then raise exception 'Necesitas el permiso «Mi tienda».'; end if;
  delete from public.store_domains where store_id = p_store and domain = v_domain returning * into d;
  if d.id is null then raise exception 'Ese dominio no está en tu tienda.'; end if;
  if d.is_primary then
    update public.store_domains set is_primary = true
    where id = (select id from public.store_domains where store_id = p_store order by created_at limit 1);
  end if;
  perform public.erp_audit(p_store, 'store.domain_removed', 'store_domains', d.id, jsonb_build_object('domain', v_domain));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.store_domain_set_primary(p_store uuid, p_domain text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_domain text := public.store__clean_domain(p_domain);
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then raise exception 'Necesitas el permiso «Mi tienda».'; end if;
  if not exists (select 1 from public.store_domains where store_id = p_store and domain = v_domain) then raise exception 'Ese dominio no está en tu tienda.'; end if;
  update public.store_domains set is_primary = (domain = v_domain) where store_id = p_store;
  return jsonb_build_object('ok', true);
end $$;

-- El servidor (con la llave de servicio) guarda lo que respondió Vercel.
create or replace function public.store_domain_set_status(p_domain text, p_status text, p_detail text, p_dns jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('pending', 'active', 'error') then raise exception 'Estado inválido.'; end if;
  update public.store_domains
  set status = p_status, status_detail = left(p_detail, 300), dns = p_dns, checked_at = now(),
      verified_at = case when p_status = 'active' then coalesce(verified_at, now()) else verified_at end
  where domain = public.store__clean_domain(p_domain);
end $$;

-- Público: ¿qué tienda abre este dominio? (solo devuelve el slug y el catálogo de inicio)
create or replace function public.store_domain_resolve(p_host text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', s.slug, 'target', d.target)
  from public.store_domains d join public.stores s on s.id = d.store_id
  where d.domain = public.store__clean_domain(p_host) and d.status <> 'error' and coalesce(s.active, true)
  limit 1;
$$;

-- Público: dominio principal de una tienda (para que Google vea una sola dirección).
create or replace function public.store_public_domain(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('domain', d.domain, 'target', d.target)
  from public.store_domains d join public.stores s on s.id = d.store_id
  where lower(s.slug) = lower(p_slug) and d.status = 'active'
  order by d.is_primary desc, d.created_at
  limit 1;
$$;

revoke all on function public.store__clean_domain(text) from public;
grant execute on function public.store__clean_domain(text) to anon, authenticated, service_role;
do $$
declare f text;
begin
  foreach f in array array['store_domain_list(uuid)', 'store_domain_add(uuid, text, text)', 'store_domain_remove(uuid, text)', 'store_domain_set_primary(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.store_domain_set_status(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.store_domain_set_status(text, text, text, jsonb) to service_role;
revoke all on function public.store_domain_resolve(text) from public;
grant execute on function public.store_domain_resolve(text) to anon, authenticated, service_role;
revoke all on function public.store_public_domain(text) from public;
grant execute on function public.store_public_domain(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
