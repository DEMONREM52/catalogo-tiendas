// Pruebas de 20261304 (centro de operaciones en vivo). Base copiada de caja.test.mjs.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
create table if not exists public.erp_stock_requests (id uuid primary key default gen_random_uuid(), store_id uuid not null, number bigint,
  status text default 'pending', priority text default 'normal', from_point_id uuid, to_point_id uuid, created_at timestamptz not null default now());
alter table public.erp_stock_requests add column if not exists number bigint;
alter table public.erp_stock_requests add column if not exists priority text default 'normal';
`;
const combined = path.join(os.tmpdir(), `remhub_ops_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  fs.readFileSync(path.join(MIG, "20261110_gastos_presupuestos_nomina.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261128_caja.sql"), "utf8"),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}

const U = (n) => `cf000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CIS = U(2), NADA = U(3), FUERA = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const BOD = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const wh = async (n) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, n]))[0].id;
const C = await wh("CISNEROS"), Z = await wh("ZAMORA");
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id) values
  ($1,$2,'seller','{pos,transfers}',$4), ($1,$3,'seller','{products}',null)`, [A, CIS, NADA, C]);

const sale = async (point, status, total, ago = "5 minutes", kind = "remision") => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, created_at, customer_name) values ($1, md5(random()::text), $2, $3, now() - $4::interval, 'Ana') returning id", [A, total, status, ago]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, doc_number) values ($1, $2, $3, $4, 'R-' || floor(random()*1000))", [id, A, point, kind]);
};
await sale(C, "confirmed", 50000);
await sale(C, "completed", 30000);
await sale(Z, "completed", 100000);
await sale(C, "draft", 7000);
await sale(Z, "completed", 40000, "1 day");
await sale(C, "cancelled", 999000);
await raw("insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, status) values ($1, 1, $2, $3, 'in_transit'), ($1, 2, $2, $4, 'in_transit')", [A, BOD, C, Z]);
await raw("insert into erp_stock_requests (store_id, number, status, priority, from_point_id, to_point_id) values ($1, 7, 'pending', 'urgent', $2, $3), ($1, 8, 'received', 'normal', $4, $3)", [A, C, BOD, Z]);
await raw("insert into erp_adjustments (store_id, number, warehouse_id, reason) values ($1, 1, $2, 'damage')", [A, Z]);

const M = fs.readFileSync(path.join(MIG, "20261304_centro_operaciones.sql"), "utf8");
await db.exec(M);
await db.exec(M); // se puede correr dos veces

const ops = async (u, days = 7, point = null) => (await as(u, "select public.ops_center($1, $2, $3) r", [A, days, point]))[0].r;

console.log("1. Dueño: todo");
let r = await ops(OWNER);
ok(r.ok === true, "Responde", r);
ok(r.kpis.sales_today.count === 3 && Number(r.kpis.sales_today.total) === 180000, "Ventas de hoy: 3 por $180.000 (sin borrador ni anuladas)", r.kpis);
ok(Number(r.kpis.sales_yesterday.total) === 40000, "Ayer: $40.000", r.kpis.sales_yesterday);
ok(r.kpis.by_hour.length === 24 && r.kpis.by_hour.reduce((s, x) => s + Number(x), 0) === 180000, "Ventas por hora suman lo de hoy");
ok(r.kpis.to_confirm === 1 && r.kpis.to_complete === 1, "1 por confirmar y 1 por completar", r.kpis);
ok(r.kpis.transfers_in_transit === 2, "2 traslados en camino");
ok(r.kpis.sr_open === 1 && r.kpis.sr_urgent === 1, "1 pedido interno abierto y urgente", r.kpis);
ok(r.points.length === 2 && r.points[0].name === "ZAMORA", "Ventas de hoy por punto (mayor primero)", r.points);
const kinds = new Set(r.feed.map((e) => e.kind));
ok(["remision", "order", "transfer", "stock_request", "adjustment"].every((k) => kinds.has(k)), "El historial trae ventas, pedidos, traslados, internos y ajustes", [...kinds]);
ok(r.feed.every((e, i) => i === 0 || e.at <= r.feed[i - 1].at), "Historial del más reciente al más viejo");
ok(r.feed.every((e) => typeof e.href === "string" && e.href.startsWith("/")), "Cada movimiento tiene enlace");

console.log("2. Filtro por punto y por días");
r = await ops(OWNER, 7, Z);
ok(r.kpis.sales_today.count === 1 && r.kpis.transfers_in_transit === 1, "Solo Zamora", r.kpis);
r = await ops(OWNER, 1);
ok(!r.feed.some((e) => e.status === "completed" && Number(e.amount) === 40000), "Con 1 día no sale la venta de ayer");

console.log("3. Vendedora de Cisneros");
r = await ops(CIS);
ok(r.kpis.sales_today.count === 2 && r.kpis.transfers_in_transit === 1, "Solo su punto", r.kpis);
ok(r.can.adjustments === false && !r.feed.some((e) => e.kind === "adjustment"), "Sin permiso de inventario no ve ajustes");
ok(r.my_points.length === 1, "Solo puede escoger su punto", r.my_points);
ok((await ops(CIS, 7, Z)).ok === false, "No puede mirar otro punto");

console.log("4. Sin permiso");
ok((await ops(NADA)).ok === false, "Sin permisos de operación: no");
ok((await ops(FUERA)).ok === false, "De otra tienda: no");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
