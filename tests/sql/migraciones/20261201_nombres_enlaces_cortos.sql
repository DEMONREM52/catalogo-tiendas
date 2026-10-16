-- =====================================================================
-- REMHUB · Nombres de tienda con historial y enlaces cortos
--
--   · Si una tienda cambia su nombre (lavitrina → la-vitrina), los enlaces
--     viejos siguen funcionando: lavitrina.remhub.co y remhub.co/lavitrina/…
--     llevan solos al nombre nuevo. Ninguna otra tienda puede quedarse con
--     un nombre viejo (nadie «roba» los enlaces que ya están compartidos).
--   · Lo cambian el dueño (permiso «Mi tienda») o el admin de RemHub.
--   · Nombres nuevos: solo letras, números y guiones (sirven de subdominio).
--   · Enlaces cortos por tienda: lavitrina.remhub.co/z → /zamora.
--     Al renombrar un catálogo, su nombre viejo queda como enlace corto,
--     y el inicio y los dominios que lo usaban se actualizan solos.
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.store_slug_history (
  slug text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists store_slug_history_store_idx on public.store_slug_history (store_id);
alter table public.store_slug_history enable row level security;
revoke all on public.store_slug_history from anon, authenticated;

create table if not exists public.store_short_links (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  target text not null check (length(target) <= 500 and target ~ '^/[A-Za-z0-9/_.~%-]*(\?[^[:space:]<>"]*)?$'),
  kind text not null default 'manual' check (kind in ('manual', 'rename')),
  hits bigint not null default 0,
  last_hit_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, code)
);
alter table public.store_short_links enable row level security;
revoke all on public.store_short_links from anon, authenticated;

-- Nombres que nunca puede tener una tienda (subdominios del sistema y rutas de remhub.co).
create or replace function public.store__reserved_slug(p_slug text)
returns boolean language sql immutable as $$
  select p_slug = any (array[
    'www', 'app', 'api', 'admin', 'panel', 'dashboard', 'ayuda', 'help', 'soporte', 'estado', 'status', 'blog', 'mail', 'correo',
    'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'docs', 'dev', 'test', 'staging', 'demo', 'remhub',
    'acceso', 'comprobante', 'forgot-password', 'instalar', 'login', 'offline', 'pedido', 'reset-password', 'traslado',
    'robots', 'sitemap', 'manifest', 'favicon']);
$$;

-- Códigos que nunca puede tener un enlace corto (rutas de la tienda y del sistema).
create or replace function public.store__reserved_code(p_code text)
returns boolean language sql immutable as $$
  select p_code = any (array['detal', 'mayor', 'inicio', 'producto', 'dashboard', 'admin', 'login', 'acceso', 'instalar',
    'forgot-password', 'reset-password', 'offline', 'traslado', 'comprobante', 'pedido', 'api', 'robots', 'sitemap', 'manifest', 'favicon']);
$$;

