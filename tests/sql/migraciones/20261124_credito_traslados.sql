-- =====================================================================
-- REMHUB · Crédito en traslados: cuenta corriente bodega → puntos
--
-- Modelo «crédito al trasladar»:
--   · Cada traslado RECIBIDO por un punto con crédito activo se le cobra al
--     punto a precio interno = costo × (1 + % de la bodega), redondeado.
--     Ej.: costo $18.000.000 + 11,1 % ⇒ el punto debe $20.000.000.
--   · El % se busca solo: producto → categoría → punto → tienda (15 % por
--     defecto). Crear productos sigue igual de simple.
--   · Cada cargo vence según el plazo del punto (7, 15, 30, 40, 90, 365…
--     días; lo que la tienda defina). Cupo máximo opcional: un traslado que
--     lo supere pide autorización.
--   · Devoluciones del punto a la bodega, daños y pérdidas aprobados (los
--     asume la bodega) y abonos BAJAN la deuda. Deuda inicial: por lo que el
--     punto tiene hoy, o un valor escrito a mano.
--   · Cada punto guarda su COSTO PROPIO (promedio de lo que le cobraron),
--     base para su ganancia real.
--
-- No se reescribe ninguna función de traslados: todo se engancha con
-- disparadores, así funciona igual desde el panel, el enlace o los pedidos
-- internos. Apagado hasta que la madre active el crédito en un punto.
-- Tablas nuevas sin acceso directo (solo por funciones). No borra datos.
-- Es idempotente.
-- =====================================================================

-- 0. Permisos
create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'price_approve', 'exports', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'products_prices', 'costs_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'inventory_alerts', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'purchases_void', 'suppliers', 'payables', 'internal_credit', 'internal_credit_manage',
    'audit', 'reports', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit',
    'profit_view', 'profit_rules', 'profit_approve',
    'profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay',
    'expenses', 'expenses_pay', 'budgets', 'payroll', 'payroll_approve', 'payroll_pay'
  ]::text[];
$$;

create table if not exists public.erp_migration_marks (key text primary key, applied_at timestamptz not null default now());
alter table public.erp_migration_marks enable row level security;
revoke all on public.erp_migration_marks from anon, authenticated;

-- Quien recibe traslados en un punto puede ver la cuenta de su punto (una sola vez).
do $$
declare v_new boolean;
begin
  insert into public.erp_migration_marks (key) values ('20261124_grants') on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new then
    update public.store_users set permissions = array_append(permissions, 'internal_credit')
    where point_id is not null and 'transfers' = any (permissions) and not ('internal_credit' = any (permissions));
  end if;
end $$;

-- 1. Tablas
create table if not exists public.erp_internal_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  default_pct numeric(9, 4) not null default 15 check (default_pct between 0 and 1000),
  round_step integer not null default 100 check (round_step in (0, 1, 50, 100, 500, 1000)),
  default_term_days integer not null default 30 check (default_term_days between 0 and 730),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_internal_points (
  point_id uuid primary key references public.erp_warehouses(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  enabled boolean not null default true,
  pct numeric(9, 4) check (pct between 0 and 1000),                 -- null = el de la tienda
  term_days integer check (term_days between 0 and 730),            -- null = el de la tienda
  credit_limit numeric check (credit_limit >= 0),                   -- null = sin cupo
  started_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_internal_pct_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  pct numeric(9, 4) not null check (pct between 0 and 1000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((category_id is null) <> (product_id is null))
);
create unique index if not exists erp_internal_pct_rules_one on public.erp_internal_pct_rules (store_id, coalesce(product_id, category_id));

alter table public.erp_transfer_items add column if not exists unit_cost numeric;
alter table public.erp_transfer_items add column if not exists internal_price numeric;
alter table public.erp_transfer_items add column if not exists internal_pct numeric;

create table if not exists public.erp_internal_docs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id),
  number bigint not null,
  -- + transfer (traslado recibido), opening (deuda inicial), charge (cargo manual)
  -- − return (devolución a la bodega), transfer_out (pasó a otro punto), loss (daño/pérdida aprobado), credit (nota crédito)
  kind text not null check (kind in ('transfer', 'opening', 'charge', 'return', 'transfer_out', 'loss', 'credit')),
  sign smallint not null check (sign in (1, -1)),
  amount numeric not null check (amount > 0),
  due_date date,
  transfer_id uuid references public.erp_transfers(id),
  claim_id uuid,
  note text,
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (store_id, number)
);
create unique index if not exists erp_internal_docs_transfer on public.erp_internal_docs (transfer_id, point_id, kind) where transfer_id is not null;
create index if not exists erp_internal_docs_point on public.erp_internal_docs (store_id, point_id, status);

create table if not exists public.erp_internal_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id),
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  reference text,
  paid_at date not null default ((now() at time zone 'America/Bogota')::date),
  note text,
  voided boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists erp_internal_payments_point on public.erp_internal_payments (store_id, point_id);

create table if not exists public.erp_internal_claims (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id),
  product_id uuid not null references public.products(id),
  qty integer not null check (qty > 0),
  reason text not null check (reason in ('damaged', 'lost', 'expired', 'stolen', 'other')),
  note text,
  photo_url text,
  unit_value numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  doc_id uuid
);

create table if not exists public.erp_point_costs (
  point_id uuid not null references public.erp_warehouses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  avg_cost numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (point_id, product_id)
);

