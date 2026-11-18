// Pruebas de 20261324: el buscador del ingreso también trae productos inactivos (solo si se pide y con permiso).
// Las funciones internas de búsqueda se simulan igual que en busqueda_rapida.test.mjs.
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
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, sku text, barcode text,
  product_no integer, active boolean default true, auto_inactive boolean not null default false, stock integer, cost_price numeric, tax_rate numeric);
create table public.erp_stock_levels (warehouse_id uuid, product_id uuid, qty integer);
create table public.perms (store_id uuid, perm text);
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
-- Permisos simulados: la tabla perms dice qué tiene quien busca.
create function public.erp_can_any(s uuid, p text[]) returns boolean language sql stable as $$
  select exists (select 1 from public.perms x where x.store_id = s and x.perm = any(p)) $$;
-- La versión de antes (20261204 + 20261210), para comprobar que sin el nuevo parámetro nada cambia.
create function public.erp_search_products(p_store uuid, p_q text, p_warehouse uuid default null, p_in_stock boolean default false, p_limit integer default 20)
returns table(id uuid, name text) language sql stable as $$ select null::uuid, 'vieja'::text $$;
`);
const M = fs.readFileSync(path.join(MIG, "20261324_ingreso_con_inactivos.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const S = "aa000000-0000-0000-0000-000000000001";
const W = "bb000000-0000-0000-0000-000000000001";
const add = async (name, sku, active, auto = false) =>
  (await raw("insert into products (store_id, name, sku, active, auto_inactive, stock, cost_price) values ($1, $2, $3, $4, $5, 0, 17400) returning id", [S, name, sku, active, auto]))[0].id;
const ACT = await add("IRRIGADOR BUCAL PORTATIL", "484", true);
const MANO = await add("IRRIGADOR DENTAL VIAJE", "485", false);
const SOLO = await add("IRRIGADOR NASAL", "486", false, true);
const setPerms = async (...p) => { await raw("delete from perms"); for (const x of p) await raw("insert into perms values ($1, $2)", [S, x]); };
const search = (q, inc) => inc === undefined
  ? raw("select * from public.erp_search_products($1, $2, $3, false, 20)", [S, q, W])
  : raw("select * from public.erp_search_products($1, $2, $3, false, 20, $4)", [S, q, W, inc]);
const ids = (rows) => rows.map((r) => r.id);

console.log("Buscador");
ok((await raw("select count(*)::int n from pg_proc where proname = 'erp_search_products'"))[0].n === 1, "Queda una sola versión (sin ambigüedad para la API)");
await setPerms("purchases");
let r = await search("irrigador");
ok(ids(r).includes(ACT) && ids(r).includes(SOLO) && !ids(r).includes(MANO), "Sin pedirlo: igual que antes (activos + apagados solos por unidades)", r);
r = await search("irrigador", false);
ok(!ids(r).includes(MANO), "p_include_inactive = false: tampoco trae el inactivo a mano");
r = await search("irrigador", true);
ok(ids(r).includes(MANO) && r.length === 3, "Con permiso de Ingresos y pidiéndolo: trae también el inactivo a mano", r);
const m = r.find((x) => x.id === MANO), s = r.find((x) => x.id === SOLO), a = r.find((x) => x.id === ACT);
ok(m.active === false && m.auto_inactive === false && s.active === false && s.auto_inactive === true && a.active === true, "Devuelve si está activo y si se apagó solo", r);
ok(r[r.length - 1].id === MANO, "A igual coincidencia, el inactivo a mano sale de último", r.map((x) => x.name));
r = await search("485", true);
ok(r.length === 1 && r[0].id === MANO, "Por código también lo encuentra", r);
await setPerms("products");
ok(ids(await search("irrigador", true)).includes(MANO), "Con permiso de Productos también");
await setPerms("inventory");
ok(ids(await search("irrigador", true)).includes(MANO), "Con permiso de Inventario también");
await setPerms("pos");
r = await search("irrigador", true);
ok(!ids(r).includes(MANO) && ids(r).includes(ACT), "Solo con permiso de POS: se ignora (no ve los inactivos)", r);
await setPerms();
ok(await search("irrigador", true).then(() => false, (e) => /permiso/.test(e.message)), "Sin permisos: no consulta nada");

console.log("Acceso");
const grants = await raw(`select grantee from information_schema.routine_privileges
  where routine_name = 'erp_search_products' and privilege_type = 'EXECUTE'`);
const who = grants.map((g) => g.grantee);
ok(who.includes("authenticated") && !who.includes("anon") && !who.includes("PUBLIC"), "Solo con sesión (anon no la ejecuta)", who);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
