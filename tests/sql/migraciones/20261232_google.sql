-- =====================================================================
-- REMHUB · Aparecer en Google
--
--   1. store_seo_settings: el código de verificación de Google Search Console
--      (y de Bing) de cada tienda. RemHub lo pone en todas las páginas
--      públicas de la tienda para que Google confirme que es tuya.
--      · store_seo_get / store_seo_save: panel «Mi tienda» (permiso «Mi tienda»).
--      · store_public_verification(slug): lo leen las páginas públicas.
--   2. store_seo_health(store): qué tan lista está la tienda para Google —
--      datos del negocio, puntos sin dirección y productos con nombre corto,
--      con cara de código, sin foto o sin descripción.
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.store_seo_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  google_verification text check (google_verification is null or google_verification ~ '^[A-Za-z0-9_-]{10,100}$'),
  bing_verification text check (bing_verification is null or bing_verification ~ '^[A-Za-z0-9_-]{10,100}$'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.store_seo_settings enable row level security;
revoke all on public.store_seo_settings from anon, authenticated;

-- Acepta el código solo o la etiqueta completa que copia Google: <meta name="google-site-verification" content="…" />
create or replace function public.store__verification_code(p_raw text)
returns text language sql immutable set search_path = public as $$
  select nullif(coalesce(substring(btrim(coalesce(p_raw, '')) from 'content\s*=\s*["'']([^"'']+)["'']'), btrim(coalesce(p_raw, ''))), '');
$$;
revoke all on function public.store__verification_code(text) from public, anon, authenticated;

create or replace function public.store_seo_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true,
    'google', (select google_verification from public.store_seo_settings where store_id = p_store),
    'bing', (select bing_verification from public.store_seo_settings where store_id = p_store));
end $$;
revoke all on function public.store_seo_get(uuid) from public, anon;
grant execute on function public.store_seo_get(uuid) to authenticated;

