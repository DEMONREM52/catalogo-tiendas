// Pruebas de 20261128: caja por punto (apertura, cuadre, cierre con diferencias y revisión).
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
alter table public.erp_order_meta add column if not exists payment jsonb;
`;
const combined = path.join(os.tmpdir(), `remhub_caja_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  fs.readFileSync(path.join(MIG, "20261110_gastos_presupuestos_nomina.sql"), "utf8"),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
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

const U = (n) => `cc000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CAJERA = U(2), OTRA = U(3), VEND = U(4), JEFE = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const wh = async (n) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, n]))[0].id;
const C = await wh("CISNEROS"), Z = await wh("ZAMORA");
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id) values
  ($1,$2,'seller','{pos}',$6), ($1,$3,'seller','{pos}',$7), ($1,$4,'seller','{orders}',$6), ($1,$5,'seller','{cash_manage}',null)`, [A, CAJERA, OTRA, VEND, JEFE, C, Z]);

console.log("1. Migración y permisos");
const M28 = fs.readFileSync(path.join(MIG, "20261128_caja.sql"), "utf8");
await db.exec(M28);
await db.exec(M28);
const perms = async (u) => (await raw("select permissions from store_users where user_id = $1", [u]))[0].permissions;
ok((await perms(CAJERA)).filter((p) => p === "cash").length === 1, "Quien usa el POS recibe «Caja» (una sola vez)");
ok(!(await perms(VEND)).includes("cash"), "Quien no vende, no");

console.log("2. Abrir caja");
ok(/Caja/.test((await err(VEND, "select public.erp_cash_open($1, $2, 100000, null)", [A, C])) ?? ""), "Sin «Caja» no abre");
ok(/Caja/.test((await err(OTRA, "select public.erp_cash_open($1, $2, 100000, null)", [A, C])) ?? ""), "No abre la caja de otro punto");
const [{ id: S }] = await as(CAJERA, "select public.erp_cash_open($1, $2, 100000, 'Base del día') id", [A, C]);
ok(Boolean(S), "Cisneros abre con base de $100.000");
ok(/ya tiene una caja abierta/.test((await err(CAJERA, "select public.erp_cash_open($1, $2, 0, null)", [A, C])) ?? ""), "Una sola caja abierta por punto");

console.log("3. Lo que entra y sale");
const sale = async (point, parts, status = "confirmed") => {
  const total = parts.reduce((s, p) => s + p.amount, 0);
  const [{ id }] = await raw("insert into orders (store_id, token, total, status) values ($1, md5(random()::text), $2, $3) returning id", [A, total, status]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, payment) values ($1, $2, $3, 'remision', $4::jsonb)",
    [id, A, point, JSON.stringify({ method: parts.length > 1 ? "mixto" : parts[0].method, parts, at: new Date().toISOString() })]);
};
await sale(C, [{ method: "efectivo", amount: 50000 }]);
await sale(C, [{ method: "efectivo", amount: 20000 }, { method: "transferencia", amount: 30000 }]);
await sale(C, [{ method: "tarjeta", amount: 80000 }]);
await sale(C, [{ method: "efectivo", amount: 999999 }], "cancelled");
await sale(Z, [{ method: "efectivo", amount: 70000 }]);
const [{ id: CAT }] = await raw("insert into erp_expense_categories (store_id, name, kind) values ($1, 'Aseo', 'variable') returning id", [A]);
const [{ id: EXP }] = await raw("insert into erp_expenses (store_id, point_id, category_id, number, description, amount, incurred_on) values ($1, $2, $3, 1, 'Escoba', 15000, current_date) returning id", [A, C, CAT]);
await raw("insert into erp_expense_payments (store_id, expense_id, amount, method, idempotency_key) values ($1, $2, 15000, 'cash', 'k1')", [A, EXP]);
await as(CAJERA, "select public.erp_cash_move($1, 'out', 40000, 'Retiro para consignar')", [S]);
ok(/motivo/.test((await err(CAJERA, "select public.erp_cash_move($1, 'in', 1000, '')", [S])) ?? ""), "Entradas y salidas exigen motivo");
const live = (await as(CAJERA, "select public.erp_cash_session($1) r", [S]))[0].r.breakdown;
ok(live.pos_cash === 70000 && live.pos_sales === 3 && live.expenses_cash === 15000 && live.moves_out === 40000, "Ventas en efectivo $70.000 (de 3 ventas), gasto $15.000, retiro $40.000", live);
ok(live.expected === 100000 + 70000 - 15000 - 40000, "Debe haber $115.000 en el cajón", live.expected);
ok(live.pos_by_method.transferencia === 30000 && live.pos_by_method.tarjeta === 80000, "También muestra lo recibido por otros medios", live.pos_by_method);

console.log("4. Cierre");
ok(/explica/.test((await err(CAJERA, "select public.erp_cash_close($1, 100000, null, '')", [S])) ?? ""), "Con faltante grande exige explicación");
const c1 = (await as(CAJERA, "select public.erp_cash_close($1, 100000, '{\"50000\": 2}'::jsonb, 'Faltó el vuelto de una venta') r", [S]))[0].r;
ok(c1.status === "review" && c1.difference === -15000, "Faltan $15.000: queda «por revisar»", c1);
ok(/ya está cerrada/.test((await err(CAJERA, "select public.erp_cash_move($1, 'in', 1000, 'x')", [S])) ?? ""), "Cerrada no recibe más movimientos");
ok(/Revisar cajas/.test((await err(CAJERA, "select public.erp_cash_review($1, 'ok')", [S])) ?? ""), "La cajera no se aprueba a sí misma");
await as(JEFE, "select public.erp_cash_review($1, 'Se descuenta del turno')", [S]);
ok((await raw("select status from erp_cash_sessions where id = $1", [S]))[0].status === "closed", "La madre revisa y queda cerrada");

const [{ id: S2 }] = await as(CAJERA, "select public.erp_cash_open($1, $2, 50000, null) id", [A, C]);
const c2 = (await as(CAJERA, "select public.erp_cash_close($1, 51000, null, null) r", [S2]))[0].r;
ok(c2.status === "closed" && c2.difference === 1000, "Sobrante de $1.000 (dentro de la tolerancia): cierra directo", c2);
await as(JEFE, "select public.erp_cash_settings_save($1, 0)", [A]);
const [{ id: S3 }] = await as(CAJERA, "select public.erp_cash_open($1, $2, 0, null) id", [A, C]);
ok(/explica/.test((await err(CAJERA, "select public.erp_cash_close($1, 500, null, null)", [S3])) ?? ""), "Con tolerancia $0, cualquier diferencia se explica");

console.log("5. Tablero");
const bC = (await as(CAJERA, "select public.erp_cash_board($1) r", [A]))[0].r;
ok(bC.ok && bC.points.length === 1 && bC.points[0].name === "CISNEROS" && bC.points[0].open, "La cajera ve solo su punto, con su caja abierta");
ok(bC.history.every((h) => h.point === "CISNEROS"), "…y solo su historial");
const bJ = (await as(JEFE, "select public.erp_cash_board($1) r", [A]))[0].r;
ok(bJ.can_manage && bJ.points.length >= 3, "La madre ve todos los puntos");
ok((await as(VEND, "select public.erp_cash_board($1) r", [A]))[0].r.ok === false, "Sin permiso no ve cajas");
ok(/permission denied/.test((await err(CAJERA, "select * from erp_cash_sessions")) ?? ""), "Las tablas no se leen directo");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