alter table public.erp_internal_settings enable row level security;
alter table public.erp_internal_points enable row level security;
alter table public.erp_internal_pct_rules enable row level security;
alter table public.erp_internal_docs enable row level security;
alter table public.erp_internal_payments enable row level security;
alter table public.erp_internal_claims enable row level security;
alter table public.erp_point_costs enable row level security;
revoke all on public.erp_internal_settings, public.erp_internal_points, public.erp_internal_pct_rules, public.erp_internal_docs,
  public.erp_internal_payments, public.erp_internal_claims, public.erp_point_costs from anon, authenticated;

-- 2. Reglas internas
create or replace function public.erp__internal_today()
returns date language sql stable as $$ select (now() at time zone 'America/Bogota')::date $$;

create or replace function public.erp__round_up(v numeric, p_step integer)
returns numeric language sql immutable as $$
  select case when v is null then null
              when coalesce(p_step, 0) = 0 then round(v, 2)
              when p_step = 1 then ceil(v)
              else ceil(v / p_step) * p_step end;
$$;

create or replace function public.erp__internal_settings(p_store uuid)
returns public.erp_internal_settings language plpgsql stable security definer set search_path = public as $$
declare s public.erp_internal_settings;
begin
  select * into s from public.erp_internal_settings where store_id = p_store;
  if not found then
    s.store_id := p_store; s.default_pct := 15; s.round_step := 100; s.default_term_days := 30;
  end if;
  return s;
end $$;

-- Punto con crédito activo (fila vacía si no).
create or replace function public.erp__internal_point(p_store uuid, p_wh uuid)
returns public.erp_internal_points language sql stable security definer set search_path = public as $$
  select * from public.erp_internal_points where store_id = p_store and point_id = p_wh and enabled;
$$;

-- % de la bodega: producto → categoría → punto → tienda.
create or replace function public.erp__internal_pct(p_store uuid, p_point uuid, p_product uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.pct from public.erp_internal_pct_rules r where r.store_id = p_store and r.product_id = p_product),
    (select r.pct from public.erp_internal_pct_rules r join public.products p on p.id = p_product
      where r.store_id = p_store and r.category_id = p.category_id),
    (select ip.pct from public.erp_internal_points ip where ip.store_id = p_store and ip.point_id = p_point),
    (select s.default_pct from public.erp_internal_settings s where s.store_id = p_store),
    15);
$$;

-- Precio interno de un producto para un punto (null si el producto no tiene costo).
create or replace function public.erp__internal_unit(p_store uuid, p_point uuid, p_product uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_cost numeric;
begin
  select cost_price into v_cost from public.products where id = p_product and store_id = p_store;
  if coalesce(v_cost, 0) <= 0 then return null; end if;
  return public.erp__round_up(v_cost * (1 + public.erp__internal_pct(p_store, p_point, p_product) / 100),
                              (public.erp__internal_settings(p_store)).round_step);
end $$;

create or replace function public.erp__internal_balance(p_store uuid, p_point uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(sign * amount) from public.erp_internal_docs where store_id = p_store and point_id = p_point and status = 'active'), 0)
       - coalesce((select sum(amount) from public.erp_internal_payments where store_id = p_store and point_id = p_point and not voided), 0);
$$;

create or replace function public.erp__fmt_money(v numeric)
returns text language sql immutable as $$ select '$' || replace(to_char(round(coalesce(v, 0)), 'FM999,999,999,999,990'), ',', '.') $$;

