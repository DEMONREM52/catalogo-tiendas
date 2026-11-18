// Pruebas de 20261325: el buscador encuentra por el código del proveedor; costo de la última compra; ajuste del aviso.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema if not exists extensions; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.stores (id uuid primary key default gen_random_uuid(), owner_id uuid);
create table public.store_users (store_id uuid, user_id uuid, role text, active boolean default true, permissions text[]);
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, sku text, barcode text,
  product_no integer, active boolean default true, auto_inactive boolean not null default false, stock integer, cost_price numeric, tax_rate numeric);
create table public.erp_stock_levels (warehouse_id uuid, product_id uuid, qty integer);
create table public.erp_suppliers (id uuid primary key default gen_random_uuid(), store_id uuid, name text);
create table public.erp_purchases (id uuid primary key default gen_random_uuid(), store_id uuid, number bigint, supplier_id uuid,
  status text default 'received', created_at timestamptz default now());
create table public.erp_purchase_items (id uuid primary key default gen_random_uuid(), purchase_id uuid, product_id uuid, qty integer, unit_cost numeric);
create table public.erp_supplier_item_map (store_id uuid, supplier_id uuid, supplier_code text, product_id uuid, description text,
  updated_by uuid, updated_at timestamptz default now(), primary key (supplier_id, supplier_code));
create function public.erp_can(s uuid, p text) returns boolean language sql stable as $$
  select auth.uid() is not null and (exists (select 1 from public.stores x where x.id = s and x.owner_id = auth.uid())
    or exists (select 1 from public.store_users u where u.store_id = s and u.user_id = auth.uid() and u.active and (u.role = 'store_admin' or p = any(u.permissions)))) $$;
create function public.erp_can_any(s uuid, p text[]) returns boolean language sql stable as $$
  select exists (select 1 from unnest(p) x where public.erp_can(s, x)) $$;
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
create function public.erp_search_products(p_store uuid, p_q text, p_warehouse uuid default null, p_in_stock boolean default false, p_limit integer default 20, p_include_inactive boolean default false)
returns table(id uuid) language sql stable as $$ select null::uuid $$;
`);
const M = fs.readFileSync(path.join(MIG, "20261325_codigos_proveedor_y_costo.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const U = (n) => `cd000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), BUYER = U(2), SELLER = U(3), ADMIN = U(4);
const [{ id: S }] = await raw("insert into stores (owner_id) values ($1) returning id", [OWNER]);
const [{ id: S2 }] = await raw("insert into stores (owner_id) values ($1) returning id", [U(9)]);
await raw("insert into store_users values ($1, $2, 'seller', true, '{purchases}'), ($1, $3, 'seller', true, '{pos}'), ($1, $4, 'store_admin', true, '{}')", [S, BUYER, SELLER, ADMIN]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'NEXT TECHNOLOGY') returning id", [S]);
const [{ id: SUP2 }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'ALZ') returning id", [S]);
const [{ id: CLOSET }] = await raw("insert into products (store_id, name, sku, cost_price) values ($1, 'CLOSET ARMABLE DE TELA', '529', 30000) returning id", [S]);
const [{ id: OTRO }] = await raw("insert into products (store_id, name, sku, cost_price) values ($1, 'ESTANTE 88130X', '600', 1000) returning id", [S]);
const [{ id: AJENO }] = await raw("insert into products (store_id, name, sku) values ($1, 'AJENO', '88130') returning id", [S2]);
await raw("insert into erp_supplier_item_map (store_id, supplier_id, supplier_code, product_id) values ($1, $2, '88130', $3)", [S, SUP, CLOSET]);

console.log("Códigos del proveedor en el buscador");
let r = await as(BUYER, "select * from public.erp_search_products($1, '88130')", [S]);
ok(r[0]?.id === CLOSET && r[0].supplier_code === "88130", "Buscar 88130 trae el CLOSET (código 529) primero y dice qué código coincidió", r);
ok(!r.some((x) => x.id === AJENO), "No trae productos de otra tienda");
r = await as(BUYER, "select * from public.erp_search_products($1, '529')", [S]);
ok(r[0]?.id === CLOSET && r[0].supplier_code === null, "Por su propio código sigue igual (sin código de proveedor)", r);
r = await as(BUYER, "select * from public.erp_search_products($1, ' 88130 ')", [S]);
ok(r[0]?.id === CLOSET, "Con espacios alrededor también");
r = await as(SELLER, "select * from public.erp_search_products($1, '88130')", [S]);
ok(r[0]?.id === CLOSET, "El POS también lo encuentra por ese código");

