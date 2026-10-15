// Pruebas de 20261120: permiso «Exportar» y cuentas por pagar con alcance de punto.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "../../supabase/migrations");
const combined = path.join(os.tmpdir(), `remhub_perm_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261118_compras_desde_punto.sql", "20261120_permisos_exportar_y_punto.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });

// Usuarios creados ANTES de la migración (para probar que conservan exportar).
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid]); await db.exec("set role authenticated"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };

const U = (n) => `c4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CONT = U(2), VEND = U(3), SARA = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id) values
  ($1,$2,'seller','{receivables,payables}',null), ($1,$3,'seller','{pos}',$5), ($1,$4,'seller','{purchases,payables,suppliers}',$5)`, [A, CONT, VEND, SARA, Z]);

console.log("1. Permiso «Exportar»");
await db.exec(fs.readFileSync(path.join(MIG, "20261120_permisos_exportar_y_punto.sql"), "utf8"));
const perms = Object.fromEntries((await raw("select user_id, permissions from store_users")).map((r) => [r.user_id, r.permissions]));
ok(perms[CONT].includes("exports"), "Quien ya descargaba listados (cartera, cuentas por pagar) conserva «Exportar»");
ok(!perms[VEND].includes("exports"), "Un vendedor de POS no lo recibe");
await db.exec(fs.readFileSync(path.join(MIG, "20261120_permisos_exportar_y_punto.sql"), "utf8"));
ok((await raw("select permissions from store_users where user_id = $1", [CONT]))[0].permissions.filter((p) => p === "exports").length === 1, "Correr la migración dos veces no lo duplica");
ok((await raw("select 'exports' = any (public.erp__known_permissions()) r"))[0].r, "La base reconoce el permiso nuevo");

console.log("2. Cuentas por pagar con alcance de punto");
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROV', true) returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock) values ($1, 'X', 0) returning id", [A]);
let k = 0;
const buy = (u, wh) => as(u, "select public.erp_receive_invoice($1, $2, $3, current_date, 'credit', current_date + 30, null, 'X', $4::jsonb) r", [A, SUP, `F-${++k}`, JSON.stringify([{ product_id: P, qty: 1, unit_cost: 1000, warehouse_id: wh }])]);
await buy(OWNER, B);
await buy(SARA, Z);
ok((await as(SARA, "select id from erp_payables")).length === 1, "SARA (punto Zamora) ve solo la cuenta por pagar de su punto");
ok((await as(CONT, "select id from erp_payables")).length === 2, "Contabilidad (madre) las ve todas");
ok((await as(VEND, "select id from erp_payables")).length === 0, "Un vendedor sin el permiso no ve ninguna");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
