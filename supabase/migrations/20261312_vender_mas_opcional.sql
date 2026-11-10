-- 20261312 · Vender más (todo opcional, apagado hasta que la tienda lo encienda)
-- (Necesita 20261309: catalog__items_raw para saber qué productos están en oferta.)
--
--   · Funciones opcionales (erp_store_features): un interruptor y sus ajustes por tienda. Lo enciende el dueño o
--     quien tiene «Mi tienda». Apagado = el catálogo y el panel se ven igual que antes.
--   · Carritos abandonados (erp_cart_leads): si el cliente escribe su nombre y su WhatsApp en el carrito y no envía
--     el pedido, queda en una bandeja para escribirle (wa.me). Al enviar el pedido se marca «compró».
--   · Avísame cuando llegue (erp_stock_waitlist): en un producto agotado el cliente deja su WhatsApp; cuando vuelve a
--     haber existencias en ese catálogo, la bandeja muestra a quién avisar.
--   · Cupones (erp_coupons, erp_coupon_uses): código por % o por valor, con fechas, límite de usos, mínimo de compra y
--     catálogos. NO se suma a las ofertas: solo descuenta los productos sin oferta. El de valor se reparte entre las
--     líneas según su valor y exige un mínimo de compra mayor que el descuento. El pedido queda con el precio cobrado.
--   · Envío gratis desde $X: solo ajustes (barra y mensaje). No cobra ni descuenta nada.
-- No cambia productos, precios guardados, existencias ni permisos. Se puede correr varias veces.

-- ------------------------------------------------------------------ funciones opcionales
create table if not exists public.erp_store_features (
  store_id uuid not null references public.stores(id) on delete cascade,
  feature text not null check (feature in ('carritos', 'avisame', 'cupones', 'envio_gratis', 'imagen_oferta', 'recompra',
                                           'traslados_sugeridos', 'conteo_zonas', 'cierre_dia', 'arranque')),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (store_id, feature)
);
alter table public.erp_store_features enable row level security;
revoke all on public.erp_store_features from anon, authenticated;

-- Lo que ya existía antes sigue encendido hasta que lo apaguen (cierre del día y primeros pasos).
create or replace function public.vm__on(p_store uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.enabled from public.erp_store_features f where f.store_id = p_store and f.feature = p_feature),
                  p_feature in ('cierre_dia', 'arranque'))
$$;
create or replace function public.vm__settings(p_store uuid, p_feature text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select f.settings from public.erp_store_features f where f.store_id = p_store and f.feature = p_feature), '{}'::jsonb)
$$;
create or replace function public.vm__member(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active))
$$;
create or replace function public.vm__can_config(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role = 'store_admin')
    or public.erp_can(p_store, 'store'))
$$;
create or replace function public.vm__money(p numeric)
returns text language sql immutable as $$ select '$' || replace(to_char(round(coalesce(p, 0)), 'FM999,999,999,990'), ',', '.') $$;
create or replace function public.vm__phone(p text)
returns text language sql immutable as $$
  select case when char_length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) between 7 and 15
              then regexp_replace(coalesce(p, ''), '\D', '', 'g') end
