-- =====================================================================
-- REMHUB · Facturación electrónica como ADICIONAL de cualquier plan
--
--   · saas_addons: paquetes de facturación electrónica (documentos incluidos
--     al mes, precio mensual / anual y precio por documento extra). Los
--     edita el administrador de RemHub.
--   · Cada tienda decide si lo quiere: se paga aparte del plan (en línea con
--     Wompi o a mano desde el admin). El plan no cambia.
--   · Cuenta los documentos ACEPTADOS por la DIAN en producción, por mes
--     calendario (hora de Colombia). Las pruebas (sandbox) no cuentan.
--   · Al cerrar el mes: si se pasó del paquete, se crea un cobro de extras
--     (documentos de más × precio por extra). Sin paquete: todos se cobran al
--     precio «sin paquete» de la configuración.
--   · Bloqueo: arranca en modo OBSERVAR (se anota, no frena). Al encenderlo,
--     una tienda sin el adicional no puede emitir documentos en producción.
-- Los pagos de planes siguen exactamente igual. Idempotente. No borra datos.
-- =====================================================================

-- 1. Paquetes ---------------------------------------------------------------
create table if not exists public.saas_addons (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  kind text not null default 'fiscal' check (kind in ('fiscal')),
  name text not null,
  tagline text,
  monthly_price integer not null default 0 check (monthly_price >= 0),
  yearly_price integer not null default 0 check (yearly_price >= 0),
  included_docs integer not null default 0 check (included_docs >= 0),     -- documentos al mes
  overage_price integer not null default 0 check (overage_price >= 0),     -- COP por documento extra
  public boolean not null default true,
  active boolean not null default true,
  highlight boolean not null default false,
  sort_order integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.saas_addons (id, name, tagline, monthly_price, yearly_price, included_docs, overage_price, highlight, sort_order) values
  ('fe_100', 'Facturación electrónica Básica', 'Para un punto que empieza', 34900, 349000, 100, 450, false, 1),
  ('fe_300', 'Facturación electrónica Estándar', 'El más elegido', 69900, 699000, 300, 400, true, 2),
  ('fe_1000', 'Facturación electrónica Pro', 'Para varios puntos', 179900, 1799000, 1000, 300, false, 3)
on conflict (id) do nothing;

create table if not exists public.saas_addon_history (
  id bigint generated always as identity primary key,
  addon_id text not null, before jsonb, after jsonb, reason text, by_user uuid, at timestamptz not null default now()
);

-- 2. Adicional en la suscripción de cada tienda --------------------------------
alter table public.saas_subscriptions add column if not exists fiscal_addon_id text references public.saas_addons(id);
alter table public.saas_subscriptions add column if not exists fiscal_addon_until timestamptz;           -- null con paquete = sin vencimiento (regalo del admin)
alter table public.saas_subscriptions add column if not exists fiscal_addon_locked_monthly integer;
alter table public.saas_subscriptions add column if not exists fiscal_addon_locked_yearly integer;

alter table public.saas_settings add column if not exists fiscal_enforce boolean not null default false;  -- false = solo observar
alter table public.saas_settings add column if not exists fiscal_payg_price integer not null default 500 check (fiscal_payg_price >= 0);

-- 3. Pagos: un pago puede ser del plan (como siempre) o de facturación electrónica ---------
alter table public.saas_payments add column if not exists kind text not null default 'subscription';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'saas_payments_kind_check') then
    alter table public.saas_payments add constraint saas_payments_kind_check check (kind in ('subscription', 'fiscal'));
  end if;
end $$;
alter table public.saas_payments add column if not exists addon_id text references public.saas_addons(id);
alter table public.saas_payments add column if not exists addon_cents bigint not null default 0;
alter table public.saas_payments add column if not exists overage_ids uuid[] not null default '{}';
alter table public.saas_payments add column if not exists overage_cents bigint not null default 0;

