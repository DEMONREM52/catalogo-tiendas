-- =====================================================================
-- REMHUB · Landing pages de producto (RemHub Social → Landing pages)
--
--   · erp_landing_pages: una página por producto (con sus opciones), atada a
--     un catálogo: el catálogo pone el precio y las existencias.
--   · erp_landing_visits: visitas REALES (una por navegador), con de dónde
--     vienen (utm / Facebook / Instagram / TikTok) y si abrieron el pedido.
--     De aquí sale «N personas viendo ahora» (latido de los últimos 75 s).
--   · erp_landing_orders: pedidos hechos desde la landing (primer nombre y
--     ciudad para «Fulana de Pereira pidió hace 5 min», sin más datos).
--   · erp_landing_leads: quien escribió su WhatsApp pero no terminó, para
--     recuperarlo (con aviso de tratamiento de datos en el formulario).
--   · erp_landing_spend: inversión en pauta por día y red → ganancia real
--     (ventas − costo de la mercancía − pauta), retorno y costo por pedido.
--     El inventario va aparte usando un punto propio (ej. «Ventas online»)
--     con su catálogo: la landing vende y descuenta solo de ese punto.
--   · erp_landing_templates: plantillas propias (diseño y textos para reutilizar).
--   · erp_meta_capi: token de la API de Conversiones de Meta, CIFRADO por el
--     servidor (nadie lo lee desde el navegador).
--   · landing_order: crea el pedido con catalog_create_order (mismas reglas,
--     precios y existencias del catálogo) y aplica el paquete (2x, 3x), el
--     descuento por pagar en línea y el adicional de último momento.
-- Nada de datos inventados: personas viendo, unidades, vendidos y pedidos
-- recientes salen de la base. No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_landing_pages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'archived')),
  catalog_id uuid not null,
  product_ids uuid[] not null default '{}',
  config jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (store_id, slug)
);

create table if not exists public.erp_landing_visits (
  id bigint generated always as identity primary key,
  page_id uuid not null references public.erp_landing_pages(id) on delete cascade,
  store_id uuid not null,
  session_id text not null,
  day date not null default ((now() at time zone 'America/Bogota')::date),
  source text, medium text, campaign text, content text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  form_opened boolean not null default false,
  form_started boolean not null default false,
  ordered boolean not null default false,
  device text,
  max_scroll integer not null default 0,
  seconds integer not null default 0,
  cta_clicks integer not null default 0,
  unique (page_id, session_id)
);
-- Si la tabla ya existía sin las medidas de comportamiento.
alter table public.erp_landing_visits add column if not exists form_started boolean not null default false;
alter table public.erp_landing_visits add column if not exists device text;
alter table public.erp_landing_visits add column if not exists max_scroll integer not null default 0;
alter table public.erp_landing_visits add column if not exists seconds integer not null default 0;
alter table public.erp_landing_visits add column if not exists cta_clicks integer not null default 0;
alter table public.erp_landing_visits add column if not exists wa_clicks integer not null default 0;
alter table public.erp_landing_visits add column if not exists shares integer not null default 0;
create index if not exists erp_landing_visits_live on public.erp_landing_visits (page_id, last_seen);
create index if not exists erp_landing_visits_day on public.erp_landing_visits (page_id, day);

create table if not exists public.erp_landing_orders (
  order_id uuid primary key,
  page_id uuid not null references public.erp_landing_pages(id) on delete cascade,
  store_id uuid not null,
  session_id text,
  first_name text,
  city text,
  department text,
  units integer not null default 1,
  bundle_pct numeric not null default 0,
  payment text not null default 'cod',
  upsell boolean not null default false,
  total numeric not null default 0,
  wa_hash text,
  source text, campaign text,
  created_at timestamptz not null default now()
);
create index if not exists erp_landing_orders_page on public.erp_landing_orders (page_id, created_at desc);

