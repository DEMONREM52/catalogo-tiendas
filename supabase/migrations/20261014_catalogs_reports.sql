-- =====================================================================
-- REMHUB · Catálogos múltiples, informes y notificaciones
--
-- Catálogos (RemHub Social → Catálogos)
--   · Cada tienda crea los catálogos que quiera (ej. "Detal" con Precio 3,
--     "Mayor" con Precio 2, "Hueco en tu casa" con Precio 5, "San Roque" con
--     Precio 4), cada uno con su enlace /<tienda>/<catalogo>.
--   · Cada catálogo tiene logo, portada, tema, contactos de WhatsApp,
--     "Encuéntranos", redes, campañas, categorías y productos propios.
--   · Si el catálogo se asocia a un punto/bodega, muestra y vende SOLO las
--     existencias de ese punto y sus pedidos se descuentan de ahí.
--   · Los precios de los pedidos se calculan en el servidor (no se confía
--     en el navegador).
--   · Los enlaces actuales /detal y /mayor siguen funcionando igual; si
--     creas un catálogo con slug "detal" o "mayor", ese catálogo los reemplaza.
--
-- Informes y notificaciones (Dashboard → Inicio)
--   · erp_report: ventas, ganancia estimada, pedidos, ticket, productos,
--     clientes, vendedores, puntos, catálogos, inventario, compras,
--     cuentas por pagar y traslados en cualquier rango de fechas.
--   · erp_alerts: avisos (agotados, cuentas vencidas, traslados demorados,
--     pedidos pendientes, vencimiento del plan, etc.).
--
-- Permisos: catálogos = permiso "Productos"; informes = permiso "Auditoría".
-- Ejecutar DESPUÉS de las migraciones anteriores (20261008 en adelante).
-- Es idempotente: se puede ejecutar varias veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------
create table if not exists public.store_catalogs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  slug text not null,
  name text not null,
  headline text,
  description text,
  logo_url text,
  banner_url text,
  theme text,
  price_level smallint not null default 3,
  fallback_price_level smallint,
  wholesale_rules boolean not null default false,
  access_key text,
  point_id uuid references public.erp_warehouses(id) on delete set null,
  include_all_products boolean not null default true,
  show_stock boolean not null default true,
  whatsapp text,
  contact_channels jsonb not null default '[]'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  address text,
  city text,
  phone text,
  email text,
  footer_note text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_catalogs_unique_slug unique (store_id, slug),
  constraint store_catalogs_slug_check check (
    slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'
    and slug not in ('producto', 'pedido', 'acceso', 'dashboard', 'admin', 'api', 'login', 'traslado', 'comprobante')
  ),
  constraint store_catalogs_name_check check (char_length(btrim(name)) between 2 and 80),
  constraint store_catalogs_price_check check (
    price_level between 1 and 5 and (fallback_price_level is null or fallback_price_level between 1 and 5)
  ),
  constraint store_catalogs_json_check check (
    jsonb_typeof(contact_channels) = 'array' and jsonb_typeof(locations) = 'array' and jsonb_typeof(links) = 'array'
  )
);
create index if not exists store_catalogs_store on public.store_catalogs (store_id, sort_order);

create table if not exists public.store_catalog_categories (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.store_catalogs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete cascade,
  name text,
  image_url text,
  sort_order integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  constraint store_catalog_categories_name_check check (
    category_id is not null or char_length(btrim(coalesce(name, ''))) >= 2
  )
);
create unique index if not exists store_catalog_categories_base
  on public.store_catalog_categories (catalog_id, category_id) where category_id is not null;
create index if not exists store_catalog_categories_catalog on public.store_catalog_categories (catalog_id, sort_order);

create table if not exists public.store_catalog_products (
  catalog_id uuid not null references public.store_catalogs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  included boolean not null default true,
  price_override numeric check (price_override is null or price_override >= 0),
  catalog_category_id uuid references public.store_catalog_categories(id) on delete set null,
  featured boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (catalog_id, product_id)
);
create index if not exists store_catalog_products_product on public.store_catalog_products (product_id);

create table if not exists public.store_catalog_orders (
  order_id uuid primary key references public.orders(id) on delete cascade,
  catalog_id uuid references public.store_catalogs(id) on delete set null,
  store_id uuid not null references public.stores(id) on delete cascade,
  catalog_name text,
  created_at timestamptz not null default now()
);
create index if not exists store_catalog_orders_catalog on public.store_catalog_orders (store_id, catalog_id);

-- Campañas: vacío = se muestra en todos los catálogos (comportamiento anterior).
alter table public.store_social_campaigns add column if not exists catalog_ids uuid[] not null default '{}'::uuid[];

-- ---------------------------------------------------------------------
-- 2. Integridad: todo debe pertenecer a la misma tienda
-- ---------------------------------------------------------------------
create or replace function public.store_catalogs_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.slug := lower(btrim(new.slug));
  new.name := btrim(new.name);
  new.access_key := nullif(btrim(coalesce(new.access_key, '')), '');
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.store_id is distinct from old.store_id then
    raise exception 'Un catálogo no se puede mover a otra tienda.';
  end if;
  if new.point_id is not null and not exists (
    select 1 from public.erp_warehouses w where w.id = new.point_id and w.store_id = new.store_id
  ) then
    raise exception 'El punto o bodega elegido no pertenece a esta tienda.';
  end if;
  return new;
end;
$$;
drop trigger if exists store_catalogs_guard on public.store_catalogs;
create trigger store_catalogs_guard before insert or update on public.store_catalogs
  for each row execute function public.store_catalogs_guard();

create or replace function public.store_catalog_categories_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_store uuid;
begin
  select store_id into v_store from public.store_catalogs where id = new.catalog_id;
  if v_store is null then raise exception 'Catálogo no encontrado.'; end if;
  new.store_id := v_store;
  new.name := nullif(btrim(coalesce(new.name, '')), '');
  if new.category_id is not null and not exists (
    select 1 from public.product_categories pc where pc.id = new.category_id and pc.store_id = v_store
  ) then
    raise exception 'La categoría no pertenece a esta tienda.';
  end if;
  return new;
end;
$$;
drop trigger if exists store_catalog_categories_guard on public.store_catalog_categories;
create trigger store_catalog_categories_guard before insert or update on public.store_catalog_categories
  for each row execute function public.store_catalog_categories_guard();

create or replace function public.store_catalog_products_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_store uuid;
begin
  select store_id into v_store from public.store_catalogs where id = new.catalog_id;
  if v_store is null then raise exception 'Catálogo no encontrado.'; end if;
  new.store_id := v_store;
  new.updated_at := now();
  if not exists (select 1 from public.products p where p.id = new.product_id and p.store_id = v_store) then
    raise exception 'El producto no pertenece a esta tienda.';
  end if;
  if new.catalog_category_id is not null and not exists (
    select 1 from public.store_catalog_categories cc where cc.id = new.catalog_category_id and cc.catalog_id = new.catalog_id
  ) then
    raise exception 'La categoría elegida no es de este catálogo.';
  end if;
  return new;
