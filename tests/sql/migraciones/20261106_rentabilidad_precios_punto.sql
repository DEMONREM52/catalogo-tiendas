-- =====================================================================
-- REMHUB · Centro de rentabilidad — Fase 2
--
--   1. Permisos nuevos: profit_view (ver rentabilidad y costos),
--      profit_rules (crear reglas de precio por punto), profit_approve
--      (aprobar reglas, excepciones y la configuración de la madre).
--   2. Configuración de rentabilidad por tienda madre (modo encadenado,
--      redondeo, límites para los puntos, aprobación, guardián de precios).
--   3. Reglas de precio por punto, con versión, vigencia, estado,
--      aprobación y motivo. Los precios 1-5 del producto siguen siendo los
--      de la madre; el punto aplica su % encima (encadenado) o un precio fijo.
--   4. Guardián de precios en las líneas de venta: revisa que el precio sea
--      uno autorizado (precios 1-5, precio de un punto o de un catálogo).
--      Empieza en modo OBSERVAR (solo anota); se puede pasar a BLOQUEAR.
--   5. Foto financiera de cada venta al descontar el inventario: costo de ese
--      momento, precio de referencia de la madre, regla del punto y las
--      partes de la ganancia (madre / punto). Las ventas viejas no se
--      recalculan: en los informes aparecen como «costo estimado».
--   6. Informe de rentabilidad con permisos y aislamiento por punto.
--
-- No borra ni cambia datos ni funciones existentes. Es idempotente.
-- Requiere que ya exista 20261105_notificaciones_pedidos.sql (incluye su permiso).
-- =====================================================================

-- 1. Permisos (igual que src/lib/store-user-auth.ts).
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
    'profit_view', 'profit_rules', 'profit_approve'
  ]::text[];
$$;

-- ¿Es usuario de la tienda (dueño o miembro activo)? (también la crea 20261105)
create or replace function public.erp__is_store_member(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
      or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active);
$$;
revoke all on function public.erp__is_store_member(uuid) from public, anon;

-- 2. Configuración de la tienda madre.
create table if not exists public.erp_profit_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  point_mode text not null default 'chained' check (point_mode in ('chained')),
  rounding_step integer not null default 0 check (rounding_step in (0, 1, 50, 100, 500, 1000)),
  rounding_dir text not null default 'nearest' check (rounding_dir in ('nearest', 'up', 'down')),
  point_min_pct numeric(9, 4) not null default 0 check (point_min_pct between -90 and 1000),
  point_max_pct numeric(9, 4) not null default 100 check (point_max_pct between -90 and 1000),
  require_approval boolean not null default true,
  price_guard text not null default 'observe' check (price_guard in ('off', 'observe', 'enforce')),
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  check (point_min_pct <= point_max_pct)
);
alter table public.erp_profit_settings enable row level security;
revoke all on public.erp_profit_settings from anon, authenticated;

-- 3. Reglas de precio por punto.
create table if not exists public.erp_price_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  point_id uuid not null references public.erp_warehouses(id) on delete cascade,
  scope text not null check (scope in ('point', 'category', 'product')),
  category_id uuid,
  product_id uuid references public.products(id) on delete cascade,
  kind text not null check (kind in ('pct', 'fixed', 'none')),
  value numeric(14, 4) not null default 0,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'retired')),
  version integer not null default 1,
  reason text not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  check ((scope = 'product') = (product_id is not null)),
  check ((scope = 'category') = (category_id is not null)),
  check (kind <> 'pct' or value between -90 and 1000),
  check (kind <> 'fixed' or value >= 0),
  check (kind <> 'none' or value = 0),
  check (valid_to is null or valid_to > valid_from),
  check (char_length(btrim(reason)) between 3 and 500)
);
create index if not exists erp_price_rules_lookup on public.erp_price_rules (store_id, point_id, status, scope);
create index if not exists erp_price_rules_product on public.erp_price_rules (product_id) where product_id is not null;
alter table public.erp_price_rules enable row level security;
revoke all on public.erp_price_rules from anon, authenticated;

