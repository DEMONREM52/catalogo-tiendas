-- =====================================================================
-- REMHUB · POS: límites para bajar el precio, autorizaciones y pagos
--
--   1. Límite de precio por PUNTO y por USUARIO (el del usuario manda):
--        · list    → no puede bajar del precio de lista del punto
--        · mother  → puede bajar hasta el precio de la madre
--        · margin  → puede bajar hasta costo + X %
--        · cost    → puede bajar hasta el costo
--      Quien tiene «Autorizar precios» (price_approve) no tiene límite.
--      Sin configurar: «list» (nadie baja precios sin que la madre lo permita).
--   2. La base revisa CADA línea de venta (no solo la pantalla): si el precio
--      está por debajo del límite, solo pasa con una autorización aprobada.
--   3. Autorizaciones: el vendedor pide, quien tiene el permiso aprueba o
--      rechaza (vence a los 15 min), y queda registrado quién y por qué.
--   4. Forma de pago del POS (efectivo, transferencia, mixto, vuelto).
--
-- Requiere 20261106 y 20261113. No borra datos. Es idempotente.
-- =====================================================================

-- 0. Permisos (igual que src/lib/store-user-auth.ts).
create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'price_approve', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'inventory_alerts', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'suppliers', 'payables', 'audit', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit',
    'profit_view', 'profit_rules', 'profit_approve',
    'profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay',
    'expenses', 'expenses_pay', 'budgets', 'payroll', 'payroll_approve', 'payroll_pay'
  ]::text[];
$$;

-- ================================================================ 1. LÍMITES
create table if not exists public.erp_price_limits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete cascade,
  user_id uuid,
  mode text not null check (mode in ('list', 'mother', 'margin', 'cost')),
  margin_pct numeric(9, 4) not null default 0 check (margin_pct between 0 and 1000),
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  check ((point_id is null) <> (user_id is null))
);
create unique index if not exists erp_price_limits_point on public.erp_price_limits (store_id, point_id) where point_id is not null;
create unique index if not exists erp_price_limits_user on public.erp_price_limits (store_id, user_id) where user_id is not null;
alter table public.erp_price_limits enable row level security;
revoke all on public.erp_price_limits from anon, authenticated;