$$;
create or replace function public.vm__store(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select st.id from public.stores st where st.slug = lower(btrim(coalesce(p_slug, ''))) and coalesce(st.active, true) limit 1
$$;
revoke all on function public.vm__on(uuid, text) from public, anon, authenticated;
revoke all on function public.vm__settings(uuid, text) from public, anon, authenticated;
revoke all on function public.vm__member(uuid) from public, anon, authenticated;
revoke all on function public.vm__can_config(uuid) from public, anon, authenticated;
revoke all on function public.vm__store(text) from public, anon, authenticated;

create or replace function public.store_features_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.vm__member(p_store) then return jsonb_build_object('ok', false, 'message', 'No perteneces a esta tienda.'); end if;
  return jsonb_build_object('ok', true, 'can_config', public.vm__can_config(p_store),
    'features', (select jsonb_object_agg(k.f, jsonb_build_object('enabled', public.vm__on(p_store, k.f), 'settings', public.vm__settings(p_store, k.f)))
                 from unnest(array['carritos', 'avisame', 'cupones', 'envio_gratis', 'imagen_oferta', 'recompra',
                                   'traslados_sugeridos', 'conteo_zonas', 'cierre_dia', 'arranque']) k(f)));
end;
$$;

create or replace function public.store_feature_save(p_store uuid, p_feature text, p_enabled boolean, p_settings jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb := coalesce(p_settings, public.vm__settings(p_store, p_feature));
begin
  if not public.vm__can_config(p_store) then
    return jsonb_build_object('ok', false, 'message', 'Solo el dueño o quien tiene «Mi tienda» enciende o apaga funciones.');
  end if;
  if p_feature not in ('carritos', 'avisame', 'cupones', 'envio_gratis', 'imagen_oferta', 'recompra',
                       'traslados_sugeridos', 'conteo_zonas', 'cierre_dia', 'arranque') then
    return jsonb_build_object('ok', false, 'message', 'Función no válida.');
  end if;
  if jsonb_typeof(v) <> 'object' or pg_column_size(v) > 6000 then
    return jsonb_build_object('ok', false, 'message', 'Los ajustes son muy largos.');
  end if;
  if p_feature = 'envio_gratis' and coalesce(p_enabled, false)
     and coalesce(case when jsonb_typeof(v -> 'min') = 'number' then (v ->> 'min')::numeric end, 0) <= 0 then
    return jsonb_build_object('ok', false, 'message', 'Escribe desde qué valor el envío es gratis.');
  end if;
  insert into public.erp_store_features (store_id, feature, enabled, settings, updated_at, updated_by)
  values (p_store, p_feature, coalesce(p_enabled, false), v, now(), auth.uid())
  on conflict (store_id, feature) do update set enabled = excluded.enabled, settings = excluded.settings,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  begin
    perform public.erp_audit(p_store, case when coalesce(p_enabled, false) then 'feature.on' else 'feature.off' end, 'erp_store_features', null,
      jsonb_build_object('feature', p_feature));
  exception when undefined_function then null; end;
  return public.store_features_get(p_store);
end;
$$;

-- Lo que el catálogo necesita saber (sin datos privados).
create or replace function public.store_public_features(p_store text, p_catalog text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_store uuid := public.vm__store(p_store);
  v_cat text := nullif(lower(btrim(coalesce(p_catalog, ''))), '');
  s jsonb;
  v_ship jsonb := null;
begin
  if v_store is null then return '{}'::jsonb; end if;
  if public.vm__on(v_store, 'envio_gratis') then
    s := public.vm__settings(v_store, 'envio_gratis');
    if coalesce(jsonb_array_length(case when jsonb_typeof(s -> 'catalog_slugs') = 'array' then s -> 'catalog_slugs' end), 0) = 0
       or (v_cat is not null and (s -> 'catalog_slugs') ? v_cat) then
      v_ship := jsonb_build_object(
        'min', case when jsonb_typeof(s -> 'min') = 'number' then (s ->> 'min')::numeric else 0 end,
        'missing', left(coalesce(nullif(btrim(s ->> 'missing'), ''), 'Te faltan {falta} para el envío gratis 🚚'), 140),
        'done', left(coalesce(nullif(btrim(s ->> 'done'), ''), '¡Listo! Tu pedido tiene envío gratis 🎉'), 140),
        'line', left(coalesce(nullif(btrim(s ->> 'line'), ''), '🚚 Envío gratis'), 80),
        'icon', left(coalesce(nullif(btrim(s ->> 'icon'), ''), '🚚'), 16),
        'color', case when coalesce(s ->> 'color', '') ~ '^#[0-9a-fA-F]{6}$' then s ->> 'color' else '#10b981' end);
    end if;
  end if;
  return jsonb_build_object(
    'carritos', public.vm__on(v_store, 'carritos'),
    'avisame', case when public.vm__on(v_store, 'avisame') then jsonb_build_object(
      'button', left(coalesce(nullif(btrim(public.vm__settings(v_store, 'avisame') ->> 'button'), ''), '🔔 Avísame cuando llegue'), 60)) end,
    'cupones', public.vm__on(v_store, 'cupones') and exists (select 1 from public.erp_coupons c where c.store_id = v_store and c.active),
    'envio_gratis', v_ship);
end;
$$;

-- ------------------------------------------------------------------ carritos abandonados
create table if not exists public.erp_cart_leads (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  catalog_id uuid,
  catalog_slug text,
  session text not null check (session ~ '^[A-Za-z0-9-]{16,64}$'),
  name text,
  phone text not null,
  items jsonb not null default '[]'::jsonb,
  units integer not null default 0,
  total numeric not null default 0,
  status text not null default 'open' check (status in ('open', 'contacted', 'converted', 'dismissed')),
  contacted_at timestamptz,
  contacted_by_name text,
  order_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, session)
);
create index if not exists erp_cart_leads_store_idx on public.erp_cart_leads (store_id, status, updated_at desc);
alter table public.erp_cart_leads enable row level security;
revoke all on public.erp_cart_leads from anon, authenticated;

create or replace function public.catalog_cart_lead_save(p_store text, p_catalog text, p_key text, p_session text, p_name text, p_phone text, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store uuid := public.vm__store(p_store);
  v_catalog uuid;
  v_phone text := public.vm__phone(p_phone);
  v_ids uuid[];
  v_items jsonb;
  v_units integer;
  v_total numeric;
begin
  if v_store is null or not public.vm__on(v_store, 'carritos') then return jsonb_build_object('ok', false, 'off', true); end if;
  if coalesce(p_session, '') !~ '^[A-Za-z0-9-]{16,64}$' then return jsonb_build_object('ok', false); end if;
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then return jsonb_build_object('ok', false); end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 or v_phone is null then
    -- Vació el carrito o borró el celular: se quita lo que estaba abierto.
    delete from public.erp_cart_leads where store_id = v_store and session = p_session and status = 'open';
    return jsonb_build_object('ok', true, 'saved', false);
  end if;
  if jsonb_array_length(p_items) > 60 then return jsonb_build_object('ok', false); end if;
  -- Un tope por tienda para que nadie llene la bandeja.
  if (select count(*) from public.erp_cart_leads l where l.store_id = v_store and l.created_at > now() - interval '1 hour') > 600
     and not exists (select 1 from public.erp_cart_leads l where l.store_id = v_store and l.session = p_session) then
    return jsonb_build_object('ok', false);
  end if;
  select array_agg(distinct (e ->> 'product_id')::uuid) into v_ids
  from jsonb_array_elements(p_items) e where (e ->> 'product_id') ~ '^[0-9a-f-]{36}$';
  select coalesce(jsonb_agg(jsonb_build_object('product_id', w.pid, 'name', p.name, 'qty', w.qty, 'price', coalesce(i.price, 0), 'image_url', p.image_url)
           order by p.name), '[]'::jsonb),
         coalesce(sum(w.qty), 0), coalesce(sum(w.qty * coalesce(i.price, 0)), 0)
    into v_items, v_units, v_total
  from (select (e ->> 'product_id')::uuid pid, least(greatest(sum(coalesce((e ->> 'qty')::integer, 0)), 0), 100000) qty
        from jsonb_array_elements(p_items) e where (e ->> 'product_id') ~ '^[0-9a-f-]{36}$' group by 1) w
  join public.products p on p.id = w.pid and p.store_id = v_store
  left join public.catalog__items(v_catalog, v_ids) i on i.product_id = w.pid
  where w.qty > 0;
  if v_units = 0 then return jsonb_build_object('ok', true, 'saved', false); end if;
  insert into public.erp_cart_leads (store_id, catalog_id, catalog_slug, session, name, phone, items, units, total)
  values (v_store, v_catalog, lower(btrim(p_catalog)), p_session, nullif(left(btrim(coalesce(p_name, '')), 120), ''), v_phone, v_items, v_units, v_total)
  on conflict (store_id, session) do update set name = excluded.name, phone = excluded.phone, items = excluded.items, units = excluded.units,
    total = excluded.total, catalog_id = excluded.catalog_id, catalog_slug = excluded.catalog_slug, updated_at = now(),
    status = case when public.erp_cart_leads.status = 'dismissed' then 'open' else public.erp_cart_leads.status end
  where public.erp_cart_leads.status <> 'converted';
  return jsonb_build_object('ok', true, 'saved', true);
end;
$$;

create or replace function public.catalog_cart_lead_converted(p_store text, p_session text, p_token text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_store uuid := public.vm__store(p_store);
begin
  if v_store is null or coalesce(p_session, '') !~ '^[A-Za-z0-9-]{16,64}$' then return jsonb_build_object('ok', false); end if;
  update public.erp_cart_leads set status = 'converted', updated_at = now(),
    order_token = case when coalesce(p_token, '') ~ '^[A-Za-z0-9_-]{6,80}$' then p_token end
  where store_id = v_store and session = p_session and status <> 'converted';
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cart_leads_list(p_store uuid, p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_points uuid[];
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90));
begin
  if auth.uid() is null or not public.erp_can(p_store, 'orders') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Pedidos».');
  end if;
  v_points := public.erp_my_points(p_store);
  return jsonb_build_object('ok', true, 'on', public.vm__on(p_store, 'carritos'),
    'message', coalesce(nullif(btrim(public.vm__settings(p_store, 'carritos') ->> 'message'), ''),
      'Hola {cliente} 👋, vi que te interesó {productos} en {tienda}. ¿Te ayudo a terminar tu pedido? 🛍️'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'phone', l.phone, 'items', l.items, 'units', l.units, 'total', l.total,
               'status', l.status, 'catalog', coalesce(c.name, l.catalog_slug), 'catalog_slug', l.catalog_slug,
               'updated_at', l.updated_at, 'contacted_at', l.contacted_at, 'contacted_by_name', l.contacted_by_name)
             order by l.updated_at desc)
      from public.erp_cart_leads l
      left join public.store_catalogs c on c.id = l.catalog_id
      where l.store_id = p_store and l.updated_at >= v_since
        and (v_points is null or c.point_id = any (v_points))
        -- Solo cuando el cliente ya se fue (30 minutos sin tocar el carrito).
        and (l.status <> 'open' or l.updated_at < now() - interval '30 minutes')), '[]'::jsonb));
