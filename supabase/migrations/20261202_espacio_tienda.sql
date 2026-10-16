-- =====================================================================
-- REMHUB · Espacio de cada tienda (tienda.remhub.co) — catálogos por punto,
--          enlaces con fecha y origen, tienda pausada y tablero del admin
--
--   · Catálogos por punto: el usuario de un punto (ej. Zamora) crea y edita
--     SOLO los catálogos de su punto, sus productos, categorías y enlaces
--     cortos. La tienda madre (dueño, administradores y usuarios sin punto)
--     edita todos. Ver, pueden ver todos.
--   · Enlaces cortos con fecha («/promo» → Navidad hasta el 31-12; después
--     vuelve al inicio) y con origen (/ig, /tiktok → cuántos llegan por cada uno).
--   · La vitrina agrupa los catálogos de cada punto («Escoge tu punto»).
--   · Tienda pausada: se muestra una página con su logo, no un error.
--   · Tablero del admin de RemHub: subdominio, dominios, nombres viejos,
--     enlaces y visitas de cada tienda.
-- Requiere 20261201. No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogos por punto
-- ---------------------------------------------------------------------

-- ¿El usuario actual puede cambiar este catálogo? (madre: todos; punto: solo los de su punto)
create or replace function public.store__catalog_point_ok(p_catalog uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.erp_my_points(c.store_id) is null or public.erp_point_allowed(c.store_id, c.point_id)
                   from public.store_catalogs c where c.id = p_catalog), true);
$$;
revoke all on function public.store__catalog_point_ok(uuid) from public, anon;
grant execute on function public.store__catalog_point_ok(uuid) to authenticated;

do $$
declare t text; c text;
begin
  -- Catálogos: crear, cambiar y borrar solo los de su punto (el de la tienda madre no tiene punto: solo la madre).
  foreach c in array array['insert', 'update', 'delete'] loop
    execute format('drop policy if exists store_catalogs_point_%s on public.store_catalogs', c);
  end loop;
  execute $p$create policy store_catalogs_point_insert on public.store_catalogs as restrictive for insert to authenticated
    with check (public.erp_my_points(store_id) is null or public.erp_point_allowed(store_id, point_id))$p$;
  execute $p$create policy store_catalogs_point_update on public.store_catalogs as restrictive for update to authenticated
    using (public.erp_my_points(store_id) is null or public.erp_point_allowed(store_id, point_id))
    with check (public.erp_my_points(store_id) is null or public.erp_point_allowed(store_id, point_id))$p$;
  execute $p$create policy store_catalogs_point_delete on public.store_catalogs as restrictive for delete to authenticated
    using (public.erp_my_points(store_id) is null or public.erp_point_allowed(store_id, point_id))$p$;

  -- Productos y categorías de cada catálogo: igual que su catálogo.
  foreach t in array array['store_catalog_products', 'store_catalog_categories'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    foreach c in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_point_' || c, t);
    end loop;
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.store__catalog_point_ok(catalog_id))', t || '_point_insert', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.store__catalog_point_ok(catalog_id)) with check (public.store__catalog_point_ok(catalog_id))', t || '_point_update', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.store__catalog_point_ok(catalog_id))', t || '_point_delete', t);
  end loop;
end $$;

-- Funciones del panel de catálogos que reciben un catálogo (p_catalog): la misma regla.
do $$
declare r record; v_def text; v_new text;
begin
  for r in
    select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname in ('catalog_admin_bulk', 'catalog_admin_duplicate', 'catalog_admin_products')
      and l.lanname = 'plpgsql' and 'p_catalog' = any (coalesce(p.proargnames, '{}'::text[]))
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('remhub:punto_catalogo' in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, '(\$function\$.*?\m)(begin)\M',
      '\1\2 -- remhub:punto_catalogo' || chr(10)
      || '  if not public.store__catalog_point_ok(p_catalog) then raise exception ''Ese catálogo es de otro punto: solo lo cambian la tienda madre o ese punto.''; end if;' || chr(10), 'i');
    if v_new = v_def then raise notice 'No se pudo proteger %: revísala a mano.', r.proname; continue; end if;
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Enlaces cortos con fecha y origen
-- ---------------------------------------------------------------------
alter table public.store_short_links add column if not exists starts_at timestamptz;
alter table public.store_short_links add column if not exists ends_at timestamptz;
alter table public.store_short_links add column if not exists fallback_target text
  check (fallback_target is null or (length(fallback_target) <= 500 and fallback_target ~ '^/[A-Za-z0-9/_.~%-]*(\?[^[:space:]<>"]*)?$'));
