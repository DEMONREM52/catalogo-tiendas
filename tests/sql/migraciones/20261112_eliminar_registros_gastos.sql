-- =====================================================================
-- REMHUB · Eliminar registros equivocados (gastos y nómina)
--
--   · Gasto fijo, empleado o reserva SIN movimientos → se borra de verdad.
--   · Con movimientos (gastos generados, nóminas, aportes) → se OCULTA
--     (deleted_at) y se conserva todo su historial y auditoría.
--   · Nómina en borrador → se puede eliminar (aún no tiene efectos).
--   · Los gastos «eliminados» quedan anulados y ya no aparecen en la lista
--     normal (se ven con el filtro «Anulados»).
--
-- Requiere 20261110. No borra datos con movimientos. Es idempotente.
-- =====================================================================

alter table public.erp_recurring_expenses add column if not exists deleted_at timestamptz;
alter table public.erp_employees add column if not exists deleted_at timestamptz;
alter table public.erp_reserve_funds add column if not exists deleted_at timestamptz;

create or replace function public.erp_recurring_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_recurring_expenses; v_used integer;
begin
  select * into r from public.erp_recurring_expenses where id = p_id for update;
  if not found then raise exception 'Gasto fijo no encontrado.'; end if;
  if not (public.erp_can(r.store_id, 'budgets') or public.erp_can(r.store_id, 'expenses')) then raise exception 'No tienes permiso.'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Este gasto fijo no es de tus puntos.'; end if;
  select count(*) into v_used from public.erp_expenses where recurring_id = r.id;
  if v_used = 0 then
    delete from public.erp_recurring_expenses where id = r.id;
  else
    update public.erp_recurring_expenses set active = false, deleted_at = now(), updated_at = now() where id = r.id;
  end if;
  perform public.erp_audit(r.store_id, 'recurring_expense.deleted', 'erp_recurring_expenses', r.id, jsonb_build_object('description', r.description, 'kept_history', v_used > 0, 'generated', v_used));
  return jsonb_build_object('ok', true, 'hidden', v_used > 0, 'generated', v_used);
end;
$$;
revoke all on function public.erp_recurring_delete(uuid) from public, anon;
grant execute on function public.erp_recurring_delete(uuid) to authenticated;

create or replace function public.erp_employee_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.erp_employees; v_used integer;
begin
  select * into e from public.erp_employees where id = p_id for update;
  if not found then raise exception 'Empleado no encontrado.'; end if;
  if not public.erp_can(e.store_id, 'payroll') then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if not public.erp__scope_ok(e.store_id, e.point_id) then raise exception 'Este empleado no es de tus puntos.'; end if;
  select count(*) into v_used from public.erp_payroll_lines where employee_id = e.id;
  if v_used = 0 then
    delete from public.erp_employees where id = e.id;
  else
    update public.erp_employees set active = false, deleted_at = now(), terminated_on = coalesce(terminated_on, current_date), updated_at = now() where id = e.id;
  end if;
  perform public.erp_audit(e.store_id, 'employee.deleted', 'erp_employees', e.id, jsonb_build_object('name', e.full_name, 'kept_history', v_used > 0));
  return jsonb_build_object('ok', true, 'hidden', v_used > 0);
end;
$$;
revoke all on function public.erp_employee_delete(uuid) from public, anon;
grant execute on function public.erp_employee_delete(uuid) to authenticated;

create or replace function public.erp_reserve_fund_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.erp_reserve_funds; v_moves integer; v_bal numeric;
begin
  select * into f from public.erp_reserve_funds where id = p_id for update;
  if not found then raise exception 'Reserva no encontrada.'; end if;
  if not public.erp_can(f.store_id, 'budgets') then raise exception 'Necesitas el permiso «Presupuestos».'; end if;
  if not public.erp__scope_ok(f.store_id, f.point_id) then raise exception 'Esta reserva no es de tus puntos.'; end if;
  select count(*), coalesce(sum(case when kind = 'in' then amount else -amount end), 0) into v_moves, v_bal
  from public.erp_reserve_moves where fund_id = f.id and not voided;
  if v_bal <> 0 then raise exception 'La reserva todavía tiene %. Retira el saldo antes de eliminarla.', v_bal; end if;
  if v_moves = 0 and not exists (select 1 from public.erp_reserve_moves where fund_id = f.id) then
    delete from public.erp_reserve_funds where id = f.id;
  else
    update public.erp_reserve_funds set active = false, deleted_at = now() where id = f.id;
  end if;
  perform public.erp_audit(f.store_id, 'reserve_fund.deleted', 'erp_reserve_funds', f.id, jsonb_build_object('name', f.name));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_reserve_fund_delete(uuid) from public, anon;