end;
$$;

create or replace function public.cart_lead_mark(p_store uuid, p_id uuid, p_status text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'orders') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Pedidos».');
  end if;
  if p_status not in ('open', 'contacted', 'dismissed') then return jsonb_build_object('ok', false, 'message', 'Estado no válido.'); end if;
  update public.erp_cart_leads set status = p_status,
    contacted_at = case when p_status = 'contacted' then now() else contacted_at end,
    contacted_by_name = case when p_status = 'contacted' then coalesce(
      (select coalesce(nullif(su.display_name, ''), su.username) from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()),
      'Dueño') else contacted_by_name end
  where id = p_id and store_id = p_store and status <> 'converted';
  return jsonb_build_object('ok', found);
end;
$$;

-- ------------------------------------------------------------------ avísame cuando llegue
create table if not exists public.erp_stock_waitlist (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  catalog_id uuid,
  catalog_slug text,
  name text,
  phone text not null,
  status text not null default 'waiting' check (status in ('waiting', 'notified', 'dismissed')),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  notified_by_name text
);
create unique index if not exists erp_stock_waitlist_once on public.erp_stock_waitlist (product_id, phone) where status = 'waiting';
create index if not exists erp_stock_waitlist_store_idx on public.erp_stock_waitlist (store_id, status, created_at desc);
alter table public.erp_stock_waitlist enable row level security;
revoke all on public.erp_stock_waitlist from anon, authenticated;

