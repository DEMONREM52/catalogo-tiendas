// Pruebas de 20261309 (ofertas «antes/ahora» y destacados en catálogos y POS).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Lo que en producción ya existe y aquí se simula (mismas firmas).
const extra = `
alter table public.store_catalogs add column if not exists slug text;
alter table public.store_catalogs add column if not exists access_key text;
create table if not exists public.erp_price_rules (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, status text);
create table if not exists public.erp_profit_settings (store_id uuid primary key, rounding_step numeric, rounding_dir text);
create or replace function public.erp__rule_for(p_store uuid, p_point uuid, p_product uuid) returns table (id uuid) language sql stable as $$ select null::uuid where false $$;
create or replace function public.erp__point_price(p public.products, l integer, r record, s numeric, d text) returns numeric language plpgsql stable as $$ begin return 0; end $$;
create or replace function public.catalog__access(p_store text, p_catalog text, p_key text) returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.store_catalogs c join public.stores s on s.id = c.store_id
  where s.slug = p_store and c.slug = p_catalog and (c.access_key is null or c.access_key = p_key) $$;
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.permissions && p_perms)) $$;
create or replace function public.pub__user_name(p_store uuid) returns text language sql stable as $$ select 'Usuario'::text $$;
create table if not exists public.erp_promotions (
  id uuid primary key default gen_random_uuid(), store_id uuid not null, name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('pct', 'price')), value numeric(14, 2) not null check (value >= 0),
  scope text not null check (scope in ('all', 'category', 'product')), category_id uuid, product_ids uuid[] not null default '{}',
  point_ids uuid[] not null default '{}', starts_at timestamptz not null default now(), ends_at timestamptz not null,
  active boolean not null default true, created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  check (kind <> 'pct' or value between 1 and 90), check (ends_at > starts_at));
`;
const combined = path.join(os.tmpdir(), `remhub_ofertas_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const anon = async (s, p) => { await db.exec("set role anon"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); } };

const U = (n) => `b0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PRECIOS = U(2), SOLO = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('tienda', 'Tienda', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1,$2,'seller','{products,products_prices}'), ($1,$3,'seller','{products}')", [A, PRECIOS, SOLO]);
const [{ id: DET }] = await raw("insert into store_catalogs (store_id, name, slug, price_level, include_all_products) values ($1, 'Detal', 'detal', 3, true) returning id", [A]);
await raw("insert into store_catalogs (store_id, name, slug, price_level, include_all_products, access_key) values ($1, 'Mayor', 'mayor', 1, true, 'k1')", [A]);
const prod = async (name, p3, p1 = p3) => (await raw("insert into products (store_id, name, price_1, price_3, stock, active) values ($1, $2, $3, $4, 10, true) returning id", [A, name, p1, p3]))[0].id;
const P = await prod("Patineta", 20000, 16000), Q = await prod("Carro", 10000);

const M = fs.readFileSync(path.join(MIG, "20261309_ofertas_destacados.sql"), "utf8");
await db.exec(M); await db.exec(M);

const price = async (cat, id) => Number((await raw("select price from public.catalog__items($1, array[$2]::uuid[])", [cat, id]))[0]?.price);
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;

console.log("1. Sin oferta: el precio de siempre");
ok(await price(DET, P) === 20000, "Detal: $20.000");

console.log("2. Permisos");
ok((await call(SOLO, "product_offer_save($1, $2, $3, null, false, null)", [A, P, 15000])).ok === false, "Sin «Cambiar precios» no pone ofertas");
ok((await call(SOLO, "product_offer_get($1, $2)", [A, P])).can_edit === false, "…y ve que no puede editar");

console.log("3. Oferta a $15.000");
let r = await call(PRECIOS, "product_offer_save($1, $2, $3, null, true, $4)", [A, P, 15000, "Oferta"]);
ok(r.ok && r.offer.running && Number(r.offer.offer_price) === 15000 && r.offer.featured, "Se guarda (y destacado)", r);
ok(await price(DET, P) === 15000, "El catálogo cobra $15.000");
const promo = await raw("select kind, value, scope, product_ids from erp_promotions where store_id = $1", [A]);
ok(promo.length === 1 && promo[0].kind === "price" && Number(promo[0].value) === 15000 && promo[0].product_ids[0] === P, "Queda como promoción para el POS", promo);
const [{ count: before }] = await raw("select count(*)::int count from products where id = $1 and price_3 = 20000", [P]);
ok(before === 1, "Los precios guardados no cambian");
let pub = (await anon("select public.store_public_offers('tienda', 'detal', null) r"))[0].r;
let it = pub.items.find((x) => x.id === P);
ok(it && Number(it.before) === 20000 && Number(it.now) === 15000 && Number(it.pct) === 25 && it.label === "Oferta" && it.featured, "Público: antes $20.000, ahora $15.000, -25 %", pub);
ok(!pub.items.some((x) => x.id === Q), "Un producto sin oferta no sale");
ok((await anon("select public.store_public_offers('tienda', 'mayor', 'mala') r"))[0].r.items.length === 0, "Catálogo con clave: sin la clave no muestra nada");
pub = (await anon("select public.store_public_offers('tienda', 'mayor', 'k1') r"))[0].r;
ok(Number(pub.items.find((x) => x.id === P)?.before) === 16000 && Number(pub.items.find((x) => x.id === P)?.pct) === 6, "Mayor (con clave): antes $16.000, ahora $15.000, -6 %", pub);
ok(await price((await raw("select id from store_catalogs where slug = 'mayor'"))[0].id, P) === 15000, "Mayor: también baja a $15.000 (la oferta es menor)");

console.log("4. Una oferta más cara que el precio no sube el precio");
await call(OWNER, "product_offer_save($1, $2, $3, null, false, null)", [A, Q, 12000]);
ok(await price(DET, Q) === 10000, "Sigue en $10.000");

console.log("5. Con fecha y al vencer");
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
r = await call(OWNER, "product_offer_save($1, $2, $3, $4, false, null)", [A, P, 14000, tomorrow]);
ok(r.ok && r.offer.ends_at, "Hasta mañana", r);
ok(await price(DET, P) === 14000, "Ahora $14.000");
ok((await raw("select count(*)::int n from erp_promotions where store_id = $1 and $2 = any(product_ids)", [A, P]))[0].n === 1, "No duplica la promoción");
pub = (await anon("select public.store_public_offers('tienda', 'detal', null) r"))[0].r;
ok(pub.items.find((x) => x.id === P)?.ends_at, "Público: con fecha de fin (cuenta regresiva)");
await raw("update erp_promotions set starts_at = now() - interval '3 days', ends_at = now() - interval '1 minute' where $1 = any(product_ids)", [P]);
await raw("update erp_product_offers set ends_at = now() - interval '1 minute' where product_id = $1", [P]);
ok(await price(DET, P) === 20000, "Vencida: vuelve sola a $20.000");
ok((await call(OWNER, "product_offer_save($1, $2, $3, $4, false, null)", [A, P, 14000, "2020-01-01"])).ok === false, "Fecha pasada: no");

console.log("6. Quitar la oferta");
r = await call(OWNER, "product_offer_save($1, $2, null, null, false, null)", [A, P]);
ok(r.ok && r.offer === null, "Sin oferta ni destacado: se borra", r);
ok((await raw("select count(*)::int n from erp_promotions where $1 = any(product_ids)", [P]))[0].n === 0, "Y su promoción también");
ok(await price(DET, P) === 20000, "Precio normal");

console.log("7. Promociones del módulo «Promociones» también aplican en catálogos");
await raw("insert into erp_promotions (store_id, name, kind, value, scope, ends_at) values ($1, 'Todo 10%', 'pct', 10, 'all', now() + interval '1 day')", [A]);
ok(await price(DET, Q) === 9000, "10 % en toda la tienda: $9.000");

console.log("8. Destacar varios (20261310)");
const M2 = fs.readFileSync(path.join(MIG, "20261310_destacar_varios.sql"), "utf8");
await db.exec(M2); await db.exec(M2);
await call(OWNER, "product_offer_save($1, $2, $3, null, false, $4)", [A, P, 15000, "Oferta"]);
ok((await call(SOLO, "product_featured_set($1, $2, true)", [A, [P, Q]])).ok === false, "Sin «Cambiar precios»: no");
r = await call(PRECIOS, "product_featured_set($1, $2, true)", [A, [P, Q]]);
ok(r.ok && r.count === 2, "Destaca dos", r);
let rows = await raw("select product_id, featured, offer_price from erp_product_offers where store_id = $1 order by offer_price nulls last", [A]);
ok(rows.length === 2 && rows.every((x) => x.featured) && rows.some((x) => x.product_id === P && Number(x.offer_price) === 15000), "No toca la oferta que ya tenía", rows);
ok((await price(DET, Q)) === 9000 && (await raw("select featured from catalog__items($1, array[$2]::uuid[])", [DET, Q]))[0].featured === true, "Sale como destacado en el catálogo");
r = await call(PRECIOS, "product_featured_set($1, $2, false)", [A, [P, Q]]);
rows = await raw("select product_id, featured from erp_product_offers where store_id = $1", [A]);
ok(r.ok && rows.length === 2 && rows.every((x) => x.featured === false), "Al quitar: las ofertas siguen, sin destacado", rows);
await call(OWNER, "product_offer_save($1, $2, null, null, false, null)", [A, Q]);
await call(PRECIOS, "product_featured_set($1, $2, true)", [A, [Q]]);
await call(PRECIOS, "product_featured_set($1, $2, false)", [A, [Q]]);
ok((await raw("select count(*)::int n from erp_product_offers where product_id = $1", [Q]))[0].n === 0, "Sin oferta ni etiqueta: la fila se borra");
await raw("insert into store_catalog_products (catalog_id, product_id, store_id, featured) values ($1, $2, $3, true)", [DET, Q, A]);
pub = (await anon("select public.store_public_offers('tienda', 'detal', null) r"))[0].r;
ok(pub.items.some((x) => x.id === Q && x.featured), "Destacado propio del catálogo sale en la franja pública", pub);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
