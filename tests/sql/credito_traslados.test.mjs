// Pruebas de 20261124: crédito en traslados bodega → puntos, sobre las funciones REALES de traslados de producción.
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
create table if not exists public.erp_transfer_signatures (id uuid primary key default gen_random_uuid(), transfer_id uuid, store_id uuid, step text,
  signer_name text, notes text, via text, user_id uuid, created_at timestamptz default now(), unique (transfer_id, step));
alter table public.erp_transfers add column if not exists checked_by_name text;
alter table public.erp_warehouses add column if not exists phone text;
`;
const combined = path.join(os.tmpdir(), `remhub_ct_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  extra,
  fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8").replace(/\r?\n/g, "\r\n"),
  fs.readFileSync(path.join(MIG, "20261124_credito_traslados.sql"), "utf8"),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const today = (await raw("select public.erp__internal_today()::text d"))[0].d;
const plus = (n) => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const U = (n) => `c8000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CIS = U(2), BOD = U(3), VEND = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'CIS', 'CISNEROS', true, 'point') returning id", [A]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'ZAM', 'ZAMORA', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id) values
  ($1,$2,'seller','{transfers,inventory}',$5), ($1,$3,'seller','{transfers,inventory}',null), ($1,$4,'seller','{pos}',null)`, [A, CIS, BOD, VEND, C]);
// En producción los usuarios ya existen al correr la migración: se simula y se corre dos veces.
const M24 = fs.readFileSync(path.join(MIG, "20261124_credito_traslados.sql"), "utf8");
await raw("delete from erp_migration_marks where key = '20261124_grants'");
await db.exec(M24);
await db.exec(M24);
const permsOf = async (u) => (await raw("select permissions from store_users where user_id = $1", [u]))[0].permissions;
ok((await permsOf(CIS)).filter((p) => p === "internal_credit").length === 1, "Quien recibe traslados en un punto puede ver su cuenta (una sola vez)");
ok(!(await permsOf(BOD)).includes("internal_credit"), "…un usuario de la madre no la recibe automático");

const [{ id: CAT }] = await raw("insert into product_categories (store_id, name) values ($1, 'OLLAS') returning id", [A]);
const [{ id: P1 }] = await raw("insert into products (store_id, name, stock, cost_price, category_id) values ($1, 'OLLAS 8 PIEZAS', 0, 18000, $2) returning id", [A, CAT]);
const [{ id: P2 }] = await raw("insert into products (store_id, name, stock, cost_price) values ($1, 'SIN COSTO', 0, 0) returning id", [A]);
await raw("select public.erp__move($1, $2, $3, 200, 'purchase', 'test', null, 18000, 'carga', null, true)", [A, B, P1]);
await raw("select public.erp__move($1, $2, $3, 50, 'purchase', 'test', null, 0, 'carga', null, true)", [A, B, P2]);
const items = (arr) => JSON.stringify(arr.map(([product_id, qty]) => ({ product_id, qty })));
const send = (u, from, to, arr) => as(u, "select public.erp_create_transfer($1, $2, $3, 'prueba', $4::jsonb) id", [A, from, to, items(arr)]).then((r) => r[0].id);
const receive = (u, id, recv) => as(u, "select public.erp_confirm_transfer($1, $2::jsonb, 'ok')", [id, recv ? JSON.stringify(recv) : null]);
const board = async (u) => (await as(u, "select public.erp_internal_board($1) b", [A]))[0].b;
const pt = (b, id) => b.points.find((x) => x.point_id === id);
const qtyAt = async (wh, p) => Number((await raw("select coalesce((select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2), 0) q", [wh, p]))[0].q);

console.log("1. Sin activar no cambia nada");
const t0 = await send(OWNER, B, Z, [[P1, 5]]);
await receive(OWNER, t0);
ok((await raw("select count(*)::int n from erp_internal_docs"))[0].n === 0, "Traslado a un punto sin crédito: no genera deuda");

console.log("2. Configuración (solo la madre)");
ok(/tienda madre/.test((await err(BOD, "select public.erp_internal_point_save($1, $2, '{}'::jsonb)", [A, C])) ?? ""), "Sin «Administrar cuenta con puntos» no configura");
ok(/bodega principal/.test((await err(OWNER, "select public.erp_internal_point_save($1, $2, '{}'::jsonb)", [A, B])) ?? ""), "La bodega principal no puede deberse a sí misma");
await as(OWNER, "select public.erp_internal_point_save($1, $2, $3::jsonb)", [A, C, JSON.stringify({ enabled: true, term_days: 40 })]);
const b1 = await board(OWNER);
ok(pt(b1, C).configured && pt(b1, C).term_days === 40 && pt(b1, C).balance === 0, "Cisneros activo, plazo 40 días, sin deuda");

