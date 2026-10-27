-- =====================================================================
-- REMHUB · Nómina electrónica (DIAN) — módulo APARTE de la nómina interna
--
--   La nómina interna (gastos y nómina) sigue igual: liquida, aprueba y paga.
--   La nómina electrónica es otro módulo, con sus propias tablas y su propio
--   permiso («payroll_electronic»): un documento por trabajador y por mes que
--   se transmite a la DIAN por Alanube. Puede llenarse a mano o «traer» lo de
--   la nómina interna aprobada del mes, y siempre se revisa antes de enviar.
--   · erp_epayroll_settings: empleador (contribuyente), cuenta del proveedor,
--     ambiente, prefijos y consecutivos (individual y ajustes).
--   · erp_epayroll_profiles: datos DIAN del trabajador (tipo, contrato,
--     nombres separados, municipio, banco).
--   · erp_epayroll_docs: los documentos (individual, reemplazo, anulación).
--   El envío lo hace el servidor (/api/fiscal/payroll) con la llave de servicio.
-- No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- permiso propio
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.erp__known_permissions()'::regprocedure);
  if v_def not like '%payroll_electronic%' then
    v_def := replace(v_def, '''payroll_pay''', '''payroll_pay'', ''payroll_electronic''');
    if v_def not like '%payroll_electronic%' then raise exception 'No se pudo agregar el permiso payroll_electronic.'; end if;
    execute v_def;
  end if;
end $$;

-- ---------------------------------------------------------------- tablas
create table if not exists public.erp_epayroll_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  fiscal_entity_id uuid references public.fiscal_entities(id) on delete restrict,
  provider_account_id uuid references public.fiscal_provider_accounts(id) on delete set null,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  prefix text not null default 'NE',
  next_number bigint not null default 1 check (next_number > 0),
  adjust_prefix text not null default 'NA',
  adjust_next bigint not null default 1 check (adjust_next > 0),
  city_code text,
  address text,
  payment_method text not null default '47',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_epayroll_profiles (
  employee_id uuid primary key references public.erp_employees(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_epayroll_docs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  employee_id uuid not null references public.erp_employees(id) on delete restrict,
  period date not null check (extract(day from period) = 1),
  kind text not null default 'individual' check (kind in ('individual', 'replace', 'cancel')),
  related_id uuid references public.erp_epayroll_docs(id) on delete restrict,
  environment text not null default 'sandbox',
  prefix text,
  number bigint,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'QUEUED', 'PROCESSING', 'SENT', 'ACCEPTED', 'REJECTED', 'ERROR', 'REPLACED', 'CANCELLED')),
  data jsonb not null default '{}'::jsonb,
  devengados numeric(16, 2) not null default 0,
  deducciones numeric(16, 2) not null default 0,
  total numeric(16, 2) not null default 0,
  provider_document_id text,
  cune text,
  provider_status text,
  dian_message text,
  error_message text,
  attempts integer not null default 0,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists erp_epayroll_docs_number on public.erp_epayroll_docs (store_id, environment, prefix, number) where number is not null;
-- Un documento individual vigente por trabajador y mes.
create unique index if not exists erp_epayroll_docs_one on public.erp_epayroll_docs (employee_id, period) where kind = 'individual';
create index if not exists erp_epayroll_docs_period on public.erp_epayroll_docs (store_id, period);

alter table public.erp_epayroll_settings enable row level security;
alter table public.erp_epayroll_profiles enable row level security;
alter table public.erp_epayroll_docs enable row level security;
-- Sin políticas: todo pasa por las funciones de abajo (salarios y datos personales).

do $$ begin
  if to_regprocedure('public.erp__audit_attach(regclass)') is not null then
    perform public.erp__audit_attach('public.erp_epayroll_docs'::regclass);
  end if;
exception when others then null;
end $$;

create or replace function public.erp__epayroll_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.erp_can(p_store, 'payroll_electronic')
$$;

