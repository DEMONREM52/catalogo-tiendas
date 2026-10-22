-- =====================================================================
-- REMHUB · Ventas: promociones, combos, cotizaciones y apartados
--
--   1. Promociones programadas (erp_promotions): % de descuento o precio fijo
--      por producto, categoría o toda la tienda, en todos o algunos puntos,
--      con fecha de inicio y fin. El POS las aplica solo.
--   2. Combos (erp_combos): «cargador + cable a $25.000». En el POS el combo
--      se agrega como sus productos (cada uno descuenta su inventario) con el
--      precio del combo repartido entre ellos.
--   3. Cotizaciones (erp_quotes): se arman desde el POS, se comparten por
--      WhatsApp con un enlace (hoja imprimible) y se convierten en venta.
--   4. Apartados (erp_layaways): el cliente abona y las unidades quedan
--      reservadas (salen del disponible del punto: nadie más las vende).
--      Cada abono en efectivo entra a la caja abierta del punto. Al entregar
--      se hace la venta normal en el POS (cuenta en informes y rentabilidad)
--      y la caja se compensa con lo ya abonado (no se cuenta dos veces).
--   5. erp_price_passes: la base solo deja un precio por debajo del límite
--      del vendedor si es de una promoción vigente, un combo o un apartado
--      ya pactado (queda como autorización usada, con su motivo).
-- No borra datos. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------- 1. promociones
create table if not exists public.erp_promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('pct', 'price')),
  value numeric(14, 2) not null check (value >= 0),
  scope text not null check (scope in ('all', 'category', 'product')),
  category_id uuid,
  product_ids uuid[] not null default '{}',
  point_ids uuid[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  active boolean not null default true,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  check (kind <> 'pct' or value between 1 and 90),
  check (ends_at > starts_at)
);
create index if not exists erp_promotions_store on public.erp_promotions (store_id, active, ends_at);
alter table public.erp_promotions enable row level security;
revoke all on public.erp_promotions from anon, authenticated;

create or replace function public.erp__promo_manager(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.erp_can(p_store, 'products_prices') or public.erp_can(p_store, 'profit_rules') or public.erp_can(p_store, 'price_approve'));
$$;
grant execute on function public.erp__promo_manager(uuid) to authenticated;

create or replace function public.erp_promotion_save(p_store uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_name text;
begin
  if not public.erp__promo_manager(p_store) then return jsonb_build_object('ok', false, 'error', 'Necesitas «Cambiar precios» o «Rentabilidad».'); end if;
  v_name := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end;
  if v_id is null then
    insert into public.erp_promotions (store_id, name, kind, value, scope, category_id, product_ids, point_ids, starts_at, ends_at, active, created_by, created_by_name)
    values (p_store, btrim(p->>'name'), p->>'kind', (p->>'value')::numeric, p->>'scope', nullif(p->>'category_id', '')::uuid,
            coalesce(array(select jsonb_array_elements_text(p->'product_ids'))::uuid[], '{}'),
            coalesce(array(select jsonb_array_elements_text(p->'point_ids'))::uuid[], '{}'),
            coalesce((p->>'starts_at')::timestamptz, now()), (p->>'ends_at')::timestamptz, coalesce((p->>'active')::boolean, true), auth.uid(), v_name)
    returning id into v_id;
  else
    update public.erp_promotions set name = btrim(p->>'name'), kind = p->>'kind', value = (p->>'value')::numeric, scope = p->>'scope',
      category_id = nullif(p->>'category_id', '')::uuid,
      product_ids = coalesce(array(select jsonb_array_elements_text(p->'product_ids'))::uuid[], '{}'),
      point_ids = coalesce(array(select jsonb_array_elements_text(p->'point_ids'))::uuid[], '{}'),
      starts_at = coalesce((p->>'starts_at')::timestamptz, starts_at), ends_at = (p->>'ends_at')::timestamptz, active = coalesce((p->>'active')::boolean, active)
    where id = v_id and store_id = p_store;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_promotion_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_promotion_save(uuid, jsonb) to authenticated;

create or replace function public.erp_promotion_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  select store_id into v_store from public.erp_promotions where id = p_id;
  if v_store is null or not public.erp__promo_manager(v_store) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  delete from public.erp_promotions where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_promotion_delete(uuid) from public, anon;
grant execute on function public.erp_promotion_delete(uuid) to authenticated;

-- Todas (para administrarlas) o solo las vigentes de un punto (para el POS).
create or replace function public.erp_promotions_list(p_store uuid, p_point uuid default null, p_active_only boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'kind', p.kind, 'value', p.value, 'scope', p.scope, 'category_id', p.category_id,
      'product_ids', p.product_ids, 'point_ids', p.point_ids, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'active', p.active,
      'running', p.active and now() between p.starts_at and p.ends_at) order by p.ends_at desc), '[]'::jsonb) end
  from public.erp_promotions p
  where p.store_id = p_store
    and (not p_active_only or (p.active and now() between p.starts_at and p.ends_at))
    and (p_point is null or cardinality(p.point_ids) = 0 or p_point = any (p.point_ids));