console.log("3. Traslado bodega → Cisneros (15 % por defecto, redondeo a $100)");
const prev = (await as(BOD, "select public.erp_internal_preview($1, $2, $3, $4::jsonb) p", [A, B, C, items([[P1, 10], [P2, 3]])]))[0].p;
ok(prev.applies && prev.kind === "charge" && prev.missing === 1 && prev.total === null, "Vista previa sin «Ver costos»: avisa, pero no muestra valores", prev);
const prevO = (await as(OWNER, "select public.erp_internal_preview($1, $2, $3, $4::jsonb) p", [A, B, C, items([[P1, 10]])]))[0].p;
ok(Number(prevO.total) === 207000, "El dueño ve el valor: 10 × $20.700", prevO);
const t1 = await send(BOD, B, C, [[P1, 10], [P2, 3]]);
const it1 = await raw("select internal_price, unit_cost, internal_pct from erp_transfer_items where transfer_id = $1 and product_id = $2", [t1, P1]);
ok(Number(it1[0].internal_price) === 20700 && Number(it1[0].unit_cost) === 18000 && Number(it1[0].internal_pct) === 15, "Al crear se congela costo $18.000 y precio interno $20.700", it1);
ok((await raw("select count(*)::int n from erp_internal_docs where transfer_id = $1", [t1]))[0].n === 0, "En camino todavía no se cobra");
ok(Number(pt(await board(OWNER), C).in_transit) === 207000, "…pero se ve como «en camino»");
await receive(CIS, t1, [{ product_id: P1, received_qty: 9 }]);
const d1 = (await raw("select * from erp_internal_docs where transfer_id = $1", [t1]))[0];
ok(Number(d1.amount) === 186300 && d1.kind === "transfer" && d1.due_date.toISOString().slice(0, 10) === plus(40), "Se cobra lo RECIBIDO (9 × $20.700), vence en 40 días", d1);
ok(d1.note.includes("sin costo"), "Avisa que un producto sin costo no se cobró");
ok(Number((await raw("select avg_cost from erp_point_costs where point_id = $1 and product_id = $2", [C, P1]))[0].avg_cost) === 20700, "Costo propio de Cisneros: $20.700");
await raw("update erp_transfers set status = 'in_transit' where id = $1", [t1]);
await raw("update erp_transfers set status = 'received' where id = $1", [t1]);
ok((await raw("select count(*)::int n from erp_internal_docs where transfer_id = $1", [t1]))[0].n === 1, "Nunca se cobra dos veces el mismo traslado");

console.log("4. % por categoría y costo promedio del punto");
await as(OWNER, "select public.erp_internal_pct_rule_save($1, $2, null, 25)", [A, CAT]);
const t2 = await send(OWNER, B, C, [[P1, 10]]);
ok(Number((await raw("select internal_price from erp_transfer_items where transfer_id = $1", [t2]))[0].internal_price) === 22500, "Categoría OLLAS al 25 %: $22.500");
await receive(CIS, t2);
const avg = Number((await raw("select avg_cost from erp_point_costs where point_id = $1 and product_id = $2", [C, P1]))[0].avg_cost);
ok(Math.abs(avg - (9 * 20700 + 10 * 22500) / 19) < 0.01, "Costo propio = promedio ponderado", avg);
await as(OWNER, "select public.erp_internal_pct_rule_save($1, null, $2, 20)", [A, P1]);
ok(Number((await as(OWNER, "select public.erp_internal_preview($1, $2, $3, $4::jsonb) p", [A, B, C, items([[P1, 1]])]))[0].p.total) === 21600, "Regla del producto (20 %) gana sobre la categoría");

console.log("5. Abonos, vencidos y orden de pago");
await raw("update erp_internal_docs set due_date = $2 where transfer_id = $1", [t1, plus(-5)]);
let s = pt(await board(OWNER), C);
ok(s.balance === 186300 + 225000 && s.overdue === 186300 && s.oldest_overdue_days === 5, "Debe $411.300; $186.300 vencidos hace 5 días", s);
ok(/tienda madre/.test((await err(CIS, "select public.erp_internal_payment_add($1, $2, 1000, 'cash', null, null, null)", [A, C])) ?? ""), "El punto no registra abonos (lo hace la madre)");
const [{ id: PAY }] = await as(OWNER, "select public.erp_internal_payment_add($1, $2, 200000, 'transfer', 'TR-1', null, 'abono') id", [A, C]);
s = pt(await board(OWNER), C);
ok(s.balance === 211300 && s.overdue === 0, "Abono de $200.000 paga primero lo vencido", s);
await as(OWNER, "select public.erp_internal_payment_void($1, 'error de digitación')", [PAY]);
ok(pt(await board(OWNER), C).balance === 411300, "Anular el abono devuelve la deuda");