create or replace function public.store_seo_save(p_store uuid, p_google text, p_bing text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_google text := public.store__verification_code(p_google);
  v_bing text := public.store__verification_code(p_bing);
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then raise exception 'Necesitas el permiso «Mi tienda».'; end if;
  if v_google is not null and v_google !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'El código de Google no se ve bien. Copia solo lo que va en content="…".'; end if;
  if v_bing is not null and v_bing !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'El código de Bing no se ve bien. Copia solo lo que va en content="…".'; end if;
  insert into public.store_seo_settings (store_id, google_verification, bing_verification, updated_by)
  values (p_store, v_google, v_bing, auth.uid())
  on conflict (store_id) do update set google_verification = excluded.google_verification, bing_verification = excluded.bing_verification,
    updated_by = excluded.updated_by, updated_at = now();
  perform public.erp_audit(p_store, 'store.seo_verification', 'store_seo_settings', null,
    jsonb_build_object('google', v_google is not null, 'bing', v_bing is not null));
  return jsonb_build_object('ok', true, 'google', v_google, 'bing', v_bing);
end $$;
revoke all on function public.store_seo_save(uuid, text, text) from public, anon;
grant execute on function public.store_seo_save(uuid, text, text) to authenticated;

-- Público: solo los códigos (son públicos por diseño: van en el HTML de la página).
create or replace function public.store_public_verification(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('google', ss.google_verification, 'bing', ss.bing_verification)
  from public.stores s join public.store_seo_settings ss on ss.store_id = s.id
  where lower(s.slug) = lower(btrim(coalesce(p_slug, ''))) and s.active
  limit 1;
$$;
revoke all on function public.store_public_verification(text) from public;
grant execute on function public.store_public_verification(text) to anon, authenticated;

-- Qué tan lista está la tienda para Google. Cuenta en la base (sin el tope de 1.000 filas)
-- y devuelve hasta 60 productos para mejorar, primero los que tienen más problemas.
create or replace function public.store_seo_health(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_profile jsonb; v_points jsonb; v_products jsonb; v_counts jsonb; v_store record;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'store') then return jsonb_build_object('ok', false); end if;
  select s.name, s.logo_url, s.banner_url, s.whatsapp into v_store from public.stores s where s.id = p_store;

  if to_regclass('public.store_profiles') is not null then
    execute 'select to_jsonb(sp) from public.store_profiles sp where sp.store_id = $1' into v_profile using p_store;
  end if;
  v_profile := coalesce(v_profile, '{}'::jsonb);

  -- Catálogos de cada punto (la página que Google muestra al buscar «tienda + punto»).
  if to_regclass('public.store_catalogs') is not null and to_regclass('public.erp_warehouses') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'point', w.name,
          'has_address', nullif(btrim(coalesce(to_jsonb(c)->>'address', '')), '') is not null,
          'has_city', coalesce(nullif(btrim(coalesce(to_jsonb(c)->>'city', '')), ''), nullif(btrim(coalesce(to_jsonb(w)->>'city', '')), '')) is not null,
          'has_whatsapp', nullif(btrim(coalesce(to_jsonb(c)->>'whatsapp', '')), '') is not null) order by c.name), '[]'::jsonb)
      from public.store_catalogs c join public.erp_warehouses w on w.id = c.point_id and w.store_id = c.store_id
      where c.store_id = $1 and coalesce((to_jsonb(c)->>'active')::boolean, true) and to_jsonb(c)->>'access_key' is null
    $q$ into v_points using p_store;
  end if;

  with p as (
    select pr.id, pr.name, pr.image_url,
      array_remove(array[
        case when coalesce(pr.image_url, '') !~* '^https://' then 'sin foto' end,
        -- «ZAP-04», «REF 1088»: tiene números y ninguna palabra de 4 letras o más.
        case when pr.name ~ '[0-9]' and pr.name !~* '[a-záéíóúñü]{4,}' then 'nombre tipo código'
             when length(btrim(pr.name)) < 8 or array_length(regexp_split_to_array(btrim(pr.name), '\s+'), 1) < 2 then 'nombre muy corto' end,
        case when coalesce(btrim(pr.description), '') = '' and coalesce(btrim(pr.product_details->>'long_description'), '') = '' then 'sin descripción' end
      ], null) as issues
    from public.products pr
    where pr.store_id = p_store and coalesce(pr.active, true) and (pr.stock is null or pr.stock > 0)
  )
  select
    jsonb_build_object(
      'published', count(*),
      'no_photo', count(*) filter (where 'sin foto' = any(issues)),
      'code_name', count(*) filter (where 'nombre tipo código' = any(issues)),
      'short_name', count(*) filter (where 'nombre muy corto' = any(issues)),
      'no_description', count(*) filter (where 'sin descripción' = any(issues)),
      'good', count(*) filter (where cardinality(issues) = 0)),
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'image', x.image_url, 'issues', to_jsonb(x.issues)))
      from (select * from p where cardinality(issues) > 0 order by cardinality(issues) desc, name limit 60) x), '[]'::jsonb)
  into v_counts, v_products
  from p;

  return jsonb_build_object('ok', true,
    'store', jsonb_build_object(
      'name', v_store.name,
      'logo', coalesce(v_store.logo_url, '') ~* '^https://',
      'banner', coalesce(v_store.banner_url, '') ~* '^https://',
      'whatsapp', coalesce(btrim(v_store.whatsapp), '') <> '',
      'headline', coalesce(btrim(v_profile->>'headline'), '') <> '',
      'city', coalesce(btrim(v_profile->>'city'), '') <> '',
      'address', coalesce(btrim(v_profile->>'address'), '') <> ''),
    'verification', exists (select 1 from public.store_seo_settings ss where ss.store_id = p_store and ss.google_verification is not null),
    'points', coalesce(v_points, '[]'::jsonb),
    'counts', v_counts,
    'products', v_products);
end $$;
revoke all on function public.store_seo_health(uuid) from public, anon;
grant execute on function public.store_seo_health(uuid) to authenticated;

notify pgrst, 'reload schema';