end;
$$;
drop trigger if exists store_catalog_products_guard on public.store_catalog_products;
create trigger store_catalog_products_guard before insert or update on public.store_catalog_products
  for each row execute function public.store_catalog_products_guard();

-- ---------------------------------------------------------------------
-- 3. Seguridad (RLS). El público solo accede por las funciones catalog_public*.
-- ---------------------------------------------------------------------
alter table public.store_catalogs enable row level security;
alter table public.store_catalog_categories enable row level security;
alter table public.store_catalog_products enable row level security;
alter table public.store_catalog_orders enable row level security;

drop policy if exists store_catalogs_read on public.store_catalogs;
create policy store_catalogs_read on public.store_catalogs for select to authenticated
  using (public.erp_can(store_id, 'products') or public.erp_can(store_id, 'audit') or public.erp_can(store_id, 'orders'));
drop policy if exists store_catalogs_write on public.store_catalogs;
create policy store_catalogs_write on public.store_catalogs for all to authenticated
  using (public.erp_can(store_id, 'products')) with check (public.erp_can(store_id, 'products'));

drop policy if exists store_catalog_categories_all on public.store_catalog_categories;
create policy store_catalog_categories_all on public.store_catalog_categories for all to authenticated
  using (public.erp_can(store_id, 'products')) with check (public.erp_can(store_id, 'products'));

drop policy if exists store_catalog_products_all on public.store_catalog_products;
create policy store_catalog_products_all on public.store_catalog_products for all to authenticated
  using (public.erp_can(store_id, 'products')) with check (public.erp_can(store_id, 'products'));

drop policy if exists store_catalog_orders_read on public.store_catalog_orders;
create policy store_catalog_orders_read on public.store_catalog_orders for select to authenticated
  using (public.erp_can(store_id, 'orders') or public.erp_can(store_id, 'audit') or public.erp_can(store_id, 'pos'));
revoke insert, update, delete on public.store_catalog_orders from anon, authenticated;
revoke all on public.store_catalogs, public.store_catalog_categories, public.store_catalog_products, public.store_catalog_orders from anon;

-- Imágenes de catálogos: store-assets/<tienda>/catalogs/<catalogo>/...
create or replace function public.catalog_can_manage_asset(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_parts text[] := storage.foldername(p_name); v_store uuid; v_catalog uuid;
begin
  if coalesce(array_length(v_parts, 1), 0) < 3 or v_parts[2] <> 'catalogs' then return false; end if;
  if v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_store := v_parts[1]::uuid;
  v_catalog := v_parts[3]::uuid;
  if not exists (select 1 from public.store_catalogs where id = v_catalog and store_id = v_store) then return false; end if;
  return public.erp_can(v_store, 'products');
end;
$$;
grant execute on function public.catalog_can_manage_asset(text) to authenticated;

drop policy if exists store_catalog_assets_select on storage.objects;
create policy store_catalog_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'store-assets' and public.catalog_can_manage_asset(name));
drop policy if exists store_catalog_assets_insert on storage.objects;
create policy store_catalog_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and public.catalog_can_manage_asset(name));
drop policy if exists store_catalog_assets_update on storage.objects;
create policy store_catalog_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and public.catalog_can_manage_asset(name))
  with check (bucket_id = 'store-assets' and public.catalog_can_manage_asset(name));
drop policy if exists store_catalog_assets_delete on storage.objects;
create policy store_catalog_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and public.catalog_can_manage_asset(name));

-- ---------------------------------------------------------------------
-- 4. Motor del catálogo (funciones internas, no expuestas al público)
-- ---------------------------------------------------------------------
create or replace function public.catalog__price(p_product public.products, p_level integer)
returns numeric
language sql
immutable
as $$
  select case p_level
    when 1 then p_product.price_1
    when 2 then p_product.price_2
    when 4 then p_product.price_4
    when 5 then p_product.price_5
    else p_product.price_3
  end;
$$;

create or replace function public.catalog__store_by_slug(p_store text)
returns public.stores
language sql
stable
security definer
set search_path = public
as $$
  select s.* from public.stores s
  where s.slug = btrim(coalesce(p_store, ''))
     or lower(s.slug) = lower(btrim(coalesce(p_store, '')))
     or lower(regexp_replace(s.slug, '\.com$', '', 'i')) = lower(regexp_replace(btrim(coalesce(p_store, '')), '\.com$', '', 'i'))
  order by (s.slug = btrim(coalesce(p_store, ''))) desc, s.created_at
  limit 1;
$$;

