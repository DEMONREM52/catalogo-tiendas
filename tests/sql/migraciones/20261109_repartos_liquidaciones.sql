-- =====================================================================
-- REMHUB · Centro de rentabilidad — Repartos y liquidaciones
--
-- Pozos independientes:
--   · Pozo de la MADRE: la parte de la madre de todas las ventas
--     (precio de la madre − costo).
--   · Pozo de cada PUNTO: la parte de ese punto (precio del punto −
--     precio de la madre). No tiene nada que ver con el pozo de la madre.
-- Cada pozo tiene sus beneficiarios (3, 4, 8… los que se necesiten) y un
-- reparto en % con versiones. Lo no asignado queda visible.
--
-- Qué se liquida (decisión de la tienda): ventas de contado confirmadas y,
-- de las ventas a crédito, solo la parte ya cobrada. Una venta anulada
-- vale 0: si ya se había liquidado, la diferencia entra como ajuste en la
-- siguiente liquidación. Solo ventas con foto financiera (desde 20261106).
--
-- Ciclo: calculada → en revisión → aprobada → pago parcial → pagada.
-- También: rechazada/descartada y revertida (solo sin pagos).
-- Una sola liquidación abierta por pozo; pagos idempotentes; nada se borra.
--
-- Permisos nuevos: profit_beneficiaries (beneficiarios y repartos),
-- profit_settle (preparar liquidaciones), profit_settle_approve (aprobar,
-- rechazar, revertir, anular pagos), profit_pay (registrar pagos).
-- Un usuario con punto asignado solo maneja el pozo de sus puntos; el pozo
-- de la madre solo lo maneja la madre (usuarios sin punto).
--
-- Requiere 20261106. No borra ni cambia datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'suppliers', 'payables', 'audit', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit',
    'profit_view', 'profit_rules', 'profit_approve',
    'profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay'
  ]::text[];
$$;

-- Configuración: también la leen quienes solo manejan repartos y liquidaciones (para saber sus puntos).
create or replace function public.erp_profit_settings_get(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.erp_profit_settings;
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_rules') or public.erp_can(p_store, 'profit_approve') or public.erp_can(p_store, 'pos')
          or public.erp_can(p_store, 'profit_beneficiaries') or public.erp_can(p_store, 'profit_settle')
          or public.erp_can(p_store, 'profit_settle_approve') or public.erp_can(p_store, 'profit_pay')) then
    raise exception 'No tienes permiso para ver la configuración de rentabilidad.';
  end if;
  select * into s from public.erp_profit_settings where store_id = p_store;
  return jsonb_build_object(
    'point_mode', coalesce(s.point_mode, 'chained'),
    'rounding_step', coalesce(s.rounding_step, 0),
    'rounding_dir', coalesce(s.rounding_dir, 'nearest'),
    'point_min_pct', coalesce(s.point_min_pct, 0),
    'point_max_pct', coalesce(s.point_max_pct, 100),
    'require_approval', coalesce(s.require_approval, true),
    'price_guard', coalesce(s.price_guard, 'observe'),
    'updated_by_name', s.updated_by_name,
    'updated_at', s.updated_at,
    'can_edit', public.erp_can(p_store, 'profit_approve') and public.erp_my_points(p_store) is null,
    'can_rules', public.erp_can(p_store, 'profit_rules'),
    'can_approve', public.erp_can(p_store, 'profit_approve'),
    'can_view', public.erp_can(p_store, 'profit_view'),
    'my_points', to_jsonb(public.erp_my_points(p_store))
  );
end;
$$;
revoke all on function public.erp_profit_settings_get(uuid) from public, anon;
grant execute on function public.erp_profit_settings_get(uuid) to authenticated;

-- ¿Puede este usuario manejar este pozo? (madre: solo usuarios sin punto; punto: sus puntos)
create or replace function public.erp__pool_allowed(p_store uuid, p_point uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_point is null then public.erp_my_points(p_store) is null and public.erp__is_store_member(p_store)
    else exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store) and public.erp_point_allowed(p_store, p_point)
  end;