-- Redondeo comercial (igual que src/lib/profit/engine.ts: al centavo y luego al paso elegido).
create or replace function public.erp__round_step(p numeric, p_step integer, p_dir text)
returns numeric
language sql
immutable
as $$
  select case
    when p is null then null
    when coalesce(p_step, 0) = 0 then round(p, 2)
    when p_dir = 'up' then ceil(round(p, 2) / p_step) * p_step
    when p_dir = 'down' then floor(round(p, 2) / p_step) * p_step
    else round(round(p, 2) / p_step) * p_step
  end;
$$;

-- Regla vigente de un punto para un producto: producto > categoría > todo el punto.
create or replace function public.erp__rule_for(p_store uuid, p_point uuid, p_product uuid, p_at timestamptz default now())
returns public.erp_price_rules
language sql
stable
security definer
set search_path = public
as $$
  select r.*
  from public.erp_price_rules r
  where r.store_id = p_store and r.point_id = p_point and r.status = 'active'
    and r.valid_from <= p_at and (r.valid_to is null or r.valid_to > p_at)
    and (
      (r.scope = 'product' and r.product_id = p_product)
      or (r.scope = 'category' and (
            r.category_id = (select p.category_id from public.products p where p.id = p_product)
            or exists (select 1 from public.product_category_links l where l.product_id = p_product and l.category_id = r.category_id)))
      or r.scope = 'point'
    )
  order by case r.scope when 'product' then 1 when 'category' then 2 else 3 end, r.valid_from desc, r.created_at desc
  limit 1;
