-- =====================================================================
-- REMHUB · Gastos, presupuestos, gastos fijos, nómina y reservas
--
--   · Gastos (egresos) de la madre o de un punto: categoría, proveedor,
--     factura, vencimiento, soportes (fotos/PDF), pagos parciales.
--   · Gastos fijos: se generan solos (semanal, cada 2 semanas, quincenal
--     15 y fin de mes, mensual, bimestral, trimestral, anual).
--   · Presupuestos semanales, quincenales o mensuales por categoría o
--     total, para la madre (consolidado) o un punto.
--   · Nómina: empleados, conceptos editables (devengos, deducciones,
--     aportes del empleador), periodos, aprobación y pagos parciales.
--     Los aportes/provisiones del empleador se crean APAGADOS: actívalos
--     cuando tu contador confirme los porcentajes.
--   · Reservas: fondos con aportes y retiros (prima, impuestos…).
--
-- Aislamiento: lo de la madre (sin punto) solo lo ven usuarios sin punto
-- asignado; lo de un punto, ese punto y la madre. Nada se borra: se anula.
-- Los gastos NO se descuentan de los repartos/liquidaciones.
--
-- Permisos nuevos: expenses (ver y registrar gastos), expenses_pay (pagar
-- y anular gastos), budgets (categorías, presupuestos, gastos fijos y
-- reservas), payroll (empleados y preparar nómina; ve salarios),
-- payroll_approve (aprobar/anular nómina), payroll_pay (pagar nómina).
--
-- No borra ni cambia datos existentes. Es idempotente.
-- =====================================================================

create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'suppliers', 'payables', 'audit', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit',
    'profit_view', 'profit_rules', 'profit_approve',
    'profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay',
    'expenses', 'expenses_pay', 'budgets', 'payroll', 'payroll_approve', 'payroll_pay'
  ]::text[];
$$;

create or replace function public.erp__is_store_member(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
      or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active);
$$;
revoke all on function public.erp__is_store_member(uuid) from public, anon;

-- ¿Puede ver/manejar este ámbito? (null = madre: solo usuarios sin punto)
create or replace function public.erp__scope_ok(p_store uuid, p_point uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_point is null then public.erp_my_points(p_store) is null and public.erp__is_store_member(p_store)
    else exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store) and public.erp_point_allowed(p_store, p_point)
  end;
$$;
revoke all on function public.erp__scope_ok(uuid, uuid) from public, anon, authenticated;

-- Ventana del periodo que contiene una fecha (quincena = 1-15 y 16-fin de mes).
create or replace function public.erp__period_window(p_kind text, p_ref date)
returns table (start_on date, end_on date)
language sql
immutable
as $$
  select case p_kind
           when 'weekly' then date_trunc('week', p_ref)::date
           when 'biweekly' then case when extract(day from p_ref) <= 15 then date_trunc('month', p_ref)::date else (date_trunc('month', p_ref) + interval '15 days')::date end
           else date_trunc('month', p_ref)::date end,
         case p_kind
           when 'weekly' then (date_trunc('week', p_ref) + interval '6 days')::date
           when 'biweekly' then case when extract(day from p_ref) <= 15 then (date_trunc('month', p_ref) + interval '14 days')::date else (date_trunc('month', p_ref) + interval '1 month - 1 day')::date end
           else (date_trunc('month', p_ref) + interval '1 month - 1 day')::date end;
$$;

-- ================================================================ GASTOS
create table if not exists public.erp_expense_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  emoji text not null default '💸',
  kind text not null default 'variable' check (kind in ('fixed', 'variable')),
  is_payroll boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists erp_expense_categories_name on public.erp_expense_categories (store_id, lower(name));
alter table public.erp_expense_categories enable row level security;
revoke all on public.erp_expense_categories from anon, authenticated;

create table if not exists public.erp_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade,
  category_id uuid not null references public.erp_expense_categories(id),
  description text not null check (char_length(btrim(description)) between 2 and 200),
  payee_name text,
  amount numeric(14, 2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'bimonthly', 'quarterly', 'yearly')),
  day_of_month integer not null default 1 check (day_of_month between 1 and 31),
  starts_on date not null,
  ends_on date,
  due_days integer not null default 0 check (due_days between 0 and 120),
  active boolean not null default true,
  last_generated_on date,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
alter table public.erp_recurring_expenses enable row level security;
revoke all on public.erp_recurring_expenses from anon, authenticated;

create table if not exists public.erp_expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id),
  category_id uuid not null references public.erp_expense_categories(id),
  number bigint not null,
  description text not null check (char_length(btrim(description)) between 2 and 200),
  payee_name text,
  reference text,
  amount numeric(14, 2) not null check (amount > 0),
  paid numeric(14, 2) not null default 0,
  incurred_on date not null,
  due_on date,
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid', 'void')),
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  recurring_id uuid references public.erp_recurring_expenses(id),
  period_key text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  voided_by uuid, voided_by_name text, voided_at timestamptz, void_reason text,
  check (paid >= 0 and paid <= amount)
);
create unique index if not exists erp_expenses_number on public.erp_expenses (store_id, number);
create unique index if not exists erp_expenses_recurring_once on public.erp_expenses (recurring_id, period_key) where recurring_id is not null;
create index if not exists erp_expenses_period on public.erp_expenses (store_id, incurred_on);
create index if not exists erp_expenses_due on public.erp_expenses (store_id, status, due_on);
alter table public.erp_expenses enable row level security;
revoke all on public.erp_expenses from anon, authenticated;

create table if not exists public.erp_expense_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  expense_id uuid not null references public.erp_expenses(id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default 'cash',
  reference text,
  paid_at timestamptz not null default now(),
  idempotency_key text not null,
  voided boolean not null default false,
  voided_by uuid, voided_by_name text, voided_at timestamptz, void_reason text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  unique (store_id, idempotency_key)
);
create index if not exists erp_expense_payments_expense on public.erp_expense_payments (expense_id);
alter table public.erp_expense_payments enable row level security;
revoke all on public.erp_expense_payments from anon, authenticated;

create table if not exists public.erp_budgets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade,
  category_id uuid references public.erp_expense_categories(id) on delete cascade, -- null = total
  period text not null check (period in ('weekly', 'biweekly', 'monthly')),
  amount numeric(14, 2) not null check (amount >= 0),
  active boolean not null default true,
  updated_by uuid, updated_by_name text, updated_at timestamptz not null default now()
);
create unique index if not exists erp_budgets_one on public.erp_budgets (store_id, coalesce(point_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), period);
alter table public.erp_budgets enable row level security;
revoke all on public.erp_budgets from anon, authenticated;

-- ================================================================ RESERVAS
create table if not exists public.erp_reserve_funds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  purpose text,
  target numeric(14, 2) check (target is null or target > 0),
  active boolean not null default true,
  created_by uuid, created_by_name text, created_at timestamptz not null default now()
);
alter table public.erp_reserve_funds enable row level security;
revoke all on public.erp_reserve_funds from anon, authenticated;

create table if not exists public.erp_reserve_moves (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  fund_id uuid not null references public.erp_reserve_funds(id),
  kind text not null check (kind in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  note text,
  moved_at timestamptz not null default now(),
  voided boolean not null default false,
  voided_by_name text, voided_at timestamptz, void_reason text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now()
);
alter table public.erp_reserve_moves enable row level security;
revoke all on public.erp_reserve_moves from anon, authenticated;

-- ================================================================ NÓMINA
create table if not exists public.erp_employees (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  document_type text not null default 'CC',
  document text,
  position text,
  contract_type text not null default 'indefinite' check (contract_type in ('indefinite', 'fixed', 'work', 'service', 'apprentice', 'other')),
  base_salary numeric(14, 2) not null default 0 check (base_salary >= 0), -- mensual
  pay_frequency text not null default 'monthly' check (pay_frequency in ('weekly', 'biweekly', 'monthly')),
  transport_aid boolean not null default true,
  hired_on date,
  terminated_on date,
  active boolean not null default true,
  phone text, email text, bank_name text, bank_account text, notes text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists erp_employees_store on public.erp_employees (store_id, point_id, active);
alter table public.erp_employees enable row level security;
revoke all on public.erp_employees from anon, authenticated;

create table if not exists public.erp_payroll_concepts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null check (kind in ('earning', 'deduction', 'employer')),
  calc text not null check (calc in ('salary', 'transport', 'base_pct', 'fixed', 'manual')),
  value numeric(14, 4) not null default 0 check (value >= 0),
  in_base boolean not null default false,              -- devengo que forma la base de % (IBC)
  base_includes_transport boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  note text,
  unique (store_id, code)
);
alter table public.erp_payroll_concepts enable row level security;
revoke all on public.erp_payroll_concepts from anon, authenticated;

create table if not exists public.erp_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id),
  number bigint not null,
  period_kind text not null check (period_kind in ('weekly', 'biweekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'partial', 'paid', 'void')),
  earnings numeric(14, 2) not null default 0,
  deductions numeric(14, 2) not null default 0,
  net numeric(14, 2) not null default 0,
  employer_cost numeric(14, 2) not null default 0,
  total_cost numeric(14, 2) not null default 0,
  notes text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  approved_by uuid, approved_by_name text, approved_at timestamptz,
  voided_by uuid, voided_by_name text, voided_at timestamptz, void_reason text,
  check (period_end >= period_start)
);
create unique index if not exists erp_payroll_runs_number on public.erp_payroll_runs (store_id, number);
alter table public.erp_payroll_runs enable row level security;
revoke all on public.erp_payroll_runs from anon, authenticated;

create table if not exists public.erp_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.erp_payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.erp_employees(id),
  days numeric(6, 2) not null check (days >= 0 and days <= 31),
  salary_base numeric(14, 2) not null,
  manual jsonb not null default '{}'::jsonb,   -- {concept_id: valor} para conceptos manuales
  items jsonb not null default '[]'::jsonb,    -- detalle calculado
  earnings numeric(14, 2) not null default 0,
  deductions numeric(14, 2) not null default 0,
  net numeric(14, 2) not null default 0,
  employer_cost numeric(14, 2) not null default 0,
  paid numeric(14, 2) not null default 0,
  notes text,
  unique (run_id, employee_id),
  check (paid >= 0)
);
alter table public.erp_payroll_lines enable row level security;
revoke all on public.erp_payroll_lines from anon, authenticated;