-- Productos de un catálogo con su precio, existencias y categoría del catálogo.
create or replace function public.catalog__items(p_catalog uuid, p_ids uuid[] default null)
returns table (
  product_id uuid,
  category_key uuid,
  price numeric,
  base_price numeric,
  stock integer,
  featured boolean,
  sort_order integer,
  category_hidden boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(cp.catalog_category_id, ccat.id, p.category_id),
    case
      when cp.price_override is not null then cp.price_override
      when coalesce(public.catalog__price(p, c.price_level), 0) > 0 then public.catalog__price(p, c.price_level)
      when c.fallback_price_level is not null then public.catalog__price(p, c.fallback_price_level)
      else public.catalog__price(p, c.price_level)
    end,
    public.catalog__price(p, c.price_level),
    case
      when p.stock is null then null
      when c.point_id is not null then coalesce(sl.qty, 0)
      else p.stock
    end,
    coalesce(cp.featured, false),
    coalesce(cp.sort_order, 0),
    coalesce(not ecat.visible, false)
  from public.store_catalogs c
  join public.products p on p.store_id = c.store_id and p.active
  left join public.store_catalog_products cp on cp.catalog_id = c.id and cp.product_id = p.id
  left join public.store_catalog_categories ccat on ccat.catalog_id = c.id and ccat.category_id = p.category_id
  left join public.store_catalog_categories ecat on ecat.id = coalesce(cp.catalog_category_id, ccat.id)
  left join public.erp_stock_levels sl on c.point_id is not null and sl.warehouse_id = c.point_id and sl.product_id = p.id
  where c.id = p_catalog
    and (p_ids is null or p.id = any (p_ids))
    and case when c.include_all_products then coalesce(cp.included, true) else coalesce(cp.included, false) end;
$$;

create or replace function public.catalog__access(p_store text, p_catalog text, p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.stores; c public.store_catalogs;
begin
  s := public.catalog__store_by_slug(p_store);
  if s.id is null or not s.active or (s.active_until is not null and s.active_until <= now()) then return null; end if;
  select * into c from public.store_catalogs where store_id = s.id and slug = lower(btrim(coalesce(p_catalog, '')));
  if not found or not c.active then return null; end if;
  if c.access_key is not null and coalesce(p_key, '') <> c.access_key then return null; end if;
  return c.id;
end;
$$;

revoke all on function public.catalog__price(public.products, integer) from public, anon, authenticated;
revoke all on function public.catalog__store_by_slug(text) from public, anon, authenticated;
revoke all on function public.catalog__items(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.catalog__access(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Funciones públicas del catálogo
-- ---------------------------------------------------------------------
create or replace function public.catalog_public(p_store text, p_catalog text, p_key text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.stores;
  c public.store_catalogs;
  v_whatsapp text;
  v_profile public.store_profiles;
  v_categories jsonb;
  v_campaigns jsonb;
  v_links jsonb;
  v_others jsonb;
begin
  s := public.catalog__store_by_slug(p_store);
  if s.id is null then return jsonb_build_object('status', 'store_not_found'); end if;

  select * into c from public.store_catalogs where store_id = s.id and slug = lower(btrim(coalesce(p_catalog, '')));
  if not found then return jsonb_build_object('status', 'not_found', 'store_slug', s.slug); end if;

  v_whatsapp := coalesce(nullif(btrim(c.whatsapp), ''), s.whatsapp);
  if not s.active or (s.active_until is not null and s.active_until <= now()) or not c.active then
    return jsonb_build_object('status', 'inactive', 'store_slug', s.slug, 'store_name', s.name, 'name', c.name,
      'logo_url', coalesce(c.logo_url, s.logo_url));
  end if;
  if c.access_key is not null and coalesce(p_key, '') <> c.access_key then
    return jsonb_build_object('status', 'locked', 'store_slug', s.slug, 'store_name', s.name, 'name', c.name,
      'logo_url', coalesce(c.logo_url, s.logo_url), 'whatsapp', v_whatsapp);
  end if;

  select * into v_profile from public.store_profiles where store_id = s.id;

  with items as (
    select i.category_key, count(*) as n
    from public.catalog__items(c.id) i
    where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
    group by i.category_key
  ),
  cats as (
    select cc.id, coalesce(cc.name, pc.name) as name, coalesce(cc.image_url, pc.image_url) as image_url, cc.sort_order
    from public.store_catalog_categories cc
    left join public.product_categories pc on pc.id = cc.category_id
    where cc.catalog_id = c.id and cc.visible and (cc.category_id is null or pc.active)
    union all
    select pc.id, pc.name, pc.image_url, pc.sort_order
    from public.product_categories pc
    where pc.store_id = s.id and pc.active
      and not exists (select 1 from public.store_catalog_categories cc where cc.catalog_id = c.id and cc.category_id = pc.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', cats.id, 'name', cats.name, 'image_url', cats.image_url,
           'sort_order', cats.sort_order, 'count', items.n) order by cats.sort_order, cats.name), '[]'::jsonb)
  into v_categories
  from cats join items on items.category_key = cats.id;

  select coalesce(jsonb_agg(x.obj order by x.created_at desc), '[]'::jsonb) into v_campaigns
  from (
    select sc.created_at, jsonb_build_object(
      'id', sc.id,
      'name', sc.name,
      'description', coalesce(sc.description, ''),
      'cover_image_url', sc.cover_image_url,
      'category_id', coalesce(
        (select cc.id from public.store_catalog_categories cc where cc.catalog_id = c.id and cc.category_id = sc.category_id),
        sc.category_id),
      'products', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.name, 'description', p.description, 'image_url', p.image_url,
          'price', i.price, 'price_retail', i.price, 'price_wholesale', i.price,
          'min_wholesale', case when c.wholesale_rules then greatest(1, coalesce(p.min_wholesale, 1)) end,
          'stock', i.stock, 'category_id', i.category_key, 'active', true, 'product_details', null
        ) order by it.sort_order)
        from public.store_social_campaign_items it
        join public.catalog__items(c.id, array(select ci.product_id from public.store_social_campaign_items ci where ci.campaign_id = sc.id)) i
          on i.product_id = it.product_id
        join public.products p on p.id = it.product_id
        where it.campaign_id = sc.id and not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
      ), '[]'::jsonb)
    ) as obj
    from public.store_social_campaigns sc
    where sc.store_id = s.id and sc.is_public and nullif(btrim(coalesce(sc.cover_image_url, '')), '') is not null
      and (cardinality(sc.catalog_ids) = 0 or c.id = any (sc.catalog_ids))
    order by sc.created_at desc
    limit 30
  ) x;

  if jsonb_array_length(c.links) > 0 then
    v_links := c.links;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'type', l.type, 'label', l.label, 'url', l.url, 'icon_url', l.icon_url)
             order by l.sort_order), '[]'::jsonb)
    into v_links
    from public.store_links l where l.store_id = s.id and l.active;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('slug', o.slug, 'name', o.name, 'logo_url', o.logo_url) order by o.sort_order, o.name), '[]'::jsonb)
  into v_others
  from public.store_catalogs o
  where o.store_id = s.id and o.active and o.access_key is null and o.id <> c.id;

  return jsonb_build_object(
    'status', 'ok',
    'store', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp,
      'logo_url', s.logo_url, 'banner_url', s.banner_url, 'theme', s.theme),
    'catalog', jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'name', c.name, 'headline', coalesce(c.headline, v_profile.headline),
      'description', c.description,
      'logo_url', coalesce(c.logo_url, s.logo_url), 'banner_url', coalesce(c.banner_url, s.banner_url),
      'theme', coalesce(c.theme, s.theme),
      'price_level', c.price_level, 'wholesale_rules', c.wholesale_rules, 'show_stock', c.show_stock,
      'has_key', c.access_key is not null, 'whatsapp', v_whatsapp,
      'contact_channels', case when jsonb_array_length(c.contact_channels) > 0 then c.contact_channels
                               else coalesce(v_profile.contact_channels, '[]'::jsonb) end,
      'locations', case when jsonb_array_length(c.locations) > 0 then c.locations
                        else coalesce(v_profile.locations, '[]'::jsonb) end,
      'address', coalesce(c.address, v_profile.address), 'city', coalesce(c.city, v_profile.city),
      'phone', c.phone, 'email', c.email, 'footer_note', c.footer_note,
      'point', (select jsonb_build_object('name', w.name, 'address', w.address, 'city', w.city, 'phone', w.phone)
                from public.erp_warehouses w where w.id = c.point_id)
    ),
    'links', v_links,
    'categories', v_categories,
    'campaigns', v_campaigns,
    'other_catalogs', v_others
  );
end;
$$;
grant execute on function public.catalog_public(text, text, text) to anon, authenticated;

