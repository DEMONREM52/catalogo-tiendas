-- =====================================================================
-- REMHUB · Equipo y posventa: comisiones, metas, garantías, cliente fiel y QR
--
--   1. Comisiones por vendedor (erp_commission_rules): un % general, por
--      categoría o por producto (gana el más específico). Informe del mes y
--      cada vendedor ve lo suyo.
--   2. Metas por punto y por vendedor (erp_goals): avance del mes, ritmo y
--      proyección.
--   3. Garantías y devoluciones (erp_warranty_claims): qué llegó, qué falla,
--      a quién se mandó y cómo terminó, con su historial.
--   4. Cliente fiel (erp_loyalty_*): cada compra suma puntos; se canjean como
--      descuento en el POS (queda como autorización de precio con su motivo).
--   5. Cobro con QR (erp_payment_qr): el QR de Nequi, Daviplata, Bre-B o del
--      banco de cada punto, para mostrarlo en el POS con el valor a pagar.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__team_manager(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'payroll') or public.erp_can(p_store, 'profit_rules') or public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'reports'));
$$;
grant execute on function public.erp__team_manager(uuid) to authenticated;

-- ---------------------------------------------------------------- 1. comisiones
create table if not exists public.erp_commission_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  scope text not null check (scope in ('all', 'category', 'product')),
  ref_id uuid,
  pct numeric(6, 3) not null check (pct between 0 and 100),
  created_at timestamptz not null default now(),
  check ((scope = 'all') = (ref_id is null))
);
create unique index if not exists erp_commission_rules_one on public.erp_commission_rules (store_id, scope, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.erp_commission_rules enable row level security;
revoke all on public.erp_commission_rules from anon, authenticated;

create or replace function public.erp_commission_rules_get(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object('scope', r.scope, 'ref_id', r.ref_id, 'pct', r.pct,
      'name', case r.scope when 'category' then (select name from public.product_categories c where c.id = r.ref_id)
                           when 'product' then (select name from public.products p where p.id = r.ref_id) else 'Todos los productos' end)
      order by case r.scope when 'all' then 0 when 'category' then 1 else 2 end), '[]'::jsonb) end
  from public.erp_commission_rules r where r.store_id = p_store;
$$;
revoke all on function public.erp_commission_rules_get(uuid) from public, anon;
grant execute on function public.erp_commission_rules_get(uuid) to authenticated;

create or replace function public.erp_commission_rules_save(p_store uuid, p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.erp_can(p_store, 'payroll') or public.erp_can(p_store, 'profit_rules')) then return jsonb_build_object('ok', false, 'error', 'Necesitas «Nómina» o «Reglas de rentabilidad».'); end if;
  delete from public.erp_commission_rules where store_id = p_store;
  insert into public.erp_commission_rules (store_id, scope, ref_id, pct)
  select distinct on (x->>'scope', x->>'ref_id') p_store, x->>'scope', nullif(x->>'ref_id', '')::uuid, (x->>'pct')::numeric
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) x
  where (x->>'scope') in ('all', 'category', 'product') and (x->>'pct') is not null;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_commission_rules_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_commission_rules_save(uuid, jsonb) to authenticated;

-- Comisión de cada venta: producto > categoría > todos.
create or replace function public.erp__commission_lines(p_store uuid, p_from timestamptz, p_to timestamptz)
returns table (seller_id uuid, seller_name text, point_id uuid, revenue numeric, commission numeric)
language sql stable security definer set search_path = public as $$
  select m.seller_id, coalesce(nullif(btrim(m.seller_name), ''), 'Sin vendedor'), m.point_id,
         oi.quantity * oi.price,
         oi.quantity * oi.price * coalesce(
           (select r.pct from public.erp_commission_rules r where r.store_id = p_store and r.scope = 'product' and r.ref_id = oi.product_id),
           (select max(r.pct) from public.erp_commission_rules r where r.store_id = p_store and r.scope = 'category'
              and (r.ref_id = p.category_id or exists (select 1 from public.product_category_links l where l.product_id = oi.product_id and l.category_id = r.ref_id))),
           (select r.pct from public.erp_commission_rules r where r.store_id = p_store and r.scope = 'all'), 0) / 100
  from public.orders o
  join public.erp_order_meta m on m.order_id = o.id
  join public.order_items oi on oi.order_id = o.id
  left join public.products p on p.id = oi.product_id
  where o.store_id = p_store and o.status in ('confirmed', 'completed')
    and coalesce(o.confirmed_at, o.created_at) >= p_from and coalesce(o.confirmed_at, o.created_at) < p_to;
