-- =====================================================================
-- 20261286 · Anticipos de liquidación
--
-- Dinero que un pozo (un punto o la madre) entrega ANTES de liquidar y que se descuenta en la siguiente
-- liquidación. Decisiones del usuario (2026-11-07):
--   · En cada anticipo se elige si es de UN beneficiario (se descuenta solo de su parte) o de TODO EL POZO
--     (se reparte según los % del reparto vigente).
--   · Si en la liquidación no alcanza, queda en contra y se sigue descontando en las siguientes
--     (usa el mismo saldo en contra que ya existía: líneas negativas que pasan a la próxima).
--   · Lo registra quien prepara liquidaciones y lo aprueba OTRA persona (con «Aprobar liquidaciones»);
--     el dueño puede aprobar lo suyo. Solo los aprobados se descuentan.
--   · Entra en la primera liquidación cuyo corte sea igual o posterior a la fecha en que salió el dinero.
--     Si esa liquidación se rechaza o se revierte, el anticipo vuelve a quedar por descontar.
--
-- No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- tablas
create table if not exists public.erp_settlement_advances (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id),            -- null = pozo de la madre
  number bigint not null,
  beneficiary_id uuid references public.erp_beneficiaries(id),   -- null = de todo el pozo (según los %)
  amount numeric(14, 2) not null check (amount > 0),
  given_at timestamptz not null,                                 -- cuándo salió el dinero
  method text not null default 'cash' check (method in ('cash', 'transfer', 'nequi', 'other')),
  reference text check (reference is null or char_length(reference) <= 120),
  note text not null check (char_length(btrim(note)) between 3 and 500),
  support_url text check (support_url is null or (support_url ~ '^https?://' and char_length(support_url) <= 1000)),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'voided')),
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  decided_by uuid, decided_by_name text, decided_at timestamptz, decision_note text,
  voided_by uuid, voided_by_name text, voided_at timestamptz, void_reason text
);
create unique index if not exists erp_settlement_advances_number on public.erp_settlement_advances (store_id, number);
create index if not exists erp_settlement_advances_pool on public.erp_settlement_advances (store_id, point_id, given_at);
alter table public.erp_settlement_advances enable row level security;
revoke all on public.erp_settlement_advances from anon, authenticated;

-- En qué liquidación se descontó cada anticipo (si esa liquidación se rechaza o revierte, deja de contar).
create table if not exists public.erp_settlement_advance_uses (
  settlement_id uuid not null references public.erp_settlements(id) on delete cascade,
  advance_id uuid not null references public.erp_settlement_advances(id),
  amount numeric(14, 2) not null,
  primary key (settlement_id, advance_id)
);
create index if not exists erp_settlement_advance_uses_adv on public.erp_settlement_advance_uses (advance_id);
alter table public.erp_settlement_advance_uses enable row level security;
revoke all on public.erp_settlement_advance_uses from anon, authenticated;

alter table public.erp_settlements add column if not exists advances_total numeric(14, 2) not null default 0;
alter table public.erp_settlement_lines add column if not exists advance_amount numeric(14, 2) not null default 0;

-- El total de cada línea ahora resta su anticipo: total = parte del período + saldo traído − anticipo.
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'public.erp_settlement_lines'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%share_amount + carried_amount%'
             and conname <> 'erp_settlement_lines_amount_ck'
  loop
    execute format('alter table public.erp_settlement_lines drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.erp_settlement_lines'::regclass and conname = 'erp_settlement_lines_amount_ck') then
    alter table public.erp_settlement_lines add constraint erp_settlement_lines_amount_ck check (amount = share_amount + carried_amount - advance_amount);
  end if;
end $$;

