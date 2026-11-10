// Pruebas de 20261313 (recompra y cumpleaños, traslados sugeridos y conteo por zonas con aprobación).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
alter table public.store_catalogs add column if not exists slug text;
alter table public.orders add column if not exists confirmed_at timestamptz;
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.permissions && p_perms)) $$;
`;
const combined = path.join(os.tmpdir(), `remhub_cli_ops_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;
const callErr = async (u, fn, args) => { try { await call(u, fn, args); return null; } catch (e) { return e.message; } };

const U = (n) => `d0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CLI = U(2), BOD = U(3), CONTA = U(4), NADA = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('tienda', 'Tienda', $1) returning id", [OWNER]);
await raw(`insert into store_users (store_id, user_id, role, permissions) values
  ($1,$2,'seller','{clients}'), ($1,$3,'seller','{inventory,transfers}'), ($1,$4,'seller','{inventory,inventory_adjust}'), ($1,$5,'seller','{}')`, [A, CLI, BOD, CONTA, NADA]);
for (const m of ["20261223_clientes_frecuentes.sql", "20261312_vender_mas_opcional.sql", "20261313_clientes_y_operacion_opcional.sql"]) {
  const sql = fs.readFileSync(path.join(MIG, m), "utf8");
  await db.exec(sql);
  if (m.startsWith("20261313")) await db.exec(sql);
}

const wh = async (name, kind) => (await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, $2, $2, $3) returning id", [A, name, kind]))[0].id;
const BODEGA = await wh("Bodega", "warehouse"), ZAM = await wh("Zamora", "point"), MAN = await wh("Manhattan", "point");
const prod = async (name) => (await raw("insert into products (store_id, name, price_3, stock, active, cost_price) values ($1, $2, 10000, 0, true, 4000) returning id", [A, name]))[0].id;
const P = await prod("Patineta"), Q = await prod("Carro");
const level = (w, p, q) => raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1,$2,$3,$4) on conflict (warehouse_id, product_id) do update set qty = excluded.qty", [w, p, A, q]);
let tok = 0;
async function sale(point, product, qty, name, daysAgo, phone = null) {
  const [{ id }] = await raw(`insert into orders (store_id, token, total, status, customer_name, customer_whatsapp, created_at, confirmed_at)
    values ($1, $2, $3, 'confirmed', $4, $5, now() - make_interval(days => $6), now() - make_interval(days => $6)) returning id`, [A, `t${++tok}`, qty * 10000, name, phone, daysAgo]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, 10000)", [id, product, qty]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, point]);
}

console.log("1. Recompra");
await sale(MAN, P, 1, "Ana Pérez", 100, "3001112233");
await sale(MAN, P, 1, "Ana Pérez", 70, "3001112233");
await sale(MAN, Q, 1, "Ana Pérez", 40, "3001112233");
await sale(MAN, Q, 1, "Beto", 2, "3004445566");
await sale(MAN, Q, 1, "Beto", 1, "3004445566");
ok((await call(NADA, "erp_repurchase($1)", [A])).ok === false, "Sin «Clientes» no ve recompra");
let r = await call(CLI, "erp_repurchase($1)", [A]);
ok(r.ok && r.due.length === 1 && r.due[0].name === "ANA PÉREZ", "Ana compra cada ~30 días y lleva 40: toca escribirle (Beto no)", r.due);
let h = await call(CLI, "erp_customer_history($1, 'ana  pérez', 30)", [A]);
ok(h.ok && h.orders.length === 3 && h.orders[0].items[0].name === "Carro" && h.orders[0].point === "Manhattan", "Historial: 3 compras, la última primero, con productos y punto", h.orders?.[0]);
await call(CLI, "erp_repurchase_mark($1, 'Ana Pérez', 'recompra')", [A]);
ok((await call(CLI, "erp_repurchase($1)", [A])).due.length === 0, "Le escribí: sale de la lista por 14 días");
await call(OWNER, "store_feature_save($1, 'recompra', true, '{\"days\": 30}'::jsonb)", [A]);
await raw("delete from erp_repurchase_contacts");
r = await call(CLI, "erp_repurchase($1)", [A]);
ok(r.on && r.days === 30 && r.due.length === 1, "Con «30 días» fijo: Ana (40 días) sí, Beto no", r.due?.map((x) => x.name));

console.log("2. Cumpleaños");
await raw(`insert into billing_customers (store_id, name, mobile, birthday) values
  ($1, 'Carla', '3007778899', ((now() at time zone 'America/Bogota')::date + 3 - interval '30 years')::date),
  ($1, 'Dani', '3000000000', ((now() at time zone 'America/Bogota')::date + 20 - interval '25 years')::date)`, [A]);
r = await call(CLI, "erp_repurchase($1)", [A]);
ok(r.birthdays.length === 1 && r.birthdays[0].name === "Carla" && r.birthdays[0].days_until === 3, "Carla cumple en 3 días (Dani en 20 no sale)", r.birthdays);

console.log("3. Traslados sugeridos");
await level(ZAM, P, 20); await level(MAN, P, 0); await level(BODEGA, Q, 10); await level(MAN, Q, 0);
for (let i = 0; i < 6; i++) await sale(MAN, P, 2, "Mostrador", 3 + i);
ok((await call(CLI, "erp_rebalance_suggestions($1, 30, 30)", [A])).ok === false, "Sin «Traslados» no sugiere");
r = await call(BOD, "erp_rebalance_suggestions($1, 30, 30)", [A]);
const pz = r.items.find((x) => x.product_id === P);
const qb = r.items.find((x) => x.product_id === Q);
ok(r.ok && pz && pz.from_name === "Zamora" && pz.to_name === "Manhattan" && pz.qty === 12, "Zamora tiene 20 sin vender → 12 a Manhattan (vende 12 en 30 días y está en 0)", pz);
ok(qb && qb.from_name === "Bodega" && qb.to_name === "Manhattan" && qb.qty >= 1 && qb.qty <= 10, "El carro sale de la bodega", qb);
ok((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [ZAM, P]))[0].qty === 20, "Solo sugiere: no mueve existencias");

console.log("4. Conteo por zonas");
ok((await call(BOD, "count_start($1, $2, 'Vitrina 1', null)", [A, ZAM])).ok === false, "Apagado: no deja empezar");
await call(OWNER, "store_feature_save($1, 'conteo_zonas', true, null)", [A]);
ok((await call(NADA, "count_start($1, $2, 'Vitrina 1', null)", [A, ZAM])).ok === false, "Sin «Inventario» no cuenta");
r = await call(BOD, "count_start($1, $2, 'Vitrina 1', null)", [A, ZAM]);
ok(r.ok && r.id, "Empieza el conteo de Vitrina 1 en Zamora", r);
const C = r.id;
await call(BOD, "count_save_lines($1, $2::jsonb)", [C, JSON.stringify([{ product_id: P, counted: 17 }])]);
let g = await call(BOD, "count_get($1)", [C]);
ok(g.lines.length === 1 && g.lines[0].system_qty === 20 && g.lines[0].diff === -3 && g.lines[0].unit_cost === null, "Contó 17, el sistema decía 20: faltan 3 (sin ver costos)", g.lines);
// Mientras tanto se venden 2 en Zamora (el sistema baja a 18).
await level(ZAM, P, 18);
ok(await callErr(BOD, "count_decide($1, true, null)", [C]) !== null, "Sin «Ajustar inventario» no aprueba");
ok((await call(CONTA, "count_decide($1, true, null)", [C])).ok === false, "Sin enviar no se decide");
await call(BOD, "count_submit($1)", [C]);
ok((await call(BOD, "count_save_lines($1, $2::jsonb)", [C, JSON.stringify([{ product_id: P, counted: 1 }])])).ok === false, "Enviado: ya no se cambia");
ok((await call(CONTA, "vm_ops_alerts($1)", [A])).counts_pending === 1, "La campana avisa a quien aprueba");
r = await call(CONTA, "count_decide($1, true, 'Revisado')", [C]);
ok(r.ok && r.adjusted === 1 && r.adjustment_id, "Aprobado: un ajuste", r);
ok((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [ZAM, P]))[0].qty === 15, "Ajusta solo la diferencia: 18 − 3 = 15 (no pierde las 2 vendidas)");
const adj = await raw("select a.reason, i.qty_before, i.qty_after from erp_adjustments a join erp_adjustment_items i on i.adjustment_id = a.id where a.id = $1", [r.adjustment_id]);
ok(adj[0]?.reason === "count" && adj[0].qty_before === 18 && adj[0].qty_after === 15, "Queda como ajuste por conteo en el kardex", adj);
ok((await call(CONTA, "count_list($1, null)", [A])).items[0].status === "approved", "En la lista: aprobado");

const C2 = (await call(BOD, "count_start($1, $2, 'Fondo', null)", [A, ZAM])).id;
await call(BOD, "count_save_lines($1, $2::jsonb)", [C2, JSON.stringify([{ product_id: P, counted: 0 }])]);
await call(BOD, "count_submit($1)", [C2]);
r = await call(CONTA, "count_decide($1, false, 'Mal contado')", [C2]);
ok(r.ok && (await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [ZAM, P]))[0].qty === 15, "Rechazado: no toca existencias");
ok((await call(BOD, "count_delete($1)", [C2])).ok === false, "Un conteo decidido queda en el historial");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
