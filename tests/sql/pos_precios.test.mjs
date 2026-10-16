// Pruebas de 20261115: límites para bajar el precio en el POS, autorizaciones y forma de pago.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Carpeta de migraciones (se puede cambiar si ya se movieron después de ejecutarlas).
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_pos_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261113_inventario_precios_devoluciones.sql", "20261114_permisos_columnas_productos.sql", "20261115_pos_limites_precio.sql"]
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
const [{ id: Z2 }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CENTRO', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values
  ($1,$2,'seller','{pos}',$3,'VENDEDOR ZAMORA'), ($1,$4,'seller','{pos,price_approve}',$3,'JEFE ZAMORA'),
  ($1,$5,'seller','{pos,profit_rules,profit_view}',null,'MADRE'), ($1,$6,'seller','{pos}',$7,'VENDEDOR CENTRO')`, [A, SELLER, Z, BOSS, MOTHER, OTHER, Z2]);
// Costo 15.000, precio de la madre 19.000, el punto Zamora le sube a 23.000 (regla fija).
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'AUDIFONO', 15000, 19000, 19000, 19000, 19000, 19000, 50) returning id", [A]);
await raw("insert into erp_price_rules (store_id, point_id, scope, product_id, kind, value, status, reason) values ($1, $2, 'product', $3, 'fixed', 23000, 'active', 'sube el punto')", [A, Z, P]);
const cart = (price) => JSON.stringify([{ product_id: P, qty: 1, price }]);
const sell = (u, price) => one(u, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CONSUMIDOR FINAL') r", [A, cart(price)]);
const sellErr = (u, price) => err(u, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CONSUMIDOR FINAL') r", [A, cart(price)]);
const floors = (u) => one(u, "select public.erp_pos_price_floors($1, $2, $3::uuid[]) r", [A, Z, `{${P}}`]);

console.log("Sin configurar (nadie baja precios)");
let fl = await floors(SELLER);
ok(fl.mode === "list" && Number(fl.floors[P].floor) === 23000 && Number(fl.floors[P].list) === 23000, "El vendedor de Zamora: mínimo = precio del punto $23.000", fl);
ok((await sell(SELLER, 23000))?.token, "Vende a $23.000");
ok((await sell(SELLER, 25000))?.token, "Subir el precio siempre se puede ($25.000)");
ok(/PRICE_BELOW_LIMIT/.test((await sellErr(SELLER, 22000)) ?? ""), "Bajar a $22.000: bloqueado en la base (aunque la pantalla lo deje)");

console.log("Límite del punto: hasta el precio de la madre");
ok(/madre/.test((await err(SELLER, "select public.erp_price_limit_save($1, $2, null, 'mother', null) r", [A, Z])) ?? ""), "Un vendedor no puede cambiar límites");
await one(MOTHER, "select public.erp_price_limit_save($1, $2, null, 'mother', null) r", [A, Z]);
fl = await floors(SELLER);
ok(Number(fl.floors[P].floor) === 19000 && fl.mode === "mother", "Ahora puede bajar hasta $19.000", fl);
ok((await sell(SELLER, 19000))?.token, "Vende a $19.000");
ok(/PRICE_BELOW_LIMIT/.test((await sellErr(SELLER, 18999)) ?? ""), "…pero no a $18.999");
ok((await sellErr(OTHER, 19000)) === null, "El vendedor de otro punto vende con su lista ($19.000 de la madre)");
ok(/PRICE_BELOW_LIMIT/.test((await sellErr(OTHER, 18000)) ?? ""), "…y no baja de ella");

console.log("Límite por costo + % y por usuario (el del usuario manda)");
await one(MOTHER, "select public.erp_price_limit_save($1, $2, null, 'margin', 10) r", [A, Z]);
fl = await floors(SELLER);
ok(Number(fl.floors[P].floor) === 16500, "Costo $15.000 + 10 % = $16.500", fl);
await one(MOTHER, "select public.erp_price_limit_save($1, null, $2, 'cost', null) r", [A, SELLER]);
fl = await floors(SELLER);
ok(Number(fl.floors[P].floor) === 15000 && fl.source === "user", "Al vendedor le das «hasta el costo»: $15.000 (manda sobre el punto)", fl);
ok((await sell(SELLER, 15000))?.token, "Vende a costo");
ok(/PRICE_BELOW_LIMIT/.test((await sellErr(SELLER, 14000)) ?? ""), "…pero nunca por debajo del costo sin autorización");
const conf = await one(MOTHER, "select public.erp_price_limits_get($1) r", [A]);
ok(conf.can_edit && conf.points.find((x) => x.point_id === Z)?.mode === "margin" && conf.users.find((x) => x.user_id === SELLER)?.mode === "cost", "La madre ve la configuración de puntos y usuarios", conf);
await one(MOTHER, "select public.erp_price_limit_save($1, null, $2, null, null) r", [A, OTHER]);
ok((await one(MOTHER, "select public.erp_price_limits_get($1) r", [A])).users.find((x) => x.user_id === OTHER)?.mode == null, "Quitar la excepción de un usuario (vuelve al límite del punto)");

console.log("Autorización");
const req = await one(SELLER, "select public.erp_price_approval_request($1, $2, $3, 14000, 1, 'cliente frecuente') r", [A, Z, P]);
ok(req.ok && req.id, "El vendedor pide autorización para $14.000", req);
const pend = await one(BOSS, "select public.erp_price_approvals_pending($1) r", [A]);
ok(pend.ok && pend.rows.some((x) => x.id === req.id && Number(x.floor_price) === 15000 && x.requested_by_name === "VENDEDOR ZAMORA"), "El jefe del punto la ve (con el mínimo y quién pide)", pend);
ok((await one(OTHER, "select public.erp_price_approvals_pending($1) r", [A])).ok === false, "Un vendedor sin permiso no ve solicitudes");
ok(/permiso/.test((await err(SELLER, "select public.erp_price_approval_decide($1, true, null) r", [req.id])) ?? ""), "El vendedor no se puede autorizar a sí mismo");
ok(/por qué/.test((await err(BOSS, "select public.erp_price_approval_decide($1, false, '') r", [req.id])) ?? ""), "Rechazar pide el motivo");
await one(BOSS, "select public.erp_price_approval_decide($1, true, 'ok') r", [req.id]);
const st = await one(SELLER, "select public.erp_price_approval_get($1::uuid[]) r", [`{${req.id}}`]);
ok(st[0].status === "approved" && st[0].decided_by_name === "JEFE ZAMORA", "El vendedor ve que la aprobó el jefe", st);
ok((await sell(SELLER, 14000))?.token, "Con la autorización, vende a $14.000");
ok(/PRICE_BELOW_LIMIT/.test((await sellErr(SELLER, 14000)) ?? ""), "La autorización sirve UNA sola vez");
ok((await raw("select status from erp_price_approvals where id = $1", [req.id]))[0].status === "used", "Queda marcada como usada con su venta");
const nn = await one(SELLER, "select public.erp_price_approval_request($1, $2, $3, 16000, 1, null) r", [A, Z, P]);
ok(nn.not_needed === true, "Si el precio está dentro de su límite no hace falta pedir", nn);

console.log("Quien autoriza y el dueño no tienen límite");
ok((await sell(BOSS, 10000))?.token && (await sell(OWNER, 9000))?.token, "Jefe con «Autorizar precios» y dueño venden a cualquier precio");
ok((await floors(BOSS)).free === true, "…y el POS lo sabe");

console.log("Catálogo público y pago");
ok((await err(null, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'X') r", [A, cart(19000)])) === null, "El catálogo público sigue funcionando (precio de la madre)");
const sale = await sell(SELLER, 23000);
const [{ id: O }] = await raw("select id from orders where token = $1", [sale.token]);
await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, doc_number) values ($1, $2, $3, 'remision', 'REMZ-9')", [O, A, Z]);
await one(SELLER, "select public.erp_pos_set_payment($1, $2::jsonb) r", [sale.token, JSON.stringify({ method: "mixto", parts: [{ method: "efectivo", amount: 13000 }, { method: "nequi", amount: 10000 }], received: 20000, change: 7000 })]);
const pay = (await raw("select payment from erp_order_meta where order_id = $1", [O]))[0].payment;
ok(pay.method === "mixto" && pay.parts.length === 2 && Number(pay.change) === 7000, "Se guarda el pago mixto y el vuelto", pay);
ok(/asignado/.test((await err(OTHER, "select public.erp_pos_set_payment($1, $2::jsonb) r", [sale.token, JSON.stringify({ method: "efectivo" })])) ?? ""), "Otro punto no puede tocar el pago");
ok(/permission denied/i.test((await err(SELLER, "select * from erp_price_approvals")) ?? ""), "Las tablas no se leen directo (solo por funciones)");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
