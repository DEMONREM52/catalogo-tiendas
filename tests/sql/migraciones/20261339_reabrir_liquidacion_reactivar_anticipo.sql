-- =====================================================================
-- REMHUB · Reabrir liquidación: reactivar el anticipo anulado por error
--
-- Igual que 20261338 y además, si el anticipo anulado NO tiene gemelo y
-- quien reabre lo pide (p_restore_advances = true), el anticipo vuelve a
-- «aprobado» y la liquidación queda exactamente como se calculó.
-- Caso real (#12 SEDE ZAMORA): el millón del anticipo #5 también se
-- registró a mano como abono en «Cuenta con puntos». Lo que sobra es ese
-- abono (al aprobar la liquidación, el costo completo se abona solo); por
-- eso la función avisa si encuentra un abono manual del mismo valor en ese
-- punto (cerca de la fecha) para anularlo allá.
-- Todo queda en auditoría. No borra datos. No cambia permisos.
-- =====================================================================

drop function if exists public.erp_settlement_reopen(uuid, text);

create or replace function public.erp_settlement_reopen(p_id uuid, p_note text, p_restore_advances boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.erp_settlements;
  v_owner boolean;
  v_note text := btrim(coalesce(p_note, ''));
  v_later record;
  v_adv text;
  au record;
  v_twin uuid;
  v_twins integer;
  v_swaps jsonb := '[]'::jsonb;
  v_dupes jsonb := '[]'::jsonb;
  av public.erp_settlement_advances;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  select * into s from public.erp_settlements where id = p_id for update;
  if not found then raise exception 'Liquidación no encontrada.'; end if;
  if not public.erp__pool_allowed(s.store_id, s.point_id) then raise exception 'No tienes acceso a este pozo.'; end if;
  v_owner := exists (select 1 from public.stores st where st.id = s.store_id and st.owner_id = auth.uid());
  if not (v_owner or public.erp_can(s.store_id, 'profit_settle_approve')) then
    raise exception 'Necesitas el permiso «Aprobar liquidaciones» para reabrir una liquidación.';
  end if;
  if s.status <> 'rejected' then raise exception 'Solo se reabre una liquidación rechazada o descartada.'; end if;
  if char_length(v_note) < 3 then raise exception 'Escribe el motivo.'; end if;

  if exists (select 1 from public.erp_settlements x where x.store_id = s.store_id and x.point_id is not distinct from s.point_id
             and x.status in ('calculated', 'review')) then
    raise exception 'Ya hay una liquidación abierta en este pozo: descártala primero o termínala.';
  end if;

  select x.number, x.status into v_later from public.erp_settlements x
  where x.store_id = s.store_id and x.point_id is not distinct from s.point_id and x.id <> s.id
    and x.created_at > s.created_at and x.status not in ('rejected', 'reverted')
  order by x.created_at limit 1;
  if v_later.number is not null then
    raise exception 'Después se hizo la liquidación #% (%), que ya tomó estas ventas. Reabrir la #% las contaría dos veces.',
      v_later.number, v_later.status, s.number;
  end if;

  -- Anticipos anulados (registrados dos veces): se cambia por su gemelo vigente si hay exactamente uno.
  for au in
    select uu.advance_id, a.number, a.amount, a.kind, a.point_id
    from public.erp_settlement_advance_uses uu join public.erp_settlement_advances a on a.id = uu.advance_id
    where uu.settlement_id = s.id and a.status = 'voided'
  loop
    select count(*), (array_agg(t.id order by abs(extract(epoch from (t.given_at - s.cutoff)))))[1] into v_twins, v_twin
    from public.erp_settlement_advances t
    where t.store_id = s.store_id and t.point_id is not distinct from au.point_id and t.id <> au.advance_id
      and t.status = 'approved' and t.amount = au.amount and t.kind is not distinct from au.kind
      and not exists (select 1 from public.erp_settlement_advance_uses u2 join public.erp_settlements x on x.id = u2.settlement_id
                      where u2.advance_id = t.id and x.status not in ('rejected', 'reverted'))
      and not exists (select 1 from public.erp_settlement_advance_uses u3 where u3.settlement_id = s.id and u3.advance_id = t.id);
    if v_twins = 1 then
      update public.erp_settlement_advance_uses set advance_id = v_twin where settlement_id = s.id and advance_id = au.advance_id;
      v_swaps := v_swaps || jsonb_build_object('voided', au.number, 'replaced_by', (select number from public.erp_settlement_advances where id = v_twin), 'amount', au.amount);
    elsif v_twins > 1 then
      raise exception 'El anticipo #% está anulado y hay % anticipos vigentes iguales (mismo valor): no sé cuál es su gemelo. Anula los que sobren y vuelve a intentar.', au.number, v_twins;
    elsif coalesce(p_restore_advances, false) then
      -- Sin gemelo y pedido expresamente: el anticipo vuelve a aprobado (queda el motivo de la anulación en auditoría).
      select * into av from public.erp_settlement_advances where id = au.advance_id for update;
      update public.erp_settlement_advances
         set status = 'approved', voided_by = null, voided_by_name = null, voided_at = null, void_reason = null
       where id = av.id;
      perform public.erp_audit(s.store_id, 'settlement.advance_restored', 'erp_settlement_advances', av.id,
        jsonb_build_object('number', av.number, 'amount', av.amount, 'settlement', s.number, 'previous_void_reason', av.void_reason,
                           'previous_voided_by', av.voided_by_name, 'previous_voided_at', av.voided_at, 'note', v_note));
      v_swaps := v_swaps || jsonb_build_object('restored', au.number, 'amount', au.amount);
      -- ¿Ese mismo dinero quedó también como abono manual en «Cuenta con puntos»? Se avisa para anularlo allá.
      if s.point_id is not null and to_regclass('public.erp_internal_payments') is not null then
        v_dupes := v_dupes || coalesce((
          select jsonb_agg(jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'paid_at', p.paid_at, 'note', p.note, 'reference', p.reference))
          from public.erp_internal_payments p
          where p.store_id = s.store_id and p.point_id = s.point_id and not p.voided and p.amount = au.amount
            and (to_jsonb(p)->>'settlement_id') is null
            and p.paid_at between (av.given_at at time zone 'America/Bogota')::date - 10 and (av.given_at at time zone 'America/Bogota')::date + 10), '[]'::jsonb);
      end if;
    else
      raise exception 'El anticipo #% está anulado y no hay otro igual (% vigente y sin usar) que lo reemplace. Si lo anulaste por error, reábrela reactivando el anticipo.', au.number, to_char(au.amount, 'FM$999G999G999');
    end if;
  end loop;

  select string_agg('#' || coalesce(a.number::text, left(a.id::text, 8)), ', ') into v_adv
  from public.erp_settlement_advance_uses u
  join public.erp_settlement_advances a on a.id = u.advance_id
  where u.settlement_id = s.id
    and (a.status <> 'approved'
         or exists (select 1 from public.erp_settlement_advance_uses u2 join public.erp_settlements x on x.id = u2.settlement_id
                    where u2.advance_id = u.advance_id and u2.settlement_id <> s.id and x.status not in ('rejected', 'reverted')));
  if v_adv is not null then
    raise exception 'Los anticipos % ya no están como cuando se calculó (se anularon o se descontaron en otra liquidación). Prepárala de nuevo.', v_adv;
  end if;

  if coalesce(s.carried_total, 0) <> 0 then
    raise exception 'Esta liquidación traía saldos de una liquidación anterior: prepárala de nuevo para que los vuelva a tomar.';
  end if;

  update public.erp_settlements
     set status = 'calculated', decided_by = null, decided_by_name = null, decided_at = null, decision_note = null,
         submitted_by = null, submitted_by_name = null, submitted_at = null
   where id = s.id;
  perform public.erp_audit(s.store_id, 'settlement.reopened', 'erp_settlements', s.id,
    jsonb_build_object('number', s.number, 'from', s.status, 'to', 'calculated', 'note', v_note,
                       'previous_decision', s.decision_note, 'previous_decided_by', s.decided_by_name, 'previous_decided_at', s.decided_at,
                       'pool_total', s.pool_total, 'advance_swaps', v_swaps, 'duplicate_payments', v_dupes));
  return jsonb_build_object('ok', true, 'status', 'calculated', 'number', s.number, 'advance_swaps', v_swaps, 'duplicate_payments', v_dupes);
end;
$$;
revoke all on function public.erp_settlement_reopen(uuid, text, boolean) from public, anon;
grant execute on function public.erp_settlement_reopen(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
