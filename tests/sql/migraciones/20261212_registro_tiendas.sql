-- =====================================================================
-- REMHUB · Registro público: cada persona crea SU tienda
--
-- La persona se registra (correo o Google, con Supabase Auth) y luego crea
-- su tienda con saas_signup_create_store:
--   · el dueño es SIEMPRE quien llama (nunca un ID que mande el navegador);
--   · una tienda por cuenta (más tiendas: las crea el admin de RemHub);
--   · el subdominio se valida con las mismas reglas de siempre;
--   · queda con su bodega principal y en el plan Gratis (20261211);
--   · si quiere, empieza ahí mismo la prueba del plan superior.
-- También: saas_my_store_status para saber si la persona ya tiene tienda.
-- Requiere 20261201 (nombres de tienda) y 20261211 (planes).
-- Idempotente. No borra datos.
-- =====================================================================

do $$
begin
  if to_regclass('public.saas_subscriptions') is null then raise exception 'Primero ejecuta 20261211_saas_planes_suscripciones.sql.'; end if;
  if to_regprocedure('public.store__slug_problem(uuid, text)') is null then raise exception 'Primero ejecuta 20261201_nombres_enlaces_cortos.sql.'; end if;
end $$;

-- ¿La persona ya tiene tienda (propia o como empleada)?
create or replace function public.saas_my_store_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then jsonb_build_object('signed_in', false) else jsonb_build_object(
    'signed_in', true,
    'is_platform_admin', public.erp_is_platform_admin(),
    'owned', (select jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name) from public.stores s where s.owner_id = auth.uid() order by s.created_at limit 1),
    'member', (select jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name)
               from public.store_users su join public.stores s on s.id = su.store_id
               where su.user_id = auth.uid() and su.active order by su.created_at limit 1)) end;
$$;
revoke all on function public.saas_my_store_status() from public, anon;
grant execute on function public.saas_my_store_status() to authenticated;

create or replace function public.saas_signup_create_store(p_name text, p_slug text, p_whatsapp text, p_start_trial boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_wa text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_problem text;
  v_store uuid;
  v_trial jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Inicia sesión para crear tu tienda.'); end if;
  if public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'El admin de RemHub crea tiendas desde Admin → Tiendas.'); end if;
  if exists (select 1 from public.stores where owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'Tu cuenta ya tiene una tienda. Para otra, escríbenos.', 'reason', 'has_store');
  end if;
  if exists (select 1 from public.store_users where user_id = v_uid and active) then
    return jsonb_build_object('ok', false, 'error', 'Tu cuenta ya trabaja en una tienda. Usa otro correo para crear la tuya.', 'reason', 'is_member');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then return jsonb_build_object('ok', false, 'error', 'Escribe el nombre de tu negocio (2 a 80 letras).'); end if;
  if char_length(v_wa) < 10 or char_length(v_wa) > 15 then return jsonb_build_object('ok', false, 'error', 'Escribe un WhatsApp válido (ej: 3001234567).'); end if;
  if char_length(v_wa) = 10 then v_wa := '57' || v_wa; end if;
  v_problem := public.store__slug_problem(null, v_slug);
  if v_problem is not null then return jsonb_build_object('ok', false, 'error', v_problem, 'reason', 'slug'); end if;

  insert into public.user_profiles (user_id, role) values (v_uid, 'store') on conflict (user_id) do nothing;
  insert into public.stores (name, slug, whatsapp, owner_id, active, active_until, catalog_retail, catalog_wholesale, theme)
  values (upper(v_name), v_slug, v_wa, v_uid, true, null, true, true, 'oceano-profundo')
  returning id into v_store;
  -- Su bodega principal (igual que las tiendas creadas por el admin).
  if to_regprocedure('public.erp_ensure_default_warehouse(uuid)') is not null then
    perform public.erp_ensure_default_warehouse(v_store);
  end if;
  insert into public.saas_subscription_events (store_id, kind, after, by_user) values (v_store, 'signup', jsonb_build_object('slug', v_slug), v_uid);
  insert into public.saas_usage_events (store_id, user_id, kind, detail) values (v_store, v_uid, 'signup_done', jsonb_build_object('trial', coalesce(p_start_trial, false)));
  if coalesce(p_start_trial, false) then v_trial := public.saas_trial_start(v_store); end if;
  return jsonb_build_object('ok', true, 'store_id', v_store, 'slug', v_slug, 'trial', v_trial);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'Ese nombre de tienda ya existe. Prueba con otro.', 'reason', 'slug');
end $$;
revoke all on function public.saas_signup_create_store(text, text, text, boolean) from public, anon;
grant execute on function public.saas_signup_create_store(text, text, text, boolean) to authenticated;

-- «registro» es una página de RemHub: no puede ser nombre de tienda ni enlace corto (lista de 20261207 + registro).
create or replace function public.store__reserved_slug(p_slug text)
returns boolean language sql immutable as $$
  select p_slug = any (array[
    'www', 'app', 'api', 'admin', 'panel', 'dashboard', 'ayuda', 'help', 'soporte', 'estado', 'status', 'blog', 'mail', 'correo',
    'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'docs', 'dev', 'test', 'staging', 'demo', 'remhub',
    'acceso', 'comprobante', 'forgot-password', 'instalar', 'login', 'offline', 'pedido', 'reset-password', 'traslado',
    'robots', 'sitemap', 'manifest', 'favicon', 'entrar', 'tienda-pausada', 'documento', 'registro', 'precios']);
$$;

create or replace function public.store__reserved_code(p_code text)
returns boolean language sql immutable as $$
  select p_code = any (array['detal', 'mayor', 'inicio', 'producto', 'dashboard', 'admin', 'login', 'acceso', 'instalar',
    'forgot-password', 'reset-password', 'offline', 'traslado', 'comprobante', 'pedido', 'api', 'robots', 'sitemap', 'manifest', 'favicon',
    'entrar', 'tienda-pausada', 'documento', 'registro', 'precios']);
$$;

notify pgrst, 'reload schema';