alter table public.store_short_links add column if not exists source text check (source is null or source ~ '^[a-z0-9][a-z0-9_-]{0,39}$');
alter table public.store_short_links add column if not exists note text check (note is null or length(note) <= 200);

-- A dónde lleva hoy un enlace (fuera de fechas: su destino de respaldo o el inicio; con origen: utm_source).
create or replace function public.store__link_now(l public.store_short_links)
returns text language sql stable as $$
  select case when l.source is null then x
              else x || case when position('?' in x) > 0 then '&' else '?' end || 'utm_source=' || l.source || '&utm_medium=enlace'
         end
  from (select case when (l.starts_at is null or now() >= l.starts_at) and (l.ends_at is null or now() < l.ends_at) then l.target
                    else coalesce(l.fallback_target, '/') end as x) t;
$$;

-- ¿Un usuario de punto puede manejar este destino? (solo catálogos de su punto)
create or replace function public.store__link_point_ok(p_store uuid, p_target text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_my_points(p_store) is null or exists (
    select 1 from public.store_catalogs c
    where c.store_id = p_store and c.slug is not null and c.point_id = any (public.erp_my_points(p_store))
      and (p_target = '/' || c.slug or p_target like '/' || c.slug || '?%' or p_target like '/' || c.slug || '/%'));
$$;
revoke all on function public.store__link_point_ok(uuid, text) from public, anon, authenticated;

-- Público (proxy.ts): ahora con fechas, origen y tienda pausada.
create or replace function public.store_host_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_store public.stores;
  v_target text;
  v_links jsonb;
begin
  select * into v_store from public.stores s where lower(s.slug) = v_slug limit 1;
  if v_store.id is null then
    select s.* into v_store from public.store_slug_history h join public.stores s on s.id = h.store_id where h.slug = v_slug limit 1;
    if v_store.id is null then return null; end if;
    return jsonb_build_object('moved_to', v_store.slug);
  end if;
  if not coalesce(v_store.active, true) then return jsonb_build_object('slug', v_store.slug, 'suspended', true); end if;
  begin
    select home_target into v_target from public.store_site where store_id = v_store.id;
  exception when undefined_table then v_target := null;
  end;
  select coalesce(jsonb_object_agg(l.code, public.store__link_now(l)), '{}'::jsonb) into v_links
  from public.store_short_links l
  where l.store_id = v_store.id
    and not exists (select 1 from public.store_catalogs c where c.store_id = v_store.id and c.slug = l.code);
  return jsonb_build_object('slug', v_store.slug, 'target', coalesce(v_target, 'detal'), 'links', v_links);
end $$;

-- Página «tienda pausada»: solo nombre, logo y WhatsApp, y solo si de verdad está pausada.
create or replace function public.store_public_paused(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', s.name, 'slug', s.slug, 'logo_url', s.logo_url, 'whatsapp', s.whatsapp)
  from public.stores s
  where lower(s.slug) = lower(btrim(coalesce(p_slug, ''))) and not coalesce(s.active, true)
  limit 1;
$$;

-- Panel: los usuarios de un punto solo ven y manejan los enlaces de sus catálogos.
create or replace function public.store_links_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_slug text; v_points uuid[] := public.erp_my_points(p_store);
begin
  if not public.store__links_can(p_store) then return jsonb_build_object('ok', false); end if;
  select slug into v_slug from public.stores where id = p_store;
  return jsonb_build_object('ok', true, 'slug', v_slug,
    'can_rename', public.erp_can(p_store, 'store'),
    'point_scope', v_points is not null,
    'history', coalesce((select jsonb_agg(jsonb_build_object('slug', h.slug, 'changed_at', h.changed_at) order by h.changed_at desc)
                         from public.store_slug_history h where h.store_id = p_store), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'target', l.target, 'kind', l.kind, 'hits', l.hits,
                                                           'last_hit_at', l.last_hit_at, 'created_at', l.created_at, 'starts_at', l.starts_at,
                                                           'ends_at', l.ends_at, 'fallback_target', l.fallback_target, 'source', l.source,
                                                           'note', l.note, 'now', public.store__link_now(l)) order by l.kind, l.code)
                       from public.store_short_links l where l.store_id = p_store
                         and not exists (select 1 from public.store_catalogs c where c.store_id = p_store and c.slug = l.code)
                         and public.store__link_point_ok(p_store, l.target)), '[]'::jsonb),
    'catalogs', coalesce((select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'active', c.active, 'private', c.access_key is not null,
                                                              'point_id', c.point_id) order by c.sort_order, c.name)
                          from public.store_catalogs c where c.store_id = p_store and c.slug is not null
                            and (v_points is null or c.point_id = any (v_points))), '[]'::jsonb));
