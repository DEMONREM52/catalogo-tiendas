// Pruebas de 20261341: buscar pedidos de clientes por producto (nombre sin tildes, código, parecido, punto y permiso).
// Las funciones internas de búsqueda se simulan igual que en ingreso_con_inactivos.test.mjs.
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
create schema if not exists auth;
create table public.who (uid uuid);
insert into public.who values ('cc000000-0000-0000-0000-000000000001');
create function auth.uid() returns uuid language sql stable as $$ select uid from public.who limit 1 $$;
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, sku text, barcode text, product_no integer);
create table public.orders (id uuid primary key default gen_random_uuid(), store_id uuid, created_at timestamptz default now(), point_id uuid);
create table public.order_items (id bigserial primary key, order_id uuid, product_id uuid, quantity numeric, price numeric);
create table public.perms (store_id uuid, perm text);
create table public.my_points (store_id uuid, point_id uuid);
create function public.erp_can(s uuid, p text) returns boolean language sql stable as $$
  select exists (select 1 from public.perms x where x.store_id = s and x.perm = p) $$;
-- Punto simulado: si hay fila en my_points, solo ve los pedidos de ese punto.
create function public.erp__order_visible(s uuid, o uuid) returns boolean language sql stable as $$
  select not exists (select 1 from public.my_points m where m.store_id = s)
      or exists (select 1 from public.orders x join public.my_points m on m.store_id = s and m.point_id = x.point_id where x.id = o) $$;
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
`);
const M = fs.readFileSync(path.join(MIG, "20261341_pedidos_por_producto.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const S = "aa000000-0000-0000-0000-000000000001";
const OTRA = "aa000000-0000-0000-0000-000000000002";
const P1 = "bb000000-0000-0000-0000-000000000001";
const P2 = "bb000000-0000-0000-0000-000000000002";
const prod = async (store, name, sku, barcode = null) =>
  (await raw("insert into products (store_id, name, sku, barcode) values ($1, $2, $3, $4) returning id", [store, name, sku, barcode]))[0].id;
const order = async (store, point, items, ago = "0 days") => {
  const id = (await raw(`insert into orders (store_id, point_id, created_at) values ($1, $2, now() - $3::interval) returning id`, [store, point, ago]))[0].id;
  for (const p of items) await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1000)", [id, p]);
  return id;
};
const BOLSO = await prod(S, "BOLSO PEQUEÑO CUERO", "88130", "7701234567890");
const BOLSO2 = await prod(S, "BOLSO GRANDE", "88131");
const AUDI = await prod(S, "AUDÍFONOS BLUETOOTH", "500");
const AJENO = await prod(OTRA, "BOLSO PEQUEÑO CUERO", "88130");
const O1 = await order(S, P1, [BOLSO, AUDI]);
const O2 = await order(S, P2, [BOLSO2]);
const O3 = await order(S, P1, [AUDI], "40 days");
const O4 = await order(OTRA, null, [AJENO]);
const search = async (q, since = null) => (await raw("select public.erp_orders_by_product($1, $2, $3) r", [S, q, since]))[0].r;
const ids = (r) => (r.items ?? []).map((i) => i.order_id);

console.log("Permiso");
let r = await search("bolso");
ok(r.ok === false && /Pedidos/.test(r.message), "Sin el permiso de Pedidos no busca", r);
await raw("insert into perms values ($1, 'orders')", [S]);
await raw("update who set uid = null");
r = await search("bolso");
ok(r.ok === false, "Sin sesión no busca", r);
await raw("update who set uid = 'cc000000-0000-0000-0000-000000000001'");

console.log("Nombre");
r = await search("bolso");
ok(r.ok && ids(r).length === 2 && ids(r).includes(O1) && ids(r).includes(O2), "«bolso» trae los dos pedidos con bolsos", r);
ok(!ids(r).includes(O4), "No trae pedidos de otra tienda");
r = await search("pequeño");
ok(ids(r).length === 1 && ids(r)[0] === O1, "«pequeño» (con ñ) encuentra PEQUEÑO", r);
r = await search("PEQUENO bolso");
ok(ids(r).length === 1 && ids(r)[0] === O1, "Sin tilde y en otro orden también", r);
r = await search("audifonos");
ok(ids(r).length === 2 && ids(r)[0] === O1 && ids(r)[1] === O3, "«audifonos» encuentra AUDÍFONOS, los más nuevos primero", r);
const o1 = r.items.find((i) => i.order_id === O1);
ok(JSON.stringify(o1.names) === JSON.stringify(["AUDÍFONOS BLUETOOTH"]), "Devuelve el nombre del producto que coincide", o1);

console.log("Códigos");
r = await search("88130");
ok(ids(r).length === 1 && ids(r)[0] === O1, "Por código del producto", r);
r = await search("7701234567890");
ok(ids(r).length === 1 && ids(r)[0] === O1, "Por código de barras", r);

console.log("Parecido");
r = await search("bolsso");
ok(r.ok && ids(r).length >= 1, "Con un error de escritura trae los más parecidos", r);
r = await search("zzzz");
ok(r.ok && ids(r).length === 0, "Nada parecido: lista vacía", r);
r = await search("   ");
ok(r.ok && ids(r).length === 0, "Búsqueda vacía: lista vacía", r);

console.log("Periodo");
r = await search("audifonos", new Date(Date.now() - 30 * 864e5).toISOString());
ok(ids(r).length === 1 && ids(r)[0] === O1, "Solo los pedidos desde la fecha pedida", r);

console.log("Punto");
await raw("insert into my_points values ($1, $2)", [S, P2]);
r = await search("bolso");
ok(ids(r).length === 1 && ids(r)[0] === O2, "Un usuario de punto solo ve los pedidos de su punto", r);
await raw("delete from my_points");

console.log("Acceso");
const g = await raw(`select has_function_privilege('anon', 'public.erp_orders_by_product(uuid, text, timestamptz)', 'execute') a,
                            has_function_privilege('authenticated', 'public.erp_orders_by_product(uuid, text, timestamptz)', 'execute') b`);
ok(g[0].a === false && g[0].b === true, "Solo usuarios con sesión pueden llamarla", g[0]);

console.log(`\n${pass} bien, ${fail} mal`);
if (fail) process.exit(1);