create or replace function public.catalog_public_products(
  p_store text,
  p_catalog text,
  p_key text default null,
  p_category uuid default null,
  p_q text default null,
  p_limit integer default 30,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_catalog uuid;
  v_rules boolean;
  v_q text := lower(nullif(btrim(coalesce(p_q, '')), ''));
  v_result jsonb;
begin
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  select wholesale_rules into v_rules from public.store_catalogs where id = v_catalog;

  with items as (
    select i.*, p.name, p.description, p.image_url, p.product_details, p.min_wholesale
    from public.catalog__items(v_catalog) i
    join public.products p on p.id = i.product_id
    where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
      and (p_category is null or i.category_key = p_category)
      and (v_q is null or strpos(lower(p.name), v_q) > 0 or strpos(lower(coalesce(p.description, '')), v_q) > 0
           or strpos(lower(coalesce(p.sku, '')), v_q) > 0)
  ),
  page as (
    select items.*, count(*) over () as total_count
    from items
    order by items.featured desc, items.sort_order, items.name, items.product_id
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', coalesce(max(page.total_count), 0),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', page.product_id, 'name', page.name, 'description', page.description, 'image_url', page.image_url,
      'price', page.price, 'price_retail', page.price, 'price_wholesale', page.price,
      'min_wholesale', case when v_rules then greatest(1, coalesce(page.min_wholesale, 1)) end,
      'stock', page.stock, 'category_id', page.category_key, 'featured', page.featured,
      'active', true, 'product_details', page.product_details
    ) order by page.featured desc, page.sort_order, page.name, page.product_id), '[]'::jsonb)
  )
  into v_result
  from page;
  return v_result;
end;
$$;
grant execute on function public.catalog_public_products(text, text, text, uuid, text, integer, integer) to anon, authenticated;

create or replace function public.catalog_public_stock(p_store text, p_catalog text, p_key text, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_catalog uuid; v_result jsonb;
begin
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name,
    'stock', case when i.product_id is null or i.category_hidden or coalesce(i.price, 0) <= 0 then 0 else i.stock end,
    'price', i.price
  )), '[]'::jsonb)
  into v_result
  from public.products p
  left join public.catalog__items(v_catalog, p_ids) i on i.product_id = p.id
  where p.id = any (p_ids);
  return v_result;
end;
$$;
grant execute on function public.catalog_public_stock(text, text, text, uuid[]) to anon, authenticated;

create or replace function public.catalog_public_meta(p_store text, p_catalog text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', c.name, 'store_name', s.name, 'headline', c.headline,
    'logo_url', coalesce(c.logo_url, s.logo_url), 'banner_url', coalesce(c.banner_url, s.banner_url))
  from public.store_catalogs c
  join public.stores s on s.id = c.store_id
  where s.id = (public.catalog__store_by_slug(p_store)).id
    and c.slug = lower(btrim(coalesce(p_catalog, '')))
    and c.active
  limit 1;
$$;
grant execute on function public.catalog_public_meta(text, text) to anon, authenticated;

