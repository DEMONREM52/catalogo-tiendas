-- =====================================================================
-- REMHUB · Crecimiento: referidos, vitrina de clientes y primeros pasos
--
-- 1. «Invita y gana»: cada tienda invita con su enlace (remhub.co/?ref=su-tienda).
--    La tienda nueva queda «referida por» la que la invitó (una sola vez, en
--    sus primeros 7 días, nunca a sí misma ni del mismo dueño). El premio lo
--    decide y aplica el admin de RemHub (días de «todo incluido»): no hay
--    pagos ni comisiones automáticas.
-- 2. Vitrina de clientes en la página principal: solo las tiendas que el
--    admin marque (showcase). Solo nombre, logo y enlace público.
-- 3. Primeros pasos: lista de lo que le falta a una tienda nueva para vender.
--
-- Los campos nuevos de stores (referred_by, showcase) solo los cambia el
-- admin de RemHub o estas funciones (un activador lo protege).
-- Requiere 20261211 y 20261212. Idempotente. No borra datos.
-- =====================================================================

do $$
begin
  if to_regclass('public.saas_subscriptions') is null then raise exception 'Primero ejecuta 20261211_saas_planes_suscripciones.sql.'; end if;
end $$;

alter table public.stores add column if not exists referred_by uuid references public.stores(id) on delete set null;
alter table public.stores add column if not exists referred_at timestamptz;
alter table public.stores add column if not exists showcase boolean not null default false;
create index if not exists stores_referred_by on public.stores (referred_by) where referred_by is not null;

-- Nadie se pone «en la vitrina» ni cambia quién lo refirió desde la app (solo el admin de RemHub o las funciones de abajo).
-- Sin «security definer» a propósito: current_user dice si el cambio vino de la app.
create or replace function public.saas__stores_growth_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' or public.erp_is_platform_admin() then return new; end if;
  if new.showcase is distinct from old.showcase or new.referred_by is distinct from old.referred_by or new.referred_at is distinct from old.referred_at then
    raise exception 'Ese dato lo administra RemHub.';
  end if;
  return new;
end $$;
drop trigger if exists saas_stores_growth_guard on public.stores;
create trigger saas_stores_growth_guard before update of showcase, referred_by, referred_at on public.stores
  for each row execute function public.saas__stores_growth_guard();

-- 1. Referidos -----------------------------------------------------------------
create or replace function public.saas_set_referrer(p_store uuid, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.stores;
  v_ref_id uuid;
  v_slug text := lower(btrim(coalesce(p_ref, '')));
begin
  select * into st from public.stores where id = p_store;
  if not found or st.owner_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'error', 'Solo el dueño.'); end if;
  if st.referred_by is not null then return jsonb_build_object('ok', true, 'result', 'already'); end if;
  if st.created_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'error', 'Solo se puede en los primeros 7 días.'); end if;
  if v_slug = '' then return jsonb_build_object('ok', false, 'error', 'Sin código.'); end if;
  select s.id into v_ref_id from public.stores s where lower(s.slug) = v_slug limit 1;
  if v_ref_id is null and to_regclass('public.store_slug_history') is not null then
    execute 'select store_id from public.store_slug_history where lower(slug) = $1 limit 1' into v_ref_id using v_slug;
  end if;
  if v_ref_id is null then return jsonb_build_object('ok', false, 'error', 'Esa tienda no existe.'); end if;
  if v_ref_id = p_store or exists (select 1 from public.stores s where s.id = v_ref_id and s.owner_id = st.owner_id) then
    return jsonb_build_object('ok', false, 'error', 'No puedes referirte a ti mismo.');
  end if;
  update public.stores set referred_by = v_ref_id, referred_at = now() where id = p_store;
  insert into public.saas_subscription_events (store_id, kind, after, by_user) values (v_ref_id, 'referral', jsonb_build_object('referred_store', p_store), auth.uid());
  insert into public.saas_usage_events (store_id, user_id, kind, detail) values (p_store, auth.uid(), 'referral_signup', jsonb_build_object('referrer', v_ref_id));
  return jsonb_build_object('ok', true, 'result', 'linked');
end $$;
revoke all on function public.saas_set_referrer(uuid, text) from public, anon;
grant execute on function public.saas_set_referrer(uuid, text) to authenticated;

-- Mis invitados (para «Invita y gana» en Mi plan). Sin datos de las otras tiendas: solo cuántas y cuáles ya pagaron.
create or replace function public.saas_my_referrals(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
                                             or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active))
    then jsonb_build_object('ok', false)
    else jsonb_build_object('ok', true,
      'slug', (select slug from public.stores where id = p_store),
      'signups', (select count(*) from public.stores r where r.referred_by = p_store),
      'paid', (select count(distinct r.id) from public.stores r join public.saas_payments p on p.store_id = r.id and p.status = 'approved' where r.referred_by = p_store),
      'rewards_days', coalesce((select sum((e.after->>'days')::int) from public.saas_subscription_events e where e.store_id = p_store and e.kind = 'referral_reward'), 0))
  end;
$$;
revoke all on function public.saas_my_referrals(uuid) from public, anon;
grant execute on function public.saas_my_referrals(uuid) to authenticated;