$$;
revoke all on function public.erp_promotions_list(uuid, uuid, boolean) from public, anon;
grant execute on function public.erp_promotions_list(uuid, uuid, boolean) to authenticated;

-- Precio mínimo que una promoción vigente permite para un producto en un punto (null = no hay promoción).
create or replace function public.erp__promo_min_price(p_store uuid, p_point uuid, p_product uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select min(case when pr.kind = 'price' then pr.value else lv.price * (1 - pr.value / 100) end)
  from public.erp_promotions pr
  join public.products p on p.id = p_product and p.store_id = p_store
  cross join lateral (select unnest(array[p.price_1, p.price_2, p.price_3, p.price_4, p.price_5]) as price) lv
  where pr.store_id = p_store and pr.active and now() between pr.starts_at and pr.ends_at
    and (cardinality(pr.point_ids) = 0 or p_point = any (pr.point_ids))
    and (pr.scope = 'all'
         or (pr.scope = 'product' and p_product = any (pr.product_ids))
         or (pr.scope = 'category' and (p.category_id = pr.category_id
              or exists (select 1 from public.product_category_links l where l.product_id = p_product and l.category_id = pr.category_id))))
    and coalesce(lv.price, 0) > 0;
$$;
revoke all on function public.erp__promo_min_price(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. combos
create table if not exists public.erp_combos (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  sku text,
  price numeric(14, 2) not null check (price > 0),
  items jsonb not null,
  image_url text,
  active boolean not null default true,
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.erp_combos enable row level security;
revoke all on public.erp_combos from anon, authenticated;

create or replace function public.erp_combo_save(p_store uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_items jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'products') and public.erp__promo_manager(p_store)) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Productos» y «Cambiar precios».');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'qty', greatest(1, (x->>'qty')::integer))), '[]'::jsonb) into v_items
  from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x
  join public.products pr on pr.id = (x->>'product_id')::uuid and pr.store_id = p_store;
  if jsonb_array_length(v_items) < 1 then return jsonb_build_object('ok', false, 'error', 'El combo necesita productos.'); end if;
  if v_id is null then
    insert into public.erp_combos (store_id, name, sku, price, items, image_url, active, created_by_name)
    values (p_store, upper(btrim(p->>'name')), nullif(upper(btrim(coalesce(p->>'sku', ''))), ''), (p->>'price')::numeric, v_items,
            nullif(p->>'image_url', ''), coalesce((p->>'active')::boolean, true),
            case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end)
    returning id into v_id;
  else
    update public.erp_combos set name = upper(btrim(p->>'name')), sku = nullif(upper(btrim(coalesce(p->>'sku', ''))), ''), price = (p->>'price')::numeric,
      items = v_items, image_url = nullif(p->>'image_url', ''), active = coalesce((p->>'active')::boolean, active)
    where id = v_id and store_id = p_store;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.erp_combo_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_combo_save(uuid, jsonb) to authenticated;

create or replace function public.erp_combo_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  select store_id into v_store from public.erp_combos where id = p_id;
  if v_store is null or not public.erp_can(v_store, 'products') then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  delete from public.erp_combos where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_combo_delete(uuid) from public, anon;
grant execute on function public.erp_combo_delete(uuid) to authenticated;

create or replace function public.erp_combos_list(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'sku', c.sku, 'price', c.price, 'items', c.items,
      'image_url', c.image_url, 'active', c.active,
      'regular', (select coalesce(sum(coalesce(p.price_3, 0) * (i->>'qty')::integer), 0) from jsonb_array_elements(c.items) i join public.products p on p.id = (i->>'product_id')::uuid))
      order by c.active desc, c.name), '[]'::jsonb) end
  from public.erp_combos c where c.store_id = p_store;
