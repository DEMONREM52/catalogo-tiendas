-- =====================================================================
-- REMHUB · Liquidar la GANANCIA TOTAL de cada punto (venta − costo)
--
-- Decisiones del dueño (2026-10-16):
--   · Cada punto puede repartir la ganancia TOTAL de sus ventas: precio de
--     venta − costo al momento de la venta (el que quedó guardado en la foto
--     de la venta; con crédito de traslados es el costo propio del punto).
--     Antes el punto solo repartía lo que agregaba sobre el precio de la madre.
--   · La madre NO se lleva nada de esas ventas, salvo que se la agregue como
--     beneficiaria de ese punto (en «Beneficiarios»).
--   · Restar gastos es OPCIONAL por punto: encendido, la liquidación muestra
--     ganancia bruta − gastos (y nómina) = ganancia a repartir; apagado, solo
--     se reparte la ganancia.
--   · Productos vendidos SIN costo bloquean la liquidación (la ganancia saldría
--     inflada) hasta ponerles costo; hay un botón para tomar el costo actual.
--   · Todo se aplica desde una fecha (por defecto, desde hoy): las ventas y
--     gastos anteriores no se mueven. Lo ya liquidado no cambia.
-- Requiere 20261106, 20261109 y 20261110. No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- configuración por pozo
create table if not exists public.erp_pool_settings (
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade,  -- null = pozo de la madre
  mode text not null default 'margin' check (mode in ('margin', 'total')),
  mode_from timestamptz not null default now(),
  deduct_expenses boolean not null default false,
  deduct_from timestamptz not null default now(),
  updated_by uuid, updated_by_name text, updated_at timestamptz not null default now()
);
create unique index if not exists erp_pool_settings_pool on public.erp_pool_settings (store_id, coalesce(point_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.erp_pool_settings enable row level security;
revoke all on public.erp_pool_settings from anon, authenticated;

-- Períodos en que cada punto liquidó por ganancia total: cada venta usa la regla vigente cuando se hizo
-- (cambiar el modo nunca recalcula ventas viejas).
create table if not exists public.erp_pool_mode_periods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id) on delete cascade,
  mode text not null default 'total' check (mode = 'total'),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists erp_pool_mode_periods_point on public.erp_pool_mode_periods (store_id, point_id, started_at);
alter table public.erp_pool_mode_periods enable row level security;
revoke all on public.erp_pool_mode_periods from anon, authenticated;

alter table public.erp_settlements add column if not exists gross_total numeric(14, 2);
alter table public.erp_settlements add column if not exists expenses_total numeric(14, 2) not null default 0;
alter table public.erp_settlements add column if not exists mode text;
alter table public.erp_settlements add column if not exists deducted boolean not null default false;

-- Gastos y nóminas que se restaron en cada liquidación (cada uno se resta una sola vez).
create table if not exists public.erp_settlement_expenses (
  settlement_id uuid not null references public.erp_settlements(id) on delete cascade,
  source_type text not null check (source_type in ('expense', 'payroll')),
  source_id uuid not null,
  eligible numeric(14, 2) not null,
  delta numeric(14, 2) not null,
  label text,
  primary key (settlement_id, source_type, source_id)
);
create index if not exists erp_settlement_expenses_source on public.erp_settlement_expenses (source_type, source_id);
alter table public.erp_settlement_expenses enable row level security;
revoke all on public.erp_settlement_expenses from anon, authenticated;

-- ---------------------------------------------------------------- cálculos
-- Lo liquidable de cada venta para un pozo, hasta una fecha de corte.
--   Punto en modo «total» (desde su fecha): ganancia completa (venta − costo).
--   Punto en modo «margen»: lo que agrega sobre el precio de la madre (como antes).
--   Madre: su parte de las ventas, menos las de puntos en modo «total» (esas son del punto).
create or replace function public.erp__pool_eligible(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns table (order_id uuid, eligible numeric)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select f.order_id, f.point_id, sum(f.mother_amount) as m, sum(f.point_amount) as pt, sum(f.profit) as pr
    from public.erp_sale_finance f
    where f.store_id = p_store and (p_point is null or f.point_id = p_point)
    group by f.order_id, f.point_id
  ),
  t as (
    -- ¿La venta se hizo mientras su punto liquidaba por ganancia total?
    select f.*, ord.status, coalesce(ord.confirmed_at, ord.created_at) as sold_at,
           exists (select 1 from public.erp_pool_mode_periods mp
                   where mp.store_id = p_store and mp.point_id = f.point_id
                     and coalesce(ord.confirmed_at, ord.created_at) >= mp.started_at
                     and (mp.ended_at is null or coalesce(ord.confirmed_at, ord.created_at) < mp.ended_at)) as total_mode
    from f join public.orders ord on ord.id = f.order_id
  ),
  o as (
    select t.order_id, t.status, t.sold_at,
           sum(case when p_point is null then case when t.total_mode then 0 else t.m end
                    else case when t.total_mode then t.pr else t.pt end end) as amt,
           (select sum(r.total) from public.erp_receivables r where r.order_id = t.order_id and r.status <> 'void') as rt,
           (select sum(r.balance) from public.erp_receivables r where r.order_id = t.order_id and r.status <> 'void') as rb
    from t
    group by t.order_id, t.status, t.sold_at
  )
  select o.order_id,
         case when o.status not in ('confirmed', 'completed') then 0
              when o.rt is null or o.rt <= 0 then round(o.amt, 2)
              else round(o.amt * greatest(0, least(1, (o.rt - coalesce(o.rb, 0)) / o.rt)), 2) end
  from o
  where o.sold_at <= p_cutoff;
$$;
revoke all on function public.erp__pool_eligible(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Gastos y nóminas del pozo que se restan (solo si el pozo lo tiene encendido, desde su fecha).
-- Anulados valen 0: si ya se habían restado, la siguiente liquidación los devuelve.
create or replace function public.erp__pool_expenses(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns table (source_type text, source_id uuid, eligible numeric, label text, dated date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from timestamptz;
begin
  select ps.deduct_from into v_from from public.erp_pool_settings ps
  where ps.store_id = p_store and ps.point_id is not distinct from p_point and ps.deduct_expenses;
  if v_from is null then return; end if;
  return query
    select 'expense'::text, e.id, (case when e.status = 'void' then 0 else e.amount end)::numeric,
           ('Gasto #' || e.number || ' · ' || e.description)::text, e.incurred_on
    from public.erp_expenses e
    where e.store_id = p_store and e.point_id is not distinct from p_point
      and e.incurred_on >= (v_from at time zone 'America/Bogota')::date and e.incurred_on <= (p_cutoff at time zone 'America/Bogota')::date
    union all
    select 'payroll'::text, r.id, (case when r.status = 'void' then 0 else r.total_cost end)::numeric,
           ('Nómina #' || r.number || ' · ' || to_char(r.period_start, 'DD/MM') || '–' || to_char(r.period_end, 'DD/MM/YYYY'))::text, r.period_end
    from public.erp_payroll_runs r
    where r.store_id = p_store and r.point_id is not distinct from p_point and r.status in ('approved', 'partial', 'paid', 'void')
      and r.period_end >= (v_from at time zone 'America/Bogota')::date and r.period_end <= (p_cutoff at time zone 'America/Bogota')::date;
end;
$$;
revoke all on function public.erp__pool_expenses(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Cálculo completo (sin guardar): ventas nuevas, gastos a restar, saldos traídos, reparto y productos sin costo.
create or replace function public.erp__settlement_compute(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare sp public.erp_profit_splits; ps public.erp_pool_settings; v_sources jsonb; v_gross numeric; v_carry jsonb; v_lines jsonb; v_carry_total numeric;
        v_exp jsonb; v_exp_total numeric := 0; v_total numeric; v_no_cost jsonb;
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

  with shares as (select * from public.erp__distribute(v_total, coalesce(sp.shares, '[]'::jsonb))),
  carry as (select (c->>'beneficiary_id')::uuid as b, sum((c->>'amount')::numeric) as amt from jsonb_array_elements(v_carry) c group by 1),
  allb as (select beneficiary_id as b from shares union select b from carry)
  select coalesce(jsonb_agg(jsonb_build_object(
           'beneficiary_id', a.b, 'name', bf.name, 'kind', bf.kind,
           'pct', coalesce(sh.pct, 0), 'share_amount', coalesce(sh.amount, 0), 'carried_amount', coalesce(cr.amt, 0),
           'amount', coalesce(sh.amount, 0) + coalesce(cr.amt, 0)) order by coalesce(sh.pct, 0) desc, bf.name), '[]'::jsonb)
  into v_lines
  from allb a
  left join shares sh on sh.beneficiary_id = a.b
  left join carry cr on cr.b = a.b
  left join public.erp_beneficiaries bf on bf.id = a.b;

  return jsonb_build_object(
    'pool_total', v_total,
    'gross_total', v_gross,
    'expenses_total', v_exp_total,
    'mode', case when p_point is null then 'mother' else coalesce(ps.mode, 'margin') end,
    'deduct', coalesce(ps.deduct_expenses, false),
    'carried_total', v_carry_total,
    'split_id', sp.id,
    'split_version', sp.version,
    'split_pct', coalesce(sp.total_pct, 0),
    'assigned_total', (select coalesce(sum((x->>'share_amount')::numeric), 0) from jsonb_array_elements(v_lines) x),
    'sources', v_sources,
    'expenses', v_exp,
    'no_cost', v_no_cost,
    'carry', v_carry,
    'lines', v_lines
  );
end;
$$;
revoke all on function public.erp__settlement_compute(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- API
-- Cómo reparte un pozo (solo la tienda madre con permiso de repartos).
create or replace function public.erp_pool_settings_save(p_store uuid, p_point uuid, p_mode text, p_mode_from timestamptz,
                                                        p_deduct boolean, p_deduct_from timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_mode text := lower(btrim(coalesce(p_mode, 'margin'))); old public.erp_pool_settings; v_last timestamptz; v_from timestamptz; v_dfrom timestamptz;
begin
  if not (public.erp_can(p_store, 'profit_beneficiaries') or public.erp_can(p_store, 'profit_settle')) or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la tienda madre con permiso de repartos decide cómo se liquida cada pozo.';
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  if v_mode not in ('margin', 'total') then raise exception 'Modo inválido.'; end if;
  if p_point is null and v_mode = 'total' then raise exception 'El modo «ganancia total» es para los puntos.'; end if;
  if exists (select 1 from public.erp_settlements where store_id = p_store and point_id is not distinct from p_point and status in ('calculated', 'review')) then
    raise exception 'Hay una liquidación abierta en este pozo: termínala o descártala antes de cambiar cómo se liquida.';
  end if;
  select * into old from public.erp_pool_settings where store_id = p_store and point_id is not distinct from p_point;
  -- Cambió el modo: se cierra el período de «ganancia total» abierto y, si corresponde, se abre uno nuevo
  -- desde la fecha escogida. Las ventas de antes siguen con la regla que tenían.
  -- La fecha nunca queda antes del último corte liquidado de este pozo: lo ya liquidado no cambia.
  select max(cutoff) into v_last from public.erp_settlements
  where store_id = p_store and point_id is not distinct from p_point and status not in ('rejected', 'reverted');
  v_from := greatest(coalesce(p_mode_from, now()), coalesce(v_last, '-infinity'::timestamptz));
  v_dfrom := greatest(coalesce(p_deduct_from, now()), coalesce(v_last, '-infinity'::timestamptz));
  if p_point is not null and coalesce(old.mode, 'margin') is distinct from v_mode then
    update public.erp_pool_mode_periods set ended_at = greatest(started_at, v_from)
    where store_id = p_store and point_id = p_point and ended_at is null;
    if v_mode = 'total' then
      insert into public.erp_pool_mode_periods (store_id, point_id, started_at, created_by, created_by_name)
      values (p_store, p_point, v_from, auth.uid(), public.erp_actor_name(p_store));
    end if;
  end if;
  p_mode_from := case when p_mode_from is null then null else v_from end;
  p_deduct_from := case when p_deduct_from is null then null else v_dfrom end;
  insert into public.erp_pool_settings (store_id, point_id, mode, mode_from, deduct_expenses, deduct_from, updated_by, updated_by_name, updated_at)
  values (p_store, p_point, v_mode, v_from, coalesce(p_deduct, false), v_dfrom,
          auth.uid(), public.erp_actor_name(p_store), now())
  on conflict (store_id, coalesce(point_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
    mode = excluded.mode,
    -- La fecha solo cambia si cambió el modo o si se escribió otra a propósito.
    mode_from = case when public.erp_pool_settings.mode is distinct from excluded.mode or p_mode_from is not null then excluded.mode_from else public.erp_pool_settings.mode_from end,
    deduct_expenses = excluded.deduct_expenses,
    deduct_from = case when public.erp_pool_settings.deduct_expenses is distinct from excluded.deduct_expenses or p_deduct_from is not null then excluded.deduct_from else public.erp_pool_settings.deduct_from end,
    updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
  perform public.erp_audit(p_store, 'pool.settings', 'erp_pool_settings', null,
    jsonb_build_object('point_id', p_point, 'mode', v_mode, 'mode_from', p_mode_from, 'deduct', p_deduct, 'deduct_from', p_deduct_from,
                       'before', case when old.store_id is null then null else jsonb_build_object('mode', old.mode, 'deduct', old.deduct_expenses) end));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_pool_settings_save(uuid, uuid, text, timestamptz, boolean, timestamptz) from public, anon;
grant execute on function public.erp_pool_settings_save(uuid, uuid, text, timestamptz, boolean, timestamptz) to authenticated;

-- Resumen de un pozo (igual que antes + cómo se liquida, ganancia bruta, gastos y productos sin costo).
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
                                  'orders', jsonb_array_length(v_preview->'sources'), 'expenses', jsonb_array_length(v_preview->'expenses'),
                                  'no_cost', v_preview->'no_cost', 'lines', v_preview->'lines'),
    'open_settlement', case when v_open.id is null then null else jsonb_build_object('id', v_open.id, 'number', v_open.number, 'status', v_open.status) end,
    'can', jsonb_build_object('beneficiaries', public.erp_can(p_store, 'profit_beneficiaries'), 'settle', public.erp_can(p_store, 'profit_settle'),
                              'approve', public.erp_can(p_store, 'profit_settle_approve'), 'pay', public.erp_can(p_store, 'profit_pay'))
  );
end;
$$;
revoke all on function public.erp_pool_overview(uuid, uuid) from public, anon;
grant execute on function public.erp_pool_overview(uuid, uuid) to authenticated;

-- Preparar la liquidación (igual que antes + gastos y bloqueo por productos sin costo).
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
  if (c->>'pool_total')::numeric = 0 and (c->>'carried_total')::numeric = 0 and (c->>'gross_total')::numeric = 0 and (c->>'expenses_total')::numeric = 0 then
    raise exception 'No hay nada nuevo por liquidar hasta esa fecha.';
  end if;

  v_num := public.erp_next_number(p_store, 'settlement');
  insert into public.erp_settlements (store_id, point_id, number, cutoff, status, pool_total, carried_total, assigned_total, unassigned_total,
                                      sources_count, split_id, notes, created_by, created_by_name, gross_total, expenses_total, mode, deducted)
  values (p_store, p_point, v_num, v_cutoff, 'calculated', (c->>'pool_total')::numeric, (c->>'carried_total')::numeric, (c->>'assigned_total')::numeric,
          (c->>'pool_total')::numeric - (c->>'assigned_total')::numeric, jsonb_array_length(c->'sources'), (c->>'split_id')::uuid,
          nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), public.erp_actor_name(p_store),
          (c->>'gross_total')::numeric, (c->>'expenses_total')::numeric, c->>'mode', (c->>'deduct')::boolean)
  returning id into v_id;

  insert into public.erp_settlement_sources (settlement_id, order_id, eligible, delta)
  select v_id, (s->>'order_id')::uuid, (s->>'eligible')::numeric, (s->>'delta')::numeric from jsonb_array_elements(c->'sources') s;

  insert into public.erp_settlement_expenses (settlement_id, source_type, source_id, eligible, delta, label)
  select v_id, x->>'source_type', (x->>'source_id')::uuid, (x->>'eligible')::numeric, (x->>'delta')::numeric, x->>'label'
  from jsonb_array_elements(c->'expenses') x;

  insert into public.erp_settlement_lines (settlement_id, beneficiary_id, pct, share_amount, carried_amount, amount)
  select v_id, (l->>'beneficiary_id')::uuid, (l->>'pct')::numeric, (l->>'share_amount')::numeric, (l->>'carried_amount')::numeric, (l->>'amount')::numeric
  from jsonb_array_elements(c->'lines') l;

  update public.erp_settlement_lines set carried_into = v_id
  where id in (select (x->>'line_id')::uuid from jsonb_array_elements(c->'carry') x);

  perform public.erp_audit(p_store, 'settlement.calculated', 'erp_settlements', v_id,
    jsonb_build_object('number', v_num, 'point_id', p_point, 'cutoff', v_cutoff, 'pool_total', c->'pool_total', 'gross_total', c->'gross_total',
                       'expenses_total', c->'expenses_total', 'mode', c->'mode', 'carried_total', c->'carried_total',
                       'sources', jsonb_array_length(c->'sources'), 'split_version', c->'split_version'));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end;
$$;
revoke all on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) to authenticated;

-- Detalle por producto: lo pendiente (p_settlement null, hasta p_cutoff) o una liquidación ya hecha.
-- Cada venta trae sus productos (venta, costo, ganancia y lo que cuenta para el pozo) y la parte que entra
-- (entra / completo: en ventas a crédito solo entra lo cobrado). También los gastos restados.
create or replace function public.erp_settlement_breakdown(p_store uuid, p_point uuid, p_cutoff timestamptz, p_settlement uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.erp_settlements; c jsonb; v_src jsonb; v_exp jsonb; st_mode text; st_from timestamptz;
begin
  if p_settlement is not null then
    select * into s from public.erp_settlements where id = p_settlement;
    if not found then raise exception 'Liquidación no encontrada.'; end if;
    p_store := s.store_id; p_point := s.point_id;
  end if;
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_settle') or public.erp_can(p_store, 'profit_settle_approve') or public.erp_can(p_store, 'profit_pay')) then
    raise exception 'No tienes permiso para ver liquidaciones.';
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;

  if p_settlement is null then
    c := public.erp__settlement_compute(p_store, p_point, least(coalesce(p_cutoff, now()), now()));
    v_src := c->'sources'; v_exp := c->'expenses';
  else
    select coalesce(jsonb_agg(jsonb_build_object('order_id', ss.order_id, 'eligible', ss.eligible, 'delta', ss.delta)), '[]'::jsonb) into v_src
    from public.erp_settlement_sources ss where ss.settlement_id = s.id;
    select coalesce(jsonb_agg(jsonb_build_object('source_type', se.source_type, 'source_id', se.source_id, 'eligible', se.eligible, 'delta', se.delta, 'label', se.label)), '[]'::jsonb)
    into v_exp from public.erp_settlement_expenses se where se.settlement_id = s.id;
  end if;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', o.id, 'receipt_no', o.receipt_no, 'doc_number', m.doc_number, 'sold_at', coalesce(o.confirmed_at, o.created_at),
               'point_name', w.name, 'seller_name', m.seller_name, 'customer_name', o.customer_name,
               'delta', (x->>'delta')::numeric, 'eligible', (x->>'eligible')::numeric,
               'credit', exists (select 1 from public.erp_receivables r where r.order_id = o.id and r.status <> 'void'),
               'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                           'product_id', f.product_id, 'name', p.name, 'sku', p.sku, 'qty', f.qty, 'revenue', f.revenue, 'cost', f.cost_total,
                           'profit', f.profit, 'mother', f.mother_amount, 'point', f.point_amount, 'cost_source', f.cost_source) order by p.name), '[]'::jsonb)
                         from public.erp_sale_finance f join public.products p on p.id = f.product_id
                         where f.order_id = o.id and (p_point is null or f.point_id = p_point))
             ) order by coalesce(o.confirmed_at, o.created_at) desc)
      from jsonb_array_elements(v_src) x
      join public.orders o on o.id = (x->>'order_id')::uuid
      left join public.erp_order_meta m on m.order_id = o.id
      left join public.erp_warehouses w on w.id = m.point_id), '[]'::jsonb),
    'expenses', v_exp,
    'mode', case when p_point is null then 'mother' else coalesce((select mode from public.erp_pool_settings where store_id = p_store and point_id = p_point), 'margin') end
  );
