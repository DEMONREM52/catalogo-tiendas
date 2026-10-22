// Pruebas de 20261229: comisiones, metas, garantías, cliente fiel y cobro con QR.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_ep_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261113_inventario_precios_devoluciones.sql", "20261114_permisos_columnas_productos.sql", "20261115_pos_limites_precio.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8")), "alter table public.products add column if not exists category_id uuid;"].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261229_equipo_y_posventa.sql"), "utf8");
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
const U = (n) => `e3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), JUAN = U(2), ANA = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values ($1, $2, 'seller', '{pos}', $4, 'JUAN'), ($1, $3, 'seller', '{pos}', $4, 'ANA')", [A, JUAN, ANA, Z]);
const [{ id: CAT }] = await raw("insert into product_categories (store_id, name) values ($1, 'AUDIO') returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, category_id, price_1, price_2, price_3, price_4, price_5, cost_price) values ($1, 'PARLANTE', $2, 100000, 100000, 100000, 100000, 100000, 1) returning id", [A, CAT]);
const [{ id: Q }] = await raw("insert into products (store_id, name, price_1, price_2, price_3, price_4, price_5, cost_price) values ($1, 'CABLE', 10000, 10000, 10000, 10000, 10000, 1) returning id", [A]);
const sale = async (seller, name, items, customer = null) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at, customer_name) values ($1, md5(random()::text), $2, 'confirmed', now(), $3) returning id", [A, items.reduce((s, i) => s + i[1] * i[2], 0), customer]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, seller_id, seller_name) values ($1, $2, $3, $4, $5)", [id, A, Z, seller, name]);
  for (const [p, price, qty] of items) await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, $4)", [id, p, qty, price]);
};
await sale(JUAN, "JUAN", [[P, 100000, 2], [Q, 10000, 10]], "Maria Lopez");
await sale(ANA, "ANA", [[Q, 10000, 5]], "MARIA LOPEZ");

console.log("Comisiones");
ok((await one(JUAN, "select public.erp_commission_rules_save($1, $2::jsonb) r", [A, "[]"])).ok === false, "El vendedor no cambia las comisiones");
await one(OWNER, "select public.erp_commission_rules_save($1, $2::jsonb) r", [A, JSON.stringify([{ scope: "all", pct: 2 }, { scope: "category", ref_id: CAT, pct: 5 }, { scope: "product", ref_id: Q, pct: 10 }])]);
let r = await one(OWNER, "select public.erp_commissions($1, now() - interval '1 day', now() + interval '1 day') r", [A]);
const juan = r.sellers.find((s) => s.seller === "JUAN");
ok(r.ok && Number(juan.sales) === 300000 && Number(juan.commission) === 20000, "JUAN: $200.000 de audio al 5 % + $100.000 de cables al 10 % = $20.000", r);
r = await one(ANA, "select public.erp_commissions($1, now() - interval '1 day', now() + interval '1 day') r", [A]);
ok(r.sellers.length === 1 && r.sellers[0].seller === "ANA" && Number(r.sellers[0].commission) === 5000, "ANA solo ve lo suyo: $5.000", r);

console.log("Metas");
await one(OWNER, "select public.erp_goal_save($1, current_date, $2, null, null, 1000000) r", [A, Z]);
await one(OWNER, "select public.erp_goal_save($1, current_date, $2, $3, 'JUAN', 500000) r", [A, Z, JUAN]);
r = await one(OWNER, "select public.erp_goals_progress($1, null) r", [A]);
const g = r.goals.find((x) => !x.seller_id);
ok(r.ok && Number(g.done) === 350000 && Number(g.pct) === 35, "Zamora lleva $350.000 de $1.000.000 (35 %)", r.goals);
r = await one(ANA, "select public.erp_goals_progress($1, null) r", [A]);
ok(r.goals.length === 1 && !r.goals[0].seller_id, "ANA ve la meta de su punto, no la de JUAN", r.goals);

console.log("Garantías");
r = await one(JUAN, "select public.erp_warranty_save($1, $2::jsonb) r", [A, JSON.stringify({ point_id: Z, product_id: P, product_name: "parlante", customer_name: "maria", customer_phone: "300", problem: "No carga" })]);
ok(r.ok && r.number === 1, "Garantía #1 recibida", r);
await one(JUAN, "select public.erp_warranty_update($1, 'supplier', 'Se envió al proveedor', null) r", [r.id]);
await one(JUAN, "select public.erp_warranty_update($1, 'replaced', 'Se cambió por uno nuevo', null) r", [r.id]);
let list = await one(JUAN, "select public.erp_warranty_list($1, true) r", [A]);
ok(list.items[0].status === "replaced" && list.items[0].events.length === 3 && list.items[0].resolution === "Se cambió por uno nuevo", "Historial: recibido → proveedor → cambiado", list.items[0]);
await one(JUAN, "select public.erp_warranty_update($1, 'delivered', 'Entregado al cliente', null) r", [r.id]);
list = await one(JUAN, "select public.erp_warranty_list($1, true) r", [A]);
ok(list.items.length === 0, "Al entregar se cierra (ya no está entre las abiertas)");

console.log("Cliente fiel");
r = await one(JUAN, "select public.erp_loyalty_balance($1, 'maria lopez') r", [A]);
ok(r.ok && r.enabled === false, "Apagado: no hay puntos", r);
await one(OWNER, "select public.erp_loyalty_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, pesos_per_point: 1000, point_value: 10, min_redeem: 100 })]);
await raw("update erp_loyalty_settings set since = now() - interval '1 day' where store_id = $1", [A]);
r = await one(JUAN, "select public.erp_loyalty_balance($1, ' Maria  Lopez ') r", [A]);
ok(r.points === 350 && Number(r.value) === 3500, "MARIA LOPEZ: $350.000 en compras = 350 puntos = $3.500", r);
r = await one(JUAN, "select public.erp_loyalty_redeem($1, $2, 'maria lopez', 200, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: Q, qty: 1, old: 10000, price: 8000 }])]);
ok(r.ok && Number(r.value) === 2000 && r.passes[Q]?.status === "approved", "Canje de 200 puntos: $2.000 de descuento con su pase de precio", r);
r = await one(JUAN, "select public.erp_loyalty_balance($1, 'maria lopez') r", [A]);
ok(r.points === 150, "Le quedan 150 puntos", r);
ok((await one(JUAN, "select public.erp_loyalty_redeem($1, $2, 'maria lopez', 150, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: Q, qty: 1, old: 10000, price: 1000 }])])).ok === false, "El descuento tiene que coincidir con los puntos");

console.log("QR");
ok((await one(JUAN, "select public.erp_payment_qr_save($1, $2::jsonb) r", [A, JSON.stringify({ label: "Nequi" })])).ok === false, "El vendedor no configura los QR");
await one(OWNER, "select public.erp_payment_qr_save($1, $2::jsonb) r", [A, JSON.stringify({ label: "Nequi", key_text: "3001234567", image_url: "https://x/qr.png" })]);
await one(OWNER, "select public.erp_payment_qr_save($1, $2::jsonb) r", [A, JSON.stringify({ label: "Bancolombia Zamora", point_id: Z, key_text: "123-456" })]);
r = await one(JUAN, "select public.erp_payment_qr_list($1, $2) r", [A, Z]);
ok(r.length === 2, "En Zamora el POS ve el QR general y el del punto", r);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