console.log("6. Devolución a la bodega y novedades (las asume la bodega)");
const t3 = await send(CIS, C, B, [[P1, 2]]);
await receive(OWNER, t3);
const d3 = (await raw("select * from erp_internal_docs where transfer_id = $1", [t3]))[0];
ok(d3.kind === "return" && Math.abs(Number(d3.amount) - Math.round(2 * avg * 100) / 100) < 0.02, "Devolver 2 und. baja la deuda a su costo propio", d3);
ok(/tiene 17|solo tiene/.test((await err(CIS, "select public.erp_internal_claim_create($1, $2, $3, 999, 'damaged', 'roto', null)", [A, C, P1])) ?? ""), "No puede reportar más de lo que tiene");
const [{ id: CL }] = await as(CIS, "select public.erp_internal_claim_create($1, $2, $3, 1, 'damaged', 'Llegó rota la tapa', null) id", [A, C, P1]);
ok(/tu punto/.test((await err(CIS, "select public.erp_internal_claim_create($1, $2, $3, 1, 'damaged', 'x', null)", [A, Z, P1])) ?? ""), "No reporta novedades de otro punto");
ok((await board(OWNER)).claims.length === 1, "La madre ve la novedad pendiente");
const stockBefore = await qtyAt(C, P1);
await as(OWNER, "select public.erp_internal_claim_decide($1, true, 'ok')", [CL]);
ok(await qtyAt(C, P1) === stockBefore - 1, "Aprobada: sale del inventario del punto");
ok((await raw("select count(*)::int n from erp_internal_docs where kind = 'loss' and claim_id = $1", [CL]))[0].n === 1, "…y baja la deuda (pérdida de la bodega)");
ok(/ya se decidió/.test((await err(OWNER, "select public.erp_internal_claim_decide($1, true, 'ok')", [CL])) ?? ""), "No se aprueba dos veces");

console.log("7. Deuda inicial por la mercancía que ya tiene un punto");
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true}'::jsonb)", [A, Z]);
const op = (await as(OWNER, "select public.erp_internal_opening_from_stock($1, $2, null, null) r", [A, Z]))[0].r;
ok(op.amount === 5 * 21600 && op.products === 1, "Zamora (5 und.) arranca debiendo 5 × $21.600", op);
ok(/ya tiene deuda inicial/.test((await err(OWNER, "select public.erp_internal_opening_from_stock($1, $2, null, null)", [A, Z])) ?? ""), "No se duplica la deuda inicial");
const [{ id: MAN }] = await as(OWNER, "select public.erp_internal_doc_add($1, $2, 'charge', 50000, null, 'Faltante en conteo') id", [A, Z]);
ok(pt(await board(OWNER), Z).balance === 108000 + 50000, "Cargo manual con motivo");
await as(OWNER, "select public.erp_internal_doc_void($1, 'se encontró')", [MAN]);
ok(pt(await board(OWNER), Z).balance === 108000, "Se puede anular un cargo manual");
ok(/no se anulan a mano/.test((await err(OWNER, "select public.erp_internal_doc_void($1, 'x')", [d1.id])) ?? ""), "Un cobro de traslado no se anula a mano");

console.log("8. De un punto a otro: la deuda pasa con la mercancía");
const balC = pt(await board(OWNER), C).balance;
const t4 = await send(OWNER, C, Z, [[P1, 3]]);
await receive(OWNER, t4);
const docs4 = await raw("select kind, sign, amount, point_id from erp_internal_docs where transfer_id = $1 order by sign", [t4]);
ok(docs4.length === 2 && docs4[0].kind === "transfer_out" && docs4[1].kind === "transfer" && Number(docs4[0].amount) === Number(docs4[1].amount), "Cisneros baja, Zamora sube el mismo valor", docs4);
ok(Math.abs(pt(await board(OWNER), C).balance - (balC - Number(docs4[0].amount))) < 0.01, "Saldo de Cisneros correcto");

console.log("9. Cupo de crédito");
await as(OWNER, "select public.erp_internal_point_save($1, $2, $3::jsonb)", [A, C, JSON.stringify({ enabled: true, term_days: 40, credit_limit: 300000 })]);
ok(/superaría su cupo/.test((await err(BOD, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb)", [A, B, C, items([[P1, 5]])])) ?? ""), "Pasar el cupo se bloquea…");
ok((await raw("select count(*)::int n from erp_transfers where to_warehouse_id = $1 and status = 'in_transit'", [C]))[0].n === 0, "…sin dejar nada a medias");
ok((await send(OWNER, B, C, [[P1, 5]])) !== null, "La madre (autoriza) sí puede");

console.log("10. Permisos y alcance");
ok((await board(VEND)).ok === false, "Sin permiso no ve nada");
const bC = await board(CIS);
ok(bC.points.length === 1 && bC.points[0].point_id === C && bC.can_manage === false, "Cisneros solo ve su cuenta");
ok((await as(CIS, "select public.erp_internal_statement($1, $2) r", [A, Z]))[0].r.ok === false, "No ve el estado de cuenta de Zamora");
const st = (await as(CIS, "select public.erp_internal_statement($1, $2) r", [A, C]))[0].r;
ok(st.ok && st.moves.length >= 5 && st.charges.length >= 2, "Su estado de cuenta trae movimientos y cargos", { moves: st.moves.length, charges: st.charges.length });
ok(/permission denied/.test((await err(CIS, "select * from erp_internal_docs")) ?? ""), "Las tablas no se leen directo");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