end $$;

drop function if exists public.store_short_link_save(uuid, uuid, text, text);
create or replace function public.store_short_link_save(p_store uuid, p_id uuid, p_code text, p_target text, p_opts jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_target text := btrim(coalesce(p_target, ''));
  v_fallback text := nullif(btrim(coalesce(p_opts->>'fallback_target', '')), '');
  v_source text := nullif(lower(btrim(coalesce(p_opts->>'source', ''))), '');
  v_starts timestamptz := nullif(p_opts->>'starts_at', '')::timestamptz;
  v_ends timestamptz := nullif(p_opts->>'ends_at', '')::timestamptz;
  v_note text := nullif(btrim(coalesce(p_opts->>'note', '')), '');
  v_id uuid;
  v_old text;
begin
  if not public.store__links_can(p_store) then raise exception 'Necesitas el permiso «Mi tienda» o «Productos».'; end if;
  if v_code !~ '^[a-z0-9][a-z0-9-]{0,47}$' then raise exception 'El enlace solo puede tener letras minúsculas, números y guiones.'; end if;
  if public.store__reserved_code(v_code) then raise exception 'Ese enlace está reservado.'; end if;
  if exists (select 1 from public.store_catalogs c where c.store_id = p_store and c.slug = v_code) then
    raise exception 'Ya hay un catálogo con ese nombre: su dirección ya es /%.', v_code;
  end if;
  if left(v_target, 1) <> '/' then v_target := '/' || v_target; end if;
  if v_fallback is not null and left(v_fallback, 1) <> '/' then v_fallback := '/' || v_fallback; end if;
  if v_target !~ '^/[A-Za-z0-9/_.~%-]*(\?[^[:space:]<>"]*)?$' or length(v_target) > 500
     or (v_fallback is not null and (v_fallback !~ '^/[A-Za-z0-9/_.~%-]*(\?[^[:space:]<>"]*)?$' or length(v_fallback) > 500)) then
    raise exception 'El destino debe ser una página de tu tienda, por ejemplo /zamora o /producto/…';
  end if;
  if v_target = '/' || v_code or v_target like '/' || v_code || '?%' then raise exception 'El enlace no puede llevar a sí mismo.'; end if;
  if v_source is not null and v_source !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then raise exception 'El origen solo puede tener letras, números y guiones (ej. instagram).'; end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then raise exception 'La fecha final debe ser después de la inicial.'; end if;
  -- Usuario de un punto: solo enlaces a catálogos de su punto.
  if not public.store__link_point_ok(p_store, v_target) or (v_fallback is not null and not public.store__link_point_ok(p_store, v_fallback)) then
    raise exception 'Solo puedes crear enlaces a los catálogos de tu punto.';
  end if;
  if exists (select 1 from public.store_short_links where store_id = p_store and code = v_code and id is distinct from p_id) then
    raise exception 'Ya tienes un enlace /%.', v_code;
  end if;
  if p_id is null then
    if (select count(*) from public.store_short_links where store_id = p_store and kind = 'manual') >= 100 then
      raise exception 'Máximo 100 enlaces cortos por tienda.';
    end if;
    insert into public.store_short_links (store_id, code, target, fallback_target, source, starts_at, ends_at, note, created_by)
    values (p_store, v_code, v_target, v_fallback, v_source, v_starts, v_ends, v_note, auth.uid()) returning id into v_id;
  else
    select target into v_old from public.store_short_links where id = p_id and store_id = p_store;
    if v_old is null then raise exception 'Ese enlace no es de tu tienda.'; end if;
    if not public.store__link_point_ok(p_store, v_old) then raise exception 'Ese enlace es de otro punto.'; end if;
    update public.store_short_links set code = v_code, target = v_target, fallback_target = v_fallback, source = v_source,
      starts_at = v_starts, ends_at = v_ends, note = v_note, kind = 'manual', updated_at = now()
    where id = p_id and store_id = p_store returning id into v_id;
  end if;
  perform public.erp_audit(p_store, 'store.short_link', 'store_short_links', v_id, jsonb_build_object('code', v_code, 'target', v_target));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.store_short_link_delete(p_store uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text; v_target text;
begin
  if not public.store__links_can(p_store) then raise exception 'Necesitas el permiso «Mi tienda» o «Productos».'; end if;
  select code, target into v_code, v_target from public.store_short_links where id = p_id and store_id = p_store;
  if v_code is null then raise exception 'Ese enlace no es de tu tienda.'; end if;
  if not public.store__link_point_ok(p_store, v_target) then raise exception 'Ese enlace es de otro punto.'; end if;
  delete from public.store_short_links where id = p_id and store_id = p_store;
  perform public.erp_audit(p_store, 'store.short_link_delete', 'store_short_links', p_id, jsonb_build_object('code', v_code));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 3. Vitrina: «Escoge tu punto»
-- ---------------------------------------------------------------------
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
                              'ord', '2' || lpad(c.sort_order::text, 6, '0') || c.slug,
                              'point', case when w.id is null then null else jsonb_build_object(
                                'id', w.id, 'name', w.name,
                                'city', coalesce(nullif(btrim(coalesce(to_jsonb(c)->>'city', '')), ''), to_jsonb(w)->>'city'),
                                'address', nullif(btrim(coalesce(to_jsonb(c)->>'address', '')), ''),
                                'whatsapp', nullif(btrim(coalesce(to_jsonb(c)->>'whatsapp', '')), '')) end)
    from public.store_catalogs c
    join public.stores s on s.id = c.store_id
    left join public.erp_warehouses w on w.id = c.point_id and w.store_id = c.store_id
    where c.store_id = p_store and c.active and c.access_key is null
  ) t;