-- Anticipos aprobados de un pozo hasta una fecha que todavía no se descontaron en una liquidación vigente.
create or replace function public.erp__pool_advances(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns table (advance_id uuid, beneficiary_id uuid, amount numeric, given_at timestamptz, number bigint, note text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.beneficiary_id, a.amount, a.given_at, a.number, a.note
  from public.erp_settlement_advances a
  where a.store_id = p_store and a.point_id is not distinct from p_point and a.status = 'approved' and a.given_at <= p_cutoff
    and not exists (select 1 from public.erp_settlement_advance_uses u join public.erp_settlements st on st.id = u.settlement_id
                    where u.advance_id = a.id and st.status not in ('rejected', 'reverted'))
  order by a.given_at, a.number;
$$;
revoke all on function public.erp__pool_advances(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- cálculo (igual que 20261208 + anticipos)
create or replace function public.erp__settlement_compute(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare sp public.erp_profit_splits; ps public.erp_pool_settings; v_sources jsonb; v_gross numeric; v_carry jsonb; v_lines jsonb; v_carry_total numeric;
        v_exp jsonb; v_exp_total numeric := 0; v_total numeric; v_no_cost jsonb;
        v_adv jsonb; v_adv_total numeric := 0; v_adv_pool numeric := 0; v_norm jsonb;
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

  -- Anticipos aprobados por descontar (20261286).
  select coalesce(jsonb_agg(jsonb_build_object('advance_id', a.advance_id, 'number', a.number, 'beneficiary_id', a.beneficiary_id,
                                               'name', b.name, 'amount', a.amount, 'given_at', a.given_at, 'note', a.note) order by a.given_at, a.number), '[]'::jsonb),
         coalesce(sum(a.amount), 0),
         coalesce(sum(a.amount) filter (where a.beneficiary_id is null), 0)
  into v_adv, v_adv_total, v_adv_pool
  from public.erp__pool_advances(p_store, p_point, p_cutoff) a
  left join public.erp_beneficiaries b on b.id = a.beneficiary_id;

  -- Los de todo el pozo se reparten con los % vigentes llevados a 100 (si el reparto no suma 100, igual se cubre todo).
  select coalesce(jsonb_agg(jsonb_build_object('beneficiary_id', x->>'beneficiary_id', 'pct', (x->>'pct')::numeric * 100 / sp.total_pct)), '[]'::jsonb)
  into v_norm
  from jsonb_array_elements(coalesce(sp.shares, '[]'::jsonb)) x
  where coalesce(sp.total_pct, 0) > 0 and (x->>'pct')::numeric > 0;

  with shares as (select * from public.erp__distribute(v_total, coalesce(sp.shares, '[]'::jsonb))),
  carry as (select (c->>'beneficiary_id')::uuid as b, sum((c->>'amount')::numeric) as amt from jsonb_array_elements(v_carry) c group by 1),
  adv_own as (select (a->>'beneficiary_id')::uuid as b, sum((a->>'amount')::numeric) as amt from jsonb_array_elements(v_adv) a where a->>'beneficiary_id' is not null group by 1),
  adv_pool as (select beneficiary_id as b, amount as amt from public.erp__distribute(v_adv_pool, v_norm) where v_adv_pool > 0),
  adv as (select b, sum(amt) as amt from (select * from adv_own union all select * from adv_pool) u group by b),
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

-- ---------------------------------------------------------------- preparar (igual que 20261208 + anticipos)
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
     and (c->>'advances_total')::numeric = 0 then
    raise exception 'No hay nada nuevo por liquidar hasta esa fecha.';
  end if;

  v_num := public.erp_next_number(p_store, 'settlement');
  insert into public.erp_settlements (store_id, point_id, number, cutoff, status, pool_total, carried_total, assigned_total, unassigned_total,
                                      sources_count, split_id, notes, created_by, created_by_name, gross_total, expenses_total, mode, deducted, advances_total)
  values (p_store, p_point, v_num, v_cutoff, 'calculated', (c->>'pool_total')::numeric, (c->>'carried_total')::numeric, (c->>'assigned_total')::numeric,
          (c->>'pool_total')::numeric - (c->>'assigned_total')::numeric, jsonb_array_length(c->'sources'), (c->>'split_id')::uuid,
          nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), public.erp_actor_name(p_store),
          (c->>'gross_total')::numeric, (c->>'expenses_total')::numeric, c->>'mode', (c->>'deduct')::boolean, (c->>'advances_total')::numeric)
  returning id into v_id;

  insert into public.erp_settlement_sources (settlement_id, order_id, eligible, delta)
  select v_id, (s->>'order_id')::uuid, (s->>'eligible')::numeric, (s->>'delta')::numeric from jsonb_array_elements(c->'sources') s;

  insert into public.erp_settlement_expenses (settlement_id, source_type, source_id, eligible, delta, label)
  select v_id, x->>'source_type', (x->>'source_id')::uuid, (x->>'eligible')::numeric, (x->>'delta')::numeric, x->>'label'
  from jsonb_array_elements(c->'expenses') x;

  insert into public.erp_settlement_advance_uses (settlement_id, advance_id, amount)
  select v_id, (a->>'advance_id')::uuid, (a->>'amount')::numeric from jsonb_array_elements(c->'advances') a;

  insert into public.erp_settlement_lines (settlement_id, beneficiary_id, pct, share_amount, carried_amount, advance_amount, amount)
  select v_id, (l->>'beneficiary_id')::uuid, (l->>'pct')::numeric, (l->>'share_amount')::numeric, (l->>'carried_amount')::numeric,
         (l->>'advance_amount')::numeric, (l->>'amount')::numeric
  from jsonb_array_elements(c->'lines') l;

  update public.erp_settlement_lines set carried_into = v_id
  where id in (select (x->>'line_id')::uuid from jsonb_array_elements(c->'carry') x);

  perform public.erp_audit(p_store, 'settlement.calculated', 'erp_settlements', v_id,
    jsonb_build_object('number', v_num, 'point_id', p_point, 'cutoff', v_cutoff, 'pool_total', c->'pool_total', 'gross_total', c->'gross_total',
                       'expenses_total', c->'expenses_total', 'mode', c->'mode', 'carried_total', c->'carried_total', 'advances_total', c->'advances_total',
                       'sources', jsonb_array_length(c->'sources'), 'split_version', c->'split_version'));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end;
$$;
revoke all on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------- vista del pozo (igual que 20261208 + anticipos)
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

-- ---------------------------------------------------------------- lista y detalle de liquidaciones (+ anticipos)
create or replace function public.erp_settlements_list(p_store uuid, p_point uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_settle') or public.erp_can(p_store, 'profit_settle_approve') or public.erp_can(p_store, 'profit_pay')) then
    raise exception 'No tienes permiso para ver liquidaciones.';
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select s.id, s.number, s.cutoff, s.status, s.pool_total, s.carried_total, s.assigned_total, s.unassigned_total, s.sources_count, s.created_at, s.created_by_name,
           s.decided_by_name, s.advances_total, (select coalesce(sum(l.amount), 0) from public.erp_settlement_lines l where l.settlement_id = s.id and l.amount > 0) as to_pay,
           (select coalesce(sum(l.paid), 0) from public.erp_settlement_lines l where l.settlement_id = s.id) as paid
    from public.erp_settlements s
    where s.store_id = p_store and s.point_id is not distinct from p_point
    order by s.created_at desc limit 100) x), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_settlements_list(uuid, uuid) from public, anon;
grant execute on function public.erp_settlements_list(uuid, uuid) to authenticated;

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
                        'created_by_name', a.created_by_name, 'decided_by_name', a.decided_by_name) order by a.given_at, a.number)
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

