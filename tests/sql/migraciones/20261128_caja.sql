-- =====================================================================
-- REMHUB · Caja por punto: apertura, cierre, arqueo y diferencias
--
--   · Cada punto abre su caja con una base y la cierra contando billetes y
--     monedas. El sistema calcula cuánto efectivo DEBE haber:
--       base + ventas del POS en efectivo + abonos de cartera en efectivo
--       − gastos pagados en efectivo − efectivo entregado a la bodega
--       ± entradas y salidas de caja (con motivo).
--   · Si la diferencia (sobrante o faltante) pasa la tolerancia de la tienda,
--     el cierre queda «por revisar» hasta que la madre lo apruebe con nota.
--   · Una caja abierta por punto. Cada punto ve solo la suya; la madre, todas.
--   · Permisos nuevos: cash («Caja de su punto») y cash_manage («Revisar
--     cajas de todos los puntos»). «cash» se entrega una sola vez a quien
--     hoy usa el POS.
--
-- No toca las ventas ni sus funciones: solo LEE lo que ya se registra.
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
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'price_approve', 'exports', 'cash', 'cash_manage', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
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
do $$
declare v_new boolean;
begin
  insert into public.erp_migration_marks (key) values ('20261128_grants') on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new then
    update public.store_users set permissions = array_append(permissions, 'cash')
    where 'pos' = any (permissions) and not ('cash' = any (permissions));
  end if;
end $$;

-- 1. Tablas
create table if not exists public.erp_cash_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  tolerance numeric not null default 2000 check (tolerance >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id),
  number bigint not null,
  status text not null default 'open' check (status in ('open', 'review', 'closed')),
  opening_amount numeric not null default 0 check (opening_amount >= 0),
  opening_note text,
  opened_by uuid,
  opened_by_name text,
  opened_at timestamptz not null default now(),
  expected_amount numeric,
  counted_amount numeric,
  counted_detail jsonb,
  difference numeric,
  breakdown jsonb,
  closing_note text,
  closed_by uuid,
  closed_by_name text,
  closed_at timestamptz,
  review_note text,
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  unique (store_id, number)
);
create unique index if not exists erp_cash_one_open on public.erp_cash_sessions (point_id) where status = 'open';
create index if not exists erp_cash_sessions_point on public.erp_cash_sessions (store_id, point_id, opened_at desc);

create table if not exists public.erp_cash_moves (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.erp_cash_sessions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null check (kind in ('in', 'out')),
  amount numeric not null check (amount > 0),
  reason text not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);

alter table public.erp_cash_settings enable row level security;
alter table public.erp_cash_sessions enable row level security;
alter table public.erp_cash_moves enable row level security;
revoke all on public.erp_cash_settings, public.erp_cash_sessions, public.erp_cash_moves from anon, authenticated;