create or replace function public.catalog_notify_me(p_store text, p_catalog text, p_key text, p_product uuid, p_name text, p_phone text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store uuid := public.vm__store(p_store);
  v_catalog uuid;
  v_phone text := public.vm__phone(p_phone);
begin
  if v_store is null or not public.vm__on(v_store, 'avisame') then return jsonb_build_object('ok', false, 'message', 'No disponible.'); end if;
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then return jsonb_build_object('ok', false, 'message', 'Este catálogo no está disponible.'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'message', 'Escribe un WhatsApp válido.'); end if;
  if not exists (select 1 from public.products p where p.id = p_product and p.store_id = v_store and coalesce(p.active, true)) then
    return jsonb_build_object('ok', false, 'message', 'Producto no disponible.');
  end if;
  if (select count(*) from public.erp_stock_waitlist w where w.store_id = v_store and w.created_at > now() - interval '1 hour') > 300 then
    return jsonb_build_object('ok', false, 'message', 'Intenta de nuevo en un rato.');
  end if;
  insert into public.erp_stock_waitlist (store_id, product_id, catalog_id, catalog_slug, name, phone)
  values (v_store, p_product, v_catalog, lower(btrim(p_catalog)), nullif(left(btrim(coalesce(p_name, '')), 120), ''), v_phone)
  on conflict (product_id, phone) where status = 'waiting' do update set name = coalesce(excluded.name, public.erp_stock_waitlist.name),
    catalog_id = excluded.catalog_id, catalog_slug = excluded.catalog_slug;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.stock_waitlist_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_points uuid[];
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['orders', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas «Pedidos» o «Productos».');
  end if;
  v_points := public.erp_my_points(p_store);
  return jsonb_build_object('ok', true, 'on', public.vm__on(p_store, 'avisame'),
    'message', coalesce(nullif(btrim(public.vm__settings(p_store, 'avisame') ->> 'message'), ''),
      '¡Hola {cliente}! 🎉 Ya llegó {producto} a {tienda}. Míralo aquí: {enlace}'),
    'items', coalesce((
      select jsonb_agg(x.j order by x.ready desc, x.created_at desc)
      from (
        select w.created_at, coalesce(st.stock, 0) > 0 as ready,
               jsonb_build_object('id', w.id, 'product_id', w.product_id, 'product', p.name, 'image_url', p.image_url, 'name', w.name,
                 'phone', w.phone, 'status', w.status, 'created_at', w.created_at, 'notified_at', w.notified_at,
                 'notified_by_name', w.notified_by_name, 'catalog', coalesce(c.name, w.catalog_slug), 'catalog_slug', w.catalog_slug,
                 'stock', coalesce(st.stock, 0), 'ready', coalesce(st.stock, 0) > 0) j
        from public.erp_stock_waitlist w
        join public.products p on p.id = w.product_id
        left join public.store_catalogs c on c.id = w.catalog_id
        left join lateral (
          select i.stock from public.catalog__items(w.catalog_id, array[w.product_id]) i where w.catalog_id is not null limit 1
        ) st on true
        where w.store_id = p_store and (w.status = 'waiting' or w.created_at > now() - interval '30 days')
          and (v_points is null or c.point_id = any (v_points))
        order by w.created_at desc limit 500
      ) x), '[]'::jsonb));
end;
$$;

create or replace function public.stock_waitlist_mark(p_store uuid, p_ids uuid[], p_status text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['orders', 'products']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas «Pedidos» o «Productos».');
  end if;
  if p_status not in ('waiting', 'notified', 'dismissed') then return jsonb_build_object('ok', false, 'message', 'Estado no válido.'); end if;
  update public.erp_stock_waitlist set status = p_status,
    notified_at = case when p_status = 'notified' then now() else notified_at end,
    notified_by_name = case when p_status = 'notified' then coalesce(
      (select coalesce(nullif(su.display_name, ''), su.username) from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()),
      'Dueño') else notified_by_name end
  where store_id = p_store and id = any (coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'count', n);
end;
$$;

-- ------------------------------------------------------------------ cupones
create table if not exists public.erp_coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{4,24}$'),
  kind text not null check (kind in ('pct', 'value')),
  amount numeric(14, 2) not null check (amount > 0),
  min_total numeric(14, 2) not null default 0 check (min_total >= 0),
  starts_on date,
  ends_on date,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0,
  catalog_slugs text[] not null default '{}',
  note text,
  active boolean not null default true,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, code),
  check (kind <> 'pct' or amount between 1 and 90),
  check (kind <> 'value' or min_total > amount),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
alter table public.erp_coupons enable row level security;
revoke all on public.erp_coupons from anon, authenticated;

create table if not exists public.erp_coupon_uses (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.erp_coupons(id) on delete cascade,
  store_id uuid not null,
  order_id uuid,
  order_token text,
  customer_name text,
  discount numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists erp_coupon_uses_coupon_idx on public.erp_coupon_uses (coupon_id, created_at desc);
alter table public.erp_coupon_uses enable row level security;
revoke all on public.erp_coupon_uses from anon, authenticated;

-- Calcula el descuento sin guardar nada. Solo productos SIN oferta (comparando con el precio sin promociones).
create or replace function public.vm__coupon_eval(p_store uuid, p_catalog uuid, p_catalog_slug text, p_code text, p_items jsonb, p_lock boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c public.erp_coupons%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_ids uuid[];
  v_eligible numeric;
  v_offer integer;
  v_lines jsonb;
  v_rows jsonb;
  v_disc numeric;
begin
  if v_code = '' then return jsonb_build_object('ok', false, 'message', 'Escribe el código del cupón.'); end if;
  if p_lock then
    select * into c from public.erp_coupons x where x.store_id = p_store and x.code = v_code for update;
  else
    select * into c from public.erp_coupons x where x.store_id = p_store and x.code = v_code;
  end if;
  if c.id is null or not c.active then return jsonb_build_object('ok', false, 'message', 'Ese cupón no existe o ya no está activo.'); end if;
  if c.starts_on is not null and v_today < c.starts_on then
    return jsonb_build_object('ok', false, 'message', 'Ese cupón empieza el ' || to_char(c.starts_on, 'DD/MM/YYYY') || '.');
  end if;
  if c.ends_on is not null and v_today > c.ends_on then return jsonb_build_object('ok', false, 'message', 'Ese cupón ya venció.'); end if;
  if c.max_uses is not null and c.uses >= c.max_uses then return jsonb_build_object('ok', false, 'message', 'Ese cupón ya se usó todas las veces.'); end if;
  if cardinality(c.catalog_slugs) > 0 and not (lower(btrim(coalesce(p_catalog_slug, ''))) = any (c.catalog_slugs)) then
    return jsonb_build_object('ok', false, 'message', 'Ese cupón no sirve en este catálogo.');
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'message', 'El carrito está vacío.');
  end if;
  select array_agg(distinct (e ->> 'product_id')::uuid) into v_ids
  from jsonb_array_elements(p_items) e where (e ->> 'product_id') ~ '^[0-9a-f-]{36}$';

  select coalesce(jsonb_agg(jsonb_build_object('product_id', w.pid, 'qty', w.qty, 'price', coalesce(i.price, 0),
           'offer', coalesce(i.price, 0) < coalesce(r.price, 0))), '[]'::jsonb)
    into v_rows
  from (select (e ->> 'product_id')::uuid pid, sum(coalesce((e ->> 'qty')::integer, 0))::integer qty
        from jsonb_array_elements(p_items) e where (e ->> 'product_id') ~ '^[0-9a-f-]{36}$' group by 1) w
  join public.catalog__items(p_catalog, v_ids) i on i.product_id = w.pid
  left join public.catalog__items_raw(p_catalog, v_ids) r on r.product_id = w.pid
  where w.qty > 0;

  select coalesce(sum((x ->> 'qty')::numeric * (x ->> 'price')::numeric) filter (where not (x ->> 'offer')::boolean and (x ->> 'price')::numeric > 0), 0),
         count(*) filter (where (x ->> 'offer')::boolean)
    into v_eligible, v_offer from jsonb_array_elements(v_rows) x;
  if v_eligible <= 0 then
    return jsonb_build_object('ok', false, 'message', case when v_offer > 0 then 'El cupón no aplica a productos que ya están en oferta.' else 'El carrito está vacío.' end);
  end if;
  if v_eligible < c.min_total then
    return jsonb_build_object('ok', false, 'message', 'Te faltan ' || public.vm__money(c.min_total - v_eligible) || ' para usar este cupón'
      || case when v_offer > 0 then ' (los productos en oferta no cuentan).' else '.' end, 'missing', c.min_total - v_eligible);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'qty', l.qty, 'price', l.price, 'unit_discount', l.ud)), '[]'::jsonb),
         coalesce(sum(l.ud * l.qty), 0)
    into v_lines, v_disc
  from (select y.product_id, y.qty, y.price,
               greatest(0, least(y.price, case when c.kind = 'pct' then round(y.price * c.amount / 100) else round(c.amount * y.price / v_eligible) end)) ud
        from (select (x ->> 'product_id')::uuid product_id, (x ->> 'qty')::integer qty, (x ->> 'price')::numeric price, (x ->> 'offer')::boolean offer
              from jsonb_array_elements(v_rows) x) y
        where not y.offer and y.price > 0) l;
  return jsonb_build_object('ok', true, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind, 'amount', c.amount, 'discount', v_disc,
    'eligible_total', v_eligible, 'offer_lines', v_offer, 'lines', v_lines,
    'label', case when c.kind = 'pct' then trim(to_char(c.amount, 'FM990')) || '% de descuento' else public.vm__money(c.amount) || ' de descuento' end);