do $$
declare f text;
begin
  foreach f in array array['erp__internal_settings(uuid)', 'erp__internal_point(uuid, uuid)', 'erp__internal_pct(uuid, uuid, uuid)',
                           'erp__internal_unit(uuid, uuid, uuid)', 'erp__internal_balance(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- 3. Cada producto del traslado congela su costo y su precio interno al crearse; el cupo se revisa aquí.
create or replace function public.erp__transfer_item_value()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tr public.erp_transfers;
  v_to public.erp_internal_points;
  v_from public.erp_internal_points;
  v_bal numeric;
  v_transit numeric;
begin
  select * into tr from public.erp_transfers where id = new.transfer_id;
  if not found then return new; end if;
  new.unit_cost := coalesce(new.unit_cost, (select cost_price from public.products where id = new.product_id));
  v_from := public.erp__internal_point(tr.store_id, tr.from_warehouse_id);
  v_to := public.erp__internal_point(tr.store_id, tr.to_warehouse_id);

  if v_from.point_id is not null then
    -- Sale de un punto con crédito: vale lo que a ese punto le costó.
    new.internal_price := coalesce(new.internal_price,
      (select c.avg_cost from public.erp_point_costs c where c.point_id = tr.from_warehouse_id and c.product_id = new.product_id and c.avg_cost > 0),
      public.erp__internal_unit(tr.store_id, tr.from_warehouse_id, new.product_id));
  elsif v_to.point_id is not null then
    new.internal_pct := public.erp__internal_pct(tr.store_id, tr.to_warehouse_id, new.product_id);
    new.internal_price := coalesce(new.internal_price, public.erp__internal_unit(tr.store_id, tr.to_warehouse_id, new.product_id));
  end if;

  if v_to.point_id is not null and v_to.credit_limit is not null and auth.uid() is not null
     and not public.erp_can(tr.store_id, 'internal_credit_manage') then
    v_bal := public.erp__internal_balance(tr.store_id, tr.to_warehouse_id);
    select coalesce(sum(i.qty * coalesce(i.internal_price, 0)), 0) into v_transit
    from public.erp_transfer_items i join public.erp_transfers t on t.id = i.transfer_id
    where t.store_id = tr.store_id and t.to_warehouse_id = tr.to_warehouse_id and t.status = 'in_transit';
    if v_bal + v_transit + new.qty * coalesce(new.internal_price, 0) > v_to.credit_limit then
      raise exception 'Con este traslado, % superaría su cupo con la bodega (%). Debe hoy %; pide autorización a la tienda madre.',
        (select name from public.erp_warehouses where id = tr.to_warehouse_id),
        public.erp__fmt_money(v_to.credit_limit), public.erp__fmt_money(v_bal + v_transit);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists erp_transfer_item_value on public.erp_transfer_items;
create trigger erp_transfer_item_value before insert on public.erp_transfer_items
  for each row execute function public.erp__transfer_item_value();

-- 4. Al RECIBIR un traslado se crea el documento interno (lo recibido, no lo enviado).
create or replace function public.erp__transfer_internal_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_to public.erp_internal_points;
  v_from public.erp_internal_points;
  it record;
  v_val numeric := 0;
  v_missing integer := 0;
  v_unit numeric;
  v_recv integer;
  v_before integer;
  v_avg numeric;
  v_term integer;
  v_note text;
begin
  if new.status <> 'received' or old.status = 'received' then return null; end if;
  v_to := public.erp__internal_point(new.store_id, new.to_warehouse_id);
  v_from := public.erp__internal_point(new.store_id, new.from_warehouse_id);
  if v_to.point_id is null and v_from.point_id is null then return null; end if;

  for it in select * from public.erp_transfer_items where transfer_id = new.id loop
    v_recv := coalesce(it.received_qty, it.qty);
    if v_recv <= 0 then continue; end if;
    v_unit := coalesce(it.internal_price,
      case when v_from.point_id is not null then
        (select c.avg_cost from public.erp_point_costs c where c.point_id = new.from_warehouse_id and c.product_id = it.product_id and c.avg_cost > 0) end,
      public.erp__internal_unit(new.store_id, coalesce(v_to.point_id, v_from.point_id), it.product_id));
    if v_unit is null then v_missing := v_missing + 1; continue; end if;
    v_val := v_val + v_recv * v_unit;

    if v_to.point_id is not null then
      -- Costo propio del punto: promedio entre lo que tenía y lo que llega.
      select coalesce(l.qty, 0) into v_before from public.erp_stock_levels l
      where l.warehouse_id = new.to_warehouse_id and l.product_id = it.product_id;
      v_before := greatest(coalesce(v_before, 0) - v_recv, 0);
      select c.avg_cost into v_avg from public.erp_point_costs c where c.point_id = new.to_warehouse_id and c.product_id = it.product_id;
      insert into public.erp_point_costs as c (point_id, product_id, store_id, avg_cost)
      values (new.to_warehouse_id, it.product_id, new.store_id, v_unit)
      on conflict (point_id, product_id) do update
        set avg_cost = round((v_before * coalesce(v_avg, v_unit) + v_recv * v_unit) / (v_before + v_recv), 4), updated_at = now();
    end if;
  end loop;

  v_val := round(v_val, 2);
  if v_val <= 0 then return null; end if;
  v_note := 'Traslado #' || new.number || case when v_missing > 0 then ' · ' || v_missing || ' producto(s) sin costo no se cobraron' else '' end;

  if v_from.point_id is not null then
    insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, transfer_id, note, created_by, created_by_name)
    values (new.store_id, new.from_warehouse_id, public.erp_next_number(new.store_id, 'internal_doc'),
            case when v_to.point_id is null then 'return' else 'transfer_out' end, -1, v_val, new.id, v_note, auth.uid(),
            coalesce(new.received_by_name, 'Sistema'))
    on conflict do nothing;
  end if;
  if v_to.point_id is not null then
    v_term := coalesce(v_to.term_days, (public.erp__internal_settings(new.store_id)).default_term_days);
    insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, due_date, transfer_id, note, created_by, created_by_name)
    values (new.store_id, new.to_warehouse_id, public.erp_next_number(new.store_id, 'internal_doc'), 'transfer', 1, v_val,
            public.erp__internal_today() + v_term, new.id, v_note, auth.uid(), coalesce(new.received_by_name, 'Sistema'))
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists erp_transfer_internal_post on public.erp_transfers;
create trigger erp_transfer_internal_post after update of status on public.erp_transfers
  for each row execute function public.erp__transfer_internal_post();

