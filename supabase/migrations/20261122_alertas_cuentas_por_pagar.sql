-- =====================================================================
-- REMHUB · Alertas de cuentas por pagar
--
--   1. Reglas de la tienda: cuántos días antes avisar (ej. 7, 3, 1 y el
--      mismo día), cada cuántos días insistir cuando ya está vencida, desde
--      qué hora, monto mínimo, sonido y notificación al celular.
--   2. Recordatorio propio de cada cuenta: otros días de aviso, otra
--      frecuencia, fechas exactas («recuérdame el 20»), posponer hasta una
--      fecha, silenciar y una nota (ej. «pagar con la transferencia del lunes»).
--   3. Cada persona puede marcar «ya lo vi hoy» o «recuérdame en 1 hora»
--      sin callarle el aviso a los demás.
--   4. Resumen diario al celular (lo envía /api/push/payables).
--
-- Quién: los avisos los reciben quienes tienen «Cuentas por pagar», cada uno
-- solo con las cuentas de sus puntos. Las reglas de la tienda las cambia la
-- madre (con ese permiso). Todo queda en la auditoría.
--
-- Tablas nuevas, sin acceso directo (solo por funciones). No borra datos.
-- Es idempotente. Requiere 20261118 (alcance de punto en compras).
-- =====================================================================

