-- =====================================================================
-- REMHUB · Vales y préstamos a empleados (se descuentan en la nómina)
--
--   · erp_employee_loans: un vale por PRODUCTOS (salen del inventario del
--     punto) o por DINERO (puede salir de la caja abierta del punto), con
--     cuotas, interés opcional (ninguno, % total o % mensual) y desde qué
--     fecha se empieza a descontar.
--   · Cada nómina calcula sola la cuota de cada vale activo (sin pasar lo
--     devengado). Se puede cambiar o saltar la cuota de esa nómina.
--   · El descuento se COBRA cuando la nómina se aprueba; si se reabre o se
--     anula, se devuelve al saldo del vale. También se puede abonar a mano
--     (efectivo, que entra a la caja del punto si está abierta).
--   · Anular un vale sin abonos devuelve los productos al inventario y el
--     dinero a la caja (si había salido de la caja y está abierta).
--   · Todo queda en la auditoría.
-- Permisos: «Nómina» crea, abona y pausa; «Aprobar nómina» anula.
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_employee_loans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  employee_id uuid not null references public.erp_employees(id),
  point_id uuid references public.erp_warehouses(id),
  number bigint not null,
  kind text not null check (kind in ('product', 'cash')),
  description text not null,
  items jsonb not null default '[]'::jsonb,       -- productos: [{product_id, name, sku, qty, price, cost}]
  principal numeric(14, 2) not null check (principal > 0),
  interest_mode text not null default 'none' check (interest_mode in ('none', 'total', 'monthly')),
  interest_pct numeric(6, 2) not null default 0 check (interest_pct >= 0 and interest_pct <= 100),
  interest numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,
  installments integer not null check (installments between 1 and 60),
  installment numeric(14, 2) not null check (installment > 0),
  start_on date not null,
  balance numeric(14, 2) not null,
  status text not null default 'active' check (status in ('active', 'paid', 'void')),
  paused boolean not null default false,
  from_cash boolean not null default false,
  cash_session_id uuid,
  notes text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  voided_by uuid, voided_by_name text, voided_at timestamptz, void_reason text
);
create unique index if not exists erp_employee_loans_number on public.erp_employee_loans (store_id, number);
create index if not exists erp_employee_loans_emp on public.erp_employee_loans (employee_id, status);
alter table public.erp_employee_loans enable row level security;
revoke all on public.erp_employee_loans from anon, authenticated;

create table if not exists public.erp_employee_loan_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  loan_id uuid not null references public.erp_employee_loans(id),
  amount numeric(14, 2) not null check (amount > 0),
  source text not null check (source in ('payroll', 'manual')),
  run_id uuid, line_id uuid,
  method text, note text,
  cash_session_id uuid,
  idempotency_key text,
  paid_at timestamptz not null default now(),
  created_by uuid, created_by_name text,
  voided boolean not null default false, voided_at timestamptz, voided_by_name text, void_reason text
);
create index if not exists erp_employee_loan_payments_loan on public.erp_employee_loan_payments (loan_id);
create index if not exists erp_employee_loan_payments_run on public.erp_employee_loan_payments (run_id);
create unique index if not exists erp_employee_loan_payments_key on public.erp_employee_loan_payments (store_id, idempotency_key) where idempotency_key is not null;
alter table public.erp_employee_loan_payments enable row level security;
revoke all on public.erp_employee_loan_payments from anon, authenticated;

-- Cuota de un vale cambiada (o en 0 = no descontar) solo en una nómina.
alter table public.erp_payroll_lines add column if not exists loan_overrides jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- ayudas
create or replace function public.erp__loan_refresh(p_loan uuid)
returns void language sql security definer set search_path = public as $$
  update public.erp_employee_loans l set
    balance = greatest(0, l.total - coalesce((select sum(p.amount) from public.erp_employee_loan_payments p where p.loan_id = l.id and not p.voided), 0)),
    status = case when l.status = 'void' then 'void'
                  when l.total - coalesce((select sum(p.amount) from public.erp_employee_loan_payments p where p.loan_id = l.id and not p.voided), 0) <= 0 then 'paid'
                  else 'active' end
  where l.id = p_loan;
$$;
revoke all on function public.erp__loan_refresh(uuid) from public, anon, authenticated;

