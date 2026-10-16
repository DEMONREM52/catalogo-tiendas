// Pruebas de 20261206: los precios por % salen del ÚLTIMO costo de compra (no del promedio).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_uc_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261113_inventario_precios_devoluciones.sql", "20261118_compras_desde_punto.sql",
      "20261119_costo_promedio_y_precio_directo.sql", "20261206_precio_ultimo_costo.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const OWNER = "c6000000-0000-0000-0000-000000000001", SELLER = "c6000000-0000-0000-0000-000000000002";
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid]); await db.exec("set role authenticated"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };
const err = async (uid, s, p) => { try { await as(uid, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'LA VITRINA', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, SELLER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROVEEDOR', true) returning id", [A]);
await raw("insert into erp_profit_settings (store_id, product_round_step, product_round_dir) values ($1, 1000, 'up') on conflict (store_id) do update set product_round_step = 1000, product_round_dir = 'up'", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, stock, markup_1, markup_2, markup_3, markup_4, markup_5) values ($1, 'ORGANIZADOR DE BAÑO TM 0091', 0, 0, 20, 20, 20, 20, 20) returning id", [A]);
const invoice = (ref, lines) => as(OWNER, "select public.erp_receive_invoice(p_store => $1, p_supplier => $2, p_invoice_ref => $3, p_invoice_date => current_date, p_payment_type => 'cash', p_due_date => null, p_notes => null, p_checked_by => 'X', p_items => $4::jsonb) r", [A, SUP, ref, JSON.stringify(lines)]);
const prod = async () => (await raw("select cost_price::float avg, last_cost::float last, price_1::float p1, price_3::float p3, stock from products where id = $1", [P]))[0];

console.log("Tu caso: 100 und. a $47.900 y luego 100 a $35.000, 20 % y redondeo hacia arriba a $1.000");
await invoice("F-1", [{ product_id: P, qty: 100, unit_cost: 47900, warehouse_id: B }]);
let p = await prod();
ok(p.last === 47900 && p.p3 === 58000, "Primera factura: último costo $47.900 → precio $58.000 (47.900 × 1,2 = 57.480 ⬆️)", p);
await raw("select pg_sleep(0.01)");
await invoice("F-2", [{ product_id: P, qty: 100, unit_cost: 35000, warehouse_id: B }]);
p = await prod();
ok(Math.round(p.avg) === 41450, "El costo PROMEDIO del inventario sigue siendo $41.450 (para el kardex)", p);
ok(p.last === 35000, "El ÚLTIMO costo es $35.000 (lo que pagaste en esta factura)", p);
ok(p.p3 === 42000 && p.p1 === 42000, "Precio con 20 %: $42.000 (antes daba $50.000 con el promedio)", p);

console.log("Anular la última factura");
const [{ id: F2 }] = await raw("select id from erp_purchases where invoice_ref = 'F-2'");
await raw("update erp_purchases set status = 'cancelled' where id = $1", [F2]);
p = await prod();
ok(p.last === 47900 && p.p3 === 58000, "Si se anula, el último costo vuelve al de la factura anterior ($47.900)", p);
await raw("update erp_purchases set status = 'received' where id = $1", [F2]);

console.log("Regla de la tienda");
ok(/tienda madre/.test((await err(SELLER, "select public.erp_reprice_apply($1, 'average', true)", [A])) ?? ""), "Un vendedor no puede cambiar la regla");
const prev = (await as(OWNER, "select public.erp_reprice_preview($1) r", [A]))[0].r;
ok(prev.basis === "last" && prev.changes === 0, "Con la regla «último costo» ya aplicada, la vista previa no muestra cambios", prev);
await as(OWNER, "select public.erp_reprice_apply($1, 'average', true)", [A]);
p = await prod();
ok(p.p3 === 50000, "Si la tienda escoge «costo promedio», vuelve a $50.000 (41.450 × 1,2 ⬆️)", p);
await as(OWNER, "select public.erp_reprice_apply($1, 'last', false)", [A]);
const prev2 = (await as(OWNER, "select public.erp_reprice_preview($1) r", [A]))[0].r;
ok(prev2.changes === 1 && prev2.down === 1 && Number(prev2.sample[0].new_price) === 42000 && Number(prev2.sample[0].old_price) === 50000,
  "Antes de aplicar se ve qué productos cambian (50.000 → 42.000)", prev2);
await as(OWNER, "select public.erp_reprice_apply($1, 'last', true)", [A]);
ok((await prod()).p3 === 42000, "Al aplicar, quedan con el último costo", await prod());

console.log("Protección");
ok(/permission denied/.test((await err(SELLER, "update products set last_cost = 1 where id = $1", [P])) ?? "") , "Nadie cambia el último costo directo desde el navegador");
const lc = (await as(OWNER, "select * from public.erp_product_last_costs($1, $2::uuid[])", [A, `{${P}}`]))[0];
ok(Number(lc.last_cost) === 35000 && Math.round(Number(lc.avg_cost)) === 41450, "El panel lee último costo y promedio por la función (con permiso)", lc);
ok(/permiso/.test((await err(SELLER, "select * from public.erp_product_last_costs($1, $2::uuid[])", [A, `{${P}}`])) ?? ""), "Sin permiso de costos no lo ve");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
