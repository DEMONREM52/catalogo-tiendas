// Pruebas de 20261345: las funciones nuevas devuelven EXACTAMENTE lo mismo que las de producción
// (tests/sql/fixtures/prod_rendimiento_5.sql, renombradas «_old»), para varios usuarios y datos, y hacen
// menos revisiones de permiso. Los permisos (erp_can, erp_can_any) se simulan igual para ambas versiones
// y cuentan cuántas veces se llaman.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const db = new PGlite({ extensions: { pg_trgm } });
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });

await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth; create schema extensions;
create extension pg_trgm schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.stores (id uuid primary key default gen_random_uuid(), slug text, name text, owner_id uuid, active boolean default true,
  active_until timestamptz, created_at timestamptz default now());
create table public.user_profiles (user_id uuid primary key, role text);
create table public.store_users (store_id uuid, user_id uuid, role text default 'seller', active boolean default true, point_id uuid,
  point_ids uuid[], sell_point_ids uuid[], permissions text[] default '{}', primary key (store_id, user_id));
create table public.erp_warehouses (id uuid primary key default gen_random_uuid(), store_id uuid, name text, active boolean default true,
  kind text default 'point', status text default 'active');
create table public.product_categories (id uuid primary key default gen_random_uuid(), store_id uuid, name text, active boolean default true);
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, description text, sku text, barcode text,
  product_no integer, active boolean default true, stock integer, cost_price numeric, category_id uuid, image_url text, product_details jsonb,
  min_wholesale integer, price_1 numeric, price_2 numeric, price_3 numeric, price_4 numeric, price_5 numeric, created_at timestamptz default now());
create table public.product_category_links (product_id uuid, category_id uuid, store_id uuid, primary key (product_id, category_id));
create table public.erp_stock_levels (store_id uuid, warehouse_id uuid, product_id uuid, qty integer, primary key (warehouse_id, product_id));
create table public.erp_stock_requests (id uuid primary key default gen_random_uuid(), store_id uuid, number integer, status text, priority text,
  note text, needed_by date, from_point_id uuid, to_point_id uuid, requested_by_name text, handled_by_name text, created_at timestamptz,
  updated_at timestamptz, last_message_at timestamptz, closed_at timestamptz);
create table public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid, product_id uuid, qty_requested integer);
create table public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid, user_id uuid, user_name text,
  body text, kind text default 'text', created_at timestamptz);
create table public.erp_stock_request_reads (request_id uuid, user_id uuid, last_read_at timestamptz, primary key (request_id, user_id));
create table public.erp_payables (id uuid primary key default gen_random_uuid(), store_id uuid, status text, balance numeric, due_date date);
create table public.erp_transfers (id uuid primary key default gen_random_uuid(), store_id uuid, status text, created_at timestamptz,
  from_warehouse_id uuid, to_warehouse_id uuid);
create table public.orders (id uuid primary key default gen_random_uuid(), store_id uuid, status text, total numeric, created_at timestamptz, confirmed_at timestamptz);
create table public.erp_order_meta (order_id uuid primary key, store_id uuid, point_id uuid, doc_kind text);
create table public.store_catalog_orders (order_id uuid primary key, catalog_id uuid, store_id uuid, created_at timestamptz);
create table public.erp_receivables (id uuid primary key default gen_random_uuid(), store_id uuid, customer_id uuid, point_id uuid, status text,
  balance numeric, due_date date);
create table public.billing_customers (id uuid primary key default gen_random_uuid(), store_id uuid, credit_enabled boolean, credit_limit numeric);
create table public.store_catalogs (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, slug text, name text,
  active boolean default true, access_key text, wholesale_rules boolean default false, price_level integer default 3,
  fallback_price_level integer, include_all_products boolean default true);
create table public.store_catalog_products (catalog_id uuid, product_id uuid, catalog_category_id uuid, price_override numeric, featured boolean,
  sort_order integer, included boolean, primary key (catalog_id, product_id));
create table public.store_catalog_categories (id uuid primary key default gen_random_uuid(), catalog_id uuid, category_id uuid, visible boolean default true);
create table public.erp_profit_settings (store_id uuid primary key, rounding_step integer, rounding_dir text);
create table public.erp_price_rules (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, product_id uuid, status text,
  kind text, value numeric);
create table public.erp_product_offers (product_id uuid primary key, store_id uuid, offer_price numeric, ends_at timestamptz, featured boolean default false, label text);
create table public.erp_product_badges (product_id uuid, kind text, store_id uuid, starts_at timestamptz default now(), ends_at timestamptz,
  before_price numeric, text text, primary key (product_id, kind));