-- Admin: quién trae clientes.
create or replace function public.saas_admin_referrals()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.erp_is_platform_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
        'store_id', ref.id, 'name', ref.name, 'slug', ref.slug,
        'signups', x.signups, 'paid', x.paid, 'last_at', x.last_at,
        'rewards_days', coalesce((select sum((e.after->>'days')::int) from public.saas_subscription_events e where e.store_id = ref.id and e.kind = 'referral_reward'), 0),
        'referred', x.referred) order by x.paid desc, x.signups desc)
    from (
      select r.referred_by as rid, count(*) as signups, max(r.referred_at) as last_at,
             count(*) filter (where exists (select 1 from public.saas_payments p where p.store_id = r.id and p.status = 'approved')) as paid,
             jsonb_agg(jsonb_build_object('name', r.name, 'slug', r.slug, 'at', r.referred_at) order by r.referred_at desc) as referred
      from public.stores r where r.referred_by is not null group by r.referred_by
    ) x join public.stores ref on ref.id = x.rid), '[]'::jsonb) end;
$$;
revoke all on function public.saas_admin_referrals() from public, anon;
grant execute on function public.saas_admin_referrals() to authenticated;

-- Admin: premio por referidos = días de «todo incluido» (si ya paga, se le suman al período; si no, Fundador por esos días).
create or replace function public.saas_admin_referral_reward(p_store uuid, p_days integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare sub public.saas_subscriptions; v_end timestamptz;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if coalesce(p_days, 0) not between 1 and 366 then return jsonb_build_object('ok', false, 'error', 'Días entre 1 y 366.'); end if;
  select * into sub from public.saas_subscriptions where store_id = p_store for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'La tienda no tiene suscripción.'); end if;
  if sub.status in ('active', 'past_due', 'canceled') and sub.current_period_end is not null and sub.current_period_end > now() then
    v_end := sub.current_period_end + make_interval(days => p_days);
    update public.saas_subscriptions set current_period_end = v_end, status = case when status = 'past_due' then 'active' else status end, updated_at = now() where store_id = p_store;
  elsif sub.plan_id = 'fundador' and sub.status = 'active' and sub.current_period_end is null then
    v_end := null;   -- ya tiene todo sin vencimiento
  else
    v_end := now() + make_interval(days => p_days);
    update public.saas_subscriptions set plan_id = 'fundador', status = 'active', current_period_end = v_end, cancel_at_period_end = false, updated_at = now() where store_id = p_store;
  end if;
  insert into public.saas_subscription_events (store_id, kind, before, after, reason, by_user)
  values (p_store, 'referral_reward', to_jsonb(sub), jsonb_build_object('days', p_days, 'until', v_end), coalesce(nullif(btrim(p_note), ''), 'Premio por referidos'), auth.uid());
  return jsonb_build_object('ok', true, 'until', v_end);
end $$;
revoke all on function public.saas_admin_referral_reward(uuid, integer, text) from public, anon;
grant execute on function public.saas_admin_referral_reward(uuid, integer, text) to authenticated;

-- 2. Vitrina de clientes ------------------------------------------------------
create or replace function public.saas_public_showcase()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'logo_url', s.logo_url) order by s.created_at), '[]'::jsonb)
  from (select * from public.stores s where s.showcase and coalesce(s.active, true) and (s.active_until is null or s.active_until > now())
        order by s.created_at limit 24) s;
$$;
revoke all on function public.saas_public_showcase() from public;
grant execute on function public.saas_public_showcase() to anon, authenticated;

create or replace function public.saas_admin_store_growth(p_store uuid, p_showcase boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare st public.stores;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if p_showcase is not null then
    update public.stores set showcase = p_showcase where id = p_store;
    insert into public.saas_subscription_events (store_id, kind, after, by_user) values (p_store, case when p_showcase then 'showcase_on' else 'showcase_off' end, null, auth.uid());
  end if;
  select * into st from public.stores where id = p_store;
  return jsonb_build_object('ok', true, 'showcase', st.showcase,
    'referred_by', (select jsonb_build_object('name', r.name, 'slug', r.slug) from public.stores r where r.id = st.referred_by),
    'referrals', (select count(*) from public.stores r where r.referred_by = p_store));
end $$;
revoke all on function public.saas_admin_store_growth(uuid, boolean) from public, anon;
grant execute on function public.saas_admin_store_growth(uuid, boolean) to authenticated;

-- 3. Primeros pasos -------------------------------------------------------------
create or replace function public.saas_onboarding(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st public.stores;
  v_products integer;
  v_catalogs integer := 0;
  v_orders integer := 0;
  v_team integer;
  v_images integer;
begin
  select * into st from public.stores where id = p_store;
  if not found or not (st.owner_id = auth.uid()
                       or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role = 'store_admin')) then
    return jsonb_build_object('ok', false);
  end if;
  select count(*), count(*) filter (where coalesce(p.image_url, '') <> '') into v_products, v_images from public.products p where p.store_id = p_store;
  if to_regclass('public.store_catalogs') is not null then execute 'select count(*) from public.store_catalogs where store_id = $1' into v_catalogs using p_store; end if;
  execute 'select count(*) from public.orders where store_id = $1' into v_orders using p_store;
  select count(*) into v_team from public.store_users su where su.store_id = p_store and su.active;
  return jsonb_build_object('ok', true, 'created_at', st.created_at, 'steps', jsonb_build_array(
    jsonb_build_object('key', 'logo', 'done', coalesce(st.logo_url, '') <> ''),
    jsonb_build_object('key', 'product', 'done', v_products >= 1),
    jsonb_build_object('key', 'products5', 'done', v_products >= 5 and v_images >= 3),
    jsonb_build_object('key', 'catalog', 'done', v_catalogs >= 1 or v_products >= 5),
    jsonb_build_object('key', 'share', 'done', v_orders >= 1),
    jsonb_build_object('key', 'team', 'done', v_team >= 1)));
end $$;
revoke all on function public.saas_onboarding(uuid) from public, anon;
grant execute on function public.saas_onboarding(uuid) to authenticated;

notify pgrst, 'reload schema';
