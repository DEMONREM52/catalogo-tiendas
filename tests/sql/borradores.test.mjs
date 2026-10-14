// Pruebas de 20261108 (catálogo con precio del punto y ventas sin internet) sobre 20261106.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_borradores_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "../../supabase/migrations/20261106_rentabilidad_precios_punto.sql", "../../supabase/migrations/20261108_catalogo_punto_y_borradores.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `d0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), NOPOS = U(3);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, name]))[0].id;
const JAVIER = await wh("JAVIER"), MARIA = await wh("MARIA");
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{pos}', $3), ($1, $4, 'seller', '{orders}', $3)", [A, SELLER, JAVIER, NOPOS]);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ORGANIZADOR', 15000, 20000, 17000, 15750, 18000, 19000, 100) returning id", [A]);
for (const w of [JAVIER, MARIA]) await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [w, P, A]);
const rule = await as(OWNER, "select public.erp_price_rule_save($1, $2, 'point', null, 'pct', 15, null, null, 'Punto JAVIER') r", [A, JAVIER]);
ok(rule[0].r.status === "active", "Regla del 15 % activa en JAVIER");

console.log("Catálogos");
const cat = async (point) => (await raw("insert into store_catalogs (store_id, name, point_id, price_level, include_all_products) values ($1, 'C', $2, 3, true) returning id", [A, point]))[0].id;
const cJ = await cat(JAVIER), cM = await cat(MARIA), cG = await cat(null);
const price = async (c) => Number((await raw("select price from public.catalog__items($1)", [c]))[0].price);
ok(await price(cJ) === 18112.5, "Catálogo del punto JAVIER cobra el precio del punto ($18.112,50)");
ok(await price(cM) === 15750, "Catálogo de MARÍA (sin reglas) queda igual");
ok(await price(cG) === 15750, "Catálogo general queda igual");
await raw("insert into store_catalog_products (catalog_id, product_id, store_id, price_override) values ($1, $2, $3, 16000)", [cJ, P, A]);
ok(await price(cJ) === 16000, "El precio especial del catálogo sigue mandando");

console.log("Ventas sin internet");
const items = (p) => JSON.stringify([{ product_id: P, qty: 2, level: 3, price: p }]);
const submit = (uid, client, point, p) => as(uid, "select public.erp_pos_submit_offline($1, $2, $3, null, $4::jsonb, 'CLIENTE', 'nota', null, '123', now() - interval '2 hours') r", [A, client, point, items(p)]);
const C1 = "e0000000-0000-0000-0000-000000000001";
const s1 = (await submit(SELLER, C1, JAVIER, 18112.5))[0].r;
ok(s1.ok && !s1.already && /REM-/.test(s1.doc_number), "Se registra con su número de remisión del punto", s1);
const s2 = (await submit(SELLER, C1, JAVIER, 18112.5))[0].r;
ok(s2.ok && s2.already && s2.token === s1.token, "Reintentar el mismo borrador no crea otra venta", s2);
const [{ n }] = await raw("select count(*)::int n from orders where store_id = $1", [A]);
ok(n === 1, "Solo existe una venta");
const [o] = await raw("select o.total, o.customer_note, m.point_id from orders o join erp_order_meta m on m.order_id = o.id where o.token = $1", [s1.token]);
ok(Number(o.total) === 36225 && o.point_id === JAVIER && /sin internet/.test(o.customer_note), "Total con el precio del punto, en su punto y marcada como venta sin internet", o);
const s3 = (await submit(SELLER, "e0000000-0000-0000-0000-000000000002", JAVIER, 15750))[0].r;
ok(!s3.ok && s3.code === "PRICE_CHANGED", "Si el precio cambió, no se registra sola", s3);
const [{ n: n2 }] = await raw("select count(*)::int n from orders where store_id = $1", [A]);
ok(n2 === 1, "…y no crea ninguna venta");
ok(/tus puntos/i.test(await err(SELLER, "select public.erp_pos_submit_offline($1, $2, $3, null, $4::jsonb, 'X', '', null, null, now())", [A, "e0000000-0000-0000-0000-000000000003", MARIA, items(15750)]) ?? ""), "No se puede enviar a nombre de otro punto");
ok(/permiso/i.test(await err(NOPOS, "select public.erp_pos_submit_offline($1, $2, $3, null, $4::jsonb, 'X', '', null, null, now())", [A, "e0000000-0000-0000-0000-000000000004", JAVIER, items(18112.5)]) ?? ""), "Sin permiso de POS: bloqueado");
ok(/permission denied/i.test(await err(null, "select public.erp_pos_submit_offline($1, $2, $3, null, $4::jsonb, 'X', '', null, null, now())", [A, "e0000000-0000-0000-0000-000000000005", JAVIER, items(18112.5)]) ?? ""), "Sin sesión: bloqueado");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
