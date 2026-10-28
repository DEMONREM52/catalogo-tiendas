// Pruebas de 20261261: editar vales (inventario y caja por diferencia) y nóminas en borrador que se recalculan solas.
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
const combined = path.join(os.tmpdir(), `remhub_editar_vales_${process.pid}.sql`);
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(here, "migraciones/20261240_vales_empleados.sql"), "utf8");
await db.exec(M);
await db.exec(M);
const E = fs.readFileSync(path.join(here, "migraciones/20261261_editar_vales.sql"), "utf8");
await db.exec(E);
await db.exec(E); // idempotente
const F = fs.readFileSync(path.join(here, "migraciones/20261262_firma_vales.sql"), "utf8");
await db.exec(F);
await db.exec(F); // idempotente

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

const stock = async (pid) => n((await raw("select qty from erp_stock_levels where product_id = $1 and warehouse_id = $2", [pid, J]))[0]?.qty ?? 0);
const edit = (uid, id, p) => one(uid, "select public.erp_employee_loan_update($1, $2::jsonb) r", [id, JSON.stringify(p)]);
const editErr = (uid, id, p) => err(uid, "select public.erp_employee_loan_update($1, $2::jsonb) r", [id, JSON.stringify(p)]);
const [{ id: Q }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1) values ($1, 'CARGADOR', 'CA-1', 5, 8000, 20000) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 5)", [J, Q, A]);

console.log("Nómina en borrador que se recalcula sola");
const run = await one(CONT, "select public.erp_payroll_create($1, null, 'biweekly', '2026-10-16', '2026-10-31', null) r", [A]);
const loanLine = async (loanId) => (await one(CONT, "select public.erp_payroll_detail($1) r", [run.id])).lines[0].items.find((i) => i.calc === "loan" && i.loan_id === loanId);
const v1 = await create(CONT, { employee_id: ana.id, kind: "product", point_id: J, items: [{ product_id: P, qty: 2, price: 60000 }], installments: 2, start_on: "2026-10-01" });
ok(n((await loanLine(v1.id))?.amount) === 60000, "Un vale creado DESPUÉS de armar el borrador ya aparece en la nómina ($60.000)", await loanLine(v1.id));

console.log("Editar vale de productos");
ok(/permiso/i.test(await editErr(SELLER, v1.id, { items: [] }) ?? ""), "Un vendedor no edita vales");
let r = await edit(CONT, v1.id, { items: [{ product_id: P, qty: 3, price: 60000 }, { product_id: Q, qty: 1, price: 20000 }], installments: 4 });
let l = await loan(v1.id);
ok(r.ok && n(l.total) === 200000 && n(l.installment) === 50000 && n(l.balance) === 200000, "3 audífonos + 1 cargador = $200.000 en 4 cuotas de $50.000", l);
ok(await stock(P) === 7 && await stock(Q) === 4, "Solo sale la diferencia: 1 audífono más (10 → 7) y el cargador (5 → 4)");
ok(l.description === "3 × AUDIFONOS BT, 1 × CARGADOR", "La descripción se arma con los productos nuevos", l.description);
ok(n((await loanLine(v1.id))?.amount) === 50000, "La nómina en borrador ya trae la cuota nueva ($50.000)");
ok(/repetido/i.test(await editErr(CONT, v1.id, { items: [{ product_id: P, qty: 1, price: 1 }, { product_id: P, qty: 1, price: 1 }] }) ?? ""), "No acepta el mismo producto dos veces");
r = await edit(CONT, v1.id, { items: [{ product_id: P, qty: 1, price: 60000 }] });
ok(await stock(P) === 9 && await stock(Q) === 5, "Al quitar productos vuelven al inventario (audífonos 9, cargador 5)");
ok((await raw("select count(*)::int n from inventory_movements where ref_type = 'employee_loan' and ref_id = $1", [v1.id]))[0].n === 5, "Cada diferencia queda en el kardex");

console.log("Lo ya pagado se respeta");
await one(CONT, "select public.erp_employee_loan_pay($1, 40000, 'cash', null, false, 'ab-ed-1') r", [v1.id]);
ok(/Ya pagó/i.test(await editErr(CONT, v1.id, { items: [{ product_id: Q, qty: 1, price: 20000 }] }) ?? ""), "No deja bajar el total por debajo de lo pagado ($40.000)");
r = await edit(CONT, v1.id, { items: [{ product_id: P, qty: 1, price: 50000 }], installments: 1 });
l = await loan(v1.id);
ok(n(l.total) === 50000 && n(l.balance) === 10000 && l.status === "active", "Bajar el precio a $50.000 deja saldo de $10.000", l);

console.log("Préstamo que salió de la caja");
const v2 = await create(CONT, { employee_id: ana.id, kind: "cash", point_id: J, amount: 300000, from_cash: true, installments: 3 });
await edit(CONT, v2.id, { amount: 450000, notes: "Le presté más" });
l = await loan(v2.id);
ok(n(l.total) === 450000 && n(l.installment) === 150000 && l.notes === "Le presté más", "Préstamo de $300.000 → $450.000 con nota", l);
ok((await raw("select count(*)::int n from erp_cash_moves where session_id = $1 and kind = 'out' and amount = 150000", [CAJA]))[0].n === 1, "Los $150.000 de más salen de la caja");
await raw("update erp_cash_sessions set status = 'closed' where id = $1", [CAJA]);
ok(/caja/i.test(await editErr(CONT, v2.id, { amount: 400000 }) ?? ""), "Con la caja cerrada no deja cambiar el valor");
r = await edit(CONT, v2.id, { installments: 2 });
ok(r.ok && n((await loan(v2.id)).installment) === 225000, "Sin cambiar el valor sí se pueden cambiar las cuotas con la caja cerrada");

