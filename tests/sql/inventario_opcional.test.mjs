// Pruebas de 20261226: qué comprar y vencimientos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_io_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261226_inventario_opcional.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce700000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), BUYER = U(2), SELL = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{purchases}'), ($1, $3, 'seller', '{pos}')", [A, BUYER, SELL]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'PROVEEDOR X') returning id", [A]);
const prod = async (n) => (await raw("insert into products (store_id, name, sku) values ($1, $2, $2) returning id", [A, n]))[0].id;
const P = await prod("ALCOHOL"), Q = await prod("GUANTES");
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 10), ($4, $2, $3, 5), ($1, $5, $3, 500)", [B, P, A, Z, Q]);
const [{ id: T }] = await raw("insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id) values ($1, 1, $2, $3) returning id", [A, B, Z]);
await raw("insert into erp_transfer_items (transfer_id, product_id, qty) values ($1, $2, 5)", [T, P]);
const [{ id: PU }] = await raw("insert into erp_purchases (store_id, number, supplier_id, warehouse_id, status) values ($1, 1, $2, $3, 'received') returning id", [A, SUP, B]);
await raw("insert into erp_purchase_items (purchase_id, product_id, qty, unit_cost) values ($1, $2, 50, 8000), ($1, $3, 100, 1000)", [PU, P, Q]);
const sale = async (p, qty) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), 0, 'confirmed', now() - interval '3 days') returning id", [A]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, 0)", [id, p, qty]);
};
await sale(P, 60); await sale(Q, 30);

console.log("Qué comprar");
let r = await one(BUYER, "select public.erp_purchase_suggestions($1, 30, null) r", [A]);
const it = r.items.find((i) => i.name === "ALCOHOL");
ok(r.ok && it?.qty === 40 && Number(it.stock) === 15 && Number(it.transit) === 5, "ALCOHOL: vende 2/día, hay 15 + 5 en camino → comprar 40 para 30 días", it);
ok(it?.supplier === "PROVEEDOR X" && it.unit_cost === null, "Trae el último proveedor; sin «Ver costos» no muestra el costo", it);
ok(!r.items.some((i) => i.name === "GUANTES"), "GUANTES tiene para 500 días: no se sugiere");
r = await one(OWNER, "select public.erp_purchase_suggestions($1, 30, $2) r", [A, SUP]);
ok(Number(r.items[0]?.unit_cost) === 8000 && Number(r.total) === 320000, "El dueño ve el último costo y el total a comprar", r);
ok((await one(SELL, "select public.erp_purchase_suggestions($1, 30, null) r", [A])).ok === false, "Sin permiso de compras no puede");

console.log("Vencimientos");
r = await one(BUYER, "select public.erp_lot_save($1, $2::jsonb, $3) r", [A, JSON.stringify([
  { product_id: P, warehouse_id: B, qty: 20, expires_on: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), lot: "L-1" },
  { product_id: Q, warehouse_id: B, qty: 50, expires_on: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) },
  { product_id: Q, warehouse_id: B, qty: 50, expires_on: new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10) },
  { product_id: Q, qty: 1 },
]), PU]);
ok(r.ok && r.saved === 3, "Guarda 3 lotes (el que no tiene fecha se ignora)", r);
r = await one(BUYER, "select public.erp_lots_list($1, 60, false) r", [A]);
ok(r.ok && r.items.length === 2 && r.expired === 1 && r.soon === 1, "Lista lo que vence en 60 días: 1 vencido y 1 en 10 días", r);
ok(r.items[0].days < 0 && r.items[1].lot === "L-1", "Ordenado por fecha", r.items);
const lot = r.items[0].id;
ok((await one(BUYER, "select public.erp_lot_close($1, 'removed', 'Se botó') r", [lot])).ok, "Marcar como retirado");
r = await one(BUYER, "select public.erp_lots_list($1, 60, false) r", [A]);
ok(r.items.length === 1 && r.expired === 0, "Ya no aparece entre los activos");
ok((await one(SELL, "select public.erp_lots_list($1, 60, false) r", [A])).ok === false, "El vendedor sin permiso no ve los lotes");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
