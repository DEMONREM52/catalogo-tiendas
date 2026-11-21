-- =====================================================================
-- REMHUB · Reabrir liquidación: anticipo anulado por duplicado
--
-- Igual que 20261337, con un caso más: si un anticipo que usaba la
-- liquidación se ANULÓ porque estaba registrado dos veces, se usa en su
-- lugar el otro registro (su gemelo): mismo punto, mismo tipo y mismo
-- valor, aprobado y sin descontar en ninguna liquidación vigente. Solo si
-- hay exactamente uno así; si no, no se reabre y dice por qué.
-- El cambio queda en la auditoría («qué anticipo reemplazó a cuál»).
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
  au record;
  v_twin uuid;
  v_twins integer;
  v_swaps jsonb := '[]'::jsonb;
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
    else
      raise exception 'El anticipo #% está anulado y no hay otro igual (% vigente y sin usar) que lo reemplace. Prepara la liquidación de nuevo.', au.number, to_char(au.amount, 'FM$999G999G999');
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
                       'pool_total', s.pool_total, 'advance_swaps', v_swaps));
  return jsonb_build_object('ok', true, 'status', 'calculated', 'number', s.number, 'advance_swaps', v_swaps);
end;
$$;
revoke all on function public.erp_settlement_reopen(uuid, text) from public, anon;
grant execute on function public.erp_settlement_reopen(uuid, text) to authenticated;

notify pgrst, 'reload schema';
