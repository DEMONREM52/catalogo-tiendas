// Pruebas de 20261329: etiquetas del producto en el catálogo (nuevo, bajó de precio, promoción, destacado con fechas).
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
const combined = path.join(os.tmpdir(), `remhub_etiquetas_${process.pid}.sql`);
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

const B = fs.readFileSync(path.join(MIG, "20261329_etiquetas_catalogo.sql"), "utf8");
await db.exec(B); await db.exec(B);

const price = async (cat, id) => Number((await raw("select price from public.catalog__items($1, array[$2]::uuid[])", [cat, id]))[0]?.price);
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;
const pub = async (cat = "detal", key = null) => (await anon("select public.store_public_offers('tienda', $1, $2) r", [cat, key]))[0].r.items;
const find = async (id, cat, key) => (await pub(cat, key)).find((x) => x.id === id);
const [{ t: TODAY }] = await raw("select (now() at time zone 'America/Bogota')::date::text t");
const plus = async (n) => (await raw("select ($1::date + $2::integer)::text d", [TODAY, n]))[0].d;
const badge = (u, id, kind, on, starts = null, ends = null, before = null, text = null) =>
  call(u, "product_badge_save($1, $2, $3, $4, $5, $6, $7, $8)", [A, id, kind, on, starts, ends, before, text]);

console.log("1. Lo de siempre no cambia");
ok(await price(DET, P) === 20000, "Sin nada: el precio del catálogo");
ok((await pub()).length === 0, "Sin ofertas ni etiquetas: no hay nada que mostrar");
ok((await call(PRECIOS, "product_offer_save($1, $2, 15000, null, false, 'Oferta')", [A, P])).ok, "Oferta de verdad (20261309)");
let d = await find(P);
ok(d && Number(d.now) === 15000 && Number(d.before) === 20000 && Number(d.pct) === 25 && d.label === "Oferta", "La oferta se ve igual que antes: antes $20.000, ahora $15.000, -25 %", d);
ok(await price(DET, P) === 15000, "…y se cobra $15.000");

console.log("2. Permisos");
ok((await badge(U(9), Q, "new", true)).ok === false, "Alguien de fuera no pone etiquetas");
ok((await badge(SOLO, Q, "price_drop", true, null, null, 15000)).ok === false, "Con solo «Productos» no pone «Bajó de precio» (muestra un precio)");
ok((await badge(SOLO, Q, "new", true)).ok === true, "Con «Productos» sí pone «Llegó nuevo»");
ok((await call(SOLO, "product_badges_get($1, $2)", [A, Q])).can_price === false, "…y sabe que no puede poner precios");

console.log("3. Llegó nuevo");
d = await find(Q);
ok(d && d.badges.includes("new") && !d.before && Number(d.now) === 10000, "🆕 Nuevo se ve en el catálogo, sin cambiar el precio", d);
ok(await price(DET, Q) === 10000, "El precio que se cobra no cambia");
await badge(SOLO, Q, "new", true, await plus(3), await plus(10));
ok(!(await find(Q)), "Programado para dentro de 3 días: hoy no se ve");
ok((await call(SOLO, "product_badges_get($1, $2)", [A, Q])).items[0].running === false, "…y en el producto sale como programado");
ok((await badge(SOLO, Q, "new", true, null, await plus(-1))).ok === false, "Con «hasta» en el pasado: no");
await badge(SOLO, Q, "new", false);
ok((await call(SOLO, "product_badges_get($1, $2)", [A, Q])).items.length === 0, "Se quita");

console.log("4. Bajó de precio (el «antes» lo escribe la persona)");
ok((await badge(PRECIOS, Q, "price_drop", true)).ok === false, "Sin precio de antes: no");
await badge(PRECIOS, Q, "price_drop", true, null, await plus(5), 12000);
d = await find(Q);
ok(d && Number(d.before) === 12000 && Number(d.now) === 10000 && Number(d.pct) === 17 && d.label === "Bajó de precio" && d.badges.includes("price_drop") && d.ends_at, "Antes $12.000 tachado, ahora $10.000 (-17 %), hasta la fecha", d);
ok(await price(DET, Q) === 10000, "Se sigue cobrando $10.000");
await badge(PRECIOS, Q, "price_drop", true, null, null, 9000);
d = await find(Q);
ok(d && !d.before && !d.badges.includes("price_drop"), "Si el «antes» no es mayor que el precio de hoy, no se muestra (no engaña)", d);
await badge(PRECIOS, P, "price_drop", true, null, null, 30000);
d = await find(P);
ok(Number(d.before) === 20000 && d.label === "Oferta" && !d.badges.includes("price_drop"), "Con una oferta de verdad, manda la oferta", d);
await badge(PRECIOS, Q, "price_drop", false); await badge(PRECIOS, P, "price_drop", false);

console.log("5. En promoción");
await badge(SOLO, Q, "promo", true, null, null, null, "  2x1 en todo el mes, aprovecha ya mismo esta  ");
d = await find(Q);
ok(d && d.badges.includes("promo") && d.promo_text.length <= 30 && d.promo_text.startsWith("2x1"), "🔥 En promoción con su texto (máx. 30)", d);
await badge(SOLO, Q, "promo", false);

console.log("6. Destacado con fechas");
await badge(SOLO, Q, "featured", true, null, await plus(2));
ok((await raw("select featured from public.catalog__items($1, array[$2]::uuid[])", [DET, Q]))[0].featured === true, "Mientras esté activo, el catálogo lo trata como destacado (sale primero)");
d = await find(Q);
ok(d && d.featured === true && d.badges.includes("featured"), "Y se ve ⭐", d);
await raw("update erp_product_badges set starts_at = now() - interval '3 days', ends_at = now() - interval '1 minute' where product_id = $1", [Q]);
ok((await raw("select featured from public.catalog__items($1, array[$2]::uuid[])", [DET, Q]))[0].featured === false, "Al vencer se apaga solo");
ok(!(await find(Q)), "…y ya no se muestra");

console.log("7. Catálogo con clave");
await badge(SOLO, Q, "new", true);
ok(!(await find(Q, "mayor", "mala")), "Sin la clave del catálogo no se ve nada");
ok(Boolean(await find(Q, "mayor", "k1")), "Con la clave sí");
ok(await anon("select * from erp_product_badges").then(() => false, () => true), "La tabla no se lee directo");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
