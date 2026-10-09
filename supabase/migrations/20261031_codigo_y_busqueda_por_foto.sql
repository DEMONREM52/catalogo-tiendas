-- =====================================================================
-- REMHUB · Código de producto + buscadores con código + búsqueda por foto
--
--   · Cada producto tiene un número interno fijo (product_no: 1, 2, 3… en
--     el orden en que se crearon en cada tienda). No cambia nunca.
--   · El «código» del producto es la columna sku: si un producto no tiene
--     código, toma su número interno. Se puede editar sin tocar el número.
--   · Todos los buscadores encuentran por nombre, código, número interno
--     o código de barras (sin tildes, palabras en cualquier orden y con
--     tolerancia a errores de escritura).
--   · Búsqueda por foto: el navegador calcula una «huella» de cada imagen
--     (modelo MobileCLIP) y aquí se guardan y comparan.
--
-- Ejecutar DESPUÉS de 20261030_lista_general_productos.sql.
-- Es idempotente: se puede ejecutar varias veces.
-- =====================================================================

create schema if not exists extensions;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    create extension vector with schema extensions;
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    begin
      create extension pg_trgm with schema extensions;
    exception when others then
      raise notice 'pg_trgm no disponible: la búsqueda funcionará sin tolerancia a errores de escritura.';
    end;
  end if;
end $$;
set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. Número interno y código
-- ---------------------------------------------------------------------
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists barcode text;
alter table public.products add column if not exists product_no integer;

-- Productos existentes: se numeran en el orden en que se crearon.
update public.products p
set product_no = x.no
from (
  select q.id, coalesce(m.mx, 0) + row_number() over (partition by q.store_id order by q.created_at nulls first, q.id) as no
  from public.products q
  left join (select store_id, max(product_no) as mx from public.products group by store_id) m on m.store_id = q.store_id
  where q.product_no is null
) x
where x.id = p.id;

create unique index if not exists products_store_product_no on public.products (store_id, product_no);

