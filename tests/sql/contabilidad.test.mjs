// Pruebas de 20261248: configuración de la exportación «Para el contador».
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_cont_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261248_contabilidad.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `c0a70000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CONT = U(2), CAJA = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [U(9)]);
await raw("insert into store_users (store_id, user_id, role, permissions, username) values ($1, $2, 'seller', '{exports,reports}', 'contadora'), ($1, $3, 'seller', '{pos}', 'caja')", [A, CONT, CAJA]);

let r = await one(CONT, "select public.erp_accounting_settings_get($1) r", [A]);
ok(r.ok && JSON.stringify(r.config) === "{}", "Sin guardar: configuración vacía (la app pone los valores por defecto)", r);
ok((await one(CAJA, "select public.erp_accounting_settings_get($1) r", [A])).ok === false, "Sin permiso de exportar no la ve");
ok((await one(CAJA, "select public.erp_accounting_settings_save($1, '{}'::jsonb) r", [A])).ok === false, "   ni la cambia");
ok((await one(CONT, "select public.erp_accounting_settings_save($1, $2::jsonb) r", [A, JSON.stringify({ format: "siigo_nube", accounts: { sales: "413524" } })])).ok, "La contadora guarda su formato y cuentas");
r = await one(OWNER, "select public.erp_accounting_settings_get($1) r", [A]);
ok(r.config.format === "siigo_nube" && r.config.accounts.sales === "413524" && r.updated_by_name, "El dueño ve lo que guardó", r);
ok((await one(CONT, "select public.erp_accounting_settings_get($1) r", [B])).ok === false, "No ve la de otra tienda");
ok((await one(CONT, "select public.erp_accounting_settings_save($1, '[1]'::jsonb) r", [A])).ok === false, "Rechaza lo que no es un objeto");
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'accounting.settings'"))[0].n === 1, "Queda en la auditoría");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
