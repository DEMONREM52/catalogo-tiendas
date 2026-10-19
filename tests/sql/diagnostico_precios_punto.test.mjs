// Prueba de supabase/scripts/diagnostico_precios_punto.sql sobre PGlite: que corra y muestre lo que ve cada usuario.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_diag_precios_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8") + "\n" +
  fs.readFileSync(path.join(here, "migraciones/20261106_rentabilidad_precios_punto.sql"), "utf8"));
const report = (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); };
process.on("unhandledRejection", report);
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const raw = async (sql, p) => (await db.query(sql, p)).rows;
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log("  ✔ " + label); } else { fail++; console.log("  ✘ " + label + (extra !== undefined ? " → " + JSON.stringify(extra).slice(0, 400) : "")); } };

const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('lavitrina', 'LA VITRINA', $1) returning id", [U(1)]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'Z', 'SEDE ZAMORA', true) returning id", [S]);
const [{ id: O }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'O', 'OTRO PUNTO', true) returning id", [S]);
await raw("insert into products (store_id, name, sku, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ZAPATERO BXMJ6204', 'BXMJ6204', 40000, 40000, 40000, 40000, 40000, 10)", [S]);
await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, status, reason, valid_from) values ($1, $2, 'point', 'pct', 15, 'active', 'margen 15', now() - interval '1 day')", [S, Z]);
await raw("insert into auth.users (id, email) values ($1, 'vendedorz@x.co'), ($2, 'otro@x.co')", [U(2), U(3)]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id, active) values ($1, $2, 'seller', '{pos}', $3, true), ($1, $4, 'seller', '{pos}', $5, true)", [S, U(2), Z, U(3), O]);

// En PGlite auth.uid() lee test.uid; en Supabase lee request.jwt.claims.
const script = fs.readFileSync(path.join(here, "../../supabase/scripts/diagnostico_precios_punto.sql"), "utf8")
  .replace("perform set_config('request.jwt.claim.sub', u.user_id::text, true);", "perform set_config('test.uid', u.user_id::text, true);");
await db.exec(script.replace(/select \* from diag_precios_punto[^;]*;\s*$/, ""));
const rows = await raw("select * from diag_precios_punto order by usuario = '(regla directa)' desc, usuario");
console.table(rows);
const direct = rows.find((r) => r.usuario === "(regla directa)");
ok(direct?.precios_producto === "46000.00 / 46000.00 / 46000.00 / 46000.00 / 46000.00", "La regla directa da 40.000 + 15 % = 46.000", direct);
const vz = rows.find((r) => r.usuario === "vendedorz@x.co");
ok(vz?.punto_permitido === true && vz?.productos_con_precio === 1 && /46000/.test(vz?.precios_producto ?? ""), "El vendedor de Zamora recibe 46.000", vz);
const other = rows.find((r) => r.usuario === "otro@x.co");
ok(other?.punto_permitido === false && other?.productos_con_precio === 0, "Un usuario de otro punto no recibe precios de Zamora", other);

// Si la madre baja a 20.000, el punto queda en 23.000 sin tocar la regla.
await raw("update products set price_1 = 20000, price_2 = 20000, price_3 = 20000, price_4 = 20000, price_5 = 20000 where sku = 'BXMJ6204'");
await db.exec(script.replace(/select \* from diag_precios_punto[^;]*;\s*$/, ""));
const after = (await raw("select * from diag_precios_punto where usuario = '(regla directa)'"))[0];
ok(/^23000/.test(after?.precios_producto ?? ""), "Madre a 20.000 → Zamora a 23.000", after);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
