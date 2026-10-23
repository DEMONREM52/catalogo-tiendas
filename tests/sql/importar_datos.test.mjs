// Pruebas de 20261239: cuentas por pagar iniciales (importadas) con permiso, sin duplicar.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_imp_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261239_importar_datos.sql"), "utf8");
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
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `ceb00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), OTHER = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [OTHER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, SELLER]);
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, nit) values ($1, 'PROVEEDOR UNO', '900111') returning id", [A]);
const [{ id: SUPB }] = await raw("insert into erp_suppliers (store_id, name, nit) values ($1, 'DE OTRA', '900222') returning id", [B]);

const call = "select public.erp_payable_opening($1, $2, $3, $4::date, $5, $6) r";
let r = (await as(OWNER, call, [A, SUP, 350000, "2026-11-30", "FAC-881", "Saldo de antes de RemHub"]))[0].r;
ok(r.ok && r.duplicate === false, "El dueño carga una deuda inicial con el proveedor", r);
const row = (await raw("select total, balance, status, due_date::text d, reference, notes, purchase_id from erp_payables where id = $1", [r.id]))[0];
ok(Number(row.total) === 350000 && Number(row.balance) === 350000 && row.status === "open" && row.d === "2026-11-30" && row.purchase_id === null, "Queda abierta por el saldo completo, sin compra", row);
ok(row.reference === "FAC-881" && row.notes === "Saldo de antes de RemHub", "Guarda la referencia y la nota", row);
const again = (await as(OWNER, call, [A, SUP, 350000, "2026-11-30", " FAC-881 ", null]))[0].r;
ok(again.duplicate === true && again.id === r.id && (await raw("select count(*)::int n from erp_payables where store_id = $1", [A]))[0].n === 1, "Importar el mismo archivo otra vez no la duplica");
ok((await as(OWNER, call, [A, SUP, 100000, null, null, null]))[0].r.ok, "Sin referencia ni vencimiento también se puede");
ok(/permiso/.test(await err(SELLER, call, [A, SUP, 1000, null, "X", null]) ?? ""), "Un vendedor sin «Cuentas por pagar» no puede");
ok(/no es de tu tienda/.test(await err(OWNER, call, [A, SUPB, 1000, null, "Y", null]) ?? ""), "No se puede usar un proveedor de otra tienda");
ok(/mayor que cero/.test(await err(OWNER, call, [A, SUP, 0, null, "Z", null]) ?? ""), "El valor debe ser mayor que cero");
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'payable.opening'"))[0].n === 2, "Queda en la auditoría");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
