// Pruebas de 20261332: en el buscador del traslado, precio por mayor de la madre y a cómo queda en el punto que recibe.
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
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
do $do$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $do$;
grant usage on schema public to anon;
`;
const combined = path.join(os.tmpdir(), `remhub_pbt_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  extra,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261332_precios_buscador_traslado.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return (await db.query(s, p)).rows; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const U = (n) => `cb000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), BODEGA = U(2), VENDEDOR = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: X }] = await raw("insert into stores (slug, name, owner_id) values ('x', 'X', $1) returning id", [U(9)]);
const [{ id: B }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'B', 'BODEGA', true) returning id", [A]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'Z', 'ZAMORA', true) returning id", [A]);
const [{ id: Y }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'Y', 'OTRO', true) returning id", [A]);
const [{ id: XW }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'XW', 'AJENO', true) returning id", [X]);
const prod = async (s, n, p2) => (await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3) values ($1, $2, $2, 5, 1000, $3, $3, $3) returning id", [s, n, p2]))[0].id;
const P = await prod(A, "OLLA", 20000), Q = await prod(A, "BATIDORA", 10000), XP = await prod(X, "AJENO", 7000);
await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, status, reason, valid_from) values ($1, $2, 'point', 'pct', 15, 'active', 'margen 15', now() - interval '1 day')", [A, Z]);
await raw("insert into erp_price_rules (store_id, point_id, scope, product_id, kind, value, status, reason, valid_from) values ($1, $2, 'product', $3, 'fixed', 11000, 'active', 'fijo', now() - interval '1 day')", [A, Z, Q]);
await raw("insert into auth.users (id, email) values ($1, 'b@x.co'), ($2, 'v@x.co')", [BODEGA, VENDEDOR]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id, active) values ($1, $2, 'seller', '{transfers}', $3, true), ($1, $4, 'seller', '{pos}', $5, true)", [A, BODEGA, B, VENDEDOR, Z]);

const q = "select * from public.erp_transfer_pick_prices($1, $2, $3::uuid[])";
const rows = await as(BODEGA, q, [A, Z, [P, Q]]);
const by = new Map(rows.map((r) => [r.product_id, r]));
ok(rows.length === 2, "La bodega (con permiso de traslados, sin permiso en Zamora) recibe los 2 precios", rows);
ok(Number(by.get(P)?.price_2) === 20000, "Precio por mayor de la madre: 20.000", by.get(P));
ok(Number(by.get(P)?.point_price_2) === 23000 && by.get(P)?.has_rule === true, "En Zamora: 20.000 + 15 % = 23.000", by.get(P));
ok(Number(by.get(Q)?.point_price_2) === 11000, "La regla del producto gana a la del punto (fijo 11.000)", by.get(Q));
ok(!Object.keys(rows[0] ?? {}).some((k) => /cost/i.test(k)), "Nunca entrega costos", Object.keys(rows[0] ?? {}));
const other = await as(BODEGA, q, [A, Y, [P]]);
ok(Number(other[0]?.point_price_2) === 20000 && other[0]?.has_rule === false, "Punto sin regla: el de la madre", other);
ok((await as(OWNER, q, [A, Z, [P]])).length === 1, "El dueño también");
ok((await as(VENDEDOR, q, [A, Z, [P]])).length === 0, "Sin permiso de traslados ni inventario: nada");
ok((await as(null, q, [A, Z, [P]])).length === 0, "Sin sesión: nada");
ok((await as(BODEGA, q, [A, XW, [P]])).length === 0, "Punto de otra tienda: nada");
ok((await as(BODEGA, q, [A, Z, [XP]])).length === 0, "Producto de otra tienda: nada");
ok((await as(BODEGA, q, [A, Z, null])).length === 0, "Sin productos: nada");
let denied = false;
try { await db.exec("set role anon"); await db.query(q, [A, Z, [P]]); } catch { denied = true; } finally { await db.exec("reset role"); }
ok(denied, "Anónimo no puede llamarla");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