end;
$$;
revoke all on function public.vm__coupon_eval(uuid, uuid, text, text, jsonb, boolean) from public, anon, authenticated;

create or replace function public.catalog_coupon_check(p_store text, p_catalog text, p_key text, p_code text, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store uuid := public.vm__store(p_store);
  v_catalog uuid;
  r jsonb;
begin
  if v_store is null or not public.vm__on(v_store, 'cupones') then return jsonb_build_object('ok', false, 'message', 'Esta tienda no tiene cupones.'); end if;
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then return jsonb_build_object('ok', false, 'message', 'Este catálogo no está disponible.'); end if;
  r := public.vm__coupon_eval(v_store, v_catalog, p_catalog, p_code, p_items, false);
  return r - 'coupon_id';
end;
$$;

-- Crea el pedido del catálogo (el de siempre) y, si trae cupón, lo aplica en el mismo paso.
create or replace function public.catalog_create_order_plus(p_store text, p_catalog text, p_key text, p_items jsonb, p_customer_name text,
  p_customer_note text default null, p_customer_whatsapp text default null, p_coupon text default null, p_session text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store uuid := public.vm__store(p_store);
  v_catalog uuid;
  v_eval jsonb := null;
  v_res jsonb;
  v_order uuid;
  v_disc numeric := 0;
  l jsonb;
begin
  if v_store is null then raise exception 'Este catálogo no está disponible.'; end if;
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  if nullif(btrim(coalesce(p_coupon, '')), '') is not null then
    if not public.vm__on(v_store, 'cupones') then raise exception 'Esta tienda no tiene cupones activos.'; end if;
    v_eval := public.vm__coupon_eval(v_store, v_catalog, p_catalog, p_coupon, p_items, true);
    if not coalesce((v_eval ->> 'ok')::boolean, false) then raise exception '%', coalesce(v_eval ->> 'message', 'El cupón no se pudo usar.'); end if;
  end if;

  v_res := to_jsonb(public.catalog_create_order(
    p_store => p_store, p_catalog => p_catalog, p_key => p_key, p_items => p_items,
    p_customer_name => p_customer_name, p_customer_note => p_customer_note, p_customer_whatsapp => p_customer_whatsapp));
  if jsonb_typeof(v_res) = 'array' then v_res := v_res -> 0; end if;
  select o.id into v_order from public.orders o where o.token = v_res ->> 'token' and o.store_id = v_store;

  if v_eval is not null and v_order is not null then
    for l in select * from jsonb_array_elements(v_eval -> 'lines') loop
      if (l ->> 'unit_discount')::numeric > 0 then
        update public.order_items oi set price = greatest(0, oi.price - (l ->> 'unit_discount')::numeric)
        where oi.order_id = v_order and oi.product_id = (l ->> 'product_id')::uuid and oi.price = (l ->> 'price')::numeric;
        if found then v_disc := v_disc + (l ->> 'unit_discount')::numeric * (l ->> 'qty')::numeric; end if;
      end if;
    end loop;
    update public.orders o set total = (select coalesce(sum(oi.quantity * oi.price), 0) from public.order_items oi where oi.order_id = v_order),
      customer_note = btrim(coalesce(o.customer_note, '') || E'\n🎟️ Cupón ' || (v_eval ->> 'code') || ': -' || public.vm__money(v_disc))
    where o.id = v_order;
    update public.erp_coupons set uses = uses + 1, updated_at = now() where id = (v_eval ->> 'coupon_id')::uuid;
    insert into public.erp_coupon_uses (coupon_id, store_id, order_id, order_token, customer_name, discount)
    values ((v_eval ->> 'coupon_id')::uuid, v_store, v_order, v_res ->> 'token', left(btrim(coalesce(p_customer_name, '')), 120), v_disc);
    v_res := v_res || jsonb_build_object('coupon', jsonb_build_object('code', v_eval ->> 'code', 'discount', v_disc),
      'total', (select o.total from public.orders o where o.id = v_order));
  end if;

  if coalesce(p_session, '') ~ '^[A-Za-z0-9-]{16,64}$' then
    update public.erp_cart_leads set status = 'converted', order_token = v_res ->> 'token', updated_at = now()
    where store_id = v_store and session = p_session and status <> 'converted';
  end if;
  return v_res;
end;
$$;

create or replace function public.coupons_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['products_prices', 'catalogs']::text[]) then
    return jsonb_build_object('ok', false, 'message', 'Necesitas «Cambiar precios» o «Catálogos».');
  end if;
  return jsonb_build_object('ok', true, 'on', public.vm__on(p_store, 'cupones'), 'can_edit', public.erp_can(p_store, 'products_prices'),
    'today', (now() at time zone 'America/Bogota')::date,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'kind', c.kind, 'amount', c.amount, 'min_total', c.min_total,
        'starts_on', c.starts_on, 'ends_on', c.ends_on, 'max_uses', c.max_uses, 'uses', c.uses, 'catalog_slugs', to_jsonb(c.catalog_slugs),
        'note', c.note, 'active', c.active, 'created_by_name', c.created_by_name, 'created_at', c.created_at,
        'discount_total', coalesce((select sum(u.discount) from public.erp_coupon_uses u where u.coupon_id = c.id), 0),
        'sales_total', coalesce((select sum(o.total) from public.erp_coupon_uses u join public.orders o on o.id = u.order_id
                                 where u.coupon_id = c.id and o.status in ('confirmed', 'completed')), 0))
      order by c.active desc, c.created_at desc) from public.erp_coupons c where c.store_id = p_store), '[]'::jsonb));