-- 4. Cobros de documentos extra (uno por tienda y mes) --------------------------
create table if not exists public.saas_fiscal_overages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  addon_id text references public.saas_addons(id),
  included integer not null default 0,
  used integer not null default 0,
  extra integer not null default 0,
  unit_price integer not null default 0,
  amount integer not null default 0,
  status text not null default 'open' check (status in ('open', 'paid', 'waived')),
  payment_reference text,
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_by uuid,
  unique (store_id, period)
);
create index if not exists saas_fiscal_overages_status on public.saas_fiscal_overages (status, period desc);

do $$ declare t text;
begin
  foreach t in array array['saas_addons', 'saas_addon_history', 'saas_fiscal_overages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 5. Estado de la facturación electrónica de una tienda ------------------------
create or replace function public.saas__month_bounds(p_period text)
returns table (starts timestamptz, ends timestamptz)
language sql immutable set search_path = public as $$
  select (p_period || '-01')::date::timestamp at time zone 'America/Bogota',
         ((p_period || '-01')::date + interval '1 month')::timestamp at time zone 'America/Bogota';
$$;
revoke all on function public.saas__month_bounds(text) from public, anon, authenticated;

-- Documentos que cuentan: emitidos en producción en el mes. «final» = solo aceptados por la DIAN (para cobrar).
create or replace function public.saas__fiscal_count(p_store uuid, p_period text, p_final boolean)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v integer := 0; b record;
begin
  if to_regclass('public.fiscal_documents') is null then return 0; end if;
  select * into b from public.saas__month_bounds(p_period);
  execute 'select count(*)::int from public.fiscal_documents d where d.store_id = $1 and d.environment = ''production''
             and d.issue_date >= $2 and d.issue_date < $3
             and d.status = any ($4)'
    into v using p_store, b.starts, b.ends,
      case when p_final then array['ACCEPTED'] else array['ACCEPTED', 'SENT', 'PROCESSING', 'QUEUED', 'CONTINGENCY'] end;
  return coalesce(v, 0);
end $$;
revoke all on function public.saas__fiscal_count(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.saas__fiscal_state(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sub public.saas_subscriptions; ad public.saas_addons; cfg public.saas_settings; v_period text; v_used integer; v_active boolean := false;
begin
  select * into cfg from public.saas_settings where id;
  select * into sub from public.saas_subscriptions where store_id = p_store;
  if sub.fiscal_addon_id is not null then select * into ad from public.saas_addons where id = sub.fiscal_addon_id; end if;
  v_active := ad.id is not null and (sub.fiscal_addon_until is null or sub.fiscal_addon_until + make_interval(days => coalesce(cfg.grace_days, 3)) > now());
  v_period := to_char(now() at time zone 'America/Bogota', 'YYYY-MM');
  v_used := public.saas__fiscal_count(p_store, v_period, false);
  return jsonb_build_object(
    'active', v_active,
    'addon', case when ad.id is null then null else jsonb_build_object('id', ad.id, 'name', ad.name, 'included_docs', ad.included_docs, 'overage_price', ad.overage_price,
      'monthly_price', coalesce(sub.fiscal_addon_locked_monthly, ad.monthly_price), 'yearly_price', coalesce(sub.fiscal_addon_locked_yearly, ad.yearly_price)) end,
    'until', sub.fiscal_addon_until,
    'expired', ad.id is not null and not v_active,
    'period', v_period,
    'used', v_used,
    'included', case when v_active then ad.included_docs else 0 end,
    'extra', greatest(0, v_used - case when v_active then ad.included_docs else 0 end),
    'unit_price', case when v_active then ad.overage_price else cfg.fiscal_payg_price end,
    'extra_cost', greatest(0, v_used - case when v_active then ad.included_docs else 0 end) * case when v_active then ad.overage_price else cfg.fiscal_payg_price end,
    'open_overages', coalesce((select sum(amount) from public.saas_fiscal_overages o where o.store_id = p_store and o.status = 'open'), 0),
    'enforce', coalesce(cfg.fiscal_enforce, false));
end $$;
revoke all on function public.saas__fiscal_state(uuid) from public, anon, authenticated;

-- Para la pantalla «Mi plan» y el centro fiscal (cualquier miembro de la tienda).
create or replace function public.saas_my_fiscal(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_member boolean;
begin
  v_member := exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
           or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active)
           or public.erp_is_platform_admin();
  if auth.uid() is null or not v_member then return jsonb_build_object('ok', false, 'error', 'No perteneces a esta tienda.'); end if;
  return jsonb_build_object('ok', true, 'state', public.saas__fiscal_state(p_store),
    'is_owner', exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'tagline', a.tagline, 'monthly_price', a.monthly_price, 'yearly_price', a.yearly_price,
        'included_docs', a.included_docs, 'overage_price', a.overage_price, 'highlight', a.highlight) order by a.sort_order) from public.saas_addons a where a.active and a.public), '[]'::jsonb),
    'overages', coalesce((select jsonb_agg(to_jsonb(o) - 'updated_by' order by o.period desc) from (select * from public.saas_fiscal_overages where store_id = p_store order by period desc limit 24) o), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('period', m.p, 'used', public.saas__fiscal_count(p_store, m.p, true)) order by m.p desc)
        from (select to_char((now() at time zone 'America/Bogota') - make_interval(months => g), 'YYYY-MM') as p from generate_series(0, 5) g) m), '[]'::jsonb));
