// Pruebas de 20261107_proteger_costo.sql (se aplica encima de 20261106).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_costo_${process.pid}.sql`);
fs.writeFileSync(combined, ["fixtures/prod_ventas.sql", "../../supabase/migrations/20261106_rentabilidad_precios_punto.sql", "../../supabase/migrations/20261107_proteger_costo.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")).join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), BUYER = U(3), OTHER = U(4);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 200) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [OTHER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}'), ($1, $3, 'seller', '{purchases}')", [A, SELLER, BUYER]);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_3) values ($1, 'X', 15000, 20000) returning id", [A]);

ok(/permission denied/i.test(await err(SELLER, "select cost_price from products where id = $1", [P]) ?? ""), "Un usuario con sesión ya no lee el costo directo");
ok(/permission denied/i.test(await err(OWNER, "select * from products where id = $1", [P]) ?? ""), "Tampoco con select * (hay que pedir columnas)");
ok((await as(SELLER, "select name, price_3 from products where id = $1", [P]))[0]?.name === "X", "Las demás columnas se siguen leyendo");
ok((await as(OWNER, "select * from public.erp_product_costs($1, $2)", [A, [P]]))[0]?.cost_price == 15000, "El dueño ve el costo con la función");
ok((await as(BUYER, "select * from public.erp_product_costs($1, $2)", [A, [P]]))[0]?.cost_price == 15000, "Quien hace compras ve el costo");
ok(/permiso/i.test(await err(SELLER, "select * from public.erp_product_costs($1, $2)", [A, [P]]) ?? ""), "El vendedor no ve el costo");
ok(/permiso/i.test(await err(OTHER, "select * from public.erp_product_costs($1, $2)", [A, [P]]) ?? ""), "Otra tienda no ve el costo");
ok((await as(OTHER, "select * from public.erp_product_costs($1, $2)", [B, [P]])).length === 0, "Pedir un producto ajeno con la tienda propia no devuelve nada");
ok(/permission denied/i.test(await err(null, "select * from public.erp_product_costs($1, $2)", [A, [P]]) ?? ""), "Sin sesión: bloqueado");
await as(OWNER, "update products set cost_price = 16000 where id = $1", [P]);
ok((await raw("select cost_price from products where id = $1", [P]))[0].cost_price == 16000, "Editar el costo sigue funcionando");
const ins = await as(OWNER, "insert into products (store_id, name, cost_price) values ($1, 'Nuevo', 500) returning id", [A]);
ok(Boolean(ins[0]?.id), "Crear un producto con costo (devolviendo el id) sigue funcionando");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