-- Caja abierta del punto (o null).
create or replace function public.erp__open_cash(p_store uuid, p_point uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.id from public.erp_cash_sessions s where s.store_id = p_store and s.point_id = p_point and s.status = 'open' order by s.opened_at desc limit 1;
$$;
revoke all on function public.erp__open_cash(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- crear
create or replace function public.erp_employee_loan_create(p_store uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.erp_employees; v_id uuid := gen_random_uuid(); v_num bigint; v_kind text := p->>'kind';
  v_point uuid := nullif(p->>'point_id', '')::uuid; it jsonb; pr record; v_items jsonb := '[]'::jsonb;
  v_principal numeric := 0; v_qty integer; v_price numeric; v_n integer := coalesce((p->>'installments')::integer, 1);
  v_mode text := coalesce(nullif(p->>'interest_mode', ''), 'none'); v_pct numeric := coalesce((p->>'interest_pct')::numeric, 0);
  v_interest numeric := 0; v_total numeric; v_inst numeric; v_months numeric; v_session uuid; v_from_cash boolean := coalesce((p->>'from_cash')::boolean, false);
  v_desc text := nullif(btrim(coalesce(p->>'description', '')), ''); v_name text;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  select * into e from public.erp_employees where id = (p->>'employee_id')::uuid and store_id = p_store;
  if not found then raise exception 'Escoge el empleado.'; end if;
  if not e.active then raise exception 'Ese empleado está inactivo.'; end if;
  if not public.erp__scope_ok(p_store, e.point_id) then raise exception 'Ese empleado no es de tus puntos.'; end if;
  if v_kind not in ('product', 'cash') then raise exception 'Escoge si el vale es de productos o de dinero.'; end if;
  if v_n < 1 or v_n > 60 then raise exception 'Las cuotas van de 1 a 60.'; end if;
  if v_mode not in ('none', 'total', 'monthly') or v_pct < 0 or v_pct > 100 then raise exception 'Interés no válido.'; end if;
  if v_point is not null and not exists (select 1 from public.erp_warehouses w where w.id = v_point and w.store_id = p_store) then raise exception 'Ese punto no es de tu tienda.'; end if;
  if v_point is not null and not public.erp__scope_ok(p_store, v_point) then raise exception 'Ese punto no es de los tuyos.'; end if;

  if v_kind = 'product' then
    if v_point is null then raise exception 'Escoge el punto de donde salen los productos.'; end if;
    if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Agrega al menos un producto.'; end if;
    for it in select * from jsonb_array_elements(p->'items') loop
      v_qty := (it->>'qty')::integer; v_price := round(coalesce((it->>'price')::numeric, 0), 0);
      if coalesce(v_qty, 0) <= 0 then raise exception 'La cantidad debe ser mayor que cero.'; end if;
      if v_price < 0 then raise exception 'El precio no puede ser negativo.'; end if;
      select id, name, sku, coalesce(cost_price, 0) as cost into pr from public.products where id = (it->>'product_id')::uuid and store_id = p_store;
      if not found then raise exception 'Un producto no es de tu tienda.'; end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'sku', pr.sku, 'qty', v_qty, 'price', v_price, 'cost', pr.cost));
      v_principal := v_principal + v_qty * v_price;
    end loop;
    v_from_cash := false;
  else
    v_principal := round(coalesce((p->>'amount')::numeric, 0), 0);
    if v_from_cash then
      if v_point is null then raise exception 'Escoge el punto de cuya caja sale el dinero.'; end if;
      v_session := public.erp__open_cash(p_store, v_point);
      if v_session is null then raise exception 'La caja de ese punto está cerrada: ábrela o quita «Sale de la caja».'; end if;
    end if;
  end if;
  if v_principal <= 0 then raise exception 'El valor del vale debe ser mayor que cero.'; end if;

  -- Interés simple: % sobre el total, o % por mes durante el plazo (según cada cuánto le pagan).
  v_months := v_n * case e.pay_frequency when 'weekly' then 7.0 / 30 when 'biweekly' then 0.5 else 1 end;
  v_interest := case v_mode when 'total' then round(v_principal * v_pct / 100, 0) when 'monthly' then round(v_principal * v_pct / 100 * v_months, 0) else 0 end;
  v_total := v_principal + v_interest;
  v_inst := ceil(v_total / v_n);

  perform pg_advisory_xact_lock(hashtext('employee_loan:' || p_store::text));
  v_num := public.erp_next_number(p_store, 'employee_loan');
  v_name := public.erp_actor_name(p_store);
  v_desc := coalesce(v_desc, case when v_kind = 'product' then (select string_agg((x->>'qty') || ' × ' || (x->>'name'), ', ') from jsonb_array_elements(v_items) x) else 'Préstamo en dinero' end);
  insert into public.erp_employee_loans (id, store_id, employee_id, point_id, number, kind, description, items, principal, interest_mode, interest_pct, interest, total,
    installments, installment, start_on, balance, from_cash, cash_session_id, notes, created_by, created_by_name)
  values (v_id, p_store, e.id, coalesce(v_point, e.point_id), v_num, v_kind, left(v_desc, 300), v_items, v_principal, v_mode, v_pct, v_interest, v_total,
    v_n, v_inst, coalesce(nullif(p->>'start_on', '')::date, (now() at time zone 'America/Bogota')::date), v_total, v_from_cash, v_session,
    nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid(), v_name);

  if v_kind = 'product' then
    for it in select * from jsonb_array_elements(v_items) loop
      perform public.erp__move(p_store, v_point, (it->>'product_id')::uuid, -(it->>'qty')::integer, 'manual_out', 'employee_loan', v_id,
        (it->>'cost')::numeric, 'Vale #' || v_num || ' · ' || e.full_name, 'Vale de empleado', true);
    end loop;
  elsif v_session is not null then
    insert into public.erp_cash_moves (session_id, store_id, kind, amount, reason, created_by, created_by_name)
    values (v_session, p_store, 'out', v_principal, 'Préstamo a ' || e.full_name || ' (vale #' || v_num || ')', auth.uid(), v_name);
  end if;

  perform public.erp_audit(p_store, 'employee_loan.created', 'erp_employee_loans', v_id, jsonb_build_object('number', v_num, 'employee', e.full_name, 'kind', v_kind,
    'principal', v_principal, 'interest', v_interest, 'total', v_total, 'installments', v_n, 'from_cash', v_from_cash));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num, 'total', v_total, 'installment', v_inst);