end;
$$;

create or replace function public.coupon_save(p_store uuid, p_id uuid, p_code text, p_kind text, p_amount numeric, p_min_total numeric,
  p_starts_on date, p_ends_on date, p_max_uses integer, p_catalog_slugs text[], p_note text, p_active boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', '', 'g'));
  v_cats text[];
  v_id uuid;
  v_name text;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products_prices') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas «Cambiar precios» para crear o cambiar cupones.');
  end if;
  if v_code !~ '^[A-Z0-9_-]{4,24}$' then return jsonb_build_object('ok', false, 'message', 'El código lleva de 4 a 24 letras o números, sin espacios.'); end if;
  if p_kind not in ('pct', 'value') then return jsonb_build_object('ok', false, 'message', 'Tipo no válido.'); end if;
  if p_kind = 'pct' and not (coalesce(p_amount, 0) between 1 and 90) then return jsonb_build_object('ok', false, 'message', 'El porcentaje va de 1 a 90.'); end if;
  if p_kind = 'value' and coalesce(p_amount, 0) <= 0 then return jsonb_build_object('ok', false, 'message', 'Escribe el valor del descuento.'); end if;
  if p_kind = 'value' and coalesce(p_min_total, 0) <= p_amount then
    return jsonb_build_object('ok', false, 'message', 'Para un cupón por valor el mínimo de compra debe ser mayor que el descuento.');
  end if;
  if p_ends_on is not null and p_starts_on is not null and p_ends_on < p_starts_on then
    return jsonb_build_object('ok', false, 'message', 'La fecha final es antes de la inicial.');
  end if;
  if p_max_uses is not null and p_max_uses <= 0 then return jsonb_build_object('ok', false, 'message', 'El límite de usos debe ser mayor que 0.'); end if;
  select coalesce(array_agg(distinct lower(btrim(s))) filter (where lower(btrim(s)) ~ '^[a-z0-9][a-z0-9-]{0,47}$'), '{}') into v_cats
  from unnest(coalesce(p_catalog_slugs, '{}')) s;
  if exists (select 1 from public.erp_coupons c where c.store_id = p_store and c.code = v_code and c.id is distinct from p_id) then
    return jsonb_build_object('ok', false, 'message', 'Ya tienes un cupón con ese código.');
  end if;
  v_name := coalesce((select coalesce(nullif(su.display_name, ''), su.username) from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()), 'Dueño');
  if p_id is null then
    insert into public.erp_coupons (store_id, code, kind, amount, min_total, starts_on, ends_on, max_uses, catalog_slugs, note, active, created_by, created_by_name)
    values (p_store, v_code, p_kind, p_amount, coalesce(p_min_total, 0), p_starts_on, p_ends_on, p_max_uses, v_cats,
            nullif(left(btrim(coalesce(p_note, '')), 200), ''), coalesce(p_active, true), auth.uid(), v_name)
    returning id into v_id;
  else
    update public.erp_coupons set code = v_code, kind = p_kind, amount = p_amount, min_total = coalesce(p_min_total, 0), starts_on = p_starts_on,
      ends_on = p_ends_on, max_uses = p_max_uses, catalog_slugs = v_cats, note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
      active = coalesce(p_active, true), updated_at = now()
    where id = p_id and store_id = p_store returning id into v_id;
    if v_id is null then return jsonb_build_object('ok', false, 'message', 'No encontré ese cupón.'); end if;
  end if;
  begin
    perform public.erp_audit(p_store, case when p_id is null then 'coupon.created' else 'coupon.updated' end, 'erp_coupons', v_id,
      jsonb_build_object('code', v_code, 'kind', p_kind, 'amount', p_amount, 'min_total', p_min_total, 'active', coalesce(p_active, true)));
  exception when undefined_function then null; end;
  return public.coupons_list(p_store) || jsonb_build_object('saved_id', v_id);