console.log("Ver y quitar códigos");
r = (await as(BUYER, "select public.erp_supplier_codes($1, $2) r", [S, CLOSET]))[0].r;
ok(r.ok && r.items.length === 1 && r.items[0].supplier === "NEXT TECHNOLOGY" && r.items[0].code === "88130", "Lista los códigos del producto", r);
ok((await as(SELLER, "select public.erp_supplier_codes($1, $2) r", [S, CLOSET]))[0].r.ok === false, "Sin permiso de Ingresos no los ve");
ok((await as(SELLER, "select public.erp_supplier_code_delete($1, $2, '88130') r", [S, SUP]))[0].r.ok === false, "Sin permiso no los quita");
ok((await as(BUYER, "select public.erp_supplier_code_delete($1, $2, '88130') r", [S2, SUP]))[0].r.ok === false, "No se quita desde otra tienda");
ok((await as(BUYER, "select public.erp_supplier_code_delete($1, $2, '88130') r", [S, SUP]))[0].r.ok === true, "Con permiso se quita");
ok((await raw("select count(*)::int n from erp_supplier_item_map"))[0].n === 0, "…y ya no está");

console.log("Costo de la última compra");
const buy = async (sup, n, at, items, status = "received") => {
  const [{ id }] = await raw("insert into erp_purchases (store_id, number, supplier_id, created_at, status) values ($1, $2, $3, $4, $5) returning id", [S, n, sup, at, status]);
  for (const [p, c] of items) await raw("insert into erp_purchase_items (purchase_id, product_id, qty, unit_cost) values ($1, $2, 1, $3)", [id, p, c]);
  return id;
};
await buy(SUP, 1, "2026-10-01", [[CLOSET, 25000]]);
const P2 = await buy(SUP2, 2, "2026-11-01", [[CLOSET, 30000], [OTRO, 900]]);
await buy(SUP, 3, "2026-11-10", [[CLOSET, 99000]], "cancelled");
r = (await as(BUYER, "select public.erp_purchase_last_costs($1, $2::uuid[]) r", [S, [CLOSET, OTRO]]))[0].r;
const c = r.items.find((x) => x.product_id === CLOSET);
ok(r.ok && Number(c.unit_cost) === 30000 && Number(c.number) === 2 && c.supplier === "ALZ", "La última compra no anulada: $30.000 del ingreso #2 (no el promedio)", r);
ok(Number(r.alert_pct) === 20 && r.can_config === false, "Avisa desde 20 % por defecto; quien compra no lo cambia", r);
r = (await as(BUYER, "select public.erp_purchase_last_costs($1, $2::uuid[], $3) r", [S, [CLOSET], P2]))[0].r;
ok(Number(r.items[0].unit_cost) === 25000, "Al editar el #2, se compara con la compra anterior ($25.000)", r);
ok((await as(SELLER, "select public.erp_purchase_last_costs($1, $2::uuid[]) r", [S, [CLOSET]]))[0].r.ok === false, "Sin permiso de Ingresos no ve costos");

console.log("Ajuste del aviso");
ok((await as(BUYER, "select public.erp_purchase_settings_set($1, 10) r", [S]))[0].r.ok === false, "Quien solo compra no cambia el %");
ok((await as(OWNER, "select public.erp_purchase_settings_set($1, 0) r", [S]))[0].r.ok === false, "No acepta 0 %");
ok((await as(ADMIN, "select public.erp_purchase_settings_set($1, 15) r", [S]))[0].r.ok === true, "El administrador sí");
r = (await as(OWNER, "select public.erp_purchase_last_costs($1, $2::uuid[]) r", [S, [CLOSET]]))[0].r;
ok(Number(r.alert_pct) === 15 && r.can_config === true, "Queda en 15 % y el dueño puede cambiarlo", r);
ok((await as(U(9), "select public.erp_purchase_settings_set($1, 30) r", [S]))[0].r.ok === false, "El dueño de otra tienda no");
ok(await as(OWNER, "select public.erp__store_boss($1)", [S]).then(() => false, () => true), "El helper interno no se puede llamar desde la API");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
