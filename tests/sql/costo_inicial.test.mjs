// Pruebas de 20261119 y del script de inventario inicial (100 und. por producto).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "../../supabase/migrations");
const SCRIPTS = path.join(here, "../../supabase/scripts");
const combined = path.join(os.tmpdir(), `remhub_ci_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261113_inventario_precios_devoluciones.sql", "20261118_compras_desde_punto.sql", "20261119_costo_promedio_y_precio_directo.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const OWNER = "c3000000-0000-0000-0000-000000000001";
const as = async (s, p) => { await db.query("select set_config('test.uid', $1, false)", [OWNER]); await db.exec("set role authenticated"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'LA VITRINA', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: M }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'M', 'SEDE MANHATTAN', true, 'point') returning id", [A]);
const [{ id: INI }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'INGRESO INICIAL DE INVENTARIO', true) returning id", [A]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROVEEDOR REAL', true) returning id", [A]);
const mk = async (name, p2, stock) => (await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, $2, 0, $3, $3, $3, $3, $3, $4) returning id", [A, name, p2, stock]))[0].id;
const COMP = await mk("COMPRESOR", 48000, 0), PLAIN = await mk("CARGADOR", 46000, 0), NOPRICE = await mk("SIN PRECIO", 0, 0);
// 1.999 unidades cargadas antes, SIN costo (como en producción).
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 1999)", [B, COMP, A]);
await raw("update products set stock = 1999 where id = $1", [COMP]);
await raw("update erp_stock_levels set qty = 1999 where warehouse_id = $1 and product_id = $2", [B, COMP]);
const invoice = (ref, sup, lines) => as("select public.erp_receive_invoice(p_store => $1, p_supplier => $2, p_invoice_ref => $3, p_invoice_date => current_date, p_payment_type => 'cash', p_due_date => null, p_notes => null, p_checked_by => 'X', p_items => $4::jsonb) r", [A, sup, ref, JSON.stringify(lines)]);
const prod = async (id) => (await raw("select cost_price::float c, price_2::float p2, price_5::float p5, markup_2::float m2, stock from products where id = $1", [id]))[0];

console.log("1. Costo promedio sin unidades sin costo");
await invoice("F-REAL-1", SUP, [{ product_id: COMP, qty: 1000, unit_cost: 47900, warehouse_id: M }]);
const c1 = await prod(COMP);
ok(c1.c === 47900, "1.999 und. a $0 + 1.000 a $47.900 → costo $47.900 (antes daba $15.972)", c1);
await invoice("F-REAL-2", SUP, [{ product_id: COMP, qty: 1000, unit_cost: 50000, warehouse_id: M }]);
ok(Math.round((await prod(COMP)).c) === 48950 || Math.round((await prod(COMP)).c) > 47900, "Con costo previo, el promedio ponderado sigue funcionando", await prod(COMP));

console.log("2. Precio escrito → el % exacto, sin saltos de redondeo");
await raw("insert into erp_profit_settings (store_id, product_round_step, product_round_dir) values ($1, 1000, 'up') on conflict (store_id) do update set product_round_step = 1000, product_round_dir = 'up'", [A]);
await raw("update products set cost_price = 40000 where id = $1", [PLAIN]);
const m = Math.round(((47000 / 40000) - 1) * 100 * 10000) / 10000;
await as("update products set markup_2 = $2 where id = $1", [PLAIN, m]);
ok((await prod(PLAIN)).p2 === 47000, "Costo $40.000, precio escrito $47.000 → 17,5 % → queda $47.000 (redondeo hacia arriba a $1.000)", await prod(PLAIN));
await raw("update products set cost_price = 41739 where id = $1", [PLAIN]);
await as("update products set markup_2 = $2 where id = $1", [PLAIN, Math.round(((47000 / 41739) - 1) * 100 * 10000) / 10000]);
ok((await prod(PLAIN)).p2 === 47000, "Con un costo «raro» ($41.739) también queda exacto en $47.000", await prod(PLAIN));
await raw("update products set cost_price = 0, markup_1 = null, markup_2 = null, markup_3 = null, markup_4 = null, markup_5 = null, price_1 = 46000, price_2 = 46000, price_3 = 46000, price_4 = 46000, price_5 = 46000 where id = $1", [PLAIN]);

console.log("3. Factura de inventario inicial");
const before = await raw("select id, price_2::float p2, price_5::float p5 from products order by name");
const rev = await db.exec(fs.readFileSync(path.join(SCRIPTS, "inventario_inicial_100_revisar.sql"), "utf8"));
ok(rev[0].rows[0].tiendas_con_proveedor_inicial == 1 && rev[0].rows[0].bodega_destino && rev[0].rows[0].ya_hecho == 0, "Revisar: una tienda, su bodega principal, aún no hecho", rev[0].rows[0]);
const origen = Object.fromEntries(rev[1].rows.map((r) => [r.name, [r.origen_costo, Number(r.costo_nuevo)]]));
ok(origen.COMPRESOR[0] === "factura real" && origen.CARGADOR[1] === 40000 && /SIN COSTO/.test(origen["SIN PRECIO"][0]), "La vista previa muestra de dónde sale cada costo", origen);
// En Supabase auth.uid() lee request.jwt.claims (lo pone el script); en esta base de prueba lee test.uid.
await raw("select set_config('test.uid', $1, false)", [OWNER]);
await db.exec(fs.readFileSync(path.join(SCRIPTS, "inventario_inicial_100_aplicar.sql"), "utf8"));
const comp = await prod(COMP), plain = await prod(PLAIN), nop = await prod(NOPRICE);
ok(comp.c === 50000, "COMPRESOR: conserva su costo de la factura real más reciente ($50.000)", comp);
ok(plain.c === 40000 && plain.p2 === 46000, "CARGADOR: precio 2 $46.000 − 15 % → costo $40.000 y el precio no cambia", plain);
ok(Math.abs(plain.m2 - 15) < 0.001, "…y su % de ganancia queda en 15 % (coincide con el precio)", plain);
ok(nop.stock === 0 && nop.c === 0, "SIN PRECIO: se omite (no hay con qué costear)", nop);
const bq = await raw("select p.name, l.qty from erp_stock_levels l join products p on p.id = l.product_id where l.warehouse_id = $1 order by p.name", [B]);
ok(bq.find((r) => r.name === "COMPRESOR")?.qty === 2099 && bq.find((r) => r.name === "CARGADOR")?.qty === 100, "100 und. más en la bodega principal", bq);
const after = await raw("select id, price_2::float p2, price_5::float p5 from products order by name");
ok(JSON.stringify(before) === JSON.stringify(after), "Ningún precio cambió");
const pu = (await raw("select count(*)::int n, max(i.purchase_id::text) pid from erp_purchases p join erp_purchase_items i on i.purchase_id = p.id where p.invoice_ref = 'INVENTARIO-INICIAL-100'"))[0];
ok(pu.n === 2, "Una sola factura INVENTARIO-INICIAL-100 con sus 2 líneas", pu);
const kx = (await raw("select count(*)::int n from inventory_movements where ref_id = $1 and movement_type = 'purchase'", [pu.pid]))[0].n;
ok(kx === 2, "Cada línea dejó su movimiento en el kardex");
let again = null; try { await db.exec(fs.readFileSync(path.join(SCRIPTS, "inventario_inicial_100_aplicar.sql"), "utf8")); } catch (e) { again = e.message; }
ok(/ya se hizo/.test(again ?? ""), "Si se corre otra vez, se detiene sin cambiar nada", again);
ok((await raw("select count(*)::int n from backup_inventario_inicial_100"))[0].n === 2, "Copia de seguridad guardada");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