-- 5. Resumen de la cuenta de un punto (los abonos y créditos pagan primero lo más antiguo).
create or replace function public.erp__internal_summary(p_store uuid, p_point uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.erp__internal_today(); v_pool numeric; v_paid numeric; v jsonb;
begin
  select coalesce(sum(amount), 0) into v_paid from public.erp_internal_payments where store_id = p_store and point_id = p_point and not voided;
  select v_paid + coalesce(sum(amount), 0) into v_pool
  from public.erp_internal_docs where store_id = p_store and point_id = p_point and status = 'active' and sign = -1;

  with ch as (
    select d.id, d.amount, d.due_date,
           sum(d.amount) over (order by d.due_date nulls last, d.created_at, d.id) as cum
    from public.erp_internal_docs d
    where d.store_id = p_store and d.point_id = p_point and d.status = 'active' and d.sign = 1
  ), pend as (
    select id, due_date, least(amount, greatest(cum - v_pool, 0)) as pending from ch
  )
  select jsonb_build_object(
    'charged', coalesce((select sum(amount) from ch), 0),
    'paid', v_paid,
    'credits', v_pool - v_paid,
    'balance', coalesce((select sum(amount) from ch), 0) - v_pool,
    'overdue', coalesce((select sum(pending) from pend where due_date < v_today), 0),
    'due_7', coalesce((select sum(pending) from pend where due_date between v_today and v_today + 7), 0),
    'next_due', (select min(due_date) from pend where pending > 0 and due_date >= v_today),
    'oldest_overdue_days', (select v_today - min(due_date) from pend where pending > 0 and due_date < v_today),
    'in_transit', coalesce((select sum(i.qty * coalesce(i.internal_price, 0)) from public.erp_transfer_items i
                            join public.erp_transfers t on t.id = i.transfer_id
                            where t.store_id = p_store and t.to_warehouse_id = p_point and t.status = 'in_transit'), 0),
    'stock_value', coalesce((select sum(greatest(l.qty, 0) * c.avg_cost) from public.erp_stock_levels l
                             join public.erp_point_costs c on c.point_id = l.warehouse_id and c.product_id = l.product_id
                             where l.warehouse_id = p_point), 0),
    'pending_claims', (select count(*) from public.erp_internal_claims where store_id = p_store and point_id = p_point and status = 'pending')
  ) into v;
  return v;
end $$;
revoke all on function public.erp__internal_summary(uuid, uuid) from public, anon, authenticated;

-- ¿Puede manejar la cuenta? (la madre con «Administrar cuenta con puntos»)
create or replace function public.erp__internal_manager(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_can(p_store, 'internal_credit_manage') and public.erp_my_points(p_store) is null;
$$;
revoke all on function public.erp__internal_manager(uuid) from public, anon, authenticated;

-- 6. Tablero: todos los puntos (madre) o el propio (punto).
create or replace function public.erp_internal_board(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pts uuid[] := public.erp_my_points(p_store); s public.erp_internal_settings; v_manage boolean;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Cuenta con la bodega».');
  end if;
  s := public.erp__internal_settings(p_store);
  v_manage := public.erp__internal_manager(p_store);
  return jsonb_build_object(
    'ok', true,
    'today', public.erp__internal_today(),
    'can_manage', v_manage,
    'can_see_costs', public.erp_can(p_store, 'costs_view'),
    'settings', jsonb_build_object('default_pct', s.default_pct, 'round_step', s.round_step, 'default_term_days', s.default_term_days),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
          'point_id', w.id, 'name', w.name, 'kind', w.kind, 'is_default', w.is_default,
          'configured', ip.point_id is not null, 'enabled', coalesce(ip.enabled, false),
          'pct', ip.pct, 'term_days', ip.term_days, 'credit_limit', ip.credit_limit, 'started_at', ip.started_at)
        || case when ip.point_id is not null then public.erp__internal_summary(p_store, w.id) else '{}'::jsonb end
        order by (ip.point_id is null), w.is_default, w.name)
      from public.erp_warehouses w
      left join public.erp_internal_points ip on ip.point_id = w.id
      where w.store_id = p_store and w.active
        and (v_pts is null and v_manage or (ip.point_id is not null and (v_pts is null or w.id = any (v_pts))))), '[]'::jsonb),
    'rules', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'pct', r.pct, 'category_id', r.category_id, 'category', c.name,
                                          'product_id', r.product_id, 'product', p.name) order by c.name nulls last, p.name)
      from public.erp_internal_pct_rules r
      left join public.product_categories c on c.id = r.category_id
      left join public.products p on p.id = r.product_id
      where r.store_id = p_store), '[]'::jsonb) end,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'point_id', cl.point_id, 'point', w.name, 'product', p.name, 'image_url', p.image_url,
                                          'qty', cl.qty, 'reason', cl.reason, 'note', cl.note, 'photo_url', cl.photo_url,
                                          'value', cl.qty * coalesce(cl.unit_value, 0), 'by', cl.created_by_name, 'at', cl.created_at) order by cl.created_at)
      from public.erp_internal_claims cl
      join public.erp_warehouses w on w.id = cl.point_id
      join public.products p on p.id = cl.product_id
      where cl.store_id = p_store and cl.status = 'pending' and (v_pts is null or cl.point_id = any (v_pts))), '[]'::jsonb));
end $$;
revoke all on function public.erp_internal_board(uuid) from public, anon;
grant execute on function public.erp_internal_board(uuid) to authenticated;

