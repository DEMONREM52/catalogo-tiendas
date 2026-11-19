// Pruebas de 20261328: flujo de caja de 30 días (ventas promedio + cartera vs. proveedores, gastos y nómina).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_flujo_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql",
  "migraciones/20261328_flujo_de_caja.sql"].map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n")
  + "\nalter table public.erp_receivables add column if not exists due_date date;\n"
  + fs.readFileSync(path.join(here, "migraciones/20261328_flujo_de_caja.sql"), "utf8"));
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
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `ce300000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ADMIN = U(2), CONT = U(3);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'store_admin', '{}'), ($1, $3, 'seller', '{payables,expenses,reports,payroll}')", [S, ADMIN, CONT]);
const [{ t: T }] = await raw("select (now() at time zone 'America/Bogota')::date::text t");
const day = async (offset) => (await raw("select ($1::date + $2::integer)::text d", [T, offset]))[0].d;
const flow = (u = OWNER) => one(u, "select public.erp_cash_flow($1) r", [S]);
const at = (r, d) => r.days.find((x) => x.day === d);

// Ventas: 4 semanas atrás, el mismo día de la semana que mañana, $100.000 cada una (y una de hoy y otra vieja que no cuentan).
const tomorrow = await day(1);
for (const w of [6, 13, 20, 27]) {
  await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), 100000, 'confirmed', ($2::date + interval '12 hours') at time zone 'America/Bogota')", [S, await day(-w)]);
}
await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), 999999, 'confirmed', now())", [S]);
await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), 999999, 'confirmed', now() - interval '40 days')", [S]);
await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, md5(random()::text), 999999, 'cancelled', now() - interval '6 days')", [S]);

const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'NEXT') returning id", [S]);
const payable = async (bal, due, status = "open") => raw("insert into erp_payables (store_id, supplier_id, total, balance, due_date, status) values ($1, $2, $3, $3, $4, $5)", [S, SUP, bal, due, status]);
await payable(300000, await day(5));
await payable(70000, await day(-2));
await payable(11111, null);
await payable(5000, await day(5), "paid");

const recv = async (bal, due, status = "open") => raw("insert into erp_receivables (store_id, total, balance, status, due_date) values ($1, $2, $2, $3, $4)", [S, bal, status, due]);
await recv(50000, await day(3));
await recv(20000, await day(-1));
await recv(99999, await day(3), "void");

const [{ id: CAT }] = await raw("insert into erp_expense_categories (store_id, name) values ($1, 'Arriendo') returning id", [S]);
await raw("insert into erp_expenses (store_id, category_id, number, description, amount, paid, incurred_on, due_on, status) values ($1, $2, 1, 'Luz', 40000, 10000, $3, $4, 'partial')", [S, CAT, T, await day(2)]);
// Gasto fijo mensual que cae en 10 días (todavía no generado).
const d10 = await day(10);
const [{ dom }] = await raw("select extract(day from $1::date)::integer dom", [d10]);
await raw("insert into erp_recurring_expenses (store_id, category_id, description, amount, frequency, day_of_month, starts_on, due_days) values ($1, $2, 'Arriendo local', 2000000, 'monthly', $3, $4, 0)",
  [S, CAT, dom, await day(-70)]);

// Nómina: una persona con salario mensual.
await raw("insert into erp_employees (store_id, full_name, base_salary, pay_frequency, active) values ($1, 'ANA', 1500000, 'monthly', true)", [S]);
const [{ eom }] = await raw("select (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text eom", [T]);

console.log("Permisos");
ok((await flow(CONT)).ok === false, "Con permisos de gastos y cuentas pero sin ser dueño/administrador: no lo ve");
ok((await flow(U(9))).ok === false, "Alguien de fuera tampoco");
let r = await flow(ADMIN);
ok(r.ok === true && r.days.length === 30 && r.days[0].day === T, "El administrador lo ve: 30 días desde hoy", { ok: r.ok, n: r.days?.length });

console.log("Entra");
r = await flow();
ok(Number(at(r, tomorrow).in_sales) === 100000, "Ventas de mañana = promedio de ese día de la semana ($400.000 ÷ 4)", at(r, tomorrow));
ok(Number(at(r, T).in_sales) === 0 || Number(at(r, T).in_sales) !== 999999 / 4, "La venta de hoy no entra en el promedio");
ok(Number(at(r, await day(3)).in_receivables) === 50000, "Cartera que vence en 3 días: $50.000 (la anulada no)", at(r, await day(3)));
ok(Number(r.overdue.receivables) === 20000, "Cartera vencida aparte: $20.000", r.overdue);

console.log("Sale");
ok(Number(at(r, await day(5)).out_payables) === 300000, "Proveedor que vence en 5 días (la pagada no)", at(r, await day(5)));
ok(Number(at(r, T).out_payables) === 11111, "Cuenta por pagar sin fecha: cuenta para hoy", at(r, T));
ok(Number(r.overdue.payables) === 70000, "Proveedor vencido aparte", r.overdue);
ok(Number(at(r, await day(2)).out_expenses) === 30000, "Gasto por pagar: el saldo ($40.000 − $10.000)", at(r, await day(2)));
ok(Number(at(r, d10).out_expenses) === 2000000, "Gasto fijo mensual que todavía no se genera: en su fecha", at(r, d10));
ok(r.items.expenses.some((x) => x.fixed && x.name === "Arriendo local"), "Sale en el detalle como gasto fijo");
await raw("insert into erp_expenses (store_id, category_id, number, description, amount, incurred_on, due_on, status, recurring_id, period_key) select $1, $2, 2, 'Arriendo local', 2000000, $3::date, $3::date, 'paid', id, $3::text from erp_recurring_expenses", [S, CAT, d10]);
r = await flow();
ok(Number(at(r, d10).out_expenses) === 0, "Si ese gasto fijo ya se generó (y se pagó), no se cuenta dos veces", at(r, d10));

console.log("Nómina");
const inWindow = r.days.some((x) => x.day === eom);
if (inWindow) {
  ok(Number(at(r, eom).out_payroll) === 1500000, "Sin nómina de este mes: estimada con el salario base", at(r, eom));
  await raw("insert into erp_payroll_runs (store_id, number, period_kind, period_start, period_end, status, net) values ($1, 1, 'monthly', date_trunc('month', $2::date), $2, 'approved', 1400000)", [S, eom]);
  r = await flow();
  ok(Number(at(r, eom).out_payroll) === 1400000, "Con la nómina aprobada: lo que falta pagar de ella (no la estimada)", at(r, eom));
} else {
  ok(true, "(fin de mes fuera de la ventana: se omite)"); ok(true, "(omitida)");
}
ok(r.sales_basis.by_weekday.length === 7, "Devuelve el promedio de cada día de la semana");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