-- Primer código libre para un producto sin código: su número; si ya lo usa otro, P + número.
create or replace function public.products__free_code(p_store uuid, p_no integer, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_code text;
begin
  if p_no is null then return null; end if;
  foreach v_code in array array[p_no::text, 'P' || p_no, 'P' || p_no || '-' || left(p_id::text, 4)] loop
    if not exists (select 1 from public.products o where o.store_id = p_store and o.id <> p_id and lower(btrim(o.sku)) = lower(v_code)) then
      return v_code;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.products__free_code(uuid, integer, uuid) from public, anon, authenticated;

create or replace function public.products__code_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('products.product_no:' || new.store_id::text));
    select coalesce(max(p.product_no), 0) + 1 into new.product_no from public.products p where p.store_id = new.store_id;
  else
    -- El número interno no se cambia nunca.
    new.product_no := coalesce(old.product_no, new.product_no);
  end if;
  new.sku := nullif(btrim(coalesce(new.sku, '')), '');
  -- Sin código (o si lo borran): vuelve a su número interno.
  if new.sku is null then
    new.sku := public.products__free_code(new.store_id, new.product_no, new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists products_code_guard on public.products;
create trigger products_code_guard before insert or update on public.products
for each row execute function public.products__code_guard();

-- Productos sin código: toman su número interno.
update public.products
set sku = public.products__free_code(store_id, product_no, id)
where nullif(btrim(coalesce(sku, '')), '') is null;

-- ---------------------------------------------------------------------
-- 2. Piezas comunes de búsqueda
-- ---------------------------------------------------------------------
create or replace function public.erp__norm_text(p text)
returns text
language sql
immutable
as $$
  select translate(lower(coalesce(p, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou');
$$;

create or replace function public.product__tokens(p_q text)
returns text[]
language sql
immutable
as $$
  select coalesce(array(
    select t from unnest(regexp_split_to_array(public.erp__norm_text(btrim(coalesce(p_q, ''))), '\s+')) as t where t <> ''
  ), '{}'::text[]);
$$;

-- Código comparable: sin tildes, sin espacios, sin # inicial, en minúscula.
create or replace function public.product__code_key(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(regexp_replace(public.erp__norm_text(btrim(coalesce(p, ''))), '^#+', ''), '\s+', '', 'g');
$$;

create or replace function public.product__haystack(p_name text, p_sku text, p_barcode text, p_extra text)
returns text
language sql
immutable
as $$
  select public.erp__norm_text(concat_ws(' ', p_name, p_sku, p_barcode, p_extra));
$$;

create or replace function public.product__has_tokens(p_text text, p_tokens text[])
returns boolean
language sql
immutable
as $$
  select not exists (select 1 from unnest(coalesce(p_tokens, '{}'::text[])) as t where strpos(coalesce(p_text, ''), t) = 0);
$$;

-- Tolerancia a errores de escritura (si pg_trgm está disponible).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute $f$
      create or replace function public.product__fuzzy(p_q text, p_text text)
      returns real language sql stable set search_path = public, extensions
      as $b$ select word_similarity(coalesce(p_q, ''), coalesce(p_text, '')) $b$
    $f$;
  else
    execute $f$
      create or replace function public.product__fuzzy(p_q text, p_text text)
      returns real language sql immutable
      as $b$ select 0::real $b$
    $f$;
  end if;
end $$;

create or replace function public.product__code_hit(p_sku text, p_barcode text, p_no integer, p_code text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_code, '') <> ''
    and (public.product__code_key(p_sku) = p_code or p_no::text = p_code or public.product__code_key(p_barcode) = p_code);
$$;

-- ¿El producto coincide con la búsqueda? (vacía = todos)
create or replace function public.product__matches(p_name text, p_sku text, p_barcode text, p_no integer, p_extra text, p_q text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select cardinality(public.product__tokens(p_q)) = 0
    or public.product__code_hit(p_sku, p_barcode, p_no, public.product__code_key(p_q))
    or public.product__has_tokens(public.product__haystack(p_name, p_sku, p_barcode, p_extra), public.product__tokens(p_q))
    or (length(public.erp__norm_text(btrim(coalesce(p_q, '')))) >= 4
        and public.product__fuzzy(public.erp__norm_text(btrim(p_q)), public.erp__norm_text(p_name)) >= 0.5);
$$;

-- Qué tan bien coincide (mayor = primero): código exacto, nombre igual, empieza igual, todas las palabras, parecido.
create or replace function public.product__rank(p_name text, p_sku text, p_barcode text, p_no integer, p_q text)
returns real
language sql
stable
set search_path = public, extensions
as $$
  select case
    when cardinality(public.product__tokens(p_q)) = 0 then 0
    when public.product__code_hit(p_sku, p_barcode, p_no, public.product__code_key(p_q)) then 100
    when public.erp__norm_text(p_name) = public.erp__norm_text(btrim(p_q)) then 90
    when public.erp__norm_text(p_name) like public.erp__norm_text(btrim(p_q)) || '%' then 70
    when public.product__has_tokens(public.erp__norm_text(p_name), public.product__tokens(p_q)) then 50
    when public.product__has_tokens(public.product__haystack(p_name, p_sku, p_barcode, null), public.product__tokens(p_q)) then 40
    else 10 + 20 * public.product__fuzzy(public.erp__norm_text(btrim(p_q)), public.erp__norm_text(p_name))
  end::real;
$$;

-- ---------------------------------------------------------------------
-- 3. Buscadores
-- ---------------------------------------------------------------------

-- Buscador del inventario, compras, traslados, pedidos internos y POS.
drop function if exists public.erp_search_products(uuid, text, uuid, boolean, integer);
create function public.erp_search_products(
  p_store uuid, p_q text, p_warehouse uuid default null, p_in_stock boolean default false, p_limit integer default 20
) returns table (
  id uuid, name text, sku text, barcode text, cost_price numeric, tax_rate numeric, stock integer, wh_qty integer, product_no integer
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.erp_can_any(p_store, array['inventory', 'purchases', 'transfers', 'inventory_adjust', 'pos', 'stock_requests',
                                           'stock_requests_manage', 'products', 'products_view']::text[]) then
    raise exception 'No tienes permiso para consultar productos.';
  end if;
  return query
    select p.id, p.name::text, p.sku::text, p.barcode::text, coalesce(p.cost_price, 0)::numeric, coalesce(p.tax_rate, 0)::numeric,
           coalesce(p.stock, 0)::integer, coalesce(l.qty, 0)::integer, p.product_no
    from public.products p
    left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = p_warehouse
    where p.store_id = p_store and coalesce(p.active, true)
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, null, p_q)
      and (not p_in_stock or coalesce(l.qty, 0) > 0)
    order by public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_q) desc, p.name
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
grant execute on function public.erp_search_products(uuid, text, uuid, boolean, integer) to authenticated;

-- Se quitan versiones anteriores (con otras firmas) para que no choquen.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('search_products_pro', 'store_public_search')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- Buscador del panel de productos (y del panel admin).
create function public.search_products_pro(
  p_store_id uuid,
  p_query text,
  p_limit integer default 50,
  p_offset integer default 0,
  p_status text default 'all',
  p_category_id uuid default null
) returns setof public.products
language sql
stable
set search_path = public, extensions
as $$
  select p.*
  from public.products p
  where p.store_id = p_store_id
    and (coalesce(p_status, 'all') not in ('active', 'inactive')
         or (p_status = 'active' and coalesce(p.active, true))
         or (p_status = 'inactive' and not coalesce(p.active, true)))
    and (p_category_id is null or p.category_id = p_category_id
         or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = p_category_id))
    and public.product__matches(p.name, p.sku, p.barcode, p.product_no, p.description, p_query)
  order by public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_query) desc, p.name, p.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
grant execute on function public.search_products_pro(uuid, text, integer, integer, text, uuid) to authenticated, service_role;

-- Buscador del catálogo público de la tienda (/tienda/detal y /tienda/mayor).
create function public.store_public_search(
  p_store uuid,
  p_q text default null,
  p_category uuid default null,
  p_limit integer default 30,
  p_offset integer default 0
) returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with found as (
    select p.id, p.name, public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_q) as rank
    from public.products p
    join public.stores s on s.id = p.store_id and s.active and (s.active_until is null or s.active_until > now())
    where p.store_id = p_store and coalesce(p.active, true) and (p.stock is null or p.stock > 0)
      and (p_category is null or p.category_id = p_category
           or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = p_category))
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, p.description, p_q)
  ), page as (
    select id, rank, name from found
    order by rank desc, name, id
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from found),
    'ids', coalesce((select jsonb_agg(id order by rank desc, name, id) from page), '[]'::jsonb)
  );