end $$;
revoke all on function public.erp_employee_loan_create(uuid, jsonb) from public, anon;
grant execute on function public.erp_employee_loan_create(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- abono a mano
create or replace function public.erp_employee_loan_pay(p_loan uuid, p_amount numeric, p_method text, p_note text, p_to_cash boolean, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_employee_loans; v_amount numeric := round(coalesce(p_amount, 0), 0); v_session uuid; v_pid uuid; e public.erp_employees;
begin
  select * into l from public.erp_employee_loans where id = p_loan for update;
  if not found then raise exception 'Vale no encontrado.'; end if;
  if auth.uid() is null or not (public.erp_can(l.store_id, 'payroll') or public.erp_can(l.store_id, 'payroll_pay')) then raise exception 'Necesitas el permiso «Nómina».'; end if;
  select * into e from public.erp_employees where id = l.employee_id;
  if not public.erp__scope_ok(l.store_id, e.point_id) then raise exception 'Ese empleado no es de tus puntos.'; end if;
  if p_key is not null and exists (select 1 from public.erp_employee_loan_payments where store_id = l.store_id and idempotency_key = p_key) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if l.status <> 'active' then raise exception 'Este vale no tiene saldo por cobrar.'; end if;
  if v_amount <= 0 then raise exception 'Escribe un valor mayor que cero.'; end if;
  if v_amount > l.balance then raise exception 'El abono (%) supera el saldo (%).', v_amount, l.balance; end if;
  if coalesce(p_to_cash, false) then
    v_session := public.erp__open_cash(l.store_id, l.point_id);
    if v_session is null then raise exception 'La caja del punto está cerrada: ábrela o quita «Entra a la caja».'; end if;
    insert into public.erp_cash_moves (session_id, store_id, kind, amount, reason, created_by, created_by_name)
    values (v_session, l.store_id, 'in', v_amount, 'Abono vale #' || l.number || ' · ' || e.full_name, auth.uid(), public.erp_actor_name(l.store_id));
  end if;
  insert into public.erp_employee_loan_payments (store_id, loan_id, amount, source, method, note, cash_session_id, idempotency_key, created_by, created_by_name)
  values (l.store_id, l.id, v_amount, 'manual', coalesce(nullif(btrim(p_method), ''), 'cash'), nullif(btrim(coalesce(p_note, '')), ''), v_session, p_key, auth.uid(), public.erp_actor_name(l.store_id))
  returning id into v_pid;
  perform public.erp__loan_refresh(l.id);
  perform public.erp_audit(l.store_id, 'employee_loan.payment', 'erp_employee_loans', l.id, jsonb_build_object('number', l.number, 'amount', v_amount, 'to_cash', v_session is not null));
  return jsonb_build_object('ok', true, 'already', false, 'payment_id', v_pid);
end $$;
revoke all on function public.erp_employee_loan_pay(uuid, numeric, text, text, boolean, text) from public, anon;
grant execute on function public.erp_employee_loan_pay(uuid, numeric, text, text, boolean, text) to authenticated;

create or replace function public.erp_employee_loan_payment_void(p_payment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pm public.erp_employee_loan_payments; l public.erp_employee_loans;
begin
  select * into pm from public.erp_employee_loan_payments where id = p_payment for update;
  if not found then raise exception 'Abono no encontrado.'; end if;
  select * into l from public.erp_employee_loans where id = pm.loan_id for update;
  if auth.uid() is null or not public.erp_can(l.store_id, 'payroll_approve') then raise exception 'Necesitas el permiso «Aprobar nómina».'; end if;
  if pm.voided then raise exception 'Ya está anulado.'; end if;
  if pm.source = 'payroll' then raise exception 'Este descuento es de una nómina: para quitarlo, vuelve esa nómina a borrador.'; end if;
  if l.status = 'void' then raise exception 'El vale está anulado.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  update public.erp_employee_loan_payments set voided = true, voided_at = now(), voided_by_name = public.erp_actor_name(l.store_id), void_reason = btrim(p_reason) where id = pm.id;
  perform public.erp__loan_refresh(l.id);
  perform public.erp_audit(l.store_id, 'employee_loan.payment_void', 'erp_employee_loans', l.id, jsonb_build_object('number', l.number, 'amount', pm.amount, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_employee_loan_payment_void(uuid, text) from public, anon;
grant execute on function public.erp_employee_loan_payment_void(uuid, text) to authenticated;

-- ---------------------------------------------------------------- pausar / anular
create or replace function public.erp_employee_loan_pause(p_loan uuid, p_paused boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_employee_loans;
begin
  select * into l from public.erp_employee_loans where id = p_loan for update;
  if not found then raise exception 'Vale no encontrado.'; end if;
  if auth.uid() is null or not public.erp_can(l.store_id, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if l.status <> 'active' then raise exception 'Este vale no está activo.'; end if;
  update public.erp_employee_loans set paused = coalesce(p_paused, false) where id = l.id;
  perform public.erp_audit(l.store_id, case when p_paused then 'employee_loan.paused' else 'employee_loan.resumed' end, 'erp_employee_loans', l.id, jsonb_build_object('number', l.number));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_employee_loan_pause(uuid, boolean) from public, anon;
grant execute on function public.erp_employee_loan_pause(uuid, boolean) to authenticated;

create or replace function public.erp_employee_loan_void(p_loan uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_employee_loans; it jsonb; v_session uuid; v_cash_back boolean := false; e public.erp_employees;
begin
  select * into l from public.erp_employee_loans where id = p_loan for update;
  if not found then raise exception 'Vale no encontrado.'; end if;
  if auth.uid() is null or not public.erp_can(l.store_id, 'payroll_approve') then raise exception 'Necesitas el permiso «Aprobar nómina».'; end if;
  if l.status = 'void' then raise exception 'Ya está anulado.'; end if;
  if exists (select 1 from public.erp_employee_loan_payments where loan_id = l.id and not voided) then
    raise exception 'Este vale ya tiene abonos o descuentos de nómina: anúlalos primero (o vuelve la nómina a borrador).';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  select * into e from public.erp_employees where id = l.employee_id;
  if l.kind = 'product' then
    for it in select * from jsonb_array_elements(l.items) loop
      perform public.erp__move(l.store_id, l.point_id, (it->>'product_id')::uuid, (it->>'qty')::integer, 'manual_in', 'employee_loan', l.id,
        (it->>'cost')::numeric, 'Anulación vale #' || l.number || ' · ' || e.full_name, 'Vale de empleado anulado', true);
    end loop;
  elsif l.from_cash then
    v_session := public.erp__open_cash(l.store_id, l.point_id);
    if v_session is not null then
      insert into public.erp_cash_moves (session_id, store_id, kind, amount, reason, created_by, created_by_name)
      values (v_session, l.store_id, 'in', l.principal, 'Devolución préstamo anulado (vale #' || l.number || ')', auth.uid(), public.erp_actor_name(l.store_id));
      v_cash_back := true;
    end if;
  end if;
  update public.erp_employee_loans set status = 'void', balance = 0, voided_by = auth.uid(), voided_by_name = public.erp_actor_name(l.store_id), voided_at = now(), void_reason = btrim(p_reason) where id = l.id;
  perform public.erp_audit(l.store_id, 'employee_loan.void', 'erp_employee_loans', l.id, jsonb_build_object('number', l.number, 'reason', p_reason, 'cash_back', v_cash_back));
  return jsonb_build_object('ok', true, 'cash_back', v_cash_back, 'needs_cash_back', l.from_cash and not v_cash_back);
end $$;
revoke all on function public.erp_employee_loan_void(uuid, text) from public, anon;
grant execute on function public.erp_employee_loan_void(uuid, text) to authenticated;

-- ---------------------------------------------------------------- lista
create or replace function public.erp_employee_loans_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'payroll') or public.erp_can(p_store, 'payroll_approve') or public.erp_can(p_store, 'payroll_pay')) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas un permiso de nómina.');
  end if;
  return jsonb_build_object('ok', true, 'loans', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'number', l.number, 'employee_id', l.employee_id, 'employee', e.full_name, 'document', e.document, 'position', e.position,
      'pay_frequency', e.pay_frequency, 'base_salary', e.base_salary, 'point_id', l.point_id, 'point', w.name, 'kind', l.kind, 'description', l.description,
      'items', l.items, 'principal', l.principal, 'interest_mode', l.interest_mode, 'interest_pct', l.interest_pct, 'interest', l.interest, 'total', l.total,
      'installments', l.installments, 'installment', l.installment, 'start_on', l.start_on, 'balance', l.balance, 'status', l.status, 'paused', l.paused,
      'from_cash', l.from_cash, 'notes', l.notes, 'created_by_name', l.created_by_name, 'created_at', l.created_at, 'void_reason', l.void_reason,
      'paid_count', (select count(*) from public.erp_employee_loan_payments p where p.loan_id = l.id and not p.voided),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'source', p.source, 'method', p.method, 'note', p.note, 'paid_at', p.paid_at,
          'by', p.created_by_name, 'voided', p.voided, 'void_reason', p.void_reason, 'run_number', r.number) order by p.paid_at)
        from public.erp_employee_loan_payments p left join public.erp_payroll_runs r on r.id = p.run_id where p.loan_id = l.id), '[]'::jsonb)
    ) order by (l.status = 'active') desc, l.created_at desc)
    from public.erp_employee_loans l
    join public.erp_employees e on e.id = l.employee_id
    left join public.erp_warehouses w on w.id = l.point_id
    where l.store_id = p_store and public.erp__scope_ok(p_store, e.point_id)), '[]'::jsonb));
