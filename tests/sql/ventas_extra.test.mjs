// Pruebas de 20261228: promociones, combos, cotizaciones, apartados y pases de precio.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create table if not exists public.erp_cash_sessions (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, number bigint, status text,
  opened_at timestamptz default now(), difference numeric, closed_by_name text, closed_at timestamptz);
create table if not exists public.erp_cash_moves (id uuid primary key default gen_random_uuid(), session_id uuid, store_id uuid, kind text, amount numeric,
  reason text, created_by uuid, created_by_name text, created_at timestamptz default now());
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
grant usage on schema public to anon;
`;
const combined = path.join(os.tmpdir(), `remhub_ve_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261113_inventario_precios_devoluciones.sql", "20261114_permisos_columnas_productos.sql", "20261115_pos_limites_precio.sql", "20261205_autorizaciones_precio.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261228_ventas_extra.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `e2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values ($1, $2, 'seller', '{pos}', $3, 'JUAN')", [A, SELLER, Z]);
const prod = async (n, cost, price) => (await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, $2, $3, $4, $4, $4, $4, $4, 0) returning id", [A, n, cost, price]))[0].id;
const P = await prod("PARLANTE", 30000, 50000), Q = await prod("CABLE", 3000, 10000);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 5), ($1, $4, $3, 20)", [Z, P, A, Q]);
await raw("update products set stock = 5 where id = $1", [P]);
await raw("update products set stock = 20 where id = $1", [Q]);
const level = async (p) => Number((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [Z, p]))[0]?.qty ?? 0);
const floorOf = async (p) => Number((await raw("select (public.erp__price_floor($1, $2, $3, $4)->>'floor')::numeric r", [A, SELLER, p, Z]))[0].r);
console.log("  (límite del vendedor para PARLANTE:", await floorOf(P), ")");

console.log("Promociones");
let r = await one(SELLER, "select public.erp_promotion_save($1, $2::jsonb) r", [A, JSON.stringify({ name: "Fin de semana", kind: "pct", value: 20, scope: "product", product_ids: [P], ends_at: new Date(Date.now() + 86400000).toISOString() })]);
ok(r.ok === false, "El vendedor no puede crear promociones", r);
r = await one(OWNER, "select public.erp_promotion_save($1, $2::jsonb) r", [A, JSON.stringify({ name: "Fin de semana", kind: "pct", value: 20, scope: "product", product_ids: [P], ends_at: new Date(Date.now() + 86400000).toISOString() })]);
ok(r.ok, "El dueño crea «20 % en PARLANTE»", r);
r = await one(SELLER, "select public.erp_promotions_list($1, $2, true) r", [A, Z]);
ok(r.length === 1 && r[0].running, "El POS ve la promoción vigente", r);
r = await one(SELLER, "select public.erp_price_passes($1, $2, 'promo', null, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: P, price: 40000, qty: 1 }, { product_id: Q, price: 5000, qty: 1 }])]);
ok(r.ok && r.passes[P]?.status === "approved" && !r.passes[Q], "Pase solo para el precio de la promoción (PARLANTE a $40.000), no para CABLE", r);
r = await one(SELLER, "select public.erp_price_passes($1, $2, 'promo', null, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: P, price: 30000, qty: 1 }])]);
ok(!r.passes[P], "Un precio menor al de la promoción no recibe pase", r);
const sale = (price) => err(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty: 1, price }])]);
ok((await sale(40000)) === null, "Con el pase, la venta a $40.000 pasa el guardián de precios");

console.log("Combos");
r = await one(OWNER, "select public.erp_combo_save($1, $2::jsonb) r", [A, JSON.stringify({ name: "parlante + cable", price: 52000, items: [{ product_id: P, qty: 1 }, { product_id: Q, qty: 1 }] })]);
ok(r.ok, "El dueño crea el combo", r);
const COMBO = r.id;
r = await one(SELLER, "select public.erp_combos_list($1) r", [A]);
ok(r[0]?.name === "PARLANTE + CABLE" && Number(r[0].regular) === 60000, "El POS ve el combo y su precio normal ($60.000)", r);
r = await one(SELLER, "select public.erp_price_passes($1, $2, 'combo', $3, $4::jsonb) r", [A, Z, COMBO, JSON.stringify([{ product_id: P, price: 43333, qty: 1 }, { product_id: Q, price: 8667, qty: 1 }])]);
ok(r.ok && r.passes[P] && r.passes[Q], "Pase para el combo cuando los precios suman $52.000", r);
r = await one(SELLER, "select public.erp_price_passes($1, $2, 'combo', $3, $4::jsonb) r", [A, Z, COMBO, JSON.stringify([{ product_id: P, price: 1000, qty: 1 }, { product_id: Q, price: 1000, qty: 1 }])]);
ok(r.ok === false, "Si no suman el valor del combo, no hay pase", r);

console.log("Cotizaciones");
r = await one(SELLER, "select public.erp_quote_save($1, $2::jsonb) r", [A, JSON.stringify({ point_id: Z, customer_name: "maria", customer_phone: "3001112233", items: [{ product_id: P, qty: 2, price: 50000 }, { product_id: Q, qty: 3, price: 9000 }] })]);
ok(r.ok && r.number === 1 && Number(r.total) === 127000, "Cotización #1 por $127.000", r);
const pub = await one(null, "select public.erp_quote_public($1) r", [r.token]);
ok(pub && pub.customer_name === "MARIA" && pub.items.length === 2 && !JSON.stringify(pub).includes("cost"), "Hoja pública por enlace, sin costos", pub);
ok((await one(null, "select public.erp_quote_public('corto') r")) === null, "Un enlace inventado no abre nada");
ok((await one(SELLER, "select public.erp_quote_set_status($1, 'accepted', 'tok') r", [r.id])).ok, "Se marca como aceptada al venderla");

console.log("Apartados");
const over = await err(SELLER, "select public.erp_layaway_create($1, $2::jsonb) r", [A, JSON.stringify({ point_id: Z, customer_name: "pedro", items: [{ product_id: P, qty: 6, price: 50000 }], first: { amount: 10000 } })]);
ok(/insuficiente/i.test(over ?? ""), "No se puede apartar más de lo que hay (la base lo frena)", over);
ok((await raw("select count(*)::int n from erp_layaways"))[0].n === 0, "Y no queda ningún apartado a medias");
const noCash = await one(SELLER, "select public.erp_layaway_create($1, $2::jsonb) r", [A, JSON.stringify({ point_id: Z, customer_name: "ana", items: [{ product_id: Q, qty: 1, price: 10000 }], first: { amount: 5000, method: "efectivo" } })]);
ok(noCash.ok && noCash.cash === false, "Sin caja abierta el abono queda registrado pero no entra a una caja", noCash);
const [{ id: S }] = await raw("insert into erp_cash_sessions (store_id, point_id, number, status) values ($1, $2, 1, 'open') returning id", [A, Z]);
r = await one(SELLER, "select public.erp_layaway_create($1, $2::jsonb) r", [A, JSON.stringify({ point_id: Z, customer_name: "pedro", customer_phone: "3009998877", items: [{ product_id: P, qty: 2, price: 50000 }], first: { amount: 30000, method: "efectivo" } })]);
ok(r.ok && r.number === 2 && Number(r.paid) === 30000 && r.cash, "Apartado #2: 2 parlantes, abono de $30.000 en efectivo a la caja", r);
const LAY = r.id;
ok(await level(P) === 3, "Las 2 unidades quedan reservadas (de 5 quedan 3 disponibles)", await level(P));
let moves = await raw("select kind, amount from erp_cash_moves where session_id = $1", [S]);
ok(moves.length === 1 && Number(moves[0].amount) === 30000 && moves[0].kind === "in", "La caja recibe el abono", moves);
ok((await one(SELLER, "select public.erp_layaway_pay($1, 80000, 'efectivo') r", [LAY])).ok === false, "No se puede abonar más del saldo");
r = await one(SELLER, "select public.erp_layaway_pay($1, 50000, 'transferencia') r", [LAY]);
ok(r.ok && Number(r.balance) === 20000, "Abono por transferencia: queda $20.000", r);
ok((await one(SELLER, "select public.erp_layaway_release($1, $2) r", [LAY, Z])).ok === false, "No se entrega con saldo pendiente");
await one(SELLER, "select public.erp_layaway_pay($1, 20000, 'efectivo') r", [LAY]);
r = await one(SELLER, "select public.erp_layaways_list($1, 'open') r", [A]);
ok(r.ok && r.items.find((i) => i.number === 2)?.balance === 0 && r.items.find((i) => i.number === 2).payments.length === 3, "La lista muestra saldo $0 y los 3 abonos", r.items);
r = await one(SELLER, "select public.erp_price_passes($1, $2, 'layaway', $3, $4::jsonb) r", [A, Z, LAY, JSON.stringify([{ product_id: P, price: 50000, qty: 2 }])]);
ok(r.ok && r.passes[P], "Pase para el precio pactado del apartado", r);
ok((await one(SELLER, "select public.erp_layaway_release($1, $2) r", [LAY, Z])).ok && await level(P) === 5, "Al entregar se sueltan las unidades para la venta");
ok((await one(SELLER, "select public.erp_layaway_hold($1) r", [LAY])).ok && await level(P) === 3, "Si la venta falla, vuelven a quedar apartadas");
await one(SELLER, "select public.erp_layaway_release($1, $2) r", [LAY, Z]);
const [{ id: O }] = await raw("insert into orders (store_id, token, total, status) values ($1, 'tok-lay', 100000, 'confirmed') returning id", [A]);
await raw("insert into erp_order_meta (order_id, store_id, point_id) values ($1, $2, $3)", [O, A, Z]);
r = await one(SELLER, "select public.erp_layaway_complete($1, 'tok-lay') r", [LAY]);
ok(r.ok, "Entregado con la venta", r);
const meta = (await raw("select payment from erp_order_meta where order_id = $1", [O]))[0].payment;
ok(meta.method === "apartado" && meta.parts.some((x) => x.method === "efectivo" && Number(x.amount) === 50000) && meta.parts.some((x) => x.method === "transferencia"), "La forma de pago de la venta son los abonos", meta);
moves = await raw("select kind, amount from erp_cash_moves where session_id = $1 order by created_at", [S]);
ok(moves.some((m) => m.kind === "out" && Number(m.amount) === 50000), "La caja se compensa con los $50.000 que ya habían entrado en efectivo", moves);
const c = await one(SELLER, "select public.erp_layaway_cancel($1, 'ya no lo quiere', 6000) r", [noCash.id]);
ok(c.ok === false, "No se reintegra más de lo abonado", c);
ok((await one(SELLER, "select public.erp_layaway_cancel($1, 'ya no lo quiere', 5000) r", [noCash.id])).ok && await level(Q) === 20, "Anular devuelve las unidades");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
