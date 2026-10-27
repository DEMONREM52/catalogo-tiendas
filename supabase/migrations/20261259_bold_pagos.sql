-- =====================================================================
-- REMHUB · Bold: botón de pagos de cada tienda y de sus puntos
--
--   erp_bold_accounts: las cuentas Bold de la tienda («Bold Principal»,
--     «Bold Zamora»…), cada una con sus llaves de pruebas y de producción
--     (la secreta cifrada por el servidor) y el modo en que está.
--   erp_bold_points: qué cuenta usa cada punto; una misma cuenta puede
--     servir a varios puntos. Sin asignar = la cuenta por defecto.
--   erp_bold_payments: cada intento de pago (referencia única que va a
--     Bold), su estado y lo que Bold reportó.
--
--   Las llaves solo las maneja el servidor (rol de servicio): ninguna tabla
--   se puede leer desde el navegador.
--   Landing pages: forma de pago 'bold' con su propio descuento
--   (payments.bold_pct) y cuenta opcional (payments.bold_account).
--   Redefine landing_public y landing_order (versión de 20261254).
-- Requiere 20261252 y 20261254. No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_bold_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  mode text not null default 'test' check (mode in ('test', 'production')),
  test_identity text,
  test_secret_enc text,
  prod_identity text,
  prod_secret_enc text,
  is_default boolean not null default false,
  active boolean not null default true,
  last_ok_at timestamptz,
  last_error text,
  last_event_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists erp_bold_accounts_store on public.erp_bold_accounts (store_id);
create unique index if not exists erp_bold_accounts_one_default on public.erp_bold_accounts (store_id) where is_default;

create table if not exists public.erp_bold_points (
  point_id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id uuid not null references public.erp_bold_accounts(id) on delete cascade,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists erp_bold_points_store on public.erp_bold_points (store_id);

create table if not exists public.erp_bold_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id uuid references public.erp_bold_accounts(id) on delete set null,
  order_id uuid not null,
  reference text not null unique check (reference ~ '^[A-Za-z0-9_-]{6,60}$'),
  amount numeric not null check (amount > 0),
  currency text not null default 'COP',
  mode text not null check (mode in ('test', 'production')),
  source text not null default 'order' check (source in ('landing', 'order')),
  status text not null default 'created' check (status in ('created', 'pending', 'approved', 'rejected', 'failed', 'voided', 'mismatch')),
  bold_payment_id text,
  payment_method text,
  approval_number text,
  payer_email text,
  last_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists erp_bold_payments_order on public.erp_bold_payments (order_id, created_at desc);
create index if not exists erp_bold_payments_store on public.erp_bold_payments (store_id, created_at desc);

alter table public.erp_bold_accounts enable row level security;
alter table public.erp_bold_points enable row level security;
alter table public.erp_bold_payments enable row level security;
revoke all on public.erp_bold_accounts, public.erp_bold_points, public.erp_bold_payments from anon, authenticated;
grant all on public.erp_bold_accounts, public.erp_bold_points, public.erp_bold_payments to service_role;

-- Una cuenta lista para cobrar: activa y con las dos llaves del modo en que está.
create or replace function public.erp__bold_ready(a public.erp_bold_accounts)
returns boolean language sql immutable as $$
  select coalesce(a.active, false) and case a.mode
    when 'production' then coalesce(a.prod_identity, '') <> '' and coalesce(a.prod_secret_enc, '') <> ''
    else coalesce(a.test_identity, '') <> '' and coalesce(a.test_secret_enc, '') <> '' end
$$;

-- Qué cuenta cobra: la elegida a mano (si está lista), la del punto o la de por defecto.
create or replace function public.erp__bold_account_for(p_store uuid, p_point uuid, p_override uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.id from public.erp_bold_accounts a where a.id = p_override and a.store_id = p_store and public.erp__bold_ready(a)),
    (select a.id from public.erp_bold_points bp join public.erp_bold_accounts a on a.id = bp.account_id
      where bp.point_id = p_point and bp.store_id = p_store and public.erp__bold_ready(a)),
    (select a.id from public.erp_bold_accounts a where a.store_id = p_store and a.is_default and public.erp__bold_ready(a)))
$$;

