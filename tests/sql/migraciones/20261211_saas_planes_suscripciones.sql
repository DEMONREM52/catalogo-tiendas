-- =====================================================================
-- REMHUB · Planes, suscripciones, prueba gratuita y pagos DE REMHUB (SaaS)
--
-- Separado por completo de los cobros de las tiendas a sus clientes
-- (billing_settings / process_wompi_event / Addi siguen igual).
--
--   saas_plans               planes (precios, límites, módulos)  · editables por el admin
--   saas_plan_history        cada cambio de un plan (antes / después / quién / motivo)
--   saas_subscriptions       una por tienda madre (organización que paga)
--   saas_subscription_events historial de cambios de cada suscripción
--   saas_trials              una prueba por tienda y por dueño (no se reinicia)
--   saas_payments            cobros de RemHub (referencia única, idempotentes)
--   saas_webhook_events      eventos recibidos de la pasarela (sin duplicados)
--   saas_settings            interruptores globales (bloquear límites o solo observar)
--   saas_usage_events        analítica comercial (vio precios, empezó prueba, pagó…)
--
-- Nadie lee ni escribe estas tablas directo desde el navegador: todo pasa
-- por funciones que revisan quién llama. Un cliente NO puede cambiar su
-- plan ni su estado de pago.
--
-- Clientes actuales: quedan en el plan «Fundador» (sin límites) con su
-- fecha active_until de siempre. Nada cambia para ellos.
-- Límites: arrancan en modo OBSERVAR (se registra cuando alguien los
-- supera, sin bloquear). Se encienden desde el admin cuando lo decidas.
--
-- Idempotente. No borra datos.
-- =====================================================================