-- 7. Estado de cuenta de un punto.
create or replace function public.erp_internal_statement(p_store uuid, p_point uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.erp__internal_today(); v_pool numeric; ip public.erp_internal_points;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Cuenta con la bodega».');
  end if;
  if not public.erp_point_allowed(p_store, p_point) then return jsonb_build_object('ok', false, 'error', 'Solo puedes ver la cuenta de tu punto.'); end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;

  select coalesce((select sum(amount) from public.erp_internal_payments where store_id = p_store and point_id = p_point and not voided), 0)
       + coalesce((select sum(amount) from public.erp_internal_docs where store_id = p_store and point_id = p_point and status = 'active' and sign = -1), 0)
  into v_pool;

  return jsonb_build_object(
    'ok', true, 'today', v_today,
    'point', (select jsonb_build_object('id', w.id, 'name', w.name, 'phone', w.phone) from public.erp_warehouses w where w.id = p_point),
    'config', case when ip.point_id is null then null else jsonb_build_object('enabled', ip.enabled, 'pct', ip.pct, 'term_days', ip.term_days,
                                                                               'credit_limit', ip.credit_limit, 'started_at', ip.started_at) end,
    'summary', public.erp__internal_summary(p_store, p_point),
    'moves', coalesce((
      select jsonb_agg(m order by m->>'at', m->>'n') from (
        select jsonb_build_object('type', 'doc', 'id', d.id, 'n', lpad(d.number::text, 12, '0'), 'number', d.number, 'kind', d.kind,
                                  'amount', d.sign * d.amount, 'due_date', d.due_date, 'note', d.note, 'status', d.status, 'void_reason', d.void_reason,
                                  'transfer_number', t.number, 'by', d.created_by_name, 'at', d.created_at) as m
        from public.erp_internal_docs d left join public.erp_transfers t on t.id = d.transfer_id
        where d.store_id = p_store and d.point_id = p_point
        union all
        select jsonb_build_object('type', 'payment', 'id', pm.id, 'n', '', 'kind', 'payment', 'amount', -pm.amount, 'method', pm.method,
                                  'reference', pm.reference, 'paid_at', pm.paid_at, 'note', pm.note, 'status', case when pm.voided then 'void' else 'active' end,
                                  'void_reason', pm.void_reason, 'by', pm.created_by_name, 'at', pm.created_at)
        from public.erp_internal_payments pm where pm.store_id = p_store and pm.point_id = p_point
      ) x), '[]'::jsonb),
    'charges', coalesce((
      with ch as (
        select d.*, t.number as transfer_number, sum(d.amount) over (order by d.due_date nulls last, d.created_at, d.id) as cum
        from public.erp_internal_docs d left join public.erp_transfers t on t.id = d.transfer_id
        where d.store_id = p_store and d.point_id = p_point and d.status = 'active' and d.sign = 1
      )
      select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'kind', kind, 'amount', amount, 'transfer_number', transfer_number,
                                          'pending', least(amount, greatest(cum - v_pool, 0)), 'due_date', due_date,
                                          'days_late', case when due_date < v_today and least(amount, greatest(cum - v_pool, 0)) > 0 then v_today - due_date end,
                                          'note', note, 'at', created_at) order by due_date nulls last, created_at)
      from ch), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'product', p.name, 'qty', cl.qty, 'reason', cl.reason, 'note', cl.note, 'status', cl.status,
                                          'value', cl.qty * coalesce(cl.unit_value, 0), 'by', cl.created_by_name, 'at', cl.created_at,
                                          'decided_by', cl.decided_by_name, 'decision_note', cl.decision_note) order by cl.created_at desc)
      from public.erp_internal_claims cl join public.products p on p.id = cl.product_id
      where cl.store_id = p_store and cl.point_id = p_point), '[]'::jsonb));
end $$;
revoke all on function public.erp_internal_statement(uuid, uuid) from public, anon;
grant execute on function public.erp_internal_statement(uuid, uuid) to authenticated;

