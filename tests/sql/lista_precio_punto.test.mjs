// Pruebas de 20261336: la lista general de productos muestra el precio del punto (con su regla), no el de la madre.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$fn$;
create or replace function public.erp_can(p_store uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $fn$ select public.erp_can_any(p_store, array[p_perm]) $fn$;
alter table public.erp_warehouses add column if not exists kind text default 'point';
alter table public.products add column if not exists product_no bigint;
alter table public.products add column if not exists category_id uuid;
-- Búsqueda (20261031) simplificada.
create or replace function public.product__rank(p_name text, p_sku text, p_barcode text, p_no bigint, p_q text)
returns numeric language sql immutable as $fn$ select 1::numeric $fn$;
create or replace function public.product__matches(p_name text, p_sku text, p_barcode text, p_no bigint, p_extra text, p_q text)
returns boolean language sql immutable as $fn$ select p_q is null or p_name ilike '%' || p_q || '%' or p_sku ilike '%' || p_q || '%' $fn$;
`;
const combined = path.join(os.tmpdir(), `remhub_lpp_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  extra,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261336_lista_precio_punto.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return (await db.query(s, p)).rows; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const U = (n) => `cf000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CRISTIAN = U(2);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into erp_warehouses (store_id, code, name, active, is_default, kind) values ($1, 'B', 'Bodega principal', true, false, 'warehouse') returning id", [S]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CISNEROS', true, 'point') returning id", [S]);
const [{ id: P }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3) values ($1, 'ORGANIZADOR DE PLATOS A55-102', 'A55-102', 77, 45000, 52000, 50000, 52000) returning id", [S]);
await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, status, reason, valid_from) values ($1, $2, 'point', 'pct', 15, 'active', 'margen 15', now() - interval '1 day')", [S, C]);
await raw("insert into erp_profit_settings (store_id, rounding_step, rounding_dir) values ($1, 100, 'nearest') on conflict (store_id) do update set rounding_step = 100", [S]).catch(() => null);
await raw("insert into auth.users (id, email) values ($1, 'c@x.co')", [CRISTIAN]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id, active) values ($1, $2, 'seller', '{pos,products_view}', $3, true)", [S, CRISTIAN, C]);

const browse = (uid, filters = {}) => as(uid, "select public.erp_product_catalog_browse($1, $2::jsonb) r", [S, JSON.stringify(filters)]).then((r) => r[0].r);
const mine = await browse(CRISTIAN, { q: "A55" });
ok(mine.ok && mine.point_id === C && mine.price_point_id === C && mine.price_point_name === "CISNEROS", "Cristian ve su punto, Cisneros", mine);
ok(Number(mine.items[0]?.price) === 59800 && Number(mine.items[0]?.base_price) === 52000 && mine.items[0]?.has_rule === true, "Precio en Cisneros: 52.000 + 15 % = 59.800 (no el de la bodega)", mine.items[0]);
const other = await browse(CRISTIAN, { q: "A55", point_id: B });
ok(other.point_id === B && other.price_point_id === C && Number(other.items[0]?.price) === 59800, "Si mira existencias de la bodega, el precio sigue siendo el de su punto", other);
const owner = await browse(OWNER, { q: "A55", point_id: B });
ok(Number(owner.items[0]?.price) === 52000 && owner.items[0]?.has_rule === false, "El dueño en la bodega: precio de la madre", owner.items[0]);
const ownerC = await browse(OWNER, { q: "A55", point_id: C });
ok(Number(ownerC.items[0]?.price) === 59800 && ownerC.price_point_name === "CISNEROS", "El dueño mirando Cisneros: precio de Cisneros", ownerC.items[0]);
ok(mine.items[0]?.cost === null || mine.items[0]?.cost === undefined, "El vendedor sigue sin ver el costo", mine.items[0]);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
