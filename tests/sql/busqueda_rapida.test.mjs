// Pruebas de 20261204: las búsquedas nuevas devuelven EXACTAMENTE lo mismo (y en el mismo orden) que las de producción.
// Las versiones viejas se copian tal cual de producción (supabase/scripts/consulta_rendimiento*.sql) con el sufijo _old.
// Las funciones internas de búsqueda (product__tokens, …) se simulan: ambas versiones usan las mismas.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema if not exists extensions;
create table public.stores (id uuid primary key default gen_random_uuid(), slug text, active boolean default true, active_until timestamptz);
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, description text, sku text, barcode text,
  product_no integer, active boolean default true, stock integer, cost_price numeric, tax_rate numeric, category_id uuid, image_url text,
  product_details jsonb, min_wholesale integer, price_3 numeric default 1000);
create table public.product_category_links (product_id uuid, category_id uuid);
create table public.store_catalogs (id uuid primary key default gen_random_uuid(), store_id uuid, slug text, wholesale_rules boolean default false);
create table public.erp_stock_levels (warehouse_id uuid, product_id uuid, qty integer);
create table public.erp_purchase_items (id uuid primary key default gen_random_uuid(), purchase_id uuid);

-- Funciones internas de búsqueda (simuladas, deterministas).
create function public.erp__norm_text(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')) $$;
create function public.product__tokens(q text) returns text[] language sql immutable as $$
  select coalesce(array(select x from regexp_split_to_table(public.erp__norm_text(q), '[^a-z0-9]+') x where x <> ''), '{}') $$;
create function public.product__code_key(q text) returns text language sql immutable as $$ select nullif(upper(btrim(coalesce(q, ''))), '') $$;
create function public.product__code_hit(sku text, bc text, no integer, k text) returns boolean language sql immutable as $$
  select k is not null and (upper(sku) = k or bc = k or no::text = k) $$;
create function public.product__haystack(n text, s text, b text, e text) returns text language sql immutable as $$
  select public.erp__norm_text(concat_ws(' ', n, s, b, e)) $$;
create function public.product__has_tokens(h text, t text[]) returns boolean language sql immutable as $$
  select cardinality(t) > 0 and not exists (select 1 from unnest(t) x where position(x in h) = 0) $$;
create function public.product__fuzzy(a text, b text) returns real language sql immutable as $$
  select case when a <> '' and position(left(a, 3) in b) > 0 then 0.6 else 0.1 end::real $$;
create function public.product__matches(p_name text, p_sku text, p_barcode text, p_no integer, p_extra text, p_q text) returns boolean
language sql stable as $$
  select cardinality(public.product__tokens(p_q)) = 0
    or public.product__code_hit(p_sku, p_barcode, p_no, public.product__code_key(p_q))
    or public.product__has_tokens(public.product__haystack(p_name, p_sku, p_barcode, p_extra), public.product__tokens(p_q))
    or (length(public.erp__norm_text(btrim(coalesce(p_q, '')))) >= 4
        and public.product__fuzzy(public.erp__norm_text(btrim(p_q)), public.erp__norm_text(p_name)) >= 0.5);
$$;
create function public.product__rank(p_name text, p_sku text, p_barcode text, p_no integer, p_q text) returns real language sql stable as $$
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
create function public.erp_can_any(s uuid, p text[]) returns boolean language sql as $$ select true $$;
create function public.catalog__access(p_store text, p_catalog text, p_key text) returns uuid language sql as $$
  select c.id from public.store_catalogs c join public.stores s on s.id = c.store_id where s.slug = p_store and c.slug = p_catalog $$;
create function public.catalog__items(p_catalog uuid, p_ids uuid[] default null)
returns table(product_id uuid, category_key uuid, price numeric, base_price numeric, stock integer, featured boolean, sort_order integer, category_hidden boolean)
language sql stable as $$
  select p.id, p.category_id, p.price_3, p.price_3, p.stock, (p.product_no % 7 = 0), (p.product_no % 3), false
  from public.store_catalogs c join public.products p on p.store_id = c.store_id and p.active where c.id = p_catalog $$;
`);

// Versiones de producción (sin cambios), renombradas a *_old.
await db.exec(`
CREATE OR REPLACE FUNCTION public.catalog_public_products_old(p_store text, p_catalog text, p_key text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_q text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
declare v_catalog uuid; v_rules boolean; v_result jsonb;
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
    select items.*, count(*) over () as total_count from items
    order by items.rank desc, items.featured desc, items.sort_order, items.name, items.product_id
    limit least(greatest(coalesce(p_limit, 30), 1), 60) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object('total', coalesce(max(page.total_count), 0),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', page.product_id, 'name', page.name, 'description', page.description, 'image_url', page.image_url,
      'price', page.price, 'price_retail', page.price, 'price_wholesale', page.price,
      'min_wholesale', case when v_rules then greatest(1, coalesce(page.min_wholesale, 1)) end,
      'stock', page.stock, 'category_id', page.category_key, 'featured', page.featured,
      'active', true, 'product_details', page.product_details, 'code', page.sku
    ) order by page.rank desc, page.featured desc, page.sort_order, page.name, page.product_id), '[]'::jsonb))
  into v_result from page;
  return v_result;
