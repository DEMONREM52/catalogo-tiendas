// Pruebas de 20261110_gastos_presupuestos_nomina.sql (sobre 20261106 para la ganancia bruta).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_gastos_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `a1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CONT = U(2), APPR = U(3), JUSER = U(4), OTHER = U(5), SELLER = U(6);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const n = (v) => Number(v);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1)", [OTHER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, name]))[0].id;
const J = await wh("JAVIER"), M = await wh("MARIA");
const member = (uid, perms, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', $3, $4)", [A, uid, perms, point]);
await member(CONT, ["expenses", "expenses_pay", "budgets", "payroll", "payroll_pay", "profit_view"], null);
await member(APPR, ["payroll_approve", "payroll"], null);
await member(JUSER, ["expenses"], J);
await member(SELLER, ["pos"], J);

console.log("Arranque");
const s1 = await one(CONT, "select public.erp_finance_setup($1) r", [A]);
await one(CONT, "select public.erp_finance_setup($1) r", [A]);
const [{ c: cats }] = await raw("select count(*)::int c from erp_expense_categories where store_id = $1", [A]);
const [{ c: concepts }] = await raw("select count(*)::int c from erp_payroll_concepts where store_id = $1", [A]);
ok(cats === 12 && concepts === 19 && s1.payroll_category, "Crea 12 categorías y 19 conceptos de nómina una sola vez", { cats, concepts });
const [{ c: empOn }] = await raw("select count(*)::int c from erp_payroll_concepts where store_id = $1 and kind = 'employer' and active", [A]);
ok(empOn === 0, "Los aportes del empleador quedan apagados hasta que el contador los confirme");
ok(/permiso/i.test(await err(SELLER, "select public.erp_finance_setup($1)", [A]) ?? ""), "Un vendedor no entra al módulo");
const cat = async (name) => (await raw("select id from erp_expense_categories where store_id = $1 and name = $2", [A, name]))[0].id;
const ARRIENDO = await cat("Arriendo"), SERV = await cat("Servicios públicos");

console.log("Gastos y pagos");
const save = (uid, point, category, amount, payNow = false, key = null) =>
  one(uid, "select public.erp_expense_save($1, null, $2, $3, 'Gasto de prueba', 'PROVEEDOR', 'FAC-1', $4, current_date, current_date + 10, null, $5, 'cash', $6) r", [A, point, category, amount, payNow, key]);
const e1 = await save(CONT, null, ARRIENDO, 2000000, true, "pago-arriendo-0001");
ok((await raw("select status, paid from erp_expenses where id = $1", [e1.id]))[0].status === "paid", "Gasto de la madre pagado de contado");
const e2 = await save(JUSER, J, SERV, 300000);
ok(Boolean(e2?.id), "El punto JAVIER registra su gasto");
ok(/madre/i.test(await err(JUSER, "select public.erp_expense_save($1, null, null, $2, 'x', null, null, 1000, current_date, null, null, false, null, null)", [A, SERV]) ?? ""), "Un usuario de punto no registra gastos de la madre");
ok(/tus puntos/i.test(await err(JUSER, "select public.erp_expense_save($1, null, $2, $3, 'x', null, null, 1000, current_date, null, null, false, null, null)", [A, M, SERV]) ?? ""), "…ni gastos de otro punto");
const list = await one(JUSER, "select public.erp_expenses_list($1, null, null, null, null, null, null, 50, 0) r", [A]);
ok(list.total === 1 && list.rows[0].point_id === J, "El punto solo ve sus gastos", list.total);
const listAll = await one(CONT, "select public.erp_expenses_list($1, null, null, null, null, null, null, 50, 0) r", [A]);
ok(listAll.total === 2, "La madre ve todos");
ok(/pagar gastos/i.test(await err(JUSER, "select public.erp_expense_pay($1, 1000, 'cash', null, null, 'pago-j-000000001')", [e2.id]) ?? ""), "Sin permiso de pagos no se paga");
const p1 = await one(CONT, "select public.erp_expense_pay($1, 100000, 'cash', null, null, 'pago-serv-00001') r", [e2.id]);
const p1b = await one(CONT, "select public.erp_expense_pay($1, 100000, 'cash', null, null, 'pago-serv-00001') r", [e2.id]);
ok(p1b.already && p1b.payment_id === p1.payment_id, "Un pago repetido no se duplica");
ok((await raw("select status from erp_expenses where id = $1", [e2.id]))[0].status === "partial", "Queda en pago parcial");
ok(/supera/i.test(await err(CONT, "select public.erp_expense_pay($1, 999999, 'cash', null, null, 'pago-serv-00002')", [e2.id]) ?? ""), "No se paga más del saldo");
ok(/pagos registrados/i.test(await err(CONT, "select public.erp_expense_void($1, 'error')", [e2.id]) ?? ""), "Con pagos no se anula el gasto");
await one(CONT, "select public.erp_expense_payment_void($1, 'Me equivoqué') r", [p1.payment_id]);
await one(CONT, "select public.erp_expense_void($1, 'Gasto duplicado') r", [e2.id]);
ok((await raw("select status from erp_expenses where id = $1", [e2.id]))[0].status === "void", "Anulado el pago, se anula el gasto (queda el historial)");

console.log("Gastos fijos");
const rec = (freq, day, starts, ends) => one(CONT, "select public.erp_recurring_save($1, null, null, $2, 'Arriendo bodega', 'DON PEDRO', 500000, $3, $4, $5::date, $6::date, 5, true) r", [A, ARRIENDO, freq, day, starts, ends]);
const rm = await rec("monthly", 31, "2025-01-01", "2025-03-31");
const rs = await rec("semimonthly", 1, "2025-01-01", "2025-02-28");
await one(CONT, "select public.erp_finance_setup($1) r", [A]);
await one(CONT, "select public.erp_finance_setup($1) r", [A]);
const dates = async (id) => (await raw("select incurred_on::text d from erp_expenses where recurring_id = $1 order by 1", [id])).map((x) => x.d);
const dm = await dates(rm.id), ds = await dates(rs.id);
ok(JSON.stringify(dm) === JSON.stringify(["2025-01-31", "2025-02-28", "2025-03-31"]), "Mensual el día 31: en febrero cae el 28", dm);
ok(JSON.stringify(ds) === JSON.stringify(["2025-01-15", "2025-01-31", "2025-02-15", "2025-02-28"]), "Quincenal: el 15 y el último día de cada mes", ds);
const [{ due }] = await raw("select (due_on - incurred_on) due from erp_expenses where recurring_id = $1 limit 1", [rm.id]);
ok(due === 5, "Con su vencimiento (5 días después)");
const rw = await one(CONT, "select public.erp_recurring_save($1, null, $2, $3, 'Aseo semanal', null, 50000, 'weekly', 1, current_date - 63, null, 0, true) r", [A, J, SERV]);
await one(CONT, "select public.erp_finance_setup($1) r", [A]);
ok((await dates(rw.id)).length === 12, "Semanal: genera hasta 15 días adelante, sin repetir", (await dates(rw.id)).length);

console.log("Presupuestos");
await one(CONT, "select public.erp_budget_save($1, null, null, 'monthly', 3000000, true) r", [A]);
await one(CONT, "select public.erp_budget_save($1, null, $2, 'monthly', 1000000, true) r", [A, ARRIENDO]);
ok(/permiso/i.test(await err(JUSER, "select public.erp_budget_save($1, $2, null, 'monthly', 100, true)", [A, J]) ?? ""), "Sin permiso no se cambian presupuestos");
const today = new Date().toISOString().slice(0, 10);
const ov = await one(CONT, "select public.erp_finance_overview($1, null, date_trunc('month', current_date)::date, current_date) r", [A]);
const bArr = ov.budgets.find((b) => b.category_id === ARRIENDO);
ok(bArr && n(bArr.spent) >= 2000000 && n(bArr.pct) >= 200, "Arriendo del mes: gastado $2.000.000 de $1.000.000 (200 %)", bArr);

console.log("Nómina");
const emp = (uid, data) => one(uid, "select public.erp_employee_save($1, null, $2::jsonb) r", [A, JSON.stringify(data)]);
const ana = await emp(CONT, { full_name: "Ana Pérez", base_salary: 1500000, pay_frequency: "monthly", transport_aid: true, point_id: J, hired_on: "2025-01-01" });
const luis = await emp(CONT, { full_name: "Luis Gómez", base_salary: 1500000, pay_frequency: "monthly", transport_aid: false, point_id: M, hired_on: "2026-10-16" });
ok(/permiso/i.test(await err(JUSER, "select public.erp_employee_save($1, null, '{\"full_name\":\"X\"}'::jsonb)", [A]) ?? ""), "Sin permiso de nómina no se ven ni crean empleados");
ok((await one(JUSER, "select public.erp_finance_catalog($1) r", [A])).employees === null, "Quien no tiene nómina no recibe salarios");
const aux = (await raw("select id from erp_payroll_concepts where store_id = $1 and code = 'AUX_TRANSPORTE'", [A]))[0].id;
ok(/madre/i.test(await err(CONT, "select public.erp_payroll_concept_save($1, $2, null, null, null, 200000, null, null, null)", [A, aux]) ?? ""), "Solo quien aprueba nómina cambia los conceptos");
await one(APPR, "select public.erp_payroll_concept_save($1, $2, null, null, null, 200000, null, null, null) r", [A, aux]);
const run = await one(CONT, "select public.erp_payroll_create($1, null, 'monthly', '2026-10-01', '2026-10-31', 'Octubre') r", [A]);
ok(run.employees === 2, "La nómina de octubre incluye a los 2 empleados mensuales");
const det = async () => one(CONT, "select public.erp_payroll_detail($1) r", [run.id]);
let d = await det();
const la = d.lines.find((l) => l.employee_id === ana.id), ll = d.lines.find((l) => l.employee_id === luis.id);
ok(n(la.earnings) === 1700000 && n(la.deductions) === 120000 && n(la.net) === 1580000, "Ana: $1.500.000 + auxilio $200.000 − salud y pensión 4 % c/u = $1.580.000", la);
ok(n(ll.days) === 15 && n(ll.earnings) === 750000 && n(ll.net) === 690000, "Luis entró el 16: 15 días = $750.000 (sin auxilio) − 8 % = $690.000", ll);
const com = (await raw("select id from erp_payroll_concepts where store_id = $1 and code = 'COMISIONES'", [A]))[0].id;
await one(CONT, "select public.erp_payroll_line_update($1, null, $2::jsonb, null) r", [la.id, JSON.stringify({ [com]: 100000 })]);
const prima = (await raw("select id from erp_payroll_concepts where store_id = $1 and code = 'PRIMA'", [A]))[0].id;
await one(APPR, "select public.erp_payroll_concept_save($1, $2, null, null, null, null, null, null, true) r", [A, prima]);
await one(CONT, "select public.erp_payroll_line_update($1, null, null, null) r", [la.id]);
d = await det();
const la2 = d.lines.find((l) => l.employee_id === ana.id);
ok(n(la2.deductions) === 128000 && n(la2.employer_cost) === 149940, "Comisión $100.000 sube la base: salud+pensión $128.000; prima 8,33 % (con auxilio) $149.940", la2);
ok(n(d.run.total_cost) === n(d.run.earnings) + n(d.run.employer_cost), "Costo total = devengado + aportes del empleador");
const again = await err(CONT, "select public.erp_payroll_create($1, null, 'monthly', '2026-10-01', '2026-10-31', null)", [A]);
ok(/otra nómina/i.test(again ?? ""), "Nadie queda en dos nóminas del mismo periodo", again);
ok(/permiso/i.test(await err(CONT, "select public.erp_payroll_transition($1, 'approve', null)", [run.id]) ?? ""), "Quien prepara (sin permiso de aprobar) no aprueba");
await one(APPR, "select public.erp_payroll_transition($1, 'approve', null) r", [run.id]);
ok(/aprobada/i.test(await err(CONT, "select public.erp_payroll_line_update($1, 10, null, null)", [la.id]) ?? ""), "Aprobada ya no se edita");
const pp = await one(CONT, "select public.erp_payroll_pay($1, 1000000, 'transfer', null, null, 'nomina-ana-0001') r", [la.id]);
const pp2 = await one(CONT, "select public.erp_payroll_pay($1, 1000000, 'transfer', null, null, 'nomina-ana-0001') r", [la.id]);
ok(pp2.already && pp2.payment_id === pp.payment_id, "Un pago de nómina repetido no se duplica");
ok(/supera/i.test(await err(CONT, "select public.erp_payroll_pay($1, 9000000, 'transfer', null, null, 'nomina-ana-0002')", [la.id]) ?? ""), "No se paga más del neto");
ok((await raw("select status from erp_payroll_runs where id = $1", [run.id]))[0].status === "partial", "Nómina en pago parcial");
ok(/pagos registrados/i.test(await err(APPR, "select public.erp_payroll_transition($1, 'void', 'error')", [run.id]) ?? ""), "Con pagos no se anula");
d = await det();
for (const l of d.lines) { const left = n(l.net) - n(l.paid); if (left > 0) await one(CONT, "select public.erp_payroll_pay($1, $2, 'transfer', null, null, $3) r", [l.id, left, "nomina-full-" + l.id]); }
ok((await raw("select status from erp_payroll_runs where id = $1", [run.id]))[0].status === "paid", "Nómina pagada completa");
ok(/permiso/i.test(await err(JUSER, "select public.erp_payroll_detail($1)", [run.id]) ?? ""), "Un usuario sin nómina no ve los salarios");
ok(/permiso/i.test(await err(OTHER, "select public.erp_payroll_runs_list($1)", [A]) ?? ""), "Otra tienda no ve la nómina");

await emp(CONT, { full_name: "Pedro Semanal", base_salary: 1200000, pay_frequency: "weekly", transport_aid: false, point_id: J });
const wrun = await one(APPR, "select public.erp_payroll_create($1, null, 'weekly', '2026-10-05', '2026-10-11', null) r", [A]);
ok(/otra persona/i.test(await err(APPR, "select public.erp_payroll_transition($1, 'approve', null)", [wrun.id]) ?? ""), "Aunque tenga permiso, nadie aprueba la nómina que él mismo preparó");
const wl = (await one(CONT, "select public.erp_payroll_detail($1) r", [wrun.id])).lines[0];
ok(n(wl.days) === 7 && n(wl.earnings) === 280000, "Semanal: 7 días de $1.200.000/30 = $280.000", wl);

console.log("Reservas");
const fund = await one(CONT, "select public.erp_reserve_fund_save($1, null, null, 'Prima de diciembre', 'Para pagar la prima', 3000000, true) r", [A]);
await one(CONT, "select public.erp_reserve_move($1, 'in', 100000, 'Aporte') r", [fund.id]);
ok(/solo tiene/i.test(await err(CONT, "select public.erp_reserve_move($1, 'out', 150000, 'retiro')", [fund.id]) ?? ""), "No se retira más de lo reservado");
ok(n((await one(CONT, "select public.erp_reserve_move($1, 'out', 50000, 'Anticipo prima') r", [fund.id])).balance) === 50000, "Saldo de la reserva $50.000");

console.log("Resumen");
const ov2 = await one(CONT, "select public.erp_finance_overview($1, null, '2026-10-01', '2026-10-31') r", [A]);
ok(ov2.payroll && n(ov2.payroll.cost) === n(d.run.total_cost), "El resumen incluye el costo de la nómina del periodo", ov2.payroll);
ok(ov2.net_profit !== null && n(ov2.net_profit) === n(ov2.gross_profit) - n(ov2.expenses.incurred) - n(ov2.payroll.cost), "Ganancia neta = ganancia bruta − gastos − nómina");
const ovJ = await one(JUSER, "select public.erp_finance_overview($1, null, '2026-10-01', '2026-10-31') r", [A]);
ok(ovJ.payroll === null && ovJ.net_profit === null, "El punto sin permisos de nómina ni rentabilidad no ve esas cifras");
ok(/tus puntos/i.test(await err(JUSER, "select public.erp_finance_overview($1, $2, '2026-10-01', '2026-10-31')", [A, M]) ?? ""), "El punto no ve el resumen de otro punto");
ok(/permission denied/i.test(await err(null, "select public.erp_finance_overview($1, null, '2026-10-01', '2026-10-31')", [A]) ?? ""), "Sin sesión: bloqueado");
const [{ a }] = await raw("select count(*)::int a from erp_audit_logs where store_id = $1 and (action like 'expense%' or action like 'payroll%' or action like 'budget%' or action like 'reserve%' or action like 'employee%')", [A]);
ok(a >= 20, "Todo queda en auditoría", a);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