create table if not exists public.erp_landing_leads (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.erp_landing_pages(id) on delete cascade,
  store_id uuid not null,
  session_id text not null,
  name text, whatsapp text, city text, selection text,
  status text not null default 'open' check (status in ('open', 'ordered', 'contacted', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, session_id)
);
create index if not exists erp_landing_leads_store on public.erp_landing_leads (store_id, status, created_at desc);

-- Inversión en pauta (la anota el equipo: por día y red). Con esto sale la ganancia real de cada landing.
create table if not exists public.erp_landing_spend (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.erp_landing_pages(id) on delete cascade,
  store_id uuid not null,
  day date not null,
  channel text not null default 'facebook',
  amount numeric not null check (amount > 0 and amount < 1000000000),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists erp_landing_spend_page on public.erp_landing_spend (page_id, day);

-- Plantillas propias de la tienda (diseño y textos de una landing para reutilizar).
create table if not exists public.erp_landing_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  emoji text not null default '⭐',
  config jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists public.erp_meta_capi (
  store_id uuid primary key references public.stores(id) on delete cascade,
  token_enc text,
  test_code text,
  last_ok_at timestamptz,
  last_error text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.erp_landing_pages enable row level security;
alter table public.erp_landing_visits enable row level security;
alter table public.erp_landing_orders enable row level security;
alter table public.erp_landing_leads enable row level security;
alter table public.erp_landing_spend enable row level security;
alter table public.erp_landing_templates enable row level security;
alter table public.erp_meta_capi enable row level security;
-- Sin políticas: todo pasa por las funciones de abajo (y el servidor para el token de Meta).

-- Pesos redondeados a $100 (igual que la landing en el navegador).
create or replace function public.erp__cop(v numeric)
returns numeric language sql immutable as $$
  select case when v >= 1000 then round(v / 100) * 100 else round(v) end
$$;

-- Precio y existencias del catálogo (tolerante a la forma exacta de catalog_public_stock).
create or replace function public.erp__landing_prices(p_store text, p_catalog text, p_key text, p_ids uuid[])
returns table (id uuid, price numeric, stock numeric)
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then return; end if;
  for r in select to_jsonb(x) from public.catalog_public_stock(p_store => p_store, p_catalog => p_catalog, p_key => p_key, p_ids => p_ids) x loop
    id := (coalesce(r ->> 'id', r ->> 'product_id'))::uuid;
    price := nullif(r ->> 'price', '')::numeric;
    stock := nullif(r ->> 'stock', '')::numeric;
    return next;
  end loop;
end $$;

-- Lo «social» real de una landing: personas viendo ahora, pedidos recientes y vendidos en 7 días.
create or replace function public.erp__landing_social(p_page uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', (select count(*) from public.erp_landing_visits v where v.page_id = p_page and v.last_seen > now() - interval '75 seconds'),
    'sold_week', (select coalesce(sum(lo.units), 0) from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id
                  where lo.page_id = p_page and lo.created_at > now() - interval '7 days' and coalesce(o.status, '') <> 'cancelled'),
    'recent', coalesce((select jsonb_agg(x order by x.at desc) from (
        select initcap(lo.first_name) as name, initcap(lo.city) as city, lo.units, lo.created_at as at,
               floor(extract(epoch from now() - lo.created_at) / 60)::integer as minutes
        from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id
        where lo.page_id = p_page and lo.created_at > now() - interval '72 hours' and coalesce(o.status, '') <> 'cancelled'
          and coalesce(lo.first_name, '') <> ''
        order by lo.created_at desc limit 8) x), '[]'::jsonb))
$$;

-- Página publicada + tienda + catálogo (para las funciones públicas).
create or replace function public.erp__landing_find(p_store text, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('store_id', s.id, 'store_slug', s.slug, 'store_name', s.name,
           'logo_url', to_jsonb(s) ->> 'logo_url', 'whatsapp', to_jsonb(s) ->> 'whatsapp',
           'page', to_jsonb(p), 'catalog_slug', c.slug, 'catalog_key', to_jsonb(c) ->> 'access_key')
  from public.stores s
  join public.erp_landing_pages p on p.store_id = s.id and p.slug = lower(btrim(p_slug)) and p.status = 'published'
  join public.store_catalogs c on c.id = p.catalog_id and c.store_id = s.id and coalesce((to_jsonb(c) ->> 'active')::boolean, true)
  where s.slug = btrim(p_store) and coalesce((to_jsonb(s) ->> 'active')::boolean, true)
  limit 1
$$;

create or replace function public.erp__landing_payments(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_w boolean := false; v_a boolean := false;
begin
  if to_regclass('public.store_payment_methods') is not null then
    execute 'select coalesce(bool_or(provider = ''wompi''), false), coalesce(bool_or(provider = ''addi''), false)
             from public.store_payment_methods where store_id = $1 and enabled and coalesce(show_on_invoice, true)'
      into v_w, v_a using p_store;
  end if;
  return jsonb_build_object('wompi', v_w, 'addi', v_a);
end $$;

-- Credibilidad con datos reales de la tienda: empresa y NIT (de Facturación), tiendas físicas,
-- desde cuándo vende, pedidos entregados y redes. Tolerante a tablas que una tienda no tenga.
create or replace function public.erp__landing_trust(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_bs jsonb; v_points jsonb := '[]'::jsonb; v_links jsonb := '[]'::jsonb; v_done bigint := 0; v_since integer;
begin
  if to_regclass('public.billing_settings') is not null then
    execute 'select to_jsonb(b) from public.billing_settings b where b.store_id = $1 limit 1' into v_bs using p_store;
  end if;
  if to_regclass('public.erp_warehouses') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'city', to_jsonb(w) ->> 'city', 'address', to_jsonb(w) ->> 'address') order by w.name), '[]'::jsonb)
             from (select * from public.erp_warehouses w where w.store_id = $1 and coalesce((to_jsonb(w) ->> 'active')::boolean, true)
                     and coalesce(to_jsonb(w) ->> 'kind', 'store') <> 'warehouse' and coalesce(nullif(btrim(to_jsonb(w) ->> 'address'), ''), '') <> '' limit 4) w$q$
      into v_points using p_store;
  end if;
  if to_regclass('public.store_links') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('type', l.type, 'url', l.url) order by l.sort_order), '[]'::jsonb)
             from (select * from public.store_links l where l.store_id = $1 and coalesce(l.active, true) and l.type in ('instagram', 'facebook', 'tiktok', 'youtube') and l.url ~ '^https://' limit 4) l$q$
      into v_links using p_store;
  end if;
  select count(*) into v_done from public.orders o where o.store_id = p_store and o.status in ('confirmed', 'completed');
  select extract(year from (to_jsonb(s) ->> 'created_at')::timestamptz)::integer into v_since from public.stores s where s.id = p_store;
  return jsonb_build_object(
    'business_name', nullif(btrim(coalesce(v_bs ->> 'business_name', '')), ''),
    'nit', nullif(btrim(coalesce(v_bs ->> 'nit', '')), ''),
    'points', v_points, 'links', v_links, 'orders_done', v_done, 'since', v_since);
end $$;

-- ---------------------------------------------------------------- lo público (sin sesión)
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
             'price', pr.price, 'stock', greatest(pr.stock, 0)) as j
    from public.products p join pr on pr.id = p.id
    where p.store_id = (f ->> 'store_id')::uuid and p.active and pr.price > 0
  )
  select coalesce(jsonb_agg(r.j order by array_position(pg.product_ids, r.id)) filter (where r.id = any(pg.product_ids)), '[]'::jsonb),
         (array_agg(r.j) filter (where r.id = v_up))[1]
    into v_items, v_upsell
  from rows r;
  v_pm := public.erp__landing_payments((f ->> 'store_id')::uuid);
  return jsonb_build_object('ok', true,
    'store', jsonb_build_object('id', f ->> 'store_id', 'slug', f ->> 'store_slug', 'name', f ->> 'store_name', 'logo_url', f ->> 'logo_url', 'whatsapp', f ->> 'whatsapp'),
    'page', jsonb_build_object('id', pg.id, 'slug', pg.slug, 'name', pg.name, 'config', v_cfg, 'catalog', f ->> 'catalog_slug'),
    'items', v_items,
    'upsell', v_upsell,
    'payments', jsonb_build_object(
      'cod', coalesce((v_cfg -> 'payments' ->> 'cod')::boolean, true),
      'online', coalesce((v_cfg -> 'payments' ->> 'online')::boolean, false) and (v_pm ->> 'wompi')::boolean,
      'addi', coalesce((v_cfg -> 'payments' ->> 'addi')::boolean, false) and (v_pm ->> 'addi')::boolean),
    'social', public.erp__landing_social(pg.id),
    'trust', public.erp__landing_trust((f ->> 'store_id')::uuid));