-- 8. Configuración (solo la madre).
create or replace function public.erp_internal_settings_save(p_store uuid, p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pct numeric := coalesce(nullif(p_cfg->>'default_pct', '')::numeric, 15);
        v_step integer := coalesce(nullif(p_cfg->>'round_step', '')::integer, 100);
        v_term integer := coalesce(nullif(p_cfg->>'default_term_days', '')::integer, 30);
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» cambia esto.'; end if;
  if v_pct < 0 or v_pct > 1000 then raise exception 'El %% debe estar entre 0 y 1000.'; end if;
  if v_step not in (0, 1, 50, 100, 500, 1000) then raise exception 'Redondeo inválido.'; end if;
  if v_term < 0 or v_term > 730 then raise exception 'El plazo debe estar entre 0 y 730 días.'; end if;
  insert into public.erp_internal_settings (store_id, default_pct, round_step, default_term_days, updated_by, updated_at)
  values (p_store, v_pct, v_step, v_term, auth.uid(), now())
  on conflict (store_id) do update set default_pct = excluded.default_pct, round_step = excluded.round_step,
    default_term_days = excluded.default_term_days, updated_by = excluded.updated_by, updated_at = now();
  perform public.erp_audit(p_store, 'internal.settings', 'erp_internal_settings', null, p_cfg);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.erp_internal_point_save(p_store uuid, p_point uuid, p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.erp_warehouses;
        v_pct numeric := nullif(p_cfg->>'pct', '')::numeric;
        v_term integer := nullif(p_cfg->>'term_days', '')::integer;
        v_limit numeric := nullif(p_cfg->>'credit_limit', '')::numeric;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» cambia esto.'; end if;
  select * into w from public.erp_warehouses where id = p_point and store_id = p_store;
  if not found then raise exception 'Punto no válido.'; end if;
  if w.is_default then raise exception 'La bodega principal es la que presta: no puede tener crédito consigo misma.'; end if;
  if v_pct is not null and (v_pct < 0 or v_pct > 1000) then raise exception 'El %% debe estar entre 0 y 1000.'; end if;
  if v_term is not null and (v_term < 0 or v_term > 730) then raise exception 'El plazo debe estar entre 0 y 730 días.'; end if;
  if v_limit is not null and v_limit < 0 then raise exception 'Cupo inválido.'; end if;
  insert into public.erp_internal_points (point_id, store_id, enabled, pct, term_days, credit_limit, updated_by, updated_at)
  values (p_point, p_store, coalesce((p_cfg->>'enabled')::boolean, true), v_pct, v_term, v_limit, auth.uid(), now())
  on conflict (point_id) do update set enabled = excluded.enabled, pct = excluded.pct, term_days = excluded.term_days,
    credit_limit = excluded.credit_limit, updated_by = excluded.updated_by, updated_at = now();
  perform public.erp_audit(p_store, 'internal.point', 'erp_internal_points', p_point, p_cfg);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.erp_internal_pct_rule_save(p_store uuid, p_category uuid, p_product uuid, p_pct numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» cambia esto.'; end if;
  if (p_category is null) = (p_product is null) then raise exception 'Escoge una categoría o un producto.'; end if;
  if p_product is not null and not exists (select 1 from public.products where id = p_product and store_id = p_store) then raise exception 'Producto no válido.'; end if;
  if p_category is not null and not exists (select 1 from public.product_categories where id = p_category and store_id = p_store) then raise exception 'Categoría no válida.'; end if;
  if p_pct is null then
    delete from public.erp_internal_pct_rules where store_id = p_store and coalesce(product_id, category_id) = coalesce(p_product, p_category);
  else
    if p_pct < 0 or p_pct > 1000 then raise exception 'El %% debe estar entre 0 y 1000.'; end if;
    insert into public.erp_internal_pct_rules (store_id, category_id, product_id, pct, updated_by)
    values (p_store, p_category, p_product, p_pct, auth.uid())
    on conflict (store_id, (coalesce(product_id, category_id))) do update set pct = excluded.pct, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform public.erp_audit(p_store, 'internal.pct_rule', 'erp_internal_pct_rules', coalesce(p_product, p_category),
    jsonb_build_object('category_id', p_category, 'product_id', p_product, 'pct', p_pct));
  return jsonb_build_object('ok', true);
end $$;

-- 9. Deuda inicial, cargos y notas crédito manuales.
create or replace function public.erp_internal_doc_add(p_store uuid, p_point uuid, p_kind text, p_amount numeric, p_due date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ip public.erp_internal_points; v_id uuid; v_sign smallint;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» registra esto.'; end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;
  if not found then raise exception 'Primero activa el crédito para ese punto.'; end if;
  if p_kind not in ('opening', 'charge', 'credit') then raise exception 'Tipo inválido.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Escribe el valor.'; end if;
  if p_kind <> 'opening' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Escribe el motivo.'; end if;
  v_sign := case when p_kind = 'credit' then -1 else 1 end;
  insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, due_date, note, created_by, created_by_name)
  values (p_store, p_point, public.erp_next_number(p_store, 'internal_doc'), p_kind, v_sign, round(p_amount, 2),
          case when v_sign = 1 then coalesce(p_due, public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days)) end,
          left(nullif(btrim(coalesce(p_note, '')), ''), 300), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.doc_' || p_kind, 'erp_internal_docs', v_id, jsonb_build_object('point_id', p_point, 'amount', p_amount, 'note', p_note));
  return v_id;
end $$;

-- Deuda inicial con lo que el punto tiene hoy, a precio interno (también fija su costo propio).
create or replace function public.erp_internal_opening_from_stock(p_store uuid, p_point uuid, p_due date, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ip public.erp_internal_points; l record; v_unit numeric; v_total numeric := 0; v_n integer := 0; v_missing integer := 0; v_id uuid;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre con «Administrar cuenta con puntos» registra esto.'; end if;
  select * into ip from public.erp_internal_points where store_id = p_store and point_id = p_point;
  if not found then raise exception 'Primero activa el crédito para ese punto.'; end if;
  if exists (select 1 from public.erp_internal_docs where store_id = p_store and point_id = p_point and kind = 'opening' and status = 'active') then
    raise exception 'Este punto ya tiene deuda inicial. Anúlala primero si quieres recalcularla.';
  end if;
  for l in select product_id, qty from public.erp_stock_levels where warehouse_id = p_point and qty > 0 loop
    v_unit := public.erp__internal_unit(p_store, p_point, l.product_id);
    if v_unit is null then v_missing := v_missing + 1; continue; end if;
    v_total := v_total + l.qty * v_unit;
    v_n := v_n + 1;
    insert into public.erp_point_costs (point_id, product_id, store_id, avg_cost) values (p_point, l.product_id, p_store, v_unit)
    on conflict (point_id, product_id) do update set avg_cost = excluded.avg_cost, updated_at = now();
  end loop;
  if v_total <= 0 then raise exception 'El punto no tiene mercancía con costo para valorizar.'; end if;
  insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, due_date, note, created_by, created_by_name)
  values (p_store, p_point, public.erp_next_number(p_store, 'internal_doc'), 'opening', 1, round(v_total, 2),
          coalesce(p_due, public.erp__internal_today() + coalesce(ip.term_days, (public.erp__internal_settings(p_store)).default_term_days)),
          coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 300), 'Deuda inicial: mercancía en el punto') ||
            case when v_missing > 0 then ' · ' || v_missing || ' producto(s) sin costo no se cobraron' else '' end,
          auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.opening', 'erp_internal_docs', v_id, jsonb_build_object('point_id', p_point, 'amount', v_total, 'products', v_n));
  return jsonb_build_object('ok', true, 'doc_id', v_id, 'amount', round(v_total, 2), 'products', v_n, 'missing', v_missing);
end $$;

create or replace function public.erp_internal_doc_void(p_doc uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.erp_internal_docs;
begin
  select * into d from public.erp_internal_docs where id = p_doc for update;
  if not found then raise exception 'Documento no encontrado.'; end if;
  if not public.erp__internal_manager(d.store_id) then raise exception 'Solo la tienda madre anula documentos.'; end if;
  if d.status = 'void' then raise exception 'Ya está anulado.'; end if;
  if d.kind not in ('opening', 'charge', 'credit') then raise exception 'Los documentos de traslados y novedades salen del inventario: no se anulan a mano.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Escribe el motivo.'; end if;
  update public.erp_internal_docs set status = 'void', void_reason = left(btrim(p_reason), 300), voided_at = now(), voided_by = auth.uid() where id = p_doc;
  perform public.erp_audit(d.store_id, 'internal.doc_void', 'erp_internal_docs', p_doc, jsonb_build_object('reason', p_reason, 'amount', d.amount));
  return jsonb_build_object('ok', true);
end $$;

-- 10. Abonos del punto a la bodega.
create or replace function public.erp_internal_payment_add(p_store uuid, p_point uuid, p_amount numeric, p_method text, p_reference text, p_paid_at date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.erp__internal_manager(p_store) then raise exception 'Solo la tienda madre registra abonos.'; end if;
  if not exists (select 1 from public.erp_internal_points where store_id = p_store and point_id = p_point) then raise exception 'Ese punto no tiene crédito activo.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Escribe el valor del abono.'; end if;
  if p_method not in ('cash', 'transfer', 'card', 'other') then raise exception 'Forma de pago inválida.'; end if;
  insert into public.erp_internal_payments (store_id, point_id, amount, method, reference, paid_at, note, created_by, created_by_name)
  values (p_store, p_point, round(p_amount, 2), p_method, left(nullif(btrim(coalesce(p_reference, '')), ''), 80),
          coalesce(p_paid_at, public.erp__internal_today()), left(nullif(btrim(coalesce(p_note, '')), ''), 300), auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.payment', 'erp_internal_payments', v_id, jsonb_build_object('point_id', p_point, 'amount', p_amount, 'method', p_method));
  return v_id;
end $$;

create or replace function public.erp_internal_payment_void(p_payment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pm public.erp_internal_payments;
begin
  select * into pm from public.erp_internal_payments where id = p_payment for update;
  if not found then raise exception 'Abono no encontrado.'; end if;
  if not public.erp__internal_manager(pm.store_id) then raise exception 'Solo la tienda madre anula abonos.'; end if;
  if pm.voided then raise exception 'Ya está anulado.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Escribe el motivo.'; end if;
  update public.erp_internal_payments set voided = true, void_reason = left(btrim(p_reason), 300), voided_at = now(), voided_by = auth.uid() where id = p_payment;
  perform public.erp_audit(pm.store_id, 'internal.payment_void', 'erp_internal_payments', p_payment, jsonb_build_object('reason', p_reason, 'amount', pm.amount));
  return jsonb_build_object('ok', true);
end $$;

-- 11. Novedades: el punto reporta daño/pérdida; la madre aprueba y la bodega lo asume.
create or replace function public.erp_internal_claim_create(p_store uuid, p_point uuid, p_product uuid, p_qty integer, p_reason text, p_note text, p_photo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stock integer; v_unit numeric;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['internal_credit', 'internal_credit_manage', 'transfers']) then
    raise exception 'No tienes permiso para reportar novedades.';
  end if;
  if not public.erp_point_allowed(p_store, p_point) then raise exception 'Solo puedes reportar novedades de tu punto.'; end if;
  if not exists (select 1 from public.erp_internal_points where store_id = p_store and point_id = p_point) then raise exception 'Ese punto no tiene crédito activo.'; end if;
  if p_reason not in ('damaged', 'lost', 'expired', 'stolen', 'other') then raise exception 'Motivo inválido.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Cantidad inválida.'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Cuenta qué pasó.'; end if;
  select coalesce(qty, 0) into v_stock from public.erp_stock_levels where warehouse_id = p_point and product_id = p_product;
  if coalesce(v_stock, 0) < p_qty then raise exception 'El punto solo tiene % unidades de ese producto.', coalesce(v_stock, 0); end if;
  v_unit := coalesce((select avg_cost from public.erp_point_costs where point_id = p_point and product_id = p_product and avg_cost > 0),
                     public.erp__internal_unit(p_store, p_point, p_product), 0);
  insert into public.erp_internal_claims (store_id, point_id, product_id, qty, reason, note, photo_url, unit_value, created_by, created_by_name)
  values (p_store, p_point, p_product, p_qty, p_reason, left(btrim(p_note), 500), nullif(btrim(coalesce(p_photo, '')), ''), v_unit, auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'internal.claim', 'erp_internal_claims', v_id, jsonb_build_object('point_id', p_point, 'product_id', p_product, 'qty', p_qty, 'reason', p_reason));
  return v_id;
end $$;

create or replace function public.erp_internal_claim_decide(p_claim uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cl public.erp_internal_claims; v_doc uuid; v_value numeric;
begin
  select * into cl from public.erp_internal_claims where id = p_claim for update;
  if not found then raise exception 'Novedad no encontrada.'; end if;
  if not public.erp__internal_manager(cl.store_id) then raise exception 'Solo la tienda madre aprueba novedades.'; end if;
  if cl.status <> 'pending' then raise exception 'Esa novedad ya se decidió.'; end if;
  if not p_approve and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Escribe por qué se rechaza.'; end if;
  if p_approve then
    -- Sale del inventario del punto (toda la empresa) y baja la deuda: la pérdida la asume la bodega.
    perform public.erp__move(cl.store_id, cl.point_id, cl.product_id, -cl.qty, 'internal_loss', 'internal_claim', cl.id,
      cl.unit_value, 'Novedad aprobada (' || case cl.reason when 'damaged' then 'dañado' when 'lost' then 'perdido' when 'expired' then 'vencido' when 'stolen' then 'robo' else 'otro' end || ')', left(cl.note, 200), true);
    v_value := round(cl.qty * coalesce(cl.unit_value, 0), 2);
    if v_value > 0 then
      insert into public.erp_internal_docs (store_id, point_id, number, kind, sign, amount, claim_id, note, created_by, created_by_name)
      values (cl.store_id, cl.point_id, public.erp_next_number(cl.store_id, 'internal_doc'), 'loss', -1, v_value, cl.id,
              'Novedad: ' || cl.qty || ' und. (' || case cl.reason when 'damaged' then 'dañado' when 'lost' then 'perdido' when 'expired' then 'vencido' when 'stolen' then 'robo' else 'otro' end || ')', auth.uid(), public.erp_actor_name(cl.store_id))
      returning id into v_doc;
    end if;
  end if;
  update public.erp_internal_claims
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_by_name = public.erp_actor_name(cl.store_id),
      decided_at = now(), decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300), doc_id = v_doc
  where id = p_claim;
  perform public.erp_audit(cl.store_id, case when p_approve then 'internal.claim_approved' else 'internal.claim_rejected' end, 'erp_internal_claims', p_claim,
    jsonb_build_object('value', v_value, 'note', p_note));
  return jsonb_build_object('ok', true, 'value', v_value);
end $$;

-- 12. Vista previa al armar un traslado: cuánto le quedará debiendo el punto y si pasa el cupo.
create or replace function public.erp_internal_preview(p_store uuid, p_from uuid, p_to uuid, p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_to public.erp_internal_points; v_from public.erp_internal_points; v_total numeric := 0; v_missing integer := 0; it jsonb; v_unit numeric;
        v_bal numeric; v_transit numeric; v_see boolean; v_lines jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['transfers', 'internal_credit', 'internal_credit_manage']) then
    return jsonb_build_object('applies', false);
  end if;
  v_to := public.erp__internal_point(p_store, p_to);
  v_from := public.erp__internal_point(p_store, p_from);
  if v_to.point_id is null and v_from.point_id is null then return jsonb_build_object('applies', false); end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_unit := case when v_from.point_id is not null then
                coalesce((select avg_cost from public.erp_point_costs where point_id = p_from and product_id = (it->>'product_id')::uuid and avg_cost > 0),
                         public.erp__internal_unit(p_store, p_from, (it->>'product_id')::uuid))
              else public.erp__internal_unit(p_store, p_to, (it->>'product_id')::uuid) end;
    if v_unit is null then v_missing := v_missing + 1; continue; end if;
    v_total := v_total + coalesce((it->>'qty')::integer, 0) * v_unit;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', it->>'product_id', 'unit', v_unit));
  end loop;
  v_see := public.erp_can_any(p_store, array['costs_view', 'internal_credit', 'internal_credit_manage']);
  if v_to.point_id is not null then
    v_bal := public.erp__internal_balance(p_store, p_to);
    select coalesce(sum(i.qty * coalesce(i.internal_price, 0)), 0) into v_transit
    from public.erp_transfer_items i join public.erp_transfers t on t.id = i.transfer_id
    where t.store_id = p_store and t.to_warehouse_id = p_to and t.status = 'in_transit';
  end if;
  return jsonb_build_object(
    'applies', true,
    'kind', case when v_from.point_id is not null and v_to.point_id is null then 'return'
                 when v_from.point_id is not null then 'move' else 'charge' end,
    'to_name', (select name from public.erp_warehouses where id = p_to),
    'from_name', (select name from public.erp_warehouses where id = p_from),
    'missing', v_missing,
    'total', case when v_see then round(v_total, 2) end,
    'lines', case when v_see then v_lines end,
    'balance', case when v_see and v_to.point_id is not null then v_bal end,
    'in_transit', case when v_see and v_to.point_id is not null then v_transit end,
    'credit_limit', v_to.credit_limit,
    'over_limit', v_to.credit_limit is not null and coalesce(v_bal, 0) + coalesce(v_transit, 0) + v_total > v_to.credit_limit,
    'term_days', coalesce(v_to.term_days, (public.erp__internal_settings(p_store)).default_term_days));
end $$;

do $$
declare f text;
begin
  foreach f in array array['erp_internal_settings_save(uuid, jsonb)', 'erp_internal_point_save(uuid, uuid, jsonb)',
                           'erp_internal_pct_rule_save(uuid, uuid, uuid, numeric)', 'erp_internal_doc_add(uuid, uuid, text, numeric, date, text)',
                           'erp_internal_opening_from_stock(uuid, uuid, date, text)', 'erp_internal_doc_void(uuid, text)',
                           'erp_internal_payment_add(uuid, uuid, numeric, text, text, date, text)', 'erp_internal_payment_void(uuid, text)',
                           'erp_internal_claim_create(uuid, uuid, uuid, integer, text, text, text)', 'erp_internal_claim_decide(uuid, boolean, text)',
                           'erp_internal_preview(uuid, uuid, uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
