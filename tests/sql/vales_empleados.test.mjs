// Pruebas de 20261240: vales y préstamos a empleados descontados en la nómina.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
create table if not exists public.erp_cash_sessions (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, number bigint, status text,
  opened_at timestamptz default now(), difference numeric, closed_by_name text, closed_at timestamptz);
create table if not exists public.erp_cash_moves (id uuid primary key default gen_random_uuid(), session_id uuid, store_id uuid, kind text, amount numeric,
  reason text, created_by uuid, created_by_name text, created_at timestamptz default now());
`;
const combined = path.join(os.tmpdir(), `remhub_vales_${process.pid}.sql`);
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(here, "migraciones/20261240_vales_empleados.sql"), "utf8");
await db.exec(M);
await db.exec(M);

const U = (n) => `a1400000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CONT = U(2), APPR = U(3), SELLER = U(6);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const n = (v) => Number(v);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
const [{ id: J }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'J', 'JAVIER', true, 'point') returning id", [A]);
const member = (uid, perms) => raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', $3)", [A, uid, perms]);
await member(CONT, ["payroll", "payroll_pay"]);
await member(APPR, ["payroll_approve", "payroll"]);
await member(SELLER, ["pos"]);
await one(CONT, "select public.erp_finance_setup($1) r", [A]);
const ana = await one(CONT, "select public.erp_employee_save($1, null, $2::jsonb) r", [A, JSON.stringify({ full_name: "Ana Pérez", base_salary: 2000000, pay_frequency: "biweekly", transport_aid: false, point_id: J, hired_on: "2025-01-01" })]);
const [{ id: P }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1) values ($1, 'AUDIFONOS BT', 'AU-1', 10, 25000, 60000) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 10)", [J, P, A]);
const [{ id: CAJA }] = await raw("insert into erp_cash_sessions (store_id, point_id, status) values ($1, $2, 'open') returning id", [A, J]);
const create = (uid, p) => one(uid, "select public.erp_employee_loan_create($1, $2::jsonb) r", [A, JSON.stringify(p)]);
const loan = async (id) => (await raw("select * from erp_employee_loans where id = $1", [id]))[0];

console.log("Crear vales");
ok(/permiso/i.test(await err(SELLER, "select public.erp_employee_loan_create($1, '{}'::jsonb)", [A]) ?? ""), "Un vendedor no puede dar vales");
const v1 = await create(CONT, { employee_id: ana.id, kind: "product", point_id: J, items: [{ product_id: P, qty: 2, price: 60000 }], installments: 3, start_on: "2026-10-01" });
let l1 = await loan(v1.id);
ok(n(l1.total) === 120000 && n(l1.installment) === 40000 && l1.description === "2 × AUDIFONOS BT", "Vale de 2 audífonos a $60.000 en 3 cuotas de $40.000", l1);
ok(n((await raw("select qty from erp_stock_levels where product_id = $1 and warehouse_id = $2", [P, J]))[0].qty) === 8 && n((await raw("select stock from products where id = $1", [P]))[0].stock) === 8, "Los audífonos salen del inventario del punto (10 → 8)");
ok((await raw("select count(*)::int n from inventory_movements where ref_type = 'employee_loan' and ref_id = $1", [v1.id]))[0].n === 1, "Queda en el kardex");
ok(/Stock insuficiente/i.test(await err(CONT, "select public.erp_employee_loan_create($1, $2::jsonb)", [A, JSON.stringify({ employee_id: ana.id, kind: "product", point_id: J, items: [{ product_id: P, qty: 50, price: 1 }], installments: 1 })]) ?? ""), "No deja sacar más de lo que hay");
const v2 = await create(CONT, { employee_id: ana.id, kind: "cash", point_id: J, amount: 1000000, from_cash: true, installments: 4, interest_mode: "monthly", interest_pct: 2, start_on: "2026-10-01" });
let l2 = await loan(v2.id);
ok(n(l2.interest) === 40000 && n(l2.total) === 1040000 && n(l2.installment) === 260000, "Préstamo de $1.000.000 en 4 quincenas (2 meses) al 2 % mensual = $1.040.000, cuotas de $260.000", l2);
ok((await raw("select amount, kind from erp_cash_moves where session_id = $1", [CAJA])).some((m) => m.kind === "out" && n(m.amount) === 1000000), "El dinero sale de la caja abierta del punto");
ok(/caja/i.test(await err(CONT, "select public.erp_employee_loan_create($1, $2::jsonb)", [A, JSON.stringify({ employee_id: ana.id, kind: "cash", amount: 10, from_cash: true, installments: 1 })]) ?? ""), "Sacar de caja pide el punto");