$$;
grant execute on function public.store_public_search(uuid, text, uuid, integer, integer) to anon, authenticated;

-- Catálogos de RemHub Social: igual que antes + búsqueda por código y sin tildes, y el código en cada producto.
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
set search_path = public, extensions
as $$
declare
  v_catalog uuid;
  v_rules boolean;
  v_result jsonb;
begin
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  select wholesale_rules into v_rules from public.store_catalogs where id = v_catalog;

  with items as (
    select i.*, p.name, p.description, p.image_url, p.product_details, p.min_wholesale, p.sku, p.product_no,
           public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_q) as rank
    from public.catalog__items(v_catalog) i
    join public.products p on p.id = i.product_id
    where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
      and (p_category is null or i.category_key = p_category)
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, p.description, p_q)
  ),
  page as (
    select items.*, count(*) over () as total_count
    from items
    order by items.rank desc, items.featured desc, items.sort_order, items.name, items.product_id
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
      'active', true, 'product_details', page.product_details, 'code', page.sku
    ) order by page.rank desc, page.featured desc, page.sort_order, page.name, page.product_id), '[]'::jsonb)
  )
  into v_result
  from page;
  return v_result;
end;
$$;
grant execute on function public.catalog_public_products(text, text, text, uuid, text, integer, integer) to anon, authenticated;