end $$;
revoke all on function public.saas_my_fiscal(uuid) from public, anon;
grant execute on function public.saas_my_fiscal(uuid) to authenticated;

-- Página de precios (sin sesión).
create or replace function public.saas_public_addons()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'tagline', a.tagline, 'monthly_price', a.monthly_price, 'yearly_price', a.yearly_price,
    'included_docs', a.included_docs, 'overage_price', a.overage_price, 'highlight', a.highlight) order by a.sort_order), '[]'::jsonb)
  from public.saas_addons a where a.public and a.active;
$$;
revoke all on function public.saas_public_addons() from public;
grant execute on function public.saas_public_addons() to anon, authenticated;

-- 6. Al emitir en producción: sin el adicional se anota (y con el bloqueo encendido, se frena) ---------
create or replace function public.saas__fiscal_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st jsonb;
begin
  if new.environment <> 'production' then return new; end if;
  st := public.saas__fiscal_state(new.store_id);
  if not coalesce((st->>'active')::boolean, false) then
    -- Un aviso por tienda y día (no uno por cada documento).
    if not exists (select 1 from public.saas_usage_events u where u.store_id = new.store_id and u.kind = 'fiscal_no_addon' and u.at > now() - interval '1 day') then
      insert into public.saas_usage_events (store_id, user_id, kind, detail)
      values (new.store_id, auth.uid(), 'fiscal_no_addon', jsonb_build_object('document_type', new.document_type));
    end if;
    if coalesce((st->>'enforce')::boolean, false) then
      raise exception 'Para emitir facturación electrónica activa el adicional en «Mi plan».' using errcode = 'P0001', detail = 'SAAS_FISCAL_ADDON';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.saas__fiscal_guard() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.fiscal_documents') is not null then
    execute 'drop trigger if exists zz_saas_fiscal_guard on public.fiscal_documents';
    execute 'create trigger zz_saas_fiscal_guard before insert on public.fiscal_documents for each row execute function public.saas__fiscal_guard()';
  end if;
end $$;

-- Con el adicional activo, la tienda tiene el módulo «fiscal» aunque su plan no lo traiga.
create or replace function public.saas_has_module(p_store uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p_module = any (p.modules) from public.saas_plans p where p.id = public.saas__effective(p_store)->>'plan_id'), false)
      or (p_module = 'fiscal' and coalesce((public.saas__fiscal_state(p_store)->>'active')::boolean, false));
$$;
revoke all on function public.saas_has_module(uuid, text) from public, anon;
grant execute on function public.saas_has_module(uuid, text) to authenticated;