grant execute on function public.erp_reserve_fund_delete(uuid) to authenticated;

create or replace function public.erp_payroll_delete_draft(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.erp_payroll_runs;
begin
  select * into r from public.erp_payroll_runs where id = p_run for update;
  if not found then raise exception 'Nómina no encontrada.'; end if;
  if not (public.erp_can(r.store_id, 'payroll') or public.erp_can(r.store_id, 'payroll_approve')) then raise exception 'Necesitas el permiso «Nómina».'; end if;
  if not public.erp__scope_ok(r.store_id, r.point_id) then raise exception 'Esta nómina no es de tus puntos.'; end if;
  if r.status <> 'draft' then raise exception 'Solo se elimina una nómina en borrador. Si ya está aprobada, anúlala.'; end if;
  if exists (select 1 from public.erp_payroll_payments where run_id = r.id) then raise exception 'Tiene pagos registrados.'; end if;
  delete from public.erp_payroll_runs where id = r.id; -- las líneas se borran con ella
  perform public.erp_audit(r.store_id, 'payroll.draft_deleted', 'erp_payroll_runs', r.id, jsonb_build_object('number', r.number, 'start', r.period_start, 'end', r.period_end, 'net', r.net));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_payroll_delete_draft(uuid) from public, anon;
grant execute on function public.erp_payroll_delete_draft(uuid) to authenticated;

-- Lecturas sin lo eliminado (y la lista de gastos sin anulados, salvo que se pidan).
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
                           where r.store_id = p_store and r.deleted_at is null and (v_points is null or r.point_id = any (v_points))), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(to_jsonb(b) - 'updated_by') from public.erp_budgets b where b.store_id = p_store and (v_points is null or b.point_id = any (v_points))), '[]'::jsonb),
    'funds', coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object('balance', (select coalesce(sum(case when m.kind = 'in' then m.amount else -m.amount end), 0) from public.erp_reserve_moves m where m.fund_id = f.id and not m.voided),
                                                          'moves', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'amount', m.amount, 'note', m.note, 'moved_at', m.moved_at, 'by', m.created_by_name) order by m.moved_at desc), '[]'::jsonb)
                                                                    from (select * from public.erp_reserve_moves where fund_id = f.id and not voided order by moved_at desc limit 20) m))
                                        order by f.active desc, f.name)
                         from public.erp_reserve_funds f where f.store_id = p_store and f.deleted_at is null and (v_points is null or f.point_id = any (v_points))), '[]'::jsonb),
    'employees', case when v_payroll then coalesce((select jsonb_agg(to_jsonb(e) - 'created_by' order by e.active desc, e.full_name) from public.erp_employees e
                                                    where e.store_id = p_store and e.deleted_at is null and (v_points is null or e.point_id = any (v_points))), '[]'::jsonb) else null end,
    'concepts', case when v_payroll then coalesce((select jsonb_agg(to_jsonb(c) order by case c.kind when 'earning' then 1 when 'deduction' then 2 else 3 end, c.sort_order)
                                                   from public.erp_payroll_concepts c where c.store_id = p_store), '[]'::jsonb) else null end,
    'can', jsonb_build_object('expenses', public.erp_can(p_store, 'expenses'), 'pay', public.erp_can(p_store, 'expenses_pay'), 'budgets', public.erp_can(p_store, 'budgets'),
                              'payroll', public.erp_can(p_store, 'payroll'), 'payroll_approve', public.erp_can(p_store, 'payroll_approve'), 'payroll_pay', public.erp_can(p_store, 'payroll_pay'),
                              'profit', public.erp_can(p_store, 'profit_view'), 'madre', v_points is null),
    'my_points', to_jsonb(v_points)
  );
end;
$$;

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
        and ((coalesce(p_status, '') = '' and e.status <> 'void') or p_status = 'all' or (p_status = 'open' and e.status in ('pending', 'partial')) or (p_status = 'overdue' and e.status in ('pending', 'partial') and e.due_on < current_date) or e.status = p_status)
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

notify pgrst, 'reload schema';