$$;
revoke all on function public.erp__pool_allowed(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- beneficiarios y repartos
create table if not exists public.erp_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade, -- null = pozo de la madre
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind text not null default 'partner' check (kind in ('owner', 'partner', 'manager', 'point', 'person', 'other')),
  document text,
  user_id uuid,
  notes text,
  active boolean not null default true,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists erp_beneficiaries_pool on public.erp_beneficiaries (store_id, point_id);
alter table public.erp_beneficiaries enable row level security;
revoke all on public.erp_beneficiaries from anon, authenticated;

create table if not exists public.erp_profit_splits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade,
  version integer not null,
  shares jsonb not null,            -- [{beneficiary_id, pct}]
  total_pct numeric(9, 4) not null check (total_pct between 0 and 100),
  reason text not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists erp_profit_splits_version on public.erp_profit_splits (store_id, coalesce(point_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
alter table public.erp_profit_splits enable row level security;
revoke all on public.erp_profit_splits from anon, authenticated;

-- ---------------------------------------------------------------- liquidaciones
create table if not exists public.erp_settlements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id), -- null = pozo de la madre
  number bigint not null,
  cutoff timestamptz not null,
  status text not null default 'calculated'
    check (status in ('calculated', 'review', 'approved', 'partially_paid', 'paid', 'rejected', 'reverted')),
  pool_total numeric(14, 2) not null,       -- lo que entra en esta liquidación (incluye ajustes)
  carried_total numeric(14, 2) not null default 0, -- saldos negativos traídos de liquidaciones anteriores
  assigned_total numeric(14, 2) not null,
  unassigned_total numeric(14, 2) not null,
  sources_count integer not null default 0,
  split_id uuid references public.erp_profit_splits(id),
  notes text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  submitted_by uuid, submitted_by_name text, submitted_at timestamptz,
  decided_by uuid, decided_by_name text, decided_at timestamptz, decision_note text,
  reverted_by uuid, reverted_by_name text, reverted_at timestamptz, revert_reason text
);
create unique index if not exists erp_settlements_number on public.erp_settlements (store_id, number);
-- Una sola liquidación abierta por pozo (así ninguna venta se cuenta dos veces).
create unique index if not exists erp_settlements_one_open on public.erp_settlements (store_id, coalesce(point_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('calculated', 'review');
create index if not exists erp_settlements_pool on public.erp_settlements (store_id, point_id, created_at desc);
alter table public.erp_settlements enable row level security;
revoke all on public.erp_settlements from anon, authenticated;

create table if not exists public.erp_settlement_sources (
  settlement_id uuid not null references public.erp_settlements(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  eligible numeric(14, 2) not null,  -- lo liquidable de la venta al calcular (acumulado)
  delta numeric(14, 2) not null,     -- lo que entra en esta liquidación (puede ser negativo: ajuste)
  primary key (settlement_id, order_id)
);
create index if not exists erp_settlement_sources_order on public.erp_settlement_sources (order_id);
alter table public.erp_settlement_sources enable row level security;
revoke all on public.erp_settlement_sources from anon, authenticated;

create table if not exists public.erp_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.erp_settlements(id) on delete cascade,
  beneficiary_id uuid not null references public.erp_beneficiaries(id),
  pct numeric(9, 4) not null default 0,
  share_amount numeric(14, 2) not null default 0,
  carried_amount numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null,
  paid numeric(14, 2) not null default 0,
  carried_into uuid references public.erp_settlements(id),
  unique (settlement_id, beneficiary_id),
  check (amount = share_amount + carried_amount),
  check (paid >= 0 and (amount <= 0 or paid <= amount))
);
alter table public.erp_settlement_lines enable row level security;
revoke all on public.erp_settlement_lines from anon, authenticated;

create table if not exists public.erp_settlement_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  settlement_id uuid not null references public.erp_settlements(id),
  line_id uuid not null references public.erp_settlement_lines(id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default 'transfer',
  reference text,
  note text,
  paid_at timestamptz not null default now(),
  idempotency_key text not null,
  voided boolean not null default false,
  voided_by uuid, voided_by_name text, voided_at timestamptz, void_reason text,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  unique (store_id, idempotency_key)
);
alter table public.erp_settlement_payments enable row level security;
revoke all on public.erp_settlement_payments from anon, authenticated;

-- ---------------------------------------------------------------- cálculos
-- Reparte un total entre % con el método del mayor residuo: las partes suman exacto (igual que el motor de la app).
create or replace function public.erp__distribute(p_total numeric, p_shares jsonb)
returns table (beneficiary_id uuid, pct numeric, amount numeric)
language sql
immutable
as $$
  with s as (
    select (e->>'beneficiary_id')::uuid as b, (e->>'pct')::numeric as pct, t.ord
    from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) with ordinality t(e, ord)
  ),
  base as (select abs(round(coalesce(p_total, 0) * 100))::numeric as cents, sign(coalesce(p_total, 0)) as sg, (select coalesce(sum(pct), 0) from s) as sp),
  fl as (
    select s.b, s.pct, s.ord, floor(base.cents * s.pct / 100) as f, (base.cents * s.pct / 100) - floor(base.cents * s.pct / 100) as rem
    from s, base
  ),
  lft as (select round((select cents from base) * (select sp from base) / 100) - coalesce(sum(f), 0) as l from fl),
  ranked as (select fl.*, row_number() over (order by rem desc, ord) as rn from fl)
  select r.b, r.pct, (r.f + case when r.rn <= (select l from lft) then 1 else 0 end) * (select sg from base) / 100
  from ranked r
  order by r.ord;
$$;

-- Lo liquidable de cada venta para un pozo, hasta una fecha de corte.
create or replace function public.erp__pool_eligible(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns table (order_id uuid, eligible numeric)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select f.order_id, sum(case when p_point is null then f.mother_amount else f.point_amount end) as amt
    from public.erp_sale_finance f
    where f.store_id = p_store and (p_point is null or f.point_id = p_point)
    group by f.order_id
  ), o as (
    select f.order_id, f.amt, ord.status, coalesce(ord.confirmed_at, ord.created_at) as sold_at,
           (select sum(r.total) from public.erp_receivables r where r.order_id = f.order_id and r.status <> 'void') as rt,
           (select sum(r.balance) from public.erp_receivables r where r.order_id = f.order_id and r.status <> 'void') as rb
    from f join public.orders ord on ord.id = f.order_id
  )
  select o.order_id,
         case when o.status not in ('confirmed', 'completed') then 0
              when o.rt is null or o.rt <= 0 then round(o.amt, 2)
              else round(o.amt * greatest(0, least(1, (o.rt - coalesce(o.rb, 0)) / o.rt)), 2) end
  from o
  where o.sold_at <= p_cutoff;
$$;
revoke all on function public.erp__pool_eligible(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Cálculo completo (sin guardar): lo nuevo por liquidar, saldos traídos y reparto actual.
create or replace function public.erp__settlement_compute(p_store uuid, p_point uuid, p_cutoff timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare sp public.erp_profit_splits; v_sources jsonb; v_total numeric; v_carry jsonb; v_lines jsonb; v_carry_total numeric;
begin
  select * into sp from public.erp_profit_splits
  where store_id = p_store and point_id is not distinct from p_point order by version desc limit 1;

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
  into v_sources, v_total
  from d;

  -- Saldos negativos de liquidaciones aprobadas/pagadas que aún no se han compensado.
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
    'carried_total', v_carry_total,
    'split_id', sp.id,
    'split_version', sp.version,
    'split_pct', coalesce(sp.total_pct, 0),
    'assigned_total', (select coalesce(sum((x->>'share_amount')::numeric), 0) from jsonb_array_elements(v_lines) x),
    'sources', v_sources,
    'carry', v_carry,
    'lines', v_lines
  );
end;
$$;
revoke all on function public.erp__settlement_compute(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- API: beneficiarios y repartos
create or replace function public.erp_beneficiary_save(
  p_store uuid, p_id uuid, p_point uuid, p_name text, p_kind text, p_document text, p_notes text, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.erp_beneficiaries; before jsonb;
begin
  if not public.erp_can(p_store, 'profit_beneficiaries') then raise exception 'Necesitas el permiso «Beneficiarios y repartos».'; end if;
  if p_id is not null then
    select * into b from public.erp_beneficiaries where id = p_id and store_id = p_store for update;
    if not found then raise exception 'Beneficiario no encontrado.'; end if;
    p_point := b.point_id; -- un beneficiario no cambia de pozo
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then
    raise exception '%', case when p_point is null then 'Solo la tienda madre maneja los beneficiarios de la madre.' else 'Solo puedes manejar los beneficiarios de tus puntos.' end;
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe el nombre del beneficiario.'; end if;
  if coalesce(p_kind, 'partner') not in ('owner', 'partner', 'manager', 'point', 'person', 'other') then raise exception 'Tipo de beneficiario no válido.'; end if;
  if p_id is null then
    insert into public.erp_beneficiaries (store_id, point_id, name, kind, document, notes, active, created_by, created_by_name)
    values (p_store, p_point, upper(btrim(p_name)), coalesce(p_kind, 'partner'), nullif(btrim(coalesce(p_document, '')), ''),
            nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_active, true), auth.uid(), public.erp_actor_name(p_store))
    returning * into b;
    perform public.erp_audit(p_store, 'beneficiary.created', 'erp_beneficiaries', b.id, to_jsonb(b));
  else
    before := to_jsonb(b);
    update public.erp_beneficiaries
    set name = upper(btrim(p_name)), kind = coalesce(p_kind, kind), document = nullif(btrim(coalesce(p_document, '')), ''),
        notes = nullif(btrim(coalesce(p_notes, '')), ''), active = coalesce(p_active, active), updated_at = now()
    where id = p_id returning * into b;
    perform public.erp_audit(p_store, 'beneficiary.updated', 'erp_beneficiaries', b.id, jsonb_build_object('before', before, 'after', to_jsonb(b)));
  end if;
  return jsonb_build_object('ok', true, 'id', b.id);
end;
$$;
revoke all on function public.erp_beneficiary_save(uuid, uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.erp_beneficiary_save(uuid, uuid, uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.erp_split_save(p_store uuid, p_point uuid, p_shares jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_total numeric; v_version integer; v_id uuid; v_bad integer; v_dup integer; v_clean jsonb;
begin
  if not public.erp_can(p_store, 'profit_beneficiaries') then raise exception 'Necesitas el permiso «Beneficiarios y repartos».'; end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No puedes cambiar el reparto de este pozo.'; end if;
  if jsonb_typeof(p_shares) <> 'array' then raise exception 'Reparto no válido.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo del cambio.'; end if;
  select jsonb_agg(jsonb_build_object('beneficiary_id', (e->>'beneficiary_id')::uuid, 'pct', round((e->>'pct')::numeric, 4)))
  into v_clean from jsonb_array_elements(p_shares) e where coalesce((e->>'pct')::numeric, 0) <> 0;
  v_clean := coalesce(v_clean, '[]'::jsonb);
  select count(*) into v_bad from jsonb_array_elements(v_clean) e
  where (e->>'pct')::numeric < 0 or (e->>'pct')::numeric > 100
     or not exists (select 1 from public.erp_beneficiaries b where b.id = (e->>'beneficiary_id')::uuid and b.store_id = p_store
                    and b.point_id is not distinct from p_point and b.active);
  if v_bad > 0 then raise exception 'Cada participación debe estar entre 0 %% y 100 %% y ser de un beneficiario activo de este pozo.'; end if;
  select count(*) - count(distinct e->>'beneficiary_id') into v_dup from jsonb_array_elements(v_clean) e;
  if v_dup > 0 then raise exception 'Un beneficiario aparece dos veces.'; end if;
  select coalesce(sum((e->>'pct')::numeric), 0) into v_total from jsonb_array_elements(v_clean) e;
  if v_total > 100 then raise exception 'Las participaciones suman % %%: no se puede repartir más del 100 %%.', v_total; end if;

  perform pg_advisory_xact_lock(hashtext('split:' || p_store::text || ':' || coalesce(p_point::text, 'madre')));
  select coalesce(max(version), 0) + 1 into v_version from public.erp_profit_splits where store_id = p_store and point_id is not distinct from p_point;
  insert into public.erp_profit_splits (store_id, point_id, version, shares, total_pct, reason, created_by, created_by_name)
  values (p_store, p_point, v_version, v_clean, v_total, btrim(p_reason), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'profit_split.saved', 'erp_profit_splits', v_id,
    jsonb_build_object('point_id', p_point, 'version', v_version, 'shares', v_clean, 'total_pct', v_total, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version, 'total_pct', v_total);
end;
$$;
revoke all on function public.erp_split_save(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.erp_split_save(uuid, uuid, jsonb, text) to authenticated;

-- Resumen de un pozo: beneficiarios, reparto vigente, historial y lo pendiente por liquidar.
create or replace function public.erp_pool_overview(p_store uuid, p_point uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare sp public.erp_profit_splits; v_preview jsonb; v_open public.erp_settlements;
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_beneficiaries') or public.erp_can(p_store, 'profit_settle')
          or public.erp_can(p_store, 'profit_settle_approve') or public.erp_can(p_store, 'profit_pay')) then
    raise exception 'No tienes permiso para ver los repartos.';
  end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No tienes acceso a este pozo.'; end if;
  select * into sp from public.erp_profit_splits where store_id = p_store and point_id is not distinct from p_point order by version desc limit 1;
  v_preview := public.erp__settlement_compute(p_store, p_point, now());
  select * into v_open from public.erp_settlements where store_id = p_store and point_id is not distinct from p_point and status in ('calculated', 'review') limit 1;
  return jsonb_build_object(
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind, 'document', b.document, 'notes', b.notes, 'active', b.active) order by b.active desc, b.name)
                               from public.erp_beneficiaries b where b.store_id = p_store and b.point_id is not distinct from p_point), '[]'::jsonb),
    'split', case when sp.id is null then null else jsonb_build_object('id', sp.id, 'version', sp.version, 'shares', sp.shares, 'total_pct', sp.total_pct,
                     'reason', sp.reason, 'created_by_name', sp.created_by_name, 'created_at', sp.created_at) end,
    'split_history', coalesce((select jsonb_agg(jsonb_build_object('version', x.version, 'total_pct', x.total_pct, 'reason', x.reason, 'created_by_name', x.created_by_name, 'created_at', x.created_at) order by x.version desc)
                               from (select * from public.erp_profit_splits where store_id = p_store and point_id is not distinct from p_point order by version desc limit 20) x), '[]'::jsonb),
    'pending', jsonb_build_object('pool_total', v_preview->'pool_total', 'carried_total', v_preview->'carried_total', 'assigned_total', v_preview->'assigned_total',
                                  'orders', jsonb_array_length(v_preview->'sources'), 'lines', v_preview->'lines'),
    'open_settlement', case when v_open.id is null then null else jsonb_build_object('id', v_open.id, 'number', v_open.number, 'status', v_open.status) end,
    'can', jsonb_build_object('beneficiaries', public.erp_can(p_store, 'profit_beneficiaries'), 'settle', public.erp_can(p_store, 'profit_settle'),
                              'approve', public.erp_can(p_store, 'profit_settle_approve'), 'pay', public.erp_can(p_store, 'profit_pay'))
  );
end;
$$;
revoke all on function public.erp_pool_overview(uuid, uuid) from public, anon;
grant execute on function public.erp_pool_overview(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- API: liquidaciones
create or replace function public.erp_settlement_calculate(p_store uuid, p_point uuid, p_cutoff timestamptz, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c jsonb; v_id uuid; v_num bigint; v_cutoff timestamptz := least(coalesce(p_cutoff, now()), now());
begin
  if not public.erp_can(p_store, 'profit_settle') then raise exception 'Necesitas el permiso «Preparar liquidaciones».'; end if;
  if not public.erp__pool_allowed(p_store, p_point) then raise exception 'No puedes liquidar este pozo.'; end if;
  perform pg_advisory_xact_lock(hashtext('settle:' || p_store::text || ':' || coalesce(p_point::text, 'madre')));
  if exists (select 1 from public.erp_settlements where store_id = p_store and point_id is not distinct from p_point and status in ('calculated', 'review')) then
    raise exception 'Ya hay una liquidación abierta para este pozo. Termínala o descártala primero.';
  end if;
  c := public.erp__settlement_compute(p_store, p_point, v_cutoff);
  if c->>'split_id' is null then raise exception 'Primero define el reparto (beneficiarios y porcentajes) de este pozo.'; end if;
  if (c->>'pool_total')::numeric = 0 and (c->>'carried_total')::numeric = 0 then raise exception 'No hay nada nuevo por liquidar hasta esa fecha.'; end if;

  v_num := public.erp_next_number(p_store, 'settlement');
  insert into public.erp_settlements (store_id, point_id, number, cutoff, status, pool_total, carried_total, assigned_total, unassigned_total,
                                      sources_count, split_id, notes, created_by, created_by_name)
  values (p_store, p_point, v_num, v_cutoff, 'calculated', (c->>'pool_total')::numeric, (c->>'carried_total')::numeric, (c->>'assigned_total')::numeric,
          (c->>'pool_total')::numeric - (c->>'assigned_total')::numeric, jsonb_array_length(c->'sources'), (c->>'split_id')::uuid,
          nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;

  insert into public.erp_settlement_sources (settlement_id, order_id, eligible, delta)
  select v_id, (s->>'order_id')::uuid, (s->>'eligible')::numeric, (s->>'delta')::numeric from jsonb_array_elements(c->'sources') s;

  insert into public.erp_settlement_lines (settlement_id, beneficiary_id, pct, share_amount, carried_amount, amount)
  select v_id, (l->>'beneficiary_id')::uuid, (l->>'pct')::numeric, (l->>'share_amount')::numeric, (l->>'carried_amount')::numeric, (l->>'amount')::numeric
  from jsonb_array_elements(c->'lines') l;

  update public.erp_settlement_lines set carried_into = v_id
  where id in (select (x->>'line_id')::uuid from jsonb_array_elements(c->'carry') x);

  perform public.erp_audit(p_store, 'settlement.calculated', 'erp_settlements', v_id,
    jsonb_build_object('number', v_num, 'point_id', p_point, 'cutoff', v_cutoff, 'pool_total', c->'pool_total', 'carried_total', c->'carried_total',
                       'sources', jsonb_array_length(c->'sources'), 'split_version', c->'split_version'));
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end;
$$;
revoke all on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.erp_settlement_calculate(uuid, uuid, timestamptz, text) to authenticated;

-- Cambiar de estado (enviar a revisión, aprobar, rechazar/descartar, revertir).
create or replace function public.erp_settlement_transition(p_id uuid, p_action text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public.erp_settlements; v_owner boolean; v_paid numeric; v_next text;
begin
  select * into s from public.erp_settlements where id = p_id for update;
  if not found then raise exception 'Liquidación no encontrada.'; end if;
  if not public.erp__pool_allowed(s.store_id, s.point_id) then raise exception 'No tienes acceso a este pozo.'; end if;
  v_owner := exists (select 1 from public.stores st where st.id = s.store_id and st.owner_id = auth.uid());

  if p_action = 'submit' then
    if not public.erp_can(s.store_id, 'profit_settle') then raise exception 'Necesitas el permiso «Preparar liquidaciones».'; end if;
    if s.status <> 'calculated' then raise exception 'Solo una liquidación calculada se envía a revisión.'; end if;
    update public.erp_settlements set status = 'review', submitted_by = auth.uid(), submitted_by_name = public.erp_actor_name(s.store_id), submitted_at = now() where id = p_id;
    v_next := 'review';
  elsif p_action = 'approve' then
    if not public.erp_can(s.store_id, 'profit_settle_approve') then raise exception 'Necesitas el permiso «Aprobar liquidaciones».'; end if;
    if s.status not in ('calculated', 'review') then raise exception 'Esta liquidación ya no se puede aprobar.'; end if;
    if s.created_by = auth.uid() and not v_owner then raise exception 'Otra persona debe aprobar la liquidación que tú preparaste.'; end if;
    update public.erp_settlements set status = 'approved', decided_by = auth.uid(), decided_by_name = public.erp_actor_name(s.store_id), decided_at = now(),
           decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
    -- Las líneas en cero o negativas no se pagan: si no hay nada que pagar queda pagada.
    if not exists (select 1 from public.erp_settlement_lines where settlement_id = p_id and amount > 0) then
      update public.erp_settlements set status = 'paid' where id = p_id;
    end if;
    v_next := 'approved';
  elsif p_action in ('reject', 'discard') then
    if p_action = 'reject' and not public.erp_can(s.store_id, 'profit_settle_approve') then raise exception 'Necesitas el permiso «Aprobar liquidaciones».'; end if;
    if p_action = 'discard' and not (public.erp_can(s.store_id, 'profit_settle') or public.erp_can(s.store_id, 'profit_settle_approve')) then raise exception 'No tienes permiso.'; end if;
    if s.status not in ('calculated', 'review') then raise exception 'Solo se rechaza o descarta una liquidación abierta.'; end if;
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
    update public.erp_settlements set status = 'rejected', decided_by = auth.uid(), decided_by_name = public.erp_actor_name(s.store_id), decided_at = now(),
           decision_note = btrim(p_note) where id = p_id;
    update public.erp_settlement_lines set carried_into = null where carried_into = p_id;
    v_next := 'rejected';
  elsif p_action = 'revert' then
    if not public.erp_can(s.store_id, 'profit_settle_approve') then raise exception 'Necesitas el permiso «Aprobar liquidaciones».'; end if;
    if s.status not in ('approved', 'partially_paid', 'paid') then raise exception 'Solo se revierte una liquidación aprobada.'; end if;
    select coalesce(sum(amount), 0) into v_paid from public.erp_settlement_payments where settlement_id = p_id and not voided;
    if v_paid > 0 then raise exception 'Tiene pagos registrados: anúlalos primero (queda el historial).'; end if;
    if exists (select 1 from public.erp_settlement_lines where carried_into is not null and settlement_id = p_id) then
      raise exception 'Sus saldos ya pasaron a otra liquidación; revierte primero esa.';
    end if;
    if exists (select 1 from public.erp_settlements x where x.store_id = s.store_id and x.point_id is not distinct from s.point_id
               and x.created_at > s.created_at and x.status not in ('rejected', 'reverted')) then
      raise exception 'Hay liquidaciones posteriores de este pozo; revierte primero la más reciente.';
    end if;
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
    update public.erp_settlements set status = 'reverted', reverted_by = auth.uid(), reverted_by_name = public.erp_actor_name(s.store_id), reverted_at = now(),
           revert_reason = btrim(p_note) where id = p_id;
    update public.erp_settlement_lines set carried_into = null where carried_into = p_id;
    v_next := 'reverted';
  else
    raise exception 'Acción no válida.';
  end if;
  perform public.erp_audit(s.store_id, 'settlement.' || p_action, 'erp_settlements', p_id,
    jsonb_build_object('number', s.number, 'from', s.status, 'to', v_next, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', (select status from public.erp_settlements where id = p_id));
end;
$$;
revoke all on function public.erp_settlement_transition(uuid, text, text) from public, anon;
grant execute on function public.erp_settlement_transition(uuid, text, text) to authenticated;

create or replace function public.erp__settlement_refresh_status(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.erp_settlements s
  set status = case
    when not exists (select 1 from public.erp_settlement_lines l where l.settlement_id = s.id and l.amount > 0 and l.paid < l.amount) then 'paid'
    when exists (select 1 from public.erp_settlement_lines l where l.settlement_id = s.id and l.paid > 0) then 'partially_paid'
    else 'approved' end
  where s.id = p_id and s.status in ('approved', 'partially_paid', 'paid');
$$;
revoke all on function public.erp__settlement_refresh_status(uuid) from public, anon, authenticated;

-- Registrar un pago (queda como «registrado en RemHub»: no confirma que el banco lo hizo).
create or replace function public.erp_settlement_pay(p_line uuid, p_amount numeric, p_method text, p_reference text, p_note text, p_paid_at timestamptz, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.erp_settlement_lines; s public.erp_settlements; v_pay public.erp_settlement_payments; v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  select * into l from public.erp_settlement_lines where id = p_line for update;
  if not found then raise exception 'Línea no encontrada.'; end if;
  select * into s from public.erp_settlements where id = l.settlement_id for update;
  if not public.erp_can(s.store_id, 'profit_pay') then raise exception 'Necesitas el permiso «Registrar pagos de liquidaciones».'; end if;
  if not public.erp__pool_allowed(s.store_id, s.point_id) then raise exception 'No tienes acceso a este pozo.'; end if;
  if char_length(coalesce(p_idempotency_key, '')) < 8 then raise exception 'Falta la llave del pago.'; end if;
  select * into v_pay from public.erp_settlement_payments where store_id = s.store_id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('ok', true, 'already', true, 'payment_id', v_pay.id); end if;
  if s.status not in ('approved', 'partially_paid') then raise exception 'Solo se paga una liquidación aprobada.'; end if;
  if v_amount <= 0 then raise exception 'Escribe un valor mayor a cero.'; end if;
  if v_amount > l.amount - l.paid then raise exception 'El pago (%) supera el saldo pendiente (%).', v_amount, l.amount - l.paid; end if;
  insert into public.erp_settlement_payments (store_id, settlement_id, line_id, amount, method, reference, note, paid_at, idempotency_key, created_by, created_by_name)
  values (s.store_id, s.id, l.id, v_amount, coalesce(nullif(btrim(p_method), ''), 'transfer'), nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), least(coalesce(p_paid_at, now()), now()), p_idempotency_key, auth.uid(), public.erp_actor_name(s.store_id))
  returning * into v_pay;
  update public.erp_settlement_lines set paid = paid + v_amount where id = l.id;
  perform public.erp__settlement_refresh_status(s.id);
  perform public.erp_audit(s.store_id, 'settlement.payment', 'erp_settlements', s.id,
    jsonb_build_object('number', s.number, 'beneficiary_id', l.beneficiary_id, 'amount', v_amount, 'method', p_method, 'reference', p_reference));
  return jsonb_build_object('ok', true, 'already', false, 'payment_id', v_pay.id, 'status', (select status from public.erp_settlements where id = s.id));
end;
$$;
revoke all on function public.erp_settlement_pay(uuid, numeric, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.erp_settlement_pay(uuid, numeric, text, text, text, timestamptz, text) to authenticated;

create or replace function public.erp_settlement_payment_void(p_payment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare p public.erp_settlement_payments; s public.erp_settlements;
begin
  select * into p from public.erp_settlement_payments where id = p_payment for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  select * into s from public.erp_settlements where id = p.settlement_id for update;
  if not public.erp_can(s.store_id, 'profit_settle_approve') then raise exception 'Necesitas el permiso «Aprobar liquidaciones».'; end if;
  if not public.erp__pool_allowed(s.store_id, s.point_id) then raise exception 'No tienes acceso a este pozo.'; end if;
  if p.voided then raise exception 'Este pago ya está anulado.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  update public.erp_settlement_payments set voided = true, voided_by = auth.uid(), voided_by_name = public.erp_actor_name(s.store_id), voided_at = now(),
         void_reason = btrim(p_reason) where id = p.id;
  update public.erp_settlement_lines set paid = paid - p.amount where id = p.line_id;
  perform public.erp__settlement_refresh_status(s.id);
  perform public.erp_audit(s.store_id, 'settlement.payment_voided', 'erp_settlements', s.id,
    jsonb_build_object('number', s.number, 'payment_id', p.id, 'amount', p.amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_settlement_payment_void(uuid, text) from public, anon;
grant execute on function public.erp_settlement_payment_void(uuid, text) to authenticated;

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
           s.decided_by_name, (select coalesce(sum(l.amount), 0) from public.erp_settlement_lines l where l.settlement_id = s.id and l.amount > 0) as to_pay,
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
                        'pct', l.pct, 'share_amount', l.share_amount, 'carried_amount', l.carried_amount, 'amount', l.amount, 'paid', l.paid,
                        'carried_into', l.carried_into) order by l.pct desc, b.name)
                       from public.erp_settlement_lines l join public.erp_beneficiaries b on b.id = l.beneficiary_id where l.settlement_id = s.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'line_id', p.line_id, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
                        'note', p.note, 'paid_at', p.paid_at, 'created_by_name', p.created_by_name, 'voided', p.voided, 'void_reason', p.void_reason) order by p.paid_at desc)
                       from public.erp_settlement_payments p where p.settlement_id = s.id), '[]'::jsonb),
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

notify pgrst, 'reload schema';
