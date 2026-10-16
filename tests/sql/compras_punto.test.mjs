// Pruebas de 20261118: un usuario de punto con «Compras» ingresa facturas solo hacia su punto.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_cp_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), fs.readFileSync(path.join(MIG, "20261118_compras_desde_punto.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

const U = (n) => `c2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), SIN = U(3), CENTRO = U(4);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CENTRO', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values
  ($1,$2,'seller','{purchases,inventory}',$3,'SARA'), ($1,$4,'seller','{inventory}',$3,'SIN COMPRAS'), ($1,$5,'seller','{purchases}',$6,'CENTRO')`, [A, SARA, Z, SIN, CENTRO, C]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROVEEDOR', true) returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock) values ($1, 'AUDIFONO', 0) returning id", [A]);
let n = 0;
const invoice = (u, lines) => as(u, "select public.erp_receive_invoice($1, $2, $3, current_date, 'cash', null, null, 'X', $4::jsonb) r", [A, SUP, `F-${++n}`, JSON.stringify(lines.map((wh) => ({ product_id: P, qty: 2, unit_cost: 1000, warehouse_id: wh })))]);
const invoiceErr = async (u, lines) => { try { await invoice(u, lines); return null; } catch (e) { return e.message; } };
const qty = async (wh) => Number((await raw("select coalesce((select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2), 0) q", [wh, P]))[0].q);

console.log("Antes bloqueado; ahora SARA (punto Zamora, con «Compras») ingresa hacia su punto");
const own = await invoice(SARA, [Z]);
ok(own[0]?.r, "SARA ingresa una factura hacia ZAMORA");
ok(await qty(Z) === 2, "…y las unidades entran a ZAMORA");
ok(/tu punto/.test((await invoiceErr(SARA, [C])) ?? ""), "No puede ingresar hacia otro punto (CENTRO)");
ok(/tu punto/.test((await invoiceErr(SARA, [B])) ?? ""), "…ni hacia la bodega de la madre");
ok(/tu punto/.test((await invoiceErr(SARA, [Z, C])) ?? ""), "…ni colar una línea a otro punto en su factura");
ok(await qty(C) === 0 && await qty(B) === 0, "Nada entró a otros lugares (todo o nada)");
ok(/permiso/i.test((await invoiceErr(SIN, [Z])) ?? ""), "Un usuario del punto SIN «Compras» sigue sin poder");

console.log("La madre sigue igual");
await invoice(OWNER, [C, B]);
ok(await qty(C) === 2 && await qty(B) === 2, "El dueño ingresa a cualquier punto y bodega");

console.log("Ver, editar y anular");
const seen = await as(SARA, "select warehouse_id from erp_purchases");
ok(seen.length === 1 && seen[0].warehouse_id === Z, "SARA solo ve las facturas de su punto", seen);
ok((await as(OWNER, "select id from erp_purchases")).length === 2, "El dueño las ve todas");
const [{ id: other }] = await raw("select id from erp_purchases where warehouse_id <> $1 limit 1", [Z]);
ok(/otro punto/.test((await err(SARA, "update erp_purchases set notes = 'x' where id = $1", [other])) ?? "") || (await as(SARA, "select 1 from erp_purchases where id = $1", [other])).length === 0, "No puede cambiar facturas de otro punto");
const cancelOther = await err(SARA, "select public.erp_cancel_purchase($1, 'prueba de anular') r", [other]);
ok(cancelOther !== null, "No puede anular una factura de otro punto", cancelOther);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