end;
$$;

-- Latido de la visita (cada ~25 s mientras la página está abierta). Devuelve lo social real.
create or replace function public.landing_ping(p_store text, p_slug text, p_session text, p_event text default 'beat', p_ref jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare f jsonb := public.erp__landing_find(p_store, p_slug); v_page uuid; v_ref jsonb := coalesce(p_ref, '{}'::jsonb);
  v_scroll integer; v_secs integer; v_cta integer;
begin
  if f is null then return jsonb_build_object('ok', false); end if;
  if coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false); end if;
  v_page := (f -> 'page' ->> 'id')::uuid;
  -- Comportamiento (lo manda la página): hasta dónde bajó (%), segundos, clics en comprar, si empezó a llenar.
  begin v_scroll := least(greatest(coalesce((v_ref ->> 'scroll')::integer, 0), 0), 100); exception when others then v_scroll := 0; end;
  begin v_secs := least(greatest(coalesce((v_ref ->> 'seconds')::integer, 0), 0), 7200); exception when others then v_secs := 0; end;
  begin v_cta := least(greatest(coalesce((v_ref ->> 'cta')::integer, 0), 0), 500); exception when others then v_cta := 0; end;
  insert into public.erp_landing_visits as v (page_id, store_id, session_id, source, medium, campaign, content, form_opened, form_started, device, max_scroll, seconds, cta_clicks, wa_clicks, shares)
  values (v_page, (f ->> 'store_id')::uuid, p_session,
          left(lower(nullif(btrim(v_ref ->> 'source'), '')), 60), left(nullif(btrim(v_ref ->> 'medium'), ''), 60),
          left(nullif(btrim(v_ref ->> 'campaign'), ''), 120), left(nullif(btrim(v_ref ->> 'content'), ''), 120),
          p_event in ('form', 'started'), p_event = 'started' or coalesce((v_ref ->> 'started')::boolean, false),
          case when v_ref ->> 'device' in ('mobile', 'desktop', 'tablet') then v_ref ->> 'device' end, v_scroll, v_secs, v_cta,
          case when p_event = 'whatsapp' then 1 else 0 end, case when p_event = 'share' then 1 else 0 end)
  on conflict (page_id, session_id) do update
    set last_seen = now(), form_opened = v.form_opened or excluded.form_opened, form_started = v.form_started or excluded.form_started,
        device = coalesce(v.device, excluded.device), max_scroll = greatest(v.max_scroll, excluded.max_scroll),
        seconds = greatest(v.seconds, excluded.seconds), cta_clicks = greatest(v.cta_clicks, excluded.cta_clicks),
        wa_clicks = v.wa_clicks + case when p_event = 'whatsapp' then 1 else 0 end,
        shares = v.shares + case when p_event = 'share' then 1 else 0 end;
  return jsonb_build_object('ok', true) || public.erp__landing_social(v_page);
end;
$$;

