// Pruebas de 20261222: sugerencia de traslado según lo que vende cada punto.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_st_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261222_sugerencia_traslados.sql"), "utf8");
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
const U = (n) => `ce300000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, SELLER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: Y }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Y', 'CENTRO', true, 'point') returning id", [A]);
const prod = async (n) => (await raw("insert into products (store_id, name, sku, stock) values ($1, $2, $2, 0) returning id", [A, n]))[0].id;
const P = await prod("ALCOHOL"), Q = await prod("GUANTES"), R = await prod("SIN VENTAS");
const lvl = (w, p, q) => raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, $4) on conflict (warehouse_id, product_id) do update set qty = excluded.qty", [w, p, A, q]);
await lvl(B, P, 40); await lvl(B, Q, 100); await lvl(B, R, 50);
await lvl(Z, P, 2); await lvl(Y, P, 10); await lvl(Z, Q, 100);
const sale = async (wh, p, qty, ago = "3 days") => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), 0, 'confirmed', now() - $2::interval) returning id", [A, ago]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id) values ($1, $2, $3)", [id, A, wh]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, 0)", [id, p, qty]);
};
await sale(Z, P, 60);         // 2 por día
await sale(Y, P, 30);         // 1 por día
await sale(Z, Q, 30);         // 1 por día, pero tiene 100
await sale(Z, P, 500, "60 days"); // fuera de los 30 días

const sug = (u, targets, days = 15) => one(u, "select public.erp_restock_suggestions($1, $2, $3::uuid[], $4) r", [A, B, targets, days]);
let r = await sug(OWNER, [Z, Y]);
const get = (w, p) => r.items.find((i) => i.point_id === w && i.product_id === p);
ok(r.ok && get(Z, P)?.qty === 28, "Zamora vende 2/día, tiene 2: para 15 días pide 28", r.items);
ok(get(Y, P)?.qty === 5, "Centro vende 1/día, tiene 10: para 15 días pide 5", r.items);
ok(!get(Z, Q), "Guantes: Zamora tiene para 100 días, no se sugiere", r.items);
ok(!r.items.some((i) => i.product_id === R), "Lo que no se vende no se sugiere");
ok(Number(get(Z, P)?.days_left) === 1, "Muestra para cuántos días le alcanza hoy (1 día)", get(Z, P));

await lvl(B, P, 30);
r = await sug(OWNER, [Z, Y]);
ok(get(Z, P)?.qty === 28 && get(Y, P)?.qty === 2, "Si no alcanza el origen (30), primero al que se agota antes: Zamora 28, Centro 2", r.items);
r = await sug(OWNER, [Z], 30);
ok(get(Z, P)?.qty === 30, "Para 30 días pide 58 pero solo hay 30 en el origen", r.items);
r = await sug(SELLER, [Z]);
ok(r.ok === false, "Sin permiso de traslados no puede", r);
r = await sug(OWNER, [B]);
ok(r.ok && r.items.length === 0, "El origen no puede ser destino", r);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
