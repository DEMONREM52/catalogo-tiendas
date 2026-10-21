// Pruebas de 20261223: clientes frecuentes.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_cf_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261223_clientes_frecuentes.sql"), "utf8");
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
const U = (n) => `ce400000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ZSELL = U(2), NOPE = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{clients}', $3), ($1, $4, 'seller', '{pos}', null)", [A, ZSELL, Z, NOPE]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock) values ($1, 'ALCOHOL', 10) returning id", [A]);
const [{ id: Q }] = await raw("insert into products (store_id, name, stock) values ($1, 'GUANTES', 10) returning id", [A]);
await raw("insert into billing_customers (store_id, name, mobile) values ($1, 'Maria Lopez', '300 111 2233')", [A]);
const sale = async (wh, who, total, ago, prod = P, qty = 1, phone = null) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at, customer_name, customer_whatsapp) values ($1, md5(random()::text), $2, 'confirmed', now() - $3::interval, $4, $5) returning id", [A, total, ago, who, phone]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id) values ($1, $2, $3)", [id, A, wh]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, $4)", [id, prod, qty, total]);
};
await sale(Z, "maria  lopez", 50000, "100 days", P, 5);
await sale(Z, "MARIA LOPEZ", 30000, "90 days", Q, 1);
await sale(Z, "Maria Lopez", 20000, "80 days", P, 2);
await sale(B, "PEDRO", 200000, "2 days", Q, 3, "3109998877");
await sale(B, "Consumidor final", 999999, "1 day");
await sale(B, "", 999999, "1 day");
await sale(B, "VIEJO", 10000, "800 days");

let r = await one(OWNER, "select public.erp_customer_insights($1, 365) r", [A]);
const get = (n) => r.customers.find((c) => c.name === n);
ok(r.ok && r.customers[0]?.name === "PEDRO", "Ordena por lo que más compra (Pedro primero)", r.customers);
ok(get("MARIA LOPEZ")?.orders === 3 && Number(get("MARIA LOPEZ").total) === 100000, "Junta «maria  lopez», «MARIA LOPEZ» y «Maria Lopez» en una sola clienta", get("MARIA LOPEZ"));
ok(get("MARIA LOPEZ")?.days_since === 80 && Number(get("MARIA LOPEZ").every_days) === 10, "Hace 80 días no vuelve; suele volver cada 10 días", get("MARIA LOPEZ"));
ok(get("MARIA LOPEZ")?.phone === "3001112233" && get("MARIA LOPEZ").customer_id, "Toma el celular de su ficha de terceros", get("MARIA LOPEZ"));
ok(get("MARIA LOPEZ")?.top?.[0] === "ALCOHOL", "Lo que más compra: ALCOHOL", get("MARIA LOPEZ"));
ok(get("PEDRO")?.phone === "3109998877", "O el celular del documento de venta", get("PEDRO"));
ok(!get("CONSUMIDOR FINAL") && !r.customers.some((c) => !c.name), "Ignora «consumidor final» y ventas sin nombre", r.customers.map((c) => c.name));
ok(!get("VIEJO"), "Fuera del periodo no aparece");
r = await one(ZSELL, "select public.erp_customer_insights($1, 365) r", [A]);
ok(r.ok && r.customers.length === 1 && r.customers[0].name === "MARIA LOPEZ", "Usuario de Zamora: solo clientes de las ventas de su punto", r.customers);
r = await one(NOPE, "select public.erp_customer_insights($1, 365) r", [A]);
ok(r.ok === false, "Sin permiso de clientes no ve nada", r);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
