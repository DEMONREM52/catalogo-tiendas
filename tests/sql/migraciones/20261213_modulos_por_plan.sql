-- =====================================================================
-- REMHUB · Módulos según el plan (dentro de los permisos de siempre)
--
-- Cada permiso pertenece a un módulo (pos → POS, transfers → Traslados…).
-- Con el interruptor «Bloquear módulos del plan» encendido, erp_can y
-- erp_can_any responden «no» si el plan de la tienda no incluye ese módulo:
-- así lo frena la base de datos (no solo un botón escondido).
--
-- Arranca APAGADO: nada cambia hasta encenderlo en Admin → Suscripciones
-- → Ajustes. El admin de RemHub nunca se frena. Los Fundadores tienen
-- todos los módulos. Los permisos sin módulo (tienda, productos,
-- usuarios, pedidos…) nunca se bloquean.
--
-- Sigue el mismo camino que 20261127 (permisos temporales): erp_can =
-- erp__can_base y no bloqueado y (nuevo) permitido por el plan.
-- Requiere 20261127 y 20261211. Idempotente.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.erp__can_base(uuid, text)') is null or to_regprocedure('public.erp__perm_blocked(uuid, text)') is null then
    raise exception 'Primero ejecuta 20261127_permisos_temporales_horario.sql.';
  end if;
  if to_regclass('public.saas_settings') is null then raise exception 'Primero ejecuta 20261211_saas_planes_suscripciones.sql.'; end if;
end $$;

alter table public.saas_settings add column if not exists enforce_modules boolean not null default false;

-- Módulo de cada permiso (null = siempre permitido).
create or replace function public.saas__perm_module(p_perm text)
returns text
language sql
immutable
as $$
  select case
    when p_perm in ('pos', 'sales_void', 'sales_return', 'price_approve') then 'pos'
    when p_perm in ('cash', 'cash_manage') then 'cash'
    when p_perm in ('clients', 'clients_delete', 'credit', 'receivables') then 'customers'
    when p_perm in ('inventory', 'inventory_adjust', 'inventory_alerts', 'purchases', 'purchases_void', 'suppliers', 'payables') then 'inventory'
    when p_perm = 'transfers' then 'transfers'
    when p_perm in ('stock_requests', 'stock_requests_manage') then 'stock_requests'
    when p_perm = 'points' then 'points'
    when p_perm in ('internal_credit', 'internal_credit_manage') then 'internal_credit'
    when p_perm in ('profit_view', 'profit_rules', 'profit_approve') then 'profit'
    when p_perm in ('profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay') then 'settlements'
    when p_perm in ('expenses', 'expenses_pay', 'budgets') then 'expenses'
    when p_perm in ('payroll', 'payroll_approve', 'payroll_pay') then 'payroll'
    when p_perm = 'audit' then 'audit'
    when p_perm = 'reports' then 'reports'
    when p_perm = 'exports' then 'exports'
    when p_perm like 'fiscal%' then 'fiscal'
    else null
  end;
$$;