-- ---------------------------------------------------------------- tablero del mes
create or replace function public.erp_epayroll_overview(p_store uuid, p_period date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', coalesce(p_period, current_date))::date;
  st public.erp_epayroll_settings;
  v_emps jsonb;
  v_entities jsonb;
  v_accounts jsonb;
begin
  if not public.erp__epayroll_allowed(p_store) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Nómina electrónica (DIAN)».');
  end if;
  select * into st from public.erp_epayroll_settings where store_id = p_store;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'full_name', e.full_name, 'document_type', e.document_type, 'document', e.document, 'position', e.position,
           'contract_type', e.contract_type, 'base_salary', e.base_salary, 'pay_frequency', e.pay_frequency, 'transport_aid', e.transport_aid,
           'hired_on', e.hired_on, 'terminated_on', e.terminated_on, 'bank_name', e.bank_name, 'bank_account', e.bank_account,
           'profile', coalesce(pr.data, '{}'::jsonb),
           'docs', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status, 'prefix', d.prefix, 'number', d.number,
                      'devengados', d.devengados, 'deducciones', d.deducciones, 'total', d.total, 'cune', d.cune, 'dian_message', d.dian_message,
                      'error_message', d.error_message, 'data', d.data, 'related_id', d.related_id, 'updated_at', d.updated_at) order by d.created_at), '[]'::jsonb)
                    from public.erp_epayroll_docs d where d.employee_id = e.id and d.period = v_period))
         order by e.full_name), '[]'::jsonb)
    into v_emps
  from public.erp_employees e
  left join public.erp_epayroll_profiles pr on pr.employee_id = e.id
  where e.store_id = p_store and to_jsonb(e) ->> 'deleted_at' is null
    and (e.active or exists (select 1 from public.erp_epayroll_docs d where d.employee_id = e.id and d.period = v_period)
         or (e.terminated_on is not null and e.terminated_on >= v_period));

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'legal_name', f.legal_name, 'document_number', f.document_number) order by f.legal_name), '[]'::jsonb)
    into v_entities from public.fiscal_entities f where f.store_id = p_store and f.status = 'active';
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'provider', a.provider, 'environment', a.environment, 'fiscal_entity_id', a.fiscal_entity_id) order by a.label), '[]'::jsonb)
    into v_accounts from public.fiscal_provider_accounts a where a.store_id = p_store;

  return jsonb_build_object('ok', true, 'period', v_period,
    'settings', case when st.store_id is null then null else to_jsonb(st) - 'updated_by' end,
    'entities', v_entities, 'accounts', v_accounts, 'employees', v_emps);
end;
$$;

