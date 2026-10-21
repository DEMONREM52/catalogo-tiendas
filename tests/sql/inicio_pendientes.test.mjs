// Pruebas de 20261221: pendientes de cada persona y «hoy en tu punto».
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create table if not exists public.erp_transfer_signatures (id uuid primary key default gen_random_uuid(), transfer_id uuid, store_id uuid, step text,
  signer_name text, created_at timestamptz default now());
`;
const combined = path.join(os.tmpdir(), `remhub_ip_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  extra,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261221_inicio_pendientes.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce200000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ZSELL = U(2), BOD = U(3), STRANGER = U(9);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{pos,transfers,stock_requests}', $3)", [A, ZSELL, Z]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{transfers,stock_requests_manage}', $3)", [A, BOD, B]);

const tasks = async (u) => (await one(u, "select public.erp_my_tasks($1) r", [A]));
const keys = (r) => (r?.tasks ?? []).map((t) => t.key);
let r = await tasks(OWNER);
ok(r.ok && r.tasks.length === 0, "Sin nada pendiente: lista vacía («Todo al día»)", r);
ok((await tasks(STRANGER)).ok === false, "Alguien de otra tienda no ve nada");

const [{ id: T1 }] = await raw("insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, created_at) values ($1, 1, $2, $3, now() - interval '3 days') returning id", [A, B, Z]);
await raw("insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id) values ($1, 2, $2, $3)", [A, B, Z]);
await raw("insert into erp_transfer_signatures (transfer_id, store_id, step, signer_name) values ($1, $2, 'sent', 'X')", [T1, A]);
r = await tasks(ZSELL);
let t = r.tasks.find((x) => x.key === "transfers_receive");
ok(t?.count === 2 && t.severity === "warning", "Punto Zamora: 2 traslados por recibir, uno lleva más de 2 días (aviso)", r);
ok(!keys(r).includes("transfers_check"), "Zamora no firma «Revisado» de lo que sale de la bodega", r);
r = await tasks(BOD);
ok(r.tasks.find((x) => x.key === "transfers_check")?.count === 1, "Bodega: 1 traslado que salió sin firma de «Revisado»", r);
ok(!keys(r).includes("transfers_receive"), "La bodega no tiene nada por recibir", r);
r = await tasks(OWNER);
ok(r.tasks.find((x) => x.key === "transfers_transit")?.count === 2, "Dueño: ve los 2 traslados en camino de toda la tienda", r);

await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, status) values ($1, $2, $3, 'pending'), ($1, $2, $3, 'dispatched')", [A, Z, B]);
r = await tasks(BOD);
ok(r.tasks.find((x) => x.key === "requests_attend")?.count === 1, "Bodega: 1 pedido interno por atender", r);
r = await tasks(ZSELL);
ok(r.tasks.find((x) => x.key === "requests_arriving")?.count === 1, "Zamora: 1 pedido viene en camino", r);
ok(!keys(r).includes("requests_attend"), "Zamora no atiende pedidos (no tiene ese permiso)", r);

await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, status, reason) values ($1, $2, 'point', 'pct', 10, 'pending', 'subir')", [A, Z]);
await raw("insert into products (store_id, name, stock, cost_price, active) values ($1, 'SIN COSTO', 4, 0, true), ($1, 'SIN UNIDADES', 0, 0, true), ($1, 'CON COSTO', 4, 1000, true)", [A]);
r = await tasks(OWNER);
ok(r.tasks.find((x) => x.key === "price_rules")?.count === 1, "Dueño: 1 cambio de precio por aprobar", r);
ok(r.tasks.find((x) => x.key === "no_cost")?.count === 1, "Dueño: 1 producto con unidades y sin costo (no cuenta los de 0 unidades)", r);
ok(!keys(await tasks(ZSELL)).includes("price_rules"), "El vendedor no ve aprobaciones de precio");

console.log("Hoy en tu punto");
const [{ id: P }] = await raw("select id from products where name = 'CON COSTO'");
const sale = async (wh, seller, total, ago = "0 hours", qty = 1) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), $2, 'confirmed', now() - $3::interval) returning id", [A, total, ago]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, seller_id) values ($1, $2, $3, $4)", [id, A, wh, seller]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, $4)", [id, P, qty, total]);
};
await sale(Z, ZSELL, 50000);
await sale(Z, OWNER, 20000);
await sale(B, OWNER, 99000);
await sale(Z, ZSELL, 35000, "1 day", 3);
const today = async (u) => one(u, "select public.erp_home_today($1) r", [A]);
r = await today(ZSELL);
ok(r.ok && r.points.length === 1 && r.points[0] === "ZAMORA", "El vendedor ve su punto", r);
ok(Number(r.today.total) === 70000 && r.today.count === 2, "Ventas de hoy solo de Zamora (no las de la bodega)", r.today);
ok(Number(r.mine.total) === 50000 && r.mine.count === 1, "Sus ventas de hoy", r.mine);
ok(r.top[0]?.name === "CON COSTO" && r.top[0].qty === 5, "Lo más vendido en 7 días del punto", r.top);
r = await today(OWNER);
ok(r.points.length === 0 && Number(r.today.total) === 169000, "El dueño ve toda la tienda", r);
ok((await today(BOD)).ok === false, "Sin permiso de ventas no ve este panel");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
