// Pruebas de 20261327: órdenes de compra (pedir → asociar la factura → comparar). No mueven inventario.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(path.join(here, "migraciones", "20261327_ordenes_de_compra.sql"));

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 700) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce200000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), BUYER = U(2), SELLER = U(3);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: S2 }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [U(9)]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{purchases}'), ($1, $3, 'seller', '{pos}')", [S, BUYER, SELLER]);
const [{ id: W }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'B', 'BODEGA', true) returning id", [S]);
const [{ id: NEXT }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'NEXT') returning id", [S]);
const [{ id: ALZ }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'ALZ') returning id", [S]);
const [{ id: AJENO }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'AJENO') returning id", [S2]);
const prod = async (store, n) => (await raw("insert into products (store_id, name, stock) values ($1, $2, 0) returning id", [store, n]))[0].id;
const P1 = await prod(S, "CLOSET"), P2 = await prod(S, "CHAQUETA"), P3 = await prod(S, "EXTRA"), PX = await prod(S2, "DE OTRA");
const items = (arr) => JSON.stringify(arr.map(([p, q, c]) => ({ product_id: p, qty: q, unit_cost: c })));
const save = (u, order, sup, arr) => one(u, "select public.erp_po_save($1, $2, $3, '2026-12-01', 'urgente', $4::jsonb) r", [S, order, sup, items(arr)]);

console.log("Crear");
let r = await save(BUYER, null, NEXT, [[P1, 10, 30000], [P2, 5, 80000]]);
ok(r.ok && Number(r.number) === 1, "Crea la orden N.º 1", r);
const O = r.id;
ok((await save(BUYER, null, NEXT, [[P1, 3, 1]])).number == 2, "La siguiente es la N.º 2");
ok((await save(SELLER, null, NEXT, [[P1, 1, 1]])).ok === false, "Sin permiso de Ingresos no crea");
ok((await save(BUYER, null, AJENO, [[P1, 1, 1]])).ok === false, "Proveedor de otra tienda: no");
ok((await save(BUYER, null, NEXT, [[PX, 1, 1]])).ok === false, "Producto de otra tienda: no");
ok((await save(BUYER, null, NEXT, [[P1, 1.5, 1]])).ok === false, "Cantidad con decimales: no");
ok((await save(BUYER, null, NEXT, [[P1, 1, 1], [P1, 2, 1]])).ok === false, "Producto repetido: no");
ok((await save(BUYER, null, NEXT, [])).ok === false, "Sin productos: no");
ok(Number((await raw("select stock from products where id = $1", [P1]))[0].stock) === 0, "Crear la orden no mueve el inventario");
r = await save(BUYER, O, NEXT, [[P1, 12, 30000], [P2, 5, 80000]]);
ok(r.ok, "Se edita mientras no haya llegado nada", r);

console.log("Llega la factura");
const invoice = async (sup, lines, status = "received") => {
  const [{ id }] = await raw("insert into erp_purchases (store_id, number, supplier_id, warehouse_id, status) values ($1, (select coalesce(max(number), 0) + 1 from erp_purchases), $2, $3, $4) returning id", [S, sup, W, status]);
  for (const [p, q, c] of lines) await raw("insert into erp_purchase_items (purchase_id, product_id, qty, unit_cost) values ($1, $2, $3, $4)", [id, p, q, c]);
  return id;
};
const F1 = await invoice(NEXT, [[P1, 8, 31000], [P3, 2, 5000]]);
ok((await one(BUYER, "select public.erp_po_link($1, $2) r", [O, await invoice(ALZ, [[P1, 1, 1]])])).ok === false, "Una factura de otro proveedor no se asocia");
r = await one(BUYER, "select public.erp_po_link($1, $2) r", [O, F1]);
ok(r.ok && r.status === "partial", "Con la primera factura queda «llegó una parte»", r);
let d = await one(BUYER, "select public.erp_po_detail($1) r", [O]);
const it = (id) => d.items.find((x) => x.product_id === id);
ok(it(P1).received == 8 && it(P1).pending == 4 && Number(it(P1).received_cost) === 31000, "CLOSET: pedí 12, llegaron 8 a $31.000, faltan 4", it(P1));
ok(it(P2).received == 0 && it(P2).pending == 5, "CHAQUETA: no ha llegado", it(P2));
ok(d.unordered.length === 1 && d.unordered[0].product_id === P3, "EXTRA llegó sin estar en la orden", d.unordered);
ok((await save(BUYER, O, NEXT, [[P1, 1, 1]])).ok === false, "Con mercancía recibida ya no se edita");
ok((await one(BUYER, "select public.erp_po_status($1, 'cancelled') r", [O])).ok === false, "Con facturas asociadas no se anula");

const F2 = await invoice(NEXT, [[P1, 5, 30000], [P2, 5, 80000]]);
r = await one(BUYER, "select public.erp_po_link($1, $2) r", [O, F2]);
ok(r.status === "received", "Con la segunda llegó todo", r);
d = await one(BUYER, "select public.erp_po_detail($1) r", [O]);
ok(it(P1).received == 13 && it(P1).extra == 1 && it(P1).pending == 0, "CLOSET: sobró 1", it(P1));
ok(d.invoices.length === 2, "Muestra las dos facturas");

console.log("Anular un ingreso asociado");
await raw("update erp_purchases set status = 'cancelled' where id = $1", [F2]);
d = await one(BUYER, "select public.erp_po_detail($1) r", [O]);
ok(d.order.status === "partial" && it(P1).received == 8, "Si se anula la segunda factura, vuelve a «llegó una parte»", d.order);

console.log("Cerrar, reabrir, anular");
r = await one(BUYER, "select public.erp_po_status($1, 'closed') r", [O]);
ok(r.ok && r.status === "closed", "Se cierra aunque falte (ya no llegará)");
r = await one(BUYER, "select public.erp_po_status($1, 'open') r", [O]);
ok(r.ok && r.status === "partial", "Al reabrir recupera su estado real", r);
const O2 = (await save(BUYER, null, ALZ, [[P3, 1, 1]])).id;
ok((await one(BUYER, "select public.erp_po_status($1, 'cancelled') r", [O2])).ok === true, "Sin facturas sí se anula");
ok((await one(BUYER, "select public.erp_po_link($1, $2) r", [O2, F1])).ok === false, "A una anulada no se le asocian facturas");

console.log("Lista y acceso");
r = await one(BUYER, "select public.erp_po_list($1, 'pending') r", [S]);
ok(r.ok && r.items.some((x) => x.id === O && Number(x.units) === 17 && Number(x.units_received) === 8) && !r.items.some((x) => x.id === O2), "Pendientes: la N.º 1 con 8 de 17 und.", r.items);
ok((await one(SELLER, "select public.erp_po_list($1) r", [S])).ok === false, "Sin permiso no ve la lista");
ok((await one(U(9), "select public.erp_po_detail($1) r", [O])).ok === false, "El dueño de otra tienda no ve el detalle");
ok(await as(BUYER, "select * from erp_purchase_orders").then((x) => x.length === 0, () => true), "La tabla no se lee directo (solo con las funciones)");
ok(await as(BUYER, "select public.erp__po_refresh($1)", [O]).then(() => false, () => true), "Las funciones internas no se llaman desde la API");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