create table if not exists public.erp_payroll_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  run_id uuid not null references public.erp_payroll_runs(id),
  line_id uuid not null references public.erp_payroll_lines(id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default 'transfer',
  reference text,
  paid_at timestamptz not null default now(),
  idempotency_key text not null,
  voided boolean not null default false,
  voided_by uuid, voided_by_name text, voided_at timestamptz, void_reason text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  unique (store_id, idempotency_key)
);
alter table public.erp_payroll_payments enable row level security;
revoke all on public.erp_payroll_payments from anon, authenticated;

-- ---------------------------------------------------------------- arranque (categorías y conceptos por defecto)
create or replace function public.erp_finance_setup(p_store uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_gen integer := 0; r public.erp_recurring_expenses; d date; v_until date := current_date + 15; v_num bigint; v_cat uuid;
begin
  if not (public.erp_can(p_store, 'expenses') or public.erp_can(p_store, 'budgets') or public.erp_can(p_store, 'payroll')
          or public.erp_can(p_store, 'expenses_pay') or public.erp_can(p_store, 'payroll_approve') or public.erp_can(p_store, 'payroll_pay')) then
    raise exception 'No tienes permiso para el módulo de gastos.';
  end if;
  perform pg_advisory_xact_lock(hashtext('finance_setup:' || p_store::text));

  if not exists (select 1 from public.erp_expense_categories where store_id = p_store) then
    insert into public.erp_expense_categories (store_id, name, emoji, kind, is_payroll, sort_order) values
      (p_store, 'Arriendo', '🏠', 'fixed', false, 1), (p_store, 'Servicios públicos', '💡', 'fixed', false, 2),
      (p_store, 'Internet y telefonía', '📶', 'fixed', false, 3), (p_store, 'Nómina', '👥', 'fixed', true, 4),
      (p_store, 'Transporte y domicilios', '🚚', 'variable', false, 5), (p_store, 'Publicidad', '📣', 'variable', false, 6),
      (p_store, 'Mantenimiento', '🛠️', 'variable', false, 7), (p_store, 'Insumos y papelería', '📦', 'variable', false, 8),
      (p_store, 'Impuestos', '🏛️', 'fixed', false, 9), (p_store, 'Bancos y comisiones', '🏦', 'variable', false, 10),
      (p_store, 'Software y suscripciones', '💻', 'fixed', false, 11), (p_store, 'Otros', '💸', 'variable', false, 12);
  end if;

  if not exists (select 1 from public.erp_payroll_concepts where store_id = p_store) then
    insert into public.erp_payroll_concepts (store_id, code, name, kind, calc, value, in_base, base_includes_transport, active, sort_order, note) values
      (p_store, 'SALARIO', 'Salario', 'earning', 'salary', 0, true, false, true, 1, 'Salario mensual ÷ 30 × días trabajados'),
      (p_store, 'AUX_TRANSPORTE', 'Auxilio de transporte', 'earning', 'transport', 0, false, false, true, 2, 'Escribe el valor mensual vigente; se paga por días a quien lo tenga marcado'),
      (p_store, 'HORAS_EXTRA', 'Horas extra y recargos', 'earning', 'manual', 0, true, false, true, 3, null),
      (p_store, 'COMISIONES', 'Comisiones', 'earning', 'manual', 0, true, false, true, 4, null),
      (p_store, 'BONIFICACION', 'Bonificación no salarial', 'earning', 'manual', 0, false, false, true, 5, null),
      (p_store, 'SALUD', 'Salud (empleado)', 'deduction', 'base_pct', 4, false, false, true, 10, 'Verifica el porcentaje con tu contador'),
      (p_store, 'PENSION', 'Pensión (empleado)', 'deduction', 'base_pct', 4, false, false, true, 11, 'Verifica el porcentaje con tu contador'),
      (p_store, 'ANTICIPO', 'Anticipos y préstamos', 'deduction', 'manual', 0, false, false, true, 12, null),
      (p_store, 'OTRAS_DED', 'Otras deducciones', 'deduction', 'manual', 0, false, false, true, 13, null),
      (p_store, 'SALUD_EMP', 'Salud (empleador)', 'employer', 'base_pct', 8.5, false, false, false, 20, 'Apagado: actívalo cuando tu contador lo confirme'),
      (p_store, 'PENSION_EMP', 'Pensión (empleador)', 'employer', 'base_pct', 12, false, false, false, 21, 'Apagado: actívalo cuando tu contador lo confirme'),
      (p_store, 'ARL', 'ARL', 'employer', 'base_pct', 0.522, false, false, false, 22, 'Depende del nivel de riesgo'),
      (p_store, 'CAJA', 'Caja de compensación', 'employer', 'base_pct', 4, false, false, false, 23, 'Apagado: actívalo cuando tu contador lo confirme'),
      (p_store, 'ICBF', 'ICBF', 'employer', 'base_pct', 3, false, false, false, 24, 'Puede no aplicar (exoneración)'),
      (p_store, 'SENA', 'SENA', 'employer', 'base_pct', 2, false, false, false, 25, 'Puede no aplicar (exoneración)'),
      (p_store, 'PRIMA', 'Provisión prima', 'employer', 'base_pct', 8.33, false, true, false, 26, 'Provisión mensual'),
      (p_store, 'CESANTIAS', 'Provisión cesantías', 'employer', 'base_pct', 8.33, false, true, false, 27, 'Provisión mensual'),
      (p_store, 'INT_CESANTIAS', 'Provisión intereses de cesantías', 'employer', 'base_pct', 1, false, true, false, 28, 'Provisión mensual'),
      (p_store, 'VACACIONES', 'Provisión vacaciones', 'employer', 'base_pct', 4.17, false, false, false, 29, 'Provisión mensual');
  end if;

  -- Gastos fijos: se crean como «por pagar» hasta 15 días adelante (una sola vez por fecha).
  for r in select * from public.erp_recurring_expenses where store_id = p_store and active loop
    for d in
      select x::date from (
        select generate_series(r.starts_on, least(v_until, coalesce(r.ends_on, v_until)), interval '7 days') as x where r.frequency = 'weekly'
        union all select generate_series(r.starts_on, least(v_until, coalesce(r.ends_on, v_until)), interval '14 days') where r.frequency = 'biweekly'
        union all select (m + interval '14 days') from generate_series(date_trunc('month', r.starts_on), least(v_until, coalesce(r.ends_on, v_until)), interval '1 month') m where r.frequency = 'semimonthly'
        union all select (m + interval '1 month - 1 day') from generate_series(date_trunc('month', r.starts_on), least(v_until, coalesce(r.ends_on, v_until)), interval '1 month') m where r.frequency = 'semimonthly'
        union all select (m + make_interval(days => least(r.day_of_month, extract(day from (m + interval '1 month - 1 day'))::integer) - 1))
          from generate_series(date_trunc('month', r.starts_on), least(v_until, coalesce(r.ends_on, v_until)),
                               case r.frequency when 'monthly' then interval '1 month' when 'bimonthly' then interval '2 months'
                                                when 'quarterly' then interval '3 months' else interval '1 year' end) m
          where r.frequency in ('monthly', 'bimonthly', 'quarterly', 'yearly')
      ) q
      where x::date >= greatest(r.starts_on, coalesce(r.last_generated_on + 1, r.starts_on)) and x::date <= least(v_until, coalesce(r.ends_on, v_until))
      order by 1
      limit 60
    loop
      if not exists (select 1 from public.erp_expenses where recurring_id = r.id and period_key = d::text) then
        v_num := public.erp_next_number(p_store, 'expense');
        insert into public.erp_expenses (store_id, point_id, category_id, number, description, payee_name, amount, incurred_on, due_on, recurring_id, period_key, created_by_name)
        values (p_store, r.point_id, r.category_id, v_num, r.description, r.payee_name, r.amount, d, d + r.due_days, r.id, d::text, 'Gasto fijo automático')
        on conflict do nothing;
        v_gen := v_gen + 1;
      end if;
    end loop;
    update public.erp_recurring_expenses set last_generated_on = least(v_until, coalesce(ends_on, v_until)) where id = r.id;
  end loop;

  select id into v_cat from public.erp_expense_categories where store_id = p_store and is_payroll order by sort_order limit 1;
  return jsonb_build_object('ok', true, 'generated', v_gen, 'payroll_category', v_cat);
end;
$$;
revoke all on function public.erp_finance_setup(uuid) from public, anon;
grant execute on function public.erp_finance_setup(uuid) to authenticated;

-- ---------------------------------------------------------------- categorías
create or replace function public.erp_expense_category_save(p_store uuid, p_id uuid, p_name text, p_emoji text, p_kind text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.erp_can(p_store, 'budgets') or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la madre (permiso «Presupuestos y categorías») maneja las categorías.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe el nombre de la categoría.'; end if;
  if p_id is null then
    insert into public.erp_expense_categories (store_id, name, emoji, kind, sort_order)
    values (p_store, btrim(p_name), coalesce(nullif(btrim(p_emoji), ''), '💸'), coalesce(p_kind, 'variable'),
            coalesce((select max(sort_order) + 1 from public.erp_expense_categories where store_id = p_store), 1))
    returning id into v;
  else
    update public.erp_expense_categories set name = btrim(p_name), emoji = coalesce(nullif(btrim(p_emoji), ''), emoji),
      kind = coalesce(p_kind, kind), active = coalesce(p_active, active)
    where id = p_id and store_id = p_store returning id into v;
    if v is null then raise exception 'Categoría no encontrada.'; end if;
  end if;
  perform public.erp_audit(p_store, 'expense_category.saved', 'erp_expense_categories', v, jsonb_build_object('name', p_name, 'active', p_active));
  return jsonb_build_object('ok', true, 'id', v);
exception when unique_violation then
  raise exception 'Ya existe una categoría con ese nombre.';
end;
$$;
revoke all on function public.erp_expense_category_save(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.erp_expense_category_save(uuid, uuid, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------- gastos
create or replace function public.erp__expense_status(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.erp_expenses e
  set status = case when e.status = 'void' then 'void' when e.paid >= e.amount then 'paid' when e.paid > 0 then 'partial' else 'pending' end,
      updated_at = now()
  where e.id = p_id;
$$;
revoke all on function public.erp__expense_status(uuid) from public, anon, authenticated;

create or replace function public.erp_expense_save(
  p_store uuid, p_id uuid, p_point uuid, p_category uuid, p_description text, p_payee text, p_reference text,
  p_amount numeric, p_incurred date, p_due date, p_notes text, p_pay_now boolean, p_method text, p_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public.erp_expenses; v_num bigint; v_amount numeric := round(coalesce(p_amount, 0), 2); before jsonb;
begin
  if not public.erp_can(p_store, 'expenses') then raise exception 'Necesitas el permiso «Gastos».'; end if;
  if p_id is not null then
    select * into e from public.erp_expenses where id = p_id and store_id = p_store for update;
    if not found then raise exception 'Gasto no encontrado.'; end if;
    if e.status = 'void' then raise exception 'Este gasto está anulado.'; end if;
    p_point := e.point_id; -- un gasto no cambia de punto
  end if;
  if not public.erp__scope_ok(p_store, p_point) then
    raise exception '%', case when p_point is null then 'Solo la madre registra gastos generales.' else 'Solo puedes registrar gastos de tus puntos.' end;
  end if;
  if not exists (select 1 from public.erp_expense_categories c where c.id = p_category and c.store_id = p_store and c.active) then raise exception 'Elige una categoría.'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 2 then raise exception 'Escribe en qué se gastó.'; end if;
  if v_amount <= 0 then raise exception 'Escribe un valor mayor a cero.'; end if;
  if p_incurred is null or p_incurred > current_date + 366 then raise exception 'Fecha del gasto no válida.'; end if;
  if p_due is not null and p_due < p_incurred then raise exception 'El vencimiento no puede ser antes de la fecha del gasto.'; end if;

  if p_id is null then
    v_num := public.erp_next_number(p_store, 'expense');
    insert into public.erp_expenses (store_id, point_id, category_id, number, description, payee_name, reference, amount, incurred_on, due_on, notes, created_by, created_by_name)
    values (p_store, p_point, p_category, v_num, btrim(p_description), nullif(btrim(coalesce(p_payee, '')), ''), nullif(btrim(coalesce(p_reference, '')), ''),
            v_amount, p_incurred, p_due, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), public.erp_actor_name(p_store))
    returning * into e;
    perform public.erp_audit(p_store, 'expense.created', 'erp_expenses', e.id, jsonb_build_object('number', v_num, 'amount', v_amount, 'point_id', p_point, 'description', e.description));
  else
    if v_amount < e.paid then raise exception 'El valor no puede ser menor a lo ya pagado (%).', e.paid; end if;
    before := to_jsonb(e);
    update public.erp_expenses set category_id = p_category, description = btrim(p_description), payee_name = nullif(btrim(coalesce(p_payee, '')), ''),
      reference = nullif(btrim(coalesce(p_reference, '')), ''), amount = v_amount, incurred_on = p_incurred, due_on = p_due,
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
    where id = e.id returning * into e;
    perform public.erp__expense_status(e.id);
    perform public.erp_audit(p_store, 'expense.updated', 'erp_expenses', e.id, jsonb_build_object('before', before, 'after', to_jsonb(e)));
  end if;

  if coalesce(p_pay_now, false) and e.paid < e.amount then
    if not public.erp_can(p_store, 'expenses_pay') then raise exception 'Necesitas el permiso «Pagar gastos» para registrarlo como pagado.'; end if;
    perform public.erp_expense_pay(e.id, e.amount - e.paid, p_method, p_reference, null, coalesce(p_key, 'auto-' || e.id::text));
  end if;
  return jsonb_build_object('ok', true, 'id', e.id, 'number', e.number);
end;
$$;

create or replace function public.erp_expense_pay(p_expense uuid, p_amount numeric, p_method text, p_reference text, p_paid_at timestamptz, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public.erp_expenses; p public.erp_expense_payments; v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  select * into e from public.erp_expenses where id = p_expense for update;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  if not public.erp_can(e.store_id, 'expenses_pay') then raise exception 'Necesitas el permiso «Pagar gastos».'; end if;
  if not public.erp__scope_ok(e.store_id, e.point_id) then raise exception 'Este gasto no es de tus puntos.'; end if;
  if char_length(coalesce(p_key, '')) < 8 then raise exception 'Falta la llave del pago.'; end if;
  select * into p from public.erp_expense_payments where store_id = e.store_id and idempotency_key = p_key;
  if found then return jsonb_build_object('ok', true, 'already', true, 'payment_id', p.id); end if;
  if e.status = 'void' then raise exception 'Este gasto está anulado.'; end if;
  if v_amount <= 0 then raise exception 'Escribe un valor mayor a cero.'; end if;
  if v_amount > e.amount - e.paid then raise exception 'El pago (%) supera el saldo pendiente (%).', v_amount, e.amount - e.paid; end if;
  insert into public.erp_expense_payments (store_id, expense_id, amount, method, reference, paid_at, idempotency_key, created_by, created_by_name)
  values (e.store_id, e.id, v_amount, coalesce(nullif(btrim(p_method), ''), 'cash'), nullif(btrim(coalesce(p_reference, '')), ''),
          least(coalesce(p_paid_at, now()), now()), p_key, auth.uid(), public.erp_actor_name(e.store_id))
  returning * into p;
  update public.erp_expenses set paid = paid + v_amount where id = e.id;
  perform public.erp__expense_status(e.id);
  perform public.erp_audit(e.store_id, 'expense.payment', 'erp_expenses', e.id, jsonb_build_object('number', e.number, 'amount', v_amount, 'method', p_method));
  return jsonb_build_object('ok', true, 'already', false, 'payment_id', p.id);
end;
$$;
revoke all on function public.erp_expense_pay(uuid, numeric, text, text, timestamptz, text) from public, anon;
grant execute on function public.erp_expense_pay(uuid, numeric, text, text, timestamptz, text) to authenticated;
revoke all on function public.erp_expense_save(uuid, uuid, uuid, uuid, text, text, text, numeric, date, date, text, boolean, text, text) from public, anon;
grant execute on function public.erp_expense_save(uuid, uuid, uuid, uuid, text, text, text, numeric, date, date, text, boolean, text, text) to authenticated;

create or replace function public.erp_expense_payment_void(p_payment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.erp_expense_payments; e public.erp_expenses;
begin
  select * into p from public.erp_expense_payments where id = p_payment for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  select * into e from public.erp_expenses where id = p.expense_id for update;
  if not public.erp_can(e.store_id, 'expenses_pay') then raise exception 'Necesitas el permiso «Pagar gastos».'; end if;
  if not public.erp__scope_ok(e.store_id, e.point_id) then raise exception 'Este gasto no es de tus puntos.'; end if;
  if p.voided then raise exception 'Este pago ya está anulado.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  update public.erp_expense_payments set voided = true, voided_by = auth.uid(), voided_by_name = public.erp_actor_name(e.store_id), voided_at = now(), void_reason = btrim(p_reason) where id = p.id;
  update public.erp_expenses set paid = paid - p.amount where id = e.id;
  perform public.erp__expense_status(e.id);
  perform public.erp_audit(e.store_id, 'expense.payment_voided', 'erp_expenses', e.id, jsonb_build_object('amount', p.amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_expense_payment_void(uuid, text) from public, anon;
grant execute on function public.erp_expense_payment_void(uuid, text) to authenticated;

create or replace function public.erp_expense_void(p_expense uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.erp_expenses;
begin
  select * into e from public.erp_expenses where id = p_expense for update;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  if not (public.erp_can(e.store_id, 'expenses') and public.erp_can(e.store_id, 'expenses_pay')) then raise exception 'Necesitas los permisos «Gastos» y «Pagar gastos» para anular.'; end if;
  if not public.erp__scope_ok(e.store_id, e.point_id) then raise exception 'Este gasto no es de tus puntos.'; end if;
  if e.status = 'void' then raise exception 'Ya está anulado.'; end if;
  if e.paid > 0 then raise exception 'Tiene pagos registrados: anúlalos primero.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  update public.erp_expenses set status = 'void', voided_by = auth.uid(), voided_by_name = public.erp_actor_name(e.store_id), voided_at = now(), void_reason = btrim(p_reason), updated_at = now() where id = e.id;
  perform public.erp_audit(e.store_id, 'expense.voided', 'erp_expenses', e.id, jsonb_build_object('number', e.number, 'amount', e.amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_expense_void(uuid, text) from public, anon;
grant execute on function public.erp_expense_void(uuid, text) to authenticated;

-- Soportes: el archivo se sube al almacenamiento privado y aquí se anota en el gasto.
create or replace function public.erp_expense_attach(p_expense uuid, p_file jsonb, p_remove_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.erp_expenses; v_path text := p_file->>'path';
begin
  select * into e from public.erp_expenses where id = p_expense for update;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  if not public.erp_can(e.store_id, 'expenses') then raise exception 'Necesitas el permiso «Gastos».'; end if;
  if not public.erp__scope_ok(e.store_id, e.point_id) then raise exception 'Este gasto no es de tus puntos.'; end if;
  if p_remove_path is not null then
    update public.erp_expenses set attachments = coalesce((select jsonb_agg(a) from jsonb_array_elements(attachments) a where a->>'path' <> p_remove_path), '[]'::jsonb) where id = e.id;
    return jsonb_build_object('ok', true);
  end if;
  if v_path is null or v_path not like e.store_id::text || '/%' then raise exception 'Archivo no válido.'; end if;
  if jsonb_array_length(e.attachments) >= 10 then raise exception 'Máximo 10 soportes por gasto.'; end if;
  update public.erp_expenses set attachments = attachments || jsonb_build_array(jsonb_build_object('path', v_path, 'name', left(coalesce(p_file->>'name', 'soporte'), 120),
    'mime', p_file->>'mime', 'size', (p_file->>'size')::bigint, 'at', now())) where id = e.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_expense_attach(uuid, jsonb, text) from public, anon;
grant execute on function public.erp_expense_attach(uuid, jsonb, text) to authenticated;

create or replace function public.erp_expenses_list(p_store uuid, p_point uuid, p_from date, p_to date, p_status text, p_category uuid, p_query text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_points uuid[] := public.erp_my_points(p_store); q text := lower(btrim(coalesce(p_query, '')));
begin
  if not (public.erp_can(p_store, 'expenses') or public.erp_can(p_store, 'expenses_pay') or public.erp_can(p_store, 'budgets')) then raise exception 'Necesitas el permiso «Gastos».'; end if;
  if p_point is not null and not public.erp__scope_ok(p_store, p_point) then raise exception 'Solo puedes ver tus puntos.'; end if;
  return (
    with f as (
      select e.*, c.name as category_name, c.emoji, w.name as point_name
      from public.erp_expenses e
      join public.erp_expense_categories c on c.id = e.category_id
      left join public.erp_warehouses w on w.id = e.point_id
      where e.store_id = p_store
        and (v_points is null or e.point_id = any (v_points))
        and (p_point is null or e.point_id = p_point)
        and (p_from is null or e.incurred_on >= p_from) and (p_to is null or e.incurred_on <= p_to)
        and (p_status is null or p_status = '' or (p_status = 'open' and e.status in ('pending', 'partial')) or (p_status = 'overdue' and e.status in ('pending', 'partial') and e.due_on < current_date) or e.status = p_status)
        and (p_category is null or e.category_id = p_category)
        and (q = '' or lower(e.description) like '%' || q || '%' or lower(coalesce(e.payee_name, '')) like '%' || q || '%' or lower(coalesce(e.reference, '')) like '%' || q || '%' or e.number::text = q)
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'sum', (select coalesce(sum(amount), 0) from f where status <> 'void'),
      'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'created_by' - 'voided_by') from (select * from f order by incurred_on desc, number desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.erp_expenses_list(uuid, uuid, date, date, text, uuid, text, integer, integer) from public, anon;
grant execute on function public.erp_expenses_list(uuid, uuid, date, date, text, uuid, text, integer, integer) to authenticated;

create or replace function public.erp_expense_detail(p_expense uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e public.erp_expenses;
begin
  select * into e from public.erp_expenses where id = p_expense;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  if not (public.erp_can(e.store_id, 'expenses') or public.erp_can(e.store_id, 'expenses_pay')) then raise exception 'Necesitas el permiso «Gastos».'; end if;
  if not public.erp__scope_ok(e.store_id, e.point_id) then raise exception 'Este gasto no es de tus puntos.'; end if;
  return jsonb_build_object('expense', to_jsonb(e) || jsonb_build_object('category_name', (select name from public.erp_expense_categories where id = e.category_id),
                                                                         'point_name', (select name from public.erp_warehouses where id = e.point_id)),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'idempotency_key' order by p.paid_at desc) from public.erp_expense_payments p where p.expense_id = e.id), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_expense_detail(uuid) from public, anon;
grant execute on function public.erp_expense_detail(uuid) to authenticated;

-- ---------------------------------------------------------------- gastos fijos
create or replace function public.erp_recurring_save(
  p_store uuid, p_id uuid, p_point uuid, p_category uuid, p_description text, p_payee text, p_amount numeric,
  p_frequency text, p_day integer, p_starts date, p_ends date, p_due_days integer, p_active boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_recurring_expenses;
begin
  if not (public.erp_can(p_store, 'budgets') or public.erp_can(p_store, 'expenses')) then raise exception 'Necesitas el permiso «Gastos» o «Presupuestos».'; end if;
  if p_id is not null then
    select * into r from public.erp_recurring_expenses where id = p_id and store_id = p_store for update;
    if not found then raise exception 'Gasto fijo no encontrado.'; end if;
    p_point := r.point_id;
  end if;
  if not public.erp__scope_ok(p_store, p_point) then raise exception 'No puedes manejar gastos fijos de ese punto.'; end if;
  if not exists (select 1 from public.erp_expense_categories c where c.id = p_category and c.store_id = p_store) then raise exception 'Elige una categoría.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Escribe un valor mayor a cero.'; end if;
  if p_frequency not in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'bimonthly', 'quarterly', 'yearly') then raise exception 'Frecuencia no válida.'; end if;
  if p_starts is null then raise exception 'Elige desde cuándo aplica.'; end if;
  if p_id is null then
    insert into public.erp_recurring_expenses (store_id, point_id, category_id, description, payee_name, amount, frequency, day_of_month, starts_on, ends_on, due_days, active, created_by, created_by_name)
    values (p_store, p_point, p_category, btrim(p_description), nullif(btrim(coalesce(p_payee, '')), ''), round(p_amount, 2), p_frequency, coalesce(p_day, extract(day from p_starts)::integer),
            p_starts, p_ends, coalesce(p_due_days, 0), coalesce(p_active, true), auth.uid(), public.erp_actor_name(p_store))
    returning * into r;
  else
    -- Cambios aplican a los gastos que aún no se han generado.
    update public.erp_recurring_expenses set category_id = p_category, description = btrim(p_description), payee_name = nullif(btrim(coalesce(p_payee, '')), ''),
      amount = round(p_amount, 2), frequency = p_frequency, day_of_month = coalesce(p_day, day_of_month), ends_on = p_ends,
      due_days = coalesce(p_due_days, due_days), active = coalesce(p_active, active), updated_at = now()
    where id = r.id returning * into r;
  end if;
  perform public.erp_audit(p_store, 'recurring_expense.saved', 'erp_recurring_expenses', r.id, to_jsonb(r));
  return jsonb_build_object('ok', true, 'id', r.id);
end;
$$;
revoke all on function public.erp_recurring_save(uuid, uuid, uuid, uuid, text, text, numeric, text, integer, date, date, integer, boolean) from public, anon;
grant execute on function public.erp_recurring_save(uuid, uuid, uuid, uuid, text, text, numeric, text, integer, date, date, integer, boolean) to authenticated;

-- ---------------------------------------------------------------- presupuestos
create or replace function public.erp_budget_save(p_store uuid, p_point uuid, p_category uuid, p_period text, p_amount numeric, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.erp_can(p_store, 'budgets') then raise exception 'Necesitas el permiso «Presupuestos».'; end if;
  if not public.erp__scope_ok(p_store, p_point) then raise exception 'No puedes manejar el presupuesto de ese punto.'; end if;
  if p_period not in ('weekly', 'biweekly', 'monthly') then raise exception 'Periodo no válido.'; end if;
  if coalesce(p_amount, -1) < 0 then raise exception 'Escribe un valor válido.'; end if;
  if p_category is not null and not exists (select 1 from public.erp_expense_categories where id = p_category and store_id = p_store) then raise exception 'Categoría no válida.'; end if;
  select id into v from public.erp_budgets where store_id = p_store and point_id is not distinct from p_point and category_id is not distinct from p_category and period = p_period;
  if v is null then
    insert into public.erp_budgets (store_id, point_id, category_id, period, amount, active, updated_by, updated_by_name)
    values (p_store, p_point, p_category, p_period, round(p_amount, 2), coalesce(p_active, true), auth.uid(), public.erp_actor_name(p_store)) returning id into v;
  else
    update public.erp_budgets set amount = round(p_amount, 2), active = coalesce(p_active, active), updated_by = auth.uid(), updated_by_name = public.erp_actor_name(p_store), updated_at = now() where id = v;
  end if;
  perform public.erp_audit(p_store, 'budget.saved', 'erp_budgets', v, jsonb_build_object('point_id', p_point, 'category_id', p_category, 'period', p_period, 'amount', p_amount, 'active', p_active));
  return jsonb_build_object('ok', true, 'id', v);
end;
$$;
revoke all on function public.erp_budget_save(uuid, uuid, uuid, text, numeric, boolean) from public, anon;
grant execute on function public.erp_budget_save(uuid, uuid, uuid, text, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------- reservas
create or replace function public.erp_reserve_fund_save(p_store uuid, p_id uuid, p_point uuid, p_name text, p_purpose text, p_target numeric, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.erp_reserve_funds;
begin
  if not public.erp_can(p_store, 'budgets') then raise exception 'Necesitas el permiso «Presupuestos».'; end if;
  if p_id is not null then
    select * into f from public.erp_reserve_funds where id = p_id and store_id = p_store for update;
    if not found then raise exception 'Reserva no encontrada.'; end if;
    p_point := f.point_id;
  end if;
  if not public.erp__scope_ok(p_store, p_point) then raise exception 'No puedes manejar reservas de ese punto.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe el nombre de la reserva.'; end if;
  if p_id is null then
    insert into public.erp_reserve_funds (store_id, point_id, name, purpose, target, active, created_by, created_by_name)
    values (p_store, p_point, btrim(p_name), nullif(btrim(coalesce(p_purpose, '')), ''), nullif(p_target, 0), coalesce(p_active, true), auth.uid(), public.erp_actor_name(p_store)) returning * into f;
  else
    update public.erp_reserve_funds set name = btrim(p_name), purpose = nullif(btrim(coalesce(p_purpose, '')), ''), target = nullif(p_target, 0), active = coalesce(p_active, active)
    where id = f.id returning * into f;
  end if;
  perform public.erp_audit(p_store, 'reserve_fund.saved', 'erp_reserve_funds', f.id, to_jsonb(f));
  return jsonb_build_object('ok', true, 'id', f.id);
end;
$$;
revoke all on function public.erp_reserve_fund_save(uuid, uuid, uuid, text, text, numeric, boolean) from public, anon;
grant execute on function public.erp_reserve_fund_save(uuid, uuid, uuid, text, text, numeric, boolean) to authenticated;

create or replace function public.erp_reserve_move(p_fund uuid, p_kind text, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.erp_reserve_funds; v_bal numeric; v_id uuid;
begin
  select * into f from public.erp_reserve_funds where id = p_fund for update;
  if not found then raise exception 'Reserva no encontrada.'; end if;
  if not public.erp_can(f.store_id, 'budgets') then raise exception 'Necesitas el permiso «Presupuestos».'; end if;
  if not public.erp__scope_ok(f.store_id, f.point_id) then raise exception 'No puedes manejar esta reserva.'; end if;
  if p_kind not in ('in', 'out') or coalesce(p_amount, 0) <= 0 then raise exception 'Movimiento no válido.'; end if;
  select coalesce(sum(case when kind = 'in' then amount else -amount end), 0) into v_bal from public.erp_reserve_moves where fund_id = f.id and not voided;
  if p_kind = 'out' and round(p_amount, 2) > v_bal then raise exception 'La reserva solo tiene %.', v_bal; end if;
  insert into public.erp_reserve_moves (store_id, fund_id, kind, amount, note, created_by, created_by_name)
  values (f.store_id, f.id, p_kind, round(p_amount, 2), nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), public.erp_actor_name(f.store_id)) returning id into v_id;
  perform public.erp_audit(f.store_id, 'reserve.' || p_kind, 'erp_reserve_funds', f.id, jsonb_build_object('amount', p_amount, 'note', p_note));
  return jsonb_build_object('ok', true, 'id', v_id, 'balance', v_bal + case when p_kind = 'in' then round(p_amount, 2) else -round(p_amount, 2) end);
end;
$$;
revoke all on function public.erp_reserve_move(uuid, text, numeric, text) from public, anon;
grant execute on function public.erp_reserve_move(uuid, text, numeric, text) to authenticated;

-- ================================================================ NÓMINA: cálculo
create or replace function public.erp__payroll_compute(p_line uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.erp_payroll_lines; e public.erp_employees; run public.erp_payroll_runs; c record;
  v_items jsonb := '[]'::jsonb; v_earn numeric := 0; v_ibc numeric := 0; v_aux numeric := 0; v_ded numeric := 0; v_emp numeric := 0; v_amt numeric;
begin
  select * into l from public.erp_payroll_lines where id = p_line;
  select * into e from public.erp_employees where id = l.employee_id;
  select * into run from public.erp_payroll_runs where id = l.run_id;
  for c in select * from public.erp_payroll_concepts where store_id = run.store_id and active order by case kind when 'earning' then 1 when 'deduction' then 2 else 3 end, sort_order loop
    if c.kind = 'earning' then
      v_amt := case c.calc
        when 'salary' then round(l.salary_base / 30 * l.days, 0)
        when 'transport' then case when e.transport_aid then round(c.value / 30 * l.days, 0) else 0 end
        when 'fixed' then round(c.value, 0)
        when 'manual' then round(coalesce((l.manual->>c.id::text)::numeric, 0), 0)
        else 0 end;
      v_earn := v_earn + v_amt;
      if c.in_base then v_ibc := v_ibc + v_amt; end if;
      if c.calc = 'transport' then v_aux := v_aux + v_amt; end if;
    elsif c.kind = 'deduction' then
      v_amt := case c.calc
        when 'base_pct' then round(v_ibc * c.value / 100, 0)
        when 'fixed' then round(c.value, 0)
        when 'manual' then round(coalesce((l.manual->>c.id::text)::numeric, 0), 0)
        else 0 end;
      v_ded := v_ded + v_amt;
    else
      v_amt := case c.calc
        when 'base_pct' then round((v_ibc + case when c.base_includes_transport then v_aux else 0 end) * c.value / 100, 0)
        when 'fixed' then round(c.value, 0)
        when 'manual' then round(coalesce((l.manual->>c.id::text)::numeric, 0), 0)
        else 0 end;
      v_emp := v_emp + v_amt;
    end if;
    if v_amt <> 0 or c.calc = 'manual' then
      v_items := v_items || jsonb_build_array(jsonb_build_object('concept_id', c.id, 'code', c.code, 'name', c.name, 'kind', c.kind, 'calc', c.calc, 'value', c.value, 'amount', v_amt));
    end if;
  end loop;
  if v_ded > v_earn then raise exception 'Las deducciones de % superan lo devengado.', e.full_name; end if;
  update public.erp_payroll_lines set items = v_items, earnings = v_earn, deductions = v_ded, net = v_earn - v_ded, employer_cost = v_emp where id = l.id;
  update public.erp_payroll_runs r set
    earnings = x.earn, deductions = x.ded, net = x.net, employer_cost = x.emp, total_cost = x.earn + x.emp
  from (select coalesce(sum(earnings), 0) as earn, coalesce(sum(deductions), 0) as ded, coalesce(sum(net), 0) as net, coalesce(sum(employer_cost), 0) as emp
        from public.erp_payroll_lines where run_id = run.id) x
  where r.id = run.id;
end;
$$;
revoke all on function public.erp__payroll_compute(uuid) from public, anon, authenticated;

-- ================================================================ NÓMINA: API
create or replace function public.erp_employee_save(p_store uuid, p_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.erp_employees; v_point uuid := nullif(p_data->>'point_id', '')::uuid; before jsonb;
begin
  if not public.erp_can(p_store, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if p_id is not null then
    select * into e from public.erp_employees where id = p_id and store_id = p_store for update;
    if not found then raise exception 'Empleado no encontrado.'; end if;
    if not public.erp__scope_ok(p_store, e.point_id) then raise exception 'Este empleado no es de tus puntos.'; end if;
  end if;
  if not public.erp__scope_ok(p_store, v_point) then raise exception 'Solo puedes manejar empleados de tus puntos.'; end if;
  if char_length(btrim(coalesce(p_data->>'full_name', ''))) < 2 then raise exception 'Escribe el nombre del empleado.'; end if;
  if coalesce((p_data->>'base_salary')::numeric, 0) < 0 then raise exception 'Salario no válido.'; end if;
  if p_id is null then
    insert into public.erp_employees (store_id, point_id, full_name, document_type, document, position, contract_type, base_salary, pay_frequency, transport_aid,
      hired_on, terminated_on, active, phone, email, bank_name, bank_account, notes, created_by, created_by_name)
    values (p_store, v_point, upper(btrim(p_data->>'full_name')), coalesce(nullif(p_data->>'document_type', ''), 'CC'), nullif(btrim(coalesce(p_data->>'document', '')), ''),
      nullif(btrim(coalesce(p_data->>'position', '')), ''), coalesce(nullif(p_data->>'contract_type', ''), 'indefinite'), round(coalesce((p_data->>'base_salary')::numeric, 0), 2),
      coalesce(nullif(p_data->>'pay_frequency', ''), 'monthly'), coalesce((p_data->>'transport_aid')::boolean, true),
      nullif(p_data->>'hired_on', '')::date, nullif(p_data->>'terminated_on', '')::date, coalesce((p_data->>'active')::boolean, true),
      nullif(btrim(coalesce(p_data->>'phone', '')), ''), nullif(btrim(coalesce(p_data->>'email', '')), ''), nullif(btrim(coalesce(p_data->>'bank_name', '')), ''),
      nullif(btrim(coalesce(p_data->>'bank_account', '')), ''), nullif(btrim(coalesce(p_data->>'notes', '')), ''), auth.uid(), public.erp_actor_name(p_store))
    returning * into e;
    perform public.erp_audit(p_store, 'employee.created', 'erp_employees', e.id, jsonb_build_object('name', e.full_name, 'point_id', v_point));
  else
    before := to_jsonb(e);
    update public.erp_employees set point_id = v_point, full_name = upper(btrim(p_data->>'full_name')), document_type = coalesce(nullif(p_data->>'document_type', ''), document_type),
      document = nullif(btrim(coalesce(p_data->>'document', '')), ''), position = nullif(btrim(coalesce(p_data->>'position', '')), ''),
      contract_type = coalesce(nullif(p_data->>'contract_type', ''), contract_type), base_salary = round(coalesce((p_data->>'base_salary')::numeric, base_salary), 2),
      pay_frequency = coalesce(nullif(p_data->>'pay_frequency', ''), pay_frequency), transport_aid = coalesce((p_data->>'transport_aid')::boolean, transport_aid),
      hired_on = nullif(p_data->>'hired_on', '')::date, terminated_on = nullif(p_data->>'terminated_on', '')::date, active = coalesce((p_data->>'active')::boolean, active),
      phone = nullif(btrim(coalesce(p_data->>'phone', '')), ''), email = nullif(btrim(coalesce(p_data->>'email', '')), ''),
      bank_name = nullif(btrim(coalesce(p_data->>'bank_name', '')), ''), bank_account = nullif(btrim(coalesce(p_data->>'bank_account', '')), ''),
      notes = nullif(btrim(coalesce(p_data->>'notes', '')), ''), updated_at = now()
    where id = e.id returning * into e;
    perform public.erp_audit(p_store, 'employee.updated', 'erp_employees', e.id,
      jsonb_build_object('before', before - 'bank_account', 'after', to_jsonb(e) - 'bank_account', 'salary_changed', (before->>'base_salary')::numeric is distinct from e.base_salary));
  end if;
  return jsonb_build_object('ok', true, 'id', e.id);
end;
$$;
revoke all on function public.erp_employee_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.erp_employee_save(uuid, uuid, jsonb) to authenticated;

create or replace function public.erp_payroll_concept_save(p_store uuid, p_id uuid, p_name text, p_kind text, p_calc text, p_value numeric, p_in_base boolean, p_incl_transport boolean, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.erp_can(p_store, 'payroll_approve') or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la madre (permiso «Aprobar nómina») cambia los conceptos de nómina.';
  end if;
  if coalesce(p_value, 0) < 0 or (p_calc = 'base_pct' and p_value > 100) then raise exception 'Valor no válido.'; end if;
  if p_id is null then
    if p_kind not in ('earning', 'deduction', 'employer') or p_calc not in ('base_pct', 'fixed', 'manual') then raise exception 'Concepto no válido.'; end if;
    insert into public.erp_payroll_concepts (store_id, code, name, kind, calc, value, in_base, base_includes_transport, active, sort_order)
    values (p_store, 'C' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS'), btrim(p_name), p_kind, p_calc, coalesce(p_value, 0), coalesce(p_in_base, false),
            coalesce(p_incl_transport, false), coalesce(p_active, true), 50) returning id into v;
  else
    update public.erp_payroll_concepts set name = coalesce(nullif(btrim(p_name), ''), name), value = coalesce(p_value, value), in_base = coalesce(p_in_base, in_base),
      base_includes_transport = coalesce(p_incl_transport, base_includes_transport), active = coalesce(p_active, active)
    where id = p_id and store_id = p_store returning id into v;
    if v is null then raise exception 'Concepto no encontrado.'; end if;
  end if;
  perform public.erp_audit(p_store, 'payroll_concept.saved', 'erp_payroll_concepts', v, jsonb_build_object('name', p_name, 'value', p_value, 'active', p_active));
  return jsonb_build_object('ok', true, 'id', v);
end;
$$;
revoke all on function public.erp_payroll_concept_save(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean) from public, anon;
grant execute on function public.erp_payroll_concept_save(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean) to authenticated;

create or replace function public.erp_payroll_create(p_store uuid, p_point uuid, p_kind text, p_start date, p_end date, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num bigint; e record; v_days numeric; v_line uuid; v_n integer := 0; v_skipped text[] := '{}';
begin
  if not public.erp_can(p_store, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if not public.erp__scope_ok(p_store, p_point) then raise exception 'No puedes hacer la nómina de ese punto.'; end if;
  if p_kind not in ('weekly', 'biweekly', 'monthly') or p_start is null or p_end is null or p_end < p_start or p_end - p_start > 31 then raise exception 'Periodo no válido.'; end if;
  perform pg_advisory_xact_lock(hashtext('payroll:' || p_store::text));
  v_num := public.erp_next_number(p_store, 'payroll');
  insert into public.erp_payroll_runs (store_id, point_id, number, period_kind, period_start, period_end, notes, created_by, created_by_name)
  values (p_store, p_point, v_num, p_kind, p_start, p_end, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), public.erp_actor_name(p_store)) returning id into v_id;
  for e in
    select * from public.erp_employees x
    where x.store_id = p_store and x.active and x.pay_frequency = p_kind
      and (p_point is null or x.point_id = p_point)
      and (public.erp_my_points(p_store) is null or x.point_id = any (public.erp_my_points(p_store)))
      and (x.hired_on is null or x.hired_on <= p_end) and (x.terminated_on is null or x.terminated_on >= p_start)
  loop
    -- Un empleado no puede estar en dos nóminas del mismo periodo.
    if exists (select 1 from public.erp_payroll_lines pl join public.erp_payroll_runs pr on pr.id = pl.run_id
               where pl.employee_id = e.id and pr.status <> 'void' and pr.id <> v_id and pr.period_start <= p_end and pr.period_end >= p_start) then
      v_skipped := v_skipped || e.full_name;
      continue;
    end if;
    -- Días del periodo en meses de 30 (estándar de nómina en Colombia), recortados por ingreso o retiro.
    v_days := case p_kind when 'weekly' then 7 when 'biweekly' then 15 else 30 end;
    if e.hired_on is not null and e.hired_on > p_start then v_days := greatest(0, v_days - (e.hired_on - p_start)); end if;
    if e.terminated_on is not null and e.terminated_on < p_end then v_days := greatest(0, v_days - (p_end - e.terminated_on)); end if;
    insert into public.erp_payroll_lines (run_id, employee_id, days, salary_base) values (v_id, e.id, least(v_days, 30), e.base_salary) returning id into v_line;
    perform public.erp__payroll_compute(v_line);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'No hay empleados activos con pago % para ese periodo%.', case p_kind when 'weekly' then 'semanal' when 'biweekly' then 'quincenal' else 'mensual' end,
    case when cardinality(v_skipped) > 0 then ' (ya están en otra nómina: ' || array_to_string(v_skipped, ', ') || ')' else '' end; end if;
  perform public.erp_audit(p_store, 'payroll.created', 'erp_payroll_runs', v_id, jsonb_build_object('number', v_num, 'start', p_start, 'end', p_end, 'employees', v_n, 'skipped', v_skipped));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num, 'employees', v_n, 'skipped', to_jsonb(v_skipped));
end;
$$;
revoke all on function public.erp_payroll_create(uuid, uuid, text, date, date, text) from public, anon;
grant execute on function public.erp_payroll_create(uuid, uuid, text, date, date, text) to authenticated;

create or replace function public.erp_payroll_line_update(p_line uuid, p_days numeric, p_manual jsonb, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_payroll_lines; r public.erp_payroll_runs;
begin
  select * into l from public.erp_payroll_lines where id = p_line for update;
  if not found then raise exception 'Línea no encontrada.'; end if;
  select * into r from public.erp_payroll_runs where id = l.run_id for update;
  if not public.erp_can(r.store_id, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Esta nómina no es de tus puntos.'; end if;
  if r.status <> 'draft' then raise exception 'La nómina ya fue aprobada: no se puede editar.'; end if;
  if p_days is not null and (p_days < 0 or p_days > 30) then raise exception 'Los días deben estar entre 0 y 30.'; end if;
  if p_manual is not null and (jsonb_typeof(p_manual) <> 'object' or exists (select 1 from jsonb_each_text(p_manual) x where x.value::numeric < 0)) then raise exception 'Valores no válidos.'; end if;
  update public.erp_payroll_lines set days = coalesce(p_days, days), manual = coalesce(p_manual, manual), notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes) where id = l.id;
  perform public.erp__payroll_compute(l.id);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_payroll_line_update(uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.erp_payroll_line_update(uuid, numeric, jsonb, text) to authenticated;

create or replace function public.erp_payroll_transition(p_run uuid, p_action text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_payroll_runs; v_owner boolean; v_paid numeric;
begin
  select * into r from public.erp_payroll_runs where id = p_run for update;
  if not found then raise exception 'Nómina no encontrada.'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Esta nómina no es de tus puntos.'; end if;
  v_owner := exists (select 1 from public.stores s where s.id = r.store_id and s.owner_id = auth.uid());
  select coalesce(sum(amount), 0) into v_paid from public.erp_payroll_payments where run_id = r.id and not voided;
  if p_action = 'approve' then
    if not public.erp_can(r.store_id, 'payroll_approve') then raise exception 'Necesitas el permiso «Aprobar nómina».'; end if;
    if r.status <> 'draft' then raise exception 'Solo se aprueba una nómina en borrador.'; end if;
    if r.created_by = auth.uid() and not v_owner then raise exception 'Otra persona debe aprobar la nómina que tú preparaste.'; end if;
    update public.erp_payroll_runs set status = 'approved', approved_by = auth.uid(), approved_by_name = public.erp_actor_name(r.store_id), approved_at = now() where id = r.id;
  elsif p_action = 'reopen' then
    if not public.erp_can(r.store_id, 'payroll_approve') then raise exception 'Necesitas el permiso «Aprobar nómina».'; end if;
    if r.status <> 'approved' or v_paid > 0 then raise exception 'Solo se reabre una nómina aprobada sin pagos.'; end if;
    update public.erp_payroll_runs set status = 'draft', approved_by = null, approved_by_name = null, approved_at = null where id = r.id;
  elsif p_action = 'void' then
    if not public.erp_can(r.store_id, 'payroll_approve') and not (r.status = 'draft' and public.erp_can(r.store_id, 'payroll')) then raise exception 'No tienes permiso para anular esta nómina.'; end if;
    if r.status = 'void' then raise exception 'Ya está anulada.'; end if;
    if v_paid > 0 then raise exception 'Tiene pagos registrados: anúlalos primero.'; end if;
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
    update public.erp_payroll_runs set status = 'void', voided_by = auth.uid(), voided_by_name = public.erp_actor_name(r.store_id), voided_at = now(), void_reason = btrim(p_note) where id = r.id;
  else
    raise exception 'Acción no válida.';
  end if;
  perform public.erp_audit(r.store_id, 'payroll.' || p_action, 'erp_payroll_runs', r.id, jsonb_build_object('number', r.number, 'from', r.status, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', (select status from public.erp_payroll_runs where id = r.id));
end;
$$;
revoke all on function public.erp_payroll_transition(uuid, text, text) from public, anon;
grant execute on function public.erp_payroll_transition(uuid, text, text) to authenticated;

create or replace function public.erp__payroll_status(p_run uuid)
returns void language sql security definer set search_path = public as $$
  update public.erp_payroll_runs r set status = case
      when not exists (select 1 from public.erp_payroll_lines l where l.run_id = r.id and l.net > 0 and l.paid < l.net) then 'paid'
      when exists (select 1 from public.erp_payroll_lines l where l.run_id = r.id and l.paid > 0) then 'partial'
      else 'approved' end
  where r.id = p_run and r.status in ('approved', 'partial', 'paid');
$$;
revoke all on function public.erp__payroll_status(uuid) from public, anon, authenticated;

create or replace function public.erp_payroll_pay(p_line uuid, p_amount numeric, p_method text, p_reference text, p_paid_at timestamptz, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_payroll_lines; r public.erp_payroll_runs; p public.erp_payroll_payments; v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  select * into l from public.erp_payroll_lines where id = p_line for update;
  if not found then raise exception 'Línea no encontrada.'; end if;
  select * into r from public.erp_payroll_runs where id = l.run_id for update;
  if not public.erp_can(r.store_id, 'payroll_pay') then raise exception 'Necesitas el permiso «Pagar nómina».'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Esta nómina no es de tus puntos.'; end if;
  if char_length(coalesce(p_key, '')) < 8 then raise exception 'Falta la llave del pago.'; end if;
  select * into p from public.erp_payroll_payments where store_id = r.store_id and idempotency_key = p_key;
  if found then return jsonb_build_object('ok', true, 'already', true, 'payment_id', p.id); end if;
  if r.status not in ('approved', 'partial') then raise exception 'Solo se paga una nómina aprobada.'; end if;
  if v_amount <= 0 then raise exception 'Escribe un valor mayor a cero.'; end if;
  if v_amount > l.net - l.paid then raise exception 'El pago (%) supera el neto pendiente (%).', v_amount, l.net - l.paid; end if;
  insert into public.erp_payroll_payments (store_id, run_id, line_id, amount, method, reference, paid_at, idempotency_key, created_by, created_by_name)
  values (r.store_id, r.id, l.id, v_amount, coalesce(nullif(btrim(p_method), ''), 'transfer'), nullif(btrim(coalesce(p_reference, '')), ''),
          least(coalesce(p_paid_at, now()), now()), p_key, auth.uid(), public.erp_actor_name(r.store_id)) returning * into p;
  update public.erp_payroll_lines set paid = paid + v_amount where id = l.id;
  perform public.erp__payroll_status(r.id);
  perform public.erp_audit(r.store_id, 'payroll.payment', 'erp_payroll_runs', r.id, jsonb_build_object('number', r.number, 'employee_id', l.employee_id, 'amount', v_amount));
  return jsonb_build_object('ok', true, 'already', false, 'payment_id', p.id);
end;
$$;
revoke all on function public.erp_payroll_pay(uuid, numeric, text, text, timestamptz, text) from public, anon;
grant execute on function public.erp_payroll_pay(uuid, numeric, text, text, timestamptz, text) to authenticated;

create or replace function public.erp_payroll_payment_void(p_payment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.erp_payroll_payments; r public.erp_payroll_runs;
begin
  select * into p from public.erp_payroll_payments where id = p_payment for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  select * into r from public.erp_payroll_runs where id = p.run_id for update;
  if not public.erp_can(r.store_id, 'payroll_approve') then raise exception 'Necesitas el permiso «Aprobar nómina».'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Esta nómina no es de tus puntos.'; end if;
  if p.voided then raise exception 'Ya está anulado.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  update public.erp_payroll_payments set voided = true, voided_by = auth.uid(), voided_by_name = public.erp_actor_name(r.store_id), voided_at = now(), void_reason = btrim(p_reason) where id = p.id;
  update public.erp_payroll_lines set paid = paid - p.amount where id = p.line_id;
  perform public.erp__payroll_status(r.id);
  perform public.erp_audit(r.store_id, 'payroll.payment_voided', 'erp_payroll_runs', r.id, jsonb_build_object('amount', p.amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_payroll_payment_void(uuid, text) from public, anon;
grant execute on function public.erp_payroll_payment_void(uuid, text) to authenticated;

-- ================================================================ LECTURAS
create or replace function public.erp_finance_catalog(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_points uuid[] := public.erp_my_points(p_store); v_payroll boolean := public.erp_can(p_store, 'payroll') or public.erp_can(p_store, 'payroll_approve') or public.erp_can(p_store, 'payroll_pay');
begin
  if not (public.erp_can(p_store, 'expenses') or public.erp_can(p_store, 'expenses_pay') or public.erp_can(p_store, 'budgets') or v_payroll) then
    raise exception 'No tienes permiso para el módulo de gastos.';
  end if;
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order, c.name) from public.erp_expense_categories c where c.store_id = p_store), '[]'::jsonb),
    'recurring', coalesce((select jsonb_agg(to_jsonb(r) - 'created_by' order by r.active desc, r.description) from public.erp_recurring_expenses r
                           where r.store_id = p_store and (v_points is null or r.point_id = any (v_points))), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(to_jsonb(b) - 'updated_by') from public.erp_budgets b where b.store_id = p_store and (v_points is null or b.point_id = any (v_points))), '[]'::jsonb),
    'funds', coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object('balance', (select coalesce(sum(case when m.kind = 'in' then m.amount else -m.amount end), 0) from public.erp_reserve_moves m where m.fund_id = f.id and not m.voided),
                                                          'moves', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'amount', m.amount, 'note', m.note, 'moved_at', m.moved_at, 'by', m.created_by_name) order by m.moved_at desc), '[]'::jsonb)
                                                                    from (select * from public.erp_reserve_moves where fund_id = f.id and not voided order by moved_at desc limit 20) m))
                                        order by f.active desc, f.name)
                         from public.erp_reserve_funds f where f.store_id = p_store and (v_points is null or f.point_id = any (v_points))), '[]'::jsonb),
    'employees', case when v_payroll then coalesce((select jsonb_agg(to_jsonb(e) - 'created_by' order by e.active desc, e.full_name) from public.erp_employees e
                                                    where e.store_id = p_store and (v_points is null or e.point_id = any (v_points))), '[]'::jsonb) else null end,
    'concepts', case when v_payroll then coalesce((select jsonb_agg(to_jsonb(c) order by case c.kind when 'earning' then 1 when 'deduction' then 2 else 3 end, c.sort_order)
                                                   from public.erp_payroll_concepts c where c.store_id = p_store), '[]'::jsonb) else null end,
    'can', jsonb_build_object('expenses', public.erp_can(p_store, 'expenses'), 'pay', public.erp_can(p_store, 'expenses_pay'), 'budgets', public.erp_can(p_store, 'budgets'),
                              'payroll', public.erp_can(p_store, 'payroll'), 'payroll_approve', public.erp_can(p_store, 'payroll_approve'), 'payroll_pay', public.erp_can(p_store, 'payroll_pay'),
                              'profit', public.erp_can(p_store, 'profit_view'), 'madre', v_points is null),
    'my_points', to_jsonb(v_points)
  );
end;
$$;
revoke all on function public.erp_finance_catalog(uuid) from public, anon;
grant execute on function public.erp_finance_catalog(uuid) to authenticated;

create or replace function public.erp_payroll_runs_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_points uuid[] := public.erp_my_points(p_store);
begin
  if not (public.erp_can(p_store, 'payroll') or public.erp_can(p_store, 'payroll_approve') or public.erp_can(p_store, 'payroll_pay')) then raise exception 'Necesitas el permiso «Nómina».'; end if;
  return coalesce((select jsonb_agg(x order by x.period_start desc, x.number desc) from (
    select r.id, r.number, r.point_id, w.name as point_name, r.period_kind, r.period_start, r.period_end, r.status, r.earnings, r.deductions, r.net, r.employer_cost, r.total_cost,
           r.created_by_name, r.approved_by_name, (select count(*) from public.erp_payroll_lines l where l.run_id = r.id) as employees,
           (select coalesce(sum(l.paid), 0) from public.erp_payroll_lines l where l.run_id = r.id) as paid
    from public.erp_payroll_runs r left join public.erp_warehouses w on w.id = r.point_id
    where r.store_id = p_store and (v_points is null or r.point_id = any (v_points))
    order by r.period_start desc limit 120) x), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_payroll_runs_list(uuid) from public, anon;
grant execute on function public.erp_payroll_runs_list(uuid) to authenticated;

create or replace function public.erp_payroll_detail(p_run uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.erp_payroll_runs;
begin
  select * into r from public.erp_payroll_runs where id = p_run;
  if not found then raise exception 'Nómina no encontrada.'; end if;
  if not (public.erp_can(r.store_id, 'payroll') or public.erp_can(r.store_id, 'payroll_approve') or public.erp_can(r.store_id, 'payroll_pay')) then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Esta nómina no es de tus puntos.'; end if;
  return jsonb_build_object('run', to_jsonb(r) || jsonb_build_object('point_name', (select name from public.erp_warehouses where id = r.point_id)),
    'lines', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('full_name', e.full_name, 'document', e.document, 'position', e.position, 'bank_name', e.bank_name, 'bank_account', e.bank_account) order by e.full_name)
                       from public.erp_payroll_lines l join public.erp_employees e on e.id = l.employee_id where l.run_id = r.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'idempotency_key' order by p.paid_at desc) from public.erp_payroll_payments p where p.run_id = r.id), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_payroll_detail(uuid) from public, anon;
grant execute on function public.erp_payroll_detail(uuid) to authenticated;

-- Resumen: gastos, por pagar, presupuestos, nómina, reservas y ganancia neta estimada.
create or replace function public.erp_finance_overview(p_store uuid, p_point uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_points uuid[] := public.erp_my_points(p_store);
  v_payroll boolean := public.erp_can(p_store, 'payroll') or public.erp_can(p_store, 'payroll_approve') or public.erp_can(p_store, 'payroll_pay');
  v_profit boolean := public.erp_can(p_store, 'profit_view');
  v_exp jsonb; v_pay jsonb; v_gross numeric; v_budgets jsonb; v_upcoming jsonb;
begin
  if not (public.erp_can(p_store, 'expenses') or public.erp_can(p_store, 'expenses_pay') or public.erp_can(p_store, 'budgets') or v_payroll) then
    raise exception 'No tienes permiso para el módulo de gastos.';
  end if;
  if p_point is not null and not public.erp__scope_ok(p_store, p_point) then raise exception 'Solo puedes ver tus puntos.'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then raise exception 'El rango de fechas no es válido.'; end if;

  with e as (
    select x.*, c.name as cat, c.emoji, w.name as pname from public.erp_expenses x
    join public.erp_expense_categories c on c.id = x.category_id left join public.erp_warehouses w on w.id = x.point_id
    where x.store_id = p_store and x.status <> 'void'
      and (v_points is null or x.point_id = any (v_points)) and (p_point is null or x.point_id = p_point)
  )
  select jsonb_build_object(
    'incurred', coalesce((select sum(amount) from e where incurred_on between p_from and p_to), 0),
    'paid_in_period', coalesce((select sum(p.amount) from public.erp_expense_payments p join e on e.id = p.expense_id where not p.voided and p.paid_at::date between p_from and p_to), 0),
    'open', coalesce((select sum(amount - paid) from e where status in ('pending', 'partial')), 0),
    'overdue', coalesce((select sum(amount - paid) from e where status in ('pending', 'partial') and due_on < current_date), 0),
    'overdue_count', (select count(*) from e where status in ('pending', 'partial') and due_on < current_date),
    'by_category', coalesce((select jsonb_agg(x order by x.amount desc) from (select category_id, cat as name, emoji, sum(amount) as amount, count(*) as n from e where incurred_on between p_from and p_to group by category_id, cat, emoji) x), '[]'::jsonb),
    'by_point', coalesce((select jsonb_agg(x order by x.amount desc) from (select point_id, coalesce(pname, 'Madre (general)') as name, sum(amount) as amount from e where incurred_on between p_from and p_to group by point_id, pname) x), '[]'::jsonb)
  ) into v_exp;

  select coalesce(jsonb_agg(x order by x.due_on nulls last), '[]'::jsonb) into v_upcoming from (
    select x.id, x.number, x.description, x.payee_name, x.amount - x.paid as pending, x.due_on, x.point_id, c.emoji
    from public.erp_expenses x join public.erp_expense_categories c on c.id = x.category_id
    where x.store_id = p_store and x.status in ('pending', 'partial') and (v_points is null or x.point_id = any (v_points)) and (p_point is null or x.point_id = p_point)
      and coalesce(x.due_on, x.incurred_on) <= current_date + 30
    order by coalesce(x.due_on, x.incurred_on) limit 15) x;

  if v_payroll then
    select jsonb_build_object(
      'cost', coalesce(sum(r.total_cost) filter (where r.status <> 'draft'), 0), 'net', coalesce(sum(r.net) filter (where r.status <> 'draft'), 0),
      'employer', coalesce(sum(r.employer_cost) filter (where r.status <> 'draft'), 0), 'draft_cost', coalesce(sum(r.total_cost) filter (where r.status = 'draft'), 0),
      'pending', coalesce(sum(r.net - (select coalesce(sum(l.paid), 0) from public.erp_payroll_lines l where l.run_id = r.id)) filter (where r.status in ('approved', 'partial')), 0),
      'runs', count(*), 'drafts', count(*) filter (where r.status = 'draft'))
    into v_pay
    from public.erp_payroll_runs r
    where r.store_id = p_store and r.status <> 'void' and r.period_end between p_from and p_to
      and (v_points is null or r.point_id = any (v_points)) and (p_point is null or r.point_id = p_point);
  end if;

  -- Presupuestos del periodo actual (madre = consolidado de toda la tienda; punto = solo ese punto).
  select coalesce(jsonb_agg(x order by x.pct desc nulls last), '[]'::jsonb) into v_budgets from (
    select b.id, b.point_id, w.name as point_name, b.category_id, c.name as category_name, c.emoji, b.period, b.amount, win.start_on, win.end_on,
           coalesce((select sum(x.amount) from public.erp_expenses x where x.store_id = p_store and x.status <> 'void'
                     and x.incurred_on between win.start_on and win.end_on and (b.point_id is null or x.point_id = b.point_id)
                     and (b.category_id is null or x.category_id = b.category_id)), 0)
           + case when b.category_id is null or c.is_payroll then coalesce((select sum(r.total_cost) from public.erp_payroll_runs r where r.store_id = p_store and r.status in ('approved', 'partial', 'paid')
                     and r.period_end between win.start_on and win.end_on and (b.point_id is null or r.point_id = b.point_id)), 0) else 0 end as spent,
           null::numeric as pct
    from public.erp_budgets b
    left join public.erp_expense_categories c on c.id = b.category_id
    left join public.erp_warehouses w on w.id = b.point_id
    cross join lateral public.erp__period_window(b.period, current_date) win
    where b.store_id = p_store and b.active and (v_points is null or b.point_id = any (v_points)) and (p_point is null or b.point_id is not distinct from p_point)
  ) x;
  select coalesce(jsonb_agg(b || jsonb_build_object('pct', case when (b->>'amount')::numeric > 0 then round((b->>'spent')::numeric / (b->>'amount')::numeric * 100, 1) end)), '[]'::jsonb)
  into v_budgets from jsonb_array_elements(v_budgets) b;

  if v_profit then
    select coalesce(sum(f.profit), 0) into v_gross
    from public.erp_sale_finance f join public.orders o on o.id = f.order_id
    where f.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at)::date between p_from and p_to
      and (v_points is null or f.point_id = any (v_points)) and (p_point is null or f.point_id = p_point);
  end if;

  return jsonb_build_object('expenses', v_exp, 'upcoming', v_upcoming, 'payroll', v_pay, 'budgets', v_budgets,
    'gross_profit', v_gross,
    'net_profit', case when v_profit then v_gross - (v_exp->>'incurred')::numeric - coalesce((v_pay->>'cost')::numeric, 0) end,
    'net_includes_payroll', v_payroll,
    'funds', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'target', f.target,
                         'balance', (select coalesce(sum(case when m.kind = 'in' then m.amount else -m.amount end), 0) from public.erp_reserve_moves m where m.fund_id = f.id and not m.voided)))
                       from public.erp_reserve_funds f where f.store_id = p_store and f.active and (v_points is null or f.point_id = any (v_points)) and (p_point is null or f.point_id is not distinct from p_point)), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_finance_overview(uuid, uuid, date, date) from public, anon;
grant execute on function public.erp_finance_overview(uuid, uuid, date, date) to authenticated;

-- ================================================================ SOPORTES (almacenamiento privado)
-- Ruta: <tienda>/<madre | id del punto>/<gasto>/<archivo>. Se protege por permiso y por punto.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('expense-docs', 'expense-docs', false, 10485760)
    on conflict (id) do nothing;
    execute 'drop policy if exists expense_docs_select on storage.objects';
    execute 'drop policy if exists expense_docs_insert on storage.objects';
    execute 'drop policy if exists expense_docs_delete on storage.objects';
    execute $p$create policy expense_docs_select on storage.objects for select to authenticated using (
      bucket_id = 'expense-docs' and (public.erp_can(((storage.foldername(name))[1])::uuid, 'expenses') or public.erp_can(((storage.foldername(name))[1])::uuid, 'expenses_pay'))
      and public.erp__scope_ok(((storage.foldername(name))[1])::uuid, nullif((storage.foldername(name))[2], 'madre')::uuid))$p$;
    execute $p$create policy expense_docs_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'expense-docs' and public.erp_can(((storage.foldername(name))[1])::uuid, 'expenses')
      and public.erp__scope_ok(((storage.foldername(name))[1])::uuid, nullif((storage.foldername(name))[2], 'madre')::uuid))$p$;
    execute $p$create policy expense_docs_delete on storage.objects for delete to authenticated using (
      bucket_id = 'expense-docs' and public.erp_can(((storage.foldername(name))[1])::uuid, 'expenses')
      and public.erp__scope_ok(((storage.foldername(name))[1])::uuid, nullif((storage.foldername(name))[2], 'madre')::uuid))$p$;
  end if;
end $$;
-- La política de almacenamiento llama esta función con el usuario que sube el archivo.
grant execute on function public.erp__scope_ok(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