-- Quien escribió su WhatsApp pero aún no envía el pedido (para recuperarlo).
create or replace function public.landing_lead(p_store text, p_slug text, p_session text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare f jsonb := public.erp__landing_find(p_store, p_slug); v_wa text := regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g');
begin
  if f is null or coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('ok', false); end if;
  v_wa := regexp_replace(v_wa, '^57(?=3\d{9}$)', '');
  if v_wa !~ '^3\d{9}$' then return jsonb_build_object('ok', false, 'message', 'WhatsApp no válido.'); end if;
  insert into public.erp_landing_leads as l (page_id, store_id, session_id, name, whatsapp, city, selection)
  values ((f -> 'page' ->> 'id')::uuid, (f ->> 'store_id')::uuid, p_session, left(btrim(p ->> 'name'), 80), v_wa,
          left(btrim(p ->> 'city'), 80), left(btrim(p ->> 'selection'), 300))
  on conflict (page_id, session_id) do update
    set name = coalesce(nullif(excluded.name, ''), l.name), whatsapp = excluded.whatsapp, city = coalesce(nullif(excluded.city, ''), l.city),
        selection = coalesce(nullif(excluded.selection, ''), l.selection), updated_at = now()
    where l.status = 'open';
  return jsonb_build_object('ok', true);
end;
$$;

-- El pedido desde la landing.
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
    -- Sin paquete que coincida: solo se acepta 1 unidad si la landing no tiene paquetes (un pack x3 no se vende suelto).
    if v_n <> 1 or jsonb_array_length(coalesce(pg.config -> 'bundles', '[]'::jsonb)) > 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'Ese paquete ya no está disponible. Recarga la página.');
    end if;
    v_pct := 0;
  end if;
  v_pct := least(greatest(v_pct, 0), 90);

  -- Forma de pago
  v_pm := public.erp__landing_payments(pg.store_id);
  if v_pay = 'cod' and not coalesce((pg.config -> 'payments' ->> 'cod')::boolean, true)
     or v_pay = 'online' and not (coalesce((pg.config -> 'payments' ->> 'online')::boolean, false) and (v_pm ->> 'wompi')::boolean)
     or v_pay = 'addi' and not (coalesce((pg.config -> 'payments' ->> 'addi')::boolean, false) and (v_pm ->> 'addi')::boolean)
     or v_pay not in ('cod', 'online', 'addi') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION', 'field', 'payment', 'message', 'Elige otra forma de pago.');
  end if;
  -- Oferta de salida (descuento extra a las unidades del paquete, si la landing la tiene activa).
  if coalesce((p ->> 'exit')::boolean, false) and coalesce((pg.config -> 'exit_offer' ->> 'enabled')::boolean, false) then
    v_xpct := least(greatest(coalesce((pg.config -> 'exit_offer' ->> 'pct')::numeric, 0), 0), 30);
  end if;
  if v_pay = 'online' then v_opct := least(greatest(coalesce((pg.config -> 'payments' ->> 'online_pct')::numeric, 0), 0), 30); end if;

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
    '💳 Pago: ' || case v_pay when 'cod' then 'Contraentrega (paga al recibir)' when 'online' then 'En línea (Wompi)' || case when v_opct > 0 then format(' −%s%%', v_opct) else '' end else 'A cuotas con Addi' end,
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

  -- Paquete, pago en línea y adicional: sobre el precio que puso el catálogo.
  if v_pct > 0 or v_opct > 0 or v_xpct > 0 or (v_up is not null and v_up_pct > 0) then
    update public.order_items oi
       set price = public.erp__cop(oi.price * (1 - (case when oi.product_id = v_up then v_up_pct else v_pct end) / 100.0)
                                   * (1 - (case when oi.product_id = v_up then 0 else v_xpct end) / 100.0) * (1 - v_opct / 100.0))
     where oi.order_id = v_order
       -- Sin descuento para esa línea, el precio queda igual (no se redondea).
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
    'total', v_total, 'payment', v_pay, 'store_id', pg.store_id, 'event_id', (f ->> 'store_slug') || '-' || coalesce(v_res ->> 'receipt_no', v_order::text),
    'items', (select jsonb_agg(jsonb_build_object('id', oi.product_id, 'name', pd.name, 'price', oi.price, 'quantity', oi.quantity))
              from public.order_items oi left join public.products pd on pd.id = oi.product_id where oi.order_id = v_order));
end;
$$;

-- ---------------------------------------------------------------- el panel (permiso de productos y catálogos)
create or replace function public.erp_landing_list(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de productos y catálogos.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'slug', p.slug, 'name', p.name, 'status', p.status, 'catalog_id', p.catalog_id, 'catalog_slug', c.slug,
             'product_ids', p.product_ids, 'image', (select pr.image_url from public.products pr where pr.id = p.product_ids[1]),
             'updated_at', p.updated_at, 'published_at', p.published_at,
             'visits_7d', (select count(*) from public.erp_landing_visits v where v.page_id = p.id and v.first_seen > now() - interval '7 days'),
             'orders_7d', (select count(*) from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id where lo.page_id = p.id and lo.created_at > now() - interval '7 days' and coalesce(o.status, '') <> 'cancelled'),
             'revenue_7d', (select coalesce(sum(o.total), 0) from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id where lo.page_id = p.id and lo.created_at > now() - interval '7 days' and coalesce(o.status, '') <> 'cancelled'),
             'wa_7d', (select coalesce(sum(v.wa_clicks), 0) from public.erp_landing_visits v where v.page_id = p.id and v.first_seen > now() - interval '7 days'),
             'spend_7d', (select coalesce(sum(x.amount), 0) from public.erp_landing_spend x where x.page_id = p.id and x.day > (now() at time zone 'America/Bogota')::date - 7),
             'leads_open', (select count(*) from public.erp_landing_leads l where l.page_id = p.id and l.status = 'open' and l.created_at > now() - interval '30 days'),
             'live', (select count(*) from public.erp_landing_visits v where v.page_id = p.id and v.last_seen > now() - interval '75 seconds'))
           order by p.status = 'archived', p.updated_at desc)
    from public.erp_landing_pages p left join public.store_catalogs c on c.id = p.catalog_id
    where p.store_id = p_store), '[]'::jsonb));
end;
$$;