-- Punto de un pedido: el que registró la venta o el del catálogo por donde entró.
create or replace function public.erp__order_point(p_order uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.point_id from public.erp_order_meta m where m.order_id = p_order),
    (select c.point_id from public.store_catalog_orders co join public.store_catalogs c on c.id = co.catalog_id where co.order_id = p_order limit 1))
$$;

-- Punto de una landing: el de su catálogo.
create or replace function public.erp__landing_point(p_page uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select c.point_id from public.erp_landing_pages pg join public.store_catalogs c on c.id = pg.catalog_id where pg.id = p_page
$$;

create or replace function public.erp__landing_bold(p_page uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select public.erp__bold_account_for(pg.store_id, public.erp__landing_point(pg.id),
    case when coalesce(pg.config -> 'payments' ->> 'bold_account', '') ~* '^[0-9a-f-]{36}$' then (pg.config -> 'payments' ->> 'bold_account')::uuid end)
  from public.erp_landing_pages pg where pg.id = p_page
$$;

-- Lo que Bold reportó (webhook o consulta): actualiza el intento y, si quedó aprobado por el
-- valor esperado, marca el pedido como pagado. Repetir el mismo aviso no cambia nada.
create or replace function public.erp__bold_apply(p_reference text, p_status text, p_amount numeric, p_event jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pay public.erp_bold_payments;
  v_status text := lower(coalesce(p_status, ''));
  v_prev text;
  v_has_pay boolean;
begin
  select * into pay from public.erp_bold_payments where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  v_prev := pay.status;
  v_status := case v_status
    when 'approved' then 'approved' when 'sale_approved' then 'approved'
    when 'rejected' then 'rejected' when 'sale_rejected' then 'rejected'
    when 'failed' then 'failed'
    when 'voided' then 'voided' when 'void_approved' then 'voided'
    when 'processing' then 'pending' when 'pending' then 'pending'
    else null end;
  if v_status is null then return jsonb_build_object('ok', true, 'changed', false, 'status', pay.status); end if;
  -- Aprobado por otro valor: no se da por pagado; queda para revisar.
  if v_status = 'approved' and p_amount is not null and round(p_amount) <> round(pay.amount) then v_status := 'mismatch'; end if;
  -- Un pago aprobado solo cambia si Bold lo anula.
  if v_prev = 'approved' and v_status <> 'voided' then return jsonb_build_object('ok', true, 'changed', false, 'status', v_prev); end if;
  if v_prev = v_status then return jsonb_build_object('ok', true, 'changed', false, 'status', v_prev); end if;

  update public.erp_bold_payments set
    status = v_status,
    bold_payment_id = coalesce(nullif(left(p_event ->> 'payment_id', 80), ''), bold_payment_id),
    payment_method = coalesce(nullif(left(p_event ->> 'payment_method', 40), ''), payment_method),
    approval_number = coalesce(nullif(left(p_event ->> 'approval_number', 40), ''), approval_number),
    payer_email = coalesce(nullif(left(p_event ->> 'payer_email', 120), ''), payer_email),
    last_event = p_event,
    paid_at = case when v_status = 'approved' then now() else paid_at end,
    updated_at = now()
  where id = pay.id;
  if pay.account_id is not null then update public.erp_bold_accounts set last_event_at = now() where id = pay.account_id; end if;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_status') into v_has_pay;
  if v_has_pay then
    if v_status = 'approved' then
      execute 'update public.orders set payment_status = ''paid'' where id = $1' using pay.order_id;
    elsif v_status = 'voided' and v_prev = 'approved' then
      execute 'update public.orders set payment_status = ''unpaid'' where id = $1 and payment_status = ''paid''' using pay.order_id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'changed', true, 'status', v_status, 'previous', v_prev, 'order_id', pay.order_id, 'store_id', pay.store_id,
    'amount', pay.amount, 'source', pay.source, 'receipt_no', (select o.receipt_no from public.orders o where o.id = pay.order_id));
end $$;

-- Estado de un pago para quien tiene su referencia (vuelve de Bold): sin datos del cliente.
create or replace function public.bold_payment_status(p_reference text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('ok', true, 'status', p.status, 'amount', p.amount, 'method', p.payment_method,
                                             'mode', p.mode, 'source', p.source, 'updated_at', p.updated_at)
                   from public.erp_bold_payments p where p.reference = p_reference), jsonb_build_object('ok', false))
$$;

-- Bold en la página del pedido: si el punto del pedido tiene cuenta lista y el último intento.
create or replace function public.bold_order_status(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (select o.id, o.store_id from public.orders o where o.token = p_token limit 1),
  last as (select p.* from public.erp_bold_payments p join o on o.id = p.order_id order by p.created_at desc limit 1)
  select case when not exists (select 1 from o) then jsonb_build_object('ok', false) else jsonb_build_object('ok', true,
    'available', (select public.erp__bold_account_for(o.store_id, public.erp__order_point(o.id)) is not null from o),
    'mode', (select a.mode from o join public.erp_bold_accounts a on a.id = public.erp__bold_account_for(o.store_id, public.erp__order_point(o.id))),
    'status', (select status from last), 'method', (select payment_method from last), 'approval', (select approval_number from last),
    'reference', (select reference from last where status in ('created', 'pending')),
    'landing', exists (select 1 from public.erp_landing_orders lo join o on o.id = lo.order_id where lo.payment = 'bold')) end
$$;

-- Para el editor de landings: las cuentas (sin llaves) y cuál cobraría según el punto del catálogo.
create or replace function public.erp_bold_accounts_brief(p_store uuid, p_catalog uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_point uuid;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'products') or public.erp_can(p_store, 'orders')) then
    return jsonb_build_object('ok', false, 'message', 'Sin permiso.');
  end if;
  select c.point_id into v_point from public.store_catalogs c where c.id = p_catalog and c.store_id = p_store;
  return jsonb_build_object('ok', true,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'mode', a.mode, 'ready', public.erp__bold_ready(a), 'is_default', a.is_default) order by a.is_default desc, a.name)
                          from public.erp_bold_accounts a where a.store_id = p_store), '[]'::jsonb),
    'resolved', public.erp__bold_account_for(p_store, v_point),
    'point', (select w.name from public.erp_warehouses w where w.id = v_point));
