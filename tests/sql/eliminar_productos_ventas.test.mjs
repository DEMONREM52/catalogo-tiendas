// Pruebas de 20261263: eliminar productos — solo se bloquea si tiene ventas; el resto del historial se borra con él.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_elim_ventas_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  `create table if not exists public.erp_employee_loans (id uuid primary key default gen_random_uuid(), store_id uuid, status text not null default 'active', items jsonb not null default '[]');
   create table if not exists public.product_image_vectors (product_id uuid references public.products(id), store_id uuid, embedding text);
   create table if not exists public.erp_cosa_nueva (id uuid primary key default gen_random_uuid(), producto uuid references public.products(id));
   create table if not exists public.erp_cosa_hija (id uuid primary key default gen_random_uuid(), cosa uuid references public.erp_cosa_nueva(id), product_id uuid);`,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);
for (const f of ["20261260_eliminar_productos.sql", "20261263_eliminar_productos_sin_ventas.sql", "20261263_eliminar_productos_sin_ventas.sql"]) {
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

const OWNER = "de000000-0000-0000-0000-000000000001";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: W }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'W', 'Bodega', true, 'warehouse') returning id", [A]);
const prod = async (name) => (await raw("insert into products (store_id, name, sku, active, stock) values ($1, $2, $3, false, 0) returning id", [A, name, `SKU-${name}`]))[0].id;
const check = (id) => one(OWNER, "select public.erp_product_delete_check($1) r", [id]);
const del = (id) => one(OWNER, "select public.erp_product_delete($1, 'Ya no sirve') r", [id]);
const exists = async (id) => (await raw("select 1 from products where id = $1", [id])).length === 1;
const order = async (pid, status) => {
  const [{ id: O }] = await raw("insert into orders (store_id, token, status) values ($1, gen_random_uuid()::text, $2) returning id", [A, status]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1000)", [O, pid]);
  return O;
};

console.log("Se puede eliminar aunque tenga historial que no es venta");
const P = await prod("PORTATIL");
await raw("insert into inventory_movements (store_id, product_id, kind, qty) values ($1, $2, 'purchase', 3)", [A, P]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 3)", [W, P, A]);
await raw("insert into product_image_vectors (product_id, store_id, embedding) values ($1, $2, 'v')", [P, A]);
const [{ id: C }] = await raw("insert into erp_cosa_nueva (producto) values ($1) returning id", [P]);
await raw("insert into erp_cosa_hija (cosa, product_id) values ($1, $2)", [C, P]);
const cancelled = await order(P, "cancelled");
const c1 = await check(P);
ok(c1.can_delete === true && c1.reasons.length === 0, "Con kardex, unidades, búsqueda por foto y un pedido ANULADO: se puede", c1);
ok(Number(c1.units) === 3 && c1.will_delete.some((x) => /Kardex/.test(x.label)) && !c1.will_delete.some((x) => x.table === "product_image_vectors"),
  "Avisa que se van 3 unidades y el kardex (la búsqueda por foto es configuración)", c1);
const d1 = await del(P);
ok(d1.ok && !(await exists(P)), "Se elimina", d1);
ok(!(await raw("select 1 from inventory_movements where product_id = $1 union all select 1 from erp_stock_levels where product_id = $1 union all select 1 from product_image_vectors where product_id = $1 union all select 1 from order_items where product_id = $1", [P])).length,
  "Se fueron kardex, unidades, búsqueda por foto y la línea del pedido anulado");
ok((await raw("select 1 from orders where id = $1", [cancelled])).length === 1, "El pedido anulado sigue existiendo (solo sin esa línea)");
ok(!(await raw("select 1 from erp_cosa_nueva where producto = $1", [P])).length, "Tablas que dependen unas de otras se limpian en varias vueltas");
const audit = (await raw("select detail from erp_audit_logs where entity_id = $1 and action = 'product.deleted'", [P]))[0]?.detail;
ok(audit && Number(audit.units) === 3 && audit.deleted.inventory_movements === 1, "La auditoría guarda qué se borró y cuántas unidades había", audit);

console.log("No se puede si tiene ventas");
const V = await prod("VENDIDO");
await order(V, "confirmed");
const c2 = await check(V);
ok(c2.can_delete === false && c2.reasons.some((x) => /Pedidos y ventas/.test(x.label)), "Con una venta (pedido o POS de un punto): no se puede", c2);
ok(/tiene ventas/.test(await err(OWNER, "select public.erp_product_delete($1, 'xxx')", [V]) ?? "") && await exists(V), "Eliminar falla y el producto sigue");
const D = await prod("BORRADOR");
await order(D, "draft");
ok((await check(D)).can_delete === false, "Un pedido por confirmar también cuenta como venta");
const L = await prod("VALE");
await raw("insert into erp_employee_loans (store_id, items) values ($1, $2)", [A, JSON.stringify([{ product_id: L, qty: 1 }])]);
ok((await check(L)).reasons.some((x) => /Vales/.test(x.label)), "Entregado en un vale a un empleado: no se puede");
const LV = await prod("VALEANULADO");
await raw("insert into erp_employee_loans (store_id, status, items) values ($1, 'void', $2)", [A, JSON.stringify([{ product_id: LV, qty: 1 }])]);
ok((await check(LV)).can_delete === true, "Un vale anulado no cuenta");

console.log("Limpiar");
const u = await one(OWNER, "select public.erp_products_unused($1, true) r", [A]);
const names = u.products.map((x) => x.name).sort();
ok(JSON.stringify(names) === JSON.stringify(["VALEANULADO"]), "Limpiar lista solo los no vendidos", names);

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