-- 1. Planes -------------------------------------------------------------
create table if not exists public.saas_plans (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null,
  tagline text,
  monthly_price integer not null default 0 check (monthly_price >= 0),      -- COP
  yearly_price integer not null default 0 check (yearly_price >= 0),        -- COP
  -- Límites: null = ilimitado.
  max_products integer check (max_products is null or max_products >= 0),
  max_users integer check (max_users is null or max_users >= 0),
  max_points integer check (max_points is null or max_points >= 0),
  max_catalogs integer check (max_catalogs is null or max_catalogs >= 0),
  extra_point_price integer check (extra_point_price is null or extra_point_price >= 0),
  modules text[] not null default '{}',
  features jsonb not null default '[]'::jsonb,     -- textos para la página de precios
  trial_days integer not null default 0 check (trial_days between 0 and 60),
  public boolean not null default true,            -- se muestra en la página de precios
  active boolean not null default true,            -- se puede contratar
  highlight boolean not null default false,
  sort_order integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.saas_plan_history (
  id bigint generated always as identity primary key,
  plan_id text not null,
  before jsonb,
  after jsonb,
  reason text,
  by_user uuid,
  at timestamptz not null default now()
);

-- 2. Suscripción de cada tienda madre -------------------------------------
create table if not exists public.saas_subscriptions (
  store_id uuid primary key references public.stores(id) on delete cascade,
  plan_id text not null references public.saas_plans(id),
  -- free: plan gratis · trialing: en prueba · active: pagada · payment_pending: esperando confirmación
  -- past_due: no se pudo cobrar la renovación · canceled: no renueva · expired: venció · suspended: suspendida por RemHub
  status text not null check (status in ('free', 'trialing', 'active', 'payment_pending', 'past_due', 'canceled', 'expired', 'suspended')),
  billing_period text check (billing_period in ('month', 'year')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_plan_id text references public.saas_plans(id),
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Precio pactado: un cambio de precio del plan no afecta a quien ya pagó (se renueva con este).
  locked_monthly_price integer,
  locked_yearly_price integer,
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  extra_points integer not null default 0 check (extra_points >= 0),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saas_subscription_events (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null,             -- created, trial_started, trial_ended, paid, plan_changed, canceled, expired, suspended, reactivated, admin_change…
  before jsonb,
  after jsonb,
  reason text,
  by_user uuid,
  correlation_id text,
  at timestamptz not null default now()
);
create index if not exists saas_subscription_events_store on public.saas_subscription_events (store_id, at desc);

-- 3. Prueba gratuita (una vez por tienda y una vez por dueño) -------------
create table if not exists public.saas_trials (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  owner_id uuid not null,
  plan_id text not null references public.saas_plans(id),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  converted_at timestamptz
);
create unique index if not exists saas_trials_owner on public.saas_trials (owner_id);

-- 4. Pagos de RemHub ------------------------------------------------------
create table if not exists public.saas_payments (
  id uuid primary key default gen_random_uuid(),
  -- Si se borra la tienda, el pago a RemHub queda (historial contable), sin tienda.
  store_id uuid references public.stores(id) on delete set null,
  reference text not null unique,                 -- la que se manda a la pasarela
  provider text not null default 'wompi',
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  plan_id text not null references public.saas_plans(id),
  billing_period text not null check (billing_period in ('month', 'year')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'COP',
  status text not null default 'created' check (status in ('created', 'pending', 'approved', 'declined', 'voided', 'error', 'refunded', 'review')),
  provider_tx_id text,
  provider_status text,
  payment_method text,
  fee_cents bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  raw jsonb
);
create unique index if not exists saas_payments_tx on public.saas_payments (provider, provider_tx_id) where provider_tx_id is not null;
create index if not exists saas_payments_store on public.saas_payments (store_id, created_at desc);
create index if not exists saas_payments_status on public.saas_payments (status, created_at desc);

create table if not exists public.saas_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,          -- id/checksum del evento: el mismo evento repetido no se procesa dos veces
  event_type text,
  received_at timestamptz not null default now(),
  valid_signature boolean not null default false,
  result text,                      -- applied, duplicate, ignored, invalid, error
  detail text,
  payload jsonb,
  unique (provider, event_key)
);

-- 5. Configuración y analítica ---------------------------------------------
create table if not exists public.saas_settings (
  id boolean primary key default true check (id),
  enforce_limits boolean not null default false,   -- false = solo observar
  default_trial_plan text not null default 'negocio',
  default_trial_days integer not null default 7 check (default_trial_days between 0 and 60),
  grace_days integer not null default 3 check (grace_days between 0 and 30),
  free_plan text not null default 'gratis',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.saas_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.saas_usage_events (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores(id) on delete set null,
  user_id uuid,
  kind text not null check (char_length(kind) between 2 and 60),   -- pricing_view, trial_start, checkout_start, limit_hit, premium_view…
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists saas_usage_events_kind on public.saas_usage_events (kind, at desc);

-- Todo cerrado al navegador: solo se usa por las funciones de abajo.
do $$
declare t text;
begin
  foreach t in array array['saas_plans', 'saas_plan_history', 'saas_subscriptions', 'saas_subscription_events', 'saas_trials',
                           'saas_payments', 'saas_webhook_events', 'saas_settings', 'saas_usage_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 6. Planes iniciales (precios de trabajo: se cambian desde el admin) -------
insert into public.saas_plans (id, name, tagline, monthly_price, yearly_price, max_products, max_users, max_points, max_catalogs, extra_point_price, modules, features, trial_days, public, active, highlight, sort_order) values
  ('gratis', 'Gratis', 'Para conocer RemHub', 0, 0, 10, 1, 1, 1, null,
   array['catalog', 'orders'],
   '["Hasta 10 productos", "1 catálogo con tu enlace", "Pedidos por WhatsApp", "1 usuario"]'::jsonb, 0, true, true, false, 10),
  ('emprendedor', 'Emprendedor', 'Para vender en serio', 49900, 499000, 300, 3, 1, 5, 29900,
   array['catalog', 'orders', 'pos', 'inventory', 'customers', 'cash', 'social'],
   '["Hasta 300 productos", "5 catálogos con 5 listas de precios", "POS y caja", "Inventario con ingresos de factura", "3 usuarios"]'::jsonb, 0, true, true, false, 20),
  ('negocio', 'Negocio', 'Para negocios con varios puntos', 99900, 999000, 2000, 10, 3, null, 29900,
   array['catalog', 'orders', 'pos', 'inventory', 'customers', 'cash', 'social', 'points', 'transfers', 'stock_requests', 'profit', 'expenses', 'reports', 'exports'],
   '["Hasta 2.000 productos", "3 puntos o bodegas", "Traslados con firma y pedidos internos", "Rentabilidad y precios por punto", "Gastos e informes", "10 usuarios"]'::jsonb, 7, true, true, true, 30),
  ('empresarial', 'Empresarial', 'Para cadenas y bodegas', 199900, 1999000, null, 30, 10, null, 24900,
   array['catalog', 'orders', 'pos', 'inventory', 'customers', 'cash', 'social', 'points', 'transfers', 'stock_requests', 'profit', 'expenses', 'reports', 'exports',
         'internal_credit', 'settlements', 'payroll', 'fiscal', 'audit', 'custom_domain'],
   '["Productos ilimitados", "10 puntos o bodegas", "Crédito bodega → puntos y liquidaciones", "Nómina y facturación electrónica", "Auditoría completa", "Dominio propio", "30 usuarios"]'::jsonb, 7, true, true, false, 40),
  ('fundador', 'Fundador', 'Clientes de RemHub desde el inicio', 0, 0, null, null, null, null, null,
   array['catalog', 'orders', 'pos', 'inventory', 'customers', 'cash', 'social', 'points', 'transfers', 'stock_requests', 'profit', 'expenses', 'reports', 'exports',
         'internal_credit', 'settlements', 'payroll', 'fiscal', 'audit', 'custom_domain'],
   '["Todo incluido, como siempre"]'::jsonb, 0, false, false, false, 99)
on conflict (id) do nothing;

-- 7. Clientes actuales → «Fundador» con su fecha de siempre ------------------
insert into public.saas_subscriptions (store_id, plan_id, status, current_period_end, admin_note)
select s.id, 'fundador',
       case when not s.active then 'suspended' when s.active_until is not null and s.active_until <= now() then 'expired' else 'active' end,
       s.active_until, 'Cliente existente al activar planes (20261211)'
from public.stores s
on conflict (store_id) do nothing;

-- 8. Estado efectivo y derechos de uso (la única fuente de verdad) -----------
-- El estado se calcula con las fechas cada vez (no depende de que alguien abra la página).
create or replace function public.saas__effective(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sub public.saas_subscriptions;
  cfg public.saas_settings;
  v_status text;
  v_plan text;
  v_now timestamptz := now();
begin
  select * into cfg from public.saas_settings where id;
  select * into sub from public.saas_subscriptions where store_id = p_store;
  if not found then
    return jsonb_build_object('plan_id', coalesce(cfg.free_plan, 'gratis'), 'status', 'free', 'source', 'default');
  end if;
  v_status := sub.status;
  v_plan := sub.plan_id;
  if v_status = 'trialing' then
    if sub.trial_ends_at is not null and sub.trial_ends_at > v_now then v_plan := coalesce(sub.trial_plan_id, sub.plan_id);
    else v_status := 'free'; v_plan := coalesce(cfg.free_plan, 'gratis');
    end if;
  elsif v_status in ('active', 'canceled', 'past_due') and sub.current_period_end is not null then
    -- Período vencido: unos días de gracia y luego plan gratis (los datos NO se borran).
    if sub.current_period_end + make_interval(days => coalesce(cfg.grace_days, 3)) <= v_now then
      v_status := 'expired'; v_plan := coalesce(cfg.free_plan, 'gratis');
    elsif sub.current_period_end <= v_now then
      v_status := 'past_due';
    end if;
  elsif v_status = 'expired' then
    v_plan := coalesce(cfg.free_plan, 'gratis');
  end if;
  return jsonb_build_object('plan_id', v_plan, 'status', v_status, 'subscription_plan', sub.plan_id,
                            'period_end', sub.current_period_end, 'trial_ends_at', sub.trial_ends_at,
                            'cancel_at_period_end', sub.cancel_at_period_end, 'extra_points', sub.extra_points);
end $$;
revoke all on function public.saas__effective(uuid) from public, anon, authenticated;

-- Uso actual de la tienda (lo que cuenta contra los límites).
create or replace function public.saas__usage(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'products', (select count(*) from public.products p where p.store_id = p_store and coalesce(p.active, true)),
    'users', (select count(*) from public.store_users su where su.store_id = p_store and su.active),
    'points', (select count(*) from public.erp_warehouses w where w.store_id = p_store and w.active),
    'catalogs', case when to_regclass('public.store_catalogs') is null then 0
                     else (select count(*) from public.store_catalogs c where c.store_id = p_store) end);
$$;
revoke all on function public.saas__usage(uuid) from public, anon, authenticated;

-- Derechos de uso: plan, estado, límites, módulos y consumo.
-- La puede leer cualquier miembro de la tienda y el administrador de RemHub.
create or replace function public.saas_entitlements(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  eff jsonb;
  pl public.saas_plans;
  cfg public.saas_settings;
  v_member boolean;
begin
  v_member := exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
           or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active)
           or public.erp_is_platform_admin();
  if auth.uid() is null or not v_member then return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.'); end if;
  select * into cfg from public.saas_settings where id;
  eff := public.saas__effective(p_store);
  select * into pl from public.saas_plans where id = eff->>'plan_id';
  return jsonb_build_object(
    'ok', true,
    'plan', jsonb_build_object('id', pl.id, 'name', pl.name, 'monthly_price', pl.monthly_price, 'yearly_price', pl.yearly_price),
    'status', eff->>'status',
    'subscription_plan', eff->>'subscription_plan',
    'period_end', eff->'period_end',
    'trial_ends_at', eff->'trial_ends_at',
    'trial_days_left', case when eff->>'status' = 'trialing' then greatest(0, ceil(extract(epoch from ((eff->>'trial_ends_at')::timestamptz - now())) / 86400))::int end,
    'cancel_at_period_end', coalesce((eff->>'cancel_at_period_end')::boolean, false),
    'limits', jsonb_build_object('products', pl.max_products, 'users', pl.max_users,
                                 'points', case when pl.max_points is null then null else pl.max_points + coalesce((eff->>'extra_points')::int, 0) end,
                                 'catalogs', pl.max_catalogs),
    'modules', to_jsonb(pl.modules),
    'usage', public.saas__usage(p_store),
    'enforce', cfg.enforce_limits,
    'trial_available', not exists (select 1 from public.saas_trials t where t.store_id = p_store
                                    or t.owner_id = (select owner_id from public.stores where id = p_store)));
end $$;
revoke all on function public.saas_entitlements(uuid) from public, anon;
grant execute on function public.saas_entitlements(uuid) to authenticated;

-- ¿Puede la tienda usar este módulo? (para funciones del servidor y la pantalla)
create or replace function public.saas_has_module(p_store uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p_module = any (p.modules) from public.saas_plans p where p.id = public.saas__effective(p_store)->>'plan_id'), false);
$$;
revoke all on function public.saas_has_module(uuid, text) from public, anon;
grant execute on function public.saas_has_module(uuid, text) to authenticated;

-- 9. Límites: al crear productos, usuarios y puntos ------------------------
-- Modo observar (por defecto): se deja crear y se anota «limit_hit». Modo bloquear: se rechaza con un mensaje claro.
create or replace function public.saas__check_limit(p_store uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ent jsonb;
  v_limit integer;
  v_used integer;
  v_enforce boolean;
  v_label text := case p_kind when 'products' then 'productos' when 'users' then 'usuarios' when 'points' then 'puntos o bodegas' else p_kind end;
begin
  -- Solo cuenta para quien es de la tienda (llamarla para otra tienda no hace nada) y nunca frena al admin de RemHub.
  if auth.uid() is null or public.erp_is_platform_admin() then return; end if;
  if not (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
          or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid())) then return; end if;
  ent := jsonb_build_object('limits', (select to_jsonb(x) from (select max_products as products, max_users as users,
                                         max_points + coalesce((public.saas__effective(p_store)->>'extra_points')::int, 0) as points
                                       from public.saas_plans where id = public.saas__effective(p_store)->>'plan_id') x));
  v_limit := (ent->'limits'->>p_kind)::integer;
  if v_limit is null then return; end if;
  v_used := (public.saas__usage(p_store)->>p_kind)::integer;
  if v_used < v_limit then return; end if;
  select enforce_limits into v_enforce from public.saas_settings where id;
  insert into public.saas_usage_events (store_id, user_id, kind, detail)
  values (p_store, auth.uid(), 'limit_hit', jsonb_build_object('limit', p_kind, 'max', v_limit, 'used', v_used, 'blocked', coalesce(v_enforce, false)));
  if coalesce(v_enforce, false) then
    raise exception 'Tu plan permite hasta % %. Mejora tu plan en «Mi plan» para agregar más.', v_limit, v_label
      using errcode = 'P0001', hint = 'plan_limit:' || p_kind;
  end if;
end $$;
revoke all on function public.saas__check_limit(uuid, text) from public, anon;
grant execute on function public.saas__check_limit(uuid, text) to authenticated;

-- Los activadores NO son «security definer» a propósito: así current_user dice si el cambio vino de la app
-- (authenticated) o de un proceso interno / migración (que no se frena).

create or replace function public.saas__limit_products() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if coalesce(new.active, true) and (tg_op = 'INSERT' or not coalesce(old.active, true)) then perform public.saas__check_limit(new.store_id, 'products'); end if;
  return new;
end $$;
create or replace function public.saas__limit_users() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.active and (tg_op = 'INSERT' or not old.active) then perform public.saas__check_limit(new.store_id, 'users'); end if;
  return new;
end $$;
create or replace function public.saas__limit_points() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.active and (tg_op = 'INSERT' or not old.active) then perform public.saas__check_limit(new.store_id, 'points'); end if;
  return new;
end $$;
drop trigger if exists saas_limit_products on public.products;
create trigger saas_limit_products before insert or update of active on public.products for each row execute function public.saas__limit_products();
drop trigger if exists saas_limit_users on public.store_users;
create trigger saas_limit_users before insert or update of active on public.store_users for each row execute function public.saas__limit_users();
drop trigger if exists saas_limit_points on public.erp_warehouses;
create trigger saas_limit_points before insert or update of active on public.erp_warehouses for each row execute function public.saas__limit_points();

-- Tiendas nuevas: arrancan en el plan gratis (las crea el admin o el registro).
create or replace function public.saas__store_created() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.saas_subscriptions (store_id, plan_id, status)
  values (new.id, coalesce((select free_plan from public.saas_settings where id), 'gratis'), 'free')
  on conflict (store_id) do nothing;
  insert into public.saas_subscription_events (store_id, kind, after) values (new.id, 'created', jsonb_build_object('plan', 'gratis', 'status', 'free'));
  return new;
end $$;
drop trigger if exists saas_store_created on public.stores;
create trigger saas_store_created after insert on public.stores for each row execute function public.saas__store_created();

-- 10. Prueba gratuita (fechas en el servidor; una sola vez) --------------------
create or replace function public.saas_trial_start(p_store uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.stores;
  cfg public.saas_settings;
  pl public.saas_plans;
  sub public.saas_subscriptions;
  v_ends timestamptz;
begin
  select * into st from public.stores where id = p_store;
  if not found or st.owner_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Solo el dueño de la tienda puede empezar la prueba.');
  end if;
  select * into cfg from public.saas_settings where id;
  select * into pl from public.saas_plans where id = cfg.default_trial_plan and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'La prueba no está disponible en este momento.'); end if;
  if exists (select 1 from public.saas_trials t where t.store_id = p_store or t.owner_id = st.owner_id) then
    return jsonb_build_object('ok', false, 'error', 'Esta cuenta ya usó su prueba gratuita.');
  end if;
  select * into sub from public.saas_subscriptions where store_id = p_store for update;
  if found and sub.status in ('active', 'trialing', 'payment_pending') and sub.plan_id <> coalesce(cfg.free_plan, 'gratis') then
    return jsonb_build_object('ok', false, 'error', 'Tu tienda ya tiene un plan activo.');
  end if;
  v_ends := now() + make_interval(days => coalesce(nullif(pl.trial_days, 0), cfg.default_trial_days, 7));
  insert into public.saas_trials (store_id, owner_id, plan_id, ends_at) values (p_store, st.owner_id, pl.id, v_ends);
  insert into public.saas_subscriptions (store_id, plan_id, status, trial_plan_id, trial_ends_at)
  values (p_store, coalesce(cfg.free_plan, 'gratis'), 'trialing', pl.id, v_ends)
  on conflict (store_id) do update set status = 'trialing', trial_plan_id = excluded.trial_plan_id, trial_ends_at = excluded.trial_ends_at, updated_at = now();
  insert into public.saas_subscription_events (store_id, kind, after, by_user)
  values (p_store, 'trial_started', jsonb_build_object('plan', pl.id, 'ends_at', v_ends), auth.uid());
  insert into public.saas_usage_events (store_id, user_id, kind, detail) values (p_store, auth.uid(), 'trial_start', jsonb_build_object('plan', pl.id));
  return jsonb_build_object('ok', true, 'plan', pl.id, 'ends_at', v_ends);
end $$;
revoke all on function public.saas_trial_start(uuid) from public, anon;
grant execute on function public.saas_trial_start(uuid) to authenticated;

-- 11. Planes públicos (página de precios: sin sesión) ---------------------------
create or replace function public.saas_public_plans()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'tagline', p.tagline, 'monthly_price', p.monthly_price, 'yearly_price', p.yearly_price,
      'max_products', p.max_products, 'max_users', p.max_users, 'max_points', p.max_points, 'max_catalogs', p.max_catalogs,
      'extra_point_price', p.extra_point_price, 'modules', p.modules, 'features', p.features, 'trial_days', p.trial_days,
      'highlight', p.highlight) order by p.sort_order), '[]'::jsonb)
  from public.saas_plans p where p.public and p.active;
$$;
revoke all on function public.saas_public_plans() from public;
grant execute on function public.saas_public_plans() to anon, authenticated;

-- Analítica comercial desde la página (solo tipos permitidos; sin datos personales).
create or replace function public.saas_track(p_kind text, p_store uuid default null, p_detail jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('pricing_view', 'plan_click', 'checkout_start', 'checkout_abandon', 'premium_view', 'upgrade_click', 'signup_start') then return; end if;
  if p_store is not null and not (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
                                  or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid())) then
    p_store := null;
  end if;
  insert into public.saas_usage_events (store_id, user_id, kind, detail)
  values (p_store, auth.uid(), p_kind, case when p_detail is null then null else jsonb_strip_nulls(p_detail) end);
end $$;
revoke all on function public.saas_track(text, uuid, jsonb) from public;
grant execute on function public.saas_track(text, uuid, jsonb) to anon, authenticated;

-- 12. Administración (solo el administrador de RemHub; todo queda en el historial) --
create or replace function public.saas_admin_set_subscription(p_store uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.saas_subscriptions;
  after_row public.saas_subscriptions;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo del cambio.'); end if;
  if p_changes ? 'plan_id' and not exists (select 1 from public.saas_plans where id = p_changes->>'plan_id') then
    return jsonb_build_object('ok', false, 'error', 'Ese plan no existe.');
  end if;
  select * into before_row from public.saas_subscriptions where store_id = p_store for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'La tienda no tiene suscripción.'); end if;
  update public.saas_subscriptions set
    plan_id = coalesce(p_changes->>'plan_id', plan_id),
    status = coalesce(p_changes->>'status', status),
    billing_period = case when p_changes ? 'billing_period' then p_changes->>'billing_period' else billing_period end,
    current_period_end = case when p_changes ? 'current_period_end' then (p_changes->>'current_period_end')::timestamptz else current_period_end end,
    trial_ends_at = case when p_changes ? 'trial_ends_at' then (p_changes->>'trial_ends_at')::timestamptz else trial_ends_at end,
    discount_pct = coalesce((p_changes->>'discount_pct')::numeric, discount_pct),
    extra_points = coalesce((p_changes->>'extra_points')::int, extra_points),
    locked_monthly_price = case when p_changes ? 'locked_monthly_price' then (p_changes->>'locked_monthly_price')::int else locked_monthly_price end,
    locked_yearly_price = case when p_changes ? 'locked_yearly_price' then (p_changes->>'locked_yearly_price')::int else locked_yearly_price end,
    cancel_at_period_end = coalesce((p_changes->>'cancel_at_period_end')::boolean, cancel_at_period_end),
    admin_note = case when p_changes ? 'admin_note' then p_changes->>'admin_note' else admin_note end,
    updated_at = now()
  where store_id = p_store
  returning * into after_row;
  insert into public.saas_subscription_events (store_id, kind, before, after, reason, by_user)
  values (p_store, 'admin_change', to_jsonb(before_row), to_jsonb(after_row), btrim(p_reason), auth.uid());
  return jsonb_build_object('ok', true, 'subscription', to_jsonb(after_row));
exception when check_violation or invalid_text_representation or invalid_datetime_format then
  return jsonb_build_object('ok', false, 'error', 'Algún dato no es válido: ' || sqlerrm);
end $$;
revoke all on function public.saas_admin_set_subscription(uuid, jsonb, text) from public, anon;
grant execute on function public.saas_admin_set_subscription(uuid, jsonb, text) to authenticated;

create or replace function public.saas_admin_save_plan(p_plan jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_plan->>'id';
  before_row public.saas_plans;
  after_row public.saas_plans;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo del cambio.'); end if;
  select * into before_row from public.saas_plans where id = v_id;
  insert into public.saas_plans as p (id, name, tagline, monthly_price, yearly_price, max_products, max_users, max_points, max_catalogs, extra_point_price,
                                 modules, features, trial_days, public, active, highlight, sort_order, updated_by, updated_at)
  values (v_id, coalesce(p_plan->>'name', v_id), p_plan->>'tagline', coalesce((p_plan->>'monthly_price')::int, 0), coalesce((p_plan->>'yearly_price')::int, 0),
          (p_plan->>'max_products')::int, (p_plan->>'max_users')::int, (p_plan->>'max_points')::int, (p_plan->>'max_catalogs')::int, (p_plan->>'extra_point_price')::int,
          coalesce(array(select jsonb_array_elements_text(p_plan->'modules')), '{}'), coalesce(p_plan->'features', '[]'::jsonb),
          coalesce((p_plan->>'trial_days')::int, 0), coalesce((p_plan->>'public')::boolean, true), coalesce((p_plan->>'active')::boolean, true),
          coalesce((p_plan->>'highlight')::boolean, false), coalesce((p_plan->>'sort_order')::int, 50), auth.uid(), now())
  on conflict (id) do update set
    name = excluded.name, tagline = excluded.tagline, monthly_price = excluded.monthly_price, yearly_price = excluded.yearly_price,
    max_products = excluded.max_products, max_users = excluded.max_users, max_points = excluded.max_points, max_catalogs = excluded.max_catalogs,
    extra_point_price = excluded.extra_point_price, modules = excluded.modules, features = excluded.features, trial_days = excluded.trial_days,
    public = excluded.public, active = excluded.active, highlight = excluded.highlight, sort_order = excluded.sort_order,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into after_row;
  insert into public.saas_plan_history (plan_id, before, after, reason, by_user) values (v_id, to_jsonb(before_row), to_jsonb(after_row), btrim(p_reason), auth.uid());
  -- Los que ya pagaron conservan su precio hasta renovar (locked_*). Se avisa cuántos usan el plan.
  return jsonb_build_object('ok', true, 'plan', to_jsonb(after_row),
    'subscribers', (select count(*) from public.saas_subscriptions s where s.plan_id = v_id and s.status in ('active', 'past_due', 'canceled')));
exception when check_violation or invalid_text_representation then
  return jsonb_build_object('ok', false, 'error', 'Algún dato no es válido: ' || sqlerrm);
end $$;
revoke all on function public.saas_admin_save_plan(jsonb, text) from public, anon;
grant execute on function public.saas_admin_save_plan(jsonb, text) to authenticated;

create or replace function public.saas_admin_settings_save(p_cfg jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare before_row public.saas_settings; after_row public.saas_settings;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  select * into before_row from public.saas_settings where id;
  update public.saas_settings set
    enforce_limits = coalesce((p_cfg->>'enforce_limits')::boolean, enforce_limits),
    default_trial_plan = coalesce(p_cfg->>'default_trial_plan', default_trial_plan),
    default_trial_days = coalesce((p_cfg->>'default_trial_days')::int, default_trial_days),
    grace_days = coalesce((p_cfg->>'grace_days')::int, grace_days),
    updated_by = auth.uid(), updated_at = now()
  where id returning * into after_row;
  insert into public.saas_plan_history (plan_id, before, after, reason, by_user) values ('_settings', to_jsonb(before_row), to_jsonb(after_row), p_reason, auth.uid());
  return jsonb_build_object('ok', true, 'settings', to_jsonb(after_row));
end $$;
revoke all on function public.saas_admin_settings_save(jsonb, text) from public, anon;
grant execute on function public.saas_admin_settings_save(jsonb, text) to authenticated;

-- 13. Pagos de RemHub: crear la referencia y aplicar el resultado (solo servidor) --
-- saas_checkout_create la llama la API de RemHub con la sesión del dueño: el precio sale de la base, nunca del navegador.
create or replace function public.saas_checkout_create(p_store uuid, p_plan text, p_period text, p_environment text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.stores;
  pl public.saas_plans;
  sub public.saas_subscriptions;
  v_price integer;
  v_ref text;
begin
  select * into st from public.stores where id = p_store;
  if not found or st.owner_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'error', 'Solo el dueño de la tienda puede contratar.'); end if;
  if p_period not in ('month', 'year') then return jsonb_build_object('ok', false, 'error', 'Periodo no válido.'); end if;
  if p_environment not in ('sandbox', 'production') then return jsonb_build_object('ok', false, 'error', 'Entorno no válido.'); end if;
  select * into pl from public.saas_plans where id = p_plan and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'Ese plan no está disponible.'); end if;
  select * into sub from public.saas_subscriptions where store_id = p_store;
  -- Precio pactado si renueva el mismo plan; si no, el del plan. Descuento del admin, si tiene.
  v_price := case
    when sub.plan_id = pl.id and p_period = 'month' and sub.locked_monthly_price is not null then sub.locked_monthly_price
    when sub.plan_id = pl.id and p_period = 'year' and sub.locked_yearly_price is not null then sub.locked_yearly_price
    when p_period = 'month' then pl.monthly_price else pl.yearly_price end;
  v_price := round(v_price * (1 - coalesce(sub.discount_pct, 0) / 100.0))::int;
  if v_price <= 0 then return jsonb_build_object('ok', false, 'error', 'Este plan no se cobra.'); end if;
  v_ref := 'RH-' || to_char(now() at time zone 'America/Bogota', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.saas_payments (store_id, reference, environment, plan_id, billing_period, amount_cents, status, created_by)
  values (p_store, v_ref, p_environment, pl.id, p_period, v_price::bigint * 100, 'created', auth.uid());
  insert into public.saas_usage_events (store_id, user_id, kind, detail) values (p_store, auth.uid(), 'checkout_start', jsonb_build_object('plan', pl.id, 'period', p_period));
  return jsonb_build_object('ok', true, 'reference', v_ref, 'amount_cents', v_price::bigint * 100, 'currency', 'COP', 'plan', pl.name, 'period', p_period,
                            'email', (select email from auth.users where id = auth.uid()));
end $$;
revoke all on function public.saas_checkout_create(uuid, text, text, text) from public, anon;
grant execute on function public.saas_checkout_create(uuid, text, text, text) to authenticated;

-- saas_payment_apply: SOLO con la llave de servicio (el webhook ya verificó la firma y consultó la transacción a Wompi).
-- Idempotente: el mismo evento o la misma transacción no se aplican dos veces.
create or replace function public.saas_payment_apply(p_provider text, p_event_key text, p_reference text, p_tx_id text, p_status text,
                                                     p_amount_cents bigint, p_currency text, p_method text, p_environment text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.saas_payments;
  sub public.saas_subscriptions;
  v_status text;
  v_start timestamptz;
  v_end timestamptz;
begin
  -- 1) ¿Ya llegó este evento?
  begin
    insert into public.saas_webhook_events (provider, event_key, event_type, valid_signature, payload)
    values (p_provider, p_event_key, 'transaction', true, p_payload);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'result', 'duplicate');
  end;

  select * into pay from public.saas_payments where reference = p_reference for update;
  if not found then
    update public.saas_webhook_events set result = 'ignored', detail = 'Referencia que no es de RemHub' where provider = p_provider and event_key = p_event_key;
    return jsonb_build_object('ok', true, 'result', 'ignored');
  end if;
  -- 2) El monto, la moneda y el entorno deben coincidir con lo que RemHub cobró.
  if p_amount_cents is distinct from pay.amount_cents or upper(coalesce(p_currency, '')) <> pay.currency or p_environment is distinct from pay.environment then
    update public.saas_payments set status = 'review', provider_tx_id = coalesce(provider_tx_id, p_tx_id), provider_status = p_status, raw = p_payload, updated_at = now() where id = pay.id;
    update public.saas_webhook_events set result = 'review', detail = 'Monto, moneda o entorno no coinciden' where provider = p_provider and event_key = p_event_key;
    return jsonb_build_object('ok', true, 'result', 'review');
  end if;
  v_status := case upper(p_status) when 'APPROVED' then 'approved' when 'DECLINED' then 'declined' when 'VOIDED' then 'voided'
                                   when 'ERROR' then 'error' when 'PENDING' then 'pending' else 'review' end;
  -- Un pago aprobado no se «desaprueba» con un evento viejo.
  if pay.status = 'approved' and v_status <> 'approved' and v_status <> 'voided' then
    update public.saas_webhook_events set result = 'ignored', detail = 'El pago ya estaba aprobado' where provider = p_provider and event_key = p_event_key;
    return jsonb_build_object('ok', true, 'result', 'ignored');
  end if;
  update public.saas_payments set status = v_status, provider_tx_id = coalesce(provider_tx_id, p_tx_id), provider_status = p_status,
         payment_method = p_method, raw = p_payload, updated_at = now(),
         approved_at = case when v_status = 'approved' then coalesce(approved_at, now()) else approved_at end
  where id = pay.id;

  -- 3) Aprobado (y no aplicado antes): activa o extiende la suscripción.
  if v_status = 'approved' and pay.status <> 'approved' then
    select * into sub from public.saas_subscriptions where store_id = pay.store_id for update;
    v_start := case when sub.status in ('active', 'past_due', 'canceled') and sub.plan_id = pay.plan_id and sub.current_period_end > now()
                    then sub.current_period_end else now() end;
    v_end := v_start + case pay.billing_period when 'year' then interval '1 year' else interval '1 month' end;
    insert into public.saas_subscriptions (store_id, plan_id, status, billing_period, current_period_start, current_period_end)
    values (pay.store_id, pay.plan_id, 'active', pay.billing_period, v_start, v_end)
    on conflict (store_id) do update set
      plan_id = excluded.plan_id, status = 'active', billing_period = excluded.billing_period,
      current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
      cancel_at_period_end = false,
      locked_monthly_price = case when excluded.billing_period = 'month' then pay.amount_cents / 100 else saas_subscriptions.locked_monthly_price end,
      locked_yearly_price = case when excluded.billing_period = 'year' then pay.amount_cents / 100 else saas_subscriptions.locked_yearly_price end,
      updated_at = now();
    update public.saas_trials set converted_at = coalesce(converted_at, now()) where store_id = pay.store_id;
    -- La tienda queda activa hasta el fin del período (compatibilidad con active_until de siempre).
    update public.stores set active = true, active_until = v_end where id = pay.store_id;
    insert into public.saas_subscription_events (store_id, kind, before, after, reason, correlation_id)
    values (pay.store_id, 'paid', to_jsonb(sub), jsonb_build_object('plan', pay.plan_id, 'period', pay.billing_period, 'until', v_end, 'reference', pay.reference),
            'Pago aprobado ' || pay.reference, p_tx_id);
  end if;
  update public.saas_webhook_events set result = 'applied', detail = v_status where provider = p_provider and event_key = p_event_key;
  return jsonb_build_object('ok', true, 'result', 'applied', 'status', v_status, 'store_id', pay.store_id);
end $$;
revoke all on function public.saas_payment_apply(text, text, text, text, text, bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.saas_payment_apply(text, text, text, text, text, bigint, text, text, text, jsonb) to service_role;

-- Firma inválida o error: se anota para que el admin lo vea (solo servidor).
create or replace function public.saas_webhook_reject(p_provider text, p_event_key text, p_result text, p_detail text, p_payload jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.saas_webhook_events (provider, event_key, valid_signature, result, detail, payload)
  values (p_provider, p_event_key, false, p_result, left(p_detail, 500), p_payload)
  on conflict (provider, event_key) do nothing;
$$;
revoke all on function public.saas_webhook_reject(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.saas_webhook_reject(text, text, text, text, jsonb) to service_role;

-- Historial de pagos de la tienda (dueño y admin) -------------------------------
create or replace function public.saas_my_payments(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()) or public.erp_is_platform_admin())
    then coalesce((select jsonb_agg(jsonb_build_object('reference', p.reference, 'plan_id', p.plan_id, 'period', p.billing_period,
                                                       'amount', p.amount_cents / 100, 'status', p.status, 'method', p.payment_method,
                                                       'created_at', p.created_at, 'approved_at', p.approved_at) order by p.created_at desc)
                   from public.saas_payments p where p.store_id = p_store), '[]'::jsonb)
    else '[]'::jsonb end;
$$;
revoke all on function public.saas_my_payments(uuid) from public, anon;
grant execute on function public.saas_my_payments(uuid) to authenticated;

-- Cancelar: deja de renovar al final del período (los datos se conservan). --------
create or replace function public.saas_cancel(p_store uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare sub public.saas_subscriptions;
begin
  if not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Solo el dueño de la tienda puede cancelar.');
  end if;
  select * into sub from public.saas_subscriptions where store_id = p_store for update;
  if not found or sub.status not in ('active', 'past_due') then return jsonb_build_object('ok', false, 'error', 'No hay una suscripción activa para cancelar.'); end if;
  update public.saas_subscriptions set status = 'canceled', cancel_at_period_end = true, updated_at = now() where store_id = p_store;
  insert into public.saas_subscription_events (store_id, kind, before, reason, by_user) values (p_store, 'canceled', to_jsonb(sub), left(p_reason, 300), auth.uid());
  return jsonb_build_object('ok', true, 'until', sub.current_period_end);
end $$;
revoke all on function public.saas_cancel(uuid, text) from public, anon;
grant execute on function public.saas_cancel(uuid, text) to authenticated;


-- 14. Tablero del administrador de RemHub ----------------------------------------
-- Definiciones (todas en COP):
--   cobrado         = pagos APROBADOS dentro del rango (dinero que realmente entró).
--   mrr_estimado    = suscripciones pagadas vigentes llevadas a un mes (anual / 12), con su precio pactado. Sin «Fundador».
--   arr_estimado    = mrr_estimado × 12 (se calcula en la pantalla).
--   conversion      = pruebas iniciadas en el rango que terminaron en pago / pruebas iniciadas en el rango.
-- No incluye NUNCA las ventas de las tiendas a sus clientes.
create or replace function public.saas_admin_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'America/Bogota');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'America/Bogota');
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  return jsonb_build_object(
    'ok', true, 'from', p_from, 'to', p_to,
    'settings', (select to_jsonb(s) from public.saas_settings s where s.id),
    'counts', (
      select jsonb_build_object(
        'stores', count(*),
        'free', count(*) filter (where x->>'status' = 'free'),
        'trialing', count(*) filter (where x->>'status' = 'trialing'),
        'trial_ending', count(*) filter (where x->>'status' = 'trialing' and (x->>'trial_ends_at')::timestamptz < now() + interval '3 days'),
        'active', count(*) filter (where x->>'status' = 'active'),
        'past_due', count(*) filter (where x->>'status' = 'past_due'),
        'canceled', count(*) filter (where x->>'status' = 'canceled'),
        'expired', count(*) filter (where x->>'status' = 'expired'),
        'suspended', count(*) filter (where x->>'status' = 'suspended'),
        'founders', count(*) filter (where x->>'subscription_plan' = 'fundador'),
        'new_stores', (select count(*) from public.stores st where st.created_at >= v_from and st.created_at < v_to))
      from (select public.saas__effective(s.id) as x from public.stores s) q),
    'money', jsonb_build_object(
      'collected', coalesce((select sum(amount_cents) / 100 from public.saas_payments where status = 'approved' and approved_at >= v_from and approved_at < v_to), 0),
      'collected_count', (select count(*) from public.saas_payments where status = 'approved' and approved_at >= v_from and approved_at < v_to),
      'pending', (select count(*) from public.saas_payments where status in ('created', 'pending') and created_at >= v_from and created_at < v_to),
      'declined', (select count(*) from public.saas_payments where status in ('declined', 'error', 'voided') and created_at >= v_from and created_at < v_to),
      'review', (select count(*) from public.saas_payments where status = 'review'),
      'mrr', coalesce((
        select sum(case when s.billing_period = 'year' then coalesce(s.locked_yearly_price, p.yearly_price) / 12.0
                        else coalesce(s.locked_monthly_price, p.monthly_price) end)
        from public.saas_subscriptions s join public.saas_plans p on p.id = s.plan_id
        where s.status in ('active', 'past_due') and s.plan_id <> 'fundador' and coalesce(s.current_period_end, now()) > now()), 0)),
    'funnel', jsonb_build_object(
      'pricing_views', (select count(*) from public.saas_usage_events where kind = 'pricing_view' and at >= v_from and at < v_to),
      'plan_clicks', (select count(*) from public.saas_usage_events where kind = 'plan_click' and at >= v_from and at < v_to),
      'checkouts', (select count(*) from public.saas_usage_events where kind = 'checkout_start' and at >= v_from and at < v_to),
      'trials', (select count(*) from public.saas_trials where started_at >= v_from and started_at < v_to),
      'trials_converted', (select count(*) from public.saas_trials where started_at >= v_from and started_at < v_to and converted_at is not null),
      'limit_hits', (select count(*) from public.saas_usage_events where kind = 'limit_hit' and at >= v_from and at < v_to),
      'cancellations', (select count(*) from public.saas_subscription_events where kind = 'canceled' and at >= v_from and at < v_to)),
    'by_plan', coalesce((
      select jsonb_agg(jsonb_build_object('plan_id', plan_id, 'n', n) order by n desc)
      from (select x->>'plan_id' as plan_id, count(*) as n from (select public.saas__effective(s.id) as x from public.stores s) q group by 1) g), '[]'::jsonb),
    'webhook_problems', (select count(*) from public.saas_webhook_events where result in ('invalid', 'error', 'review') and received_at >= now() - interval '30 days'));
end $$;
revoke all on function public.saas_admin_dashboard(date, date) from public, anon;
grant execute on function public.saas_admin_dashboard(date, date) to authenticated;

-- Tiendas con su suscripción (búsqueda y filtros en el servidor, paginada).
create or replace function public.saas_admin_customers(p_q text, p_status text, p_plan text, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  return (
    with base as (
      select s.id, s.name, s.slug, s.created_at, u.email, x.e,
             (select count(*) from public.erp_warehouses w where w.store_id = s.id and w.active) as points,
             (select count(*) from public.store_users su where su.store_id = s.id and su.active) as users,
             (select count(*) from public.products p where p.store_id = s.id and coalesce(p.active, true)) as products,
             sub.discount_pct, sub.extra_points, sub.admin_note, sub.billing_period, sub.locked_monthly_price, sub.locked_yearly_price
      from public.stores s
      left join auth.users u on u.id = s.owner_id
      left join public.saas_subscriptions sub on sub.store_id = s.id
      cross join lateral (select public.saas__effective(s.id) as e) x
      where (v_q is null or s.name ilike '%' || v_q || '%' or s.slug ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%' or s.id::text = v_q)
    ), f as (
      select * from base
      where (coalesce(p_status, '') = '' or e->>'status' = p_status)
        and (coalesce(p_plan, '') = '' or e->>'subscription_plan' = p_plan or e->>'plan_id' = p_plan)
    )
    select jsonb_build_object('ok', true, 'total', (select count(*) from f),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'store_id', id, 'name', name, 'slug', slug, 'email', email, 'created_at', created_at,
          'plan_id', e->>'plan_id', 'subscription_plan', e->>'subscription_plan', 'status', e->>'status',
          'period_end', e->'period_end', 'trial_ends_at', e->'trial_ends_at', 'billing_period', billing_period,
          'points', points, 'users', users, 'products', products, 'discount_pct', discount_pct, 'extra_points', extra_points,
          'admin_note', admin_note, 'locked_monthly_price', locked_monthly_price, 'locked_yearly_price', locked_yearly_price) order by created_at desc)
        from (select * from f order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) pg), '[]'::jsonb)));
end $$;
revoke all on function public.saas_admin_customers(text, text, text, integer, integer) from public, anon;
grant execute on function public.saas_admin_customers(text, text, text, integer, integer) to authenticated;

-- Pagos de RemHub y avisos de la pasarela (admin).
create or replace function public.saas_admin_payments(p_q text, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  return jsonb_build_object('ok', true,
    'payments', coalesce((select jsonb_agg(r order by r->>'created_at' desc) from (
        select jsonb_build_object('reference', p.reference, 'store', s.name, 'store_id', p.store_id, 'plan_id', p.plan_id, 'period', p.billing_period,
                                  'amount', p.amount_cents / 100, 'status', p.status, 'provider_tx_id', p.provider_tx_id, 'environment', p.environment,
                                  'method', p.payment_method, 'created_at', p.created_at, 'approved_at', p.approved_at) as r
        from public.saas_payments p left join public.stores s on s.id = p.store_id
        where v_q is null or p.reference ilike '%' || v_q || '%' or s.name ilike '%' || v_q || '%' or p.provider_tx_id ilike '%' || v_q || '%'
        order by p.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb),
    'webhooks', coalesce((select jsonb_agg(jsonb_build_object('at', w.received_at, 'result', w.result, 'detail', w.detail, 'valid', w.valid_signature, 'key', left(w.event_key, 40))
                                           order by w.received_at desc)
                          from (select * from public.saas_webhook_events order by received_at desc limit 50) w), '[]'::jsonb));
end $$;
revoke all on function public.saas_admin_payments(text, integer) from public, anon;
grant execute on function public.saas_admin_payments(text, integer) to authenticated;

create or replace function public.saas_admin_store_history(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.erp_is_platform_admin() then jsonb_build_object('ok', false) else jsonb_build_object('ok', true,
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'reason', e.reason, 'at', e.at, 'after', e.after) order by e.at desc)
                        from public.saas_subscription_events e where e.store_id = p_store), '[]'::jsonb),
    'payments', public.saas_my_payments(p_store)) end;
$$;
revoke all on function public.saas_admin_store_history(uuid) from public, anon;
grant execute on function public.saas_admin_store_history(uuid) to authenticated;

create or replace function public.saas_admin_plans()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.erp_is_platform_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object('subscribers', (select count(*) from public.saas_subscriptions s where s.plan_id = p.id and s.status in ('active', 'past_due', 'canceled')))
                     order by p.sort_order) from public.saas_plans p), '[]'::jsonb) end;
$$;
revoke all on function public.saas_admin_plans() from public, anon;
grant execute on function public.saas_admin_plans() to authenticated;

notify pgrst, 'reload schema';
