// Pruebas de 20261247: resumen de copias de seguridad y accesos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_seg_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261247_seguridad.sql"), "utf8");
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
const U = (n) => `5e600000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ADMIN = U(2), SELL = U(3), OLD = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw(`insert into store_users (store_id, user_id, role, permissions, username, active) values
  ($1, $2, 'store_admin', '{}', 'ana', true), ($1, $3, 'seller', '{pos,costs_view}', 'caja', true), ($1, $4, 'seller', '{users}', 'viejo', false)`, [A, ADMIN, SELL, OLD]);
await raw("insert into erp_audit_logs (store_id, user_id, action, entity, detail, created_at) values ($1, $2, 'export.datos.productos', 'x', '{\"rows\": 10}', now() - interval '3 days'), ($1, $2, 'export.datos.productos+ventas', 'x', '{\"rows\": 99}', now() - interval '1 day'), ($1, $2, 'usuario.update', 'store_users', '{}', now()), ($1, $2, 'pos.sale', 'x', '{}', now())", [A, ADMIN]);

ok((await one(SELL, "select public.erp_security_overview($1) r", [A])).ok === false, "Un cajero no la ve");
const r = await one(OWNER, "select public.erp_security_overview($1) r", [A]);
ok(r.ok && r.last_backup?.rows === 99 && r.last_backup.by === "ana", "Última copia: la más reciente y quién la bajó", r.last_backup);
ok(r.team.total === 3 && r.team.active === 2 && r.team.inactive === 1 && r.team.admins === 1, "Cuenta usuarios activos, inactivos y administradores", r.team);
ok(JSON.stringify(r.team.can_users) === '["ana"]' && r.team.can_costs === 2, "Quién maneja usuarios (sin los inactivos) y quién ve costos", r.team);
ok(r.changes.length === 1 && r.changes[0].action === "usuario.update", "Solo cambios de usuarios en el historial", r.changes);
ok((await one(ADMIN, "select public.erp_security_overview($1) r", [A])).ok, "El administrador también la ve");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
