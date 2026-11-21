-- =====================================================================
-- REMHUB · Reabrir una liquidación descartada o rechazada por error
--
-- erp_settlement_reopen(p_id, p_note): la liquidación vuelve a «calculada»
-- EXACTAMENTE como estaba (mismas ventas, gastos, anticipos, reparto y
-- valores: no se recalcula). Después se envía a revisión, se aprueba y se
-- paga como siempre (al aprobarla se hace el abono automático del costo).
--
-- Solo si nada de lo que tenía se usó después (así nada cuenta dos veces):
--   · no hay otra liquidación abierta en ese pozo;
--   · no hay una liquidación posterior del mismo pozo que siga vigente
--     (esa ya habría tomado las mismas ventas y gastos);
--   · sus anticipos siguen aprobados y no se descontaron en otra;
--   · no traía saldos de otra liquidación (si los traía, se prepara de nuevo).
-- Permiso: «Aprobar liquidaciones» (o el dueño). Motivo obligatorio y
-- auditoría con la decisión anterior.
-- No borra datos. No cambia permisos. Es idempotente.
-- =====================================================================

create or replace function public.erp_settlement_reopen(p_id uuid, p_note text)
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
                       'pool_total', s.pool_total));
  return jsonb_build_object('ok', true, 'status', 'calculated', 'number', s.number);
end;
$$;
revoke all on function public.erp_settlement_reopen(uuid, text) from public, anon;
grant execute on function public.erp_settlement_reopen(uuid, text) to authenticated;

notify pgrst, 'reload schema';
