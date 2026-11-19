-- =====================================================================
-- REMHUB · Flujo de caja de los próximos 30 días (proyección)
--
-- Reglas que eligió el dueño (18/11/2026):
--   SALE  · cuentas por pagar a proveedores que vencen (saldo abierto)
--         · gastos por pagar ya registrados (saldo) y gastos fijos que
--           todavía no se han generado, en su fecha de pago
--         · nómina: lo que falta pagar de las nóminas aprobadas, las que
--           están en borrador, y para los periodos que aún no tienen
--           nómina, el salario base de los empleados activos (estimado)
--   ENTRA · ventas promedio: lo vendido las últimas 4 semanas, por día de
--           la semana (lunes con los lunes…), ÷ 4
--         · cartera: saldos de clientes a crédito que vencen esos días
--   Las dos entradas se devuelven por separado. Lo vencido se muestra
--   aparte (no se sabe qué día se va a pagar).
--
-- Es solo una proyección: no cambia datos. La ve solo el dueño o el
-- administrador de la tienda (erp__store_boss, 20261325). Idempotente.
-- =====================================================================

-- Dueño o administrador de la tienda (igual que 20261325; se repite por si esta se corre sola).
create or replace function public.erp__store_boss(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su
               where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role = 'store_admin'))
$$;
revoke all on function public.erp__store_boss(uuid) from public, anon, authenticated;

-- Fechas en que toca un gasto fijo entre dos fechas (misma regla que erp_expenses_generate de 20261110).
create or replace function public.erp__recurring_dates(p_id uuid, p_from date, p_to date)
returns setof date language sql stable security definer set search_path = public as $$
  with r as (select * from public.erp_recurring_expenses where id = p_id),
  lim as (select r.*, least(p_to, coalesce(r.ends_on, p_to)) as until from r)
  select distinct x::date from lim, lateral (
    select generate_series(lim.starts_on, lim.until, interval '7 days') as x where lim.frequency = 'weekly'
    union all select generate_series(lim.starts_on, lim.until, interval '14 days') where lim.frequency = 'biweekly'
    union all select (m + interval '14 days') from generate_series(date_trunc('month', lim.starts_on), lim.until, interval '1 month') m where lim.frequency = 'semimonthly'
    union all select (m + interval '1 month - 1 day') from generate_series(date_trunc('month', lim.starts_on), lim.until, interval '1 month') m where lim.frequency = 'semimonthly'
    union all select (m + make_interval(days => least(lim.day_of_month, extract(day from (m + interval '1 month - 1 day'))::integer) - 1))
      from generate_series(date_trunc('month', lim.starts_on), lim.until,
                           case lim.frequency when 'monthly' then interval '1 month' when 'bimonthly' then interval '2 months'
                                              when 'quarterly' then interval '3 months' else interval '1 year' end) m
      where lim.frequency in ('monthly', 'bimonthly', 'quarterly', 'yearly')
  ) q
  where x::date between greatest(p_from, lim.starts_on) and lim.until
$$;
revoke all on function public.erp__recurring_dates(uuid, date, date) from public, anon, authenticated;

