-- =====================================================================
-- 20261299 · Deuda del punto a costo, abono automático al liquidar y cuadre
--
-- Decisión del usuario (2026-11-08), SEDE ZAMORA como los demás puntos:
--   · La bodega cobra SOLO EL COSTO (% bodega 0) y toda la ganancia va al pozo del punto.
--   · Al aprobar una liquidación del pozo de un punto con crédito, el costo de la mercancía vendida
--     (merch_cost de la liquidación) se ABONA SOLO a la cuenta con la bodega. Si la liquidación se
--     revierte o rechaza, ese abono se anula solo.
--   · Si cambian los costos de la madre, todo se recalcula solo: el último costo ya revalúa la deuda
--     (20261293); ahora también al cambiar el % de la bodega del punto, de la tienda o una regla de %.
--   · «Cuadrar con el costo»: deja la deuda en lo que de verdad debe el punto hoy con este modelo:
--       mercancía que tiene a precio de bodega (= costo con % 0)
--     + costo de lo vendido que todavía no se liquida (pendiente + liquidación abierta).
--     Lo vendido y ya liquidado se da por pagado en esas liquidaciones. Una sola nota (crédito o cargo)
--     con el detalle, vista previa antes de aplicar y en la auditoría.
-- No borra datos. Es idempotente. Requiere 20261289, 20261293 y 20261295.
-- =====================================================================

alter table public.erp_settlements add column if not exists merch_cost numeric(14, 2);
alter table public.erp_internal_payments add column if not exists settlement_id uuid references public.erp_settlements(id);
create unique index if not exists erp_internal_payments_settlement on public.erp_internal_payments (settlement_id) where settlement_id is not null and not voided;
alter table public.erp_internal_docs add column if not exists reconcile_detail jsonb;

-- ---------------------------------------------------------------- abono automático al liquidar
create or replace function public.erp__settlement_internal_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ok_new boolean := new.status in ('approved', 'partially_paid', 'paid');
        v_ok_old boolean := old.status in ('approved', 'partially_paid', 'paid');
begin
  if new.point_id is null then return null; end if;
  if v_ok_new and not v_ok_old then
    if coalesce(new.merch_cost, 0) > 0
       and exists (select 1 from public.erp_internal_points ip where ip.store_id = new.store_id and ip.point_id = new.point_id and ip.enabled)
       and not exists (select 1 from public.erp_internal_payments pm where pm.settlement_id = new.id and not pm.voided) then
      insert into public.erp_internal_payments (store_id, point_id, creditor_id, amount, method, reference, paid_at, note, settlement_id, created_by, created_by_name)
      values (new.store_id, new.point_id, public.erp__internal_default_creditor(new.store_id), round(new.merch_cost, 2), 'other',
              'Liquidación #' || new.number, public.erp__internal_today(),
              'Abono automático: costo de la mercancía vendida en la liquidación #' || new.number,
              new.id, auth.uid(), coalesce(new.decided_by_name, 'Automático'));
      perform public.erp_audit(new.store_id, 'internal.payment_from_settlement', 'erp_settlements', new.id,
        jsonb_build_object('point_id', new.point_id, 'amount', new.merch_cost, 'settlement_number', new.number));
    end if;
  elsif v_ok_old and not v_ok_new then
    update public.erp_internal_payments set voided = true, void_reason = 'La liquidación #' || new.number || ' quedó ' || new.status,
           voided_at = now(), voided_by = auth.uid()
    where settlement_id = new.id and not voided;
  end if;
  return null;
end $$;
revoke all on function public.erp__settlement_internal_payment() from public, anon, authenticated;
drop trigger if exists erp_settlements_internal_payment on public.erp_settlements;
create trigger erp_settlements_internal_payment after update of status on public.erp_settlements
  for each row execute function public.erp__settlement_internal_payment();

-- ---------------------------------------------------------------- recalcular al cambiar el %
create or replace function public.erp__internal_pct_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_point uuid; v_products uuid[];
begin
  if tg_table_name = 'erp_internal_points' then
    if new.pct is not distinct from old.pct then return null; end if;
    v_store := new.store_id; v_point := new.point_id;
  elsif tg_table_name = 'erp_internal_settings' then
    if new.default_pct is not distinct from old.default_pct and new.round_step is not distinct from old.round_step then return null; end if;
    v_store := new.store_id;
  else -- erp_internal_pct_rules
    v_store := coalesce(new.store_id, old.store_id);
    if coalesce(new.product_id, old.product_id) is not null then
      v_products := array[coalesce(new.product_id, old.product_id)];
    else
      select array_agg(p.id) into v_products from public.products p
      where p.store_id = v_store and p.category_id in (new.category_id, old.category_id);
      if v_products is null then return null; end if;
    end if;
  end if;
  perform public.erp__internal_revalue(v_store, v_products, v_point, 'auto', 'cambió el % de la bodega');
  return null;
end $$;
revoke all on function public.erp__internal_pct_changed() from public, anon, authenticated;
drop trigger if exists erp_internal_points_pct_reval on public.erp_internal_points;
create trigger erp_internal_points_pct_reval after update of pct on public.erp_internal_points
  for each row execute function public.erp__internal_pct_changed();
