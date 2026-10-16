// Pruebas de 20261207: precios por mayor para traslados y pedidos internos (solo con sesión en la tienda, nunca costos).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_pd_${process.pid}.sql`);
// erp__is_store_member tal cual está en producción (consulta_rendimiento.sql).
const member = `create or replace function public.erp__is_store_member(p_store uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
      or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active); $$;`;
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), member,
  fs.readFileSync(path.join(MIG, "20261207_precios_documentos.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const OWNER = "c7000000-0000-0000-0000-000000000001", SELLER = "c7000000-0000-0000-0000-000000000002", OTHER = "c7000000-0000-0000-0000-000000000003";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [OTHER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{stock_requests}')", [A, SELLER]);
const [{ id: P }] = await raw("insert into products (store_id, name, sku, cost_price, price_2, price_3) values ($1, 'CARGADOR', 'CH2121', 15000, 22000, 26000) returning id", [A]);
const [{ id: Q }] = await raw("insert into products (store_id, name, cost_price, price_2, price_3) values ($1, 'DE OTRA', 1000, 2000, 3000) returning id", [B]);

const rows = await as(SELLER, "select * from public.erp_product_list_prices($1::uuid[])", [`{${P},${Q}}`]);
ok(rows.length === 1 && Number(rows[0].price_2) === 22000 && Number(rows[0].price_3) === 26000 && rows[0].sku === "CH2121", "Un usuario de la tienda ve precio por mayor y detal de sus productos", rows);
ok(!("cost_price" in rows[0]), "Nunca entrega el costo", Object.keys(rows[0]));
ok(rows.every((r) => r.product_id !== Q), "No ve precios de productos de otra tienda");
ok(/permission denied/.test((await err(null, "select * from public.erp_product_list_prices($1::uuid[])", [`{${P}}`])) ?? ""), "Sin sesión (ej. el conductor con el enlace) no ve precios");
ok((await as(OTHER, "select * from public.erp_product_list_prices($1::uuid[])", [`{${P}}`])).length === 0, "El dueño de otra tienda tampoco");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