$$;
revoke all on function public.store__public_catalogs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Admin de RemHub
-- ---------------------------------------------------------------------

-- ¿Está libre este nombre para una tienda nueva? (al crearla desde el admin)
create or replace function public.store_slug_available(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_problem text := public.store__slug_problem(null, lower(btrim(coalesce(p_slug, ''))));
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  return jsonb_build_object('ok', v_problem is null, 'reason', v_problem);
end $$;

-- Tablero: el espacio de cada tienda.
create or replace function public.admin_store_spaces()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_domains boolean := to_regclass('public.store_domains') is not null; v_out jsonb;
begin
  if not public.erp_is_platform_admin() then raise exception 'Solo el admin de RemHub.'; end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'active', coalesce(s.active, true), 'created_at', s.created_at,
      'subdomain_ok', s.slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' and not public.store__reserved_slug(s.slug),
      'owner_email', (select u.email from auth.users u where u.id = s.owner_id),
      'owner_last_sign_in', (select to_jsonb(u)->>'last_sign_in_at' from auth.users u where u.id = s.owner_id),
      'history', coalesce((select jsonb_agg(h.slug order by h.changed_at desc) from public.store_slug_history h where h.store_id = s.id), '[]'::jsonb),
      'links', (select count(*) from public.store_short_links l where l.store_id = s.id),
      'link_hits', (select coalesce(sum(l.hits), 0) from public.store_short_links l where l.store_id = s.id),
      'catalogs', (select count(*) from public.store_catalogs c where c.store_id = s.id),
      'users', (select count(*) from public.store_users su where su.store_id = s.id and su.active),
      'domains', $q$ || case when v_domains then
        $q$coalesce((select jsonb_agg(jsonb_build_object('domain', d.domain, 'status', d.status, 'target', d.target) order by d.domain)
                    from public.store_domains d where d.store_id = s.id), '[]'::jsonb)$q$ else $q$'[]'::jsonb$q$ end || $q$
    ) order by s.created_at desc), '[]'::jsonb)
    from public.stores s $q$ into v_out;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array['store_links_get(uuid)', 'store_short_link_save(uuid, uuid, text, text, jsonb)', 'store_short_link_delete(uuid, uuid)',
                           'store_slug_available(text)', 'admin_store_spaces()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['store_host_info(text)', 'store_public_paused(text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Rutas nuevas del espacio de la tienda: tampoco pueden ser nombres de tienda ni enlaces cortos.
create or replace function public.store__reserved_slug(p_slug text)
returns boolean language sql immutable as $$
  select p_slug = any (array[
    'www', 'app', 'api', 'admin', 'panel', 'dashboard', 'ayuda', 'help', 'soporte', 'estado', 'status', 'blog', 'mail', 'correo',
    'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'docs', 'dev', 'test', 'staging', 'demo', 'remhub',
    'acceso', 'comprobante', 'forgot-password', 'instalar', 'login', 'offline', 'pedido', 'reset-password', 'traslado',
    'robots', 'sitemap', 'manifest', 'favicon', 'entrar', 'tienda-pausada']);
$$;

create or replace function public.store__reserved_code(p_code text)
returns boolean language sql immutable as $$
  select p_code = any (array['detal', 'mayor', 'inicio', 'producto', 'dashboard', 'admin', 'login', 'acceso', 'instalar',
    'forgot-password', 'reset-password', 'offline', 'traslado', 'comprobante', 'pedido', 'api', 'robots', 'sitemap', 'manifest', 'favicon',
    'entrar', 'tienda-pausada']);
$$;

notify pgrst, 'reload schema';
