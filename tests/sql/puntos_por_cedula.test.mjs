// Pruebas de 20261230: puntos por cédula, regla por punto de venta y ajustes.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_pcd_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261113_inventario_precios_devoluciones.sql", "20261114_permisos_columnas_productos.sql", "20261115_pos_limites_precio.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
  "alter table public.products add column if not exists category_id uuid;\nalter table public.erp_order_meta add column if not exists customer_doc text;"].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);
for (const f of ["20261229_equipo_y_posventa.sql", "20261230_puntos_por_cedula.sql"]) { const sql = fs.readFileSync(path.join(MIG, f), "utf8"); await db.exec(sql); await db.exec(sql); }

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `e4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CENTRO', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, display_name) values ($1, $2, 'seller', '{pos}', 'JUAN')", [A, SELLER]);
await one(OWNER, "select public.erp_loyalty_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, pesos_per_point: 1000, point_value: 10, min_redeem: 50 })]);
await raw("update erp_loyalty_settings set since = now() - interval '1 day' where store_id = $1", [A]);
const sale = async (point, total, name, doc) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at, customer_name) values ($1, md5(random()::text), $2, 'confirmed', now(), $3) returning id", [A, total, name]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, customer_doc) values ($1, $2, $3, $4)", [id, A, point, doc]);
};
await sale(Z, 100000, "MARIA LOPEZ", "1.098.765.432");
await sale(C, 50000, "maria lopez", "1098765432");
await sale(C, 80000, "MARIA LOPEZ", "52111222");      // otra María, otra cédula
await sale(C, 90000, "SIN CEDULA", null);

let r = await one(SELLER, "select public.erp_loyalty_balance($1, '1098765432') r", [A]);
ok(r.points === 150 && r.name === "MARIA LOPEZ", "La misma cédula (con o sin puntos) suma sus compras: 150 puntos", r);
r = await one(SELLER, "select public.erp_loyalty_balance($1, '52111222') r", [A]);
ok(r.points === 80, "La otra María (otra cédula) no se mezcla: 80 puntos", r);
r = await one(SELLER, "select public.erp_loyalty_balance($1, 'MARIA LOPEZ') r", [A]);
ok(r.needs_doc === true || r.points === 0, "Por nombre ya no se buscan puntos (pide la cédula)", r);

console.log("Regla por punto");
ok((await one(SELLER, "select public.erp_loyalty_point_rules_save($1, $2::jsonb) r", [A, "[]"])).ok === false, "El vendedor no cambia las reglas");
await one(OWNER, "select public.erp_loyalty_point_rules_save($1, $2::jsonb) r", [A, JSON.stringify([{ point_id: Z, earns: true, pesos_per_point: 500 }, { point_id: C, earns: false }])]);
r = await one(SELLER, "select public.erp_loyalty_balance($1, '1098765432') r", [A]);
ok(r.points === 200, "Zamora da 1 punto por cada $500 ($100.000 = 200) y Centro no da puntos", r);
const rules = await one(SELLER, "select public.erp_loyalty_point_rules_get($1) r", [A]);
ok(rules.length === 3 && rules.find((x) => x.point === "CENTRO").earns === false, "Se ven las reglas de cada punto", rules);

console.log("Ajustes y canje");
ok((await one(SELLER, "select public.erp_loyalty_adjust($1, '1098765432', 100, 'regalo') r", [A])).ok === false, "El vendedor no regala puntos");
ok((await one(OWNER, "select public.erp_loyalty_adjust($1, '1098765432', 100, 'Cumpleaños') r", [A])).ok, "El dueño regala 100 puntos con motivo");
ok((await one(OWNER, "select public.erp_loyalty_adjust($1, '1098765432', -999, 'error') r", [A])).ok === false, "No puede quedar en negativo");
r = await one(SELLER, "select public.erp_loyalty_redeem($1, $2, '1098765432', 100, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: (await raw("insert into products (store_id, name, price_3) values ($1, 'X', 5000) returning id", [A]))[0].id, qty: 1, old: 5000, price: 4000 }])]);
ok(r.ok && Number(r.value) === 1000, "Canje de 100 puntos por $1.000", r);
r = await one(SELLER, "select public.erp_loyalty_balance($1, '1098765432') r", [A]);
ok(r.points === 200 && r.adjusted === 100 && r.used === 100, "Saldo: 200 ganados + 100 regalados − 100 canjeados = 200", r);
const h = await one(SELLER, "select public.erp_loyalty_history($1, '1098765432') r", [A]);
ok(h.ok && h.items.some((x) => x.kind === "adjust") && h.items.some((x) => x.kind === "redeem") && h.items.filter((x) => x.kind === "earn").length === 2, "Historial con compras, regalo y canje", h.items);
const list = await one(OWNER, "select public.erp_loyalty_customers($1) r", [A]);
ok(list.ok && list.customers.length === 2 && list.customers[0].doc === "1098765432" && !list.customers.some((c) => c.name === "SIN CEDULA"), "Lista de clientes con puntos (las ventas sin cédula no cuentan)", list.customers);

console.log("Nombre propio del programa (20261233)");
{ const sql = fs.readFileSync(path.join(MIG, "20261233_nombre_puntos.sql"), "utf8"); await db.exec(sql); await db.exec(sql); }
r = await one(SELLER, "select public.erp_loyalty_brand($1, $2) r", [A, Z]);
ok(r.name === "Puntos" && r.unit === "puntos", "Sin nombre propio se llama «Puntos»", r);
ok((await one(OWNER, "select public.erp_loyalty_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, pesos_per_point: 1000, point_value: 10, min_redeem: 50, program_name: "  Puntos   La Vitrina ", unit_name: "estrellas" })])).ok, "El dueño le pone nombre al programa y a la unidad");
r = await one(SELLER, "select public.erp_loyalty_brand($1, $2) r", [A, C]);
ok(r.name === "Puntos La Vitrina" && r.unit === "estrellas", "Todos los puntos usan el nombre general (sin espacios de más)", r);
await one(OWNER, "select public.erp_loyalty_point_rules_save($1, $2::jsonb) r", [A, JSON.stringify([{ point_id: Z, earns: true, pesos_per_point: 500, program_name: "Puntos Zamora" }])]);
ok((await one(SELLER, "select public.erp_loyalty_brand($1, $2) r", [A, Z])).name === "Puntos Zamora", "Zamora tiene su propio nombre");
ok((await one(SELLER, "select public.erp_loyalty_brand($1, $2) r", [A, C])).name === "Puntos La Vitrina", "   y Centro sigue con el general");
await one(OWNER, "select public.erp_loyalty_point_rules_save($1, $2::jsonb) r", [A, JSON.stringify([{ point_id: Z, earns: true, pesos_per_point: 400 }])]);
r = await one(SELLER, "select public.erp_loyalty_point_rules_get($1) r", [A]);
ok(r.find((x) => x.point === "ZAMORA").program_name === "Puntos Zamora" && r.find((x) => x.point === "ZAMORA").pesos_per_point === 400, "Cambiar la tasa no borra el nombre del punto", r);
await one(OWNER, "select public.erp_loyalty_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, pesos_per_point: 1000, point_value: 10, min_redeem: 50 })]);
ok((await one(SELLER, "select public.erp_loyalty_brand($1, $2) r", [A, C])).name === "Puntos La Vitrina", "Guardar la tasa general no borra el nombre");
r = await one(SELLER, "select public.erp_loyalty_balance($1, '1098765432') r", [A]);
ok(r.earned === 250 && r.points === r.earned + r.adjusted - r.used, "El saldo sigue igual de bien calculado: solo cambia el nombre (Zamora a $400 = 250)", r);
ok((await one(OWNER, "select public.erp_loyalty_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ enabled: true, program_name: "x".repeat(60) })])).ok, "Un nombre muy largo se recorta a 40 letras");
ok((await one(SELLER, "select public.erp_loyalty_brand($1, $2) r", [A, C])).name.length === 40, "   (queda de 40)");
ok((await one(U(9), "select public.erp_loyalty_brand($1, $2) r", [A, C])) === null, "Alguien de otra tienda no lo ve");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
