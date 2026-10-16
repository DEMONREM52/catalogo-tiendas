// Pruebas de 20261205: las autorizaciones de precio no se pierden (editar la venta, 4 horas, vencidas).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Carpeta de migraciones (se puede cambiar si ya se movieron después de ejecutarlas).
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_autoriz_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261113_inventario_precios_devoluciones.sql", "20261114_permisos_columnas_productos.sql", "20261115_pos_limites_precio.sql", "20261205_autorizaciones_precio.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `e1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), BOSS = U(3), MOTHER = U(4), OTHER = U(5);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };


const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'SEDE ZAMORA', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values
  ($1,$2,'seller','{pos}',$3,'VENDEDOR ZAMORA'), ($1,$4,'seller','{pos,price_approve}',$3,'JEFE ZAMORA'), ($1,$5,'seller','{pos}',$3,'OTRO VENDEDOR')`,
  [A, SELLER, Z, BOSS, OTHER]);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ZAPATERO', 15000, 23000, 23000, 23000, 23000, 23000, 50) returning id", [A]);
const cart = (price) => JSON.stringify([{ product_id: P, qty: 1, price }]);
const sell = (u, price) => one(u, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CONSUMIDOR FINAL') r", [A, cart(price)]);
const sellErr = (u, price) => err(u, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CONSUMIDOR FINAL') r", [A, cart(price)]);
// Cambiar el precio de una línea como lo hace «editar» (con el usuario que edita).
async function editPrice(uid, order, price) {
  await db.query("select set_config('test.uid', $1, false)", [uid]);
  try { await db.query("update order_items set price = $1 where order_id = $2", [price, order]); return null; }
  catch (e) { return e.message; } finally { await db.query("select set_config('test.uid', '', false)"); }
}
async function editReinsert(uid, order, price) {
  await db.query("select set_config('test.uid', $1, false)", [uid]);
  // Como erp_pos_order_set_items: borrar y volver a escribir en UNA sola transacción.
  try {
    await db.exec("begin");
    await db.query("delete from order_items where order_id = $1", [order]);
    await db.query("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, $3)", [order, P, price]);
    await db.exec("commit");
    return null;
  } catch (e) { await db.exec("rollback"); return e.message; } finally { await db.query("select set_config('test.uid', '', false)"); }
}

console.log("Autorizar y vender");
const req = await one(SELLER, "select public.erp_price_approval_request($1, $2, $3, 20000, 1, 'cliente frecuente') r", [A, Z, P]);
await one(BOSS, "select public.erp_price_approval_decide($1, true, 'ok') r", [req.id]);
const exp = (await raw("select expires_at > now() + interval '3 hours 50 minutes' as ok from erp_price_approvals where id = $1", [req.id]))[0].ok;
ok(exp, "Aprobada: dura 4 horas para usarse (alcanza para una venta en espera o una recarga)");
const sale = await sell(SELLER, 20000);
ok(sale?.token, "Con la autorización vende a $20.000");
const [{ id: O }] = await raw("select id from orders where token = $1", [sale.token]);

console.log("Editar la venta");
ok((await editPrice(SELLER, O, 21000)) === null, "Al editarla, la misma autorización sigue valiendo (a $21.000, sigue bajo el mínimo)");
ok((await editReinsert(SELLER, O, 20000)) === null, "…también si se rehacen las líneas al mismo precio autorizado");
ok((await editReinsert(OTHER, O, 20000)) === null, "…y si la edita otro vendedor de la tienda");
ok(/PRICE_BELOW_LIMIT/.test((await editPrice(SELLER, O, 19000)) ?? ""), "Bajar más de lo autorizado sí pide autorización nueva");
ok(/PRICE_BELOW_LIMIT/.test((await sellErr(SELLER, 20000)) ?? ""), "En OTRA venta no sirve: se usa una sola vez");
// Varias líneas en una sola instrucción: la autorizada pasa, la que no, se sigue bloqueando.
const [{ id: P2 }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'OTRO', 15000, 23000, 23000, 23000, 23000, 23000, 50) returning id", [A]);
await db.query("select set_config('test.uid', $1, false)", [SELLER]);
let multi = null;
try { await db.query("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 20000), ($1, $3, 1, 20000)", [O, P, P2]); }
catch (e) { multi = e.message; }
const leaked = (await db.query("select coalesce(current_setting('erp.price_ok', true), '') v")).rows[0].v;
await db.query("select set_config('test.uid', '', false)");
ok(/PRICE_BELOW_LIMIT/.test(multi ?? ""), "Si en la misma edición entra otro producto bajo el mínimo, ese sí se bloquea", multi);
ok(leaked !== "1", "La señal de «ya autorizado» nunca queda abierta después", leaked);
const fo = await one(SELLER, "select public.erp_price_approvals_for_order($1) r", [O]);
ok(fo.length === 1 && fo[0].id === req.id && fo[0].decided_by_name === "JEFE ZAMORA" && Number(fo[0].requested_price) === 20000,
  "El POS sabe qué autorización usó la venta (para mostrar «Autorizado» al editarla)", fo);
ok(/permission denied/.test((await err(null, "select public.erp_price_approvals_for_order($1) r", [O])) ?? ""), "Sin sesión no se puede consultar");

console.log("Editar una venta que hizo alguien sin límite");
const bossSale = await sell(BOSS, 15000);
ok(bossSale?.token, "El jefe (sin límite) vende a $15.000");
const [{ id: OB }] = await raw("select id from orders where token = $1", [bossSale.token]);
ok((await editReinsert(SELLER, OB, 15000)) === null, "El vendedor edita la venta sin bajar ese precio: se guarda (antes daba PRICE_BELOW_LIMIT)");
ok(/PRICE_BELOW_LIMIT/.test((await editReinsert(SELLER, OB, 14000)) ?? ""), "…pero no puede bajarlo más sin autorización");
ok((await editPrice(SELLER, OB, 16000)) === null, "Subirle el precio sí se puede");
ok(/PRICE_BELOW_LIMIT/.test((await editPrice(SELLER, OB, 15500)) ?? ""), "…y volver a bajarlo bajo su mínimo, no");

console.log("Recuperar el estado");
const req2 = await one(SELLER, "select public.erp_price_approval_request($1, $2, $3, 21000, 1, null) r", [A, Z, P]);
await one(BOSS, "select public.erp_price_approval_decide($1, true, null) r", [req2.id]);
let st = await one(SELLER, "select public.erp_price_approval_get($1::uuid[]) r", [`{${req2.id}}`]);
ok(st[0].status === "approved" && st[0].expires_at, "Al recargar, el POS consulta y la ve aprobada", st);
await raw("update erp_price_approvals set expires_at = now() - interval '1 minute' where id = $1", [req2.id]);
st = await one(SELLER, "select public.erp_price_approval_get($1::uuid[]) r", [`{${req2.id}}`]);
ok(st[0].status === "expired", "Si ya venció, el POS lo sabe (y pide una nueva)", st);
ok(/PRICE_BELOW_LIMIT/.test((await sellErr(SELLER, 21000)) ?? ""), "…y la base tampoco la acepta");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