create or replace function public.erp_landing_get(p_store uuid, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not public.erp_can(p_store, 'products') then jsonb_build_object('ok', false, 'message', 'Sin permiso.')
    else coalesce((select jsonb_build_object('ok', true, 'page', to_jsonb(p)) from public.erp_landing_pages p where p.id = p_id and p.store_id = p_store),
                  jsonb_build_object('ok', false, 'message', 'No existe esa landing.')) end
$$;

create or replace function public.erp_landing_save(p_store uuid, p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := lower(btrim(coalesce(p ->> 'slug', '')));
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_status text := coalesce(p ->> 'status', 'draft');
  v_cat uuid;
  v_ids uuid[];
  v_cfg jsonb := coalesce(p -> 'config', '{}'::jsonb);
  v_up text;
  v_id uuid := p_id;
  v_old public.erp_landing_pages;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de productos y catálogos.'); end if;
  if v_name = '' then return jsonb_build_object('ok', false, 'field', 'name', 'message', 'Ponle un nombre a la landing.'); end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,59}$' then return jsonb_build_object('ok', false, 'field', 'slug', 'message', 'El enlace solo lleva letras, números y guiones (mínimo 2).'); end if;
  if v_status not in ('draft', 'published', 'paused') then return jsonb_build_object('ok', false, 'message', 'Estado no válido.'); end if;
  if jsonb_typeof(v_cfg) <> 'object' or length(v_cfg::text) > 200000 then return jsonb_build_object('ok', false, 'message', 'La configuración es muy grande.'); end if;
  begin v_cat := (p ->> 'catalog_id')::uuid; exception when others then v_cat := null; end;
  if v_cat is null or not exists (select 1 from public.store_catalogs c where c.id = v_cat and c.store_id = p_store) then
    return jsonb_build_object('ok', false, 'field', 'catalog_id', 'message', 'Elige el catálogo que pone el precio y las existencias.');
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_ids
  from jsonb_array_elements_text(case when jsonb_typeof(p -> 'product_ids') = 'array' then p -> 'product_ids' else '[]'::jsonb end) x
  where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  -- Se respeta el orden en que se eligieron.
  select coalesce(array_agg(x::uuid order by o), '{}') into v_ids
  from (select x, min(o) o from jsonb_array_elements_text(p -> 'product_ids') with ordinality t(x, o) where x::text = any(v_ids::text[]) group by x) s;
  if coalesce(array_length(v_ids, 1), 0) = 0 then return jsonb_build_object('ok', false, 'field', 'product_ids', 'message', 'Elige el producto (y sus opciones, si tiene).'); end if;
  if array_length(v_ids, 1) > 30 then return jsonb_build_object('ok', false, 'field', 'product_ids', 'message', 'Máximo 30 opciones por landing.'); end if;
  if (select count(*) from public.products pr where pr.id = any(v_ids) and pr.store_id = p_store) <> array_length(v_ids, 1) then
    return jsonb_build_object('ok', false, 'field', 'product_ids', 'message', 'Uno de los productos no es de esta tienda.');
  end if;
  v_up := v_cfg -> 'upsell' ->> 'product_id';
  if coalesce((v_cfg -> 'upsell' ->> 'enabled')::boolean, false) then
    if coalesce(v_up, '') !~* '^[0-9a-f-]{36}$' or not exists (select 1 from public.products pr where pr.id = v_up::uuid and pr.store_id = p_store) then
      return jsonb_build_object('ok', false, 'field', 'upsell', 'message', 'Elige el producto del adicional de último momento.');
    end if;
    if v_up::uuid = any(v_ids) then return jsonb_build_object('ok', false, 'field', 'upsell', 'message', 'El adicional debe ser otro producto (no una de las opciones).'); end if;
  end if;
  if v_status = 'published' and not (coalesce((v_cfg -> 'payments' ->> 'cod')::boolean, true) or coalesce((v_cfg -> 'payments' ->> 'online')::boolean, false) or coalesce((v_cfg -> 'payments' ->> 'addi')::boolean, false)) then
    return jsonb_build_object('ok', false, 'field', 'payments', 'message', 'Activa al menos una forma de pago.');
  end if;
  if exists (select 1 from public.erp_landing_pages x where x.store_id = p_store and x.slug = v_slug and x.id is distinct from p_id) then
    return jsonb_build_object('ok', false, 'field', 'slug', 'message', 'Ya tienes otra landing con ese enlace.');
  end if;

  if p_id is null then
    insert into public.erp_landing_pages (store_id, slug, name, status, catalog_id, product_ids, config, created_by, updated_by, published_at)
    values (p_store, v_slug, v_name, v_status, v_cat, v_ids, v_cfg, auth.uid(), auth.uid(), case when v_status = 'published' then now() end)
    returning id into v_id;
  else
    select * into v_old from public.erp_landing_pages where id = p_id and store_id = p_store for update;
    if v_old.id is null then return jsonb_build_object('ok', false, 'message', 'No existe esa landing.'); end if;
    update public.erp_landing_pages
       set slug = v_slug, name = v_name, status = v_status, catalog_id = v_cat, product_ids = v_ids, config = v_cfg,
           updated_by = auth.uid(), updated_at = now(),
           published_at = case when v_status = 'published' and v_old.status <> 'published' then now() else published_at end
     where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_landing_set_status(p_store uuid, p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  if p_status not in ('draft', 'published', 'paused', 'archived') then return jsonb_build_object('ok', false, 'message', 'Estado no válido.'); end if;
  update public.erp_landing_pages set status = p_status, updated_by = auth.uid(), updated_at = now(),
         published_at = case when p_status = 'published' and status <> 'published' then now() else published_at end
   where id = p_id and store_id = p_store;
  return jsonb_build_object('ok', found);
end;
$$;

-- Duplicar: misma configuración, en borrador y con otro enlace.
create or replace function public.erp_landing_duplicate(p_store uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare src public.erp_landing_pages; v_slug text; v_i integer := 2; v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  select * into src from public.erp_landing_pages where id = p_id and store_id = p_store;
  if src.id is null then return jsonb_build_object('ok', false, 'message', 'No existe esa landing.'); end if;
  loop
    v_slug := left(regexp_replace(src.slug, '-\d+$', ''), 55) || '-' || v_i;
    exit when not exists (select 1 from public.erp_landing_pages where store_id = p_store and slug = v_slug);
    v_i := v_i + 1;
  end loop;
  insert into public.erp_landing_pages (store_id, slug, name, status, catalog_id, product_ids, config, created_by, updated_by)
  values (p_store, v_slug, left(src.name || ' (copia)', 120), 'draft', src.catalog_id, src.product_ids, src.config, auth.uid(), auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'slug', v_slug);
end;
$$;

-- Borrar solo si nunca tuvo pedidos; si tuvo, se archiva (los pedidos y sus datos se conservan).
create or replace function public.erp_landing_delete(p_store uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  if exists (select 1 from public.erp_landing_orders where page_id = p_id) then
    update public.erp_landing_pages set status = 'archived', updated_by = auth.uid(), updated_at = now() where id = p_id and store_id = p_store;
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from public.erp_landing_pages where id = p_id and store_id = p_store;
  return jsonb_build_object('ok', found, 'archived', false);
end;
$$;

-- Costo de la mercancía vendida por la landing (último costo del producto; si no, el costo guardado).
create or replace function public.erp__landing_cost(p_page uuid, p_from date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(oi.quantity * coalesce(nullif(to_jsonb(pd) ->> 'last_cost', '')::numeric, nullif(to_jsonb(pd) ->> 'cost_price', '')::numeric, 0)), 0)
  from public.erp_landing_orders lo
  join public.orders o on o.id = lo.order_id and coalesce(o.status, '') <> 'cancelled'
  join public.order_items oi on oi.order_id = lo.order_id
  left join public.products pd on pd.id = oi.product_id
  where lo.page_id = p_page and (lo.created_at at time zone 'America/Bogota')::date >= p_from
$$;

-- Resultados de una landing en un periodo: visitas, interacción, ventas, pauta, costo y ganancia.
create or replace function public.erp__landing_money(p_page uuid, p_from date, p_costs boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  with v as (select count(*) visits, count(*) filter (where wa_clicks > 0) wa_people, coalesce(sum(wa_clicks), 0) wa_clicks,
                    coalesce(sum(shares), 0) shares, count(*) filter (where max_scroll >= 50 or form_opened or wa_clicks > 0 or cta_clicks > 0) engaged
             from public.erp_landing_visits where page_id = p_page and day >= p_from),
  o as (select count(*) orders, coalesce(sum(o.total), 0) revenue, count(*) filter (where o.status in ('confirmed', 'completed')) confirmed,
               coalesce(sum(o.total) filter (where o.status in ('confirmed', 'completed')), 0) revenue_confirmed
        from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id
        where lo.page_id = p_page and (lo.created_at at time zone 'America/Bogota')::date >= p_from and coalesce(o.status, '') <> 'cancelled'),
  sp as (select coalesce(sum(amount), 0) spend from public.erp_landing_spend where page_id = p_page and day >= p_from)
  select jsonb_build_object('visits', v.visits, 'wa_people', v.wa_people, 'wa_clicks', v.wa_clicks, 'shares', v.shares, 'engaged', v.engaged,
           'orders', o.orders, 'confirmed', o.confirmed, 'revenue', o.revenue, 'revenue_confirmed', o.revenue_confirmed, 'spend', sp.spend,
           'cost', case when p_costs then public.erp__landing_cost(p_page, p_from) end,
           'profit', case when p_costs then o.revenue - public.erp__landing_cost(p_page, p_from) - sp.spend end,
           'roas', case when sp.spend > 0 then round(o.revenue / sp.spend, 2) end,
           'cpa', case when o.orders > 0 and sp.spend > 0 then round(sp.spend / o.orders) end)
  from v, o, sp
$$;

-- Todas las landings juntas, como un negocio aparte.
create or replace function public.erp_landing_summary(p_store uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := (now() at time zone 'America/Bogota')::date - (least(greatest(coalesce(p_days, 30), 1), 365) - 1);
  v_costs boolean;
  v_rows jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  v_costs := public.erp_can(p_store, 'costs_view');
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug, 'status', p.status) || public.erp__landing_money(p.id, v_from, v_costs) order by p.updated_at desc), '[]'::jsonb)
    into v_rows from public.erp_landing_pages p where p.store_id = p_store and p.status <> 'archived';
  return jsonb_build_object('ok', true, 'from', v_from, 'costs', v_costs, 'items', v_rows,
    'totals', (select jsonb_build_object(
      'visits', coalesce(sum((x ->> 'visits')::numeric), 0), 'wa_people', coalesce(sum((x ->> 'wa_people')::numeric), 0),
      'wa_clicks', coalesce(sum((x ->> 'wa_clicks')::numeric), 0), 'shares', coalesce(sum((x ->> 'shares')::numeric), 0),
      'engaged', coalesce(sum((x ->> 'engaged')::numeric), 0), 'orders', coalesce(sum((x ->> 'orders')::numeric), 0),
      'confirmed', coalesce(sum((x ->> 'confirmed')::numeric), 0), 'revenue', coalesce(sum((x ->> 'revenue')::numeric), 0),
      'spend', coalesce(sum((x ->> 'spend')::numeric), 0),
      'cost', case when v_costs then coalesce(sum((x ->> 'cost')::numeric), 0) end,
      'profit', case when v_costs then coalesce(sum((x ->> 'profit')::numeric), 0) end)
      from jsonb_array_elements(v_rows) x));
end;
$$;

create or replace function public.erp_landing_spend_save(p_store uuid, p_page uuid, p_day date, p_amount numeric, p_channel text default 'facebook', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  if not exists (select 1 from public.erp_landing_pages where id = p_page and store_id = p_store) then return jsonb_build_object('ok', false, 'message', 'No existe esa landing.'); end if;
  if p_day is null or p_day > (now() at time zone 'America/Bogota')::date then return jsonb_build_object('ok', false, 'message', 'La fecha no puede ser futura.'); end if;
  if coalesce(p_amount, 0) <= 0 then return jsonb_build_object('ok', false, 'message', 'Escribe cuánto invertiste.'); end if;
  insert into public.erp_landing_spend (page_id, store_id, day, channel, amount, note, created_by)
  values (p_page, p_store, p_day, left(coalesce(nullif(btrim(p_channel), ''), 'facebook'), 30), round(p_amount), left(nullif(btrim(p_note), ''), 200), auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_landing_spend_delete(p_store uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  delete from public.erp_landing_spend where id = p_id and store_id = p_store;
  return jsonb_build_object('ok', found);
end;
$$;

create or replace function public.erp_landing_templates_list(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or not public.erp_can(p_store, 'products') then jsonb_build_object('ok', false)
    else jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'emoji', t.emoji, 'config', t.config) order by t.created_at desc)
                                                         from public.erp_landing_templates t where t.store_id = p_store), '[]'::jsonb)) end
$$;

-- Guarda el diseño y los textos (sin fotos de producto ni píxeles: eso es de cada landing).
create or replace function public.erp_landing_template_save(p_store uuid, p_name text, p_emoji text, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_cfg jsonb := coalesce(p_config, '{}'::jsonb) - 'images' - 'option_names' - 'meta_pixel_id' - 'tiktok_pixel_id' - 'upsell' - 'compare_at_price' - 'promo_ends_at';
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then return jsonb_build_object('ok', false, 'message', 'Ponle un nombre a la plantilla.'); end if;
  if jsonb_typeof(v_cfg) <> 'object' or length(v_cfg::text) > 200000 then return jsonb_build_object('ok', false, 'message', 'La plantilla es muy grande.'); end if;
  if (select count(*) from public.erp_landing_templates where store_id = p_store) >= 50 then return jsonb_build_object('ok', false, 'message', 'Máximo 50 plantillas por tienda.'); end if;
  insert into public.erp_landing_templates (store_id, name, emoji, config, created_by)
  values (p_store, left(btrim(p_name), 80), left(coalesce(nullif(btrim(p_emoji), ''), '⭐'), 8), v_cfg, auth.uid())
  on conflict (store_id, name) do update set emoji = excluded.emoji, config = excluded.config
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_landing_template_delete(p_store uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  delete from public.erp_landing_templates where id = p_id and store_id = p_store;
  return jsonb_build_object('ok', found);
end;
$$;

create or replace function public.erp_landing_stats(p_store uuid, p_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_days integer := least(greatest(coalesce(p_days, 30), 1), 365); v_from date := (now() at time zone 'America/Bogota')::date - (least(greatest(coalesce(p_days, 30), 1), 365) - 1);
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  if not exists (select 1 from public.erp_landing_pages where id = p_id and store_id = p_store) then return jsonb_build_object('ok', false, 'message', 'No existe esa landing.'); end if;
  return jsonb_build_object('ok', true, 'days', v_days,
    'money', public.erp__landing_money(p_id, v_from, public.erp_can(p_store, 'costs_view')),
    'spend', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'day', x.day, 'channel', x.channel, 'amount', x.amount, 'note', x.note) order by x.day desc, x.created_at desc)
                       from public.erp_landing_spend x where x.page_id = p_id and x.day >= v_from), '[]'::jsonb),
    'totals', (select jsonb_build_object(
        'visits', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from),
        'form', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and (v.form_opened or v.ordered)),
        'started', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and (v.form_started or v.ordered)),
        'scroll50', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and v.max_scroll >= 50),
        'scroll90', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and v.max_scroll >= 90),
        'bounce', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and v.seconds < 10 and v.max_scroll < 25 and not v.form_opened),
        'avg_seconds', (select coalesce(round(avg(v.seconds)), 0) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and v.seconds > 0),
        'mobile', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and v.device = 'mobile'),
        'desktop', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from and v.device = 'desktop'),
        'orders', count(*), 'units', coalesce(sum(lo.units), 0), 'revenue', coalesce(sum(o.total), 0),
        'upsells', count(*) filter (where lo.upsell),
        'cod', count(*) filter (where lo.payment = 'cod'), 'online', count(*) filter (where lo.payment = 'online'), 'addi', count(*) filter (where lo.payment = 'addi'),
        'confirmed', count(*) filter (where o.status in ('confirmed', 'completed')),
        'leads', (select count(*) from public.erp_landing_leads l where l.page_id = p_id and l.created_at::date >= v_from),
        'live', (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.last_seen > now() - interval '75 seconds'))
      from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id
      where lo.page_id = p_id and (lo.created_at at time zone 'America/Bogota')::date >= v_from and coalesce(o.status, '') <> 'cancelled'),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'visits', d.visits, 'orders', d.orders, 'revenue', d.revenue,
        'spend', (select coalesce(sum(x.amount), 0) from public.erp_landing_spend x where x.page_id = p_id and x.day = d.day)) order by d.day) from (
        select g::date as day,
               (select count(*) from public.erp_landing_visits v where v.page_id = p_id and v.day = g::date) visits,
               (select count(*) from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id where lo.page_id = p_id and (lo.created_at at time zone 'America/Bogota')::date = g::date and coalesce(o.status, '') <> 'cancelled') orders,
               (select coalesce(sum(o.total), 0) from public.erp_landing_orders lo join public.orders o on o.id = lo.order_id where lo.page_id = p_id and (lo.created_at at time zone 'America/Bogota')::date = g::date and coalesce(o.status, '') <> 'cancelled') revenue
        from generate_series(v_from, (now() at time zone 'America/Bogota')::date, interval '1 day') g) d), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(s order by s.visits desc) from (
        select coalesce(v.source, 'directo') as source, count(*) visits, count(*) filter (where v.ordered) orders,
               count(*) filter (where v.form_opened or v.ordered) form, coalesce(round(avg(nullif(v.seconds, 0))), 0) avg_seconds,
               coalesce(sum(v.wa_clicks), 0) wa_clicks
        from public.erp_landing_visits v where v.page_id = p_id and v.day >= v_from group by 1) s), '[]'::jsonb),
    'leads', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'whatsapp', l.whatsapp, 'city', l.city, 'selection', l.selection, 'status', l.status, 'at', l.updated_at) order by l.updated_at desc)
        from (select * from public.erp_landing_leads l where l.page_id = p_id and l.status in ('open', 'contacted') and l.created_at > now() - interval '30 days' order by l.updated_at desc limit 100) l), '[]'::jsonb));
