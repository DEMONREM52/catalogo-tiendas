// Pruebas de 20261266: empleados para crear usuarios (permiso «Usuarios», sin salario ni banco).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_usuarios_empleados_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql", "migraciones/20261112_eliminar_registros_gastos.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(here, "migraciones/20261266_usuarios_desde_empleados.sql"), "utf8");
await db.exec(M);
await db.exec(M); // idempotente

const U = (n) => `a1500000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ADMIN = U(2), POINTADMIN = U(3), SELLER = U(4);
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

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina', 'LA VITRINA', $1) returning id", [OWNER]);
const [{ id: P1 }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'P1', 'PIONEROS', true, 'point') returning id", [A]);
const [{ id: P2 }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'P2', 'ZAMORA', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'store_admin', '{users}')", [A, ADMIN]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{users}', $3)", [A, POINTADMIN, P1]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, SELLER]);
const emp = (name, point, extra = "") => raw(`insert into erp_employees (store_id, full_name, document, position, phone, point_id, base_salary, bank_account${extra ? ", active" : ""}) values ($1, $2, '1020', 'Vendedora', '3001234567', $3, 1500000, '123-456'${extra ? ", false" : ""})`, [A, name, point]);
await emp("Maria Cardona", P1);
await emp("Pedro Zamora", P2);
await emp("Retirado", P1, "inactive");

const all = await one(OWNER, "select public.erp_employees_for_users($1) r", [A]);
ok(all.length === 2 && all.map((x) => x.full_name).join() === "Maria Cardona,Pedro Zamora", "Dueño: los activos, sin los retirados", all);
ok(!("base_salary" in all[0]) && !("bank_account" in all[0]) && all[0].document === "1020" && all[0].point_id === P1, "Sin salario ni banco; con cédula y punto", all[0]);
ok((await one(ADMIN, "select public.erp_employees_for_users($1) r", [A])).length === 2, "Con permiso «Usuarios» los ve");
const mine = await one(POINTADMIN, "select public.erp_employees_for_users($1) r", [A]);
ok(mine.length === 1 && mine[0].full_name === "Maria Cardona", "Con un punto asignado: solo los de su punto", mine);
ok(/Usuarios/.test(await err(SELLER, "select public.erp_employees_for_users($1) r", [A]) ?? ""), "Sin el permiso: no");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