-- 7. Cierre del mes: crea los cobros de documentos extra (idempotente: uno por tienda y mes) ---------
create or replace function public.saas_fiscal_close_month(p_period text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_period text := coalesce(p_period, to_char((now() at time zone 'America/Bogota') - interval '1 month', 'YYYY-MM'));
  r record; v_used integer; ad public.saas_addons; cfg public.saas_settings; v_inc integer; v_unit integer; v_n integer := 0; b record; v_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
begin
  -- El servidor (cron, llave de servicio), el admin de RemHub o el editor SQL de Supabase (sin usuario ni token).
  -- Ojo: dentro de esta función current_user es el dueño, por eso se mira session_user y que no haya usuario.
  if not (coalesce(v_role, '') = 'service_role' or public.erp_is_platform_admin()
          or (auth.uid() is null and coalesce(v_role, '') = '' and session_user in ('postgres', 'supabase_admin'))) then
    return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.');
  end if;
  if v_period !~ '^\d{4}-\d{2}$' or v_period >= to_char(now() at time zone 'America/Bogota', 'YYYY-MM') then
    return jsonb_build_object('ok', false, 'error', 'Solo se cierran meses que ya terminaron.');
  end if;
  if to_regclass('public.fiscal_documents') is null then return jsonb_build_object('ok', true, 'period', v_period, 'charges', 0); end if;
  select * into cfg from public.saas_settings where id;
  select * into b from public.saas__month_bounds(v_period);
  for r in execute 'select distinct d.store_id from public.fiscal_documents d where d.environment = ''production'' and d.status = ''ACCEPTED'' and d.issue_date >= $1 and d.issue_date < $2'
    using b.starts, b.ends loop
    v_used := public.saas__fiscal_count(r.store_id, v_period, true);
    ad := null;
    select a.* into ad from public.saas_subscriptions s join public.saas_addons a on a.id = s.fiscal_addon_id where s.store_id = r.store_id;
    v_inc := coalesce(ad.included_docs, 0);
    v_unit := coalesce(ad.overage_price, cfg.fiscal_payg_price);
    if v_used > v_inc then
      insert into public.saas_fiscal_overages (store_id, period, addon_id, included, used, extra, unit_price, amount)
      values (r.store_id, v_period, ad.id, v_inc, v_used, v_used - v_inc, v_unit, (v_used - v_inc) * v_unit)
      on conflict (store_id, period) do nothing;
      if found then
        v_n := v_n + 1;
        insert into public.saas_subscription_events (store_id, kind, after, reason)
        values (r.store_id, 'fiscal_overage', jsonb_build_object('period', v_period, 'used', v_used, 'included', v_inc, 'amount', (v_used - v_inc) * v_unit), 'Documentos extra de ' || v_period);
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'period', v_period, 'charges', v_n);
end $$;
revoke all on function public.saas_fiscal_close_month(text) from public, anon;
grant execute on function public.saas_fiscal_close_month(text) to authenticated, service_role;