-- Pedido desde un catálogo: precios y existencias se validan aquí, no en el navegador.
create or replace function public.catalog_create_order(
  p_store text,
  p_catalog text,
  p_key text,
  p_items jsonb,
  p_customer_name text,
  p_customer_note text default null,
  p_customer_whatsapp text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog uuid;
  c public.store_catalogs;
  r record;
  v_ids uuid[];
  v_payload jsonb := '[]'::jsonb;
  v_res jsonb;
  v_token text;
  v_order uuid;
  v_receipt bigint;
  v_name text := btrim(coalesce(p_customer_name, ''));
begin
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  select * into c from public.store_catalogs where id = v_catalog;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío.'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'Escribe tu nombre para enviar el pedido.'; end if;

  select array_agg(distinct (e->>'product_id')::uuid) into v_ids from jsonb_array_elements(p_items) e;

  for r in
    with wanted as (
      select (e->>'product_id')::uuid as product_id, sum(coalesce((e->>'qty')::integer, 0)) as qty
      from jsonb_array_elements(p_items) e
      group by 1
    )
    select w.product_id, w.qty, p.name, p.min_wholesale, i.price, i.stock, i.category_hidden, (i.product_id is not null) as listed
    from wanted w
    join public.products p on p.id = w.product_id and p.store_id = c.store_id
    left join public.catalog__items(v_catalog, v_ids) i on i.product_id = w.product_id
  loop
    if r.qty is null or r.qty <= 0 or r.qty > 100000 then raise exception 'Cantidad inválida para "%".', r.name; end if;
    if not r.listed or r.category_hidden or coalesce(r.price, 0) <= 0 then
      raise exception 'OUT_OF_STOCK' using detail = r.name;
    end if;
    if r.stock is not null and r.qty > r.stock then raise exception 'OUT_OF_STOCK' using detail = r.name; end if;
    if c.wholesale_rules and r.qty < greatest(1, coalesce(r.min_wholesale, 1)) then
      raise exception 'La cantidad mínima de "%" es %.', r.name, greatest(1, coalesce(r.min_wholesale, 1));
    end if;
    v_payload := v_payload || jsonb_build_array(jsonb_build_object('product_id', r.product_id, 'qty', r.qty, 'price', r.price));
  end loop;
  if jsonb_array_length(v_payload) <> coalesce(cardinality(v_ids), 0) then
    raise exception 'Un producto del carrito no pertenece a este catálogo.';
  end if;

  v_res := to_jsonb(public.create_order_from_cart(
    p_store_id => c.store_id,
    p_catalog_type => case when c.wholesale_rules then 'wholesale' else 'retail' end,
    p_items => v_payload,
    p_customer_name => v_name,
    p_customer_note => coalesce(btrim(p_customer_note), ''),
    p_customer_whatsapp => nullif(btrim(coalesce(p_customer_whatsapp, '')), '')
  ));
  v_token := v_res->>'token';
  select id, receipt_no into v_order, v_receipt from public.orders where token = v_token and store_id = c.store_id;
  if v_order is null then raise exception 'No se pudo crear el pedido.'; end if;

  update public.order_items oi
  set price = x.price
  from (select (e->>'product_id')::uuid as product_id, (e->>'price')::numeric as price from jsonb_array_elements(v_payload) e) x
  where oi.order_id = v_order and oi.product_id = x.product_id and oi.price is distinct from x.price;
  update public.orders
  set total = (select coalesce(sum(oi.quantity * oi.price), 0) from public.order_items oi where oi.order_id = v_order)
  where id = v_order;

  insert into public.store_catalog_orders (order_id, catalog_id, store_id, catalog_name)
  values (v_order, c.id, c.store_id, c.name)
  on conflict (order_id) do nothing;

  if c.point_id is not null then
    insert into public.erp_order_meta (order_id, store_id, point_id, doc_kind, created_by_name)
    values (v_order, c.store_id, c.point_id, 'remision', left('Catálogo ' || c.name, 120))
    on conflict (order_id) do nothing;
  end if;

  return jsonb_build_object('token', v_token, 'receipt_no', v_receipt, 'catalog', c.name);
end;
$$;
grant execute on function public.catalog_create_order(text, text, text, jsonb, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Herramientas del panel para catálogos
-- ---------------------------------------------------------------------
-- Incluye o excluye en bloque los productos que coinciden con un filtro.
create or replace function public.catalog_admin_bulk(p_catalog uuid, p_action text, p_category uuid default null, p_q text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare c public.store_catalogs; v_q text := lower(nullif(btrim(coalesce(p_q, '')), '')); v_count integer;
begin
  select * into c from public.store_catalogs where id = p_catalog;
  if not found then raise exception 'Catálogo no encontrado.'; end if;
  if not public.erp_can(c.store_id, 'products') then raise exception 'Necesitas el permiso de Productos.'; end if;
  if p_action not in ('include', 'exclude') then raise exception 'Acción no válida.'; end if;

  insert into public.store_catalog_products (catalog_id, product_id, store_id, included)
  select c.id, p.id, c.store_id, p_action = 'include'
  from public.products p
  where p.store_id = c.store_id and p.active
    and (p_category is null or p.category_id = p_category
         or exists (select 1 from public.store_catalog_categories cc where cc.id = p_category and cc.category_id = p.category_id))
    and (v_q is null or strpos(lower(p.name), v_q) > 0 or strpos(lower(coalesce(p.sku, '')), v_q) > 0)
  on conflict (catalog_id, product_id) do update set included = excluded.included;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.catalog_admin_bulk(uuid, text, uuid, text) to authenticated;

-- Duplica un catálogo (configuración, categorías y productos) con otro nombre, enlace y precio.
create or replace function public.catalog_admin_duplicate(p_catalog uuid, p_name text, p_slug text, p_price_level integer default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare c public.store_catalogs; v_new uuid; v_map jsonb := '{}'::jsonb; r record; v_cat uuid;
begin
  select * into c from public.store_catalogs where id = p_catalog;
  if not found then raise exception 'Catálogo no encontrado.'; end if;
  if not public.erp_can(c.store_id, 'products') then raise exception 'Necesitas el permiso de Productos.'; end if;

  insert into public.store_catalogs (store_id, slug, name, headline, description, logo_url, banner_url, theme, price_level,
    fallback_price_level, wholesale_rules, access_key, point_id, include_all_products, show_stock, whatsapp, contact_channels,
    locations, links, address, city, phone, email, footer_note, active, sort_order)
  values (c.store_id, p_slug, p_name, c.headline, c.description, c.logo_url, c.banner_url, c.theme,
    coalesce(p_price_level, c.price_level), c.fallback_price_level, c.wholesale_rules, c.access_key, c.point_id,
    c.include_all_products, c.show_stock, c.whatsapp, c.contact_channels, c.locations, c.links, c.address, c.city,
    c.phone, c.email, c.footer_note, false, c.sort_order + 1)
  returning id into v_new;

  for r in select * from public.store_catalog_categories where catalog_id = c.id loop
    insert into public.store_catalog_categories (catalog_id, store_id, category_id, name, image_url, sort_order, visible)
    values (v_new, c.store_id, r.category_id, r.name, r.image_url, r.sort_order, r.visible)
    returning id into v_cat;
    v_map := v_map || jsonb_build_object(r.id::text, v_cat);
  end loop;

  insert into public.store_catalog_products (catalog_id, product_id, store_id, included, price_override, catalog_category_id, featured, sort_order)
  select v_new, cp.product_id, c.store_id, cp.included,
         case when p_price_level is null or p_price_level = c.price_level then cp.price_override end,
         (v_map->>cp.catalog_category_id::text)::uuid, cp.featured, cp.sort_order
  from public.store_catalog_products cp where cp.catalog_id = c.id;

  return v_new;
end;
$$;
grant execute on function public.catalog_admin_duplicate(uuid, text, text, integer) to authenticated;

-- Productos de la tienda vistos desde un catálogo (para el editor), con filtros y conteos.
create or replace function public.catalog_admin_products(
  p_catalog uuid,
  p_q text default null,
  p_category uuid default null,
  p_filter text default 'all',
  p_limit integer default 40,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.store_catalogs; v_q text := lower(nullif(btrim(coalesce(p_q, '')), '')); v jsonb;
begin
  select * into c from public.store_catalogs where id = p_catalog;
  if not found then raise exception 'Catálogo no encontrado.'; end if;
  if not public.erp_can(c.store_id, 'products') then raise exception 'Necesitas el permiso de Productos.'; end if;

  with base as (
    select p.id, p.name, p.sku, p.image_url, p.category_id, p.stock, p.cost_price,
           p.price_1, p.price_2, p.price_3, p.price_4, p.price_5,
           cp.price_override, cp.catalog_category_id, coalesce(cp.featured, false) as featured,
           case when c.include_all_products then coalesce(cp.included, true) else coalesce(cp.included, false) end as in_catalog,
           case
             when cp.price_override is not null then cp.price_override
             when coalesce(public.catalog__price(p, c.price_level), 0) > 0 then public.catalog__price(p, c.price_level)
             when c.fallback_price_level is not null then public.catalog__price(p, c.fallback_price_level)
             else public.catalog__price(p, c.price_level)
           end as price,
           case when p.stock is null then null when c.point_id is not null then coalesce(sl.qty, 0) else p.stock end as catalog_stock
    from public.products p
    left join public.store_catalog_products cp on cp.catalog_id = c.id and cp.product_id = p.id
    left join public.erp_stock_levels sl on c.point_id is not null and sl.warehouse_id = c.point_id and sl.product_id = p.id
    where p.store_id = c.store_id and p.active
      and (p_category is null or p.category_id = p_category)
      and (v_q is null or strpos(lower(p.name), v_q) > 0 or strpos(lower(coalesce(p.sku, '')), v_q) > 0
           or strpos(lower(coalesce(p.barcode, '')), v_q) > 0)
  ),
  filtered as (
    select * from base
    where case coalesce(p_filter, 'all')
      when 'in' then in_catalog
      when 'out' then not in_catalog
      when 'special' then price_override is not null
      when 'noprice' then in_catalog and coalesce(price, 0) <= 0
      when 'featured' then featured
      else true end
  ),
  page as (
    select filtered.*, count(*) over () as total_count
    from filtered
    order by featured desc, name, id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', coalesce((select max(total_count) from page), 0),
    'items', coalesce((select jsonb_agg(to_jsonb(page) - 'total_count' order by page.featured desc, page.name, page.id) from page), '[]'::jsonb),
    'counts', (select jsonb_build_object(
      'all', count(*),
      'in', count(*) filter (where in_catalog),
      'out', count(*) filter (where not in_catalog),
      'special', count(*) filter (where price_override is not null),
      'noprice', count(*) filter (where in_catalog and coalesce(price, 0) <= 0),
      'featured', count(*) filter (where featured)) from base)
  ) into v;
  return v;
end;
$$;
grant execute on function public.catalog_admin_products(uuid, text, uuid, text, integer, integer) to authenticated;

-- Resumen de cada catálogo para las tarjetas del panel.
create or replace function public.catalog_admin_summary(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not (public.erp_can(p_store, 'products') or public.erp_can(p_store, 'audit')) then
    raise exception 'Necesitas el permiso de Productos.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'catalog_id', c.id,
    'products', (select count(*) from public.catalog__items(c.id) i where not i.category_hidden and i.price > 0),
    'available', (select count(*) from public.catalog__items(c.id) i where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)),
    'without_price', (select count(*) from public.catalog__items(c.id) i where coalesce(i.price, 0) <= 0),
    'orders_30d', (select count(*) from public.store_catalog_orders co where co.catalog_id = c.id and co.created_at > now() - interval '30 days')
  )), '[]'::jsonb)
  into v
  from public.store_catalogs c where c.store_id = p_store;
  return v;
end;
$$;
grant execute on function public.catalog_admin_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Informes
-- ---------------------------------------------------------------------
create or replace function public.erp__sale_lines(p_store uuid, p_from timestamptz, p_to timestamptz, p_point uuid)
returns table (
  order_id uuid, sold_at timestamptz, point_id uuid, seller_name text, catalog_id uuid, catalog_name text,
  channel text, customer_name text, product_id uuid, qty integer, revenue numeric, cost numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         coalesce(o.confirmed_at, o.created_at),
         m.point_id,
         nullif(btrim(m.seller_name), ''),
         co.catalog_id,
         co.catalog_name,
         case when co.order_id is not null then 'catalog'
              when m.doc_number is not null or m.seller_name is not null then 'pos'
              when o.catalog_type = 'wholesale' then 'wholesale'
              else 'retail' end,
         nullif(upper(btrim(coalesce(o.customer_name, ''))), ''),
         oi.product_id,
         oi.quantity,
         oi.quantity * oi.price,
         oi.quantity * coalesce(p.cost_price, 0)
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.products p on p.id = oi.product_id
  left join public.erp_order_meta m on m.order_id = o.id
  left join public.store_catalog_orders co on co.order_id = o.id
  where o.store_id = p_store
    and o.status in ('confirmed', 'completed')
    and coalesce(o.confirmed_at, o.created_at) >= p_from
    and coalesce(o.confirmed_at, o.created_at) < p_to
    and (p_point is null or m.point_id = p_point);
$$;
revoke all on function public.erp__sale_lines(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.erp_report(p_store uuid, p_from timestamptz, p_to timestamptz, p_point uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_point uuid := coalesce(public.erp_my_point(p_store), p_point);
  v_len interval := p_to - p_from;
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_bucket text;
  v_tz text := 'America/Bogota';
  v_admin boolean := public.erp_my_point(p_store) is null;
  v jsonb;
begin
  if not public.erp_can(p_store, 'audit') then raise exception 'Necesitas el permiso de Auditoría e informes.'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'El rango de fechas no es válido.'; end if;
  if v_len > interval '3 years 2 days' then raise exception 'El rango máximo es de 3 años.'; end if;
  v_bucket := case
    when v_len <= interval '2 days' then 'hour'
    when v_len <= interval '92 days' then 'day'
    when v_len <= interval '400 days' then 'week'
    else 'month' end;

  with cur as (select * from public.erp__sale_lines(p_store, p_from, p_to, v_point)),
       prev as (select * from public.erp__sale_lines(p_store, v_prev_from, p_from, v_point))
  select jsonb_build_object(
    'meta', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_prev_from, 'bucket', v_bucket, 'tz', v_tz,
      'point', (select jsonb_build_object('id', w.id, 'name', w.name) from public.erp_warehouses w where w.id = v_point),
      'point_locked', public.erp_my_point(p_store) is not null, 'generated_at', now()),
    'kpis', (select jsonb_build_object(
      'sales', coalesce(sum(revenue), 0), 'cost', coalesce(sum(cost), 0), 'units', coalesce(sum(qty), 0),
      'orders', count(distinct order_id),
      'customers', count(distinct customer_name) filter (where customer_name is not null and customer_name <> 'CONSUMIDOR FINAL'))
      from cur),
    'previous', (select jsonb_build_object(
      'sales', coalesce(sum(revenue), 0), 'cost', coalesce(sum(cost), 0), 'units', coalesce(sum(qty), 0),
      'orders', count(distinct order_id))
      from prev),
    'series', (
      with b as (
        select g as k, row_number() over (order by g) as idx
        from generate_series(date_trunc(v_bucket, p_from at time zone v_tz),
                             date_trunc(v_bucket, (p_to - interval '1 second') at time zone v_tz),
                             ('1 ' || v_bucket)::interval) g
      ),
      pb as (
        select g as k, row_number() over (order by g) as idx
        from generate_series(date_trunc(v_bucket, v_prev_from at time zone v_tz),
                             date_trunc(v_bucket, (p_from - interval '1 second') at time zone v_tz),
                             ('1 ' || v_bucket)::interval) g
      ),
      cs as (select date_trunc(v_bucket, sold_at at time zone v_tz) as k, sum(revenue) as rev, sum(revenue - cost) as profit,
                    count(distinct order_id) as n from cur group by 1),
      ps as (select date_trunc(v_bucket, sold_at at time zone v_tz) as k, sum(revenue) as rev from prev group by 1)
      select coalesce(jsonb_agg(jsonb_build_object('t', b.k, 'sales', coalesce(cs.rev, 0), 'profit', coalesce(cs.profit, 0),
               'orders', coalesce(cs.n, 0), 'prev', coalesce(ps.rev, 0)) order by b.idx), '[]'::jsonb)
      from b
      left join cs on cs.k = b.k
      left join pb on pb.idx = b.idx
      left join ps on ps.k = pb.k
    ),
    'by_point', (
      select coalesce(jsonb_agg(jsonb_build_object('point_id', x.point_id, 'name', coalesce(w.name, 'En línea / sin punto'),
               'kind', w.kind, 'sales', x.rev, 'orders', x.n, 'units', x.u, 'profit', x.rev - x.cost) order by x.rev desc), '[]'::jsonb)
      from (select point_id, sum(revenue) as rev, count(distinct order_id) as n, sum(qty) as u, sum(cost) as cost from cur group by point_id) x
      left join public.erp_warehouses w on w.id = x.point_id
    ),
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', x.channel, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select channel, sum(revenue) as rev, count(distinct order_id) as n from cur group by channel) x
    ),
    'by_catalog', (
      select coalesce(jsonb_agg(jsonb_build_object('catalog_id', x.catalog_id, 'name', x.name, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select catalog_id, coalesce(max(catalog_name), 'Catálogo') as name, sum(revenue) as rev, count(distinct order_id) as n
            from cur where channel = 'catalog' group by catalog_id) x
    ),
    'top_products', (
      select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'name', coalesce(p.name, 'Producto'), 'image_url', p.image_url,
               'units', x.u, 'sales', x.rev, 'profit', x.rev - x.cost) order by x.rev desc), '[]'::jsonb)
      from (select product_id, sum(qty) as u, sum(revenue) as rev, sum(cost) as cost from cur group by product_id order by sum(revenue) desc limit 10) x
      left join public.products p on p.id = x.product_id
    ),
    'top_customers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.customer_name, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select customer_name, sum(revenue) as rev, count(distinct order_id) as n from cur
            where customer_name is not null and customer_name <> 'CONSUMIDOR FINAL'
            group by customer_name order by sum(revenue) desc limit 8) x
    ),
    'sellers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.seller_name, 'sales', x.rev, 'orders', x.n) order by x.rev desc), '[]'::jsonb)
      from (select seller_name, sum(revenue) as rev, count(distinct order_id) as n from cur
            where seller_name is not null group by seller_name order by sum(revenue) desc limit 8) x
    ),
    'pending_orders', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(o.total), 0), 'oldest', min(o.created_at))
      from public.orders o
      left join public.erp_order_meta m on m.order_id = o.id
      where o.store_id = p_store and o.status in ('draft', 'sent') and o.created_at > now() - interval '60 days'
        and (v_point is null or m.point_id = v_point)
    ),
    'inventory', (
      select coalesce(jsonb_agg(jsonb_build_object('point_id', w.id, 'name', w.name, 'kind', w.kind, 'is_default', w.is_default,
               'units', coalesce(s.units, 0), 'value', coalesce(s.value, 0), 'skus', coalesce(s.skus, 0),
               'out', coalesce(s.out_n, 0), 'low', coalesce(s.low_n, 0)) order by w.is_default desc, w.name), '[]'::jsonb)
      from public.erp_warehouses w
      left join (
        select l.warehouse_id, sum(greatest(l.qty, 0)) as units, sum(greatest(l.qty, 0) * coalesce(p.cost_price, 0)) as value,
               count(*) filter (where l.qty > 0) as skus, count(*) filter (where l.qty <= 0) as out_n,
               count(*) filter (where l.qty between 1 and 5) as low_n
        from public.erp_stock_levels l
        join public.products p on p.id = l.product_id and p.active
        where l.store_id = p_store
        group by l.warehouse_id
      ) s on s.warehouse_id = w.id
      where w.store_id = p_store and w.active and (v_point is null or w.id = v_point)
    ),
    'purchases', (
      select jsonb_build_object(
        'count', count(*), 'total', coalesce(sum(pu.total), 0),
        'top_suppliers', coalesce((
          select jsonb_agg(jsonb_build_object('name', y.name, 'total', y.total, 'count', y.n) order by y.total desc)
          from (select coalesce(sp.name, 'Proveedor') as name, sum(p2.total) as total, count(*) as n
                from public.erp_purchases p2 left join public.erp_suppliers sp on sp.id = p2.supplier_id
                where p2.store_id = p_store and p2.status = 'received' and p2.created_at >= p_from and p2.created_at < p_to
                  and (v_point is null or p2.warehouse_id = v_point)
                group by 1 order by sum(p2.total) desc limit 5) y), '[]'::jsonb))
      from public.erp_purchases pu
      where pu.store_id = p_store and pu.status = 'received' and pu.created_at >= p_from and pu.created_at < p_to
        and (v_point is null or pu.warehouse_id = v_point)
    ),
    'payables', case when v_admin then (
      select jsonb_build_object(
        'open', coalesce(sum(ap.balance), 0), 'open_count', count(*),
        'overdue', coalesce(sum(ap.balance) filter (where ap.due_date < current_date), 0),
        'overdue_count', count(*) filter (where ap.due_date < current_date),
        'due_soon', coalesce(sum(ap.balance) filter (where ap.due_date between current_date and current_date + 7), 0),
        'due_soon_count', count(*) filter (where ap.due_date between current_date and current_date + 7),
        'upcoming', coalesce((
          select jsonb_agg(jsonb_build_object('supplier', y.name, 'balance', y.balance, 'due_date', y.due_date) order by y.due_date nulls last)
          from (select coalesce(sp.name, 'Proveedor') as name, a2.balance, a2.due_date
                from public.erp_payables a2 left join public.erp_suppliers sp on sp.id = a2.supplier_id
                where a2.store_id = p_store and a2.status = 'open' and a2.balance > 0
                order by a2.due_date nulls last limit 6) y), '[]'::jsonb))
      from public.erp_payables ap
      where ap.store_id = p_store and ap.status = 'open' and ap.balance > 0
    ) end,
    'transfers', (
      select jsonb_build_object('in_transit', count(*), 'list', coalesce((
        select jsonb_agg(jsonb_build_object('number', y.number, 'from', y.from_name, 'to', y.to_name, 'created_at', y.created_at,
                 'signatures', y.sigs) order by y.created_at)
        from (select t2.number, wf.name as from_name, wt.name as to_name, t2.created_at,
                     (select count(*) from public.erp_transfer_signatures sg where sg.transfer_id = t2.id) as sigs
              from public.erp_transfers t2
              join public.erp_warehouses wf on wf.id = t2.from_warehouse_id
              join public.erp_warehouses wt on wt.id = t2.to_warehouse_id
              where t2.store_id = p_store and t2.status = 'in_transit'
                and (v_point is null or v_point in (t2.from_warehouse_id, t2.to_warehouse_id))
              order by t2.created_at limit 6) y), '[]'::jsonb))
      from public.erp_transfers t
      where t.store_id = p_store and t.status = 'in_transit'
        and (v_point is null or v_point in (t.from_warehouse_id, t.to_warehouse_id))
    ),
    'customers', (
      select jsonb_build_object('total', count(*), 'new', count(*) filter (where bc.created_at >= p_from and bc.created_at < p_to))
      from public.billing_customers bc where bc.store_id = p_store
    ),
    'catalogs', (select count(*) from public.store_catalogs sc where sc.store_id = p_store and sc.active)
  ) into v;
  return v;
