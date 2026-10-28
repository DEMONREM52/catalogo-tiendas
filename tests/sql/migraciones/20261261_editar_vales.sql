-- =====================================================================
-- REMHUB · Editar vales y préstamos a empleados (sobre 20261240)
--
--   · Se cambian productos, cantidades y precios, el valor prestado, las
--     cuotas, el interés, desde cuándo se descuenta, la descripción y
--     las notas de un vale ACTIVO.
--   · Productos: solo se mueve la diferencia en el inventario del mismo
--     punto (si lleva más, sale; si devuelve, entra).
--   · Préstamo que salió de la caja: la diferencia sale o entra a la caja
--     abierta del punto (si está cerrada y hay diferencia, no deja).
--   · Lo ya pagado se respeta: el total nuevo no puede quedar por debajo.
--   · NUEVO: las nóminas en BORRADOR del empleado se recalculan solas cada
--     vez que un vale se crea, se edita, se pausa o cambia su saldo. Antes,
--     un vale creado después de armar el borrador no se descontaba.
--   · Todo queda en la auditoría (antes y después).
-- Permiso: «Nómina». No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_employee_loan_update(p_loan uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.erp_employee_loans; e public.erp_employees; it jsonb; pr record; v_items jsonb := '[]'::jsonb; v_principal numeric := 0;
  v_qty integer; v_price numeric; v_n integer; v_mode text; v_pct numeric; v_months numeric; v_interest numeric; v_total numeric; v_paid numeric;
  v_session uuid; v_diff numeric; v_name text; v_desc text; d record;
begin
  select * into l from public.erp_employee_loans where id = p_loan for update;
  if not found then raise exception 'Vale no encontrado.'; end if;
  if auth.uid() is null or not public.erp_can(l.store_id, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  select * into e from public.erp_employees where id = l.employee_id;
  if not public.erp__scope_ok(l.store_id, e.point_id) then raise exception 'Ese empleado no es de tus puntos.'; end if;
  if l.status <> 'active' then raise exception 'Solo se edita un vale activo (este está %).', case l.status when 'paid' then 'pagado' else 'anulado' end; end if;

  v_n := coalesce((p->>'installments')::integer, l.installments);
  v_mode := coalesce(nullif(p->>'interest_mode', ''), l.interest_mode);
  v_pct := coalesce((p->>'interest_pct')::numeric, l.interest_pct);
  if v_n < 1 or v_n > 60 then raise exception 'Las cuotas van de 1 a 60.'; end if;
  if v_mode not in ('none', 'total', 'monthly') or v_pct < 0 or v_pct > 100 then raise exception 'Interés no válido.'; end if;
  v_paid := l.total - l.balance;
  v_name := public.erp_actor_name(l.store_id);

  if l.kind = 'product' then
    if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Agrega al menos un producto.'; end if;
    for it in select * from jsonb_array_elements(p->'items') loop
      v_qty := (it->>'qty')::integer; v_price := round(coalesce((it->>'price')::numeric, 0), 0);
      if coalesce(v_qty, 0) <= 0 then raise exception 'La cantidad debe ser mayor que cero.'; end if;
      if v_price < 0 then raise exception 'El precio no puede ser negativo.'; end if;
      select id, name, sku, coalesce(cost_price, 0) as cost into pr from public.products where id = (it->>'product_id')::uuid and store_id = l.store_id;
      if not found then raise exception 'Un producto no es de tu tienda.'; end if;
      if v_items @> jsonb_build_array(jsonb_build_object('product_id', pr.id)) then raise exception 'El producto «%» está repetido.', pr.name; end if;
      -- Lo que ya se llevó conserva su costo; lo nuevo, el costo de hoy.
      v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'sku', pr.sku, 'qty', v_qty, 'price', v_price,
        'cost', coalesce((select (x->>'cost')::numeric from jsonb_array_elements(l.items) x where x->>'product_id' = pr.id::text limit 1), pr.cost)));
      v_principal := v_principal + v_qty * v_price;
    end loop;
  else
    v_principal := round(coalesce((p->>'amount')::numeric, l.principal), 0);
  end if;
  if v_principal <= 0 then raise exception 'El valor del vale debe ser mayor que cero.'; end if;

  v_months := v_n * case e.pay_frequency when 'weekly' then 7.0 / 30 when 'biweekly' then 0.5 else 1 end;
  v_interest := case v_mode when 'total' then round(v_principal * v_pct / 100, 0) when 'monthly' then round(v_principal * v_pct / 100 * v_months, 0) else 0 end;
  v_total := v_principal + v_interest;
  if v_total < v_paid then raise exception 'Ya pagó % de este vale: el total no puede quedar en %.', v_paid, v_total; end if;

  -- Inventario: solo la diferencia por producto, en el punto de donde salió.
  if l.kind = 'product' then
    for d in
      select coalesce(n.pid, o.pid) as pid, coalesce(n.qty, 0) - coalesce(o.qty, 0) as delta, coalesce(n.cost, o.cost) as cost
      from (select (x->>'product_id')::uuid pid, (x->>'qty')::integer qty, (x->>'cost')::numeric cost from jsonb_array_elements(v_items) x) n
      full join (select (x->>'product_id')::uuid pid, (x->>'qty')::integer qty, (x->>'cost')::numeric cost from jsonb_array_elements(l.items) x) o on o.pid = n.pid
    loop
      if d.delta <> 0 then
        perform public.erp__move(l.store_id, l.point_id, d.pid, -d.delta, case when d.delta > 0 then 'manual_out' else 'manual_in' end, 'employee_loan', l.id,
          d.cost, 'Vale #' || l.number || ' editado · ' || e.full_name, 'Vale de empleado editado', true);
      end if;
    end loop;
  elsif l.from_cash and v_principal <> l.principal then
    v_diff := v_principal - l.principal;
    v_session := public.erp__open_cash(l.store_id, l.point_id);
    if v_session is null then raise exception 'La caja del punto está cerrada: ábrela para registrar la diferencia de %.', abs(v_diff); end if;
    insert into public.erp_cash_moves (session_id, store_id, kind, amount, reason, created_by, created_by_name)
    values (v_session, l.store_id, case when v_diff > 0 then 'out' else 'in' end, abs(v_diff),
      case when v_diff > 0 then 'Más préstamo a ' else 'Devolución de préstamo de ' end || e.full_name || ' (vale #' || l.number || ' editado)', auth.uid(), v_name);
  end if;

  v_desc := nullif(btrim(coalesce(p->>'description', '')), '');
  v_desc := coalesce(v_desc, case when l.kind = 'product' then (select string_agg((x->>'qty') || ' × ' || (x->>'name'), ', ') from jsonb_array_elements(v_items) x) else l.description end);
  update public.erp_employee_loans set
    items = case when l.kind = 'product' then v_items else items end,
    principal = v_principal, interest_mode = v_mode, interest_pct = v_pct, interest = v_interest, total = v_total,
    installments = v_n, installment = ceil(v_total / v_n),
    start_on = coalesce(nullif(p->>'start_on', '')::date, start_on),
    description = left(v_desc, 300),
    notes = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end
  where id = l.id;
  perform public.erp__loan_refresh(l.id);

  perform public.erp_audit(l.store_id, 'employee_loan.updated', 'erp_employee_loans', l.id, jsonb_build_object('number', l.number, 'employee', e.full_name,
    'before', jsonb_build_object('items', l.items, 'principal', l.principal, 'total', l.total, 'installments', l.installments, 'start_on', l.start_on),
    'after', jsonb_build_object('items', v_items, 'principal', v_principal, 'total', v_total, 'installments', v_n, 'start_on', coalesce(nullif(p->>'start_on', '')::date, l.start_on))));
  return jsonb_build_object('ok', true, 'id', l.id, 'total', v_total, 'installment', ceil(v_total / v_n), 'paid', v_paid);
end $$;
revoke all on function public.erp_employee_loan_update(uuid, jsonb) from public, anon;
grant execute on function public.erp_employee_loan_update(uuid, jsonb) to authenticated;

-- Las nóminas en borrador del empleado se recalculan cuando sus vales cambian (crear, editar, pausar, abonar).
create or replace function public.erp__loan_drafts_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare ln record;
begin
  for ln in
    select pl.id from public.erp_payroll_lines pl join public.erp_payroll_runs r on r.id = pl.run_id
    where pl.employee_id = new.employee_id and r.status = 'draft'
  loop
    begin
      perform public.erp__payroll_compute(ln.id);
    exception when others then null; -- una línea que ya estaba mal no impide guardar el vale
    end;
  end loop;
  return new;
end $$;
revoke all on function public.erp__loan_drafts_sync() from public, anon, authenticated;
drop trigger if exists zz_loan_drafts_sync on public.erp_employee_loans;
create trigger zz_loan_drafts_sync after insert or update of status, paused, balance, installment, start_on, total on public.erp_employee_loans
  for each row execute function public.erp__loan_drafts_sync();

notify pgrst, 'reload schema';