end; $function$;

CREATE OR REPLACE FUNCTION public.search_products_pro_old(p_store_id uuid, p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_status text DEFAULT 'all'::text, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF products LANGUAGE sql STABLE AS $function$
  select p.* from public.products p
  where p.store_id = p_store_id
    and (coalesce(p_status, 'all') not in ('active', 'inactive')
         or (p_status = 'active' and coalesce(p.active, true))
         or (p_status = 'inactive' and not coalesce(p.active, true)))
    and (p_category_id is null or p.category_id = p_category_id
         or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = p_category_id))
    and public.product__matches(p.name, p.sku, p.barcode, p.product_no, p.description, p_query)
  order by public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_query) desc, p.name, p.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public.store_public_search_old(p_store uuid, p_q text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE sql STABLE AS $function$
  with found as (
    select p.id, p.name, public.product__rank(p.name, p.sku, p.barcode, p.product_no, p_q) as rank
    from public.products p
    join public.stores s on s.id = p.store_id and s.active and (s.active_until is null or s.active_until > now())
    where p.store_id = p_store and coalesce(p.active, true) and (p.stock is null or p.stock > 0)
      and (p_category is null or p.category_id = p_category
           or exists (select 1 from public.product_category_links l where l.product_id = p.id and l.category_id = p_category))
      and public.product__matches(p.name, p.sku, p.barcode, p.product_no, p.description, p_q)
  ), page as (
    select id, rank, name from found order by rank desc, name, id
    limit least(greatest(coalesce(p_limit, 30), 1), 60) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object('total', (select count(*) from found),
    'ids', coalesce((select jsonb_agg(id order by rank desc, name, id) from page), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.erp_search_products_old(p_store uuid, p_q text, p_warehouse uuid DEFAULT NULL::uuid, p_in_stock boolean DEFAULT false, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, name text, sku text, barcode text, cost_price numeric, tax_rate numeric, stock integer, wh_qty integer, product_no integer)
 LANGUAGE plpgsql STABLE AS $function$
begin
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
end; $function$;
`);

// Datos: nombres parecidos, tildes, códigos, sin existencias, inactivos y otra tienda.
const [{ id: S }] = (await db.query("insert into stores (slug) values ('lavitrina') returning id")).rows;
const [{ id: S2 }] = (await db.query("insert into stores (slug) values ('otra') returning id")).rows;
await db.query("insert into store_catalogs (store_id, slug, wholesale_rules) values ($1, 'zamora', true)", [S]);
const C1 = "c1000000-0000-0000-0000-000000000001", C2 = "c1000000-0000-0000-0000-000000000002";
const W = "a1000000-0000-0000-0000-000000000001";
const names = ["Camiseta roja", "Camiseta azul", "CAMISETA", "Cámara digital", "Gorra negra", "Gorro de lana", "Pantalón jean", "Pantaloneta",
  "Zapato rojo", "Zapatilla blanca", "Correa cuero", "Camisa manga larga", "Medias deportivas", "Buzo capota", "Chaqueta jean"];
let no = 1;
for (let r = 0; r < 4; r++) for (const n of names) {
  const sku = `SKU${no}`;
  await db.query(`insert into products (store_id, name, description, sku, barcode, product_no, active, stock, category_id, price_3)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [S, r ? `${n} ${r}` : n, no % 4 === 0 ? "Algodón premium rojo" : null, sku, `77${no}`, no, no % 11 !== 0, no % 9 === 0 ? 0 : (no % 5 === 0 ? null : no),
      no % 2 ? C1 : C2, no % 13 === 0 ? 0 : 1000 + no]);
  if (no % 3 === 0) await db.query("insert into product_category_links values ((select id from products where product_no = $1 and store_id = $2), $3)", [no, S, C1]);
  if (no % 2 === 0) await db.query("insert into erp_stock_levels values ($1, (select id from products where product_no = $2 and store_id = $3), $4)", [W, no, S, no % 4]);
  no++;
}
await db.query("insert into products (store_id, name, sku, product_no, stock) values ($1, 'Camiseta otra tienda', 'SKU1', 1, 5)", [S2]);

await db.exec(fs.readFileSync(path.join(MIG, "20261204_busqueda_rapida.sql"), "utf8").replace(/notify pgrst[^;]*;/g, ""));

let pass = 0, fail = 0;
const same = (a, b, label) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) pass++; else { fail++; console.log("  ✘ " + label + "\n    viejo: " + JSON.stringify(a).slice(0, 300) + "\n    nuevo: " + JSON.stringify(b).slice(0, 300)); }
};
const one = async (sql, p) => (await db.query(sql, p)).rows;
const QUERIES = [null, "", "   ", "cami", "camiseta", "CAMISETA roja", "camara", "cámara", "pantalon jean", "SKU7", "7712", "12", "rojo", "algodon",
  "zapatx", "gorrx", "camis", "xyz", "jean 2", "de"];