console.log("Solo activos");
await one(CONT, "select public.erp_employee_loan_pay($1, 10000, 'cash', null, false, 'ab-ed-2') r", [v1.id]);
ok(/activo/i.test(await editErr(CONT, v1.id, { installments: 2 }) ?? ""), "Un vale pagado no se edita");
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'employee_loan.updated'", []))[0].n >= 5, "Cada edición queda en la auditoría con antes y después");

console.log("Firmar con un enlace");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const anon = async (s, p) => { await db.exec("set role anon"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); } };
const anonErr = async (s, p) => { try { await anon(s, p); return null; } catch (e) { return e.message; } };
const v4 = await create(CONT, { employee_id: ana.id, kind: "product", point_id: J, items: [{ product_id: Q, qty: 2, price: 20000 }], installments: 2 });
ok(/permiso/i.test(await err(SELLER, "select public.erp_employee_loan_sign_link($1) r", [v4.id]) ?? ""), "Un vendedor no saca el enlace");
const link = await one(CONT, "select public.erp_employee_loan_sign_link($1) r", [v4.id]);
ok(link.ok && /^[a-f0-9]{64}$/.test(link.token) && (await one(CONT, "select public.erp_employee_loan_sign_link($1) r", [v4.id])).token === link.token, "El enlace es largo y siempre el mismo para el vale");
const page = (await anon("select public.loan_sign_get($1) r", [link.token]))[0].r;
ok(page.ok && page.terms.total === 40000 && page.terms.employee === "ANA PÉREZ" && page.terms.items[0].name === "CARGADOR" && page.can_sign_giver === false && page.signatures.length === 0,
  "Sin sesión se ve el vale (productos, total, empleado) y no deja firmar como quien entrega", page);
ok((await anon("select public.loan_sign_get('abc') r"))[0].r.ok === false, "Un enlace inventado no muestra nada");
const sign = (role, name, doc, accept, sig = PNG) => anon("select public.loan_sign($1, $2, $3, $4, $5, $6) r", [link.token, role, name, doc, sig, accept]);
ok(/de acuerdo/i.test(await anonErr("select public.loan_sign($1, 'employee', 'Ana Pérez', '1234567', $2, false)", [link.token, PNG]) ?? ""), "El empleado debe aceptar");
ok(/cédula/i.test(await anonErr("select public.loan_sign($1, 'employee', 'Ana Pérez', '', $2, true)", [link.token, PNG]) ?? ""), "El empleado escribe su cédula");
ok(/firma/i.test(await anonErr("select public.loan_sign($1, 'employee', 'Ana Pérez', '1234567', 'hola', true)", [link.token]) ?? ""), "Sin dibujo no hay firma");
ok(/sesión/i.test(await anonErr("select public.loan_sign($1, 'giver', 'Ana Pérez', null, $2, true)", [link.token, PNG]) ?? ""), "El empleado no puede firmar como quien entrega");
const s1 = (await sign("employee", "Ana Pérez", "1.234.567", true))[0].r;
ok(s1.signatures.length === 1 && s1.signatures[0].name === "ANA PÉREZ" && s1.signatures[0].doc === "1234567", "El empleado firma (nombre en mayúsculas y cédula limpia)", s1.signatures);
ok(/ya firmó/i.test(await anonErr("select public.loan_sign($1, 'employee', 'Ana Pérez', '1234567', $2, true)", [link.token, PNG]) ?? ""), "No firma dos veces");
const s2 = await one(CONT, "select public.loan_sign($1, 'giver', 'Contadora', null, $2, false) r", [link.token, PNG]);
ok(s2.signatures.length === 2 && s2.signatures.some((s) => s.role === "giver"), "Quien entrega firma con su sesión");
let signs = (await one(CONT, "select public.erp_employee_loans_signs($1) r", [A])).signs[v4.id];
ok(signs.employee?.name === "ANA PÉREZ" && signs.giver && signs.changed === false, "El panel ve las dos firmas", signs);
await edit(CONT, v4.id, { items: [{ product_id: Q, qty: 3, price: 20000 }] });
const after = (await anon("select public.loan_sign_get($1) r", [link.token]))[0].r;
ok(after.signatures.length === 0 && after.changed === true, "Si el vale se edita, hay que firmar otra vez (las firmas viejas quedan de historial)", after);
ok((await raw("select count(*)::int n from erp_employee_loan_signatures where loan_id = $1", [v4.id]))[0].n === 2, "Las firmas anteriores no se borran");
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'employee_loan.signed'", []))[0].n === 2, "Cada firma queda en la auditoría");
ok(/permission denied/i.test(await anonErr("select * from erp_employee_loan_signatures") ?? ""), "Nadie lee las firmas directo de la tabla");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