$$;
revoke all on function public.erp_combos_list(uuid) from public, anon;
grant execute on function public.erp_combos_list(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. cotizaciones
create table if not exists public.erp_quotes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  point_id uuid references public.erp_warehouses(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_doc text,
  items jsonb not null,
  total numeric(14, 2) not null default 0,
  valid_until date,
  status text not null default 'open' check (status in ('open', 'accepted', 'cancelled')),
  note text,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  order_token text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (store_id, number)
);
alter table public.erp_quotes enable row level security;
revoke all on public.erp_quotes from anon, authenticated;

create or replace function public.erp_quote_save(p_store uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_items jsonb; v_total numeric; v_num bigint; v_token text;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'orders')) then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso de POS.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'sku', pr.sku, 'image_url', pr.image_url,
           'qty', greatest(1, (x->>'qty')::integer), 'price', greatest(0, round((x->>'price')::numeric)))), '[]'::jsonb),
         coalesce(sum(greatest(1, (x->>'qty')::integer) * greatest(0, round((x->>'price')::numeric))), 0)
    into v_items, v_total
  from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x
  join public.products pr on pr.id = (x->>'product_id')::uuid and pr.store_id = p_store;
  if jsonb_array_length(v_items) < 1 then return jsonb_build_object('ok', false, 'error', 'La cotización no tiene productos.'); end if;
  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('quote:' || p_store::text));
    select coalesce(max(number), 0) + 1 into v_num from public.erp_quotes where store_id = p_store;
    insert into public.erp_quotes (store_id, number, point_id, customer_name, customer_phone, customer_doc, items, total, valid_until, note, created_by, created_by_name)
    values (p_store, v_num, nullif(p->>'point_id', '')::uuid, nullif(upper(btrim(coalesce(p->>'customer_name', ''))), ''), nullif(btrim(coalesce(p->>'customer_phone', '')), ''),
            nullif(btrim(coalesce(p->>'customer_doc', '')), ''), v_items, v_total, coalesce((p->>'valid_until')::date, current_date + 8), nullif(btrim(coalesce(p->>'note', '')), ''),
            auth.uid(), case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end)
    returning id, number, token into v_id, v_num, v_token;
  else
    update public.erp_quotes set items = v_items, total = v_total, customer_name = nullif(upper(btrim(coalesce(p->>'customer_name', ''))), ''),
      customer_phone = nullif(btrim(coalesce(p->>'customer_phone', '')), ''), valid_until = coalesce((p->>'valid_until')::date, valid_until), note = nullif(btrim(coalesce(p->>'note', '')), '')
    where id = v_id and store_id = p_store and status = 'open'
    returning number, token into v_num, v_token;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num, 'token', v_token, 'total', v_total);
end;
$$;
revoke all on function public.erp_quote_save(uuid, jsonb) from public, anon;
grant execute on function public.erp_quote_save(uuid, jsonb) to authenticated;

create or replace function public.erp_quotes_list(p_store uuid, p_status text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'orders')) then '[]'::jsonb else
    coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.number, 'customer_name', q.customer_name, 'customer_phone', q.customer_phone,
      'total', q.total, 'items', q.items, 'valid_until', q.valid_until, 'status', q.status, 'token', q.token, 'order_token', q.order_token,
      'point_id', q.point_id, 'created_by_name', q.created_by_name, 'created_at', q.created_at,
      'expired', q.status = 'open' and q.valid_until < current_date) order by q.created_at desc), '[]'::jsonb) end
  from (select * from public.erp_quotes where store_id = p_store and (p_status is null or status = p_status) order by created_at desc limit 300) q;