-- ¿Puede esta tienda usar ese nombre? null = sí; si no, el motivo.
create or replace function public.store__slug_problem(p_store uuid, p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_slug is null or p_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
      then 'El nombre solo puede tener letras minúsculas, números y guiones (sin espacios, puntos ni tildes), y no puede empezar ni terminar en guion.'
    when length(p_slug) < 3 then 'El nombre debe tener al menos 3 letras.'
    when public.store__reserved_slug(p_slug) then 'Ese nombre está reservado por RemHub.'
    when exists (select 1 from public.stores s where lower(s.slug) = p_slug and s.id is distinct from p_store) then 'Ese nombre ya lo usa otra tienda.'
    when exists (select 1 from public.store_slug_history h where h.slug = p_slug and h.store_id is distinct from p_store)
      then 'Ese nombre lo usó otra tienda antes y sus enlaces siguen activos. Escoge otro.'
    else null end;
$$;
revoke all on function public.store__slug_problem(uuid, text) from public, anon, authenticated;

-- Al cambiar el nombre: se valida y el nombre viejo queda redirigiendo al nuevo.
create or replace function public.store__slug_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_problem text;
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then return new; end if;
  new.slug := lower(btrim(coalesce(new.slug, '')));
  if tg_op = 'UPDATE' and new.slug = lower(coalesce(old.slug, '')) then return new; end if;
  v_problem := public.store__slug_problem(new.id, new.slug);
  if v_problem is not null then raise exception '%', v_problem using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then
    -- Volver a un nombre propio de antes: deja de ser viejo.
    delete from public.store_slug_history where slug = new.slug and store_id = new.id;
    if nullif(btrim(coalesce(old.slug, '')), '') is not null then
      insert into public.store_slug_history (slug, store_id, changed_by) values (lower(old.slug), new.id, auth.uid())
      on conflict (slug) do update set store_id = excluded.store_id, changed_by = excluded.changed_by, changed_at = now();
    end if;
    begin
      perform public.erp_audit(new.id, 'store.slug_change', 'stores', new.id, jsonb_build_object('from', old.slug, 'to', new.slug));
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.store__slug_guard() from public, anon, authenticated;

drop trigger if exists store_slug_guard on public.stores;
create trigger store_slug_guard before insert or update of slug on public.stores
  for each row execute function public.store__slug_guard();

-- Al renombrar un catálogo: el nombre viejo queda como enlace corto y todo lo que lo usaba se actualiza.
create or replace function public.store__catalog_slug_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.slug is null then return new; end if;
  -- El catálogo manda: un enlace corto con el mismo nombre deja de existir.
  delete from public.store_short_links where store_id = new.store_id and code = new.slug;
  if tg_op = 'UPDATE' and old.slug is not null and old.slug is distinct from new.slug then
    update public.store_short_links set target = '/' || new.slug || substr(target, length(old.slug) + 2), updated_at = now()
    where store_id = new.store_id and (target = '/' || old.slug or target like '/' || old.slug || '?%' or target like '/' || old.slug || '/%');
    if old.slug ~ '^[a-z0-9][a-z0-9-]{0,47}$' and not public.store__reserved_code(old.slug) then
      insert into public.store_short_links (store_id, code, target, kind, created_by)
      values (new.store_id, old.slug, '/' || new.slug, 'rename', auth.uid())
      on conflict (store_id, code) do update set target = excluded.target, kind = 'rename', updated_at = now();
    end if;
    begin
      update public.store_site set home_target = new.slug, updated_at = now() where store_id = new.store_id and home_target = old.slug;
      update public.store_domains set target = new.slug where store_id = new.store_id and target = old.slug;
    exception when undefined_table or undefined_column then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.store__catalog_slug_follow() from public, anon, authenticated;

drop trigger if exists store_catalog_slug_follow on public.store_catalogs;
create trigger store_catalog_slug_follow after insert or update of slug on public.store_catalogs
  for each row execute function public.store__catalog_slug_follow();

-- Público (lo usa proxy.ts): qué abre la tienda, sus enlaces cortos, o a qué nombre se mudó.
create or replace function public.store_host_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_store public.stores;
  v_target text;
  v_links jsonb;
begin
  select * into v_store from public.stores s where lower(s.slug) = v_slug and coalesce(s.active, true) limit 1;
  if v_store.id is null then
    select s.* into v_store from public.store_slug_history h join public.stores s on s.id = h.store_id
    where h.slug = v_slug and coalesce(s.active, true) limit 1;
    if v_store.id is null then return null; end if;
    return jsonb_build_object('moved_to', v_store.slug);
  end if;
  begin
    select home_target into v_target from public.store_site where store_id = v_store.id;
  exception when undefined_table then v_target := null;
  end;
  select coalesce(jsonb_object_agg(l.code, l.target), '{}'::jsonb) into v_links
  from public.store_short_links l
  where l.store_id = v_store.id
    and not exists (select 1 from public.store_catalogs c where c.store_id = v_store.id and c.slug = l.code);
  return jsonb_build_object('slug', v_store.slug, 'target', coalesce(v_target, 'detal'), 'links', v_links);
end $$;

-- Público: suma una visita a un enlace corto (lo llama proxy.ts sin esperar).
create or replace function public.store_short_link_hit(p_slug text, p_code text)
returns void language sql volatile security definer set search_path = public as $$
  update public.store_short_links l set hits = l.hits + 1, last_hit_at = now()
  from public.stores s
  where s.id = l.store_id and lower(s.slug) = lower(btrim(coalesce(p_slug, ''))) and l.code = lower(btrim(coalesce(p_code, '')));
$$;

create or replace function public.store__links_can(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'store') or public.erp_can(p_store, 'products'));
$$;
revoke all on function public.store__links_can(uuid) from public, anon, authenticated;

-- Panel: nombre actual, nombres viejos, enlaces cortos y catálogos para escoger destino.
create or replace function public.store_links_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_slug text;
begin
  if not public.store__links_can(p_store) then return jsonb_build_object('ok', false); end if;
  select slug into v_slug from public.stores where id = p_store;
  return jsonb_build_object('ok', true, 'slug', v_slug,
    'can_rename', public.erp_can(p_store, 'store'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('slug', h.slug, 'changed_at', h.changed_at) order by h.changed_at desc)
                         from public.store_slug_history h where h.store_id = p_store), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'target', l.target, 'kind', l.kind, 'hits', l.hits,
                                                           'last_hit_at', l.last_hit_at, 'created_at', l.created_at) order by l.kind, l.code)
                       from public.store_short_links l where l.store_id = p_store
                         and not exists (select 1 from public.store_catalogs c where c.store_id = p_store and c.slug = l.code)), '[]'::jsonb),
    'catalogs', coalesce((select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'active', c.active, 'private', c.access_key is not null,
                                                              'point_id', c.point_id) order by c.sort_order, c.name)
                          from public.store_catalogs c where c.store_id = p_store and c.slug is not null), '[]'::jsonb));