-- Punto asignado a un usuario (null = usuario de la madre).
create or replace function public.erp__user_point(p_store uuid, p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select su.point_id from public.store_users su where su.store_id = p_store and su.user_id = p_user and su.active limit 1;
$$;
revoke all on function public.erp__user_point(uuid, uuid) from public, anon, authenticated;

-- Precio mínimo permitido para un usuario. Devuelve {floor, list, mode, margin_pct, source, free}.
create or replace function public.erp__price_floor(p_store uuid, p_user uuid, p_product uuid, p_point uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.products;
  v_point uuid;
  l public.erp_price_limits;
  v_source text := 'default';
  r public.erp_price_rules;
  s public.erp_profit_settings;
  v_list numeric;
  v_mother numeric;
  v_cost numeric;
  v_floor numeric;
  v_free boolean;
begin
  v_free := exists (select 1 from public.stores st where st.id = p_store and st.owner_id = p_user)
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = p_user and su.active
               and ('price_approve' = any (su.permissions) or su.role in ('admin', 'owner')));
  -- El punto del usuario manda; un usuario de la madre usa el punto desde donde vende.
  v_point := coalesce(public.erp__user_point(p_store, p_user), p_point);

  select * into l from public.erp_price_limits where store_id = p_store and user_id = p_user;
  if found then v_source := 'user';
  elsif v_point is not null then
    select * into l from public.erp_price_limits where store_id = p_store and point_id = v_point;
    if found then v_source := 'point'; end if;
  end if;

  select * into p from public.products where id = p_product and store_id = p_store;
  if not found then
    -- Sin producto: solo el tipo de límite de quien vende.
    return jsonb_build_object('floor', 0, 'list', 0, 'mode', case when v_free then 'free' else coalesce(l.mode, 'list') end,
      'margin_pct', coalesce(l.margin_pct, 0), 'source', case when v_free then 'approver' else v_source end, 'free', v_free);
  end if;

  -- Precio de la madre: el menor de sus precios 1-5 (los que tengan valor).
  select min(x) into v_mother from unnest(array[
    public.catalog__price(p, 1), public.catalog__price(p, 2), public.catalog__price(p, 3), public.catalog__price(p, 4), public.catalog__price(p, 5)]) x
  where x > 0;
  -- Precio de lista en el punto (con su regla, si tiene).
  if v_point is not null then
    r := public.erp__rule_for(p_store, v_point, p.id);
    select * into s from public.erp_profit_settings where store_id = p_store;
    if r.id is not null then
      select min(x) into v_list from unnest(array[
        public.erp__point_price(p, 1, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
        public.erp__point_price(p, 2, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
        public.erp__point_price(p, 3, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
        public.erp__point_price(p, 4, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
        public.erp__point_price(p, 5, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest'))]) x
      where x > 0;
    end if;
  end if;
  v_list := coalesce(v_list, v_mother, 0);
  v_mother := coalesce(v_mother, v_list);
  v_cost := coalesce(p.cost_price, 0);

  v_floor := case coalesce(l.mode, 'list')
    when 'list' then v_list
    when 'mother' then v_mother
    when 'margin' then case when v_cost > 0 then ceil(v_cost * (1 + coalesce(l.margin_pct, 0) / 100)) else v_list end
    when 'cost' then case when v_cost > 0 then v_cost else v_list end
  end;
  -- El límite nunca obliga a vender por encima del precio de lista.
  if v_list > 0 then v_floor := least(v_floor, v_list); end if;

  return jsonb_build_object('floor', case when v_free then 0 else round(coalesce(v_floor, 0), 2) end, 'list', round(v_list, 2),
    'mode', case when v_free then 'free' else coalesce(l.mode, 'list') end, 'margin_pct', coalesce(l.margin_pct, 0),
    'source', case when v_free then 'approver' else v_source end, 'free', v_free);
end;
$$;
revoke all on function public.erp__price_floor(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Para el POS: el límite de quien vende en cada producto del carrito (sin mostrar el costo).
create or replace function public.erp_pos_price_floors(p_store uuid, p_point uuid, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_out jsonb := '{}'::jsonb; v_id uuid; f jsonb; v_mode jsonb;
begin
  if v_uid is null or not public.erp__is_store_member(p_store) then raise exception 'No perteneces a esta tienda.'; end if;
  if p_point is not null and not public.erp_point_allowed(p_store, p_point) then raise exception 'Ese punto no lo tienes asignado.'; end if;
  foreach v_id in array coalesce(p_ids[1:200], '{}') loop
    f := public.erp__price_floor(p_store, v_uid, v_id, p_point);
    v_out := v_out || jsonb_build_object(v_id::text, jsonb_build_object('floor', f->'floor', 'list', f->'list'));
    v_mode := f;
  end loop;
  if v_mode is null then v_mode := public.erp__price_floor(p_store, v_uid, null, p_point); end if;
  return jsonb_build_object('mode', v_mode->'mode', 'margin_pct', v_mode->'margin_pct', 'source', v_mode->'source', 'free', v_mode->'free',
    'can_approve', public.erp_can(p_store, 'price_approve'), 'floors', v_out);
end;
$$;
revoke all on function public.erp_pos_price_floors(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.erp_pos_price_floors(uuid, uuid, uuid[]) to authenticated;

-- Configuración (madre): ver y guardar límites.
create or replace function public.erp_price_limits_get(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'profit_rules') or public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'price_approve')) then
    raise exception 'Necesitas un permiso de Rentabilidad para ver los límites de precio.';
  end if;
  return jsonb_build_object(
    'can_edit', public.erp_can(p_store, 'profit_rules') and public.erp_my_points(p_store) is null,
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('point_id', w.id, 'name', w.name, 'kind', w.kind, 'mode', l.mode, 'margin_pct', l.margin_pct,
                                          'updated_by_name', l.updated_by_name, 'updated_at', l.updated_at) order by w.kind desc, w.name)
      from public.erp_warehouses w left join public.erp_price_limits l on l.store_id = w.store_id and l.point_id = w.id
      where w.store_id = p_store and w.active), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', su.user_id,
                                          'name', coalesce(nullif(trim(su.display_name), ''), nullif(trim(su.username), ''), 'Usuario'),
                                          'point_id', su.point_id, 'point_name', w.name,
                                          'approver', 'price_approve' = any (su.permissions) or su.role in ('admin', 'owner'),
                                          'mode', l.mode, 'margin_pct', l.margin_pct) order by w.name nulls first, su.display_name)
      from public.store_users su
      left join public.erp_warehouses w on w.id = su.point_id
      left join public.erp_price_limits l on l.store_id = su.store_id and l.user_id = su.user_id
      where su.store_id = p_store and su.active), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_price_limits_get(uuid) from public, anon;
grant execute on function public.erp_price_limits_get(uuid) to authenticated;

create or replace function public.erp_price_limit_save(p_store uuid, p_point uuid, p_user uuid, p_mode text, p_margin_pct numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp_can(p_store, 'profit_rules') or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la madre (permiso «Reglas de precio») cambia los límites de precio.';
  end if;
  if (p_point is null) = (p_user is null) then raise exception 'Elige un punto o un usuario.'; end if;
  if p_point is not null and not exists (select 1 from public.erp_warehouses where id = p_point and store_id = p_store) then raise exception 'Punto no válido.'; end if;
  if p_user is not null and not exists (select 1 from public.store_users where user_id = p_user and store_id = p_store) then raise exception 'Usuario no válido.'; end if;
  if p_mode is null then
    delete from public.erp_price_limits where store_id = p_store and (point_id = p_point or user_id = p_user);
  else
    if p_mode not in ('list', 'mother', 'margin', 'cost') then raise exception 'Tipo de límite no válido.'; end if;
    if p_mode = 'margin' and (p_margin_pct is null or p_margin_pct < 0 or p_margin_pct > 1000) then raise exception 'Escribe un %% entre 0 y 1000.'; end if;
    if p_point is not null then
      insert into public.erp_price_limits (store_id, point_id, mode, margin_pct, updated_by, updated_by_name)
      values (p_store, p_point, p_mode, coalesce(p_margin_pct, 0), auth.uid(), public.erp_actor_name(p_store))
      on conflict (store_id, point_id) where point_id is not null
      do update set mode = excluded.mode, margin_pct = excluded.margin_pct, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
    else
      insert into public.erp_price_limits (store_id, user_id, mode, margin_pct, updated_by, updated_by_name)
      values (p_store, p_user, p_mode, coalesce(p_margin_pct, 0), auth.uid(), public.erp_actor_name(p_store))
      on conflict (store_id, user_id) where user_id is not null
      do update set mode = excluded.mode, margin_pct = excluded.margin_pct, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
    end if;
  end if;
  perform public.erp_audit(p_store, 'price_limit.saved', 'erp_price_limits', coalesce(p_point, p_user),
    jsonb_build_object('point', p_point, 'user', p_user, 'mode', p_mode, 'margin_pct', p_margin_pct));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_price_limit_save(uuid, uuid, uuid, text, numeric) from public, anon;
grant execute on function public.erp_price_limit_save(uuid, uuid, uuid, text, numeric) to authenticated;

-- ================================================================ 2. AUTORIZACIONES
create table if not exists public.erp_price_approvals (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid references public.erp_warehouses(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  product_name text,
  qty integer not null default 1 check (qty > 0),
  list_price numeric(14, 2) not null default 0,
  floor_price numeric(14, 2) not null default 0,
  requested_price numeric(14, 2) not null check (requested_price >= 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'used', 'cancelled')),
  requested_by uuid not null,
  requested_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  used_order_id uuid,
  used_at timestamptz
);
create index if not exists erp_price_approvals_pending on public.erp_price_approvals (store_id, status, created_at desc);
create index if not exists erp_price_approvals_use on public.erp_price_approvals (store_id, requested_by, product_id, status);
alter table public.erp_price_approvals enable row level security;
revoke all on public.erp_price_approvals from anon, authenticated;

create or replace function public.erp_price_approval_request(p_store uuid, p_point uuid, p_product uuid, p_price numeric, p_qty integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); f jsonb; v_id uuid; v_name text; v_point uuid;
begin
  if v_uid is null or not public.erp_can(p_store, 'pos') then raise exception 'Necesitas el permiso de POS.'; end if;
  v_point := coalesce(public.erp__user_point(p_store, v_uid), p_point);
  if v_point is not null and not public.erp_point_allowed(p_store, v_point) then raise exception 'Ese punto no lo tienes asignado.'; end if;
  if p_price is null or p_price < 0 then raise exception 'Precio no válido.'; end if;
  f := public.erp__price_floor(p_store, v_uid, p_product, v_point);
  if p_price >= (f->>'floor')::numeric then return jsonb_build_object('ok', true, 'not_needed', true); end if;
  select name into v_name from public.products where id = p_product and store_id = p_store;
  if v_name is null then raise exception 'Producto no encontrado.'; end if;
  -- Una sola solicitud viva por producto y vendedor.
  update public.erp_price_approvals set status = 'cancelled'
  where store_id = p_store and requested_by = v_uid and product_id = p_product and status = 'pending';
  insert into public.erp_price_approvals (store_id, point_id, product_id, product_name, qty, list_price, floor_price, requested_price, note, requested_by, requested_by_name)
  values (p_store, v_point, p_product, v_name, greatest(coalesce(p_qty, 1), 1), (f->>'list')::numeric, (f->>'floor')::numeric, round(p_price, 2),
          nullif(trim(coalesce(p_note, '')), ''), v_uid, public.erp_actor_name(p_store))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.erp_price_approval_request(uuid, uuid, uuid, numeric, integer, text) from public, anon;
grant execute on function public.erp_price_approval_request(uuid, uuid, uuid, numeric, integer, text) to authenticated;

-- Estado de mis solicitudes (o de las que puedo aprobar).
create or replace function public.erp_price_approval_get(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'product_id', a.product_id, 'requested_price', a.requested_price,
           'status', case when a.status = 'pending' and a.expires_at < now() then 'expired' else a.status end,
           'decided_by_name', a.decided_by_name, 'decision_note', a.decision_note)), '[]'::jsonb)
  from public.erp_price_approvals a
  where a.id = any (coalesce(p_ids[1:100], '{}'))
    and (a.requested_by = auth.uid() or public.erp_can(a.store_id, 'price_approve'));
$$;
revoke all on function public.erp_price_approval_get(uuid[]) from public, anon;
grant execute on function public.erp_price_approval_get(uuid[]) to authenticated;

create or replace function public.erp_price_approvals_pending(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.erp_can(p_store, 'price_approve') then return jsonb_build_object('ok', false, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'product_name', a.product_name, 'qty', a.qty, 'list_price', a.list_price,
             'floor_price', a.floor_price, 'requested_price', a.requested_price, 'note', a.note, 'point_name', w.name,
             'requested_by_name', a.requested_by_name, 'created_at', a.created_at, 'expires_at', a.expires_at,
             'mine', a.requested_by = auth.uid()) order by a.created_at)
    from public.erp_price_approvals a left join public.erp_warehouses w on w.id = a.point_id
    where a.store_id = p_store and a.status = 'pending' and a.expires_at > now()
      and (a.point_id is null or public.erp_point_allowed(p_store, a.point_id))), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_price_approvals_pending(uuid) from public, anon;
grant execute on function public.erp_price_approvals_pending(uuid) to authenticated;

create or replace function public.erp_price_approval_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public.erp_price_approvals;
begin
  select * into a from public.erp_price_approvals where id = p_id for update;
  if a.id is null then raise exception 'La solicitud no existe.'; end if;
  if not public.erp_can(a.store_id, 'price_approve') then raise exception 'Necesitas el permiso «Autorizar precios».'; end if;
  if a.point_id is not null and not public.erp_point_allowed(a.store_id, a.point_id) then raise exception 'Esa solicitud es de un punto que no tienes asignado.'; end if;
  if a.status <> 'pending' then return jsonb_build_object('ok', false, 'message', 'Esta solicitud ya fue atendida.'); end if;
  if a.expires_at < now() then return jsonb_build_object('ok', false, 'message', 'La solicitud venció (15 minutos). Que la pidan otra vez.'); end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe por qué la rechazas.'; end if;
  update public.erp_price_approvals
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_by_name = public.erp_actor_name(a.store_id),
      decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''),
      -- Aprobada: tiene 30 minutos para usarse en la venta.
      expires_at = case when p_approve then now() + interval '30 minutes' else expires_at end
  where id = p_id;
  perform public.erp_audit(a.store_id, case when p_approve then 'price_approval.approved' else 'price_approval.rejected' end, 'erp_price_approvals', p_id,
    jsonb_build_object('product', a.product_name, 'requested_price', a.requested_price, 'floor', a.floor_price, 'list', a.list_price, 'seller', a.requested_by_name, 'note', p_note));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_price_approval_decide(uuid, boolean, text) from public, anon;
grant execute on function public.erp_price_approval_decide(uuid, boolean, text) to authenticated;

-- ================================================================ 3. GUARDIÁN EN LAS LÍNEAS DE VENTA
-- Usuarios de la tienda: el precio debe ser ≥ su límite (o tener autorización aprobada).
-- Pedidos del catálogo público (sin usuario de la tienda): se mantiene el guardián anterior.
create or replace function public.erp__order_item_price_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid; v_mode text; p public.products; v_ok boolean := true; v_allowed numeric[]; v_price numeric := round(new.price, 2);
  s public.erp_profit_settings; v_uid uuid := auth.uid(); f jsonb; v_floor numeric; v_member boolean := false; v_appr uuid;
begin
  if current_setting('erp.price_ok', true) = '1' then return new; end if;
  if tg_op = 'UPDATE' and round(old.price, 2) = v_price then return new; end if;
  select o.store_id into v_store from public.orders o where o.id = new.order_id;

  begin
    v_member := v_uid is not null and public.erp__is_store_member(v_store);
    if v_member then
      f := public.erp__price_floor(v_store, v_uid, new.product_id, (select m.point_id from public.erp_order_meta m where m.order_id = new.order_id));
      v_floor := (f->>'floor')::numeric;
    end if;
  exception when others then
    v_member := false;  -- Si el cálculo falla, se usa el guardián anterior (nunca tumba la venta por un error propio).
  end;

  if v_member then
    if v_price >= v_floor then return new; end if;
    select a.id into v_appr from public.erp_price_approvals a
    where a.store_id = v_store and a.requested_by = v_uid and a.product_id = new.product_id
      and a.status = 'approved' and a.expires_at > now() and a.requested_price <= v_price
    order by a.decided_at desc limit 1 for update skip locked;
    if v_appr is not null then
      update public.erp_price_approvals set status = 'used', used_order_id = new.order_id, used_at = now() where id = v_appr;
      return new;
    end if;
    select name into p.name from public.products where id = new.product_id;
    raise exception 'PRICE_BELOW_LIMIT'
      using detail = coalesce(p.name, 'producto'),
            hint = 'Precio mínimo permitido: ' || to_char(v_floor, 'FM999G999G999G990') || '. Pide autorización.';
  end if;

  begin
    select * into s from public.erp_profit_settings where store_id = v_store;
    v_mode := coalesce(s.price_guard, 'observe');
    if v_mode = 'off' then return new; end if;
    select * into p from public.products where id = new.product_id and store_id = v_store;
    if not found then
      v_ok := false;
      v_allowed := '{}';
    else
      v_allowed := array[p.price_1, p.price_2, p.price_3, p.price_4, p.price_5, p.price_retail, p.price_wholesale];
      v_ok := v_price = any (select round(x, 2) from unnest(v_allowed) x where x is not null)
        or exists (select 1 from public.store_catalog_products cp
                   where cp.product_id = p.id and cp.store_id = v_store and cp.price_override is not null and round(cp.price_override, 2) = v_price)
        or exists (select 1 from public.erp_warehouses w
                   cross join lateral public.erp__rule_for(v_store, w.id, p.id) r
                   cross join lateral generate_series(1, 5) l
                   where w.store_id = v_store and r.id is not null
                     and public.erp__point_price(p, l, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) = v_price);
    end if;
    if not v_ok then
      insert into public.erp_price_guard_log (store_id, order_id, product_id, price, mode, allowed, blocked, db_role)
      values (v_store, new.order_id, new.product_id, new.price, v_mode, v_allowed, v_mode = 'enforce', current_setting('request.jwt.claim.role', true));
    end if;
  exception when others then
    return new;
  end;
  if not v_ok and v_mode = 'enforce' then
    raise exception 'PRICE_MISMATCH'
      using detail = coalesce(p.name, 'producto'),
            hint = 'El precio no coincide con los precios autorizados. Actualiza la página e intenta de nuevo.';
  end if;
  return new;
end;
$$;
drop trigger if exists erp_order_items_price_guard on public.order_items;
create trigger erp_order_items_price_guard before insert or update of price on public.order_items
for each row execute function public.erp__order_item_price_guard();

-- ================================================================ 4. FORMA DE PAGO DEL POS
alter table public.erp_order_meta add column if not exists payment jsonb;

create or replace function public.erp_pos_set_payment(p_token text, p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare o public.orders; m public.erp_order_meta;
begin
  select * into o from public.orders where token = p_token;
  if o.id is null then raise exception 'El documento no existe.'; end if;
  if not public.erp_can(o.store_id, 'pos') then raise exception 'Necesitas el permiso de POS.'; end if;
  select * into m from public.erp_order_meta where order_id = o.id;
  if m.order_id is null then return jsonb_build_object('ok', false, 'message', 'El documento aún no tiene punto.'); end if;
  if not public.erp_point_allowed(o.store_id, m.point_id) then raise exception 'Este documento es de un punto que no tienes asignado.'; end if;
  if jsonb_typeof(p_payment) <> 'object' then raise exception 'Pago no válido.'; end if;
  update public.erp_order_meta set payment = jsonb_build_object(
      'method', left(coalesce(p_payment->>'method', ''), 30),
      'parts', coalesce(p_payment->'parts', '[]'::jsonb),
      'received', nullif(p_payment->>'received', '')::numeric,
      'change', nullif(p_payment->>'change', '')::numeric,
      'at', now())
  where order_id = o.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_pos_set_payment(text, jsonb) from public, anon;
grant execute on function public.erp_pos_set_payment(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