for (const q of QUERIES) {
  for (const [cat, off] of [[null, 0], [null, 30], [C1, 0], [C2, 0]]) {
    const a = (await one("select public.catalog_public_products_old('lavitrina','zamora',null,$1,$2,30,$3) r", [cat, q, off]))[0].r;
    const b = (await one("select public.catalog_public_products('lavitrina','zamora',null,$1,$2,30,$3) r", [cat, q, off]))[0].r;
    same(a, b, `catálogo q=${JSON.stringify(q)} cat=${cat ? "sí" : "no"} desde=${off}`);
  }
  for (const [status, cat] of [["all", null], ["active", null], ["inactive", null], ["all", C1]]) {
    const a = await one("select * from public.search_products_pro_old($1,$2,50,0,$3,$4)", [S, q, status, cat]);
    const b = await one("select * from public.search_products_pro($1,$2,50,0,$3,$4)", [S, q, status, cat]);
    same(a, b, `panel q=${JSON.stringify(q)} estado=${status} cat=${cat ? "sí" : "no"}`);
  }
  for (const cat of [null, C1]) {
    const a = (await one("select public.store_public_search_old($1,$2,$3,30,0) r", [S, q, cat]))[0].r;
    const b = (await one("select public.store_public_search($1,$2,$3,30,0) r", [S, q, cat]))[0].r;
    same(a, b, `buscador catálogo q=${JSON.stringify(q)} cat=${cat ? "sí" : "no"}`);
  }
  for (const [wh, inStock] of [[null, false], [W, true]]) {
    const a = await one("select * from public.erp_search_products_old($1,$2,$3,$4,20)", [S, q, wh, inStock]);
    const b = await one("select * from public.erp_search_products($1,$2,$3,$4,20)", [S, q, wh, inStock]);
    same(a, b, `POS q=${JSON.stringify(q)} bodega=${wh ? "sí" : "no"} solo_con_existencias=${inStock}`);
  }
}
const any = (await one("select public.catalog_public_products('lavitrina','zamora',null,null,'camiseta',30,0) r"))[0].r;
if (any.total > 0 && any.items[0].name.toLowerCase().startsWith("camiseta")) pass++; else { fail++; console.log("  ✘ la búsqueda devuelve resultados útiles", any); }
const idx = (await one("select indexname from pg_indexes where tablename = 'erp_purchase_items'")).map((r) => r.indexname);
if (idx.includes("erp_purchase_items_purchase_id_idx")) pass++; else { fail++; console.log("  ✘ índice de líneas de factura", idx); }

console.log(`  ✔ ${pass} comparaciones idénticas (catálogo, panel, buscador del catálogo y POS)`);
console.log(`\n${pass} ok · ${fail} fallas`);
await db.close();
process.exitCode = fail ? 1 : 0;