console.log("Nómina");
const run = await one(CONT, "select public.erp_payroll_create($1, null, 'biweekly', '2026-10-01', '2026-10-15', null) r", [A]);
const det = async () => one(CONT, "select public.erp_payroll_detail($1) r", [run.id]);
let line = (await det()).lines[0];
const loanItems = (l) => l.items.filter((i) => i.calc === "loan");
ok(loanItems(line).length === 2 && n(loanItems(line).find((i) => i.loan_id === v1.id).amount) === 40000 && n(loanItems(line).find((i) => i.loan_id === v2.id).amount) === 260000, "La quincena descuenta sola las dos cuotas", loanItems(line));
ok(n(line.net) === n(line.earnings) - n(line.deductions) && n(line.net) >= 0, "El neto queda bien calculado", line);
ok(/permiso/i.test(await err(SELLER, "select public.erp_payroll_loan_override($1, $2, 0)", [line.id, v2.id]) ?? ""), "Solo quien hace la nómina cambia la cuota");
await one(CONT, "select public.erp_payroll_loan_override($1, $2, 0) r", [line.id, v2.id]);
line = (await det()).lines[0];
ok(n(loanItems(line).find((i) => i.loan_id === v2.id).amount) === 0, "Se puede saltar la cuota del préstamo en esta quincena");
await one(APPR, "select public.erp_payroll_transition($1, 'approve', null) r", [run.id]);
l1 = await loan(v1.id); l2 = await loan(v2.id);
ok(n(l1.balance) === 80000 && n(l2.balance) === 1040000, "Al aprobar se cobra: audífonos quedan en $80.000 y el préstamo igual", { b1: l1.balance, b2: l2.balance });
await one(APPR, "select public.erp_payroll_transition($1, 'reopen', null) r", [run.id]);
ok(n((await loan(v1.id)).balance) === 120000, "Si la nómina vuelve a borrador, el saldo vuelve");
await one(APPR, "select public.erp_payroll_transition($1, 'approve', null) r", [run.id]);
ok(n((await loan(v1.id)).balance) === 80000 && (await raw("select count(*)::int n from erp_employee_loan_payments where loan_id = $1 and not voided", [v1.id]))[0].n === 1, "Aprobada otra vez: un solo descuento vigente");

console.log("Abonos y anulación");
ok(/supera/i.test(await err(CONT, "select public.erp_employee_loan_pay($1, 999999, 'cash', null, false, null)", [v1.id]) ?? ""), "No se abona más del saldo");
const pay = await one(CONT, "select public.erp_employee_loan_pay($1, 80000, 'cash', 'Pagó en efectivo', true, 'abono-v1-0001') r", [v1.id]);
const pay2 = await one(CONT, "select public.erp_employee_loan_pay($1, 80000, 'cash', null, true, 'abono-v1-0001') r", [v1.id]);
ok(pay.ok && pay2.already, "Un abono repetido no se duplica");
l1 = await loan(v1.id);
ok(l1.status === "paid" && n(l1.balance) === 0, "Con el abono el vale queda pagado", l1);
ok((await raw("select count(*)::int n from erp_cash_moves where session_id = $1 and kind = 'in' and amount = 80000", [CAJA]))[0].n === 1, "El abono entra a la caja");
ok(/permiso/i.test(await err(CONT, "select public.erp_employee_loan_void($1, 'error')", [v2.id]) ?? ""), "Solo quien aprueba nómina anula vales");
ok(/abonos|descuentos/i.test(await err(APPR, "select public.erp_employee_loan_void($1, 'error')", [v1.id]) ?? ""), "Un vale con abonos no se anula");
await one(APPR, "select public.erp_employee_loan_pause($1, true) r", [v2.id]);
const run2 = await one(CONT, "select public.erp_payroll_create($1, null, 'biweekly', '2026-10-16', '2026-10-31', null) r", [A]);
const line2 = (await one(CONT, "select public.erp_payroll_detail($1) r", [run2.id])).lines[0];
ok(!loanItems(line2).some((i) => i.loan_id === v2.id) && !loanItems(line2).some((i) => i.loan_id === v1.id), "Pausado no se descuenta, y el pagado tampoco", loanItems(line2));
const vd = await one(APPR, "select public.erp_employee_loan_void($1, 'Se registró mal') r", [v2.id]);
ok(vd.ok && vd.cash_back && (await loan(v2.id)).status === "void", "Anular el préstamo devuelve el dinero a la caja", vd);
const v3 = await create(CONT, { employee_id: ana.id, kind: "product", point_id: J, items: [{ product_id: P, qty: 1, price: 50000 }], installments: 1 });
await one(APPR, "select public.erp_employee_loan_void($1, 'No se lo llevó') r", [v3.id]);
ok(n((await raw("select qty from erp_stock_levels where product_id = $1 and warehouse_id = $2", [P, J]))[0].qty) === 8, "Anular un vale de productos los devuelve al inventario");
const list = await one(CONT, "select public.erp_employee_loans_list($1) r", [A]);
ok(list.ok && list.loans.length === 3 && list.loans.find((x) => x.id === v1.id).payments.length === 3, "La lista trae los vales con su historial (descuento anulado, descuento y abono)", list.loans.map((x) => [x.number, x.status, x.payments.length]));
ok((await one(SELLER, "select public.erp_employee_loans_list($1) r", [A])).ok === false, "Un vendedor no ve los vales");
ok((await raw("select count(*)::int n from erp_audit_logs where action like 'employee_loan.%'", []))[0].n >= 6, "Todo queda en la auditoría");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