create table public.erp_promotions (id uuid primary key default gen_random_uuid(), store_id uuid, name text, kind text, value numeric, scope text,
  category_id uuid, product_ids uuid[] default '{}', point_ids uuid[] default '{}', starts_at timestamptz default now(), ends_at timestamptz,
  active boolean default true);
create table public.fiscal_documents (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, document_type text, status text,
  created_at timestamptz);
create table public.erp_pos_offline_issues (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, kind text, resolved_at timestamptz);
create table public.fiscal_point_configs (store_id uuid, point_id uuid, enabled boolean, fiscal_entity_id uuid, environment text);
create table public.erp_org_settings (store_id uuid primary key, fiscal_enabled boolean);

-- Permisos simulados (iguales para ambas versiones) y contador de llamadas.
create sequence public.perm_calls;
create function public.erp_can(p_store uuid, p_perm text) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  perform nextval('public.perm_calls');
  return exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
      or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and p_perm = any (su.permissions));
end $$;
create function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_perms) x where public.erp_can(p_store, x)) $$;
create function public.fiscal__view_perms() returns text[] language sql immutable as $$ select array['fiscal']::text[] $$;
create function public.fiscal__pick_range(p_point uuid, p_entity uuid, p_doc text, p_env text) returns uuid language sql stable as $$
  select case when p_env = 'production' then gen_random_uuid() end $$;
create function public.catalog__access(p_store text, p_catalog text, p_key text) returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.store_catalogs c join public.stores s on s.id = c.store_id
  where s.slug = p_store and c.slug = p_catalog and c.active and (c.access_key is null or c.access_key = p_key) $$;
create function public.catalog__price(p_product public.products, p_level integer) returns numeric language sql immutable as $$
  select case p_level when 1 then p_product.price_1 when 2 then p_product.price_2 when 4 then p_product.price_4 when 5 then p_product.price_5 else p_product.price_3 end $$;
create function public.erp__rule_for(p_store uuid, p_point uuid, p_product uuid, p_at timestamptz default now()) returns public.erp_price_rules
language sql stable as $$
  select r.* from public.erp_price_rules r where r.store_id = p_store and r.point_id = p_point and r.status = 'active'
    and (r.product_id = p_product or r.product_id is null) order by r.product_id nulls last limit 1 $$;
create function public.erp__point_price(p public.products, l integer, r public.erp_price_rules, s integer, d text) returns numeric language sql immutable as $$
  select case when r.kind = 'fixed' then round(r.value, 2) else round(coalesce(public.catalog__price(p, l), 0) * (1 + coalesce(r.value, 0) / 100), 2) end $$;