create or replace function public.erp_cash_flow(p_store uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_to date;
  v_out jsonb;
begin
  if auth.uid() is null or not public.erp__store_boss(p_store) then
    return jsonb_build_object('ok', false, 'message', 'El flujo de caja lo ve solo el dueño o el administrador de la tienda.');
  end if;
  v_to := v_today + v_days - 1;

  with
  days as (select d::date as day from generate_series(v_today, v_to, interval '1 day') d),
  -- ENTRA · ventas promedio por día de la semana (últimas 4 semanas completas, sin hoy).
  sales as (
    select extract(isodow from (coalesce(o.confirmed_at, o.created_at) at time zone 'America/Bogota'))::integer as dow, sum(o.total) as total
    from public.orders o
    where o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= ((v_today - 28)::timestamp at time zone 'America/Bogota')
      and coalesce(o.confirmed_at, o.created_at) < (v_today::timestamp at time zone 'America/Bogota')
    group by 1
  ),
  avg_dow as (select g.dow, round(coalesce(s.total, 0) / 4.0, 0) as avg from generate_series(1, 7) g(dow) left join sales s on s.dow = g.dow),
  -- ENTRA · cartera que vence.
  recv as (
    select r.id, coalesce(c.name, 'Cliente') as name, r.due_date as due, r.balance as amount
    from public.erp_receivables r left join public.billing_customers c on c.id = r.customer_id
    where r.store_id = p_store and coalesce(r.status, 'open') not in ('void', 'paid') and coalesce(r.balance, 0) > 0
  ),
  -- SALE · proveedores.
  pay as (
    select ap.id, s.name, coalesce(ap.due_date, v_today) as due, ap.balance as amount, ap.due_date is null as no_date
    from public.erp_payables ap join public.erp_suppliers s on s.id = ap.supplier_id
    where ap.store_id = p_store and ap.status = 'open' and ap.balance > 0
  ),
  -- SALE · gastos ya registrados por pagar.
  exp as (
    select e.id, e.description as name, coalesce(e.due_on, e.incurred_on) as due, e.amount - e.paid as amount
    from public.erp_expenses e
    where e.store_id = p_store and e.status in ('pending', 'partial') and e.amount > e.paid
  ),
  -- SALE · gastos fijos que todavía no existen como gasto (los que ya se generaron están en «exp»).
  rec as (
    select r.id, r.description as name, (d + r.due_days) as due, r.amount
    from public.erp_recurring_expenses r
    cross join lateral public.erp__recurring_dates(r.id, v_today - 120, v_to) d
    where r.store_id = p_store and r.active
      and (d + r.due_days) between v_today and v_to
      and not exists (select 1 from public.erp_expenses e where e.recurring_id = r.id and e.period_key = d::text)
  ),
  -- SALE · nóminas existentes sin pagar del todo (aprobadas o en borrador).
  runs as (
    select pr.id, pr.number, pr.status, pr.period_kind, pr.period_end, pr.net
      - coalesce((select sum(pp.amount) from public.erp_payroll_payments pp where pp.run_id = pr.id and not pp.voided), 0) as amount
    from public.erp_payroll_runs pr
    where pr.store_id = p_store and pr.status in ('draft', 'approved', 'partial')
  ),
  -- SALE · nómina estimada de los periodos que aún no tienen nómina (salario base de los activos).
  ends as (
    select 'monthly'::text as kind, (date_trunc('month', day) + interval '1 month - 1 day')::date as pend, 30 as days from days
    union select 'biweekly', case when extract(day from day) <= 15 then (date_trunc('month', day) + interval '14 days')::date
                                  else (date_trunc('month', day) + interval '1 month - 1 day')::date end, 15 from days
    union select 'weekly', (day + ((7 - extract(isodow from day)::integer) % 7))::date, 7 from days
  ),
  est as (
    select e.kind, e.pend as due, round(sum(emp.base_salary) * e.days / 30.0, 0) as amount, count(*) as people
    from (select distinct kind, pend, days from ends where pend between v_today and v_to) e
    join public.erp_employees emp on emp.store_id = p_store and emp.active and emp.pay_frequency = e.kind
      and (emp.hired_on is null or emp.hired_on <= e.pend) and (emp.terminated_on is null or emp.terminated_on >= e.pend)
    where not exists (select 1 from public.erp_payroll_runs pr where pr.store_id = p_store and pr.status <> 'void'
                        and pr.period_kind = e.kind and pr.period_end = e.pend)
    group by e.kind, e.pend, e.days
  ),
  per_day as (
    select d.day,
      (select a.avg from avg_dow a where a.dow = extract(isodow from d.day)::integer) as in_sales,
      coalesce((select sum(amount) from recv where due = d.day), 0) as in_receivables,
      coalesce((select sum(amount) from pay where due = d.day), 0) as out_payables,
      coalesce((select sum(amount) from exp where due = d.day), 0) + coalesce((select sum(amount) from rec where due = d.day), 0) as out_expenses,
      coalesce((select sum(amount) from runs where period_end = d.day and amount > 0), 0) + coalesce((select sum(amount) from est where due = d.day), 0) as out_payroll
    from days d
  )
  select jsonb_build_object(
    'ok', true, 'from', v_today, 'to', v_to,
    'sales_basis', jsonb_build_object('from', v_today - 28, 'to', v_today - 1,
      'by_weekday', (select jsonb_agg(jsonb_build_object('dow', dow, 'avg', avg) order by dow) from avg_dow)),
    'days', (select jsonb_agg(jsonb_build_object('day', day, 'in_sales', in_sales, 'in_receivables', in_receivables,
                      'out_payables', out_payables, 'out_expenses', out_expenses, 'out_payroll', out_payroll) order by day) from per_day),
    'overdue', jsonb_build_object(
      'receivables', coalesce((select sum(amount) from recv where due < v_today), 0),
      'payables', coalesce((select sum(amount) from pay where due < v_today), 0),
      'expenses', coalesce((select sum(amount) from exp where due < v_today), 0),
      'payroll', coalesce((select sum(amount) from runs where period_end < v_today and amount > 0), 0)),
    'items', jsonb_build_object(
      'payables', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'due', due, 'amount', amount, 'no_date', no_date) order by due, amount desc)
                            from pay where due <= v_to), '[]'::jsonb),
      'expenses', coalesce((select jsonb_agg(x order by x->>'due') from (
                    select jsonb_build_object('name', name, 'due', due, 'amount', amount, 'fixed', false) as x from exp where due <= v_to
                    union all select jsonb_build_object('name', name, 'due', due, 'amount', amount, 'fixed', true) from rec) z), '[]'::jsonb),
      'payroll', coalesce((select jsonb_agg(x order by x->>'due') from (
                    select jsonb_build_object('name', 'Nómina N.º ' || number || case when status = 'draft' then ' (borrador)' else '' end,
                                              'due', period_end, 'amount', amount, 'estimated', false) as x from runs where amount > 0 and period_end <= v_to
                    union all select jsonb_build_object('name', 'Nómina estimada (' || people || ' persona' || case when people = 1 then '' else 's' end || ', salario base)',
                                              'due', due, 'amount', amount, 'estimated', true) from est) z), '[]'::jsonb),
      'receivables', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'due', due, 'amount', amount) order by due, amount desc)
                               from recv where due is not null and due <= v_to), '[]'::jsonb))
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.erp_cash_flow(uuid, integer) from public, anon;
grant execute on function public.erp_cash_flow(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