-- 0. Alcance de punto de una cuenta (igual que 20261120; se repite para no depender de ella).
create or replace function public.erp__payable_in_my_points(p_store uuid, p_purchase uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_my_points(p_store) is null
      or exists (select 1 from public.erp_purchases pu where pu.id = p_purchase and pu.warehouse_id = any (public.erp_my_points(p_store)));
$$;
revoke all on function public.erp__payable_in_my_points(uuid, uuid) from public, anon;
grant execute on function public.erp__payable_in_my_points(uuid, uuid) to authenticated;

-- 1. Tablas
create table if not exists public.erp_payable_alert_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  enabled boolean not null default true,
  days_before integer[] not null default '{7,3,1,0}',
  overdue_every_days integer not null default 1 check (overdue_every_days between 1 and 30),
  from_hour integer not null default 7 check (from_hour between 0 and 23),
  min_amount numeric not null default 0 check (min_amount >= 0),
  sound boolean not null default true,
  push boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_payable_reminders (
  payable_id uuid primary key references public.erp_payables(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  muted boolean not null default false,
  days_before integer[],          -- null = como la tienda
  overdue_every_days integer check (overdue_every_days between 1 and 30),
  remind_on date[] not null default '{}',
  snooze_until date,
  note text,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
create index if not exists erp_payable_reminders_store on public.erp_payable_reminders (store_id);

create table if not exists public.erp_payable_alert_acks (
  user_id uuid not null,
  payable_id uuid not null references public.erp_payables(id) on delete cascade,
  day date not null,
  snooze_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, payable_id, day)
);

alter table public.erp_payable_alert_settings enable row level security;
alter table public.erp_payable_reminders enable row level security;
alter table public.erp_payable_alert_acks enable row level security;
revoke all on public.erp_payable_alert_settings, public.erp_payable_reminders, public.erp_payable_alert_acks from anon, authenticated;

-- 2. Reglas
create or replace function public.erp__bogota_today()
returns date language sql stable as $$ select (now() at time zone 'America/Bogota')::date $$;

create or replace function public.erp__payable_settings(p_store uuid)
returns public.erp_payable_alert_settings
language plpgsql stable security definer set search_path = public as $$
declare s public.erp_payable_alert_settings;
begin
  select * into s from public.erp_payable_alert_settings where store_id = p_store;
  if not found then
    s.store_id := p_store; s.enabled := true; s.days_before := '{7,3,1,0}'; s.overdue_every_days := 1;
    s.from_hour := 7; s.min_amount := 0; s.sound := true; s.push := true;
  end if;
  return s;
end $$;
revoke all on function public.erp__payable_settings(uuid) from public, anon, authenticated;

-- ¿Por qué hay que avisar hoy de esta cuenta? null = hoy no.
create or replace function public.erp__payable_alert_reason(
  s public.erp_payable_alert_settings, r public.erp_payable_reminders,
  p_due date, p_balance numeric, p_today date)
returns text language plpgsql immutable as $$
declare
  v_left integer;
  v_every integer := coalesce(r.overdue_every_days, s.overdue_every_days, 1);
  v_days integer[] := coalesce(r.days_before, s.days_before, '{}');
begin
  if not coalesce(s.enabled, true) or coalesce(r.muted, false) then return null; end if;
  if r.snooze_until is not null and p_today < r.snooze_until then return null; end if;
  if p_today = any (coalesce(r.remind_on, '{}')) then return 'date'; end if;
  if p_due is null then return null; end if;
  -- El monto mínimo aplica a las reglas de la tienda, no a un recordatorio puesto a mano.
  if r.payable_id is null and coalesce(p_balance, 0) < coalesce(s.min_amount, 0) then return null; end if;
  v_left := p_due - p_today;
  if v_left >= 0 then
    return case when v_left = any (v_days) then (case when v_left = 0 then 'today' else 'before' end) end;
  end if;
  return case when ((-v_left) - 1) % greatest(v_every, 1) = 0 then 'overdue' end;
end $$;

-- 3. Tablero: cuentas con su estado de aviso (alcance de punto incluido).
create or replace function public.erp_payables_board(p_store uuid, p_only_alerts boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.erp_payable_alert_settings;
  v_today date := public.erp__bogota_today();
  v_hour integer := extract(hour from now() at time zone 'America/Bogota')::integer;
  v_rows jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'payables') then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Cuentas por pagar».');
  end if;
  s := public.erp__payable_settings(p_store);

  with base as (
    select a.*, rm as rem,
           public.erp__payable_alert_reason(s, rm, a.due_date, a.balance, v_today) as reason
    from public.erp_payables a
    left join public.erp_payable_reminders rm on rm.payable_id = a.id
    where a.store_id = p_store
      and public.erp__payable_in_my_points(p_store, a.purchase_id)
      and (a.status = 'open' or (not p_only_alerts and a.updated_at > now() - interval '120 days'))
  ), ack as (
    select k.payable_id, bool_or(k.snooze_until is null) as seen_today, max(k.snooze_until) as snooze_until
    from public.erp_payable_alert_acks k
    where k.user_id = auth.uid() and k.day = v_today
    group by k.payable_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'supplier_id', b.supplier_id, 'supplier_name', sp.name, 'supplier_phone', sp.phone,
      'purchase_id', b.purchase_id, 'purchase_number', pu.number, 'invoice_ref', pu.invoice_ref,
      'warehouse_name', w.name, 'total', b.total, 'balance', b.balance, 'due_date', b.due_date,
      'status', b.status, 'created_at', b.created_at,
      'days_left', case when b.due_date is not null then b.due_date - v_today end,
      'reason', case when b.status = 'open' then b.reason end,
      'seen_today', coalesce(k.seen_today, false),
      'snoozed_until', case when k.snooze_until > now() then k.snooze_until end,
      'reminder', case when (b.rem).payable_id is not null then jsonb_build_object(
          'muted', (b.rem).muted, 'days_before', (b.rem).days_before, 'overdue_every_days', (b.rem).overdue_every_days,
          'remind_on', (b.rem).remind_on, 'snooze_until', (b.rem).snooze_until, 'note', (b.rem).note,
          'updated_by_name', (b.rem).updated_by_name, 'updated_at', (b.rem).updated_at) end,
      'payments', (select coalesce(jsonb_agg(jsonb_build_object('amount', pp.amount, 'method', pp.method, 'reference', pp.reference, 'created_at', pp.created_at)
                    order by pp.created_at desc), '[]'::jsonb) from public.erp_payable_payments pp where pp.payable_id = b.id))
    order by (b.status <> 'open'), b.due_date nulls last, b.created_at), '[]'::jsonb)
  into v_rows
  from base b
  left join ack k on k.payable_id = b.id
  left join public.erp_suppliers sp on sp.id = b.supplier_id
  left join public.erp_purchases pu on pu.id = b.purchase_id
  left join public.erp_warehouses w on w.id = pu.warehouse_id
  where not p_only_alerts or (
    b.status = 'open' and b.reason is not null and v_hour >= s.from_hour
    and not coalesce(k.seen_today, false) and (k.snooze_until is null or k.snooze_until <= now()));

  return jsonb_build_object(
    'ok', true, 'today', v_today,
    'can_config', public.erp_my_points(p_store) is null,
    'settings', jsonb_build_object('enabled', s.enabled, 'days_before', s.days_before, 'overdue_every_days', s.overdue_every_days,
       'from_hour', s.from_hour, 'min_amount', s.min_amount, 'sound', s.sound, 'push', s.push),
    'rows', v_rows);