-- ---------------------------------------------------------------- configuración
create or replace function public.erp_epayroll_settings_save(p_store uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity uuid := nullif(p_data ->> 'fiscal_entity_id', '')::uuid;
  v_account uuid := nullif(p_data ->> 'provider_account_id', '')::uuid;
  v_env text := coalesce(nullif(p_data ->> 'environment', ''), 'sandbox');
begin
  if not public.erp__epayroll_allowed(p_store) then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Nómina electrónica (DIAN)».'); end if;
  if v_entity is not null and not exists (select 1 from public.fiscal_entities where id = v_entity and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'El empleador no es de esta tienda.');
  end if;
  if v_account is not null and not exists (select 1 from public.fiscal_provider_accounts where id = v_account and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'La cuenta del proveedor no es de esta tienda.');
  end if;
  if v_env not in ('sandbox', 'production') then return jsonb_build_object('ok', false, 'message', 'Ambiente inválido.'); end if;
  if nullif(p_data ->> 'city_code', '') is not null and (p_data ->> 'city_code') !~ '^\d{5}$' then
    return jsonb_build_object('ok', false, 'message', 'El código DANE del municipio tiene 5 dígitos.');
  end if;
  insert into public.erp_epayroll_settings as s (store_id, fiscal_entity_id, provider_account_id, environment, prefix, next_number, adjust_prefix, adjust_next, city_code, address, payment_method, updated_by, updated_at)
  values (p_store, v_entity, v_account, v_env,
    upper(coalesce(nullif(btrim(p_data ->> 'prefix'), ''), 'NE')), greatest(coalesce((p_data ->> 'next_number')::bigint, 1), 1),
    upper(coalesce(nullif(btrim(p_data ->> 'adjust_prefix'), ''), 'NA')), greatest(coalesce((p_data ->> 'adjust_next')::bigint, 1), 1),
    nullif(p_data ->> 'city_code', ''), nullif(btrim(p_data ->> 'address'), ''), coalesce(nullif(p_data ->> 'payment_method', ''), '47'), auth.uid(), now())
  on conflict (store_id) do update set
    fiscal_entity_id = excluded.fiscal_entity_id, provider_account_id = excluded.provider_account_id, environment = excluded.environment,
    prefix = excluded.prefix, adjust_prefix = excluded.adjust_prefix,
    -- El consecutivo nunca se devuelve (no se reutilizan números ya enviados).
    next_number = greatest(s.next_number, excluded.next_number), adjust_next = greatest(s.adjust_next, excluded.adjust_next),
    city_code = excluded.city_code, address = excluded.address, payment_method = excluded.payment_method, updated_by = excluded.updated_by, updated_at = now();
  perform public.erp_audit(p_store, 'epayroll.settings', 'erp_epayroll_settings', null, p_data - 'address');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.erp_epayroll_profile_save(p_store uuid, p_employee uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp__epayroll_allowed(p_store) then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Nómina electrónica (DIAN)».'); end if;
  if not exists (select 1 from public.erp_employees where id = p_employee and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'El trabajador no es de esta tienda.');
  end if;
  if jsonb_typeof(coalesce(p_data, 'null')) <> 'object' then return jsonb_build_object('ok', false, 'message', 'Datos inválidos.'); end if;
  insert into public.erp_epayroll_profiles (employee_id, store_id, data, updated_by, updated_at)
  values (p_employee, p_store, p_data, auth.uid(), now())
  on conflict (employee_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- traer de la nómina interna (solo lectura)
-- Suma por concepto lo aprobado del mes en la nómina interna. Nada se guarda: la ventana lo muestra para revisar.
create or replace function public.erp_epayroll_prefill(p_store uuid, p_employee uuid, p_period date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := date_trunc('month', p_period)::date;
  v_to date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_items jsonb;
  v_runs jsonb;
  v_days numeric;
  v_paid jsonb;
begin
  if not public.erp__epayroll_allowed(p_store) then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Nómina electrónica (DIAN)».'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'kind', x.kind, 'value', x.value, 'amount', x.amount) order by x.code), '[]'::jsonb)
    into v_items
  from (
    select it ->> 'code' as code, max(it ->> 'name') as name, max(it ->> 'kind') as kind, max((it ->> 'value')::numeric) as value,
           sum((it ->> 'amount')::numeric) as amount
    from public.erp_payroll_runs r
    join public.erp_payroll_lines l on l.run_id = r.id and l.employee_id = p_employee
    cross join lateral jsonb_array_elements(coalesce(l.items, '[]'::jsonb)) it
    where r.store_id = p_store and r.status in ('approved', 'partial', 'paid') and r.period_end between v_from and v_to
    group by it ->> 'code'
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('number', r.number, 'period_start', r.period_start, 'period_end', r.period_end, 'days', l.days, 'status', r.status) order by r.period_end), '[]'::jsonb),
         coalesce(sum(l.days), 0),
         coalesce(jsonb_agg(distinct to_char(coalesce(r.approved_at, r.period_end::timestamptz) at time zone 'America/Bogota', 'YYYY-MM-DD')), '[]'::jsonb)
    into v_runs, v_days, v_paid
  from public.erp_payroll_runs r join public.erp_payroll_lines l on l.run_id = r.id and l.employee_id = p_employee
  where r.store_id = p_store and r.status in ('approved', 'partial', 'paid') and r.period_end between v_from and v_to;
  return jsonb_build_object('ok', true, 'items', v_items, 'runs', v_runs, 'days', v_days, 'payment_dates', v_paid);
end;
$$;

-- ---------------------------------------------------------------- borrador y cola
create or replace function public.erp_epayroll_doc_save(p_store uuid, p_employee uuid, p_period date, p_data jsonb, p_totals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  d public.erp_epayroll_docs;
  st public.erp_epayroll_settings;
begin
  if not public.erp__epayroll_allowed(p_store) then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Nómina electrónica (DIAN)».'); end if;
  if not exists (select 1 from public.erp_employees where id = p_employee and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'El trabajador no es de esta tienda.');
  end if;
  if v_period > date_trunc('month', (now() at time zone 'America/Bogota'))::date then
    return jsonb_build_object('ok', false, 'message', 'No se prepara la nómina electrónica de un mes que no ha empezado.');
  end if;
  select * into st from public.erp_epayroll_settings where store_id = p_store;
  select * into d from public.erp_epayroll_docs where employee_id = p_employee and period = v_period and kind = 'individual' for update;
  if d.id is not null and d.status not in ('DRAFT', 'REJECTED', 'ERROR') then
    return jsonb_build_object('ok', false, 'message', 'Ese documento ya se envió: para corregirlo usa «Reemplazar».');
  end if;
  if d.id is null then
    insert into public.erp_epayroll_docs (store_id, employee_id, period, kind, environment, data, devengados, deducciones, total, created_by, created_by_name)
    values (p_store, p_employee, v_period, 'individual', coalesce(st.environment, 'sandbox'), coalesce(p_data, '{}'::jsonb),
      coalesce((p_totals ->> 'devengados')::numeric, 0), coalesce((p_totals ->> 'deducciones')::numeric, 0), coalesce((p_totals ->> 'total')::numeric, 0),
      auth.uid(), public.erp_actor_name(p_store))
    returning * into d;
  else
    update public.erp_epayroll_docs set data = coalesce(p_data, '{}'::jsonb), devengados = coalesce((p_totals ->> 'devengados')::numeric, 0),
      deducciones = coalesce((p_totals ->> 'deducciones')::numeric, 0), total = coalesce((p_totals ->> 'total')::numeric, 0),
      status = case when status = 'ERROR' and provider_document_id is not null then status else 'DRAFT' end, updated_at = now()
    where id = d.id returning * into d;
  end if;
  return jsonb_build_object('ok', true, 'id', d.id, 'status', d.status);
end;
$$;

-- Numera (si hace falta) y deja en cola para que el servidor lo transmita.
create or replace function public.erp_epayroll_queue(p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.erp_epayroll_docs;
  st public.erp_epayroll_settings;
begin
  select * into d from public.erp_epayroll_docs where id = p_doc for update;
  if d.id is null then return jsonb_build_object('ok', false, 'message', 'El documento no existe.'); end if;
  if not public.erp__epayroll_allowed(d.store_id) then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Nómina electrónica (DIAN)».'); end if;
  if d.status not in ('DRAFT', 'REJECTED', 'ERROR') then return jsonb_build_object('ok', true, 'status', d.status, 'number', d.number); end if;
  select * into st from public.erp_epayroll_settings where store_id = d.store_id for update;
  if st.fiscal_entity_id is null or st.provider_account_id is null then
    return jsonb_build_object('ok', false, 'message', 'Configura primero el empleador y la cuenta de Alanube de la nómina electrónica.');
  end if;
  if st.city_code is null or st.address is null then
    return jsonb_build_object('ok', false, 'message', 'Falta el municipio (código DANE) y la dirección del empleador.');
  end if;
  if d.number is null then
    if d.kind = 'individual' then
      update public.erp_epayroll_settings set next_number = next_number + 1 where store_id = d.store_id returning next_number - 1 into d.number;
      d.prefix := st.prefix;
    else
      update public.erp_epayroll_settings set adjust_next = adjust_next + 1 where store_id = d.store_id returning adjust_next - 1 into d.number;
      d.prefix := st.adjust_prefix;
    end if;
  end if;
  update public.erp_epayroll_docs set prefix = d.prefix, number = d.number, environment = st.environment, status = 'QUEUED', updated_at = now()
  where id = d.id;
  return jsonb_build_object('ok', true, 'status', 'QUEUED', 'prefix', d.prefix, 'number', d.number);
end;
$$;

-- Reemplazar (corregir) o anular una nómina ya aceptada por la DIAN.
create or replace function public.erp_epayroll_adjust(p_doc uuid, p_kind text, p_data jsonb, p_totals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.erp_epayroll_docs;
  v_id uuid;
begin
  select * into o from public.erp_epayroll_docs where id = p_doc for update;
  if o.id is null then return jsonb_build_object('ok', false, 'message', 'El documento no existe.'); end if;
  if not public.erp__epayroll_allowed(o.store_id) then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Nómina electrónica (DIAN)».'); end if;
  if p_kind not in ('replace', 'cancel') then return jsonb_build_object('ok', false, 'message', 'Acción inválida.'); end if;
  if o.status <> 'ACCEPTED' then return jsonb_build_object('ok', false, 'message', 'Solo se reemplaza o anula una nómina aceptada por la DIAN.'); end if;
  if exists (select 1 from public.erp_epayroll_docs n where n.related_id = o.id and n.status not in ('REJECTED')) then
    return jsonb_build_object('ok', false, 'message', 'Ese documento ya tiene un ajuste en curso o aceptado.');
  end if;
  insert into public.erp_epayroll_docs (store_id, employee_id, period, kind, related_id, environment, data, devengados, deducciones, total, created_by, created_by_name)
  values (o.store_id, o.employee_id, o.period, p_kind, o.id, o.environment,
    case when p_kind = 'cancel' then o.data else coalesce(p_data, o.data) end,
    case when p_kind = 'cancel' then o.devengados else coalesce((p_totals ->> 'devengados')::numeric, o.devengados) end,
    case when p_kind = 'cancel' then o.deducciones else coalesce((p_totals ->> 'deducciones')::numeric, o.deducciones) end,
    case when p_kind = 'cancel' then o.total else coalesce((p_totals ->> 'total')::numeric, o.total) end,
    auth.uid(), public.erp_actor_name(o.store_id))
  returning id into v_id;
  return public.erp_epayroll_queue(v_id) || jsonb_build_object('id', v_id);
end;
$$;

-- ¿Puede este usuario mandar el documento? (lo pregunta la ruta del servidor con la sesión del usuario)
create or replace function public.erp_epayroll_can_send(p_doc uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (select 1 from public.erp_epayroll_docs d where d.id = p_doc and public.erp__epayroll_allowed(d.store_id))
    then jsonb_build_object('ok', true) else jsonb_build_object('ok', false, 'message', 'Sin permiso para transmitir la nómina electrónica.') end
$$;

-- ---------------------------------------------------------------- solo el servidor
create or replace function public.erp_epayroll__claim(p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.erp_epayroll_docs;
  st public.erp_epayroll_settings;
  e public.erp_employees;
  acc public.fiscal_provider_accounts;
  rel public.erp_epayroll_docs;
begin
  select * into d from public.erp_epayroll_docs where id = p_doc for update;
  if d.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'El documento no existe.'); end if;
  if d.status = 'ACCEPTED' then return jsonb_build_object('ok', true, 'done', true, 'status', d.status, 'cune', d.cune); end if;
  if d.status = 'PROCESSING' and d.updated_at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'code', 'BUSY', 'message', 'Se está enviando en este momento.');
  end if;
  if d.status not in ('QUEUED', 'SENT', 'ERROR', 'PROCESSING') then
    return jsonb_build_object('ok', false, 'code', 'NOT_QUEUED', 'message', 'Primero hay que dejarlo listo para enviar.');
  end if;
  select * into st from public.erp_epayroll_settings where store_id = d.store_id;
  select * into e from public.erp_employees where id = d.employee_id;
  select * into acc from public.fiscal_provider_accounts where id = st.provider_account_id;
  if acc.id is null then return jsonb_build_object('ok', false, 'code', 'CONFIG', 'message', 'Falta la cuenta de Alanube.'); end if;
  if d.related_id is not null then select * into rel from public.erp_epayroll_docs where id = d.related_id; end if;
  update public.erp_epayroll_docs set status = 'PROCESSING', attempts = attempts + 1, updated_at = now() where id = d.id;
  return jsonb_build_object('ok', true,
    'doc', to_jsonb(d) || jsonb_build_object('attempts', d.attempts + 1),
    'related', case when rel.id is null then null else jsonb_build_object('id', rel.id, 'provider_document_id', rel.provider_document_id, 'cune', rel.cune, 'prefix', rel.prefix, 'number', rel.number) end,
    'settings', to_jsonb(st),
    'employer', public.fiscal__issuer_snapshot(st.fiscal_entity_id, null, null),
    'employee', to_jsonb(e) || jsonb_build_object('profile', coalesce((select pr.data from public.erp_epayroll_profiles pr where pr.employee_id = e.id), '{}'::jsonb)),
    'account', jsonb_build_object('id', acc.id, 'provider', acc.provider, 'environment', acc.environment, 'external_account_id', acc.external_account_id,
      'settings', coalesce(to_jsonb(acc) -> 'settings', '{}'::jsonb), 'store_id', acc.store_id));
end;
$$;

create or replace function public.erp_epayroll__record(p_doc uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.erp_epayroll_docs;
  v_status text := coalesce(p_result ->> 'status', 'ERROR');
begin
  select * into d from public.erp_epayroll_docs where id = p_doc for update;
  if d.id is null then return jsonb_build_object('ok', false); end if;
  if v_status not in ('SENT', 'ACCEPTED', 'REJECTED', 'ERROR') then v_status := 'ERROR'; end if;
  update public.erp_epayroll_docs set
    status = v_status,
    provider_document_id = coalesce(nullif(p_result ->> 'provider_document_id', ''), provider_document_id),
    cune = coalesce(nullif(p_result ->> 'cune', ''), cune),
    provider_status = left(p_result ->> 'provider_status', 200),
    dian_message = left(p_result ->> 'dian_message', 1500),
    error_message = case when v_status in ('ERROR', 'REJECTED') then left(p_result ->> 'error_message', 1500) else null end,
    sent_at = coalesce(sent_at, case when v_status in ('SENT', 'ACCEPTED', 'REJECTED') then now() end),
    accepted_at = case when v_status = 'ACCEPTED' then now() else accepted_at end,
    updated_at = now()
  where id = d.id;
  -- El reemplazo aceptado deja el original como «reemplazado»; la anulación, como «anulado».
  if v_status = 'ACCEPTED' and d.related_id is not null then
    update public.erp_epayroll_docs set status = case when d.kind = 'cancel' then 'CANCELLED' else 'REPLACED' end, updated_at = now() where id = d.related_id;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke all on function public.erp__epayroll_allowed(uuid) from public, anon;
revoke all on function public.erp_epayroll_overview(uuid, date) from public, anon;
revoke all on function public.erp_epayroll_settings_save(uuid, jsonb) from public, anon;
revoke all on function public.erp_epayroll_profile_save(uuid, uuid, jsonb) from public, anon;
revoke all on function public.erp_epayroll_prefill(uuid, uuid, date) from public, anon;
revoke all on function public.erp_epayroll_doc_save(uuid, uuid, date, jsonb, jsonb) from public, anon;
revoke all on function public.erp_epayroll_queue(uuid) from public, anon;
revoke all on function public.erp_epayroll_adjust(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.erp_epayroll_can_send(uuid) from public, anon;
revoke all on function public.erp_epayroll__claim(uuid) from public, anon, authenticated;
revoke all on function public.erp_epayroll__record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.erp__epayroll_allowed(uuid) to authenticated;
grant execute on function public.erp_epayroll_overview(uuid, date) to authenticated;
grant execute on function public.erp_epayroll_settings_save(uuid, jsonb) to authenticated;
grant execute on function public.erp_epayroll_profile_save(uuid, uuid, jsonb) to authenticated;
grant execute on function public.erp_epayroll_prefill(uuid, uuid, date) to authenticated;
grant execute on function public.erp_epayroll_doc_save(uuid, uuid, date, jsonb, jsonb) to authenticated;
grant execute on function public.erp_epayroll_queue(uuid) to authenticated;
grant execute on function public.erp_epayroll_adjust(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.erp_epayroll_can_send(uuid) to authenticated;
grant execute on function public.erp_epayroll__claim(uuid) to service_role;
grant execute on function public.erp_epayroll__record(uuid, jsonb) to service_role;