-- 8. Pago en línea de la facturación electrónica (paquete y/o extras) ------------------------
-- p_what: 'addon' (activar o renovar el paquete), 'overages' (pagar extras) o 'both'.
create or replace function public.saas_fiscal_checkout(p_store uuid, p_addon text, p_period text, p_environment text, p_what text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st public.stores; sub public.saas_subscriptions; ad public.saas_addons; v_addon_cents bigint := 0; v_over_cents bigint := 0; v_over uuid[] := '{}';
  v_ref text; v_plan text;
begin
  select * into st from public.stores where id = p_store;
  if not found or st.owner_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'error', 'Solo el dueño de la tienda puede contratar.'); end if;
  if p_period not in ('month', 'year') then return jsonb_build_object('ok', false, 'error', 'Periodo no válido.'); end if;
  if p_environment not in ('sandbox', 'production') then return jsonb_build_object('ok', false, 'error', 'Entorno no válido.'); end if;
  if p_what not in ('addon', 'overages', 'both') then return jsonb_build_object('ok', false, 'error', 'Opción no válida.'); end if;
  select * into sub from public.saas_subscriptions where store_id = p_store;
  if p_what in ('addon', 'both') then
    select * into ad from public.saas_addons where id = coalesce(nullif(p_addon, ''), sub.fiscal_addon_id) and active;
    if not found then return jsonb_build_object('ok', false, 'error', 'Ese paquete no está disponible.'); end if;
    v_addon_cents := (case
      when sub.fiscal_addon_id = ad.id and p_period = 'month' and sub.fiscal_addon_locked_monthly is not null then sub.fiscal_addon_locked_monthly
      when sub.fiscal_addon_id = ad.id and p_period = 'year' and sub.fiscal_addon_locked_yearly is not null then sub.fiscal_addon_locked_yearly
      when p_period = 'month' then ad.monthly_price else ad.yearly_price end)::bigint * 100;
  end if;
  if p_what in ('overages', 'both') then
    select coalesce(array_agg(o.id), '{}'), coalesce(sum(o.amount), 0)::bigint * 100 into v_over, v_over_cents
    from public.saas_fiscal_overages o where o.store_id = p_store and o.status = 'open';
  end if;
  if v_addon_cents + v_over_cents <= 0 then return jsonb_build_object('ok', false, 'error', 'No hay nada por pagar.'); end if;
  v_plan := public.saas__effective(p_store)->>'plan_id';
  v_ref := 'RH-FE-' || to_char(now() at time zone 'America/Bogota', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.saas_payments (store_id, reference, environment, plan_id, billing_period, amount_cents, status, created_by, kind, addon_id, addon_cents, overage_ids, overage_cents)
  values (p_store, v_ref, p_environment, v_plan, p_period, v_addon_cents + v_over_cents, 'created', auth.uid(), 'fiscal', ad.id, v_addon_cents, v_over, v_over_cents);
  insert into public.saas_usage_events (store_id, user_id, kind, detail) values (p_store, auth.uid(), 'checkout_start', jsonb_build_object('fiscal', p_what, 'addon', ad.id, 'period', p_period));
  return jsonb_build_object('ok', true, 'reference', v_ref, 'amount_cents', v_addon_cents + v_over_cents, 'currency', 'COP', 'email', (select email from auth.users where id = auth.uid()));
end $$;
revoke all on function public.saas_fiscal_checkout(uuid, text, text, text, text) from public, anon;
grant execute on function public.saas_fiscal_checkout(uuid, text, text, text, text) to authenticated;

-- Aplica un pago aprobado de facturación electrónica (lo llama saas_payment_apply).
create or replace function public.saas__fiscal_payment_apply(pay public.saas_payments)
returns void language plpgsql security definer set search_path = public as $$
declare sub public.saas_subscriptions; v_start timestamptz; v_end timestamptz;
begin
  if pay.addon_id is not null and pay.addon_cents > 0 then
    select * into sub from public.saas_subscriptions where store_id = pay.store_id for update;
    v_start := case when sub.fiscal_addon_id = pay.addon_id and sub.fiscal_addon_until > now() then sub.fiscal_addon_until else now() end;
    v_end := v_start + case pay.billing_period when 'year' then interval '1 year' else interval '1 month' end;
    insert into public.saas_subscriptions (store_id, plan_id, status, fiscal_addon_id, fiscal_addon_until)
    values (pay.store_id, pay.plan_id, 'free', pay.addon_id, v_end)
    on conflict (store_id) do update set fiscal_addon_id = pay.addon_id, fiscal_addon_until = v_end,
      fiscal_addon_locked_monthly = case when pay.billing_period = 'month' then (pay.addon_cents / 100)::int else saas_subscriptions.fiscal_addon_locked_monthly end,
      fiscal_addon_locked_yearly = case when pay.billing_period = 'year' then (pay.addon_cents / 100)::int else saas_subscriptions.fiscal_addon_locked_yearly end,
      updated_at = now();
    insert into public.saas_subscription_events (store_id, kind, after, reason)
    values (pay.store_id, 'fiscal_addon_paid', jsonb_build_object('addon', pay.addon_id, 'until', v_end, 'reference', pay.reference), 'Pago de facturación electrónica ' || pay.reference);
  end if;
  if cardinality(pay.overage_ids) > 0 then
    update public.saas_fiscal_overages set status = 'paid', paid_at = now(), payment_reference = pay.reference
    where id = any (pay.overage_ids) and status = 'open';
  end if;
end $$;
revoke all on function public.saas__fiscal_payment_apply(public.saas_payments) from public, anon, authenticated;

-- 9. saas_payment_apply: igual que en 20261211; los pagos de facturación electrónica no tocan el plan.
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
  if p_amount_cents is distinct from pay.amount_cents or upper(coalesce(p_currency, '')) <> pay.currency or p_environment is distinct from pay.environment then
    update public.saas_payments set status = 'review', provider_tx_id = coalesce(provider_tx_id, p_tx_id), provider_status = p_status, raw = p_payload, updated_at = now() where id = pay.id;
    update public.saas_webhook_events set result = 'review', detail = 'Monto, moneda o entorno no coinciden' where provider = p_provider and event_key = p_event_key;
    return jsonb_build_object('ok', true, 'result', 'review');
  end if;
  v_status := case upper(p_status) when 'APPROVED' then 'approved' when 'DECLINED' then 'declined' when 'VOIDED' then 'voided'
                                   when 'ERROR' then 'error' when 'PENDING' then 'pending' else 'review' end;
  if pay.status = 'approved' and v_status <> 'approved' and v_status <> 'voided' then
    update public.saas_webhook_events set result = 'ignored', detail = 'El pago ya estaba aprobado' where provider = p_provider and event_key = p_event_key;
    return jsonb_build_object('ok', true, 'result', 'ignored');
  end if;
  update public.saas_payments set status = v_status, provider_tx_id = coalesce(provider_tx_id, p_tx_id), provider_status = p_status,
         payment_method = p_method, raw = p_payload, updated_at = now(),
         approved_at = case when v_status = 'approved' then coalesce(approved_at, now()) else approved_at end
  where id = pay.id;

  if v_status = 'approved' and pay.status <> 'approved' then
    if coalesce(pay.kind, 'subscription') = 'fiscal' then
      -- Facturación electrónica: paquete y/o extras (el plan no cambia).
      perform public.saas__fiscal_payment_apply(pay);
    else
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
      update public.stores set active = true, active_until = v_end where id = pay.store_id;
      insert into public.saas_subscription_events (store_id, kind, before, after, reason, correlation_id)
      values (pay.store_id, 'paid', to_jsonb(sub), jsonb_build_object('plan', pay.plan_id, 'period', pay.billing_period, 'until', v_end, 'reference', pay.reference),
              'Pago aprobado ' || pay.reference, p_tx_id);
    end if;
  end if;
  update public.saas_webhook_events set result = 'applied', detail = v_status where provider = p_provider and event_key = p_event_key;
  return jsonb_build_object('ok', true, 'result', 'applied', 'status', v_status, 'store_id', pay.store_id);
end $$;
revoke all on function public.saas_payment_apply(text, text, text, text, text, bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.saas_payment_apply(text, text, text, text, text, bigint, text, text, text, jsonb) to service_role;

-- 10. Administrador de RemHub ---------------------------------------------------------
create or replace function public.saas_admin_addons()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp_is_platform_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(to_jsonb(a) || jsonb_build_object('subscribers', (select count(*) from public.saas_subscriptions s where s.fiscal_addon_id = a.id
        and (s.fiscal_addon_until is null or s.fiscal_addon_until > now()))) order by a.sort_order)
    from public.saas_addons a), '[]'::jsonb) end;
