// Pruebas de 20261260: eliminar productos solo si nunca tuvieron movimientos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_elim_prod_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  // Tabla de vales (solo lo que usa la revisión) y una tabla nueva con llave foránea que la revisión no conoce por nombre.
  `create table if not exists public.erp_employee_loans (id uuid primary key default gen_random_uuid(), store_id uuid, items jsonb not null default '[]');
   create table if not exists public.erp_cosa_nueva (id uuid primary key default gen_random_uuid(), producto uuid references public.products(id));`,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(here, "migraciones/20261260_eliminar_productos.sql"), "utf8");
await db.exec(M);
await db.exec(M); // idempotente

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const OWNER = "dd000000-0000-0000-0000-000000000001", SELLER = "dd000000-0000-0000-0000-000000000002", POINTER = "dd000000-0000-0000-0000-000000000003";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", ["dd000000-0000-0000-0000-000000000009"]);
const [{ id: W }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'W', 'Bodega', true, 'warehouse') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, SELLER]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{products}', $3)", [A, POINTER, W]);
const prod = async (name, extra = {}) => (await raw("insert into products (store_id, name, sku, active, stock) values ($1, $2, $3, $4, $5) returning id", [extra.store ?? A, name, `SKU-${name}`, extra.active ?? false, extra.stock ?? 0]))[0].id;

// 1. Producto nuevo, sin nada: se puede; catálogo, categoría y existencias en 0 se van con él.
const LIMPIO = await prod("LIMPIO");
await raw("insert into store_catalog_products (catalog_id, product_id, store_id) values (gen_random_uuid(), $1, $2)", [LIMPIO, A]);
await raw("insert into product_category_links (product_id, category_id, store_id) values ($1, gen_random_uuid(), $2)", [LIMPIO, A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 0)", [W, LIMPIO, A]);
const chk = await one(OWNER, "select public.erp_product_delete_check($1) r", [LIMPIO]);
ok(chk.ok && chk.can_delete && chk.reasons.length === 0, "Producto sin movimientos: se puede eliminar", chk);
ok(/motivo/i.test(await err(OWNER, "select public.erp_product_delete($1, '') r", [LIMPIO]) ?? ""), "Pide el motivo");
const del = await one(OWNER, "select public.erp_product_delete($1, 'Lo creé mal') r", [LIMPIO]);
ok(del.ok && del.name === "LIMPIO", "Se elimina", del);
ok(!(await raw("select 1 from products where id = $1", [LIMPIO])).length, "Ya no existe el producto");
ok(!(await raw("select 1 from store_catalog_products where product_id = $1 union all select 1 from product_category_links where product_id = $1 union all select 1 from erp_stock_levels where product_id = $1", [LIMPIO])).length,
  "Su configuración (catálogo, categoría, existencias en 0) se fue con él");
const audit = await raw("select action, detail from erp_audit_logs where entity_id = $1", [LIMPIO]);
ok(audit.length === 1 && audit[0].action === "product.deleted" && audit[0].detail.reason === "Lo creé mal" && audit[0].detail.sku === "SKU-LIMPIO", "Queda en la auditoría con nombre, código y motivo", audit);

// 2. Con historial: no se puede y dice dónde.
const KARDEX = await prod("KARDEX");
await raw("insert into inventory_movements (store_id, product_id, kind, qty) values ($1, $2, 'adjust', 1)", [A, KARDEX]);
const ck = await one(OWNER, "select public.erp_product_delete_check($1) r", [KARDEX]);
ok(ck.can_delete === false && ck.reasons.some((x) => /Kardex/.test(x.label)), "Con kardex: no se puede, y dice «Kardex»", ck);
ok(/historial \(Kardex/.test(await err(OWNER, "select public.erp_product_delete($1, 'Ya no sirve') r", [KARDEX]) ?? ""), "Eliminar falla con el motivo");
ok((await raw("select 1 from products where id = $1", [KARDEX])).length === 1, "Sigue existiendo");

const VENDIDO = await prod("VENDIDO");
const [{ id: O }] = await raw("insert into orders (store_id, token) values ($1, 'tok1') returning id", [A]);
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1000)", [O, VENDIDO]);
ok((await one(OWNER, "select public.erp_product_delete_check($1) r", [VENDIDO])).reasons.some((x) => /Pedidos/.test(x.label)), "Con un pedido: no se puede (Pedidos y ventas)");

const CONUNIDADES = await prod("CONUNIDADES");
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 4)", [W, CONUNIDADES, A]);
ok((await one(OWNER, "select public.erp_product_delete_check($1) r", [CONUNIDADES])).reasons.some((x) => /unidades/.test(x.label)), "Con unidades en una bodega: no se puede");

const VALE = await prod("VALE");
await raw("insert into erp_employee_loans (store_id, items) values ($1, $2)", [A, JSON.stringify([{ product_id: VALE, qty: 1 }])]);
ok((await one(OWNER, "select public.erp_product_delete_check($1) r", [VALE])).reasons.some((x) => /Vales/.test(x.label)), "Entregado en un vale de empleado: no se puede");

const NUEVA = await prod("NUEVA");
await raw("insert into erp_cosa_nueva (producto) values ($1)", [NUEVA]);
const cn = await one(OWNER, "select public.erp_product_delete_check($1) r", [NUEVA]);
ok(cn.can_delete === false && cn.reasons.some((x) => x.table === "erp_cosa_nueva"), "Una tabla nueva con llave foránea también protege (sin conocerla por nombre)", cn);

// 3. Permisos.
const P2 = await prod("PERMISOS");
ok(/permiso/i.test(await err(SELLER, "select public.erp_product_delete($1, 'xxx') r", [P2]) ?? ""), "Sin permiso «Productos» no elimina");
ok(/madre/i.test(await err(POINTER, "select public.erp_product_delete($1, 'xxx') r", [P2]) ?? ""), "Con «Productos» pero de un punto: no elimina");
const OTRA = await prod("OTRA", { store: B });
ok(/permiso/i.test(await err(OWNER, "select public.erp_product_delete($1, 'xxx') r", [OTRA]) ?? ""), "No elimina productos de otra tienda");
ok(/permission denied/i.test(await err(OWNER, "select public.erp__product_usage($1) r", [P2]) ?? ""), "Las funciones internas no se llaman desde la app");

// 4. Limpiar: los inactivos que se pueden eliminar (uno con historial no sale).
const ACTIVO = await prod("ACTIVO", { active: true });
const u = await one(OWNER, "select public.erp_products_unused($1, true) r", [A]);
const names = u.products.map((x) => x.name).sort();
ok(u.ok && JSON.stringify(names) === JSON.stringify(["PERMISOS"]), "Limpiar (inactivos): solo los que no tienen historial", names);
const all = await one(OWNER, "select public.erp_products_unused($1, false) r", [A]);
ok(all.products.some((x) => x.id === ACTIVO) && !all.products.some((x) => [KARDEX, VENDIDO, CONUNIDADES, VALE, NUEVA].includes(x.id)), "Con activos: suma el activo sin historial", all.products.map((x) => x.name));
ok((await one(POINTER, "select public.erp_products_unused($1, true) r", [A])).ok === false, "Un usuario de punto no ve la lista");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