end;
$$;
grant execute on function public.erp_report(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Notificaciones
-- ---------------------------------------------------------------------
create or replace function public.erp_alerts(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_point uuid := public.erp_my_point(p_store);
  v_audit boolean := public.erp_can(p_store, 'audit');
  v_inventory boolean := v_audit or public.erp_can(p_store, 'inventory');
  v_orders boolean := v_audit or public.erp_can(p_store, 'orders');
  v_payables boolean := v_point is null and (v_audit or public.erp_can(p_store, 'payables'));
  v jsonb := '[]'::jsonb;
  s public.stores;
  r record;
  v_n integer;
  v_total numeric;
  v_days integer;
begin
  if not (v_audit or v_inventory or v_orders or v_payables) then return v; end if;
  select * into s from public.stores where id = p_store;

  if v_point is null and s.active_until is not null then
    v_days := ceil(extract(epoch from (s.active_until - now())) / 86400.0)::integer;
    if v_days <= 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'plan-expired', 'severity', 'critical', 'icon', 'calendar',
        'title', 'Tu plan está vencido', 'body', 'Los catálogos están inactivos. Renueva para volver a vender en línea.', 'href', '/dashboard/store'));
    elsif v_days <= 10 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'plan-' || v_days, 'severity', 'serious', 'icon', 'calendar',
        'title', 'Tu plan vence en ' || v_days || ' día' || case when v_days = 1 then '' else 's' end,
        'body', 'Renueva a tiempo para que tus catálogos sigan activos.', 'href', '/dashboard/store'));
    end if;
  end if;

  if v_payables then
    select count(*), coalesce(sum(balance), 0) into v_n, v_total from public.erp_payables
    where store_id = p_store and status = 'open' and balance > 0 and due_date < current_date;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'payables-overdue-' || v_n || '-' || v_total, 'severity', 'critical', 'icon', 'wallet',
        'title', v_n || ' cuenta' || case when v_n = 1 then '' else 's' end || ' por pagar vencida' || case when v_n = 1 then '' else 's' end,
        'body', 'Saldo vencido con proveedores: $' || to_char(v_total, 'FM999G999G999G999'), 'href', '/dashboard/inventario', 'count', v_n));
    end if;
    select count(*), coalesce(sum(balance), 0) into v_n, v_total from public.erp_payables
    where store_id = p_store and status = 'open' and balance > 0 and due_date between current_date and current_date + 7;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'payables-soon-' || current_date || '-' || v_n, 'severity', 'warning', 'icon', 'wallet',
        'title', v_n || ' pago' || case when v_n = 1 then '' else 's' end || ' a proveedores esta semana',
        'body', 'Vencen en los próximos 7 días: $' || to_char(v_total, 'FM999G999G999G999'), 'href', '/dashboard/inventario', 'count', v_n));
    end if;
  end if;

  if v_inventory then
    for r in
      select w.id, w.name, count(*) as n
      from public.erp_stock_levels l
      join public.erp_warehouses w on w.id = l.warehouse_id and w.active
      join public.products p on p.id = l.product_id and p.active
      where l.store_id = p_store and l.qty <= 0 and (v_point is null or w.id = v_point)
      group by w.id, w.name
      order by count(*) desc
      limit 6
    loop
      v := v || jsonb_build_array(jsonb_build_object('key', 'out-' || r.id || '-' || r.n, 'severity', 'warning', 'icon', 'box',
        'title', r.name || ': ' || r.n || ' producto' || case when r.n = 1 then '' else 's' end || ' agotado' || case when r.n = 1 then '' else 's' end,
        'body', 'Haz un traslado o un ingreso de factura para reponerlos.', 'href', '/dashboard/inventario', 'count', r.n));
    end loop;

    select count(*) into v_n
    from public.erp_stock_levels l join public.products p on p.id = l.product_id and p.active
    where l.store_id = p_store and l.qty between 1 and 5 and (v_point is null or l.warehouse_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'low-' || current_date || '-' || v_n, 'severity', 'info', 'icon', 'trending-down',
        'title', v_n || ' producto' || case when v_n = 1 then '' else 's' end || ' con pocas unidades',
        'body', 'Quedan 5 unidades o menos. Revisa Existencias.', 'href', '/dashboard/inventario', 'count', v_n));
    end if;

    select count(*) into v_n from public.erp_transfers
    where store_id = p_store and status = 'in_transit' and created_at < now() - interval '48 hours'
      and (v_point is null or v_point in (from_warehouse_id, to_warehouse_id));
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'transfers-late-' || v_n, 'severity', 'serious', 'icon', 'truck',
        'title', v_n || ' traslado' || case when v_n = 1 then '' else 's' end || ' lleva' || case when v_n = 1 then '' else 'n' end || ' más de 2 días en tránsito',
        'body', 'Revisa el enlace de seguimiento para ver quién falta por firmar.', 'href', '/dashboard/inventario', 'count', v_n));
    end if;
  end if;

  if v_orders then
    select count(*) into v_n
    from public.orders o left join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('draft', 'sent')
      and o.created_at between now() - interval '30 days' and now() - interval '24 hours'
      and (v_point is null or m.point_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'orders-pending-' || current_date || '-' || v_n, 'severity', 'warning', 'icon', 'receipt',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' sin confirmar hace más de un día',
        'body', 'Confírmalos o anúlalos para mantener el inventario al día.', 'href', '/dashboard/pedidos', 'count', v_n));
    end if;

    select count(*), coalesce(sum(o.total), 0) into v_n, v_total
    from public.store_catalog_orders co join public.orders o on o.id = co.order_id
    left join public.erp_order_meta m on m.order_id = o.id
    where co.store_id = p_store and co.created_at > now() - interval '24 hours'
      and (v_point is null or m.point_id = v_point);
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'catalog-orders-' || current_date || '-' || v_n, 'severity', 'good', 'icon', 'shopping-bag',
        'title', v_n || ' pedido' || case when v_n = 1 then '' else 's' end || ' nuevo' || case when v_n = 1 then '' else 's' end || ' desde tus catálogos',
        'body', 'En las últimas 24 horas por $' || to_char(v_total, 'FM999G999G999G999') || '.', 'href', '/dashboard/pedidos', 'count', v_n));
    end if;
  end if;

  if v_audit and v_point is null then
    select count(*) into v_n from public.products where store_id = p_store and active and coalesce(cost_price, 0) <= 0;
    if v_n > 0 then
      v := v || jsonb_build_array(jsonb_build_object('key', 'no-cost-' || v_n, 'severity', 'info', 'icon', 'tag',
        'title', v_n || ' producto' || case when v_n = 1 then '' else 's' end || ' sin costo',
        'body', 'Agrega el costo en Productos para calcular bien la ganancia.', 'href', '/dashboard/products', 'count', v_n));
    end if;
  end if;

  return v;
end;
$$;
grant execute on function public.erp_alerts(uuid) to authenticated;
