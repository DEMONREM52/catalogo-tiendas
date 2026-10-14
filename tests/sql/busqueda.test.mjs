// Pruebas de 20261111: la búsqueda funciona con el costo protegido (20261107) y no devuelve el costo.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Búsqueda parecida a la de producción: corre con los permisos de quien llama y devuelve el producto completo.
const stub = `
create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin') $$;
create or replace function public.search_products_pro(p_store_id uuid, p_query text, p_limit integer, p_offset integer, p_status text, p_category_id uuid)
returns setof public.products language sql stable as $$
  select * from public.products where store_id = p_store_id and name ilike '%' || coalesce(p_query, '') || '%' order by name limit p_limit offset p_offset $$;
`;
const combined = path.join(os.tmpdir(), `remhub_busqueda_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), stub,
  ...["20261106_rentabilidad_precios_punto.sql", "20261107_proteger_costo.sql", "20261111_busqueda_productos_segura.sql"].map((f) => fs.readFileSync(path.join(here, "../../supabase/migrations", f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `b1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), OTHER = U(3), ADMIN = U(4);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1)", [OTHER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{products_view}')", [A, SELLER]);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
await raw("insert into products (store_id, name, cost_price, price_3) values ($1, 'ORGANIZADOR COCINA', 15000, 20000), ($1, 'TERMO', 9000, 12000)", [A]);
const q = "select * from public.search_products_safe($1, 'organ', 50, 0, 'all', null) r";

ok(/permission denied/i.test(await err(SELLER, "select * from public.search_products_pro($1, 'organ', 50, 0, 'all', null)", [A]) ?? ""), "(reproduce el error) la búsqueda anterior falla con el costo protegido");
const rows = await as(SELLER, q, [A]);
ok(rows.length === 1 && rows[0].r.name === "ORGANIZADOR COCINA", "La búsqueda segura encuentra el producto", rows);
ok(rows[0] && !("cost_price" in rows[0].r) && Number(rows[0].r.price_3) === 20000, "…con sus precios y SIN el costo", rows[0]?.r);
ok((await as(OWNER, q, [A])).length === 1, "El dueño también busca");
ok((await as(ADMIN, q, [A])).length === 1, "El administrador de la plataforma también");
ok(/no perteneces/i.test(await err(OTHER, q, [A]) ?? ""), "Otra tienda no busca en esta");
ok(/permission denied/i.test(await err(null, q, [A]) ?? ""), "Sin sesión: bloqueado");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
