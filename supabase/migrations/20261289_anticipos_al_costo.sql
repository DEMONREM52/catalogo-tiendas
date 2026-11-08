-- =====================================================================
-- 20261289 · Los ANTICIPOS se abonan al costo de la mercancía
--
-- Decisión del usuario (2026-11-08): un anticipo es dinero que la sede ya entregó para pagar la
-- mercancía. Se abona al COSTO de la mercancía vendida en la liquidación y NO toca la ganancia de los
-- beneficiarios. Ej.: costo $4.041.198 − anticipo $1.350.000 = la sede aún debe entregar $2.691.198;
-- la ganancia ($1.361.801) se reparte completa (menos los gastos).
-- Si el anticipo es mayor que el costo de la liquidación, lo que sobra se abona en la siguiente.
-- Los GASTOS compartidos (20261288) siguen restándose de la ganancia según su reparto.
--
-- Las liquidaciones ya aprobadas no cambian. Parte de 20261288. No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_settlements add column if not exists merch_cost numeric(14, 2);
alter table public.erp_settlements add column if not exists cost_advances_total numeric(14, 2) not null default 0;
alter table public.erp_settlements add column if not exists cost_due numeric(14, 2);

-- Por descontar, con lo que le queda a cada uno (un anticipo puede abonarse en varias liquidaciones).
drop function if exists public.erp__pool_advances(uuid, uuid, timestamptz);
create or replace function public.erp__pool_advances(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns table (advance_id uuid, beneficiary_id uuid, amount numeric, remaining numeric, given_at timestamptz, number bigint, note text, kind text, split text, shares jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select a.id, a.beneficiary_id, a.amount,
           a.amount - coalesce((select sum(u.amount) from public.erp_settlement_advance_uses u join public.erp_settlements st on st.id = u.settlement_id
                                 where u.advance_id = a.id and st.status not in ('rejected', 'reverted')), 0) as remaining,
           a.given_at, a.number, a.note, a.kind, coalesce(a.split, case when a.beneficiary_id is null then 'pool' else 'one' end), a.shares
    from public.erp_settlement_advances a
    where a.store_id = p_store and a.point_id is not distinct from p_point and a.status = 'approved' and a.given_at <= p_cutoff
  ) x
  where x.remaining > 0.004
  order by x.given_at, x.number;
$$;
revoke all on function public.erp__pool_advances(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- cálculo
create or replace function public.erp__settlement_compute(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare sp public.erp_profit_splits; ps public.erp_pool_settings; v_sources jsonb; v_gross numeric; v_carry jsonb; v_lines jsonb; v_carry_total numeric;
        v_exp jsonb; v_exp_total numeric := 0; v_total numeric; v_no_cost jsonb;
        v_adv jsonb; v_adv_total numeric := 0; v_adv_pool numeric := 0; v_norm jsonb; v_equal jsonb; v_exp_shared numeric := 0;
        v_cost numeric := 0; v_cost_left numeric; v_cadv jsonb := '[]'::jsonb; v_cadv_total numeric := 0; r record; v_apply numeric;
begin
  select * into sp from public.erp_profit_splits
  where store_id = p_store and point_id is not distinct from p_point order by version desc limit 1;
  select * into ps from public.erp_pool_settings where store_id = p_store and point_id is not distinct from p_point;

  with e as (select * from public.erp__pool_eligible(p_store, p_point, p_cutoff)),
  prev as (
    select ss.order_id, sum(ss.delta) as settled
    from public.erp_settlement_sources ss
    join public.erp_settlements st on st.id = ss.settlement_id
    where st.store_id = p_store and st.point_id is not distinct from p_point and st.status not in ('rejected', 'reverted')
    group by ss.order_id
  ),
  d as (
    select coalesce(e.order_id, prev.order_id) as order_id, coalesce(e.eligible, 0) as eligible,
           coalesce(e.eligible, 0) - coalesce(prev.settled, 0) as delta
    from e full join prev on prev.order_id = e.order_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('order_id', order_id, 'eligible', eligible, 'delta', delta)) filter (where delta <> 0), '[]'::jsonb),
         coalesce(sum(delta), 0)
  into v_sources, v_gross
  from d;

  -- Gastos: solo los que todavía no se restaron (o cambiaron/se anularon).
  with x as (select * from public.erp__pool_expenses(p_store, p_point, p_cutoff)),
  prev as (
    select se.source_type, se.source_id, sum(se.delta) as done
    from public.erp_settlement_expenses se
    join public.erp_settlements st on st.id = se.settlement_id
    where st.store_id = p_store and st.point_id is not distinct from p_point and st.status not in ('rejected', 'reverted')
    group by se.source_type, se.source_id
  ),
  d as (
    select x.source_type, x.source_id, x.eligible, x.label, x.dated, x.eligible - coalesce(prev.done, 0) as delta
    from x left join prev on prev.source_type = x.source_type and prev.source_id = x.source_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('source_type', source_type, 'source_id', source_id, 'eligible', eligible, 'delta', delta,
                                               'label', label, 'dated', dated) order by dated) filter (where delta <> 0), '[]'::jsonb),
         coalesce(sum(delta), 0)
  into v_exp, v_exp_total
  from d;

  v_total := v_gross - v_exp_total;

  -- Productos vendidos sin costo (inflan la ganancia): bloquean si el pozo depende del costo.
  if p_point is null or coalesce(ps.mode, 'margin') = 'total' then
    select coalesce(jsonb_agg(jsonb_build_object('order_id', f.order_id, 'product_id', f.product_id, 'name', p.name, 'qty', f.qty, 'revenue', f.revenue)), '[]'::jsonb)
    into v_no_cost
    from public.erp_sale_finance f
    join public.products p on p.id = f.product_id
    where f.order_id in (select (s->>'order_id')::uuid from jsonb_array_elements(v_sources) s where (s->>'delta')::numeric > 0)
      and (p_point is null or f.point_id = p_point)
      and coalesce(f.cost_total, 0) <= 0 and f.revenue > 0;
  else
    v_no_cost := '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'beneficiary_id', l.beneficiary_id, 'amount', l.amount - l.paid)), '[]'::jsonb),
         coalesce(sum(l.amount - l.paid), 0)
  into v_carry, v_carry_total
  from public.erp_settlement_lines l
  join public.erp_settlements st on st.id = l.settlement_id
  where st.store_id = p_store and st.point_id is not distinct from p_point
    and st.status in ('approved', 'partially_paid', 'paid') and l.amount < 0 and l.carried_into is null;

  -- Costo de la mercancía vendida en este período: ventas que entran por primera vez (las ya liquidadas no).
  select coalesce(sum(f.cost_total), 0) into v_cost
  from public.erp_sale_finance f
  where f.order_id in (select (s->>'order_id')::uuid from jsonb_array_elements(v_sources) s where (s->>'delta')::numeric > 0)
    and (p_point is null or f.point_id = p_point)
    and not exists (select 1 from public.erp_settlement_sources ss join public.erp_settlements st on st.id = ss.settlement_id
                    where ss.order_id = f.order_id and st.store_id = p_store and st.point_id is not distinct from p_point
                      and st.status not in ('rejected', 'reverted'));

  -- Gastos compartidos aprobados por descontar: se restan de la ganancia según su reparto (20261288).
  select coalesce(jsonb_agg(jsonb_build_object('advance_id', a.advance_id, 'number', a.number, 'beneficiary_id', a.beneficiary_id,
                                               'name', b.name, 'amount', a.remaining, 'given_at', a.given_at, 'note', a.note,
                                               'kind', a.kind, 'split', a.split, 'shares', a.shares) order by a.given_at, a.number), '[]'::jsonb),
         coalesce(sum(a.remaining), 0)
  into v_adv, v_exp_shared
  from public.erp__pool_advances(p_store, p_point, p_cutoff) a
  left join public.erp_beneficiaries b on b.id = a.beneficiary_id
  where a.kind = 'expense';
  v_adv_total := v_exp_shared;

  -- Anticipos (20261289): abonos al costo de la mercancía, en orden, hasta cubrir el costo del período.
  -- Lo que sobre de un anticipo queda para la siguiente liquidación.
  v_cost_left := greatest(v_cost, 0);
  for r in select a.*, b.name as bname from public.erp__pool_advances(p_store, p_point, p_cutoff) a
           left join public.erp_beneficiaries b on b.id = a.beneficiary_id
           where a.kind = 'advance' order by a.given_at, a.number loop
    exit when v_cost_left <= 0;
    v_apply := least(r.remaining, v_cost_left);
    v_cost_left := v_cost_left - v_apply;
    v_cadv_total := v_cadv_total + v_apply;
    v_cadv := v_cadv || jsonb_build_array(jsonb_build_object('advance_id', r.advance_id, 'number', r.number, 'name', r.bname, 'amount', v_apply,
                                                             'remaining_after', r.remaining - v_apply, 'given_at', r.given_at, 'note', r.note, 'kind', 'advance'));
  end loop;

  -- Los de todo el pozo se reparten con los % vigentes llevados a 100 (si el reparto no suma 100, igual se cubre todo).
  select coalesce(jsonb_agg(jsonb_build_object('beneficiary_id', x->>'beneficiary_id', 'pct', (x->>'pct')::numeric * 100 / sp.total_pct)), '[]'::jsonb)
  into v_norm
  from jsonb_array_elements(coalesce(sp.shares, '[]'::jsonb)) x
  where coalesce(sp.total_pct, 0) > 0 and (x->>'pct')::numeric > 0;
  -- «Mitad y mitad»: partes iguales entre los beneficiarios del reparto vigente.
  select coalesce(jsonb_agg(jsonb_build_object('beneficiary_id', q.b, 'pct', 100.0 / q.n)), '[]'::jsonb)
  into v_equal
  from (select x->>'beneficiary_id' as b, count(*) over () as n
        from jsonb_array_elements(coalesce(sp.shares, '[]'::jsonb)) x where (x->>'pct')::numeric > 0) q;

  with shares as (select * from public.erp__distribute(v_total, coalesce(sp.shares, '[]'::jsonb))),
  carry as (select (c->>'beneficiary_id')::uuid as b, sum((c->>'amount')::numeric) as amt from jsonb_array_elements(v_carry) c group by 1),
  -- Cada anticipo o gasto se reparte como se escogió: uno solo, según el reparto, partes iguales o % propios.
  adv_split as (
    select d.beneficiary_id as b, d.amount as amt
    from jsonb_array_elements(v_adv) a
    cross join lateral public.erp__distribute((a->>'amount')::numeric,
      case coalesce(a->>'split', case when a->>'beneficiary_id' is null then 'pool' else 'one' end)
        when 'one' then jsonb_build_array(jsonb_build_object('beneficiary_id', a->>'beneficiary_id', 'pct', 100))
        when 'equal' then v_equal
        when 'custom' then coalesce(a->'shares', '[]'::jsonb)
        else v_norm end) d
  ),
  adv as (select b, sum(amt) as amt from adv_split group by b),
  allb as (select beneficiary_id as b from shares union select b from carry union select b from adv)
  select coalesce(jsonb_agg(jsonb_build_object(
           'beneficiary_id', a.b, 'name', bf.name, 'kind', bf.kind,
           'pct', coalesce(sh.pct, 0), 'share_amount', coalesce(sh.amount, 0), 'carried_amount', coalesce(cr.amt, 0),
           'advance_amount', coalesce(ad.amt, 0),
           'amount', coalesce(sh.amount, 0) + coalesce(cr.amt, 0) - coalesce(ad.amt, 0)) order by coalesce(sh.pct, 0) desc, bf.name), '[]'::jsonb)
  into v_lines
  from allb a
  left join shares sh on sh.beneficiary_id = a.b
  left join carry cr on cr.b = a.b
  left join adv ad on ad.b = a.b
  left join public.erp_beneficiaries bf on bf.id = a.b;

  return jsonb_build_object(
    'pool_total', v_total,
    'gross_total', v_gross,
    'expenses_total', v_exp_total,
    'mode', case when p_point is null then 'mother' else coalesce(ps.mode, 'margin') end,
    'deduct', coalesce(ps.deduct_expenses, false),
    'carried_total', v_carry_total,
    'advances_total', v_adv_total,
    'shared_expenses_total', v_exp_shared,
    'merch_cost', v_cost,
    'cost_advances_total', v_cadv_total,
    'cost_due', v_cost - v_cadv_total,
    'cost_advances', v_cadv,
    'advances_pending_cost', (select coalesce(sum(a.remaining), 0) from public.erp__pool_advances(p_store, p_point, p_cutoff) a where a.kind = 'advance'),
    'split_id', sp.id,
    'split_version', sp.version,
    'split_pct', coalesce(sp.total_pct, 0),
    'assigned_total', (select coalesce(sum((x->>'share_amount')::numeric), 0) from jsonb_array_elements(v_lines) x),
    'sources', v_sources,
    'expenses', v_exp,
    'no_cost', v_no_cost,
    'carry', v_carry,
    'advances', v_adv,
    'lines', v_lines
  );
end;
$$;
revoke all on function public.erp__settlement_compute(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- preparar
create or replace function public.erp_settlement_calculate(p_store uuid, p_point uuid, p_cutoff timestamptz, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c jsonb; v_id uuid; v_num bigint; v_cutoff timestamptz := least(coalesce(p_cutoff, now()), now()); v_names text;
begin
  if not public.erp_can(p_store, 'profit_settle') then raise exception 'Necesitas el permiso «Preparar liquidaciones».'; end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No puedes liquidar este pozo.'; end if;
  perform pg_advisory_xact_lock(hashtext('settle:' || p_store::text || ':' || coalesce(p_point::text, 'madre')));
  if exists (select 1 from public.erp_settlements where store_id = p_store and point_id is not distinct from p_point and status in ('calculated', 'review')) then
    raise exception 'Ya hay una liquidación abierta para este pozo. Termínala o descártala primero.';
  end if;
  c := public.erp__settlement_compute(p_store, p_point, v_cutoff);
  if c->>'split_id' is null then raise exception 'Primero define el reparto (beneficiarios y porcentajes) de este pozo.'; end if;
  if jsonb_array_length(c->'no_cost') > 0 then
    select string_agg(distinct x->>'name', ', ') into v_names from (select x from jsonb_array_elements(c->'no_cost') x limit 8) q;
    raise exception 'Hay % producto(s) vendido(s) sin costo: %. Ponles costo (ingreso de factura) y usa «Tomar el costo actual» antes de liquidar.',
      jsonb_array_length(c->'no_cost'), v_names;
  end if;
  if (c->>'pool_total')::numeric = 0 and (c->>'carried_total')::numeric = 0 and (c->>'gross_total')::numeric = 0 and (c->>'expenses_total')::numeric = 0
     and (c->>'advances_total')::numeric = 0 and (c->>'cost_advances_total')::numeric = 0 then
    raise exception 'No hay nada nuevo por liquidar hasta esa fecha.';
  end if;

  v_num := public.erp_next_number(p_store, 'settlement');
  insert into public.erp_settlements (store_id, point_id, number, cutoff, status, pool_total, carried_total, assigned_total, unassigned_total,
                                      sources_count, split_id, notes, created_by, created_by_name, gross_total, expenses_total, mode, deducted, advances_total, merch_cost, cost_advances_total, cost_due)
  values (p_store, p_point, v_num, v_cutoff, 'calculated', (c->>'pool_total')::numeric, (c->>'carried_total')::numeric, (c->>'assigned_total')::numeric,
          (c->>'pool_total')::numeric - (c->>'assigned_total')::numeric, jsonb_array_length(c->'sources'), (c->>'split_id')::uuid,
          nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), public.erp_actor_name(p_store),
          (c->>'gross_total')::numeric, (c->>'expenses_total')::numeric, c->>'mode', (c->>'deduct')::boolean, (c->>'advances_total')::numeric,
          (c->>'merch_cost')::numeric, (c->>'cost_advances_total')::numeric, (c->>'cost_due')::numeric)
  returning id into v_id;

  insert into public.erp_settlement_sources (settlement_id, order_id, eligible, delta)
  select v_id, (s->>'order_id')::uuid, (s->>'eligible')::numeric, (s->>'delta')::numeric from jsonb_array_elements(c->'sources') s;

  insert into public.erp_settlement_expenses (settlement_id, source_type, source_id, eligible, delta, label)
  select v_id, x->>'source_type', (x->>'source_id')::uuid, (x->>'eligible')::numeric, (x->>'delta')::numeric, x->>'label'
  from jsonb_array_elements(c->'expenses') x;

  insert into public.erp_settlement_advance_uses (settlement_id, advance_id, amount)
  select v_id, (a->>'advance_id')::uuid, (a->>'amount')::numeric from jsonb_array_elements(c->'advances') a
  union all
  select v_id, (a->>'advance_id')::uuid, (a->>'amount')::numeric from jsonb_array_elements(c->'cost_advances') a;

  insert into public.erp_settlement_lines (settlement_id, beneficiary_id, pct, share_amount, carried_amount, advance_amount, amount)
  select v_id, (l->>'beneficiary_id')::uuid, (l->>'pct')::numeric, (l->>'share_amount')::numeric, (l->>'carried_amount')::numeric,
         (l->>'advance_amount')::numeric, (l->>'amount')::numeric
  from jsonb_array_elements(c->'lines') l;

  update public.erp_settlement_lines set carried_into = v_id
  where id in (select (x->>'line_id')::uuid from jsonb_array_elements(c->'carry') x);

  perform public.erp_audit(p_store, 'settlement.calculated', 'erp_settlements', v_id,
    jsonb_build_object('number', v_num, 'point_id', p_point, 'cutoff', v_cutoff, 'pool_total', c->'pool_total', 'gross_total', c->'gross_total',
                       'expenses_total', c->'expenses_total', 'mode', c->'mode', 'carried_total', c->'carried_total', 'advances_total', c->'advances_total', 'cost_advances_total', c->'cost_advances_total', 'merch_cost', c->'merch_cost',
                       'sources', jsonb_array_length(c->'sources'), 'split_version', c->'split_version'));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end;
$$;
revoke all on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------- vista del pozo
create or replace function public.erp_pool_overview(p_store uuid, p_point uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare sp public.erp_profit_splits; v_preview jsonb; v_open public.erp_settlements; ps public.erp_pool_settings;
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_beneficiaries') or public.erp_can(p_store, 'profit_settle')
          or public.erp_can(p_store, 'profit_settle_approve') or public.erp_can(p_store, 'profit_pay')) then
    raise exception 'No tienes permiso para ver los repartos.';
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  select * into sp from public.erp_profit_splits where store_id = p_store and point_id is not distinct from p_point order by version desc limit 1;
  select * into ps from public.erp_pool_settings where store_id = p_store and point_id is not distinct from p_point;
  v_preview := public.erp__settlement_compute(p_store, p_point, now());
  select * into v_open from public.erp_settlements where store_id = p_store and point_id is not distinct from p_point and status in ('calculated', 'review') limit 1;
  return jsonb_build_object(
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind, 'document', b.document, 'notes', b.notes, 'active', b.active) order by b.active desc, b.name)
                               from public.erp_beneficiaries b where b.store_id = p_store and b.point_id is not distinct from p_point), '[]'::jsonb),
    'split', case when sp.id is null then null else jsonb_build_object('id', sp.id, 'version', sp.version, 'shares', sp.shares, 'total_pct', sp.total_pct,
                     'reason', sp.reason, 'created_by_name', sp.created_by_name, 'created_at', sp.created_at) end,
    'split_history', coalesce((select jsonb_agg(jsonb_build_object('version', x.version, 'total_pct', x.total_pct, 'reason', x.reason, 'created_by_name', x.created_by_name, 'created_at', x.created_at) order by x.version desc)
                               from (select * from public.erp_profit_splits where store_id = p_store and point_id is not distinct from p_point order by version desc limit 20) x), '[]'::jsonb),
    'settings', jsonb_build_object('mode', case when p_point is null then 'mother' else coalesce(ps.mode, 'margin') end, 'mode_from', ps.mode_from,
                                   'deduct_expenses', coalesce(ps.deduct_expenses, false), 'deduct_from', ps.deduct_from,
                                   'updated_by_name', ps.updated_by_name, 'updated_at', ps.updated_at,
                                   'can_edit', (public.erp_can(p_store, 'profit_beneficiaries') or public.erp_can(p_store, 'profit_settle')) and public.erp_my_points(p_store) is null),
    'pending', jsonb_build_object('pool_total', v_preview->'pool_total', 'gross_total', v_preview->'gross_total', 'expenses_total', v_preview->'expenses_total',
                                  'carried_total', v_preview->'carried_total', 'assigned_total', v_preview->'assigned_total',
                                  'advances_total', v_preview->'advances_total', 'advances', v_preview->'advances',
                                  'merch_cost', v_preview->'merch_cost', 'cost_advances_total', v_preview->'cost_advances_total', 'cost_due', v_preview->'cost_due',
                                  'cost_advances', v_preview->'cost_advances', 'advances_pending_cost', v_preview->'advances_pending_cost',
                                  'orders', jsonb_array_length(v_preview->'sources'), 'expenses', jsonb_array_length(v_preview->'expenses'),
                                  'no_cost', v_preview->'no_cost', 'lines', v_preview->'lines'),
    'advances_waiting', (select count(*) from public.erp_settlement_advances a where a.store_id = p_store and a.point_id is not distinct from p_point and a.status = 'pending'),
    'open_settlement', case when v_open.id is null then null else jsonb_build_object('id', v_open.id, 'number', v_open.number, 'status', v_open.status) end,
    'can', jsonb_build_object('beneficiaries', public.erp_can(p_store, 'profit_beneficiaries'), 'settle', public.erp_can(p_store, 'profit_settle'),
                              'approve', public.erp_can(p_store, 'profit_settle_approve'), 'pay', public.erp_can(p_store, 'profit_pay'))
  );