$$;
revoke all on function public.erp_quotes_list(uuid, text) from public, anon;
grant execute on function public.erp_quotes_list(uuid, text) to authenticated;

create or replace function public.erp_quote_set_status(p_id uuid, p_status text, p_order_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  select store_id into v_store from public.erp_quotes where id = p_id;
  if v_store is null or not (public.erp_can(v_store, 'pos') or public.erp_can(v_store, 'orders')) then return jsonb_build_object('ok', false, 'error', 'Sin permiso.'); end if;
  if p_status not in ('open', 'accepted', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'Estado no válido.'); end if;
  update public.erp_quotes set status = p_status, order_token = coalesce(p_order_token, order_token) where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_quote_set_status(uuid, text, text) from public, anon;
grant execute on function public.erp_quote_set_status(uuid, text, text) to authenticated;

-- Hoja pública de la cotización (cualquiera con el enlace): nunca entrega costos.
create or replace function public.erp_quote_public(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', q.number, 'customer_name', q.customer_name, 'customer_doc', q.customer_doc, 'items', q.items, 'total', q.total,
    'valid_until', q.valid_until, 'status', q.status, 'note', q.note, 'created_at', q.created_at, 'created_by_name', q.created_by_name,
    'expired', q.status = 'open' and q.valid_until < current_date,
    'store', jsonb_build_object('name', s.name, 'logo_url', s.logo_url, 'whatsapp', s.whatsapp),
    'point', (select jsonb_build_object('name', w.name, 'address', w.address) from public.erp_warehouses w where w.id = q.point_id))
  from public.erp_quotes q join public.stores s on s.id = q.store_id
  where q.token = p_token and char_length(coalesce(p_token, '')) >= 16;
$$;
revoke all on function public.erp_quote_public(text) from public;
grant execute on function public.erp_quote_public(text) to anon, authenticated;

-- ---------------------------------------------------------------- 4. apartados
create table if not exists public.erp_layaways (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  point_id uuid not null references public.erp_warehouses(id),
  customer_name text not null,
  customer_phone text,
  customer_doc text,
  items jsonb not null,
  total numeric(14, 2) not null,
  paid numeric(14, 2) not null default 0,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'delivering', 'delivered', 'cancelled')),
  note text,
  order_token text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_name text,
  close_reason text,
  unique (store_id, number)
);
create table if not exists public.erp_layaway_payments (
  id uuid primary key default gen_random_uuid(),
  layaway_id uuid not null references public.erp_layaways(id) on delete cascade,
  store_id uuid not null,
  amount numeric(14, 2) not null,
  method text not null default 'efectivo',
  cash_session_id uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.erp_layaways enable row level security;
alter table public.erp_layaway_payments enable row level security;
revoke all on public.erp_layaways, public.erp_layaway_payments from anon, authenticated;

-- Abono en efectivo → entra a la caja abierta del punto (si hay una). Devuelve la caja usada.
create or replace function public.erp__layaway_cash(l public.erp_layaways, p_amount numeric, p_kind text, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_session uuid;
begin
  if to_regclass('public.erp_cash_sessions') is null or coalesce(p_amount, 0) <= 0 then return null; end if;
  select id into v_session from public.erp_cash_sessions where store_id = l.store_id and point_id = l.point_id and status = 'open' order by opened_at desc limit 1;
  if v_session is null then return null; end if;
  insert into public.erp_cash_moves (session_id, store_id, kind, amount, reason, created_by, created_by_name)
  values (v_session, l.store_id, p_kind, p_amount, p_reason, auth.uid(), case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(l.store_id) end);
  return v_session;
end;
$$;
revoke all on function public.erp__layaway_cash(public.erp_layaways, numeric, text, text) from public, anon, authenticated;

-- Reserva (signo −1) o devuelve (+1) las unidades del apartado en su punto.
create or replace function public.erp__layaway_stock(l public.erp_layaways, p_sign integer, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(l.items) loop
    perform public.erp__move(l.store_id, l.point_id, (it->>'product_id')::uuid, p_sign * (it->>'qty')::integer,
      case when p_sign < 0 then 'manual_out' else 'manual_in' end, 'layaway', l.id, null, p_note, 'Apartado', true);
  end loop;
end;
$$;
revoke all on function public.erp__layaway_stock(public.erp_layaways, integer, text) from public, anon, authenticated;

create or replace function public.erp_layaway_create(p_store uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.erp_layaways; v_items jsonb; v_total numeric; v_num bigint; v_point uuid := (p->>'point_id')::uuid;
  v_first numeric := greatest(0, coalesce((p->'first'->>'amount')::numeric, 0)); v_method text := coalesce(nullif(p->'first'->>'method', ''), 'efectivo');
  it jsonb; v_floor numeric; v_session uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso de POS.'); end if;
  if v_point is null or (to_regprocedure('public.erp_point_allowed(uuid, uuid)') is not null and not public.erp_point_allowed(p_store, v_point)) then
    return jsonb_build_object('ok', false, 'error', 'Elige un punto que sea tuyo.');
  end if;
  if coalesce(btrim(p->>'customer_name'), '') = '' then return jsonb_build_object('ok', false, 'error', 'Escribe el nombre del cliente.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'sku', pr.sku, 'qty', greatest(1, (x->>'qty')::integer), 'price', greatest(0, round((x->>'price')::numeric)))), '[]'::jsonb),
         coalesce(sum(greatest(1, (x->>'qty')::integer) * greatest(0, round((x->>'price')::numeric))), 0)
    into v_items, v_total
  from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x
  join public.products pr on pr.id = (x->>'product_id')::uuid and pr.store_id = p_store;
  if jsonb_array_length(v_items) < 1 then return jsonb_build_object('ok', false, 'error', 'El apartado no tiene productos.'); end if;
  if v_first > v_total then return jsonb_build_object('ok', false, 'error', 'El abono es mayor que el total.'); end if;
  -- El precio pactado respeta el límite del vendedor (igual que una venta), salvo promoción vigente.
  if to_regprocedure('public.erp__price_floor(uuid, uuid, uuid, uuid)') is not null then
    for it in select * from jsonb_array_elements(v_items) loop
      begin
        v_floor := (public.erp__price_floor(p_store, auth.uid(), (it->>'product_id')::uuid, v_point)->>'floor')::numeric;
      exception when others then v_floor := null;
      end;
      if v_floor is not null and (it->>'price')::numeric < v_floor
         and (it->>'price')::numeric + 1 < coalesce(public.erp__promo_min_price(p_store, v_point, (it->>'product_id')::uuid), v_floor) then
        return jsonb_build_object('ok', false, 'error', format('El precio de «%s» está por debajo de tu límite. Pide autorización o ajusta el precio.', it->>'name'));
      end if;
    end loop;
  end if;
  perform pg_advisory_xact_lock(hashtext('layaway:' || p_store::text));
  select coalesce(max(number), 0) + 1 into v_num from public.erp_layaways where store_id = p_store;
  insert into public.erp_layaways (store_id, number, point_id, customer_name, customer_phone, customer_doc, items, total, paid, due_date, note, created_by, created_by_name)
  values (p_store, v_num, v_point, upper(btrim(p->>'customer_name')), nullif(btrim(coalesce(p->>'customer_phone', '')), ''), nullif(btrim(coalesce(p->>'customer_doc', '')), ''),
          v_items, v_total, v_first, coalesce((p->>'due_date')::date, current_date + 30), nullif(btrim(coalesce(p->>'note', '')), ''),
          auth.uid(), case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end)
  returning * into l;
  -- Reserva: si no alcanzan las unidades, la base lo frena (nadie vende lo apartado).
  perform public.erp__layaway_stock(l, -1, format('Apartado #%s · %s', l.number, l.customer_name));
  if v_first > 0 then
    v_session := case when v_method = 'efectivo' then public.erp__layaway_cash(l, v_first, 'in', format('Abono apartado #%s · %s', l.number, l.customer_name)) end;
    insert into public.erp_layaway_payments (layaway_id, store_id, amount, method, cash_session_id, created_by, created_by_name)
    values (l.id, p_store, v_first, v_method, v_session, auth.uid(), l.created_by_name);
  end if;
  return jsonb_build_object('ok', true, 'id', l.id, 'number', l.number, 'total', v_total, 'paid', v_first, 'cash', v_session is not null);
end;
$$;
revoke all on function public.erp_layaway_create(uuid, jsonb) from public, anon;
grant execute on function public.erp_layaway_create(uuid, jsonb) to authenticated;

create or replace function public.erp_layaway_pay(p_id uuid, p_amount numeric, p_method text default 'efectivo')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.erp_layaways; v_session uuid; v_name text;
begin
  select * into l from public.erp_layaways where id = p_id for update;
  if not found or not public.erp_can(l.store_id, 'pos') then return jsonb_build_object('ok', false, 'error', 'Apartado no encontrado.'); end if;
  if l.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'Este apartado ya no recibe abonos.'); end if;
  if coalesce(p_amount, 0) <= 0 or l.paid + p_amount > l.total then return jsonb_build_object('ok', false, 'error', format('El abono debe ser entre $1 y $%s.', to_char(l.total - l.paid, 'FM999G999G999'))); end if;
  v_name := case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(l.store_id) end;
  v_session := case when coalesce(p_method, 'efectivo') = 'efectivo' then public.erp__layaway_cash(l, p_amount, 'in', format('Abono apartado #%s · %s', l.number, l.customer_name)) end;
  insert into public.erp_layaway_payments (layaway_id, store_id, amount, method, cash_session_id, created_by, created_by_name)
  values (l.id, l.store_id, p_amount, coalesce(p_method, 'efectivo'), v_session, auth.uid(), v_name);
  update public.erp_layaways set paid = paid + p_amount where id = l.id;
  return jsonb_build_object('ok', true, 'paid', l.paid + p_amount, 'balance', l.total - l.paid - p_amount, 'cash', v_session is not null);
end;
$$;
revoke all on function public.erp_layaway_pay(uuid, numeric, text) from public, anon;
grant execute on function public.erp_layaway_pay(uuid, numeric, text) to authenticated;

create or replace function public.erp_layaways_list(p_store uuid, p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid[]; r jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso de POS.'); end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'number', l.number, 'point_id', l.point_id, 'point', w.name, 'customer_name', l.customer_name, 'customer_phone', l.customer_phone,
      'items', l.items, 'total', l.total, 'paid', l.paid, 'balance', l.total - l.paid, 'due_date', l.due_date, 'days_left', l.due_date - current_date,
      'status', l.status, 'note', l.note, 'created_by_name', l.created_by_name, 'created_at', l.created_at, 'order_token', l.order_token,
      'payments', (select coalesce(jsonb_agg(jsonb_build_object('amount', pp.amount, 'method', pp.method, 'by', pp.created_by_name, 'at', pp.created_at, 'cash', pp.cash_session_id is not null) order by pp.created_at), '[]'::jsonb)
                   from public.erp_layaway_payments pp where pp.layaway_id = l.id))
      order by l.due_date), '[]'::jsonb))
  into r
  from public.erp_layaways l join public.erp_warehouses w on w.id = l.point_id
  where l.store_id = p_store and (v is null or l.point_id = any (v))
    and (p_status is null or l.status = p_status or (p_status = 'open' and l.status = 'delivering'));
  return r;
end;
$$;
revoke all on function public.erp_layaways_list(uuid, text) from public, anon;
grant execute on function public.erp_layaways_list(uuid, text) to authenticated;

-- Anular: devuelve las unidades y, si se reintegra efectivo, sale de la caja abierta.
create or replace function public.erp_layaway_cancel(p_id uuid, p_reason text, p_refund numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_layaways;
begin
  select * into l from public.erp_layaways where id = p_id for update;
  if not found or not public.erp_can(l.store_id, 'pos') then return jsonb_build_object('ok', false, 'error', 'Apartado no encontrado.'); end if;
  if l.status not in ('open') then return jsonb_build_object('ok', false, 'error', 'Solo se anula un apartado abierto.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo.'); end if;
  if coalesce(p_refund, 0) < 0 or coalesce(p_refund, 0) > l.paid then return jsonb_build_object('ok', false, 'error', 'El reintegro no puede ser mayor que lo abonado.'); end if;
  perform public.erp__layaway_stock(l, 1, format('Apartado #%s anulado', l.number));
  perform public.erp__layaway_cash(l, coalesce(p_refund, 0), 'out', format('Reintegro apartado #%s · %s', l.number, l.customer_name));
  update public.erp_layaways set status = 'cancelled', closed_at = now(), close_reason = btrim(p_reason),
    closed_by_name = case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(l.store_id) end
  where id = l.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_layaway_cancel(uuid, text, numeric) from public, anon;
grant execute on function public.erp_layaway_cancel(uuid, text, numeric) to authenticated;

-- Entregar (paso 1, justo antes de cobrar en el POS): suelta las unidades para que la venta las descuente.
create or replace function public.erp_layaway_release(p_id uuid, p_point uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_layaways;
begin
  select * into l from public.erp_layaways where id = p_id for update;
  if not found or not public.erp_can(l.store_id, 'pos') then return jsonb_build_object('ok', false, 'error', 'Apartado no encontrado.'); end if;
  if l.status = 'delivering' then return jsonb_build_object('ok', true); end if;
  if l.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'Este apartado ya se entregó o se anuló.'); end if;
  if l.paid < l.total then return jsonb_build_object('ok', false, 'error', format('Falta pagar $%s.', to_char(l.total - l.paid, 'FM999G999G999'))); end if;
  if p_point is distinct from l.point_id then return jsonb_build_object('ok', false, 'error', 'Entrégalo desde el punto donde se apartó.'); end if;
  perform public.erp__layaway_stock(l, 1, format('Apartado #%s · se entrega', l.number));
  update public.erp_layaways set status = 'delivering' where id = l.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_layaway_release(uuid, uuid) from public, anon;
grant execute on function public.erp_layaway_release(uuid, uuid) to authenticated;

-- Si la venta no se pudo registrar, las unidades vuelven a quedar apartadas.
create or replace function public.erp_layaway_hold(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_layaways;
begin
  select * into l from public.erp_layaways where id = p_id for update;
  if not found or not public.erp_can(l.store_id, 'pos') then return jsonb_build_object('ok', false); end if;
  if l.status <> 'delivering' then return jsonb_build_object('ok', true); end if;
  perform public.erp__layaway_stock(l, -1, format('Apartado #%s · vuelve a quedar apartado', l.number));
  update public.erp_layaways set status = 'open' where id = l.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_layaway_hold(uuid) from public, anon;
grant execute on function public.erp_layaway_hold(uuid) to authenticated;

-- Entregar (paso 2, ya con la venta): la forma de pago de la venta son los abonos y la caja se compensa
-- con lo que ya entró en efectivo, para no contarlo dos veces.
create or replace function public.erp_layaway_complete(p_id uuid, p_order_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.erp_layaways; v_order uuid; v_cash numeric; v_parts jsonb;
begin
  select * into l from public.erp_layaways where id = p_id for update;
  if not found or not public.erp_can(l.store_id, 'pos') then return jsonb_build_object('ok', false, 'error', 'Apartado no encontrado.'); end if;
  if l.status = 'delivered' then return jsonb_build_object('ok', true); end if;
  select id into v_order from public.orders where token = p_order_token and store_id = l.store_id;
  if v_order is null then return jsonb_build_object('ok', false, 'error', 'Venta no encontrada.'); end if;
  -- El efectivo que entró a una caja se compensa; el que se recibió sin caja abierta queda aparte (no se cuenta como efectivo hoy).
  select coalesce(sum(a) filter (where m = 'efectivo'), 0),
         coalesce(jsonb_agg(jsonb_build_object('method', m, 'amount', a)), '[]'::jsonb)
    into v_cash, v_parts
  from (
    select case when method = 'efectivo' and cash_session_id is null then 'efectivo_sin_caja' else method end as m, sum(amount) as a
    from public.erp_layaway_payments where layaway_id = l.id group by 1
  ) x;
  update public.erp_order_meta set payment = jsonb_build_object('method', 'apartado', 'parts', v_parts, 'layaway', l.number, 'at', now())
  where order_id = v_order;
  perform public.erp__layaway_cash(l, v_cash, 'out', format('Apartado #%s: ya se había abonado en efectivo', l.number));
  update public.erp_layaways set status = 'delivered', order_token = p_order_token, closed_at = now(),
    closed_by_name = case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(l.store_id) end
  where id = l.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.erp_layaway_complete(uuid, text) from public, anon;
grant execute on function public.erp_layaway_complete(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 5. pases de precio
-- El POS pide un pase para los precios de una promoción, un combo o un apartado. Solo se da si el precio
-- es de verdad el pactado; queda como una autorización aprobada (se usa al registrar la venta).
create or replace function public.erp_price_passes(p_store uuid, p_point uuid, p_source text, p_ref uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb; v_out jsonb := '{}'::jsonb; v_ok boolean; v_min numeric; v_id uuid; v_label text; v_combo public.erp_combos; v_lay public.erp_layaways;
  v_price numeric; v_prod uuid; v_name text; v_sum numeric;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'error', 'Sin permiso de POS.'); end if;
  if to_regclass('public.erp_price_approvals') is null then return jsonb_build_object('ok', true, 'passes', '{}'::jsonb); end if;
  if p_source = 'combo' then
    select * into v_combo from public.erp_combos where id = p_ref and store_id = p_store and active;
    if not found then return jsonb_build_object('ok', false, 'error', 'Combo no encontrado.'); end if;
    select coalesce(sum((x->>'price')::numeric * greatest(1, (x->>'qty')::integer)), 0) into v_sum from jsonb_array_elements(p_items) x;
    if abs(v_sum - v_combo.price) > greatest(1, jsonb_array_length(p_items)) then return jsonb_build_object('ok', false, 'error', 'Los precios no suman el valor del combo.'); end if;
    v_label := 'Combo ' || v_combo.name;
  elsif p_source = 'layaway' then
    select * into v_lay from public.erp_layaways where id = p_ref and store_id = p_store;
    if not found then return jsonb_build_object('ok', false, 'error', 'Apartado no encontrado.'); end if;
    v_label := 'Apartado #' || v_lay.number;
  elsif p_source = 'promo' then
    v_label := 'Promoción';
  else
    return jsonb_build_object('ok', false, 'error', 'Origen no válido.');
  end if;

  for it in select * from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) loop
    v_prod := (it->>'product_id')::uuid;
    v_price := round((it->>'price')::numeric, 2);
    select name into v_name from public.products where id = v_prod and store_id = p_store;
    if v_name is null then continue; end if;
    v_ok := false;
    if p_source = 'combo' then
      v_ok := exists (select 1 from jsonb_array_elements(v_combo.items) c where (c->>'product_id')::uuid = v_prod);
    elsif p_source = 'layaway' then
      v_ok := exists (select 1 from jsonb_array_elements(v_lay.items) c where (c->>'product_id')::uuid = v_prod and round((c->>'price')::numeric, 2) <= v_price);
    else
      v_min := public.erp__promo_min_price(p_store, p_point, v_prod);
      v_ok := v_min is not null and v_price + 1 >= round(v_min);
    end if;
    if not v_ok then continue; end if;
    insert into public.erp_price_approvals (store_id, point_id, product_id, product_name, qty, list_price, floor_price, requested_price, note, status,
      requested_by, requested_by_name, expires_at, decided_by, decided_by_name, decided_at, decision_note)
    values (p_store, p_point, v_prod, v_name, greatest(1, coalesce((it->>'qty')::integer, 1)), v_price, v_price, v_price, v_label, 'approved',
      auth.uid(), case when to_regprocedure('public.erp_actor_name(uuid)') is not null then public.erp_actor_name(p_store) end,
      now() + interval '2 hours', auth.uid(), 'Automático · ' || v_label, now(), v_label)
    returning id into v_id;
    v_out := v_out || jsonb_build_object(v_prod::text, jsonb_build_object('id', v_id, 'status', 'approved', 'price', v_price, 'by', v_label));
  end loop;
  return jsonb_build_object('ok', true, 'passes', v_out);
end;
$$;
revoke all on function public.erp_price_passes(uuid, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.erp_price_passes(uuid, uuid, text, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