$$;
revoke all on function public.erp__rule_for(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

-- Precio de un nivel en un punto: el precio de la madre (precio 1-5) ajustado por la regla del punto.
create or replace function public.erp__point_price(p_product public.products, p_level integer, p_rule public.erp_price_rules, p_step integer, p_dir text)
returns numeric
language sql
immutable
as $$
  select case
    when p_rule.id is null or p_rule.kind = 'none' then round(coalesce(public.catalog__price(p_product, p_level), 0), 2)
    when p_rule.kind = 'fixed' then round(p_rule.value, 2)
    else public.erp__round_step(coalesce(public.catalog__price(p_product, p_level), 0) * (1 + p_rule.value / 100), p_step, p_dir)
  end;
$$;

-- Precios del punto (solo productos con regla). El POS los usa en lugar de los de la madre.
create or replace function public.erp_point_prices(p_store uuid, p_point uuid)
returns table (product_id uuid, price_1 numeric, price_2 numeric, price_3 numeric, price_4 numeric, price_5 numeric,
               rule_id uuid, rule_scope text, rule_kind text, rule_value numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.erp_profit_settings;
begin
  if not public.erp__is_store_member(p_store) then raise exception 'No perteneces a esta tienda.'; end if;
  if p_point is null or not public.erp_point_allowed(p_store, p_point) then return; end if;
  if not exists (select 1 from public.erp_price_rules r where r.store_id = p_store and r.point_id = p_point and r.status = 'active') then return; end if;
  select * into s from public.erp_profit_settings where store_id = p_store;
  return query
    select p.id,
           public.erp__point_price(p, 1, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
           public.erp__point_price(p, 2, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
           public.erp__point_price(p, 3, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
           public.erp__point_price(p, 4, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
           public.erp__point_price(p, 5, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')),
           r.id, r.scope, r.kind, r.value
    from public.products p
    cross join lateral public.erp__rule_for(p_store, p_point, p.id) r
    where p.store_id = p_store and p.active and r.id is not null;
end;
$$;
revoke all on function public.erp_point_prices(uuid, uuid) from public, anon;
grant execute on function public.erp_point_prices(uuid, uuid) to authenticated;

-- Configuración: leer (cualquiera con permisos de rentabilidad) y guardar (madre con permiso de aprobar).
create or replace function public.erp_profit_settings_get(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.erp_profit_settings;
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_rules') or public.erp_can(p_store, 'profit_approve') or public.erp_can(p_store, 'pos')) then
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

create or replace function public.erp_profit_settings_save(p_store uuid, p_settings jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare before jsonb; s public.erp_profit_settings;
begin
  if not public.erp_can(p_store, 'profit_approve') or public.erp_my_points(p_store) is not null then
    raise exception 'Solo la tienda madre (con el permiso «Aprobar reglas de precio») cambia esta configuración.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo del cambio.'; end if;
  select to_jsonb(x) into before from public.erp_profit_settings x where x.store_id = p_store;
  insert into public.erp_profit_settings as t (store_id, rounding_step, rounding_dir, point_min_pct, point_max_pct, require_approval, price_guard,
                                               updated_by, updated_by_name, updated_at)
  values (p_store,
          coalesce((p_settings->>'rounding_step')::integer, 0),
          coalesce(p_settings->>'rounding_dir', 'nearest'),
          coalesce((p_settings->>'point_min_pct')::numeric, 0),
          coalesce((p_settings->>'point_max_pct')::numeric, 100),
          coalesce((p_settings->>'require_approval')::boolean, true),
          coalesce(p_settings->>'price_guard', 'observe'),
          auth.uid(), public.erp_actor_name(p_store), now())
  on conflict (store_id) do update set
    rounding_step = excluded.rounding_step, rounding_dir = excluded.rounding_dir,
    point_min_pct = excluded.point_min_pct, point_max_pct = excluded.point_max_pct,
    require_approval = excluded.require_approval, price_guard = excluded.price_guard,
    updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now()
  returning * into s;
  perform public.erp_audit(p_store, 'profit.settings_changed', 'erp_profit_settings', null,
    jsonb_build_object('before', before, 'after', to_jsonb(s), 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_profit_settings_save(uuid, jsonb, text) from public, anon;
grant execute on function public.erp_profit_settings_save(uuid, jsonb, text) to authenticated;

-- Activar una regla: la anterior del mismo objetivo termina cuando empieza la nueva (no se borra).
create or replace function public.erp__price_rule_activate(p_rule public.erp_price_rules)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.erp_price_rules r
  set valid_to = p_rule.valid_from,
      status = case when p_rule.valid_from <= now() then 'retired' else r.status end,
      decision_note = case when p_rule.valid_from <= now() then 'Reemplazada por la versión ' || p_rule.version else r.decision_note end
  where r.store_id = p_rule.store_id and r.point_id = p_rule.point_id and r.scope = p_rule.scope
    and r.product_id is not distinct from p_rule.product_id and r.category_id is not distinct from p_rule.category_id
    and r.status = 'active' and r.id <> p_rule.id
    and r.valid_from < p_rule.valid_from and (r.valid_to is null or r.valid_to > p_rule.valid_from);
  update public.erp_price_rules r
  set status = 'retired', decided_by = auth.uid(), decided_by_name = public.erp_actor_name(p_rule.store_id), decided_at = now(),
      decision_note = 'Reemplazada por la versión ' || p_rule.version
  where r.store_id = p_rule.store_id and r.point_id = p_rule.point_id and r.scope = p_rule.scope
    and r.product_id is not distinct from p_rule.product_id and r.category_id is not distinct from p_rule.category_id
    and r.status = 'active' and r.id <> p_rule.id and r.valid_from >= p_rule.valid_from;
  update public.erp_price_rules set status = 'active' where id = p_rule.id;
end;
$$;
revoke all on function public.erp__price_rule_activate(public.erp_price_rules) from public, anon, authenticated;

create or replace function public.erp_price_rule_save(
  p_store uuid, p_point uuid, p_scope text, p_target uuid, p_kind text, p_value numeric,
  p_valid_from timestamptz, p_valid_to timestamptz, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.erp_profit_settings;
  r public.erp_price_rules;
  v_approver boolean := public.erp_can(p_store, 'profit_approve');
  v_from timestamptz := greatest(coalesce(p_valid_from, now()), now() - interval '1 minute');
  v_version integer;
  v_cost numeric;
  v_name text;
begin
  if not (public.erp_can(p_store, 'profit_rules') or v_approver) then raise exception 'Necesitas el permiso «Reglas de precio por punto».'; end if;
  if not exists (select 1 from public.erp_warehouses w where w.id = p_point and w.store_id = p_store) then raise exception 'El punto no pertenece a esta tienda.'; end if;
  if not public.erp_point_allowed(p_store, p_point) then raise exception 'Solo puedes configurar los precios de tus puntos.'; end if;
  if p_scope not in ('point', 'category', 'product') or p_kind not in ('pct', 'fixed', 'none') then raise exception 'Regla no válida.'; end if;
  if p_scope = 'point' and p_kind = 'fixed' then raise exception 'Un precio fijo solo se puede poner a un producto.'; end if;
  if p_scope = 'product' and not exists (select 1 from public.products where id = p_target and store_id = p_store) then raise exception 'El producto no pertenece a esta tienda.'; end if;
  if p_scope = 'category' and not exists (select 1 from public.product_categories where id = p_target and store_id = p_store) then raise exception 'La categoría no pertenece a esta tienda.'; end if;
  if p_value is null or (p_kind = 'none' and p_value <> 0) then raise exception 'Escribe un valor válido.'; end if;
  if p_valid_to is not null and p_valid_to <= v_from then raise exception 'La fecha final debe ser posterior a la inicial.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo de la regla (mínimo 3 letras).'; end if;

  select * into s from public.erp_profit_settings where store_id = p_store;
  if p_kind = 'pct' and not v_approver and (p_value < coalesce(s.point_min_pct, 0) or p_value > coalesce(s.point_max_pct, 100)) then
    raise exception 'La madre permite entre % %% y % %% para los puntos.', coalesce(s.point_min_pct, 0), coalesce(s.point_max_pct, 100);
  end if;
  if p_kind = 'pct' and (p_value < -90 or p_value > 1000) then raise exception 'El porcentaje debe estar entre -90 %% y 1000 %%.'; end if;
  if p_kind = 'fixed' then
    select coalesce(cost_price, 0), name into v_cost, v_name from public.products where id = p_target;
    if p_value < v_cost and not v_approver then
      raise exception 'El precio % de "%" queda por debajo del costo (%). Necesita aprobación de la madre.', p_value, v_name, v_cost;
    end if;
  end if;

  -- Una sola regla a la vez por objetivo (evita dos guardados simultáneos).
  perform pg_advisory_xact_lock(hashtext('price_rule:' || p_point::text || ':' || p_scope || ':' || coalesce(p_target::text, '-')));
  select coalesce(max(version), 0) + 1 into v_version from public.erp_price_rules
  where store_id = p_store and point_id = p_point and scope = p_scope
    and coalesce(product_id, category_id) is not distinct from (case when p_scope = 'point' then null else p_target end);

  insert into public.erp_price_rules (store_id, point_id, scope, category_id, product_id, kind, value, valid_from, valid_to, status, version,
                                      reason, created_by, created_by_name)
  values (p_store, p_point, p_scope,
          case when p_scope = 'category' then p_target end,
          case when p_scope = 'product' then p_target end,
          p_kind, case when p_kind = 'none' then 0 else round(p_value, 4) end, v_from, p_valid_to, 'pending', v_version,
          btrim(p_reason), auth.uid(), public.erp_actor_name(p_store))
  returning * into r;

  if v_approver or not coalesce(s.require_approval, true) then
    update public.erp_price_rules set decided_by = auth.uid(), decided_by_name = public.erp_actor_name(p_store), decided_at = now(),
      decision_note = case when v_approver then 'Aprobada al crearla' else 'Sin aprobación requerida' end
    where id = r.id returning * into r;
    perform public.erp__price_rule_activate(r);
  end if;

  perform public.erp_audit(p_store, 'price_rule.created', 'erp_price_rules', r.id,
    jsonb_build_object('point_id', p_point, 'scope', p_scope, 'target', p_target, 'kind', p_kind, 'value', r.value,
      'valid_from', r.valid_from, 'valid_to', r.valid_to, 'version', v_version, 'reason', r.reason,
      'status', case when v_approver or not coalesce(s.require_approval, true) then 'active' else 'pending' end));
  return jsonb_build_object('ok', true, 'id', r.id, 'status', (select status from public.erp_price_rules where id = r.id), 'version', v_version);
end;
$$;
revoke all on function public.erp_price_rule_save(uuid, uuid, text, uuid, text, numeric, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.erp_price_rule_save(uuid, uuid, text, uuid, text, numeric, timestamptz, timestamptz, text) to authenticated;

create or replace function public.erp_price_rule_decide(p_rule uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.erp_price_rules;
begin
  select * into r from public.erp_price_rules where id = p_rule for update;
  if not found then raise exception 'Regla no encontrada.'; end if;
  if not public.erp_can(r.store_id, 'profit_approve') then raise exception 'Necesitas el permiso «Aprobar reglas de precio».'; end if;
  if not public.erp_point_allowed(r.store_id, r.point_id) then raise exception 'Esta regla es de un punto que no administras.'; end if;
  if r.status <> 'pending' then raise exception 'Esta regla ya fue decidida.'; end if;
  if r.created_by = auth.uid() and public.erp_my_points(r.store_id) is not null then
    raise exception 'Otra persona debe aprobar la regla que tú creaste.';
  end if;
  if not coalesce(p_approve, false) and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escribe por qué la rechazas.'; end if;
  perform pg_advisory_xact_lock(hashtext('price_rule:' || r.point_id::text || ':' || r.scope || ':' || coalesce(coalesce(r.product_id, r.category_id)::text, '-')));
  update public.erp_price_rules
  set decided_by = auth.uid(), decided_by_name = public.erp_actor_name(r.store_id), decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_note, '')), ''),
      status = case when p_approve then status else 'rejected' end,
      valid_from = case when p_approve then greatest(valid_from, now()) else valid_from end
  where id = r.id returning * into r;
  if p_approve then
    if r.valid_to is not null and r.valid_to <= r.valid_from then raise exception 'La regla ya venció; crea una nueva.'; end if;
    perform public.erp__price_rule_activate(r);
  end if;
  perform public.erp_audit(r.store_id, case when p_approve then 'price_rule.approved' else 'price_rule.rejected' end, 'erp_price_rules', r.id,
    jsonb_build_object('note', p_note, 'version', r.version));
  return jsonb_build_object('ok', true, 'status', (select status from public.erp_price_rules where id = r.id));
end;
$$;
revoke all on function public.erp_price_rule_decide(uuid, boolean, text) from public, anon;
grant execute on function public.erp_price_rule_decide(uuid, boolean, text) to authenticated;

create or replace function public.erp_price_rule_retire(p_rule uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.erp_price_rules;
begin
  select * into r from public.erp_price_rules where id = p_rule for update;
  if not found then raise exception 'Regla no encontrada.'; end if;
  if not (public.erp_can(r.store_id, 'profit_rules') or public.erp_can(r.store_id, 'profit_approve')) then raise exception 'No tienes permiso.'; end if;
  if not public.erp_point_allowed(r.store_id, r.point_id) then raise exception 'Esta regla es de un punto que no administras.'; end if;
  if r.status not in ('active', 'pending') then raise exception 'Esta regla ya no está vigente.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  update public.erp_price_rules
  set status = case when status = 'pending' then 'rejected' else 'retired' end,
      valid_to = case when status = 'active' then greatest(valid_from + interval '1 second', least(coalesce(valid_to, 'infinity'), now())) else valid_to end,
      decided_by = auth.uid(), decided_by_name = public.erp_actor_name(r.store_id), decided_at = now(), decision_note = btrim(p_reason)
  where id = r.id;
  perform public.erp_audit(r.store_id, 'price_rule.retired', 'erp_price_rules', r.id, jsonb_build_object('reason', btrim(p_reason), 'version', r.version));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_price_rule_retire(uuid, text) from public, anon;
grant execute on function public.erp_price_rule_retire(uuid, text) to authenticated;

create or replace function public.erp_price_rules_list(p_store uuid, p_point uuid default null)
returns table (id uuid, point_id uuid, point_name text, scope text, target_id uuid, target_name text, kind text, value numeric,
               valid_from timestamptz, valid_to timestamptz, status text, version integer, reason text,
               created_by_name text, created_at timestamptz, decided_by_name text, decided_at timestamptz, decision_note text, live boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.erp_can(p_store, 'profit_view') or public.erp_can(p_store, 'profit_rules') or public.erp_can(p_store, 'profit_approve')) then
    raise exception 'No tienes permiso para ver las reglas de precio.';
  end if;
  return query
    select r.id, r.point_id, w.name::text, r.scope, coalesce(r.product_id, r.category_id),
           coalesce(p.name, c.name, 'Todo el punto')::text, r.kind, r.value, r.valid_from, r.valid_to, r.status, r.version, r.reason,
           r.created_by_name, r.created_at, r.decided_by_name, r.decided_at, r.decision_note,
           (r.status = 'active' and r.valid_from <= now() and (r.valid_to is null or r.valid_to > now()))
    from public.erp_price_rules r
    join public.erp_warehouses w on w.id = r.point_id
    left join public.products p on p.id = r.product_id
    left join public.product_categories c on c.id = r.category_id
    where r.store_id = p_store
      and (p_point is null or r.point_id = p_point)
      and public.erp_point_allowed(p_store, r.point_id)
    order by (r.status = 'pending') desc, r.created_at desc
    limit 500;
end;
$$;
revoke all on function public.erp_price_rules_list(uuid, uuid) from public, anon;
grant execute on function public.erp_price_rules_list(uuid, uuid) to authenticated;

-- 4. Guardián de precios en las líneas de venta.
create table if not exists public.erp_price_guard_log (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  order_id uuid,
  product_id uuid,
  price numeric,
  mode text not null,
  allowed numeric[],
  blocked boolean not null default false,
  db_role text,
  created_at timestamptz not null default now()
);
create index if not exists erp_price_guard_log_store on public.erp_price_guard_log (store_id, created_at desc);
alter table public.erp_price_guard_log enable row level security;
revoke all on public.erp_price_guard_log from anon, authenticated;

create or replace function public.erp__order_item_price_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid; v_mode text; p public.products; v_ok boolean := true; v_allowed numeric[]; v_price numeric := round(new.price, 2);
  s public.erp_profit_settings;
begin
  if current_setting('erp.price_ok', true) = '1' then return new; end if;
  begin
    select o.store_id into v_store from public.orders o where o.id = new.order_id;
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
    -- El guardián nunca debe tumbar una venta por un error propio.
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

-- 5. Foto financiera de cada venta (al descontar el inventario).
create table if not exists public.erp_sale_finance (
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null,
  store_id uuid not null,
  point_id uuid,
  qty integer not null,
  revenue numeric(14, 2) not null,
  unit_cost numeric(14, 4) not null,
  cost_total numeric(14, 2) not null,
  ref_level smallint,
  ref_unit numeric(14, 2),
  ref_total numeric(14, 2) not null,
  mother_amount numeric(14, 2) not null,
  point_amount numeric(14, 2) not null,
  profit numeric(14, 2) not null,
  rule_id uuid,
  rule_kind text,
  rule_value numeric(14, 4),
  ref_source text not null check (ref_source in ('level', 'point_rule', 'sold_price')),
  cost_source text not null default 'at_sale',
  captured_at timestamptz not null default now(),
  primary key (order_id, product_id),
  check (mother_amount + point_amount = profit),
  check (revenue - cost_total = profit)
);
create index if not exists erp_sale_finance_store on public.erp_sale_finance (store_id, point_id, captured_at);
alter table public.erp_sale_finance enable row level security;
revoke all on public.erp_sale_finance from anon, authenticated;

create table if not exists public.erp_finance_capture_errors (
  id bigint generated always as identity primary key,
  order_id uuid,
  message text,
  created_at timestamptz not null default now()
);
alter table public.erp_finance_capture_errors enable row level security;
revoke all on public.erp_finance_capture_errors from anon, authenticated;

create or replace function public.erp__capture_sale_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders; v_point uuid; it record; p public.products; r public.erp_price_rules; s public.erp_profit_settings;
  v_lvl integer; v_ref numeric; v_src text; v_cost numeric; v_rev numeric; v_ref_total numeric; v_cost_total numeric;
begin
  begin
    select * into o from public.orders where id = new.order_id;
    select m.point_id into v_point from public.erp_order_meta m where m.order_id = new.order_id;
    select * into s from public.erp_profit_settings where store_id = o.store_id;
    for it in
      select oi.product_id, sum(oi.quantity)::integer as qty, sum(oi.quantity * oi.price) as revenue,
             (array_agg(oi.price order by oi.quantity desc))[1] as unit_price
      from public.order_items oi where oi.order_id = new.order_id group by oi.product_id
    loop
      select * into p from public.products where id = it.product_id;
      r := null; v_lvl := null; v_ref := null; v_src := 'sold_price';
      if v_point is not null then
        select * into r from public.erp__rule_for(o.store_id, v_point, it.product_id, coalesce(o.created_at, now()));
      end if;
      for l in 1..5 loop
        if round(it.unit_price, 2) = public.erp__point_price(p, l, r, coalesce(s.rounding_step, 0), coalesce(s.rounding_dir, 'nearest')) then
          v_lvl := l;
          v_ref := round(coalesce(public.catalog__price(p, l), 0), 2);
          v_src := case when r.id is null or r.kind = 'none' then 'level' else 'point_rule' end;
          exit;
        end if;
      end loop;
      if v_lvl is null then v_ref := round(it.unit_price, 2); r := null; end if;
      v_cost := coalesce(p.cost_price, 0);
      v_rev := round(it.revenue, 2);
      v_cost_total := round(it.qty * v_cost, 2);
      v_ref_total := round(it.qty * v_ref, 2);
      insert into public.erp_sale_finance (order_id, product_id, store_id, point_id, qty, revenue, unit_cost, cost_total, ref_level, ref_unit,
                                           ref_total, mother_amount, point_amount, profit, rule_id, rule_kind, rule_value, ref_source)
      values (new.order_id, it.product_id, o.store_id, v_point, it.qty, v_rev, v_cost, v_cost_total, v_lvl, v_ref,
              v_ref_total, v_ref_total - v_cost_total, v_rev - v_ref_total, v_rev - v_cost_total,
              case when v_src = 'point_rule' then r.id end, case when v_src = 'point_rule' then r.kind end,
              case when v_src = 'point_rule' then r.value end, v_src)
      on conflict (order_id, product_id) do nothing;
    end loop;
  exception when others then
    -- Nunca frena la venta; queda registrado para revisarlo.
    insert into public.erp_finance_capture_errors (order_id, message) values (new.order_id, left(sqlerrm, 500));
  end;
  return null;
end;
$$;
drop trigger if exists erp_order_stock_capture_finance on public.erp_order_stock;
create trigger erp_order_stock_capture_finance after insert on public.erp_order_stock
for each row execute function public.erp__capture_sale_finance();

-- 6. Informe de rentabilidad (solo lo que cada quien puede ver).
create or replace function public.erp_profit_summary(p_store uuid, p_from timestamptz, p_to timestamptz, p_point uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_points uuid[] := public.erp_my_points(p_store); v jsonb;
begin
  if not public.erp_can(p_store, 'profit_view') then raise exception 'Necesitas el permiso «Ver rentabilidad y costos».'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '3 years 2 days' then raise exception 'El rango de fechas no es válido.'; end if;
  if p_point is not null and v_points is not null and not (p_point = any (v_points)) then raise exception 'Solo puedes ver tus puntos.'; end if;

  with raw as (
    select l.order_id, l.product_id, l.point_id, max(l.sold_at) as sold_at, sum(l.qty)::integer as qty, sum(l.revenue) as revenue, sum(l.cost) as est_cost
    from public.erp__sale_lines(p_store, p_from, p_to, null) l
    where (p_point is null or l.point_id = p_point)
      and (v_points is null or l.point_id = any (v_points))
    group by l.order_id, l.product_id, l.point_id
  ), lines as (
    select r.*, f.order_id is not null as exact,
           coalesce(f.cost_total, round(r.est_cost, 2)) as cost,
           coalesce(f.mother_amount, round(r.revenue - r.est_cost, 2)) as mother,
           coalesce(f.point_amount, 0) as point_part
    from raw r
    left join public.erp_sale_finance f on f.order_id = r.order_id and f.product_id = r.product_id
  )
  select jsonb_build_object(
    'kpis', (select jsonb_build_object(
        'revenue', coalesce(sum(revenue), 0), 'cost', coalesce(sum(cost), 0), 'profit', coalesce(sum(revenue - cost), 0),
        'mother', coalesce(sum(mother), 0), 'point', coalesce(sum(point_part), 0),
        'orders', count(distinct order_id), 'units', coalesce(sum(qty), 0),
        'lines', count(*), 'lines_estimated', count(*) filter (where not exact),
        'lines_loss', count(*) filter (where revenue - cost < 0)) from lines),
    'by_point', coalesce((select jsonb_agg(x order by x.revenue desc) from (
        select l.point_id, coalesce(w.name, 'Sin punto (en línea)') as name, sum(l.revenue) as revenue, sum(l.cost) as cost,
               sum(l.revenue - l.cost) as profit, sum(l.mother) as mother, sum(l.point_part) as point, count(distinct l.order_id) as orders
        from lines l left join public.erp_warehouses w on w.id = l.point_id
        group by l.point_id, w.name) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(x order by x.profit desc) from (
        select l.product_id, p.name, sum(l.qty) as units, sum(l.revenue) as revenue, sum(l.cost) as cost, sum(l.revenue - l.cost) as profit,
               bool_or(not l.exact) as estimated
        from lines l left join public.products p on p.id = l.product_id
        group by l.product_id, p.name order by sum(l.revenue) desc limit 300) x), '[]'::jsonb),
    'guard', jsonb_build_object(
        'mode', coalesce((select price_guard from public.erp_profit_settings where store_id = p_store), 'observe'),
        'mismatches', (select count(*) from public.erp_price_guard_log g where g.store_id = p_store and g.created_at >= p_from and g.created_at < p_to),
        'recent', coalesce((select jsonb_agg(x) from (
            select g.created_at, g.price, g.allowed, g.blocked, p.name, o.receipt_no
            from public.erp_price_guard_log g left join public.products p on p.id = g.product_id left join public.orders o on o.id = g.order_id
            where g.store_id = p_store and v_points is null
            order by g.created_at desc limit 20) x), '[]'::jsonb)),
    'capture_errors', (select count(*) from public.erp_finance_capture_errors e join public.orders o on o.id = e.order_id
                       where o.store_id = p_store and e.created_at >= p_from and e.created_at < p_to)
  ) into v;
  return v;
end;
$$;
revoke all on function public.erp_profit_summary(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.erp_profit_summary(uuid, timestamptz, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