end;
$$;

create or replace function public.coupon_delete(p_store uuid, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.erp_coupons%rowtype;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products_prices') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas «Cambiar precios».');
  end if;
  select * into c from public.erp_coupons where id = p_id and store_id = p_store;
  if c.id is null then return jsonb_build_object('ok', false, 'message', 'No encontré ese cupón.'); end if;
  if c.uses > 0 then
    -- Con usos queda en el historial: solo se apaga.
    update public.erp_coupons set active = false, updated_at = now() where id = p_id;
  else
    delete from public.erp_coupons where id = p_id;
  end if;
  begin
    perform public.erp_audit(p_store, 'coupon.deleted', 'erp_coupons', p_id, jsonb_build_object('code', c.code, 'kept', c.uses > 0));
  exception when undefined_function then null; end;
  return public.coupons_list(p_store);
end;
$$;

-- ------------------------------------------------------------------ campana
create or replace function public.vm_alerts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_points uuid[];
begin
  if not public.vm__member(p_store) then return jsonb_build_object('ok', false); end if;
  v_points := public.erp_my_points(p_store);
  return jsonb_build_object('ok', true,
    'carts', case when public.vm__on(p_store, 'carritos') and public.erp_can(p_store, 'orders') then (
      select count(*) from public.erp_cart_leads l left join public.store_catalogs c on c.id = l.catalog_id
      where l.store_id = p_store and l.status = 'open' and l.updated_at < now() - interval '30 minutes' and l.updated_at > now() - interval '3 days'
        and (v_points is null or c.point_id = any (v_points))) else 0 end,
    'waitlist_ready', case when public.vm__on(p_store, 'avisame') and public.erp_can_any(p_store, array['orders', 'products']::text[]) then (
      select count(*) from public.erp_stock_waitlist w left join public.store_catalogs c on c.id = w.catalog_id
      where w.store_id = p_store and w.status = 'waiting' and w.catalog_id is not null
        and (v_points is null or c.point_id = any (v_points))
        and exists (select 1 from public.catalog__items(w.catalog_id, array[w.product_id]) i where coalesce(i.stock, 0) > 0)) else 0 end);
