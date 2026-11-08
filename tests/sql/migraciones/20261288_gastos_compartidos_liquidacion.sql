-- =====================================================================
-- 20261288 · Gastos compartidos en la liquidación y reparto por anticipo
--
-- Pedido del usuario (2026-11-08): además de anticipos, registrar gastos del punto (transporte,
-- consumo, mecatos…) que se restan de la ganancia antes de pagar, escogiendo en CADA uno cómo se
-- reparte: según el reparto del pozo, mitad y mitad (partes iguales), % propios para cada
-- beneficiario o todo a uno solo. Igual que los anticipos: lo registra quien prepara liquidaciones,
-- lo aprueba otra persona y se descuenta en la próxima liquidación (lo que no alcance pasa a la siguiente).
--
-- Parte de 20261286 (mismas tablas). Los anticipos que ya existen quedan igual:
-- con beneficiario = «uno solo»; sin beneficiario = «según el reparto».
-- No borra datos. Es idempotente.
-- =====================================================================

alter table public.erp_settlement_advances add column if not exists kind text not null default 'advance';
alter table public.erp_settlement_advances add column if not exists split text;
alter table public.erp_settlement_advances add column if not exists shares jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.erp_settlement_advances'::regclass and conname = 'erp_settlement_advances_kind') then
    alter table public.erp_settlement_advances add constraint erp_settlement_advances_kind check (kind in ('advance', 'expense'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.erp_settlement_advances'::regclass and conname = 'erp_settlement_advances_split') then
    alter table public.erp_settlement_advances add constraint erp_settlement_advances_split check (split is null or split in ('one', 'pool', 'equal', 'custom'));
  end if;
end $$;
update public.erp_settlement_advances set split = case when beneficiary_id is null then 'pool' else 'one' end where split is null;

-- Por descontar: ahora también trae el tipo y cómo se reparte.
drop function if exists public.erp__pool_advances(uuid, uuid, timestamptz);
create or replace function public.erp__pool_advances(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns table (advance_id uuid, beneficiary_id uuid, amount numeric, given_at timestamptz, number bigint, note text, kind text, split text, shares jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.beneficiary_id, a.amount, a.given_at, a.number, a.note, a.kind, coalesce(a.split, case when a.beneficiary_id is null then 'pool' else 'one' end), a.shares
  from public.erp_settlement_advances a
  where a.store_id = p_store and a.point_id is not distinct from p_point and a.status = 'approved' and a.given_at <= p_cutoff
    and not exists (select 1 from public.erp_settlement_advance_uses u join public.erp_settlements st on st.id = u.settlement_id
                    where u.advance_id = a.id and st.status not in ('rejected', 'reverted'))
  order by a.given_at, a.number;
$$;
revoke all on function public.erp__pool_advances(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- cálculo (igual que 20261286 + reparto por anticipo)
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

  -- Anticipos y gastos compartidos aprobados por descontar (20261286 · 20261288).
  select coalesce(jsonb_agg(jsonb_build_object('advance_id', a.advance_id, 'number', a.number, 'beneficiary_id', a.beneficiary_id,
                                               'name', b.name, 'amount', a.amount, 'given_at', a.given_at, 'note', a.note,
                                               'kind', a.kind, 'split', a.split, 'shares', a.shares) order by a.given_at, a.number), '[]'::jsonb),
         coalesce(sum(a.amount), 0),
         coalesce(sum(a.amount) filter (where a.beneficiary_id is null), 0),
         coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0)
  into v_adv, v_adv_total, v_adv_pool, v_exp_shared
  from public.erp__pool_advances(p_store, p_point, p_cutoff) a
  left join public.erp_beneficiaries b on b.id = a.beneficiary_id;

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

-- ---------------------------------------------------------------- detalle y lista (+ tipo y reparto)
create or replace function public.erp_settlement_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.erp_settlements; sp public.erp_profit_splits;
begin
  select * into s from public.erp_settlements where id = p_id;
  if not found then raise exception 'Liquidación no encontrada.'; end if;
  if not (public.erp_can(s.store_id, 'profit_view') or public.erp_can(s.store_id, 'profit_settle') or public.erp_can(s.store_id, 'profit_settle_approve') or public.erp_can(s.store_id, 'profit_pay')) then
    raise exception 'No tienes permiso para ver liquidaciones.';
  end if;
  if not public.erp__pool_allowed(s.store_id, s.point_id) then raise exception 'No tienes acceso a este pozo.'; end if;
  select * into sp from public.erp_profit_splits where id = s.split_id;
  return jsonb_build_object(
    'settlement', to_jsonb(s) || jsonb_build_object('point_name', (select name from public.erp_warehouses where id = s.point_id), 'split_version', sp.version),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'beneficiary_id', l.beneficiary_id, 'name', b.name, 'kind', b.kind, 'document', b.document,
                        'pct', l.pct, 'share_amount', l.share_amount, 'carried_amount', l.carried_amount, 'advance_amount', l.advance_amount, 'amount', l.amount, 'paid', l.paid,
                        'carried_into', l.carried_into) order by l.pct desc, b.name)
                       from public.erp_settlement_lines l join public.erp_beneficiaries b on b.id = l.beneficiary_id where l.settlement_id = s.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'line_id', p.line_id, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
                        'note', p.note, 'paid_at', p.paid_at, 'created_by_name', p.created_by_name, 'voided', p.voided, 'void_reason', p.void_reason) order by p.paid_at desc)
                       from public.erp_settlement_payments p where p.settlement_id = s.id), '[]'::jsonb),
    'advances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'number', a.number, 'beneficiary_id', a.beneficiary_id, 'name', b.name, 'amount', u.amount,
                        'given_at', a.given_at, 'method', a.method, 'reference', a.reference, 'note', a.note, 'support_url', a.support_url,
                        'created_by_name', a.created_by_name, 'decided_by_name', a.decided_by_name, 'kind', a.kind, 'split', a.split, 'shares', a.shares) order by a.given_at, a.number)
                       from public.erp_settlement_advance_uses u join public.erp_settlement_advances a on a.id = u.advance_id
                       left join public.erp_beneficiaries b on b.id = a.beneficiary_id where u.settlement_id = s.id), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(x) from (
                        select ss.order_id, ss.eligible, ss.delta, o.receipt_no, o.status, coalesce(o.confirmed_at, o.created_at) as sold_at, m.doc_number,
                               w.name as point_name, (select count(*) from public.erp_receivables r where r.order_id = o.id and r.status <> 'void') > 0 as credit
                        from public.erp_settlement_sources ss join public.orders o on o.id = ss.order_id
                        left join public.erp_order_meta m on m.order_id = o.id left join public.erp_warehouses w on w.id = m.point_id
                        where ss.settlement_id = s.id order by coalesce(o.confirmed_at, o.created_at) desc limit 1000) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.erp_settlement_detail(uuid) from public, anon;
grant execute on function public.erp_settlement_detail(uuid) to authenticated;

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
           a.created_by = auth.uid() as mine
    from public.erp_settlement_advances a
    left join public.erp_beneficiaries b on b.id = a.beneficiary_id
    where a.store_id = p_store and a.point_id is not distinct from p_point
    order by a.given_at desc limit 300) x), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_settlement_advances_list(uuid, uuid) from public, anon;
grant execute on function public.erp_settlement_advances_list(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- registrar anticipo o gasto compartido
drop function if exists public.erp_settlement_advance_save(uuid, uuid, uuid, numeric, timestamptz, text, text, text, text);
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
  else
    if not exists (select 1 from public.erp_profit_splits sp where sp.store_id = p_store and sp.point_id is not distinct from p_point) then
      raise exception 'Primero define el reparto de este pozo.';
    end if;
  end if;

  v_num := public.erp_next_number(p_store, 'settlement_advance');
  insert into public.erp_settlement_advances (store_id, point_id, number, kind, split, beneficiary_id, shares, amount, given_at, method, reference, note, support_url, created_by, created_by_name)
  values (p_store, p_point, v_num, p_kind, p_split, case when p_split = 'one' then p_beneficiary end, case when p_split = 'custom' then v_shares end,
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