-- Lista general de productos: + número interno y búsqueda por código / sin tildes / con errores.
create or replace function public.erp_product_catalog_browse(p_store uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 40, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_q text := nullif(btrim(coalesce(f ->> 'q', '')), '');
  v_point uuid := nullif(f ->> 'point_id', '')::uuid;
  v_cat uuid := nullif(f ->> 'category_id', '')::uuid;
  v_stock text := coalesce(nullif(f ->> 'stock', ''), 'all');
  v_status text := coalesce(nullif(f ->> 'status', ''), 'active');
  v_sort text := coalesce(nullif(f ->> 'sort', ''), 'name');
  v_cost boolean := public.erp_can_any(p_store, array['inventory', 'purchases']::text[]);
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not public.erp_can_any(p_store, array['products', 'products_view', 'inventory', 'stock_requests', 'stock_requests_manage', 'transfers', 'pos']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para ver la lista general de productos.');
  end if;
  if v_point is not null and not exists (select 1 from public.erp_warehouses w where w.id = v_point and w.store_id = p_store) then
    v_point := null;
  end if;
  if v_point is null then
    v_point := public.erp_my_point(p_store);
  end if;
  if v_point is null then
    select w.id into v_point from public.erp_warehouses w
    where w.store_id = p_store and w.active
    order by w.is_default desc, (w.kind = 'point') asc, w.name limit 1;
  end if;

  with base as (
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active, p.price_1, p.cost_price,
      public.product__rank(p.name, p.sku, p.barcode, p.product_no, v_q) as rank,
      coalesce((select sl.qty from public.erp_stock_levels sl where sl.warehouse_id = v_point and sl.product_id = p.id), 0) as here,
      coalesce((select sum(greatest(sl.qty, 0)) from public.erp_stock_levels sl
                where sl.product_id = p.id and sl.store_id = p_store and sl.warehouse_id is distinct from v_point), 0) as elsewhere,
      coalesce((select sum(greatest(sl.qty, 0)) from public.erp_stock_levels sl where sl.product_id = p.id and sl.store_id = p_store), 0) as total
    from public.products p
    where p.store_id = p_store
      and (v_status = 'all' or (v_status = 'active' and coalesce(p.active, true)) or (v_status = 'inactive' and not coalesce(p.active, true)))
      and (v_cat is null or p.category_id = v_cat
           or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = v_cat))
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, null, v_q)
  ), counts as (
    select count(*) as all_n,
      count(*) filter (where here > 0) as has_n,
      count(*) filter (where here <= 0) as missing_n,
      count(*) filter (where here <= 0 and elsewhere > 0) as elsewhere_n
    from base
  ), filtered as (
    select * from base
    where v_stock = 'all' or (v_stock = 'has' and here > 0) or (v_stock = 'missing' and here <= 0)
       or (v_stock = 'elsewhere' and here <= 0 and elsewhere > 0)
  ), page as (
    select * from filtered
    order by
      case when v_sort = 'here' then here end asc nulls last,
      case when v_sort = 'elsewhere' then elsewhere end desc nulls last,
      case when v_sort = 'total' then total end desc nulls last,
      rank desc,
      name
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from filtered),
    'counts', (select jsonb_build_object('all', all_n, 'has', has_n, 'missing', missing_n, 'elsewhere', elsewhere_n) from counts),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'name', pg.name, 'sku', pg.sku, 'barcode', pg.barcode, 'product_no', pg.product_no, 'image_url', pg.image_url, 'active', pg.active,
        'price', pg.price_1, 'cost', case when v_cost then pg.cost_price end,
        'here', pg.here, 'elsewhere', pg.elsewhere, 'total', pg.total,
        'levels', coalesce((select jsonb_object_agg(sl.warehouse_id::text, sl.qty) from public.erp_stock_levels sl
                            where sl.product_id = pg.id and sl.store_id = p_store and sl.qty <> 0), '{}'::jsonb))
        order by
          case when v_sort = 'here' then pg.here end asc nulls last,
          case when v_sort = 'elsewhere' then pg.elsewhere end desc nulls last,
          case when v_sort = 'total' then pg.total end desc nulls last,
          pg.rank desc,
          pg.name) from page pg), '[]'::jsonb),
    'points', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind, 'is_default', w.is_default)
                 order by w.kind desc, w.name), '[]'::jsonb)
               from public.erp_warehouses w where w.store_id = p_store and w.active),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
                   from public.product_categories c where c.store_id = p_store),
    'my_point', public.erp_my_point(p_store),
    'point_id', v_point,
    'can_edit', public.erp_can(p_store, 'products'),
    'can_request', public.erp_can_any(p_store, array['stock_requests', 'stock_requests_manage']::text[]),
    'show_cost', v_cost)
  into v_result;
  return v_result;