end $$;

-- ¿Está libre ese nombre? (para avisar mientras se escribe)
create or replace function public.store_slug_check(p_store uuid, p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_slug text := lower(btrim(coalesce(p_slug, ''))); v_problem text;
begin
  if not (public.erp_can(p_store, 'store') or public.erp_is_platform_admin()) then raise exception 'Necesitas el permiso «Mi tienda».'; end if;
  if v_slug = (select lower(slug) from public.stores where id = p_store) then return jsonb_build_object('ok', true, 'same', true); end if;
  v_problem := public.store__slug_problem(p_store, v_slug);
  return jsonb_build_object('ok', v_problem is null, 'reason', v_problem);
end $$;

-- Cambiar el nombre de la tienda (dueño o admin de RemHub). Los enlaces viejos siguen funcionando.
create or replace function public.store_slug_change(p_store uuid, p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old text; v_new text := lower(btrim(coalesce(p_slug, '')));
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'store') or public.erp_is_platform_admin()) then
    raise exception 'Necesitas el permiso «Mi tienda».';
  end if;
  select slug into v_old from public.stores where id = p_store for update;
  if not found then raise exception 'Tienda no encontrada.'; end if;
  if lower(coalesce(v_old, '')) = v_new then return jsonb_build_object('ok', true, 'slug', v_old, 'changed', false); end if;
  update public.stores set slug = v_new where id = p_store;
  return jsonb_build_object('ok', true, 'slug', v_new, 'old', v_old, 'changed', true);
end $$;

-- Crear o editar un enlace corto.
create or replace function public.store_short_link_save(p_store uuid, p_id uuid, p_code text, p_target text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_target text := btrim(coalesce(p_target, ''));
  v_id uuid;
begin
  if not public.store__links_can(p_store) then raise exception 'Necesitas el permiso «Mi tienda» o «Productos».'; end if;
  if v_code !~ '^[a-z0-9][a-z0-9-]{0,47}$' then raise exception 'El enlace solo puede tener letras minúsculas, números y guiones.'; end if;
  if public.store__reserved_code(v_code) then raise exception 'Ese enlace está reservado.'; end if;
  if exists (select 1 from public.store_catalogs c where c.store_id = p_store and c.slug = v_code) then
    raise exception 'Ya hay un catálogo con ese nombre: su dirección ya es /%.', v_code;
  end if;
  if left(v_target, 1) <> '/' then v_target := '/' || v_target; end if;
  if v_target !~ '^/[A-Za-z0-9/_.~%-]*(\?[^[:space:]<>"]*)?$' or length(v_target) > 500 then
    raise exception 'El destino debe ser una página de tu tienda, por ejemplo /zamora o /producto/…';
  end if;
  if v_target = '/' || v_code or v_target like '/' || v_code || '?%' then raise exception 'El enlace no puede llevar a sí mismo.'; end if;
  if exists (select 1 from public.store_short_links where store_id = p_store and code = v_code and id is distinct from p_id) then
    raise exception 'Ya tienes un enlace /%.', v_code;
  end if;
  if p_id is null then
    if (select count(*) from public.store_short_links where store_id = p_store and kind = 'manual') >= 100 then
      raise exception 'Máximo 100 enlaces cortos por tienda.';
    end if;
    insert into public.store_short_links (store_id, code, target, created_by) values (p_store, v_code, v_target, auth.uid()) returning id into v_id;
  else
    update public.store_short_links set code = v_code, target = v_target, kind = 'manual', updated_at = now()
    where id = p_id and store_id = p_store returning id into v_id;
    if v_id is null then raise exception 'Ese enlace no es de tu tienda.'; end if;
  end if;
  perform public.erp_audit(p_store, 'store.short_link', 'store_short_links', v_id, jsonb_build_object('code', v_code, 'target', v_target));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.store_short_link_delete(p_store uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.store__links_can(p_store) then raise exception 'Necesitas el permiso «Mi tienda» o «Productos».'; end if;
  delete from public.store_short_links where id = p_id and store_id = p_store returning code into v_code;
  if v_code is null then raise exception 'Ese enlace no es de tu tienda.'; end if;
  perform public.erp_audit(p_store, 'store.short_link_delete', 'store_short_links', p_id, jsonb_build_object('code', v_code));
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['store_links_get(uuid)', 'store_slug_check(uuid, text)', 'store_slug_change(uuid, text)',
                           'store_short_link_save(uuid, uuid, text, text)', 'store_short_link_delete(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['store_host_info(text)', 'store_short_link_hit(text, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