-- ---------------------------------------------------------------- anticipos: registrar, aprobar, anular, ver
create or replace function public.erp_settlement_advance_save(p_store uuid, p_point uuid, p_beneficiary uuid, p_amount numeric, p_given_at timestamptz,
                                                              p_method text, p_reference text, p_note text, p_support_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_num bigint; v_given timestamptz := coalesce(p_given_at, now());
begin
  if not public.erp_can(p_store, 'profit_settle') then raise exception 'Necesitas el permiso «Preparar liquidaciones» para registrar anticipos.'; end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Escribe el valor del anticipo.'; end if;
  if p_amount > 9999999999 then raise exception 'El valor es demasiado alto.'; end if;
  if v_given > now() + interval '5 minutes' then raise exception 'La fecha en que salió el dinero no puede ser futura.'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe para qué fue o quién lo recibió (mínimo 3 letras).'; end if;
  if coalesce(p_method, 'cash') not in ('cash', 'transfer', 'nequi', 'other') then raise exception 'Forma de entrega no válida.'; end if;
  if p_support_url is not null and p_support_url !~ '^https?://' then raise exception 'El soporte debe ser un enlace válido.'; end if;
  if p_beneficiary is not null and not exists (
    select 1 from public.erp_beneficiaries b where b.id = p_beneficiary and b.store_id = p_store and b.point_id is not distinct from p_point) then
    raise exception 'Ese beneficiario no es de este pozo.';
  end if;

  v_num := public.erp_next_number(p_store, 'settlement_advance');
  insert into public.erp_settlement_advances (store_id, point_id, number, beneficiary_id, amount, given_at, method, reference, note, support_url, created_by, created_by_name)
  values (p_store, p_point, v_num, p_beneficiary, round(p_amount, 2), v_given, coalesce(p_method, 'cash'),
          nullif(left(btrim(coalesce(p_reference, '')), 120), ''), left(btrim(p_note), 500), nullif(btrim(coalesce(p_support_url, '')), ''),
          auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'settlement.advance_created', 'erp_settlement_advances', v_id,
    jsonb_build_object('number', v_num, 'point_id', p_point, 'beneficiary_id', p_beneficiary, 'amount', p_amount, 'given_at', v_given, 'note', p_note));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end;
$$;
revoke all on function public.erp_settlement_advance_save(uuid, uuid, uuid, numeric, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.erp_settlement_advance_save(uuid, uuid, uuid, numeric, timestamptz, text, text, text, text) to authenticated;

-- Aprobar o rechazar (otra persona; el dueño puede aprobar lo suyo).
create or replace function public.erp_settlement_advance_decide(p_id uuid, p_action text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.erp_settlement_advances; v_owner boolean;
begin
  select * into a from public.erp_settlement_advances where id = p_id for update;
  if not found then raise exception 'Anticipo no encontrado.'; end if;
  if not public.erp_can(a.store_id, 'profit_settle_approve') then raise exception 'Necesitas el permiso «Aprobar liquidaciones».'; end if;
  if not public.erp__pool_allowed(a.store_id, a.point_id) then raise exception 'No tienes acceso a este pozo.'; end if;
  if a.status <> 'pending' then raise exception 'Este anticipo ya se decidió.'; end if;
  v_owner := exists (select 1 from public.stores st where st.id = a.store_id and st.owner_id = auth.uid());
  if p_action = 'approve' then
    if a.created_by = auth.uid() and not v_owner then raise exception 'Otra persona debe aprobar el anticipo que tú registraste.'; end if;
    update public.erp_settlement_advances set status = 'approved', decided_by = auth.uid(), decided_by_name = public.erp_actor_name(a.store_id),
           decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  elsif p_action = 'reject' then
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
    update public.erp_settlement_advances set status = 'rejected', decided_by = auth.uid(), decided_by_name = public.erp_actor_name(a.store_id),
           decided_at = now(), decision_note = btrim(p_note) where id = p_id;
  else
    raise exception 'Acción no válida.';
  end if;
  perform public.erp_audit(a.store_id, 'settlement.advance_' || p_action, 'erp_settlement_advances', p_id,
    jsonb_build_object('number', a.number, 'amount', a.amount, 'note', p_note));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_settlement_advance_decide(uuid, text, text) from public, anon;
grant execute on function public.erp_settlement_advance_decide(uuid, text, text) to authenticated;

-- Anular (por error). Si ya se descontó en una liquidación vigente, primero hay que revertir o rechazar esa liquidación.
create or replace function public.erp_settlement_advance_void(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.erp_settlement_advances; v_num bigint;
begin
  select * into a from public.erp_settlement_advances where id = p_id for update;
  if not found then raise exception 'Anticipo no encontrado.'; end if;
  if not public.erp__pool_allowed(a.store_id, a.point_id) then raise exception 'No tienes acceso a este pozo.'; end if;
  if a.status in ('rejected', 'voided') then raise exception 'Este anticipo ya no está vigente.'; end if;
  if not (public.erp_can(a.store_id, 'profit_settle_approve')
          or (a.status = 'pending' and a.created_by = auth.uid() and public.erp_can(a.store_id, 'profit_settle'))) then
    raise exception 'Necesitas el permiso «Aprobar liquidaciones» (o haberlo registrado tú y que siga sin aprobar).';
  end if;
  select st.number into v_num from public.erp_settlement_advance_uses u join public.erp_settlements st on st.id = u.settlement_id
  where u.advance_id = p_id and st.status not in ('rejected', 'reverted') limit 1;
  if v_num is not null then raise exception 'Ya se descontó en la liquidación #%. Recházala o reviértela primero.', v_num; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  update public.erp_settlement_advances set status = 'voided', voided_by = auth.uid(), voided_by_name = public.erp_actor_name(a.store_id),
         voided_at = now(), void_reason = btrim(p_reason) where id = p_id;
  perform public.erp_audit(a.store_id, 'settlement.advance_voided', 'erp_settlement_advances', p_id,
    jsonb_build_object('number', a.number, 'amount', a.amount, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_settlement_advance_void(uuid, text) from public, anon;
grant execute on function public.erp_settlement_advance_void(uuid, text) to authenticated;

-- Todos los anticipos del pozo con su estado: por aprobar, por descontar, descontado en #N, rechazado, anulado.
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
           a.created_by, a.created_by_name, a.created_at, a.decided_by_name, a.decided_at, a.decision_note, a.voided_by_name, a.voided_at, a.void_reason,
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

notify pgrst, 'reload schema';
