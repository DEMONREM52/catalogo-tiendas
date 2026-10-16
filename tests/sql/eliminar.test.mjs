// Pruebas de 20261112: eliminar registros equivocados sin perder historial de dinero.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_eliminar_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261112_eliminar_registros_gastos.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `c1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), JUSER = U(2), APPR = U(3);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: J }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'J', 'JAVIER', true, 'point') returning id", [A]);
const [{ id: M }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'M', 'MARIA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{expenses,budgets,payroll}', $3), ($1, $4, 'seller', '{payroll_approve}', null)", [A, JUSER, J, APPR]);
await one(OWNER, "select public.erp_finance_setup($1) r", [A]);
const [{ id: CAT }] = await raw("select id from erp_expense_categories where store_id = $1 and name = 'Arriendo'", [A]);
const catalog = () => one(OWNER, "select public.erp_finance_catalog($1) r", [A]);

console.log("Gastos fijos");
const r1 = await one(OWNER, "select public.erp_recurring_save($1, null, null, $2, 'Mal escrito', null, 1000, 'monthly', 5, current_date + 60, null, 0, true) r", [A, CAT]);
const d1 = await one(OWNER, "select public.erp_recurring_delete($1) r", [r1.id]);
ok(d1.hidden === false && (await raw("select count(*)::int c from erp_recurring_expenses where id = $1", [r1.id]))[0].c === 0, "Sin gastos generados: se borra de verdad");
const r2 = await one(OWNER, "select public.erp_recurring_save($1, null, null, $2, 'Arriendo viejo', null, 1000, 'monthly', 1, '2026-01-01', '2026-03-31', 0, true) r", [A, CAT]);
await one(OWNER, "select public.erp_finance_setup($1) r", [A]);
const d2 = await one(OWNER, "select public.erp_recurring_delete($1) r", [r2.id]);
ok(d2.hidden === true && d2.generated === 3, "Con gastos generados: se oculta y los 3 gastos se conservan", d2);
ok(!(await catalog()).recurring.some((x) => x.id === r2.id), "Ya no aparece en la lista");
const before = (await raw("select count(*)::int c from erp_expenses where recurring_id = $1", [r2.id]))[0].c;
await one(OWNER, "select public.erp_finance_setup($1) r", [A]);
ok((await raw("select count(*)::int c from erp_expenses where recurring_id = $1", [r2.id]))[0].c === before, "Y no vuelve a generar gastos");

console.log("Empleados y nómina");
const e1 = await one(OWNER, "select public.erp_employee_save($1, null, $2::jsonb) r", [A, JSON.stringify({ full_name: "Mal creado", base_salary: 1000000, pay_frequency: "monthly" })]);
ok((await one(OWNER, "select public.erp_employee_delete($1) r", [e1.id])).hidden === false, "Empleado sin nóminas: se borra de verdad");
const e2 = await one(OWNER, "select public.erp_employee_save($1, null, $2::jsonb) r", [A, JSON.stringify({ full_name: "Con historia", base_salary: 1000000, pay_frequency: "monthly", point_id: J })]);
const run = await one(OWNER, "select public.erp_payroll_create($1, null, 'monthly', '2026-10-01', '2026-10-31', null) r", [A]);
const h = await one(OWNER, "select public.erp_employee_delete($1) r", [e2.id]);
ok(h.hidden === true && !(await catalog()).employees.some((x) => x.id === e2.id), "Empleado con nómina: se oculta y su nómina se conserva");
ok((await raw("select count(*)::int c from erp_payroll_lines where employee_id = $1", [e2.id]))[0].c === 1, "La línea de nómina sigue ahí");
await one(OWNER, "select public.erp_payroll_delete_draft($1) r", [run.id]);
ok((await raw("select count(*)::int c from erp_payroll_runs where id = $1", [run.id]))[0].c === 0, "Una nómina en borrador se elimina");

console.log("Reservas");
const f1 = await one(OWNER, "select public.erp_reserve_fund_save($1, null, null, 'Prueba', null, null, true) r", [A]);
await one(OWNER, "select public.erp_reserve_fund_delete($1) r", [f1.id]);
ok((await raw("select count(*)::int c from erp_reserve_funds where id = $1", [f1.id]))[0].c === 0, "Reserva sin movimientos: se borra");
const f2 = await one(OWNER, "select public.erp_reserve_fund_save($1, null, null, 'Prima', null, null, true) r", [A]);
await one(OWNER, "select public.erp_reserve_move($1, 'in', 5000, null) r", [f2.id]);
ok(/retira el saldo/i.test(await err(OWNER, "select public.erp_reserve_fund_delete($1)", [f2.id]) ?? ""), "Con saldo no se elimina");
await one(OWNER, "select public.erp_reserve_move($1, 'out', 5000, null) r", [f2.id]);
await one(OWNER, "select public.erp_reserve_fund_delete($1) r", [f2.id]);
ok((await raw("select count(*)::int c from erp_reserve_moves where fund_id = $1", [f2.id]))[0].c === 2 && !(await catalog()).funds.some((x) => x.id === f2.id), "Con historial: se oculta y sus movimientos se conservan");

console.log("Gastos y aislamiento");
const ex = await one(OWNER, "select public.erp_expense_save($1, null, null, $2, 'Error', null, null, 1000, current_date, null, null, false, null, null) r", [A, CAT]);
await one(OWNER, "select public.erp_expense_void($1, 'Lo registré mal') r", [ex.id]);
const listDefault = await one(OWNER, "select public.erp_expenses_list($1, null, null, null, null, null, null, 50, 0) r", [A]);
const listVoid = await one(OWNER, "select public.erp_expenses_list($1, null, null, null, 'void', null, null, 50, 0) r", [A]);
ok(!listDefault.rows.some((x) => x.id === ex.id) && listVoid.rows.some((x) => x.id === ex.id), "Un gasto eliminado no sale en la lista normal, sí en «Anulados»");
const rM = await one(OWNER, "select public.erp_recurring_save($1, null, $2, $3, 'De MARIA', null, 1000, 'monthly', 5, current_date + 60, null, 0, true) r", [A, M, CAT]);
ok(/no es de tus puntos/i.test(await err(JUSER, "select public.erp_recurring_delete($1)", [rM.id]) ?? ""), "Un punto no elimina registros de otro punto");
ok(/permission denied/i.test(await err(null, "select public.erp_recurring_delete($1)", [rM.id]) ?? ""), "Sin sesión: bloqueado");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