end;
$$;

create or replace function public.erp_landing_lead_mark(p_store uuid, p_lead uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return jsonb_build_object('ok', false, 'message', 'Sin permiso.'); end if;
  if p_status not in ('open', 'contacted', 'discarded') then return jsonb_build_object('ok', false, 'message', 'Estado no válido.'); end if;
  update public.erp_landing_leads set status = p_status, updated_at = now() where id = p_lead and store_id = p_store and status <> 'ordered';
  return jsonb_build_object('ok', found);
end;
$$;

-- Estado de la API de Conversiones (sin el token).
create or replace function public.erp_meta_capi_status(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not public.erp_can(p_store, 'products') then jsonb_build_object('ok', false)
    else jsonb_build_object('ok', true, 'configured', coalesce(m.token_enc, '') <> '', 'test_code', m.test_code, 'last_ok_at', m.last_ok_at, 'last_error', m.last_error,
           'updated_at', m.updated_at, 'is_owner', exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())) end
  from (select 1) x left join public.erp_meta_capi m on m.store_id = p_store
$$;

revoke all on function public.erp__cop(numeric) from public, anon;
revoke all on function public.erp__landing_prices(text, text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.erp__landing_social(uuid) from public, anon, authenticated;
revoke all on function public.erp__landing_find(text, text) from public, anon, authenticated;
revoke all on function public.erp__landing_payments(uuid) from public, anon, authenticated;
revoke all on function public.erp__landing_trust(uuid) from public, anon, authenticated;
revoke all on function public.erp__landing_cost(uuid, date) from public, anon, authenticated;
revoke all on function public.erp__landing_money(uuid, date, boolean) from public, anon, authenticated;
revoke all on function public.erp_landing_summary(uuid, integer) from public, anon;
revoke all on function public.erp_landing_spend_save(uuid, uuid, date, numeric, text, text) from public, anon;
revoke all on function public.erp_landing_spend_delete(uuid, uuid) from public, anon;
grant execute on function public.erp_landing_summary(uuid, integer) to authenticated;
revoke all on function public.erp_landing_templates_list(uuid) from public, anon;
revoke all on function public.erp_landing_template_save(uuid, text, text, jsonb) from public, anon;
revoke all on function public.erp_landing_template_delete(uuid, uuid) from public, anon;
grant execute on function public.erp_landing_templates_list(uuid) to authenticated;
grant execute on function public.erp_landing_template_save(uuid, text, text, jsonb) to authenticated;
grant execute on function public.erp_landing_template_delete(uuid, uuid) to authenticated;
grant execute on function public.erp_landing_spend_save(uuid, uuid, date, numeric, text, text) to authenticated;
grant execute on function public.erp_landing_spend_delete(uuid, uuid) to authenticated;
grant execute on function public.erp__cop(numeric) to authenticated, service_role;
grant execute on function public.landing_public(text, text) to anon, authenticated, service_role;
grant execute on function public.landing_ping(text, text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.landing_lead(text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.landing_order(text, text, text, jsonb) to anon, authenticated, service_role;
revoke all on function public.erp_landing_list(uuid) from public, anon;
revoke all on function public.erp_landing_get(uuid, uuid) from public, anon;
revoke all on function public.erp_landing_save(uuid, uuid, jsonb) from public, anon;
revoke all on function public.erp_landing_set_status(uuid, uuid, text) from public, anon;
revoke all on function public.erp_landing_duplicate(uuid, uuid) from public, anon;
revoke all on function public.erp_landing_delete(uuid, uuid) from public, anon;
revoke all on function public.erp_landing_stats(uuid, uuid, integer) from public, anon;
revoke all on function public.erp_landing_lead_mark(uuid, uuid, text) from public, anon;
revoke all on function public.erp_meta_capi_status(uuid) from public, anon;
grant execute on function public.erp_landing_list(uuid) to authenticated;
grant execute on function public.erp_landing_get(uuid, uuid) to authenticated;
grant execute on function public.erp_landing_save(uuid, uuid, jsonb) to authenticated;
grant execute on function public.erp_landing_set_status(uuid, uuid, text) to authenticated;
grant execute on function public.erp_landing_duplicate(uuid, uuid) to authenticated;
grant execute on function public.erp_landing_delete(uuid, uuid) to authenticated;
grant execute on function public.erp_landing_stats(uuid, uuid, integer) to authenticated;
grant execute on function public.erp_landing_lead_mark(uuid, uuid, text) to authenticated;
grant execute on function public.erp_meta_capi_status(uuid) to authenticated;
