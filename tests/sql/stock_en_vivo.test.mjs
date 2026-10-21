// Pruebas de 20261220: verificación de existencias antes de guardar y aviso de pedidos internos repetidos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
alter table public.erp_stock_requests add column if not exists number int;
create table if not exists public.erp_stock_requests (id uuid primary key default gen_random_uuid(), store_id uuid, number int, status text,
  from_point_id uuid, to_point_id uuid, created_at timestamptz default now());
create table if not exists public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid, product_id uuid,
  qty_requested int, qty_approved int);
`;
const combined = path.join(os.tmpdir(), `remhub_sev_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  extra,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261220_stock_en_vivo.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce100000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), JAVIER = U(2), JUAN = U(3), STRANGER = U(9);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}'), ($1, $3, 'seller', '{pos}')", [A, JAVIER, JUAN]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: Y }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Y', 'OTRO', true, 'point') returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock) values ($1, 'ALCOHOL', 10) returning id", [A]);
const [{ id: Q }] = await raw("insert into products (store_id, name, stock) values ($1, 'GUANTES', 3) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 10), ($1, $4, $3, 3)", [Z, P, A, Q]);

const check = (u, items) => one(u, "select public.erp_stock_check($1, $2, $3::jsonb) r", [A, Z, JSON.stringify(items)]);
let r = await check(JAVIER, [{ product_id: P, qty: 5 }]);
ok(r.ok === true && r.short.length === 0, "Javier quiere 5 de 10: alcanza", r);
await raw("update erp_stock_levels set qty = qty - 5 where warehouse_id = $1 and product_id = $2", [Z, P]);
r = await check(JUAN, [{ product_id: P, qty: 6 }]);
ok(r.ok === false && r.short[0]?.available === 5 && r.short[0]?.wanted === 6 && r.short[0]?.name === "ALCOHOL", "Después de la venta de Javier, Juan ve que solo quedan 5 (no 10)", r);
r = await check(JUAN, [{ product_id: P, qty: 3 }, { product_id: P, qty: 3 }]);
ok(r.ok === false && r.short[0]?.wanted === 6, "Suma el mismo producto repetido en el carrito", r);
r = await check(JUAN, [{ product_id: P, qty: 5 }, { product_id: Q, qty: 4 }]);
ok(r.short.length === 1 && r.short[0].product_id === Q, "Solo marca lo que no alcanza", r);
r = await check(STRANGER, [{ product_id: P, qty: 1 }]);
ok(r.ok === false && /No perteneces/.test(r.error), "Alguien de otra tienda no puede consultar", r);
r = await one(JUAN, "select public.erp_stock_check($1, $2, $3::jsonb) r", [A, Y, JSON.stringify([{ product_id: P, qty: 1 }])]);
ok(r.ok === false && r.short[0]?.available === 0, "En un punto sin registro de existencias: 0 disponibles", r);

console.log("Pedidos internos");
await raw("update erp_stock_levels set qty = 10 where warehouse_id = $1 and product_id = $2", [Z, P]);
const [{ id: R1 }] = await raw("insert into erp_stock_requests (store_id, number, status, from_point_id, to_point_id) values ($1, 7, 'pending', $2, $3) returning id", [A, Y, Z]);
await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, 6)", [R1, P]);
const [{ id: R2 }] = await raw("insert into erp_stock_requests (store_id, number, status, from_point_id, to_point_id) values ($1, 8, 'received', $2, $3) returning id", [A, Y, Z]);
await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, 50)", [R2, P]);
const pre = (u, from, items) => one(u, "select public.erp_stock_request_precheck($1, $2, $3, $4::jsonb) r", [A, from, Z, JSON.stringify(items)]);
r = await pre(JUAN, Y, [{ product_id: P, qty: 2 }]);
let it = r.items[0];
ok(it.mine_open.includes(7), "Avisa que tu punto ya lo pidió en el pedido #7 abierto", it);
ok(it.source_stock === 10 && it.already_requested === 6 && it.free_stock === 4, "Quien surte tiene 10, ya pedidas 6 → libres 4 (el pedido recibido no cuenta)", it);
r = await pre(JUAN, B, [{ product_id: P, qty: 5 }]);
it = r.items[0];
ok(it.mine_open.length === 0 && it.wanted > it.free_stock, "Otro punto que pide 5: no está repetido, pero no alcanzan las libres", it);
await raw("update erp_stock_request_items set qty_approved = 2 where request_id = $1", [R1]);
r = await pre(JUAN, B, [{ product_id: P, qty: 5 }]);
ok(r.items[0].already_requested === 2 && r.items[0].free_stock === 8, "Si quien surte aprobó menos, cuenta lo aprobado", r.items[0]);
r = await pre(STRANGER, B, [{ product_id: P, qty: 1 }]);
ok(r.ok === false, "Alguien de otra tienda no puede consultar", r);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