end;
$$;

revoke all on function public.store_features_get(uuid) from public, anon;
revoke all on function public.store_feature_save(uuid, text, boolean, jsonb) from public, anon;
revoke all on function public.store_public_features(text, text) from public;
revoke all on function public.catalog_cart_lead_save(text, text, text, text, text, text, jsonb) from public;
revoke all on function public.catalog_cart_lead_converted(text, text, text) from public;
revoke all on function public.cart_leads_list(uuid, integer) from public, anon;
revoke all on function public.cart_lead_mark(uuid, uuid, text) from public, anon;
revoke all on function public.catalog_notify_me(text, text, text, uuid, text, text) from public;
revoke all on function public.stock_waitlist_list(uuid) from public, anon;
revoke all on function public.stock_waitlist_mark(uuid, uuid[], text) from public, anon;
revoke all on function public.catalog_coupon_check(text, text, text, text, jsonb) from public;
revoke all on function public.catalog_create_order_plus(text, text, text, jsonb, text, text, text, text, text) from public;
revoke all on function public.coupons_list(uuid) from public, anon;
revoke all on function public.coupon_save(uuid, uuid, text, text, numeric, numeric, date, date, integer, text[], text, boolean) from public, anon;
revoke all on function public.coupon_delete(uuid, uuid) from public, anon;
revoke all on function public.vm_alerts(uuid) from public, anon;

grant execute on function public.store_features_get(uuid) to authenticated;
grant execute on function public.store_feature_save(uuid, text, boolean, jsonb) to authenticated;
grant execute on function public.store_public_features(text, text) to anon, authenticated;
grant execute on function public.catalog_cart_lead_save(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.catalog_cart_lead_converted(text, text, text) to anon, authenticated;
grant execute on function public.cart_leads_list(uuid, integer) to authenticated;
grant execute on function public.cart_lead_mark(uuid, uuid, text) to authenticated;
grant execute on function public.catalog_notify_me(text, text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.stock_waitlist_list(uuid) to authenticated;
grant execute on function public.stock_waitlist_mark(uuid, uuid[], text) to authenticated;
grant execute on function public.catalog_coupon_check(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.catalog_create_order_plus(text, text, text, jsonb, text, text, text, text, text) to anon, authenticated;
grant execute on function public.coupons_list(uuid) to authenticated;
grant execute on function public.coupon_save(uuid, uuid, text, text, numeric, numeric, date, date, integer, text[], text, boolean) to authenticated;
grant execute on function public.coupon_delete(uuid, uuid) to authenticated;
grant execute on function public.vm_alerts(uuid) to authenticated;

notify pgrst, 'reload schema';
