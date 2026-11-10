// Pruebas de 20261315 (cambiar el vendedor de un documento del POS al editarlo).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(path.join(here, "fixtures/prod_ventas.sql"), { twice: false });

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;
const callErr = async (u, fn, args) => { try { await call(u, fn, args); return null; } catch (e) { return e.message; } };

const U = (n) => `e0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), JUAN = U(2), ANA = U(3), OTRO = U(4), SINPOS = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('t', 'Tienda', $1) returning id", [OWNER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, $2, $2, 'point') returning id", [A, name]))[0].id;
const BOD = await wh("Bodega"), ZAM = await wh("Zamora");
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values
  ($1,$2,'seller','{pos}',$6,'Juan'), ($1,$3,'seller','{pos}',$6,'Ana'), ($1,$4,'seller','{pos}',$7,'Otro'), ($1,$5,'seller','{inventory}',null,'Sin POS')`,
  [A, JUAN, ANA, OTRO, SINPOS, BOD, ZAM]);
const sql = fs.readFileSync(path.join(MIG, "20261315_vendedor_al_editar.sql"), "utf8");
await db.exec(sql); await db.exec(sql);

let n = 0;
async function doc(point, status = "draft", seller = JUAN) {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, $2, 1000, $3, 'Cliente') returning id", [A, `tk${++n}`, status]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, seller_id, seller_name, doc_kind, doc_number) values ($1,$2,$3,$4,'Juan','remision',$5)", [id, A, point, seller, `R-${n}`]);
  return id;
}

console.log("1. Cambiar el vendedor");
const d1 = await doc(BOD);
const r1 = await call(OWNER, "erp_pos_order_set_seller($1, $2)", [d1, ANA]);
ok(r1.ok && r1.changed && r1.seller_name === "Ana", "el dueño cambia el vendedor a Ana", r1);
const [m1] = await raw("select seller_id, seller_name from erp_order_meta where order_id = $1", [d1]);
ok(m1.seller_id === ANA && m1.seller_name === "Ana", "queda guardado en el documento", m1);
const r1b = await call(OWNER, "erp_pos_order_set_seller($1, $2)", [d1, ANA]);
ok(r1b.ok && r1b.changed === false, "el mismo vendedor no cambia nada", r1b);
const r1c = await call(JUAN, "erp_pos_order_set_seller($1, $2)", [d1, JUAN]);
ok(r1c.ok && r1c.seller_name === "Juan", "un cajero de su punto también puede", r1c);

console.log("2. Candados");
ok(/permiso/.test(await callErr(OTRO, "erp_pos_order_set_seller($1, $2)", [d1, OTRO]) ?? ""), "un cajero de otro punto no puede");
ok(/permiso/.test(await callErr(SINPOS, "erp_pos_order_set_seller($1, $2)", [d1, ANA]) ?? ""), "sin permiso de POS no puede");
ok(/Inicia sesión/.test(await callErr(null, "erp_pos_order_set_seller($1, $2)", [d1, ANA]) ?? ""), "sin sesión no puede");
const d2 = await doc(BOD, "confirmed");
ok(/confirmado/.test(await callErr(OWNER, "erp_pos_order_set_seller($1, $2)", [d2, ANA]) ?? ""), "documento confirmado: no se cambia");
ok(/no es vendedor/.test(await callErr(OWNER, "erp_pos_order_set_seller($1, $2)", [d1, U(99)]) ?? ""), "alguien que no es vendedor de la tienda no se puede poner");
const [{ c: anon }] = await raw("select has_function_privilege('anon', 'public.erp_pos_order_set_seller(uuid, uuid)', 'execute') c");
ok(anon === false, "anon no puede llamarla");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