-- ¿El plan de la tienda permite este permiso? (apagado → siempre sí)
create or replace function public.saas__perm_allowed(p_store uuid, p_perm text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_mod text;
begin
  if not coalesce((select enforce_modules from public.saas_settings where id), false) then return true; end if;
  v_mod := public.saas__perm_module(p_perm);
  if v_mod is null or p_store is null then return true; end if;
  if public.erp_is_platform_admin() then return true; end if;
  return public.saas_has_module(p_store, v_mod);
end $$;
revoke all on function public.saas__perm_allowed(uuid, text) from public, anon;
grant execute on function public.saas__perm_allowed(uuid, text) to authenticated;

-- erp_can / erp_can_any con el plan (conservan los nombres de sus argumentos).
do $$
declare v_names text[];
begin
  if position('saas__perm_allowed' in pg_get_functiondef('public.erp_can(uuid, text)'::regprocedure)) = 0 then
    select proargnames into v_names from pg_proc where oid = 'public.erp_can(uuid, text)'::regprocedure;
    execute format($f$
      create or replace function public.erp_can(%1$I uuid, %2$I text)
      returns boolean language sql stable security definer set search_path = public as $b$
        select public.erp__can_base(%1$I, %2$I) and not public.erp__perm_blocked(%1$I, %2$I) and public.saas__perm_allowed(%1$I, %2$I)
      $b$ $f$, v_names[1], v_names[2]);
  end if;
  if to_regprocedure('public.erp_can_any(uuid, text[])') is not null
     and position('saas__perm_allowed' in pg_get_functiondef('public.erp_can_any(uuid, text[])'::regprocedure)) = 0 then
    select proargnames into v_names from pg_proc where oid = 'public.erp_can_any(uuid, text[])'::regprocedure;
    execute format($f$
      create or replace function public.erp_can_any(%1$I uuid, %2$I text[])
      returns boolean language sql stable security definer set search_path = public as $b$
        select public.erp__can_any_base(%1$I, %2$I)
           and exists (select 1 from unnest(%2$I) x where public.erp__can_base(%1$I, x) and not public.erp__perm_blocked(%1$I, x)
                                                        and public.saas__perm_allowed(%1$I, x))
      $b$ $f$, v_names[1], v_names[2]);
  end if;
end $$;

-- Para la pantalla: qué permisos frena hoy el plan (vacío si el bloqueo está apagado).
create or replace function public.saas_plan_blocked_permissions(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or not coalesce((select enforce_modules from public.saas_settings where id), false) or public.erp_is_platform_admin()
      or not (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
              or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active))
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object('permission', x, 'module', public.saas__perm_module(x)))
                   from unnest(public.erp__known_permissions() || array['cash', 'cash_manage']::text[]) x
                   where public.saas__perm_module(x) is not null and not public.saas_has_module(p_store, public.saas__perm_module(x))), '[]'::jsonb)
  end;
$$;
revoke all on function public.saas_plan_blocked_permissions(uuid) from public, anon;
grant execute on function public.saas_plan_blocked_permissions(uuid) to authenticated;

-- Ajustes del admin: también el interruptor de módulos.
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
    enforce_modules = coalesce((p_cfg->>'enforce_modules')::boolean, enforce_modules),
    default_trial_plan = coalesce(p_cfg->>'default_trial_plan', default_trial_plan),
    default_trial_days = coalesce((p_cfg->>'default_trial_days')::int, default_trial_days),
    grace_days = coalesce((p_cfg->>'grace_days')::int, grace_days),
    updated_by = auth.uid(), updated_at = now()
  where id returning * into after_row;
  insert into public.saas_plan_history (plan_id, before, after, reason, by_user) values ('_settings', to_jsonb(before_row), to_jsonb(after_row), p_reason, auth.uid());
  return jsonb_build_object('ok', true, 'settings', to_jsonb(after_row));
end $$;

-- Avisos diarios al dueño (los manda /api/push/payables, una vez al día): prueba por terminar, plan por vencer o en gracia.
create or replace function public.saas_push_digest()
returns table (store_id uuid, user_id uuid, kind text, days integer, plan_name text)
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select s.id, s.owner_id, public.saas__effective(s.id) as x from public.stores s where coalesce(s.active, true)
  )
  select e.id, e.owner_id,
         case when e.x->>'status' = 'trialing' then 'trial_ending'
              when e.x->>'status' = 'past_due' then 'grace'
              else 'plan_due' end,
         greatest(0, ceil(extract(epoch from (coalesce((e.x->>'trial_ends_at')::timestamptz, (e.x->>'period_end')::timestamptz) - now())) / 86400))::int,
         (select p.name from public.saas_plans p where p.id = e.x->>'plan_id')
  from e
  where e.x->>'subscription_plan' is distinct from 'fundador'
    and ((e.x->>'status' = 'trialing' and (e.x->>'trial_ends_at')::timestamptz < now() + interval '2 days')
      or (e.x->>'status' = 'past_due')
      or (e.x->>'status' in ('active', 'canceled') and (e.x->>'period_end')::timestamptz < now() + interval '3 days'));
$$;
revoke all on function public.saas_push_digest() from public, anon, authenticated;
grant execute on function public.saas_push_digest() to service_role;

notify pgrst, 'reload schema';