-- 2. Lo que entra y sale en efectivo (solo lectura de lo que ya se registra).
-- Ventas del POS: partes en efectivo de la forma de pago (20261115).
create or replace function public.erp__cash_pos(p_store uuid, p_point uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  begin
    execute $q$
      with pay as (
        select o.id, (m.payment->>'at')::timestamptz as at, part->>'method' as method, coalesce((part->>'amount')::numeric, 0) as amount
        from public.erp_order_meta m
        join public.orders o on o.id = m.order_id
        cross join lateral jsonb_array_elements(coalesce(m.payment->'parts', '[]'::jsonb)) part
        where o.store_id = $1 and m.point_id = $2 and o.status in ('confirmed', 'completed')
          and (m.payment->>'at')::timestamptz >= $3 and (m.payment->>'at')::timestamptz < $4
      )
      select jsonb_build_object(
        'cash', coalesce(sum(amount) filter (where method = 'efectivo'), 0),
        'sales', count(distinct id),
        'by_method', coalesce((select jsonb_object_agg(method, total) from (select method, sum(amount) as total from pay group by method) x), '{}'::jsonb))
      from pay $q$
    into v using p_store, p_point, p_from, p_to;
  exception when undefined_column or undefined_table then
    v := jsonb_build_object('cash', 0, 'sales', 0, 'by_method', '{}'::jsonb, 'unsupported', true);
  end;
  return v;
end $$;

-- Abonos de cartera en efectivo recibidos en el punto.
create or replace function public.erp__cash_receivables(p_store uuid, p_point uuid, p_from timestamptz, p_to timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric := 0;
begin
  begin
    execute $q$
      select coalesce(sum((to_jsonb(rp)->>'amount')::numeric), 0)
      from public.erp_receivable_payments rp
      join public.erp_receivables r on r.id = (to_jsonb(rp)->>'receivable_id')::uuid
      where (to_jsonb(rp)->>'store_id')::uuid = $1 and (to_jsonb(r)->>'point_id')::uuid = $2
        and coalesce(to_jsonb(rp)->>'method', '') in ('cash', 'efectivo')
        and not coalesce((to_jsonb(rp)->>'voided')::boolean, false)
        and coalesce((to_jsonb(rp)->>'paid_at')::timestamptz, (to_jsonb(rp)->>'created_at')::timestamptz) >= $3
        and coalesce((to_jsonb(rp)->>'paid_at')::timestamptz, (to_jsonb(rp)->>'created_at')::timestamptz) < $4 $q$
    into v using p_store, p_point, p_from, p_to;
  exception when undefined_column or undefined_table or invalid_text_representation then v := 0;
  end;
  return coalesce(v, 0);
end $$;

-- Gastos pagados en efectivo desde el punto (20261110).
create or replace function public.erp__cash_expenses(p_store uuid, p_point uuid, p_from timestamptz, p_to timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric := 0;
begin
  begin
    execute $q$
      select coalesce(sum(ep.amount), 0)
      from public.erp_expense_payments ep join public.erp_expenses e on e.id = ep.expense_id
      where ep.store_id = $1 and e.point_id = $2 and ep.method in ('cash', 'efectivo') and not ep.voided
        and ep.paid_at >= $3 and ep.paid_at < $4 $q$
    into v using p_store, p_point, p_from, p_to;
  exception when undefined_column or undefined_table then v := 0;
  end;
  return coalesce(v, 0);
end $$;

-- Efectivo entregado a la bodega (abonos de la cuenta con puntos, 20261124).
create or replace function public.erp__cash_to_bodega(p_store uuid, p_point uuid, p_from timestamptz, p_to timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric := 0;
begin
  begin
    execute $q$
      select coalesce(sum(amount), 0) from public.erp_internal_payments
      where store_id = $1 and point_id = $2 and method = 'cash' and not voided and created_at >= $3 and created_at < $4 $q$
    into v using p_store, p_point, p_from, p_to;
  exception when undefined_column or undefined_table then v := 0;
  end;
  return coalesce(v, 0);
end $$;

-- Cuadre de una caja (esperado y de dónde sale).
create or replace function public.erp__cash_breakdown(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.erp_cash_sessions; v_to timestamptz; v_pos jsonb; v_rec numeric; v_exp numeric; v_bod numeric; v_in numeric; v_out numeric;
begin
  select * into c from public.erp_cash_sessions where id = p_session;
  if not found then return null; end if;
  v_to := coalesce(c.closed_at, now());
  v_pos := public.erp__cash_pos(c.store_id, c.point_id, c.opened_at, v_to);
  v_rec := public.erp__cash_receivables(c.store_id, c.point_id, c.opened_at, v_to);
  v_exp := public.erp__cash_expenses(c.store_id, c.point_id, c.opened_at, v_to);
  v_bod := public.erp__cash_to_bodega(c.store_id, c.point_id, c.opened_at, v_to);
  select coalesce(sum(amount) filter (where kind = 'in'), 0), coalesce(sum(amount) filter (where kind = 'out'), 0)
  into v_in, v_out from public.erp_cash_moves where session_id = p_session;
  return jsonb_build_object(
    'opening', c.opening_amount,
    'pos_cash', (v_pos->>'cash')::numeric, 'pos_sales', (v_pos->>'sales')::integer, 'pos_by_method', v_pos->'by_method',
    'receivables_cash', v_rec, 'expenses_cash', v_exp, 'to_bodega', v_bod, 'moves_in', v_in, 'moves_out', v_out,
    'expected', round(c.opening_amount + (v_pos->>'cash')::numeric + v_rec - v_exp - v_bod + v_in - v_out, 2));
end $$;

do $$
declare f text;
begin
  foreach f in array array['erp__cash_pos(uuid, uuid, timestamptz, timestamptz)', 'erp__cash_receivables(uuid, uuid, timestamptz, timestamptz)',
                           'erp__cash_expenses(uuid, uuid, timestamptz, timestamptz)', 'erp__cash_to_bodega(uuid, uuid, timestamptz, timestamptz)',
                           'erp__cash_breakdown(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- 3. ¿Puede usar esta caja? (su punto con «Caja», o la madre con «Revisar cajas»)
create or replace function public.erp__cash_can(p_store uuid, p_point uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    (public.erp_can(p_store, 'cash_manage') and public.erp_my_points(p_store) is null)
    or (public.erp_can(p_store, 'cash') and public.erp_point_allowed(p_store, p_point)));
$$;
create or replace function public.erp__cash_manager(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_can(p_store, 'cash_manage') and public.erp_my_points(p_store) is null;
$$;
revoke all on function public.erp__cash_can(uuid, uuid) from public, anon, authenticated;
revoke all on function public.erp__cash_manager(uuid) from public, anon, authenticated;

-- 4. Abrir, mover, cerrar y revisar.
create or replace function public.erp_cash_open(p_store uuid, p_point uuid, p_amount numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.erp__cash_can(p_store, p_point) then raise exception 'Necesitas el permiso «Caja» en este punto.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_point and store_id = p_store and active) then raise exception 'Punto no válido.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Escribe la base con la que abre la caja (puede ser 0).'; end if;
  if exists (select 1 from public.erp_cash_sessions where point_id = p_point and status = 'open') then
    raise exception 'Este punto ya tiene una caja abierta. Ciérrala antes de abrir otra.';
  end if;
  insert into public.erp_cash_sessions (store_id, point_id, number, opening_amount, opening_note, opened_by, opened_by_name)
  values (p_store, p_point, public.erp_next_number(p_store, 'cash_session'), round(p_amount, 2), left(nullif(btrim(coalesce(p_note, '')), ''), 300),
          auth.uid(), public.erp_actor_name(p_store))
  returning id into v_id;
  perform public.erp_audit(p_store, 'cash.opened', 'erp_cash_sessions', v_id, jsonb_build_object('point_id', p_point, 'opening', p_amount));
  return v_id;
end $$;

create or replace function public.erp_cash_move(p_session uuid, p_kind text, p_amount numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_cash_sessions;
begin
  select * into c from public.erp_cash_sessions where id = p_session for update;
  if not found then raise exception 'Caja no encontrada.'; end if;
  if not public.erp__cash_can(c.store_id, c.point_id) then raise exception 'Necesitas el permiso «Caja» en este punto.'; end if;
  if c.status <> 'open' then raise exception 'La caja ya está cerrada.'; end if;
  if p_kind not in ('in', 'out') then raise exception 'Tipo inválido.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Escribe el valor.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Escribe el motivo.'; end if;
  insert into public.erp_cash_moves (session_id, store_id, kind, amount, reason, created_by, created_by_name)
  values (c.id, c.store_id, p_kind, round(p_amount, 2), left(btrim(p_reason), 200), auth.uid(), public.erp_actor_name(c.store_id));
  perform public.erp_audit(c.store_id, 'cash.move', 'erp_cash_sessions', c.id, jsonb_build_object('kind', p_kind, 'amount', p_amount, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.erp_cash_close(p_session uuid, p_counted numeric, p_detail jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_cash_sessions; b jsonb; v_diff numeric; v_tol numeric; v_status text;
begin
  select * into c from public.erp_cash_sessions where id = p_session for update;
  if not found then raise exception 'Caja no encontrada.'; end if;
  if not public.erp__cash_can(c.store_id, c.point_id) then raise exception 'Necesitas el permiso «Caja» en este punto.'; end if;
  if c.status <> 'open' then raise exception 'La caja ya está cerrada.'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Escribe cuánto efectivo contaste.'; end if;
  update public.erp_cash_sessions set closed_at = now() where id = c.id;
  b := public.erp__cash_breakdown(c.id);
  v_diff := round(p_counted - (b->>'expected')::numeric, 2);
  v_tol := coalesce((select tolerance from public.erp_cash_settings where store_id = c.store_id), 2000);
  if abs(v_diff) > v_tol and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Hay una diferencia de %: explica qué pasó en la nota.', public.erp__fmt_money(v_diff);
  end if;
  v_status := case when abs(v_diff) > v_tol then 'review' else 'closed' end;
  update public.erp_cash_sessions
  set status = v_status, expected_amount = (b->>'expected')::numeric, counted_amount = round(p_counted, 2), counted_detail = p_detail,
      difference = v_diff, breakdown = b, closing_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500),
      closed_by = auth.uid(), closed_by_name = public.erp_actor_name(c.store_id)
  where id = c.id;
  perform public.erp_audit(c.store_id, 'cash.closed', 'erp_cash_sessions', c.id,
    jsonb_build_object('expected', b->>'expected', 'counted', p_counted, 'difference', v_diff, 'status', v_status));
  return jsonb_build_object('ok', true, 'status', v_status, 'expected', (b->>'expected')::numeric, 'difference', v_diff);
end $$;

create or replace function public.erp_cash_review(p_session uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.erp_cash_sessions;
begin
  select * into c from public.erp_cash_sessions where id = p_session for update;
  if not found then raise exception 'Caja no encontrada.'; end if;
  if not public.erp__cash_manager(c.store_id) then raise exception 'Solo la tienda madre con «Revisar cajas» aprueba diferencias.'; end if;
  if c.status <> 'review' then raise exception 'Esa caja no está por revisar.'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Escribe la nota de revisión.'; end if;
  if c.closed_by = auth.uid() then raise exception 'No puedes aprobar la diferencia de una caja que tú mismo cerraste.'; end if;
  update public.erp_cash_sessions set status = 'closed', review_note = left(btrim(p_note), 500), reviewed_by = auth.uid(),
    reviewed_by_name = public.erp_actor_name(c.store_id), reviewed_at = now() where id = c.id;
  perform public.erp_audit(c.store_id, 'cash.reviewed', 'erp_cash_sessions', c.id, jsonb_build_object('difference', c.difference, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.erp_cash_settings_save(p_store uuid, p_tolerance numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.erp__cash_manager(p_store) then raise exception 'Solo la tienda madre con «Revisar cajas» cambia esto.'; end if;
  if p_tolerance is null or p_tolerance < 0 then raise exception 'Tolerancia inválida.'; end if;
  insert into public.erp_cash_settings (store_id, tolerance, updated_by) values (p_store, round(p_tolerance, 2), auth.uid())
  on conflict (store_id) do update set tolerance = excluded.tolerance, updated_by = excluded.updated_by, updated_at = now();
  perform public.erp_audit(p_store, 'cash.settings', 'erp_cash_settings', null, jsonb_build_object('tolerance', p_tolerance));
  return jsonb_build_object('ok', true);
end $$;

-- 5. Tablero de cajas y detalle de una caja.
create or replace function public.erp_cash_board(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pts uuid[] := public.erp_my_points(p_store); v_manage boolean;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['cash', 'cash_manage']) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Caja».');
  end if;
  v_manage := public.erp__cash_manager(p_store);
  return jsonb_build_object(
    'ok', true, 'can_manage', v_manage,
    'tolerance', coalesce((select tolerance from public.erp_cash_settings where store_id = p_store), 2000),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('point_id', w.id, 'name', w.name, 'kind', w.kind,
               'open', (select jsonb_build_object('id', c.id, 'number', c.number, 'opened_at', c.opened_at, 'opened_by', c.opened_by_name,
                                                  'opening', c.opening_amount, 'breakdown', public.erp__cash_breakdown(c.id))
                        from public.erp_cash_sessions c where c.point_id = w.id and c.status = 'open'),
               'last_closed', (select jsonb_build_object('closed_at', c.closed_at, 'difference', c.difference, 'status', c.status)
                               from public.erp_cash_sessions c where c.point_id = w.id and c.status <> 'open' order by c.closed_at desc limit 1))
             order by w.is_default, w.name)
      from public.erp_warehouses w
      where w.store_id = p_store and w.active and (v_pts is null or w.id = any (v_pts))
        and (v_manage or public.erp__cash_can(p_store, w.id))), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(x order by x->>'closed_at' desc) from (
        select jsonb_build_object('id', c.id, 'number', c.number, 'point', w.name, 'point_id', c.point_id, 'status', c.status,
                 'opened_at', c.opened_at, 'closed_at', c.closed_at, 'opened_by', c.opened_by_name, 'closed_by', c.closed_by_name,
                 'expected', c.expected_amount, 'counted', c.counted_amount, 'difference', c.difference, 'closing_note', c.closing_note,
                 'review_note', c.review_note, 'reviewed_by', c.reviewed_by_name) as x
        from public.erp_cash_sessions c join public.erp_warehouses w on w.id = c.point_id
        where c.store_id = p_store and c.status <> 'open' and (v_pts is null or c.point_id = any (v_pts))
        order by c.closed_at desc limit 60) h), '[]'::jsonb));
end $$;

create or replace function public.erp_cash_session(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.erp_cash_sessions;
begin
  select * into c from public.erp_cash_sessions where id = p_session;
  if not found then return jsonb_build_object('ok', false, 'error', 'Caja no encontrada.'); end if;
  if not public.erp__cash_can(c.store_id, c.point_id) then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Caja» en este punto.'); end if;
  return jsonb_build_object('ok', true,
    'session', to_jsonb(c) - 'opened_by' - 'closed_by' - 'reviewed_by',
    'point', (select name from public.erp_warehouses where id = c.point_id),
    'breakdown', case when c.status = 'open' then public.erp__cash_breakdown(c.id) else c.breakdown end,
    'moves', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'amount', m.amount, 'reason', m.reason, 'by', m.created_by_name, 'at', m.created_at) order by m.created_at)
                       from public.erp_cash_moves m where m.session_id = c.id), '[]'::jsonb));
end $$;

do $$
declare f text;
begin
  foreach f in array array['erp_cash_open(uuid, uuid, numeric, text)', 'erp_cash_move(uuid, text, numeric, text)', 'erp_cash_close(uuid, numeric, jsonb, text)',
                           'erp_cash_review(uuid, text)', 'erp_cash_settings_save(uuid, numeric)', 'erp_cash_board(uuid)', 'erp_cash_session(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Formato de plata (también lo crea 20261124; se repite para no depender de ella).
create or replace function public.erp__fmt_money(v numeric)
returns text language sql immutable as $$ select '$' || replace(to_char(round(coalesce(v, 0)), 'FM999,999,999,999,990'), ',', '.') $$;

notify pgrst, 'reload schema';