drop trigger if exists erp_internal_settings_pct_reval on public.erp_internal_settings;
create trigger erp_internal_settings_pct_reval after update on public.erp_internal_settings
  for each row execute function public.erp__internal_pct_changed();
drop trigger if exists erp_internal_pct_rules_reval on public.erp_internal_pct_rules;
create trigger erp_internal_pct_rules_reval after insert or update or delete on public.erp_internal_pct_rules
  for each row execute function public.erp__internal_pct_changed();

-- ---------------------------------------------------------------- cuadrar con el costo
create or replace function public.erp_internal_reconcile(p_store uuid, p_point uuid, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ip public.erp_internal_points; v_balance numeric; v_stock numeric; v_stock_cost numeric; v_pending numeric := 0; v_open numeric := 0;
        v_target numeric; v_diff numeric; v_id uuid; v_settled numeric; v_detail jsonb; v_pct_lines integer;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» cuadra la deuda.'; end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;
  if not found or not ip.enabled then raise exception 'Primero activa el crédito para ese punto.'; end if;

  -- Primero se pone al día el precio de bodega de lo que tiene (último costo y % actual).
  if coalesce(p_apply, false) then
    perform public.erp__internal_revalue(p_store, null, p_point, 'manual', 'cuadre con el costo');
  end if;
  select count(*) into v_pct_lines from public.erp__internal_reval_lines(p_store, null, p_point);

  v_balance := public.erp__internal_balance(p_store, p_point);
  -- Mercancía que tiene, al precio de bodega que tendría después de revaluar.
  select coalesce(sum(l.qty * coalesce(
           case when coalesce(p.last_cost, 0) > 0
                then public.erp__round_up(p.last_cost * (1 + public.erp__internal_pct(p_store, p_point, p.id) / 100),
                                          (public.erp__internal_settings(p_store)).round_step) end,
           (select c.avg_cost from public.erp_point_costs c where c.point_id = p_point and c.product_id = p.id and c.avg_cost > 0),
           public.erp__internal_unit(p_store, p_point, p.id), 0)), 0)
  into v_stock
  from public.erp_stock_levels l join public.products p on p.id = l.product_id and p.store_id = p_store
  where l.warehouse_id = p_point and l.qty > 0;
  v_stock_cost := public.erp__point_stock_cost(p_store, p_point);

  -- Costo de lo vendido que todavía no se liquida.
  begin
    v_pending := coalesce((public.erp__settlement_compute(p_store, p_point, now())->>'merch_cost')::numeric, 0);
  exception when others then v_pending := 0;
  end;
  select coalesce(sum(merch_cost), 0) into v_open from public.erp_settlements
  where store_id = p_store and point_id = p_point and status in ('calculated', 'review');
  select coalesce(sum(merch_cost), 0) into v_settled from public.erp_settlements
  where store_id = p_store and point_id = p_point and status in ('approved', 'partially_paid', 'paid')
    and not exists (select 1 from public.erp_internal_payments pm where pm.settlement_id = erp_settlements.id and not pm.voided);

  v_target := round(v_stock + greatest(v_pending, 0) + greatest(v_open, 0), 2);
  v_diff := round(v_target - v_balance, 2);
  v_detail := jsonb_build_object('balance_before', v_balance, 'stock', v_stock, 'stock_cost', v_stock_cost, 'pending_cost', v_pending,
                                 'open_settlement_cost', v_open, 'settled_cost_without_payment', v_settled, 'target', v_target, 'diff', v_diff,
                                 'pct', public.erp__internal_pct(p_store, p_point, null), 'reval_lines', v_pct_lines);

  if not coalesce(p_apply, false) then
    return jsonb_build_object('ok', true, 'applied', false) || v_detail;
  end if;
  if abs(v_diff) < 1 then
    return jsonb_build_object('ok', true, 'applied', false, 'nothing', true) || v_detail;
  end if;

  insert into public.erp_internal_docs (store_id, point_id, creditor_id, number, kind, sign, amount, cost_amount, due_date, note, reconcile_detail, created_by, created_by_name)
  values (p_store, p_point, public.erp__internal_default_creditor(p_store), public.erp_next_number(p_store, 'internal_doc'),
          case when v_diff < 0 then 'credit' else 'charge' end, case when v_diff < 0 then -1 else 1 end, abs(v_diff), 0,
          case when v_diff > 0 then public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days) end,
          left('Cuadre con el costo: mercancía en el punto ' || to_char(v_stock, 'FM999G999G999G990') || ' + vendido sin liquidar '
               || to_char(greatest(v_pending, 0) + greatest(v_open, 0), 'FM999G999G999G990') || ' (lo ya liquidado se da por pagado)', 300),
          v_detail, auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.reconcile', 'erp_internal_docs', v_id, v_detail || jsonb_build_object('point_id', p_point));
  return jsonb_build_object('ok', true, 'applied', true, 'doc_id', v_id, 'balance_after', public.erp__internal_balance(p_store, p_point)) || v_detail;
end $$;
revoke all on function public.erp_internal_reconcile(uuid, uuid, boolean) from public, anon;
grant execute on function public.erp_internal_reconcile(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