end $$;

revoke all on function public.erp__bold_ready(public.erp_bold_accounts) from public, anon, authenticated;
revoke all on function public.erp__bold_account_for(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.erp__order_point(uuid) from public, anon, authenticated;
revoke all on function public.erp__landing_point(uuid) from public, anon, authenticated;
revoke all on function public.erp__landing_bold(uuid) from public, anon, authenticated;
revoke all on function public.erp__bold_apply(text, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.bold_payment_status(text) from public;
revoke all on function public.bold_order_status(text) from public;
revoke all on function public.erp_bold_accounts_brief(uuid, uuid) from public, anon;
grant execute on function public.erp__bold_ready(public.erp_bold_accounts) to service_role;
grant execute on function public.erp__bold_account_for(uuid, uuid, uuid) to service_role;
grant execute on function public.erp__order_point(uuid) to service_role;
grant execute on function public.erp__landing_point(uuid) to service_role;
grant execute on function public.erp__landing_bold(uuid) to service_role;
grant execute on function public.erp__bold_apply(text, text, numeric, jsonb) to service_role;
grant execute on function public.bold_payment_status(text) to anon, authenticated, service_role;
grant execute on function public.bold_order_status(text) to anon, authenticated, service_role;
grant execute on function public.erp_bold_accounts_brief(uuid, uuid) to authenticated, service_role;


-- ---------------------------------------------------------------- landing pages con Bold

create or replace function public.landing_public(p_store text, p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f jsonb := public.erp__landing_find(p_store, p_slug);
  pg public.erp_landing_pages;
  v_up uuid;
  v_ids uuid[];
  v_items jsonb;
  v_upsell jsonb;
  v_pm jsonb;
  v_cfg jsonb;
  v_bold uuid;
begin
  if f is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  pg := jsonb_populate_record(null::public.erp_landing_pages, f -> 'page');
  v_cfg := pg.config;
  v_up := case when coalesce((v_cfg -> 'upsell' ->> 'enabled')::boolean, false) and (v_cfg -> 'upsell' ->> 'product_id') ~* '^[0-9a-f-]{36}$'
               then (v_cfg -> 'upsell' ->> 'product_id')::uuid end;
  v_ids := pg.product_ids || case when v_up is null then '{}'::uuid[] else array[v_up] end;
  with pr as (select * from public.erp__landing_prices(f ->> 'store_slug', f ->> 'catalog_slug', f ->> 'catalog_key', v_ids)),
  rows as (
    select p.id, jsonb_build_object(
             'id', p.id, 'name', p.name,
             'option', coalesce(nullif(v_cfg -> 'option_names' ->> p.id::text, ''), p.name),
             'image', p.image_url,
             'gallery', coalesce(p.product_details -> 'gallery_urls', '[]'::jsonb),
             'description', coalesce(nullif(p.product_details ->> 'long_description', ''), p.description),
             'highlights', coalesce(p.product_details -> 'highlights', '[]'::jsonb),
             'specifications', coalesce(p.product_details -> 'specifications', '[]'::jsonb),
             'video_url', p.product_details ->> 'video_url',
             'price', case when p.id = v_up then pr.price else coalesce(public.erp__landing_price(v_cfg, p.id), pr.price) end,
             'catalog_price', pr.price, 'stock', greatest(pr.stock, 0)) as j
    from public.products p join pr on pr.id = p.id
    where p.store_id = (f ->> 'store_id')::uuid and p.active and pr.price > 0
  )
  select coalesce(jsonb_agg(r.j order by array_position(pg.product_ids, r.id)) filter (where r.id = any(pg.product_ids)), '[]'::jsonb),
         (array_agg(r.j) filter (where r.id = v_up))[1]
    into v_items, v_upsell
  from rows r;
  v_pm := public.erp__landing_payments((f ->> 'store_id')::uuid);
  v_bold := case when coalesce((v_cfg -> 'payments' ->> 'bold')::boolean, false) then public.erp__landing_bold(pg.id) end;
  return jsonb_build_object('ok', true,
    'store', jsonb_build_object('id', f ->> 'store_id', 'slug', f ->> 'store_slug', 'name', f ->> 'store_name', 'logo_url', f ->> 'logo_url', 'whatsapp', f ->> 'whatsapp'),
    'page', jsonb_build_object('id', pg.id, 'slug', pg.slug, 'name', pg.name, 'config', v_cfg, 'catalog', f ->> 'catalog_slug'),
    'items', v_items,
    'upsell', v_upsell,
    'payments', jsonb_build_object(
      'cod', coalesce((v_cfg -> 'payments' ->> 'cod')::boolean, true),
      'online', coalesce((v_cfg -> 'payments' ->> 'online')::boolean, false) and (v_pm ->> 'wompi')::boolean,
      'addi', coalesce((v_cfg -> 'payments' ->> 'addi')::boolean, false) and (v_pm ->> 'addi')::boolean,
      'bold', v_bold is not null,
      'bold_test', v_bold is not null and (select a.mode = 'test' from public.erp_bold_accounts a where a.id = v_bold)),
    'social', public.erp__landing_social(pg.id),
    'trust', public.erp__landing_trust((f ->> 'store_id')::uuid));
end;
$$;


create or replace function public.landing_order(p_store text, p_slug text, p_session text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := public.erp__landing_find(p_store, p_slug);
  pg public.erp_landing_pages;
  c jsonb := coalesce(p -> 'customer', '{}'::jsonb);
  v_units uuid[];
  v_n integer;
  v_pct numeric;
  v_pay text := coalesce(p ->> 'payment', 'cod');
  v_opct numeric := 0;
  v_pm jsonb;
  v_bold uuid;
  v_up uuid;
  v_up_pct numeric := 0;
  v_take_up boolean := coalesce((p ->> 'upsell')::boolean, false);
  v_xpct numeric := 0;
  v_items jsonb;
  v_name text := regexp_replace(btrim(coalesce(c ->> 'name', '')), '\s+', ' ', 'g');
  v_wa text := regexp_replace(coalesce(c ->> 'whatsapp', ''), '\D', '', 'g');
  v_doc text := regexp_replace(coalesce(c ->> 'document', ''), '[^0-9A-Za-z]', '', 'g');
  v_email text := lower(btrim(coalesce(c ->> 'email', '')));
  v_dept text := left(btrim(coalesce(c ->> 'department', '')), 60);
  v_city text := left(btrim(coalesce(c ->> 'city', '')), 80);
  v_addr text := left(btrim(coalesce(c ->> 'address', '')), 200);
  v_nb text := left(btrim(coalesce(c ->> 'neighborhood', '')), 80);
  v_notes text := left(btrim(coalesce(c ->> 'notes', '')), 300);
  v_note text;
  v_res jsonb;
  v_order uuid;
  v_total numeric;
  v_ref jsonb := coalesce(p -> 'ref', '{}'::jsonb);
  r record;
begin
  if f is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Esta oferta ya no está disponible.'); end if;
  if coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Recarga la página e intenta de nuevo.'); end if;
  pg := jsonb_populate_record(null::public.erp_landing_pages, f -> 'page');

  -- Cliente
  v_wa := regexp_replace(v_wa, '^57(?=3\d{9}$)', '');
  if length(v_name) < 3 or v_name !~ '\s' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'name', 'message', 'Escribe tu nombre y apellido.'); end if;
  if v_wa !~ '^3\d{9}$' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'whatsapp', 'message', 'Escribe un WhatsApp de 10 dígitos que empiece por 3.'); end if;
  if coalesce((pg.config -> 'form' ->> 'ask_document')::boolean, true) and length(v_doc) not between 5 and 15 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'document', 'message', 'Escribe tu número de cédula.');
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'email', 'message', 'Revisa el correo.'); end if;
  if coalesce((pg.config -> 'form' ->> 'ask_email')::boolean, false) and v_email = '' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'email', 'message', 'Escribe tu correo.'); end if;
  if v_dept = '' then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'department', 'message', 'Elige tu departamento.'); end if;
  if length(v_city) < 2 then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'city', 'message', 'Escribe tu ciudad o municipio.'); end if;
  if length(v_addr) < 5 then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'address', 'message', 'Escribe la dirección completa de entrega.'); end if;

  -- Freno a pedidos repetidos o automáticos
  if (select count(*) from public.erp_landing_orders where page_id = pg.id and session_id = p_session and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.erp_landing_orders where store_id = pg.store_id and wa_hash = md5(v_wa) and created_at > now() - interval '1 day') >= 4 then
    return jsonb_build_object('ok', false, 'code', 'LIMIT', 'message', 'Ya recibimos tus pedidos. Escríbenos por WhatsApp si quieres agregar algo.');
  end if;

  -- Paquete (1, 2, 3 unidades…): cada unidad con su opción
  select coalesce(array_agg(x::uuid), '{}') into v_units
  from jsonb_array_elements_text(case when jsonb_typeof(p -> 'units') = 'array' then p -> 'units' else '[]'::jsonb end) x
  where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_n := coalesce(array_length(v_units, 1), 0);
  if v_n = 0 or v_n <> jsonb_array_length(coalesce(p -> 'units', '[]'::jsonb)) then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Elige las opciones de tu pedido.'); end if;
  if exists (select 1 from unnest(v_units) u where not (u = any(pg.product_ids))) then return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Una de las opciones ya no está disponible. Recarga la página.'); end if;
  select (b ->> 'pct')::numeric into v_pct from jsonb_array_elements(coalesce(pg.config -> 'bundles', '[]'::jsonb)) b where (b ->> 'qty')::integer = v_n limit 1;
  if v_pct is null then
    if v_n <> 1 or jsonb_array_length(coalesce(pg.config -> 'bundles', '[]'::jsonb)) > 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Ese paquete ya no está disponible. Recarga la página.');
    end if;
    v_pct := 0;
  end if;
  v_pct := least(greatest(v_pct, 0), 90);

  -- Forma de pago
  v_pm := public.erp__landing_payments(pg.store_id);
  if v_pay = 'bold' and coalesce((pg.config -> 'payments' ->> 'bold')::boolean, false) then v_bold := public.erp__landing_bold(pg.id); end if;
  if v_pay = 'cod' and not coalesce((pg.config -> 'payments' ->> 'cod')::boolean, true)
     or v_pay = 'online' and not (coalesce((pg.config -> 'payments' ->> 'online')::boolean, false) and (v_pm ->> 'wompi')::boolean)
     or v_pay = 'addi' and not (coalesce((pg.config -> 'payments' ->> 'addi')::boolean, false) and (v_pm ->> 'addi')::boolean)
     or v_pay = 'bold' and v_bold is null
     or v_pay not in ('cod', 'online', 'addi', 'bold') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'payment', 'message', 'Elige otra forma de pago.');
  end if;
  if coalesce((p ->> 'exit')::boolean, false) and coalesce((pg.config -> 'exit_offer' ->> 'enabled')::boolean, false) then
    v_xpct := least(greatest(coalesce((pg.config -> 'exit_offer' ->> 'pct')::numeric, 0), 0), 30);
  end if;
  if v_pay = 'online' then v_opct := least(greatest(coalesce((pg.config -> 'payments' ->> 'online_pct')::numeric, 0), 0), 30); end if;
  if v_pay = 'bold' then v_opct := least(greatest(coalesce((pg.config -> 'payments' ->> 'bold_pct')::numeric, 0), 0), 30); end if;

  -- Adicional de último momento
  if v_take_up and coalesce((pg.config -> 'upsell' ->> 'enabled')::boolean, false) and (pg.config -> 'upsell' ->> 'product_id') ~* '^[0-9a-f-]{36}$' then
    v_up := (pg.config -> 'upsell' ->> 'product_id')::uuid;
    v_up_pct := least(greatest(coalesce((pg.config -> 'upsell' ->> 'pct')::numeric, 0), 0), 90);
    if v_up = any(v_units) then v_up := null; end if;
  end if;

  -- Existencias reales del catálogo
  for r in
    select u.id, u.qty, pr.price, pr.stock, pd.name
    from (select x as id, count(*)::integer as qty from unnest(v_units || case when v_up is null then '{}'::uuid[] else array[v_up] end) x group by x) u
    left join public.erp__landing_prices(f ->> 'store_slug', f ->> 'catalog_slug', f ->> 'catalog_key',
                                         v_units || case when v_up is null then '{}'::uuid[] else array[v_up] end) pr on pr.id = u.id
    left join public.products pd on pd.id = u.id
  loop
    if r.price is null or r.price <= 0 then
      if r.id = v_up then v_up := null; continue; end if;
      return jsonb_build_object('ok', false, 'code', 'STOCK', 'message', format('«%s» ya no está disponible.', coalesce(r.name, 'Un producto')));
    end if;
    if r.stock is not null and r.stock < r.qty then
      if r.id = v_up then v_up := null; continue; end if;
      return jsonb_build_object('ok', false, 'code', 'STOCK', 'message',
        case when r.stock <= 0 then format('«%s» se agotó. Elige otra opción.', r.name) else format('De «%s» solo quedan %s.', r.name, r.stock::integer) end);
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object('product_id', x, 'qty', n)) into v_items
  from (select x, count(*)::integer n from unnest(v_units || case when v_up is null then '{}'::uuid[] else array[v_up] end) x group by x) t;

  v_note := concat_ws(E'\n',
    '🛍️ Landing: ' || pg.name,
    '💳 Pago: ' || case v_pay when 'cod' then 'Contraentrega (paga al recibir)'
                              when 'online' then 'En línea (Wompi)' || case when v_opct > 0 then format(' −%s%%', v_opct) else '' end
                              when 'bold' then 'En línea con Bold' || case when v_opct > 0 then format(' −%s%%', v_opct) else '' end
                              else 'A cuotas con Addi' end,
    case when v_n > 1 then format('📦 Paquete: %s unidades%s', v_n, case when v_pct > 0 then format(' (−%s%%)', v_pct) else '' end) end,
    case when v_xpct > 0 then format('🎁 Oferta de salida: −%s%% adicional', v_xpct) end,
    case when v_up is not null then format('➕ Adicional de último momento%s', case when v_up_pct > 0 then format(' (−%s%%)', v_up_pct) else '' end) end,
    case when v_doc <> '' then '🪪 Cédula: ' || v_doc end,
    '📍 ' || v_addr || case when v_nb <> '' then ' · Barrio ' || v_nb else '' end,
    '🏙️ ' || v_city || ', ' || v_dept,
    case when v_email <> '' then '✉️ ' || v_email end,
    case when v_notes <> '' then '📝 ' || v_notes end,
    case when coalesce(v_ref ->> 'source', '') <> '' then '📣 Llegó por: ' || left(v_ref ->> 'source', 40) || coalesce(' / ' || left(nullif(v_ref ->> 'campaign', ''), 60), '') end);

  begin
    v_res := to_jsonb(public.catalog_create_order(
      p_store => f ->> 'store_slug', p_catalog => f ->> 'catalog_slug', p_key => f ->> 'catalog_key', p_items => v_items,
      p_customer_name => initcap(v_name), p_customer_note => v_note, p_customer_whatsapp => v_wa));
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'ORDER',
      'message', case when sqlerrm ~* 'stock|existencia|inventario' then 'Las existencias cambiaron. Recarga la página e intenta de nuevo.' else 'No se pudo crear el pedido. Intenta de nuevo en un momento.' end,
      'detail', left(sqlerrm, 200));
  end;
  if jsonb_typeof(v_res) = 'array' then v_res := v_res -> 0; end if;
  select o.id into v_order from public.orders o where o.token = v_res ->> 'token' and o.store_id = pg.store_id;
  if v_order is null then return jsonb_build_object('ok', false, 'code', 'ORDER', 'message', 'No se pudo crear el pedido. Intenta de nuevo.'); end if;

  update public.order_items oi
     set price = public.erp__landing_price(pg.config, oi.product_id)
   where oi.order_id = v_order and oi.product_id is distinct from v_up
     and public.erp__landing_price(pg.config, oi.product_id) is not null;

  if v_pct > 0 or v_opct > 0 or v_xpct > 0 or (v_up is not null and v_up_pct > 0) then
    update public.order_items oi
       set price = public.erp__cop(oi.price * (1 - (case when oi.product_id = v_up then v_up_pct else v_pct end) / 100.0)
                                   * (1 - (case when oi.product_id = v_up then 0 else v_xpct end) / 100.0) * (1 - v_opct / 100.0))
     where oi.order_id = v_order
       and (v_opct > 0 or (case when oi.product_id = v_up then v_up_pct else v_pct + v_xpct end) > 0);
  end if;
  select coalesce(sum(oi.price * oi.quantity), 0) into v_total from public.order_items oi where oi.order_id = v_order;
  update public.orders set total = v_total where id = v_order;

  insert into public.erp_landing_orders (order_id, page_id, store_id, session_id, first_name, city, department, units, bundle_pct, payment, upsell, total, wa_hash, source, campaign)
  values (v_order, pg.id, pg.store_id, p_session, split_part(initcap(v_name), ' ', 1), initcap(v_city), v_dept, v_n, v_pct, v_pay, v_up is not null, v_total, md5(v_wa),
          left(lower(nullif(btrim(v_ref ->> 'source'), '')), 60), left(nullif(btrim(v_ref ->> 'campaign'), ''), 120))
  on conflict (order_id) do nothing;
  update public.erp_landing_visits set ordered = true, last_seen = now() where page_id = pg.id and session_id = p_session;
  update public.erp_landing_leads set status = 'ordered', updated_at = now() where page_id = pg.id and status = 'open' and (session_id = p_session or whatsapp = v_wa);

  return jsonb_build_object('ok', true, 'token', v_res ->> 'token', 'receipt_no', v_res ->> 'receipt_no', 'order_id', v_order,
    'total', v_total, 'payment', v_pay, 'store_id', pg.store_id, 'bold_account', v_bold, 'page_name', pg.name,
    'event_id', (f ->> 'store_slug') || '-' || coalesce(v_res ->> 'receipt_no', v_order::text),
    'items', (select jsonb_agg(jsonb_build_object('id', oi.product_id, 'name', pd.name, 'price', oi.price, 'quantity', oi.quantity))
              from public.order_items oi left join public.products pd on pd.id = oi.product_id where oi.order_id = v_order));
end;
$$;

grant execute on function public.landing_public(text, text) to anon, authenticated, service_role;
grant execute on function public.landing_order(text, text, text, jsonb) to anon, authenticated, service_role;

-- Publicar con solo Bold como forma de pago también vale.
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.erp_landing_save(uuid, uuid, jsonb)'::regprocedure) into v_src;
  if v_src is not null and position('''bold''' in v_src) = 0 then
    v_src := replace(v_src,
      'or coalesce((v_cfg -> ''payments'' ->> ''addi'')::boolean, false)) then',
      'or coalesce((v_cfg -> ''payments'' ->> ''addi'')::boolean, false) or coalesce((v_cfg -> ''payments'' ->> ''bold'')::boolean, false)) then');
    execute v_src;
  end if;
end $$;