end $$;
revoke all on function public.erp_employee_loans_list(uuid) from public, anon;
grant execute on function public.erp_employee_loans_list(uuid) to authenticated;

-- ---------------------------------------------------------------- nómina
-- Igual que en 20261110, más las cuotas de los vales activos (sin pasar lo devengado).
create or replace function public.erp__payroll_compute(p_line uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.erp_payroll_lines; e public.erp_employees; run public.erp_payroll_runs; c record; ln record;
  v_items jsonb := '[]'::jsonb; v_earn numeric := 0; v_ibc numeric := 0; v_aux numeric := 0; v_ded numeric := 0; v_emp numeric := 0; v_amt numeric; v_override numeric;
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
  -- Vales y préstamos del empleado (20261240): la cuota de cada uno, sin pasar lo que queda por pagarle.
  if to_regclass('public.erp_employee_loans') is not null then
    for ln in
      select * from public.erp_employee_loans x
      where x.employee_id = e.id and x.status = 'active' and not x.paused and x.balance > 0 and x.start_on <= run.period_end
      order by x.created_at
    loop
      v_override := nullif(l.loan_overrides->>ln.id::text, '')::numeric;
      v_amt := greatest(0, least(coalesce(v_override, ln.installment), ln.balance, v_earn - v_ded));
      v_items := v_items || jsonb_build_array(jsonb_build_object('concept_id', 'loan:' || ln.id, 'code', 'VALE', 'name', 'Vale #' || ln.number || ' · ' || left(ln.description, 60),
        'kind', 'deduction', 'calc', 'loan', 'value', ln.installment, 'amount', v_amt, 'loan_id', ln.id, 'balance', ln.balance, 'override', v_override is not null));
      v_ded := v_ded + v_amt;
    end loop;
  end if;
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

-- Cambiar (o saltar con 0) la cuota de un vale solo en esta nómina. null = volver a la cuota normal.
create or replace function public.erp_payroll_loan_override(p_line uuid, p_loan uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_payroll_lines; r public.erp_payroll_runs; ln public.erp_employee_loans;
begin
  select * into l from public.erp_payroll_lines where id = p_line for update;
  if not found then raise exception 'Línea no encontrada.'; end if;
  select * into r from public.erp_payroll_runs where id = l.run_id for update;
  if not public.erp_can(r.store_id, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Esta nómina no es de tus puntos.'; end if;
  if r.status <> 'draft' then raise exception 'La nómina ya fue aprobada: no se puede editar.'; end if;
  select * into ln from public.erp_employee_loans where id = p_loan and employee_id = l.employee_id;
  if not found then raise exception 'Ese vale no es de este empleado.'; end if;
  if p_amount is not null and (p_amount < 0 or p_amount > ln.balance) then raise exception 'La cuota debe estar entre 0 y el saldo (%).', ln.balance; end if;
  update public.erp_payroll_lines set loan_overrides = case when p_amount is null then loan_overrides - p_loan::text else loan_overrides || jsonb_build_object(p_loan::text, round(p_amount, 0)) end
  where id = l.id;
  perform public.erp__payroll_compute(l.id);
  perform public.erp_audit(r.store_id, 'payroll.loan_override', 'erp_payroll_runs', r.id, jsonb_build_object('number', r.number, 'loan', ln.number, 'amount', p_amount));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_payroll_loan_override(uuid, uuid, numeric) from public, anon;
grant execute on function public.erp_payroll_loan_override(uuid, uuid, numeric) to authenticated;

-- Al aprobar la nómina se cobran las cuotas; al reabrirla o anularla se devuelven al saldo.
create or replace function public.erp__payroll_loans_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record; v_amt numeric; ln public.erp_employee_loans;
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'draft' and new.status = 'approved' then
    for it in
      select pl.id as line_id, x.value as item from public.erp_payroll_lines pl, jsonb_array_elements(pl.items) x
      where pl.run_id = new.id and x.value->>'calc' = 'loan' and coalesce((x.value->>'amount')::numeric, 0) > 0
    loop
      select * into ln from public.erp_employee_loans where id = (it.item->>'loan_id')::uuid for update;
      if not found or ln.status <> 'active' then continue; end if;
      v_amt := least((it.item->>'amount')::numeric, ln.balance);
      if v_amt <= 0 then continue; end if;
      insert into public.erp_employee_loan_payments (store_id, loan_id, amount, source, run_id, line_id, method, note, created_by, created_by_name)
      values (new.store_id, ln.id, v_amt, 'payroll', new.id, it.line_id, 'payroll', 'Nómina #' || new.number, auth.uid(), new.approved_by_name);
      perform public.erp__loan_refresh(ln.id);
    end loop;
  elsif old.status in ('approved', 'partial', 'paid') and new.status in ('draft', 'void') then
    for it in select distinct loan_id from public.erp_employee_loan_payments where run_id = new.id and not voided loop
      update public.erp_employee_loan_payments set voided = true, voided_at = now(), void_reason = case when new.status = 'void' then 'Nómina anulada' else 'Nómina vuelta a borrador' end
      where run_id = new.id and loan_id = it.loan_id and not voided;
      perform public.erp__loan_refresh(it.loan_id);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.erp__payroll_loans_sync() from public, anon, authenticated;
drop trigger if exists zz_payroll_loans_sync on public.erp_payroll_runs;
create trigger zz_payroll_loans_sync after update of status on public.erp_payroll_runs for each row execute function public.erp__payroll_loans_sync();

notify pgrst, 'reload schema';
