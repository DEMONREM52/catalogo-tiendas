// Pruebas de 20261121: un usuario de punto con «Compras» edita los ingresos de SU punto.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const M21 = fs.readFileSync(path.join(MIG, "20261121_editar_ingreso_desde_punto.sql"), "utf8");
const combined = path.join(os.tmpdir(), `remhub_edit_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(here, "fixtures/prod_editar_ingreso.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261118_compras_desde_punto.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const U = (n) => `c5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), SIN = U(3), CENTRO = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CENTRO', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values
  ($1,$2,'seller','{purchases,inventory}',$3,'SARA'), ($1,$4,'seller','{inventory}',$3,'SIN COMPRAS'), ($1,$5,'seller','{purchases}',$6,'CENTRO')`, [A, SARA, Z, SIN, CENTRO, C]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROVEEDOR', true) returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock) values ($1, 'OLLAS', 0) returning id", [A]);

let n = 0;
const invoice = async (u, wh, qty = 10) => (await as(u, "select public.erp_receive_invoice($1, $2, $3, current_date, 'credit', current_date + 30, null, 'X', $4::jsonb) r",
  [A, SUP, `F-${++n}`, JSON.stringify([{ product_id: P, qty, unit_cost: 1000, warehouse_id: wh }])]))[0].r;
const ref = async (id) => (await raw("select invoice_ref from erp_purchases where id = $1", [id]))[0].invoice_ref;
const edit = async (u, id, wh, qty, cost = 1000) => as(u,
  "select public.erp_update_purchase($1, $2, $3, current_date, 'credit', current_date + 30, null, 'X', $4::jsonb, 'prueba') r",
  [id, SUP, await ref(id), JSON.stringify([{ product_id: P, qty, unit_cost: cost, warehouse_id: wh }])]);
const editErr = async (...a) => { try { await edit(...a); return null; } catch (e) { return e.message; } };
const qty = async (wh) => Number((await raw("select coalesce((select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2), 0) q", [wh, P]))[0].q);
const payable = async (id) => Number((await raw("select total from erp_payables where purchase_id = $1 and status <> 'void'", [id]))[0]?.total ?? -1);

const mine = await invoice(SARA, Z);
const theirs = await invoice(CENTRO, C);
const mother = await invoice(OWNER, B);

console.log("1. Antes de la migración (como está hoy en producción)");
ok(/no pueden editar ingresos/.test((await editErr(SARA, mine, Z, 35)) ?? ""), "SARA recibe «Los usuarios de punto no pueden editar ingresos de factura»");

console.log("2. Con 20261121");
await db.exec(M21);
const def = (await raw("select pg_get_functiondef('public.erp_update_purchase(uuid,uuid,text,date,text,date,text,text,jsonb,text)'::regprocedure) d"))[0].d;
ok(!def.includes("no pueden editar ingresos") && def.includes("Este ingreso es de otro punto"), "Solo cambió la regla del punto");
ok(def.includes("Costo promedio") && def.includes("Cuenta por pagar"), "El resto de la función quedó igual");
await db.exec(M21);
ok(true, "Correrla dos veces no falla");

console.log("3. SARA (punto Zamora, con «Compras»)");
ok((await edit(SARA, mine, Z, 35, 57400))[0]?.r === mine, "Edita su ingreso: 10 → 35 unidades a $57.400");
ok(await qty(Z) === 35, "El inventario de ZAMORA ajusta solo la diferencia (+25)", await qty(Z));
ok(await payable(mine) === 35 * 57400, "La cuenta por pagar queda en el nuevo total", await payable(mine));
ok(Number((await raw("select edit_count from erp_purchases where id = $1", [mine]))[0].edit_count) === 1, "Queda marcado como editado");
ok(/otro punto/.test((await editErr(SARA, theirs, Z, 1)) ?? ""), "No puede editar un ingreso de otro punto (CENTRO)");
ok(/otro punto/.test((await editErr(SARA, mother, Z, 1)) ?? ""), "…ni uno de la bodega de la madre");
ok(/tu punto/.test((await editErr(SARA, mine, B, 35)) ?? ""), "No puede mandar los productos de su ingreso a otra bodega");
ok(await qty(Z) === 35 && await qty(B) === 10 && await qty(C) === 10, "Los intentos rechazados no movieron nada", [await qty(Z), await qty(B), await qty(C)]);
ok(/permiso/i.test((await editErr(SIN, mine, Z, 1)) ?? ""), "Un usuario del punto SIN «Compras» no puede editar");

console.log("4. La madre sigue igual");
ok((await edit(OWNER, theirs, C, 4))[0]?.r === theirs, "El dueño edita el ingreso de CENTRO");
ok((await edit(OWNER, mine, Z, 30, 57400))[0]?.r === mine, "…y el de ZAMORA");
ok(await qty(C) === 4 && await qty(Z) === 30, "Inventarios ajustados", [await qty(C), await qty(Z)]);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