$$;
revoke all on function public.erp__commission_lines(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.erp_commissions(p_store uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_all boolean;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin acceso.'); end if;
  v_all := public.erp__team_manager(p_store);
  select jsonb_build_object('ok', true, 'all', v_all, 'sellers', coalesce(jsonb_agg(jsonb_build_object(
      'seller_id', seller_id, 'seller', seller_name, 'sales', round(rev), 'commission', round(com), 'orders', n) order by rev desc), '[]'::jsonb))
  into r
  from (
    select seller_id, max(seller_name) as seller_name, sum(revenue) as rev, sum(commission) as com, count(*) as n
    from public.erp__commission_lines(p_store, p_from, p_to)
    where v_all or seller_id = auth.uid()
    group by seller_id
  ) x;
  return r;
end;
$$;
revoke all on function public.erp_commissions(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.erp_commissions(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- 2. metas
create table if not exists public.erp_goals (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  month date not null,
  point_id uuid references public.erp_warehouses(id) on delete cascade,
  seller_id uuid,
  seller_name text,
  amount numeric(16, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists erp_goals_one on public.erp_goals (store_id, month, coalesce(point_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(seller_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.erp_goals enable row level security;
revoke all on public.erp_goals from anon, authenticated;

create or replace function public.erp_goal_save(p_store uuid, p_month date, p_point uuid, p_seller uuid, p_seller_name text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  if not public.erp__team_manager(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  delete from public.erp_goals where store_id = p_store and month = v_month and point_id is not distinct from p_point and seller_id is not distinct from p_seller;
  if coalesce(p_amount, 0) > 0 then
    insert into public.erp_goals (store_id, month, point_id, seller_id, seller_name, amount) values (p_store, v_month, p_point, p_seller, nullif(btrim(coalesce(p_seller_name, '')), ''), p_amount);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_goal_save(uuid, date, uuid, uuid, text, numeric) from public, anon;
grant execute on function public.erp_goal_save(uuid, date, uuid, uuid, text, numeric) to authenticated;

create or replace function public.erp_goals_progress(p_store uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'America/Bogota')::date))::date;
  t0 timestamptz; t1 timestamptz; v_days integer; v_elapsed numeric; v_all boolean; v uuid[]; r jsonb;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin acceso.'); end if;
  t0 := v_month::timestamp at time zone 'America/Bogota';
  t1 := (v_month + interval '1 month')::timestamp at time zone 'America/Bogota';
  v_days := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_elapsed := least(v_days, greatest(0.5, extract(epoch from least(now(), t1) - t0) / 86400));
  v_all := public.erp__team_manager(p_store);
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  with sold as (
    select m.point_id, m.seller_id, sum(o.total) as total
    from public.orders o join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed') and coalesce(o.confirmed_at, o.created_at) >= t0 and coalesce(o.confirmed_at, o.created_at) < t1
    group by 1, 2
  )
  select jsonb_build_object('ok', true, 'month', v_month, 'days', v_days, 'elapsed', round(v_elapsed, 1), 'manage', v_all,
    'goals', coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'point_id', g.point_id, 'point', w.name, 'seller_id', g.seller_id, 'seller', g.seller_name, 'amount', g.amount,
      'done', round(x.done), 'pct', round(x.done / g.amount * 100, 1),
      'projection', round(x.done / v_elapsed * v_days),
      'per_day_needed', case when v_days - v_elapsed > 0 then round(greatest(0, g.amount - x.done) / (v_days - v_elapsed)) end)
      order by g.seller_id nulls first, w.name), '[]'::jsonb))
  into r
  from public.erp_goals g
  left join public.erp_warehouses w on w.id = g.point_id
  cross join lateral (select coalesce(sum(s.total), 0) as done from sold s
                      where (g.point_id is null or s.point_id = g.point_id) and (g.seller_id is null or s.seller_id = g.seller_id)) x
  where g.store_id = p_store and g.month = v_month
    and (v_all or g.seller_id = auth.uid() or (g.seller_id is null and (v is null or g.point_id = any (v))));
  return r;
end;
$$;
revoke all on function public.erp_goals_progress(uuid, date) from public, anon;
grant execute on function public.erp_goals_progress(uuid, date) to authenticated;

-- ---------------------------------------------------------------- 3. garantías
create table if not exists public.erp_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  point_id uuid references public.erp_warehouses(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  qty integer not null default 1,
  customer_name text not null,
  customer_phone text,
  sale_doc text,
  bought_on date,
  problem text not null,
  kind text not null default 'warranty' check (kind in ('warranty', 'return')),
  status text not null default 'received' check (status in ('received', 'supplier', 'repair', 'replaced', 'refunded', 'rejected', 'delivered')),
  supplier_id uuid,
  resolution text,
  events jsonb not null default '[]'::jsonb,
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (store_id, number)
);
alter table public.erp_warranty_claims enable row level security;
revoke all on public.erp_warranty_claims from anon, authenticated;

create or replace function public.erp__warranty_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'sales_return'));
$$;
grant execute on function public.erp__warranty_allowed(uuid) to authenticated;

create or replace function public.erp_warranty_save(p_store uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_num bigint; v_id uuid; v_name text;
begin
  if not public.erp__warranty_allowed(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  if coalesce(btrim(p->>'product_name'), '') = '' or coalesce(btrim(p->>'customer_name'), '') = '' or coalesce(btrim(p->>'problem'), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Falta el producto, el cliente o la falla.');
  end if;
  v_name := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end;
  perform pg_advisory_xact_lock(hashtext('warranty:' || p_store::text));
  select coalesce(max(number), 0) + 1 into v_num from public.erp_warranty_claims where store_id = p_store;
  insert into public.erp_warranty_claims (store_id, number, point_id, product_id, product_name, qty, customer_name, customer_phone, sale_doc, bought_on, problem, kind, created_by_name, events)
  values (p_store, v_num, nullif(p->>'point_id', '')::uuid, nullif(p->>'product_id', '')::uuid, upper(btrim(p->>'product_name')), greatest(1, coalesce((p->>'qty')::integer, 1)),
          upper(btrim(p->>'customer_name')), nullif(btrim(coalesce(p->>'customer_phone', '')), ''), nullif(upper(btrim(coalesce(p->>'sale_doc', ''))), ''),
          nullif(p->>'bought_on', '')::date, btrim(p->>'problem'), coalesce(nullif(p->>'kind', ''), 'warranty'), v_name,
          jsonb_build_array(jsonb_build_object('at', now(), 'status', 'received', 'by', v_name, 'note', 'Recibido')))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end;
$$;
revoke all on function public.erp_warranty_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_warranty_save(uuid, jsonb) to authenticated;

create or replace function public.erp_warranty_update(p_id uuid, p_status text, p_note text default null, p_supplier uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_warranty_claims; v_name text;
begin
  select * into c from public.erp_warranty_claims where id = p_id for update;
  if not found or not public.erp__warranty_allowed(c.store_id) then return jsonb_build_object('ok', false, 'error', 'No encontrado.'); end if;
  if p_status not in ('received', 'supplier', 'repair', 'replaced', 'refunded', 'rejected', 'delivered') then return jsonb_build_object('ok', false, 'error', 'Estado no válido.'); end if;
  v_name := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(c.store_id) end;
  update public.erp_warranty_claims set status = p_status,
    supplier_id = coalesce(p_supplier, supplier_id),
    resolution = case when p_status in ('replaced', 'refunded', 'rejected', 'delivered') then coalesce(nullif(btrim(coalesce(p_note, '')), ''), resolution) else resolution end,
    closed_at = case when p_status in ('delivered', 'refunded', 'rejected') then now() else null end,
    events = events || jsonb_build_array(jsonb_build_object('at', now(), 'status', p_status, 'by', v_name, 'note', nullif(btrim(coalesce(p_note, '')), '')))
  where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_warranty_update(uuid, text, text, uuid) from public, anon;
grant execute on function public.erp_warranty_update(uuid, text, text, uuid) to authenticated;

create or replace function public.erp_warranty_list(p_store uuid, p_open boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v uuid[];
begin
  if not public.erp__warranty_allowed(p_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'number', c.number, 'point', w.name, 'product_id', c.product_id, 'product_name', c.product_name, 'qty', c.qty,
      'customer_name', c.customer_name, 'customer_phone', c.customer_phone, 'sale_doc', c.sale_doc, 'bought_on', c.bought_on,
      'problem', c.problem, 'kind', c.kind, 'status', c.status, 'supplier', s.name, 'resolution', c.resolution, 'events', c.events,
      'created_by_name', c.created_by_name, 'created_at', c.created_at, 'days', floor(extract(epoch from now() - c.created_at) / 86400)::integer)
      order by c.created_at desc), '[]'::jsonb))
  into r
  from (select * from public.erp_warranty_claims where store_id = p_store and (not p_open or closed_at is null) order by created_at desc limit 300) c
  left join public.erp_warehouses w on w.id = c.point_id
  left join public.erp_suppliers s on s.id = c.supplier_id
  where v is null or c.point_id = any (v) or c.point_id is null;
  return r;
end;
$$;
revoke all on function public.erp_warranty_list(uuid, boolean) from public, anon;
grant execute on function public.erp_warranty_list(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 4. cliente fiel
create table if not exists public.erp_loyalty_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  enabled boolean not null default false,
  pesos_per_point integer not null default 1000 check (pesos_per_point >= 100),
  point_value numeric(10, 2) not null default 10 check (point_value > 0),
  min_redeem integer not null default 100 check (min_redeem >= 1),
  since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.erp_loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_key text not null,
  points integer not null check (points > 0),
  value numeric(14, 2) not null,
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.erp_loyalty_settings enable row level security;
alter table public.erp_loyalty_redemptions enable row level security;
revoke all on public.erp_loyalty_settings, public.erp_loyalty_redemptions from anon, authenticated;

create or replace function public.erp__customer_key(p_name text)
returns text language sql immutable as $$ select upper(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))); $$;

create or replace function public.erp_loyalty_settings_get(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp__is_store_member(p_store) then null else
    coalesce((select to_jsonb(s) - 'store_id' from public.erp_loyalty_settings s where s.store_id = p_store),
             jsonb_build_object('enabled', false, 'pesos_per_point', 1000, 'point_value', 10, 'min_redeem', 100)) end;
$$;
revoke all on function public.erp_loyalty_settings_get(uuid) from public, anon;
grant execute on function public.erp_loyalty_settings_get(uuid) to authenticated;

create or replace function public.erp_loyalty_settings_save(p_store uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.erp_can(p_store, 'store') or public.erp_can(p_store, 'price_approve')) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  insert into public.erp_loyalty_settings (store_id, enabled, pesos_per_point, point_value, min_redeem, since)
  values (p_store, coalesce((p->>'enabled')::boolean, false), coalesce((p->>'pesos_per_point')::integer, 1000), coalesce((p->>'point_value')::numeric, 10), coalesce((p->>'min_redeem')::integer, 100), now())
  on conflict (store_id) do update set enabled = excluded.enabled, pesos_per_point = excluded.pesos_per_point, point_value = excluded.point_value,
    min_redeem = excluded.min_redeem, updated_at = now(),
    since = case when not public.erp_loyalty_settings.enabled and excluded.enabled then now() else public.erp_loyalty_settings.since end;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_loyalty_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_loyalty_settings_save(uuid, jsonb) to authenticated;

-- Puntos de un cliente (por su nombre en las ventas, como en «Clientes frecuentes»).
create or replace function public.erp_loyalty_balance(p_store uuid, p_customer text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.erp_loyalty_settings; v_key text := public.erp__customer_key(p_customer); v_earned integer; v_used integer;
begin
  if auth.uid() is null or not public.erp__is_store_member(p_store) then return jsonb_build_object('ok', false); end if;
  select * into s from public.erp_loyalty_settings where store_id = p_store;
  if not found or not s.enabled or v_key = '' then return jsonb_build_object('ok', true, 'enabled', coalesce(s.enabled, false), 'points', 0); end if;
  select coalesce(floor(sum(o.total) / s.pesos_per_point), 0)::integer into v_earned
  from public.orders o
  where o.store_id = p_store and o.status in ('confirmed', 'completed') and coalesce(o.confirmed_at, o.created_at) >= s.since
    and public.erp__customer_key(o.customer_name) = v_key;
  select coalesce(sum(points), 0)::integer into v_used from public.erp_loyalty_redemptions where store_id = p_store and customer_key = v_key;
  return jsonb_build_object('ok', true, 'enabled', true, 'points', greatest(0, v_earned - v_used), 'earned', v_earned, 'used', v_used,
    'value', round(greatest(0, v_earned - v_used) * s.point_value), 'point_value', s.point_value, 'min_redeem', s.min_redeem, 'pesos_per_point', s.pesos_per_point);
end;
$$;
revoke all on function public.erp_loyalty_balance(uuid, text) from public, anon;
grant execute on function public.erp_loyalty_balance(uuid, text) to authenticated;

-- Canje: descuenta puntos y da el pase para los precios rebajados de la venta (el descuento = puntos × valor).
create or replace function public.erp_loyalty_redeem(p_store uuid, p_point uuid, p_customer text, p_points integer, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b jsonb; s public.erp_loyalty_settings; v_value numeric; v_discount numeric; it jsonb; v_out jsonb := '{}'::jsonb; v_id uuid; v_name text; v_prod uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'error', 'Sin permiso de POS.'); end if;
  b := public.erp_loyalty_balance(p_store, p_customer);
  select * into s from public.erp_loyalty_settings where store_id = p_store;
  if not coalesce((b->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'El programa de puntos está apagado.'); end if;
  if p_points < s.min_redeem then return jsonb_build_object('ok', false, 'error', format('Se canjean mínimo %s puntos.', s.min_redeem)); end if;
  if p_points > (b->>'points')::integer then return jsonb_build_object('ok', false, 'error', 'No tiene tantos puntos.'); end if;
  v_value := round(p_points * s.point_value);
  select coalesce(sum(((x->>'old')::numeric - (x->>'price')::numeric) * greatest(1, (x->>'qty')::integer)), 0) into v_discount from jsonb_array_elements(p_items) x;
  if abs(v_discount - v_value) > greatest(1, jsonb_array_length(p_items)) then return jsonb_build_object('ok', false, 'error', 'El descuento no coincide con los puntos.'); end if;
  v_name := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end;
  insert into public.erp_loyalty_redemptions (store_id, customer_key, points, value, created_by_name) values (p_store, public.erp__customer_key(p_customer), p_points, v_value, v_name);
  if to_regclass('public.erp_price_approvals') is not null then
    for it in select * from jsonb_array_elements(p_items) loop
      v_prod := (it->>'product_id')::uuid;
      insert into public.erp_price_approvals (store_id, point_id, product_id, product_name, qty, list_price, floor_price, requested_price, note, status,
        requested_by, requested_by_name, expires_at, decided_by, decided_by_name, decided_at, decision_note)
      select p_store, p_point, p.id, p.name, greatest(1, coalesce((it->>'qty')::integer, 1)), (it->>'old')::numeric, (it->>'price')::numeric, round((it->>'price')::numeric, 2),
        'Canje de puntos', 'approved', auth.uid(), v_name, now() + interval '2 hours', auth.uid(), 'Automático · Canje de puntos', now(), format('%s puntos', p_points)
      from public.products p where p.id = v_prod and p.store_id = p_store
      returning id into v_id;
      if v_id is not null then v_out := v_out || jsonb_build_object(v_prod::text, jsonb_build_object('id', v_id, 'status', 'approved', 'price', round((it->>'price')::numeric, 2), 'by', 'Canje de puntos')); end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'value', v_value, 'passes', v_out);
end;
$$;
revoke all on function public.erp_loyalty_redeem(uuid, uuid, text, integer, jsonb) from public, anon;
grant execute on function public.erp_loyalty_redeem(uuid, uuid, text, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------- 5. cobro con QR
create table if not exists public.erp_payment_qr (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade,
  label text not null,
  key_text text,
  image_url text,
  created_at timestamptz not null default now(),
  check (image_url is null or image_url ~* '^https://')
);
alter table public.erp_payment_qr enable row level security;
revoke all on public.erp_payment_qr from anon, authenticated;

create or replace function public.erp_payment_qr_list(p_store uuid, p_point uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'point_id', q.point_id, 'label', q.label, 'key_text', q.key_text, 'image_url', q.image_url)
      order by q.point_id nulls last, q.label), '[]'::jsonb) end
  from public.erp_payment_qr q where q.store_id = p_store and (p_point is null or q.point_id is null or q.point_id = p_point);
$$;
revoke all on function public.erp_payment_qr_list(uuid, uuid) from public, anon;
grant execute on function public.erp_payment_qr_list(uuid, uuid) to authenticated;

create or replace function public.erp_payment_qr_save(p_store uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not public.erp_can(p_store, 'store') then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Mi tienda».'); end if;
  if coalesce((p->>'delete')::boolean, false) then delete from public.erp_payment_qr where id = v_id and store_id = p_store; return jsonb_build_object('ok', true); end if;
  if coalesce(btrim(p->>'label'), '') = '' then return jsonb_build_object('ok', false, 'error', 'Ponle un nombre (ej. Nequi).'); end if;
  if v_id is null then
    insert into public.erp_payment_qr (store_id, point_id, label, key_text, image_url)
    values (p_store, nullif(p->>'point_id', '')::uuid, btrim(p->>'label'), nullif(btrim(coalesce(p->>'key_text', '')), ''), nullif(p->>'image_url', ''))
    returning id into v_id;
  else
    update public.erp_payment_qr set point_id = nullif(p->>'point_id', '')::uuid, label = btrim(p->>'label'), key_text = nullif(btrim(coalesce(p->>'key_text', '')), ''), image_url = nullif(p->>'image_url', '')
    where id = v_id and store_id = p_store;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_payment_qr_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_payment_qr_save(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