end;
$$;
revoke all on function public.erp_settlement_breakdown(uuid, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.erp_settlement_breakdown(uuid, uuid, timestamptz, uuid) to authenticated;

-- Ventas que quedaron sin costo: toma el costo ACTUAL del producto (el promedio) para corregir su ganancia.
-- Queda marcado como «costo puesto después» y en auditoría. Si esa venta ya entró en una liquidación, la diferencia
-- sale sola como ajuste en la siguiente (así nunca se cuenta dos veces).
create or replace function public.erp_sale_finance_fix_costs(p_store uuid, p_point uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer := 0; v_left integer := 0;
begin
  if not public.erp_can(p_store, 'profit_settle') then raise exception 'Necesitas el permiso «Preparar liquidaciones».'; end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  with fix as (
    update public.erp_sale_finance f set
      unit_cost = p.cost_price,
      cost_total = round(f.qty * p.cost_price, 2),
      profit = f.revenue - round(f.qty * p.cost_price, 2),
      mother_amount = (f.revenue - round(f.qty * p.cost_price, 2)) - f.point_amount,
      cost_source = 'fixed_later'
    from public.products p
    where p.id = f.product_id and f.store_id = p_store and (p_point is null or f.point_id = p_point)
      and coalesce(f.cost_total, 0) <= 0 and f.revenue > 0 and coalesce(p.cost_price, 0) > 0
    returning f.order_id
  )
  select count(*) into v_n from fix;
  select count(*) into v_left from public.erp_sale_finance f
  where f.store_id = p_store and (p_point is null or f.point_id = p_point) and coalesce(f.cost_total, 0) <= 0 and f.revenue > 0;
  perform public.erp_audit(p_store, 'sale_finance.fix_costs', 'erp_sale_finance', null, jsonb_build_object('point_id', p_point, 'fixed', v_n, 'left', v_left));
  return jsonb_build_object('ok', true, 'fixed', v_n, 'left', v_left);
end;
$$;
revoke all on function public.erp_sale_finance_fix_costs(uuid, uuid) from public, anon;
grant execute on function public.erp_sale_finance_fix_costs(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