`);
// Precio de promoción (20261309, sin cambios).
const M1309 = fs.readFileSync(path.join(MIG, "20261309_ofertas_destacados.sql"), "utf8");
const promo = M1309.match(/create or replace function public\.catalog__promo_price[\s\S]*?\n\$\$;/)[0];
await db.exec("set check_function_bodies = off;");
await db.exec(promo);
await db.exec(fs.readFileSync(path.join(here, "fixtures/prod_rendimiento_5.sql"), "utf8"));
const NEW = fs.readFileSync(path.join(MIG, "20261345_funciones_rapidas.sql"), "utf8");
await db.exec("set check_function_bodies = on;");
await db.exec(NEW); await db.exec(NEW); // se puede correr dos veces

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 700) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const asUser = (uid) => db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
const calls = async () => Number((await raw("select last_value + (case when is_called then 0 else -1 end) n from public.perm_calls"))[0].n);

// Compara la versión vieja y la nueva en la misma consulta (mismo now()). Si una falla, las dos deben fallar igual.
async function same(label, uid, expr, params = [], { show = false } = {}) {
  await asUser(uid);
  const oldE = expr.replace(/public\.(\w+)\(/, "public.$1_old(");
  let a, b, ea, eb;
  const c0 = await calls();
  try { a = JSON.stringify((await raw(`select to_jsonb(${oldE}) v`, params))[0].v); } catch (e) { ea = e.message; }
  const c1 = await calls();
  try { b = JSON.stringify((await raw(`select to_jsonb(${expr}) v`, params))[0].v); } catch (e) { eb = e.message; }
  const c2 = await calls();
  const equal = ea || eb ? ea === eb : a === b;
  ok(equal, label + (show ? ` (permisos: ${c1 - c0} → ${c2 - c1})` : ""), equal ? undefined : { old: ea ?? a, new: eb ?? b });
  return { oldCalls: c1 - c0, newCalls: c2 - c1, value: b };
}

// ---------------------------------------------------------------- datos
const U = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), BODEGA = U(2), PUNTO1 = U(3), PUNTO2 = U(4), NADA = U(5), FUERA = U(6), AUDIT = U(7);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('tienda', 'Tienda', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'Otra', $1) returning id", [U(99)]);
const wh = async (store, name, kind = "point") => (await raw("insert into erp_warehouses (store_id, name, kind) values ($1, $2, $3) returning id", [store, name, kind]))[0].id;
const W0 = await wh(A, "Bodega", "warehouse"), W1 = await wh(A, "Punto Centro"), W2 = await wh(A, "Punto Norte"), WB = await wh(B, "Ajena");
await raw(`insert into store_users (store_id, user_id, role, point_id, point_ids, sell_point_ids, permissions) values
  ($1, $2, 'seller', null, null, null, '{stock_requests_manage,transfers,inventory,orders,payables,products,catalogs,pos,fiscal}'),
  ($1, $3, 'seller', $6, null, null, '{stock_requests,inventory,pos,orders,products,receivables}'),
  ($1, $4, 'seller', $7, '{}', array[$6]::uuid[], '{stock_requests,transfers,pos,costs_view,inventory,fiscal}'),
  ($1, $5, 'seller', null, null, null, '{}'),
  ($1, $8, 'seller', null, null, null, '{audit,costs_view,products}')`, [A, BODEGA, PUNTO1, PUNTO2, NADA, W1, W2, AUDIT]);
const USERS = { dueño: OWNER, bodega: BODEGA, "punto 1": PUNTO1, "punto 2 (vende en 1)": PUNTO2, "sin permisos": NADA, "de fuera": FUERA, auditor: AUDIT };

// Pedidos internos: todas las combinaciones de origen/destino y estados, con mensajes leídos y sin leer.
let rnd = 7; const R = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
const pts = [W0, W1, W2];
const statuses = ["pending", "preparing", "dispatched", "received", "cancelled"];
let num = 0;
for (const from of pts) for (const to of pts) {
  if (from === to) continue;
  for (const st of statuses) for (const age of [1, 30, 200]) {
    num++;
    const [{ id }] = await raw(`insert into erp_stock_requests (store_id, number, status, priority, from_point_id, to_point_id, requested_by_name,
      created_at, updated_at, last_message_at) values ($1, $2, $3, $4, $5, $6, 'Ana', now() - make_interval(days => $7) - make_interval(mins => $2),
      now() - make_interval(days => $7), case when $2 % 3 = 0 then now() - make_interval(hours => $2) end) returning id`,
      [A, num, st, num % 4 === 0 ? "urgent" : "normal", from, to, age]);
    await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) select $1, gen_random_uuid(), g from generate_series(1, $2) g", [id, 1 + (num % 3)]);
    for (let k = 0; k < num % 4; k++) {
      const author = [OWNER, BODEGA, PUNTO1, PUNTO2][(num + k) % 4];
      await raw("insert into erp_stock_request_messages (request_id, user_id, user_name, body, created_at) values ($1, $2, 'X', $3, now() - make_interval(hours => $4))",
        [id, author, `Mensaje ${num}-${k}`, 10 * k + 1]);
    }
    if (num % 5 === 0) for (const u of [OWNER, PUNTO1, BODEGA]) await raw("insert into erp_stock_request_reads values ($1, $2, now() - interval '5 hours')", [id, u]);
  }
}
await raw("insert into erp_stock_requests (store_id, number, status, from_point_id, to_point_id, created_at) values ($1, 1, 'pending', $2, $2, now())", [B, WB]);

// Productos, existencias, categorías.
const [{ id: C1 }] = await raw("insert into product_categories (store_id, name) values ($1, 'Camisas') returning id", [A]);
const [{ id: C2 }] = await raw("insert into product_categories (store_id, name) values ($1, 'Zapatos') returning id", [A]);
const names = ["Camisa azul", "Camiseta roja", "Zapato negro", "Zapatilla blanca", "Pantalón jean", "Camisa manga larga", "Medias", "Correa cuero"];
const P = [];
for (let i = 0; i < 48; i++) {
  const nm = names[i % names.length] + " " + (i + 1);
  const [{ id }] = await raw(`insert into products (store_id, name, description, sku, barcode, product_no, active, stock, cost_price, category_id,
      price_1, price_3, product_details, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now() - make_interval(days => $6)) returning id`,
    [A, nm, i % 5 === 0 ? "Algodón peinado" : null, "SKU" + (100 + i), i % 3 ? "770" + i : null, i + 1, i % 9 !== 0, i % 7 === 0 ? 0 : 5 + i,
     i % 4 === 0 ? 0 : 1000 * (i + 1), i % 2 ? C1 : (i % 3 ? C2 : null), 800 * (i + 1), i % 11 === 0 ? 0 : 1000 * (i + 1),
     i % 6 === 0 ? { highlights: ["Suave", "Fresca"], specifications: [{ name: "Talla", value: "M" }] } : {}]);
  P.push(id);
  for (const w of pts) if ((i + w.charCodeAt(1)) % 3) await raw("insert into erp_stock_levels values ($1, $2, $3, $4)", [A, w, id, Math.floor(R() * 12) - 3]);
  if (i % 4 === 1) await raw("insert into product_category_links values ($1, $2, $3)", [id, C2, A]);
}
await raw("insert into products (store_id, name, sku, price_3, active) values ($1, 'Camisa ajena', 'SKU100', 1000, true)", [B]);

// Catálogos: detal, mayor con clave, de punto con regla de precio, y uno que solo incluye lo marcado.
const cat = async (slug, extra = {}) => (await raw(`insert into store_catalogs (store_id, slug, name, point_id, access_key, price_level, include_all_products, wholesale_rules)
  values ($1, $2, $2, $3, $4, $5, $6, $7) returning id`, [A, slug, extra.point ?? null, extra.key ?? null, extra.level ?? 3, extra.all ?? true, extra.rules ?? false]))[0].id;
const DET = await cat("detal"), MAY = await cat("mayor", { key: "k1", level: 1, rules: true }), PTO = await cat("punto", { point: W1 }), SEL = await cat("seleccion", { all: false });
await raw("insert into erp_price_rules (store_id, point_id, status, kind, value) values ($1, $2, 'active', 'pct', 10)", [A, W1]);
await raw("insert into erp_profit_settings values ($1, 100, 'up')", [A]);
await raw("insert into store_catalog_products (catalog_id, product_id, included, featured, sort_order, price_override) select $1, unnest($2::uuid[]), true, false, 2, null", [SEL, P.slice(0, 6)]);
await raw("insert into store_catalog_products (catalog_id, product_id, included, featured, sort_order, price_override) values ($1, $2, true, true, 1, 777), ($1, $3, false, false, 0, null)", [DET, P[2], P[3]]);
const [{ id: CC }] = await raw("insert into store_catalog_categories (catalog_id, category_id, visible) values ($1, $2, false) returning id", [DET, C2]);
void CC;
await raw("insert into erp_product_offers (product_id, store_id, featured, label) values ($1, $3, true, 'Top'), ($2, $3, false, 'Nuevo')", [P[4], P[5], A]);
await raw(`insert into erp_product_badges (product_id, kind, store_id, starts_at, ends_at, before_price, text) values
  ($1, 'new', $4, now() - interval '1 day', null, null, null), ($1, 'promo', $4, now() - interval '1 day', now() + interval '2 days', null, '2x1'),
  ($2, 'price_drop', $4, now() - interval '1 day', now() + interval '5 days', 999999, null), ($3, 'featured', $4, now() - interval '1 day', null, null, null),
  ($5, 'new', $4, now() + interval '3 days', null, null, null), ($6, 'price_drop', $4, now() - interval '1 day', null, 1, null)`, [P[6], P[7], P[8], A, P[10], P[12]]);

// Ventas, cartera, cuentas por pagar, traslados, documentos fiscales y ventas sin conexión.
for (let i = 0; i < 24; i++) {
  const st = ["draft", "sent", "confirmed", "completed", "cancelled"][i % 5];
  const [{ id }] = await raw("insert into orders (store_id, status, total, created_at, confirmed_at) values ($1, $2, $3, now() - make_interval(hours => $4), case when $2 = 'confirmed' then now() - make_interval(hours => $4) end) returning id",
    [A, st, 10000 * (i + 1), 5 + i * 13]);
  if (i % 3) await raw("insert into erp_order_meta (order_id, store_id, point_id) values ($1, $2, $3)", [id, A, [W1, W2][i % 2]]);
  if (i % 4 === 0) await raw("insert into store_catalog_orders (order_id, catalog_id, store_id, created_at) values ($1, $2, $3, now() - make_interval(hours => $4))", [id, i % 8 ? PTO : DET, A, i]);
}
await raw("insert into erp_payables (store_id, status, balance, due_date) values ($1, 'open', 50000, current_date - 3), ($1, 'open', 20000, current_date + 2), ($1, 'paid', 0, current_date - 1)", [A]);
const [{ id: CU }] = await raw("insert into billing_customers (store_id, credit_enabled, credit_limit) values ($1, true, 10000) returning id", [A]);
await raw("insert into erp_receivables (store_id, customer_id, point_id, status, balance, due_date) values ($1, $2, $3, 'open', 30000, current_date - 2), ($1, $2, $4, 'open', 5000, current_date + 1)", [A, CU, W1, W2]);
await raw("insert into erp_transfers (store_id, status, created_at, from_warehouse_id, to_warehouse_id) values ($1, 'in_transit', now() - interval '3 days', $2, $3), ($1, 'in_transit', now() - interval '4 days', $2, $4)", [A, W0, W1, W2]);
await raw(`insert into fiscal_documents (store_id, point_id, document_type, status, created_at) values
  ($1, $2, 'contingency_invoice', 'QUEUED', now() - interval '40 hours'), ($1, $3, 'contingency_invoice', 'ERROR', now() - interval '2 hours'),
  ($1, null, 'contingency_invoice', 'QUEUED', now() - interval '1 hours'), ($1, $2, 'invoice', 'QUEUED', now())`, [A, W1, W2]);
await raw("insert into erp_pos_offline_issues (store_id, point_id, kind, resolved_at) values ($1, $2, 'contingencia', null), ($1, $3, 'venta', null), ($1, null, 'venta', null), ($1, $2, 'venta', now())", [A, W1, W2]);
await raw("insert into erp_org_settings values ($1, true)", [A]);
await raw("insert into fiscal_point_configs values ($1, $2, true, null, 'test'), ($1, $3, true, null, 'production'), ($1, $4, false, null, 'test')", [A, W1, W2, W0]);

// ---------------------------------------------------------------- pruebas
console.log("1. Pedidos internos: mismo resultado, permisos una sola vez");
for (const [who, uid] of Object.entries(USERS)) {
  const l = await same(`Lista de pedidos · ${who}`, uid, "public.erp_stock_requests_list($1)", [A], { show: true });
  if (who === "dueño") {
    ok(JSON.parse(l.value).length > 20, "…el dueño ve la lista completa (hay datos que comparar)");
    ok(l.newCalls === 4 && l.oldCalls > 4 * 20, `…revisiones de permiso: ${l.oldCalls} antes, ${l.newCalls} ahora`);
  }
  await same(`Bandeja · ${who}`, uid, "public.erp_stock_inbox($1)", [A], { show: true });
  for (const f of pts) for (const t of pts) await same(`Acceso ${who} ${pts.indexOf(f)}→${pts.indexOf(t)}`, uid, "public.erp__sr_access($1, $2, $3)", [A, f, t]);
}
await same("Lista de otra tienda (no se mezcla)", OWNER, "public.erp_stock_requests_list($1)", [B]);

console.log("2. Campana: mismo resultado");
for (const [who, uid] of Object.entries(USERS)) {
  const r = await same(`Campana · ${who}`, uid, "public.erp_alerts($1)", [A], { show: true });
  if (who === "dueño") ok(JSON.parse(r.value).some((x) => x.key.startsWith("stock-req-msg-")), "…incluye el aviso de mensajes nuevos en pedidos internos", r.value);
  await same(`Pedidos por confirmar · ${who}`, uid, "public.erp_order_alerts($1)", [A]);
  await same(`Ventas sin conexión · ${who}`, uid, "public.erp_offline_alerts($1)", [A]);
}

console.log("3. Existencias: mismo resultado con cada filtro");
const browse = [
  [null, null, null, "all", 5, "all", "active", "name", 25, 0], ["cami", null, null, "all", 5, "all", "active", "name", 25, 0],
  [null, C2, null, "all", 5, "all", "all", "qty_desc", 10, 0], [null, null, W1, "out", 5, "all", "active", "name", 25, 0],
  [null, null, W2, "elsewhere", 5, "with", "active", "value_desc", 25, 0], [null, null, null, "low", 3, "without", "inactive", "recent", 5, 2],
  ["zapato negro", null, null, "all", 5, "all", "all", "cost_desc", 50, 0], ["770", C1, W0, "negative", 5, "all", "all", "qty_asc", 25, 0]];
for (const [who, uid] of Object.entries(USERS))
  for (const [k, args] of browse.entries())
    await same(`Existencias ${k + 1} · ${who}`, uid, "public.erp_stock_browse($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [A, ...args], { show: k === 0 });

console.log("4. Buscador del panel");
for (const [who, uid] of Object.entries(USERS))
  for (const q of ["cami", "camisa azul", "SKU105", "#12", "770", "algodon", "suave talla", "zapatila", "", null, "xyz"])
    for (const only of [false, true]) await same(`Buscar «${q}»${only ? " (activos)" : ""} · ${who}`, uid, "public.erp_product_finder($1, $2, $3, 30)", [A, q, only]);

console.log("5. Catálogos: sin promociones y con promociones");
const catalogs = async (tag) => {
  for (const c of [DET, MAY, PTO, SEL]) {
    await same(`Productos del catálogo ${tag} ${[DET, MAY, PTO, SEL].indexOf(c) + 1}`, null,
      "(select jsonb_agg(to_jsonb(i) order by i.product_id) from public.catalog__items($1) i)", [c]);
    await same(`Algunos productos ${tag} ${[DET, MAY, PTO, SEL].indexOf(c) + 1}`, null,
      "(select jsonb_agg(to_jsonb(i) order by i.product_id) from public.catalog__items($1, $2::uuid[]) i)", [c, P.slice(0, 9)]);
  }
  for (const [slug, key] of [["detal", null], ["mayor", "k1"], ["mayor", "mala"], ["punto", null], ["seleccion", null], ["noexiste", null]])
    await same(`Ofertas «${slug}» ${tag}`, null, "public.store_public_offers('tienda', $1, $2)", [slug, key]);
  for (const [who, uid] of Object.entries(USERS)) await same(`Resumen de catálogos ${tag} · ${who}`, uid, "public.catalog_admin_summary($1)", [A]);
};
await catalogs("(sin promociones)");
await raw("insert into erp_promotions (store_id, name, kind, value, scope, ends_at) values ($1, 'Vieja', 'pct', 50, 'all', now() - interval '1 day')", [A]);
await raw("update erp_promotions set starts_at = now() - interval '3 days'");
await catalogs("(con una promoción vencida)");
await raw(`insert into erp_promotions (store_id, name, kind, value, scope, product_ids, point_ids, category_id, ends_at) values
  ($1, 'Camisas', 'pct', 20, 'category', '{}', '{}', $2, now() + interval '3 days'),
  ($1, 'Un producto', 'price', 500, 'product', array[$3]::uuid[], '{}', null, now() + interval '1 day'),
  ($1, 'Solo punto', 'pct', 30, 'all', '{}', array[$4]::uuid[], null, now() + interval '1 day')`, [A, C1, P[2], W1]);
await raw("insert into erp_promotions (store_id, name, kind, value, scope, ends_at) values ($1, 'De otra tienda', 'pct', 90, 'all', now() + interval '1 day')", [B]);
await catalogs("(con promociones vigentes)");
const offers = (await raw("select public.store_public_offers('tienda', 'detal', null) v"))[0].v;
ok(offers.items.some((x) => x.before) && offers.items.some((x) => x.badges.includes("new")), "Las ofertas tienen precios de antes y etiquetas (hay datos que comparar)", offers);

console.log("6. Lo que se agregó");
const fns = await raw(`select p.proname, p.prosecdef, p.proconfig, p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('erp__sr_perms', 'erp__sr_access', 'erp_stock_requests_list', 'erp_stock_inbox', 'erp_alerts',
    'erp_stock_browse', 'catalog_admin_summary', 'erp_product_finder', 'catalog__items', 'store_public_offers', 'erp_order_alerts', 'erp_offline_alerts')`);
ok(fns.length === 12 && fns.every((f) => f.prosecdef && String(f.proconfig).includes("search_path=public")), "Todas siguen siendo security definer con search_path = public", fns);
const acl = await raw(`select has_function_privilege('anon', 'public.erp__sr_perms(uuid)', 'execute') a, has_function_privilege('authenticated', 'public.erp__sr_perms(uuid)', 'execute') b,
  has_function_privilege('authenticated', 'public.erp__sr_access_of(jsonb, uuid, uuid)', 'execute') c`);
ok(!acl[0].a && !acl[0].b && !acl[0].c, "Las funciones internas nuevas no se pueden llamar desde la app", acl);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
