// Pruebas de 20261264: los traslados y las unidades también impiden eliminar un producto.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_elim_tras_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  `create table if not exists public.erp_employee_loans (id uuid primary key default gen_random_uuid(), store_id uuid, status text not null default 'active', items jsonb not null default '[]');
   create table if not exists public.product_image_vectors (product_id uuid references public.products(id), store_id uuid, embedding text);`,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);
for (const f of ["20261260_eliminar_productos.sql", "20261263_eliminar_productos_sin_ventas.sql", "20261264_eliminar_productos_traslados.sql", "20261264_eliminar_productos_traslados.sql"]) {
  await db.exec(fs.readFileSync(path.join(here, "migraciones", f), "utf8"));
}

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const OWNER = "df000000-0000-0000-0000-000000000001";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'B', 'Bodega', true, 'warehouse') returning id", [A]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'Zamora', true, 'point') returning id", [A]);
const prod = async (name) => (await raw("insert into products (store_id, name, sku, active, stock) values ($1, $2, $3, false, 0) returning id", [A, name, `SKU-${name}`]))[0].id;
const check = (id) => one(OWNER, "select public.erp_product_delete_check($1) r", [id]);
const transfer = async (pid, status) => {
  const [{ id: T }] = await raw("insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, status) values ($1, (select coalesce(max(number), 0) + 1 from erp_transfers), $2, $3, $4) returning id", [A, B, Z, status]);
  await raw("insert into erp_transfer_items (transfer_id, product_id, qty) values ($1, $2, 2)", [T, pid]);
};

const T1 = await prod("TENDEDERO");
await transfer(T1, "received");
const c1 = await check(T1);
ok(c1.can_delete === false && c1.reasons.some((x) => x.label === "Traslados"), "Con un traslado recibido: no se puede", c1);
ok(/ventas o traslados \(Traslados\)/.test(await err(OWNER, "select public.erp_product_delete($1, 'xxx')", [T1]) ?? ""), "Eliminar falla y dice «Traslados»");
const T2 = await prod("EN CAMINO");
await transfer(T2, "in_transit");
ok((await check(T2)).can_delete === false, "Con un traslado en camino: no se puede");
const T3 = await prod("TRASLADO ANULADO");
await transfer(T3, "cancelled");
ok((await check(T3)).can_delete === true, "Un traslado anulado no cuenta");

const U = await prod("CON UNIDADES");
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 210)", [Z, U, A]);
const cu = await check(U);
ok(cu.can_delete === false && cu.reasons.some((x) => /unidades/.test(x.label)), "Con 210 unidades en un punto: no se puede", cu);

const K = await prod("SOLO KARDEX");
await raw("insert into inventory_movements (store_id, product_id, kind, qty) values ($1, $2, 'adjust', 0)", [A, K]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 0)", [B, K, A]);
ok((await check(K)).can_delete === true, "Con kardex y existencias en 0 (sin ventas ni traslados): sí se puede");
const d = await one(OWNER, "select public.erp_product_delete($1, 'Ya no sirve') r", [K]);
ok(d.ok && !(await raw("select 1 from products where id = $1", [K])).length, "Y se elimina");

const u = await one(OWNER, "select public.erp_products_unused($1, true) r", [A]);
ok(JSON.stringify(u.products.map((x) => x.name).sort()) === JSON.stringify(["TRASLADO ANULADO"]), "Limpiar no muestra los que tienen traslados o unidades", u.products.map((x) => x.name));

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