$$;
revoke all on function public.saas_admin_addons() from public, anon;
grant execute on function public.saas_admin_addons() to authenticated;

create or replace function public.saas_admin_save_addon(p jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare before public.saas_addons; v_id text := lower(btrim(coalesce(p->>'id', '')));
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if v_id !~ '^[a-z0-9_]{2,30}$' then return jsonb_build_object('ok', false, 'error', 'El código del paquete solo puede tener letras minúsculas, números y _.'); end if;
  if char_length(btrim(coalesce(p->>'name', ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el nombre del paquete.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo del cambio.'); end if;
  select * into before from public.saas_addons where id = v_id;
  insert into public.saas_addons (id, name, tagline, monthly_price, yearly_price, included_docs, overage_price, public, active, highlight, sort_order, updated_by, updated_at)
  values (v_id, btrim(p->>'name'), nullif(btrim(coalesce(p->>'tagline', '')), ''), coalesce((p->>'monthly_price')::int, 0), coalesce((p->>'yearly_price')::int, 0),
          coalesce((p->>'included_docs')::int, 0), coalesce((p->>'overage_price')::int, 0), coalesce((p->>'public')::boolean, true), coalesce((p->>'active')::boolean, true),
          coalesce((p->>'highlight')::boolean, false), coalesce((p->>'sort_order')::int, 0), auth.uid(), now())
  on conflict (id) do update set name = excluded.name, tagline = excluded.tagline, monthly_price = excluded.monthly_price, yearly_price = excluded.yearly_price,
    included_docs = excluded.included_docs, overage_price = excluded.overage_price, public = excluded.public, active = excluded.active,
    highlight = excluded.highlight, sort_order = excluded.sort_order, updated_by = auth.uid(), updated_at = now();
  insert into public.saas_addon_history (addon_id, before, after, reason, by_user)
  values (v_id, to_jsonb(before), (select to_jsonb(a) from public.saas_addons a where a.id = v_id), btrim(p_reason), auth.uid());
  return jsonb_build_object('ok', true);
exception when check_violation then
  return jsonb_build_object('ok', false, 'error', 'Revisa los valores: no pueden ser negativos.');
end $$;
revoke all on function public.saas_admin_save_addon(jsonb, text) from public, anon;
grant execute on function public.saas_admin_save_addon(jsonb, text) to authenticated;

-- Dar, cambiar o quitar el adicional a mano (pago por transferencia, regalo, Fundador…). p_until null = sin vencimiento.
create or replace function public.saas_admin_set_fiscal_addon(p_store uuid, p_addon text, p_until date, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare before jsonb;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo.'); end if;
  if nullif(p_addon, '') is not null and not exists (select 1 from public.saas_addons where id = p_addon) then return jsonb_build_object('ok', false, 'error', 'Ese paquete no existe.'); end if;
  select jsonb_build_object('addon', fiscal_addon_id, 'until', fiscal_addon_until) into before from public.saas_subscriptions where store_id = p_store;
  insert into public.saas_subscriptions (store_id, plan_id, status, fiscal_addon_id, fiscal_addon_until)
  values (p_store, coalesce(public.saas__effective(p_store)->>'plan_id', 'gratis'), 'free', nullif(p_addon, ''), case when p_until is null then null else (p_until + 1)::timestamp at time zone 'America/Bogota' end)
  on conflict (store_id) do update set fiscal_addon_id = nullif(p_addon, ''),
    fiscal_addon_until = case when p_until is null then null else (p_until + 1)::timestamp at time zone 'America/Bogota' end, updated_at = now();
  insert into public.saas_subscription_events (store_id, kind, before, after, reason, by_user)
  values (p_store, 'fiscal_addon_admin', before, jsonb_build_object('addon', nullif(p_addon, ''), 'until', p_until), btrim(p_reason), auth.uid());
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.saas_admin_set_fiscal_addon(uuid, text, date, text) from public, anon;
grant execute on function public.saas_admin_set_fiscal_addon(uuid, text, date, text) to authenticated;

-- Marcar un cobro de extras como pagado (a mano) o perdonarlo.
create or replace function public.saas_admin_overage_set(p_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.saas_fiscal_overages;
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if p_status not in ('paid', 'waived', 'open') then return jsonb_build_object('ok', false, 'error', 'Estado no válido.'); end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe una nota (cómo pagó o por qué se perdona).'); end if;
  update public.saas_fiscal_overages set status = p_status, note = btrim(p_note), paid_at = case when p_status = 'paid' then now() else null end, updated_by = auth.uid()
  where id = p_id returning * into o;
  if not found then return jsonb_build_object('ok', false, 'error', 'Cobro no encontrado.'); end if;
  insert into public.saas_subscription_events (store_id, kind, after, reason, by_user)
  values (o.store_id, 'fiscal_overage_' || p_status, jsonb_build_object('period', o.period, 'amount', o.amount), btrim(p_note), auth.uid());
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.saas_admin_overage_set(uuid, text, text) from public, anon;
grant execute on function public.saas_admin_overage_set(uuid, text, text) to authenticated;

-- Tablero: uso del mes por tienda, paquete y cobros abiertos.
create or replace function public.saas_admin_fiscal_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true,
    'settings', (select jsonb_build_object('fiscal_enforce', fiscal_enforce, 'fiscal_payg_price', fiscal_payg_price) from public.saas_settings where id),
    'stores', coalesce((select jsonb_agg(x order by (x->>'used')::int desc, x->>'name') from (
      select jsonb_build_object('store_id', s.id, 'name', s.name, 'slug', s.slug) || public.saas__fiscal_state(s.id) as x
      from public.stores s
      where exists (select 1 from public.saas_subscriptions ss where ss.store_id = s.id and ss.fiscal_addon_id is not null)
         or (to_regclass('public.fiscal_documents') is not null and exists (select 1 from public.fiscal_entities fe where fe.store_id = s.id))) t), '[]'::jsonb),
    'overages', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('store_name', s.name) order by o.status = 'open' desc, o.period desc)
      from (select * from public.saas_fiscal_overages order by period desc limit 300) o join public.stores s on s.id = o.store_id), '[]'::jsonb));
end $$;
revoke all on function public.saas_admin_fiscal_overview() from public, anon;
grant execute on function public.saas_admin_fiscal_overview() to authenticated;

create or replace function public.saas_admin_fiscal_settings(p_enforce boolean, p_payg integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.erp_is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'Solo el administrador de RemHub.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo.'); end if;
  if coalesce(p_payg, 0) < 0 then return jsonb_build_object('ok', false, 'error', 'El precio no puede ser negativo.'); end if;
  update public.saas_settings set fiscal_enforce = coalesce(p_enforce, fiscal_enforce), fiscal_payg_price = coalesce(p_payg, fiscal_payg_price), updated_by = auth.uid(), updated_at = now() where id;
  insert into public.saas_usage_events (user_id, kind, detail) values (auth.uid(), 'fiscal_settings', jsonb_build_object('enforce', p_enforce, 'payg', p_payg, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.saas_admin_fiscal_settings(boolean, integer, text) from public, anon;
grant execute on function public.saas_admin_fiscal_settings(boolean, integer, text) to authenticated;

-- 11. Historial de pagos de la tienda: dice si fue del plan o de facturación electrónica.
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
                                                       'created_at', p.created_at, 'approved_at', p.approved_at,
                                                       'kind', p.kind, 'addon_id', p.addon_id, 'addon_amount', p.addon_cents / 100,
                                                       'overage_amount', p.overage_cents / 100) order by p.created_at desc)
                   from public.saas_payments p where p.store_id = p_store), '[]'::jsonb)
    else '[]'::jsonb end;
$$;
revoke all on function public.saas_my_payments(uuid) from public, anon;
grant execute on function public.saas_my_payments(uuid) to authenticated;

notify pgrst, 'reload schema';