end;
$$;
grant execute on function public.erp_product_catalog_browse(uuid, jsonb, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Búsqueda por foto
-- ---------------------------------------------------------------------
-- Huella (vector de 512 números) de cada imagen de cada producto, por modelo.
create table if not exists public.product_image_vectors (
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null,
  model text not null,
  image_url text not null,
  embedding vector(512),
  failed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (product_id, model, image_url)
);
create index if not exists product_image_vectors_store on public.product_image_vectors (store_id, model);
alter table public.product_image_vectors enable row level security;
revoke all on public.product_image_vectors from anon, authenticated;

-- Imágenes de un producto que se analizan: la principal y hasta 3 de la galería.
create or replace function public.product__image_urls(p_image text, p_details jsonb, p_max integer default 4)
returns text[]
language plpgsql
immutable
as $$
declare v text[] := '{}'::text[]; u text;
begin
  if coalesce(p_image, '') ~* '^https?://' then v := array[p_image]; end if;
  if jsonb_typeof(p_details -> 'gallery_urls') = 'array' then
    for u in select jsonb_array_elements_text(p_details -> 'gallery_urls') loop
      exit when cardinality(v) >= p_max;
      if coalesce(u, '') ~* '^https?://' and not (u = any (v)) then v := v || u; end if;
    end loop;
  end if;
  return v;
end;
$$;

-- Si cambian las fotos del producto, se borran las huellas de las fotos que ya no están.
create or replace function public.products__image_vectors_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.image_url is distinct from old.image_url or new.product_details is distinct from old.product_details then
    delete from public.product_image_vectors v
    where v.product_id = new.id
      and not (v.image_url = any (public.product__image_urls(new.image_url, new.product_details)));
  end if;
  return null;
end;
$$;
drop trigger if exists products_image_vectors_cleanup on public.products;
create trigger products_image_vectors_cleanup after update of image_url, product_details on public.products
for each row execute function public.products__image_vectors_cleanup();

create or replace function public.product__can_index(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.erp_can_any(p_store, array['products', 'products_view', 'inventory', 'purchases', 'pos', 'stock_requests', 'stock_requests_manage', 'transfers']::text[]);
$$;

-- Imágenes que faltan por analizar (primero la foto principal de los productos activos).
create or replace function public.product_image_pending(p_store uuid, p_model text default 'mobileclip_s0', p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public.product__can_index(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Sin permiso.');
  end if;
  with imgs as (
    select p.id, u.url, u.ord, coalesce(p.active, true) as active
    from public.products p
    cross join lateral unnest(public.product__image_urls(p.image_url, p.product_details)) with ordinality as u(url, ord)
    where p.store_id = p_store
  ), todo as (
    select i.* from imgs i
    where not exists (
      select 1 from public.product_image_vectors x
      where x.product_id = i.id and x.model = p_model and x.image_url = i.url
        and (not x.failed or x.created_at > now() - interval '3 days'))
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', t.id, 'image_url', t.url))
                       from (select * from todo order by ord, active desc, id limit least(greatest(coalesce(p_limit, 8), 1), 40)) t), '[]'::jsonb),
    'pending', (select count(*) from todo),
    'total', (select count(*) from imgs),
    'ready', (select count(*) from public.product_image_vectors x where x.store_id = p_store and x.model = p_model and x.embedding is not null)
  ) into v;
  return v;
end;
$$;
grant execute on function public.product_image_pending(uuid, text, integer) to authenticated;

-- Guarda huellas: [{product_id, image_url, embedding: [512 números]}] o {product_id, image_url, failed: true}.
create or replace function public.product_image_save(p_store uuid, p_model text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare it jsonb; p public.products; v_count integer := 0; v_vec real[];
begin
  if not public.product__can_index(p_store) then raise exception 'Sin permiso.'; end if;
  if jsonb_typeof(p_items) <> 'array' or coalesce(p_model, '') !~ '^[a-z0-9_.-]{2,40}$' then return 0; end if;
  for it in select value from jsonb_array_elements(p_items) limit 60 loop
    select * into p from public.products where id = nullif(it ->> 'product_id', '')::uuid and store_id = p_store;
    continue when not found;
    continue when not ((it ->> 'image_url') = any (public.product__image_urls(p.image_url, p.product_details)));
    if coalesce((it ->> 'failed')::boolean, false) then
      insert into public.product_image_vectors (product_id, store_id, model, image_url, embedding, failed, created_at)
      values (p.id, p_store, p_model, it ->> 'image_url', null, true, now())
      on conflict (product_id, model, image_url) do update set failed = true, embedding = null, created_at = now();
    else
      continue when jsonb_typeof(it -> 'embedding') <> 'array' or jsonb_array_length(it -> 'embedding') <> 512;
      select array_agg(e.x::real order by e.o) into v_vec from jsonb_array_elements_text(it -> 'embedding') with ordinality as e(x, o);
      insert into public.product_image_vectors (product_id, store_id, model, image_url, embedding, failed, created_at)
      values (p.id, p_store, p_model, it ->> 'image_url', v_vec::vector, false, now())
      on conflict (product_id, model, image_url) do update set embedding = excluded.embedding, failed = false, created_at = now();
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.product_image_save(uuid, text, jsonb) to authenticated;

-- Parecido (0 a 1) de cada producto con la foto: el de su imagen más parecida.
create or replace function public.product__image_scores(p_store uuid, p_model text, p_embedding real[])
returns table (product_id uuid, score real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(cardinality(p_embedding), 0) <> 512 then raise exception 'Huella de imagen no válida.'; end if;
  return query
    select v.product_id, max(1 - (v.embedding <=> p_embedding::vector))::real
    from public.product_image_vectors v
    where v.store_id = p_store and v.model = p_model and v.embedding is not null
    group by v.product_id;
end;
$$;
revoke all on function public.product__image_scores(uuid, text, real[]) from public, anon, authenticated;

-- Catálogo público de la tienda: ids de los productos disponibles más parecidos.
create or replace function public.store_public_image_search(p_store uuid, p_embedding real[], p_model text default 'mobileclip_s0', p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with s as (
    select sc.product_id, sc.score
    from public.product__image_scores(p_store, p_model, p_embedding) sc
    join public.products p on p.id = sc.product_id and coalesce(p.active, true) and (p.stock is null or p.stock > 0)
    join public.stores st on st.id = p.store_id and st.active and (st.active_until is null or st.active_until > now())
    order by sc.score desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
  )
  select jsonb_build_object(
    'indexed', (select count(distinct v.product_id) from public.product_image_vectors v where v.store_id = p_store and v.model = p_model and v.embedding is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', s.product_id, 'score', round(s.score::numeric, 4)) order by s.score desc) from s), '[]'::jsonb)
  );
$$;
grant execute on function public.store_public_image_search(uuid, real[], text, integer) to anon, authenticated;

-- Catálogos de RemHub Social: los productos visibles más parecidos, con su precio del catálogo.
create or replace function public.catalog_public_image_search(
  p_store text, p_catalog text, p_key text, p_embedding real[], p_model text default 'mobileclip_s0', p_limit integer default 24
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_catalog uuid; v_store uuid; v_rules boolean; v_result jsonb;
begin
  v_catalog := public.catalog__access(p_store, p_catalog, p_key);
  if v_catalog is null then raise exception 'Este catálogo no está disponible.'; end if;
  select store_id, wholesale_rules into v_store, v_rules from public.store_catalogs where id = v_catalog;

  with s as (
    select sc.product_id, sc.score from public.product__image_scores(v_store, p_model, p_embedding) sc
  ), items as (
    select i.*, s.score, p.name, p.description, p.image_url, p.product_details, p.min_wholesale, p.sku
    from s
    join public.catalog__items(v_catalog, array(select product_id from s)) i on i.product_id = s.product_id
    join public.products p on p.id = i.product_id
    where not i.category_hidden and i.price > 0 and (i.stock is null or i.stock > 0)
    order by s.score desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
  )
  select jsonb_build_object(
    'indexed', (select count(*) from s),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', it.product_id, 'name', it.name, 'description', it.description, 'image_url', it.image_url,
      'price', it.price, 'price_retail', it.price, 'price_wholesale', it.price,
      'min_wholesale', case when v_rules then greatest(1, coalesce(it.min_wholesale, 1)) end,
      'stock', it.stock, 'category_id', it.category_key, 'featured', it.featured,
      'active', true, 'product_details', it.product_details, 'code', it.sku, 'score', round(it.score::numeric, 4)
    ) order by it.score desc) from items it), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function public.catalog_public_image_search(text, text, text, real[], text, integer) to anon, authenticated;

-- Buscador del panel (productos, lista general, POS) por nombre o código, para cualquier usuario del equipo.
create or replace function public.erp_product_finder(p_store uuid, p_q text, p_active_only boolean default false, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  if not public.product__can_index(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para buscar productos.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) - 'rank' order by t.rank desc, t.name), '[]'::jsonb) into v
  from (
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active,
           p.price_1, p.price_3, p.stock, public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_q) as rank
    from public.products p
    where p.store_id = p_store
      and (not coalesce(p_active_only, false) or coalesce(p.active, true))
      and cardinality(public.product__tokens(p_q)) > 0
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, null, p_q)
    order by rank desc, p.name
    limit least(greatest(coalesce(p_limit, 30), 1), 60)
  ) t;
  return jsonb_build_object('ok', true, 'items', v);
end;
$$;
grant execute on function public.erp_product_finder(uuid, text, boolean, integer) to authenticated;

-- Panel (productos, lista general, POS): todos los productos de la tienda.
create or replace function public.erp_product_image_search(
  p_store uuid, p_embedding real[], p_model text default 'mobileclip_s0', p_limit integer default 24, p_active_only boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  if not public.product__can_index(p_store) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'No tienes permiso para buscar productos.');
  end if;
  with s as (
    select sc.product_id, sc.score from public.product__image_scores(p_store, p_model, p_embedding) sc
  ), best as (
    select p.id, p.name, p.sku, p.barcode, p.product_no, p.image_url, coalesce(p.active, true) as active,
           p.price_1, p.price_3, p.stock, s.score
    from s join public.products p on p.id = s.product_id and p.store_id = p_store
    where not coalesce(p_active_only, false) or coalesce(p.active, true)
    order by s.score desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
  )
  select jsonb_build_object(
    'ok', true,
    'indexed', (select count(*) from s),
    'items', coalesce((select jsonb_agg(to_jsonb(b) order by b.score desc) from best b), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
grant execute on function public.erp_product_image_search(uuid, real[], text, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