end;
$$;
revoke all on function public.erp_pool_overview(uuid, uuid) from public, anon;
grant execute on function public.erp_pool_overview(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- lista (con lo ya abonado)
create or replace function public.erp_settlement_advances_list(p_store uuid, p_point uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_settle') or public.erp_can(p_store, 'profit_settle_approve') or public.erp_can(p_store, 'profit_pay')) then
    raise exception 'No tienes permiso para ver los anticipos.';
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  return coalesce((select jsonb_agg(x order by x.given_at desc, x.number desc) from (
    select a.id, a.number, a.beneficiary_id, b.name as beneficiary_name, a.amount, a.given_at, a.method, a.reference, a.note, a.support_url, a.status,
           a.created_by, a.created_by_name, a.created_at, a.decided_by_name, a.decided_at, a.decision_note, a.voided_by_name, a.voided_at, a.void_reason, a.kind, a.split, a.shares,
           (select jsonb_build_object('id', st.id, 'number', st.number, 'status', st.status, 'cutoff', st.cutoff)
            from public.erp_settlement_advance_uses u join public.erp_settlements st on st.id = u.settlement_id
            where u.advance_id = a.id and st.status not in ('rejected', 'reverted') order by st.created_at desc limit 1) as settlement,
           a.created_by = auth.uid() as mine,
           (select coalesce(sum(u.amount), 0) from public.erp_settlement_advance_uses u join public.erp_settlements st on st.id = u.settlement_id
            where u.advance_id = a.id and st.status not in ('rejected', 'reverted')) as used
    from public.erp_settlement_advances a
    left join public.erp_beneficiaries b on b.id = a.beneficiary_id
    where a.store_id = p_store and a.point_id is not distinct from p_point
    order by a.given_at desc limit 300) x), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_settlement_advances_list(uuid, uuid) from public, anon;
grant execute on function public.erp_settlement_advances_list(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- registrar (el anticipo no se reparte)
create or replace function public.erp_settlement_advance_save(p_store uuid, p_point uuid, p_kind text, p_split text, p_beneficiary uuid, p_shares jsonb,
                                                              p_amount numeric, p_given_at timestamptz, p_method text, p_reference text, p_note text, p_support_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_num bigint; v_given timestamptz := coalesce(p_given_at, now()); v_shares jsonb; v_sum numeric; v_bad integer;
begin
  if not public.erp_can(p_store, 'profit_settle') then raise exception 'Necesitas el permiso «Preparar liquidaciones» para registrar anticipos y gastos.'; end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  if coalesce(p_kind, '') not in ('advance', 'expense') then raise exception 'Escoge si es un anticipo o un gasto.'; end if;
  -- Un anticipo es un abono al costo de la mercancía: no se reparte entre beneficiarios (20261289).
  if p_kind = 'advance' then p_split := 'pool'; p_beneficiary := null; p_shares := null; end if;
  if coalesce(p_split, '') not in ('one', 'pool', 'equal', 'custom') then raise exception 'Escoge cómo se reparte.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Escribe el valor.'; end if;
  if p_amount > 9999999999 then raise exception 'El valor es demasiado alto.'; end if;
  if v_given > now() + interval '5 minutes' then raise exception 'La fecha no puede ser futura.'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe para qué fue (mínimo 3 letras).'; end if;
  if coalesce(p_method, 'cash') not in ('cash', 'transfer', 'nequi', 'other') then raise exception 'Forma de pago no válida.'; end if;
  if p_support_url is not null and p_support_url !~ '^https?://' then raise exception 'El soporte debe ser un enlace válido.'; end if;

  if p_split = 'one' then
    if p_beneficiary is null then raise exception 'Escoge a quién se le descuenta.'; end if;
    if not exists (select 1 from public.erp_beneficiaries b where b.id = p_beneficiary and b.store_id = p_store and b.point_id is not distinct from p_point) then
      raise exception 'Ese beneficiario no es de este pozo.';
    end if;
  elsif p_split = 'custom' then
    if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then raise exception 'Escribe el %% de cada beneficiario.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('beneficiary_id', x->>'beneficiary_id', 'pct', round((x->>'pct')::numeric, 4))), '[]'::jsonb),
           coalesce(sum((x->>'pct')::numeric), 0),
           count(*) filter (where (x->>'pct')::numeric <= 0 or not exists (
             select 1 from public.erp_beneficiaries b where b.id::text = x->>'beneficiary_id' and b.store_id = p_store and b.point_id is not distinct from p_point))
    into v_shares, v_sum, v_bad
    from jsonb_array_elements(p_shares) x;
    if v_bad > 0 then raise exception 'Hay un beneficiario que no es de este pozo o un %% en cero.'; end if;
    if (select count(distinct x->>'beneficiary_id') from jsonb_array_elements(p_shares) x) <> jsonb_array_length(p_shares) then raise exception 'Hay un beneficiario repetido.'; end if;
    if abs(v_sum - 100) > 0.01 then raise exception 'Los %% deben sumar 100 (suman %).', round(v_sum, 2); end if;
  elsif p_kind = 'expense' then
    if not exists (select 1 from public.erp_profit_splits sp where sp.store_id = p_store and sp.point_id is not distinct from p_point) then
      raise exception 'Primero define el reparto de este pozo.';
    end if;
  end if;

  v_num := public.erp_next_number(p_store, 'settlement_advance');
  insert into public.erp_settlement_advances (store_id, point_id, number, kind, split, beneficiary_id, shares, amount, given_at, method, reference, note, support_url, created_by, created_by_name)
  values (p_store, p_point, v_num, p_kind, case when p_kind = 'advance' then null else p_split end, case when p_split = 'one' then p_beneficiary end, case when p_split = 'custom' then v_shares end,
          round(p_amount, 2), v_given, coalesce(p_method, 'cash'), nullif(left(btrim(coalesce(p_reference, '')), 120), ''), left(btrim(p_note), 500),
          nullif(btrim(coalesce(p_support_url, '')), ''), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'settlement.' || p_kind || '_created', 'erp_settlement_advances', v_id,
    jsonb_build_object('number', v_num, 'point_id', p_point, 'kind', p_kind, 'split', p_split, 'beneficiary_id', p_beneficiary, 'shares', v_shares,
                       'amount', p_amount, 'given_at', v_given, 'note', p_note));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end;
$$;
revoke all on function public.erp_settlement_advance_save(uuid, uuid, text, text, uuid, jsonb, numeric, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.erp_settlement_advance_save(uuid, uuid, text, text, uuid, jsonb, numeric, timestamptz, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