end $$;
revoke all on function public.erp_payables_board(uuid, boolean) from public, anon;
grant execute on function public.erp_payables_board(uuid, boolean) to authenticated;

-- Valida que la cuenta exista, sea de la tienda, el usuario tenga permiso y sea de su punto.
create or replace function public.erp__payable_for_me(p_payable uuid)
returns public.erp_payables language plpgsql stable security definer set search_path = public as $$
declare a public.erp_payables;
begin
  select * into a from public.erp_payables where id = p_payable;
  if not found then raise exception 'Cuenta por pagar no encontrada.'; end if;
  if auth.uid() is null or not public.erp_can(a.store_id, 'payables') then
    raise exception 'Necesitas el permiso «Cuentas por pagar».';
  end if;
  if not public.erp__payable_in_my_points(a.store_id, a.purchase_id) then
    raise exception 'Esa cuenta es de otro punto.';
  end if;
  return a;
end $$;
revoke all on function public.erp__payable_for_me(uuid) from public, anon, authenticated;

-- 4. «Ya lo vi hoy» (p_minutes null) o «recuérdame en X minutos». Solo para quien lo marca.
create or replace function public.erp_payable_alert_ack(p_payable uuid, p_minutes integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.erp_payables; v_today date := public.erp__bogota_today();
begin
  a := public.erp__payable_for_me(p_payable);
  if p_minutes is not null and (p_minutes < 5 or p_minutes > 1440) then raise exception 'Tiempo inválido.'; end if;
  insert into public.erp_payable_alert_acks (user_id, payable_id, day, snooze_until)
  values (auth.uid(), a.id, v_today, case when p_minutes is not null then now() + make_interval(mins => p_minutes) end)
  on conflict (user_id, payable_id, day) do update set snooze_until = excluded.snooze_until, created_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_payable_alert_ack(uuid, integer) from public, anon;
grant execute on function public.erp_payable_alert_ack(uuid, integer) to authenticated;

-- Limpia una lista de días (0..90, sin repetir, máx. 10).
create or replace function public.erp__clean_days(p jsonb)
returns integer[] language sql immutable as $$
  select case when p is null or jsonb_typeof(p) <> 'array' then null else
    (select coalesce(array_agg(d order by d desc), '{}') from (
       select distinct (x #>> '{}')::integer as d from jsonb_array_elements(p) x
       where (x #>> '{}') ~ '^[0-9]{1,2}$' and (x #>> '{}')::integer <= 90 limit 10) t) end;
$$;

-- 5. Recordatorio propio de una cuenta. p_cfg null = volver a las reglas de la tienda.
create or replace function public.erp_payable_reminder_save(p_payable uuid, p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.erp_payables;
  v_every integer;
  v_on date[];
  v_snooze date;
  v_note text;
begin
  a := public.erp__payable_for_me(p_payable);
  if p_cfg is null then
    delete from public.erp_payable_reminders where payable_id = a.id;
    perform public.erp_audit(a.store_id, 'payable.reminder_reset', 'erp_payables', a.id, '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;

  v_every := nullif(p_cfg->>'overdue_every_days', '')::integer;
  if v_every is not null and (v_every < 1 or v_every > 30) then raise exception 'La frecuencia debe estar entre 1 y 30 días.'; end if;
  select coalesce(array_agg(distinct (x #>> '{}')::date order by (x #>> '{}')::date), '{}')
  into v_on
  from jsonb_array_elements(coalesce(p_cfg->'remind_on', '[]'::jsonb)) x
  where (x #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$';
  if cardinality(v_on) > 20 then raise exception 'Máximo 20 fechas de recordatorio.'; end if;
  v_snooze := nullif(p_cfg->>'snooze_until', '')::date;
  v_note := left(nullif(btrim(coalesce(p_cfg->>'note', '')), ''), 300);

  insert into public.erp_payable_reminders as r (payable_id, store_id, muted, days_before, overdue_every_days, remind_on, snooze_until, note, updated_by, updated_by_name, updated_at)
  values (a.id, a.store_id, coalesce((p_cfg->>'muted')::boolean, false), public.erp__clean_days(p_cfg->'days_before'),
          v_every, v_on, v_snooze, v_note, auth.uid(), public.erp_actor_name(a.store_id), now())
  on conflict (payable_id) do update set
    muted = excluded.muted, days_before = excluded.days_before, overdue_every_days = excluded.overdue_every_days,
    remind_on = excluded.remind_on, snooze_until = excluded.snooze_until, note = excluded.note,
    updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();

  perform public.erp_audit(a.store_id, 'payable.reminder_saved', 'erp_payables', a.id, p_cfg);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_payable_reminder_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_payable_reminder_save(uuid, jsonb) to authenticated;

-- 6. Reglas de la tienda (solo la madre con «Cuentas por pagar»).
create or replace function public.erp_payable_alert_settings_save(p_store uuid, p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_days integer[] := public.erp__clean_days(p_cfg->'days_before');
  v_every integer := coalesce(nullif(p_cfg->>'overdue_every_days', '')::integer, 1);
  v_hour integer := coalesce(nullif(p_cfg->>'from_hour', '')::integer, 7);
  v_min numeric := coalesce(nullif(p_cfg->>'min_amount', '')::numeric, 0);
begin
  if auth.uid() is null or not public.erp_can(p_store, 'payables') then raise exception 'Necesitas el permiso «Cuentas por pagar».'; end if;
  if public.erp_my_points(p_store) is not null then raise exception 'Las reglas de avisos las cambia la tienda madre.'; end if;
  if v_every < 1 or v_every > 30 then raise exception 'La frecuencia debe estar entre 1 y 30 días.'; end if;
  if v_hour < 0 or v_hour > 23 then raise exception 'Hora inválida.'; end if;
  if v_min < 0 then raise exception 'Monto mínimo inválido.'; end if;

  insert into public.erp_payable_alert_settings as s (store_id, enabled, days_before, overdue_every_days, from_hour, min_amount, sound, push, updated_by, updated_at)
  values (p_store, coalesce((p_cfg->>'enabled')::boolean, true), coalesce(v_days, '{7,3,1,0}'), v_every, v_hour, v_min,
          coalesce((p_cfg->>'sound')::boolean, true), coalesce((p_cfg->>'push')::boolean, true), auth.uid(), now())
  on conflict (store_id) do update set
    enabled = excluded.enabled, days_before = excluded.days_before, overdue_every_days = excluded.overdue_every_days,
    from_hour = excluded.from_hour, min_amount = excluded.min_amount, sound = excluded.sound, push = excluded.push,
    updated_by = excluded.updated_by, updated_at = now();

  perform public.erp_audit(p_store, 'payable.alert_settings', 'erp_payable_alert_settings', null, p_cfg);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_payable_alert_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_payable_alert_settings_save(uuid, jsonb) to authenticated;

-- 7. Resumen del día para el celular (solo el servidor, con la llave de servicio).
create or replace function public.erp_payable_push_digest()
returns table (store_id uuid, user_id uuid, n integer, overdue integer, due_today integer, amount numeric, first_name text)
language sql stable security definer set search_path = public as $$
  with today as (select public.erp__bogota_today() as d),
  due as (
    select a.store_id, a.id, a.balance, a.due_date, pu.warehouse_id, sp.name as supplier,
           public.erp__payable_alert_reason(public.erp__payable_settings(a.store_id), rm, a.due_date, a.balance, (select d from today)) as reason
    from public.erp_payables a
    left join public.erp_payable_reminders rm on rm.payable_id = a.id
    left join public.erp_purchases pu on pu.id = a.purchase_id
    left join public.erp_suppliers sp on sp.id = a.supplier_id
    join public.stores st on st.id = a.store_id and st.active
    where a.status = 'open' and a.balance > 0
      and coalesce((select s.push from public.erp_payable_alert_settings s where s.store_id = a.store_id), true)
  ),
  people as (
    select st.id as store_id, st.owner_id as user_id, null::uuid[] as points from public.stores st
    union
    select su.store_id, su.user_id,
           case when su.point_id is null then null
                else array_prepend(su.point_id, coalesce(su.point_ids, '{}'::uuid[])) end
    from public.store_users su
    where su.active and (su.role = 'store_admin' or 'payables' = any (su.permissions))
  )
  select d.store_id, p.user_id, count(*)::integer,
         count(*) filter (where d.reason = 'overdue')::integer,
         count(*) filter (where d.reason = 'today')::integer,
         sum(d.balance),
         (array_agg(d.supplier order by d.due_date nulls last))[1]
  from due d
  join people p on p.store_id = d.store_id and (p.points is null or d.warehouse_id = any (p.points))
  where d.reason is not null
  group by d.store_id, p.user_id;
$$;
revoke all on function public.erp_payable_push_digest() from public, anon, authenticated;
grant execute on function public.erp_payable_push_digest() to service_role;

notify pgrst, 'reload schema';
