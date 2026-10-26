-- =====================================================================
-- REMHUB · Avisos por WhatsApp y simulacro mensual sin internet
--
-- 1. WhatsApp al dueño (y hasta 3 números que él elija) cuando una factura de
--    contingencia está por vencer el plazo de 48 horas de la DIAN:
--      · erp_whatsapp_settings / _keys / _log (las claves nunca llegan al navegador)
--      · erp_whatsapp_settings_get / _save
--      · erp_contingency_watch(): qué tiendas avisar (24 h, 6 h, vencido) — solo el servidor
-- 2. Simulacro mensual «vender sin internet» para quienes usan el POS:
--      · erp_drill_settings / erp_drills
--      · erp_drill_status / _start / _complete / erp_drill_settings_save
--      · erp_drill_digest(): recordatorios al celular — solo el servidor
-- 3. erp_offline_alerts (20261243) + avisos del simulacro en la campana.
-- Requiere 20261243. Idempotente.
-- =====================================================================

-- 1. WhatsApp ---------------------------------------------------------------
create table if not exists public.erp_whatsapp_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'remhub' check (provider in ('remhub', 'callmebot')),
  numbers text[] not null default '{}',
  events text[] not null default '{contingency}',
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  constraint erp_whatsapp_numbers_max check (cardinality(numbers) <= 3)
);
-- Clave de CallMeBot de cada número (opción gratis): solo la lee el servidor.
create table if not exists public.erp_whatsapp_keys (
  store_id uuid not null references public.stores(id) on delete cascade,
  number text not null,
  apikey text not null,
  created_at timestamptz not null default now(),
  primary key (store_id, number)
);
-- Cada aviso enviado una sola vez (la llave evita repetirlo) y su resultado.
create table if not exists public.erp_whatsapp_log (
  id bigserial primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  key text not null unique,
  number text,
  event text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists erp_whatsapp_log_store on public.erp_whatsapp_log (store_id, created_at desc);
alter table public.erp_whatsapp_settings enable row level security;
alter table public.erp_whatsapp_keys enable row level security;
alter table public.erp_whatsapp_log enable row level security;
revoke all on public.erp_whatsapp_settings, public.erp_whatsapp_keys, public.erp_whatsapp_log from anon, authenticated;

-- Número de WhatsApp en formato internacional sin «+» (Colombia: 3001234567 → 573001234567).
create or replace function public.erp__wa_number(p text)
returns text
language sql
immutable
as $$
  select case
    when length(d) = 10 and left(d, 1) = '3' then '57' || d
    when length(d) between 11 and 15 then d
    else null end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- Quién configura los avisos: el dueño, el administrador o quien maneja la facturación electrónica.
create or replace function public.erp__whatsapp_manager(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.erp_can_any(p_store, array['store', 'fiscal_config', 'fiscal_send']::text[]);
$$;
revoke all on function public.erp__whatsapp_manager(uuid) from public, anon;
grant execute on function public.erp__whatsapp_manager(uuid) to authenticated;

create or replace function public.erp_whatsapp_settings_get(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.erp_whatsapp_settings;
begin
  if not public.erp__whatsapp_manager(p_store) then return jsonb_build_object('ok', false, 'message', 'No tienes permiso para los avisos de la tienda.'); end if;
  select * into s from public.erp_whatsapp_settings where store_id = p_store;
  return jsonb_build_object('ok', true, 'enabled', coalesce(s.enabled, false), 'provider', coalesce(s.provider, 'remhub'),
    'events', to_jsonb(coalesce(s.events, '{contingency}'::text[])), 'updated_at', s.updated_at, 'updated_by', s.updated_by_name,
    'numbers', coalesce((select jsonb_agg(jsonb_build_object('number', n,
        'has_key', exists (select 1 from public.erp_whatsapp_keys k where k.store_id = p_store and k.number = n)) order by ord)
      from unnest(coalesce(s.numbers, '{}'::text[])) with ordinality as u(n, ord)), '[]'::jsonb),
    'last', (select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('at', l.created_at, 'number', l.number, 'event', l.event, 'status', l.status, 'error', l.error) as x
      from public.erp_whatsapp_log l where l.store_id = p_store order by l.created_at desc limit 5) t));
end;
$$;
revoke all on function public.erp_whatsapp_settings_get(uuid) from public, anon;
grant execute on function public.erp_whatsapp_settings_get(uuid) to authenticated;

-- p_data: { enabled, provider, numbers: ["3001234567", …], keys: { "573001234567": "123456" } }
create or replace function public.erp_whatsapp_settings_save(p_store uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numbers text[] := '{}';
  v_raw text;
  v_n text;
  v_provider text := coalesce(nullif(p_data ->> 'provider', ''), 'remhub');
  v_key text;
  v_enabled boolean := coalesce((p_data ->> 'enabled')::boolean, false);
begin
  if not public.erp__whatsapp_manager(p_store) then return jsonb_build_object('ok', false, 'message', 'No tienes permiso para los avisos de la tienda.'); end if;
  if v_provider not in ('remhub', 'callmebot') then return jsonb_build_object('ok', false, 'message', 'Proveedor de WhatsApp no válido.'); end if;
  for v_raw in select jsonb_array_elements_text(coalesce(p_data -> 'numbers', '[]'::jsonb)) loop
    v_n := public.erp__wa_number(v_raw);
    if v_n is null then return jsonb_build_object('ok', false, 'message', 'El número «' || left(v_raw, 20) || '» no es un celular válido (ej.: 300 123 4567).'); end if;
    if not v_n = any (v_numbers) then v_numbers := array_append(v_numbers, v_n); end if;
  end loop;
  if cardinality(v_numbers) > 3 then return jsonb_build_object('ok', false, 'message', 'Máximo 3 números.'); end if;
  if v_enabled and cardinality(v_numbers) = 0 then return jsonb_build_object('ok', false, 'message', 'Escribe al menos un número.'); end if;

  insert into public.erp_whatsapp_settings as w (store_id, enabled, provider, numbers, updated_by, updated_by_name, updated_at)
  values (p_store, v_enabled, v_provider, v_numbers, auth.uid(), public.erp_actor_name(p_store), now())
  on conflict (store_id) do update
    set enabled = excluded.enabled, provider = excluded.provider, numbers = excluded.numbers,
        updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();

  -- Claves de CallMeBot: se guardan las nuevas y se borran las de números que ya no están.
  for v_n in select * from unnest(v_numbers) loop
    v_key := btrim(coalesce(p_data -> 'keys' ->> v_n, ''));
    if v_key <> '' then
      if v_key !~ '^[A-Za-z0-9_-]{4,64}$' then return jsonb_build_object('ok', false, 'message', 'La clave de CallMeBot no es válida.'); end if;
      insert into public.erp_whatsapp_keys (store_id, number, apikey) values (p_store, v_n, v_key)
      on conflict (store_id, number) do update set apikey = excluded.apikey, created_at = now();
    end if;
  end loop;
  delete from public.erp_whatsapp_keys k where k.store_id = p_store and not (k.number = any (v_numbers));
  if v_enabled and v_provider = 'callmebot'
     and exists (select 1 from unnest(v_numbers) n where not exists (select 1 from public.erp_whatsapp_keys k where k.store_id = p_store and k.number = n)) then
    return jsonb_build_object('ok', false, 'message', 'Con CallMeBot cada número necesita su clave (la da el bot por WhatsApp).');
  end if;
  perform public.erp_audit(p_store, 'notify.whatsapp_saved', 'erp_whatsapp_settings', null,
    jsonb_build_object('enabled', v_enabled, 'provider', v_provider, 'numbers', cardinality(v_numbers)));
  return public.erp_whatsapp_settings_get(p_store);
end;
$$;
revoke all on function public.erp_whatsapp_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_whatsapp_settings_save(uuid, jsonb) to authenticated;

-- Tiendas con facturas de contingencia cerca del plazo (o vencidas): las sin aceptar y las entregadas en
-- papel que aún no se registran. «first_id» identifica la más antigua (cada etapa se avisa una sola vez por ella).
create or replace function public.erp_contingency_watch()
returns table (store_id uuid, store_name text, slug text, stage text, docs integer, issues integer, hours_left numeric,
  deadline timestamptz, first_id text, recipients uuid[])
language sql
stable
security definer
set search_path = public
as $$
  with docs as (
    select d.store_id, count(*)::integer as n, min(d.created_at) as first_at, (array_agg(d.id::text order by d.created_at))[1] as first_id
    from public.fiscal_documents d
    where d.document_type = 'contingency_invoice' and d.status not in ('ACCEPTED', 'VOID', 'CANCELLED', 'CANCEL_PENDING')
    group by d.store_id
  ), iss as (
    select i.store_id, count(*)::integer as n, min(i.first_at) as first_at, (array_agg(i.client_id::text order by i.first_at))[1] as first_id
    from public.erp_pos_offline_issues i
    where i.resolved_at is null and i.kind = 'contingencia'
    group by i.store_id
  ), merged as (
    select coalesce(d.store_id, i.store_id) as store_id, coalesce(d.n, 0) as docs, coalesce(i.n, 0) as issues,
      least(d.first_at, i.first_at) as first_at,
      case when i.first_at is null or (d.first_at is not null and d.first_at <= i.first_at) then d.first_id else i.first_id end as first_id
    from docs d full join iss i on i.store_id = d.store_id
  )
  select m.store_id, s.name, s.slug,
    case when m.first_at + interval '48 hours' <= now() then 'overdue'
         when m.first_at + interval '48 hours' <= now() + interval '6 hours' then 'h6'
         else 'h24' end,
    m.docs, m.issues,
    round((extract(epoch from (m.first_at + interval '48 hours' - now())) / 3600)::numeric, 1),
    m.first_at + interval '48 hours', m.first_id,
    array(select distinct u from (
      select s.owner_id as u
      union all
      select su.user_id from public.store_users su
      where su.store_id = m.store_id and su.active
        and (su.role = 'store_admin' or su.permissions && array['fiscal_send', 'fiscal_config']::text[])) x where u is not null)
  from merged m
  join public.stores s on s.id = m.store_id
  where m.first_at + interval '48 hours' <= now() + interval '24 hours';
$$;
revoke all on function public.erp_contingency_watch() from public, anon, authenticated;
grant execute on function public.erp_contingency_watch() to service_role;

-- 2. Simulacro mensual -------------------------------------------------------
create table if not exists public.erp_drill_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  enabled boolean not null default true,
  due_day integer not null default 10 check (due_day between 1 and 28),
  include_fiscal boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.erp_drills (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  user_name text,
  point_id uuid,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  steps jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  seconds integer,
  unique (store_id, user_id, period)
);
create index if not exists erp_drills_period on public.erp_drills (store_id, period);
alter table public.erp_drill_settings enable row level security;
alter table public.erp_drills enable row level security;
revoke all on public.erp_drill_settings, public.erp_drills from anon, authenticated;

create or replace function public.erp__drill_period()
returns text
language sql
stable
as $$
  select to_char(now() at time zone 'America/Bogota', 'YYYY-MM');
$$;

-- Quiénes deben hacer el simulacro: usuarios activos con POS (el dueño y los administradores pueden, no deben).
create or replace function public.erp__drill_required(p_store uuid)
returns table (user_id uuid, name text, point_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select su.user_id, coalesce(nullif(su.display_name, ''), su.username, 'Usuario'), su.point_id
  from public.store_users su
  where su.store_id = p_store and su.active and su.role <> 'store_admin' and 'pos' = any (su.permissions)
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = su.user_id);
$$;
revoke all on function public.erp__drill_required(uuid) from public, anon, authenticated;

create or replace function public.erp_drill_status(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st public.erp_drill_settings;
  d public.erp_drills;
  v_period text := public.erp__drill_period();
  v_manager boolean := public.erp_can(p_store, 'users');
  v_must boolean;
  v_due date;
begin
  if not (public.erp_can(p_store, 'pos') or v_manager) then return jsonb_build_object('ok', false, 'message', 'Sin acceso.'); end if;
  select * into st from public.erp_drill_settings where store_id = p_store;
  v_due := (v_period || '-' || lpad(coalesce(st.due_day, 10)::text, 2, '0'))::date;
  select * into d from public.erp_drills where store_id = p_store and user_id = auth.uid() and period = v_period;
  v_must := exists (select 1 from public.erp__drill_required(p_store) r where r.user_id = auth.uid());
  return jsonb_build_object('ok', true, 'enabled', coalesce(st.enabled, true), 'period', v_period, 'due_date', v_due,
    'overdue', public.fiscal__today() > v_due, 'include_fiscal', coalesce(st.include_fiscal, true), 'due_day', coalesce(st.due_day, 10),
    'must', v_must, 'manager', v_manager,
    'mine', case when d.id is null then null else jsonb_build_object('started_at', d.started_at, 'completed_at', d.completed_at, 'steps', d.steps, 'seconds', d.seconds) end,
    'team', case when v_manager then (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', r.name, 'point_name', w.name,
          'completed_at', x.completed_at, 'started_at', x.started_at,
          'last_completed', (select max(y.completed_at) from public.erp_drills y where y.store_id = p_store and y.user_id = r.user_id))
        order by (x.completed_at is not null), r.name), '[]'::jsonb)
      from public.erp__drill_required(p_store) r
      left join public.erp_warehouses w on w.id = r.point_id
      left join public.erp_drills x on x.store_id = p_store and x.user_id = r.user_id and x.period = v_period) end);
end;
$$;
revoke all on function public.erp_drill_status(uuid) from public, anon;
grant execute on function public.erp_drill_status(uuid) to authenticated;

create or replace function public.erp_drill_start(p_store uuid, p_point uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := public.erp__drill_period();
  v_id uuid;
begin
  if not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de POS.'); end if;
  insert into public.erp_drills as x (store_id, user_id, user_name, point_id, period)
  values (p_store, auth.uid(), public.erp_actor_name(p_store), p_point, v_period)
  on conflict (store_id, user_id, period) do update
    set started_at = case when x.completed_at is null then now() else x.started_at end, point_id = coalesce(excluded.point_id, x.point_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'period', v_period);
end;
$$;
revoke all on function public.erp_drill_start(uuid, uuid) from public, anon;
grant execute on function public.erp_drill_start(uuid, uuid) to authenticated;

-- p_steps: { sale: true, contingency: true|null, print: true|"skip", ended: true }
create or replace function public.erp_drill_complete(p_store uuid, p_steps jsonb, p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.erp_drills;
  v_period text := public.erp__drill_period();
begin
  if not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de POS.'); end if;
  if jsonb_typeof(p_steps) <> 'object' or coalesce((p_steps ->> 'sale')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'message', 'Falta hacer la venta de práctica.');
  end if;
  select * into d from public.erp_drills where store_id = p_store and user_id = auth.uid() and period = v_period for update;
  if d.id is null then return jsonb_build_object('ok', false, 'message', 'Primero empieza el simulacro.'); end if;
  if d.completed_at is not null then return jsonb_build_object('ok', true, 'already', true, 'completed_at', d.completed_at); end if;
  update public.erp_drills
  set completed_at = now(), steps = p_steps, seconds = least(greatest(coalesce(p_seconds, 0), 0), 86400)
  where id = d.id;
  perform public.erp_audit(p_store, 'pos.drill_completed', 'erp_drills', d.id, jsonb_build_object('period', v_period, 'steps', p_steps, 'seconds', p_seconds));
  return jsonb_build_object('ok', true, 'completed_at', now());
end;
$$;
revoke all on function public.erp_drill_complete(uuid, jsonb, integer) from public, anon;
grant execute on function public.erp_drill_complete(uuid, jsonb, integer) to authenticated;

create or replace function public.erp_drill_settings_save(p_store uuid, p_enabled boolean, p_due_day integer, p_include_fiscal boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp_can(p_store, 'users') then return jsonb_build_object('ok', false, 'message', 'Solo quien administra los usuarios.'); end if;
  if p_due_day is null or p_due_day not between 1 and 28 then return jsonb_build_object('ok', false, 'message', 'El día límite va del 1 al 28.'); end if;
  insert into public.erp_drill_settings as x (store_id, enabled, due_day, include_fiscal, updated_by, updated_at)
  values (p_store, coalesce(p_enabled, true), p_due_day, coalesce(p_include_fiscal, true), auth.uid(), now())
  on conflict (store_id) do update
    set enabled = excluded.enabled, due_day = excluded.due_day, include_fiscal = excluded.include_fiscal, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_drill_settings_save(uuid, boolean, integer, boolean) from public, anon;
grant execute on function public.erp_drill_settings_save(uuid, boolean, integer, boolean) to authenticated;

-- Recordatorios al celular (lo llama el servidor una vez al día, 9 a. m.):
--   start   · día 1: a cada cajero que debe hacerlo
--   due     · día límite: a quien aún no lo hizo
--   manager · día siguiente al límite: al dueño y administradores, si falta alguien
create or replace function public.erp_drill_digest()
returns table (store_id uuid, user_id uuid, kind text, pending integer, total integer, period text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period text := public.erp__drill_period();
  v_day integer := extract(day from (now() at time zone 'America/Bogota'))::integer;
  s record;
  v_pending integer;
  v_total integer;
begin
  for s in
    select st.id as store_id, st.owner_id, coalesce(ds.due_day, 10) as due_day
    from public.stores st
    left join public.erp_drill_settings ds on ds.store_id = st.id
    where coalesce(ds.enabled, true) and coalesce(st.active, true)
  loop
    select count(*)::integer, count(*) filter (where not exists (
        select 1 from public.erp_drills d where d.store_id = s.store_id and d.user_id = r.user_id and d.period = v_period and d.completed_at is not null))::integer
    into v_total, v_pending
    from public.erp__drill_required(s.store_id) r;
    if coalesce(v_total, 0) = 0 or v_pending = 0 then continue; end if;
    if v_day = 1 or v_day = s.due_day then
      return query
        select s.store_id, r.user_id, case when v_day = 1 then 'start' else 'due' end, v_pending, v_total, v_period
        from public.erp__drill_required(s.store_id) r
        where not exists (select 1 from public.erp_drills d where d.store_id = s.store_id and d.user_id = r.user_id and d.period = v_period and d.completed_at is not null);
    elsif v_day = s.due_day + 1 then
      return query
        select s.store_id, u, 'manager'::text, v_pending, v_total, v_period
        from (select s.owner_id as u
              union
              select su.user_id from public.store_users su where su.store_id = s.store_id and su.active and su.role = 'store_admin') m
        where u is not null;
    end if;
  end loop;
end;
$$;
revoke all on function public.erp_drill_digest() from public, anon, authenticated;
grant execute on function public.erp_drill_digest() to service_role;

-- 3. Campana: avisos sin conexión (20261243) + simulacro del mes ------------------
create or replace function public.erp_offline_alerts(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_fiscal boolean;
  v_pos boolean;
  v_n integer;
  v_hours numeric;
  v_issues integer;
  v_issues_c integer;
  r record;
  st public.erp_drill_settings;
  v_period text := public.erp__drill_period();
  v_due date;
  v_total integer;
  v_done integer;
begin
  if not public.erp__is_member(p_store) then return '[]'::jsonb; end if;
  v_fiscal := public.erp_can_any(p_store, public.fiscal__view_perms());
  v_pos := public.erp_can(p_store, 'pos');

  if v_fiscal or v_pos then
    select count(*), min(extract(epoch from (d.created_at + interval '48 hours' - now())) / 3600) into v_n, v_hours
    from public.fiscal_documents d
    where d.store_id = p_store and d.document_type = 'contingency_invoice'
      and d.status not in ('ACCEPTED', 'VOID', 'CANCELLED', 'CANCEL_PENDING')
      and public.erp_point_allowed(p_store, d.point_id);
    if v_n > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-contingency-pending',
        'severity', case when v_hours < 12 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_n,
        'title', v_n || case when v_n = 1 then ' factura de contingencia sin aceptar' else ' facturas de contingencia sin aceptar' end,
        'body', case when v_hours <= 0 then 'Ya pasó el plazo de 48 horas de la DIAN: revísalas ya en el Centro fiscal.'
                     else 'Quedan ' || greatest(floor(v_hours)::integer, 0) || ' horas del plazo de la DIAN. Revísalas en el Centro fiscal.' end,
        'href', '/dashboard/fiscal?tab=contingencias'));
    end if;
  end if;

  if v_pos then
    select count(*), count(*) filter (where i.kind = 'contingencia') into v_issues, v_issues_c
    from public.erp_pos_offline_issues i
    where i.store_id = p_store and i.resolved_at is null and public.erp_point_allowed(p_store, i.point_id);
    if v_issues > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'offline-sale-issues',
        'severity', case when v_issues_c > 0 then 'critical' else 'serious' end, 'icon', 'alert', 'count', v_issues,
        'title', v_issues || case when v_issues = 1 then ' venta sin conexión por revisar' else ' ventas sin conexión por revisar' end,
        'body', case when v_issues_c > 0 then 'Hay facturas de contingencia entregadas en papel que aún no quedan registradas. Ábrelas en el POS.'
                     else 'No se pudieron registrar solas (inventario, precio o permisos). Ábrelas en el POS.' end,
        'href', '/dashboard/pos'));
    end if;
  end if;

  if v_fiscal then
    for r in
      select w.id, w.name
      from public.fiscal_point_configs c
      join public.erp_warehouses w on w.id = c.point_id
      join public.erp_org_settings os on os.store_id = c.store_id and os.fiscal_enabled
      where c.store_id = p_store and c.enabled and public.erp_point_allowed(p_store, c.point_id)
        and public.fiscal__pick_range(c.point_id, c.fiscal_entity_id, 'contingency_invoice', c.environment) is null
      order by w.name
      limit 5
    loop
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'fiscal-no-contingency-' || r.id, 'severity', 'warning', 'icon', 'hash',
        'title', 'Sin numeración de contingencia: ' || r.name,
        'body', 'Si se cae el internet no podrás facturar en papel. Pídela a la DIAN y cárgala en Centro fiscal → Numeración.',
        'href', '/dashboard/fiscal?tab=numeracion'));
    end loop;
  end if;

  -- Simulacro del mes: a quien le falta y, pasado el día límite, al administrador.
  select * into st from public.erp_drill_settings where store_id = p_store;
  if coalesce(st.enabled, true) then
    v_due := (v_period || '-' || lpad(coalesce(st.due_day, 10)::text, 2, '0'))::date;
    if exists (select 1 from public.erp__drill_required(p_store) x where x.user_id = auth.uid())
       and not exists (select 1 from public.erp_drills d where d.store_id = p_store and d.user_id = auth.uid() and d.period = v_period and d.completed_at is not null) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'drill-mine-' || v_period,
        'severity', case when public.fiscal__today() > v_due then 'warning' else 'info' end, 'icon', 'alert',
        'title', '🎓 Simulacro del mes pendiente',
        'body', '2 minutos: practica vender sin internet (no se registra nada). Hazlo antes del ' || to_char(v_due, 'DD/MM') || '.',
        'href', '/dashboard/pos?simulacro=1'));
    end if;
    if public.erp_can(p_store, 'users') and public.fiscal__today() > v_due then
      select count(*)::integer, count(d.id)::integer into v_total, v_done
      from public.erp__drill_required(p_store) x
      left join public.erp_drills d on d.store_id = p_store and d.user_id = x.user_id and d.period = v_period and d.completed_at is not null;
      if v_total > 0 and v_done < v_total then
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'drill-team-' || v_period, 'severity', 'warning', 'icon', 'users',
          'title', 'Simulacro del mes: ' || v_done || ' de ' || v_total || ' lo hicieron',
          'body', 'Faltan ' || (v_total - v_done) || '. Así sabrán qué hacer si se cae el internet. Míralo en el inicio.',
          'href', '/dashboard#simulacro'));
      end if;
    end if;
  end if;
  return v_out;
end;
$$;
revoke all on function public.erp_offline_alerts(uuid) from public, anon;
grant execute on function public.erp_offline_alerts(uuid) to authenticated;

notify pgrst, 'reload schema';
