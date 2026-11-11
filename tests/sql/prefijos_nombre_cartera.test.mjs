// Pruebas de 20261317 (prefijos únicos, número libre, nombre del dueño y cartera al editar).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
alter table auth.users add column if not exists raw_user_meta_data jsonb default '{}';
alter table public.orders add column if not exists updated_at timestamptz;
alter table public.erp_receivables add column if not exists doc_number text;
create or replace function public.erp_actor_name(p_store uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(trim(su.display_name), ''), su.username) from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()),
    (select u.email::text from auth.users u where u.id = auth.uid()),
    'Sistema') $$;
`;
const combined = path.join(os.tmpdir(), `remhub_pref_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;
const callErr = async (u, fn, args) => { try { await call(u, fn, args); return null; } catch (e) { return e.message; } };

const U = (n) => `a1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CAJA = U(2);
await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'dueno@correo.com', '{\"display_name\":\"Javier\"}'), ($2, 'caja@correo.com', '{}')", [OWNER, CAJA]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('t', 'Tienda', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions, display_name) values ($1, $2, 'seller', '{pos}', 'Caja')", [A, CAJA]);
const wh = async (name, kind = "point") => (await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, $2, $2, $3) returning id", [A, name, kind]))[0].id;
// Cada tienda nace con su «Bodega principal» (punto principal): se usa esa.
const bodega = async (store) => (await raw("select public.erp_default_warehouse($1) id", [store]).catch(() => [{ id: null }]))[0].id
  ?? (await raw("select id from erp_warehouses where store_id = $1 and is_default", [store]))[0]?.id;
const BOD = await bodega(A);
const P1 = await wh("Principal"), SR = await wh("Sede San Roque");
// P1 ya usó REM-00001.
const [{ id: O0 }] = await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, 'old', 1000, 'confirmed', 'X') returning id", [A]);
await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, doc_prefix, doc_seq, doc_number) values ($1, $2, $3, 'remision', 'REM', 1, 'REM-00001')", [O0, A, P1]);
await raw("update erp_warehouses set next_remision_number = 2 where id = $1", [P1]);
// Otra tienda con un solo punto (su bodega principal): no se toca.
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'Otra', $1) returning id", [OWNER]);
const BP = await bodega(B);

const sql = fs.readFileSync(path.join(MIG, "20261317_prefijos_nombre_cartera.sql"), "utf8");
await db.exec(sql); await db.exec(sql);

console.log("1. Prefijos");
const pre = Object.fromEntries((await raw("select id, remision_prefix r, invoice_prefix f, next_remision_number n from erp_warehouses where store_id = $1", [A])).map((x) => [x.id, x]));
ok(pre[P1].r === "REM" && pre[P1].n === 2, "el punto que ya tenía documentos conserva REM y su consecutivo", pre[P1]);
ok(pre[BOD].r === "REMBP" && pre[BOD].f === "FAC", "la bodega recibe REMBP y, como punto principal, conserva FAC (nadie lo había usado)", pre[BOD]);
ok(pre[P1].f === "FACP", "el otro punto recibe FACP", pre[P1]);
ok(pre[SR].r === "REMSSR" && pre[SR].f === "FACSSR", "San Roque recibe sus iniciales", pre[SR]);
const all = await raw("select remision_prefix p from erp_warehouses where store_id = $1 union all select invoice_prefix from erp_warehouses where store_id = $1", [A]);
ok(new Set(all.map((x) => x.p)).size === all.length, "ningún prefijo repetido en la tienda");
ok((await raw("select remision_prefix r from erp_warehouses where id = $1", [BP]))[0].r === "REM", "una tienda de un solo punto no cambia");
const NUEVO = await wh("Sede Centro");
const [nv] = await raw("select remision_prefix r, invoice_prefix f from erp_warehouses where id = $1", [NUEVO]);
ok(nv.r === "REMSC" && nv.f === "FACSC", "un punto nuevo nace con su propio prefijo", nv);
const [{ id: B2 }] = await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, 'Dos', 'Dos', 'point') returning id", [B]);
ok((await raw("select remision_prefix r from erp_warehouses where id = $1", [B2]))[0].r === "REMD", "en otra tienda el segundo punto también recibe uno propio");
ok((await raw("select remision_prefix r from erp_warehouses where id = $1", [BP]))[0].r === "REM", "y el primero conserva el suyo");

console.log("2. Número libre");
await raw("update erp_warehouses set remision_prefix = 'REM', next_remision_number = 1 where id = $1", [SR]);
const [{ token: T1 }] = await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, 't1', 5000, 'draft', 'Ana') returning token", [A]);
const tag = await call(CAJA, "erp_tag_order($1, $2, $3, null, 'remision')", [A, T1, SR]);
ok(tag.doc_number === "REM-00002", "si REM-00001 ya existe, salta a REM-00002 en vez de fallar", tag);
ok((await raw("select next_remision_number n from erp_warehouses where id = $1", [SR]))[0].n === 3, "el consecutivo queda después del usado");

console.log("3. Nombre del dueño");
const sellers = await as(OWNER, "select * from public.erp_sellers($1)", [A]);
ok(sellers.some((s) => s.role === "owner" && s.name === "Javier"), "el dueño sale con su nombre, no con el correo", sellers);
const [{ token: T2 }] = await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, 't2', 5000, 'draft', 'Ana') returning token", [A]);
const tag2 = await call(OWNER, "erp_tag_order($1, $2, $3, null, 'remision')", [A, T2, P1]);
ok(tag2.seller_name === "Javier", "una venta del dueño queda con su nombre", tag2);
await raw("update auth.users set raw_user_meta_data = '{}' where id = $1", [OWNER]);
ok((await as(OWNER, "select name from public.erp_sellers($1) where role = 'owner'", [A]))[0].name === "dueno@correo.com", "sin nombre escrito, sigue el correo");

console.log("4. Cartera al editar");
const prod = async (name, price) => (await raw("insert into products (store_id, name, price_3, active) values ($1, $2, $3, true) returning id", [A, name, price]))[0].id;
const X = await prod("Licuadora", 1000);
const [{ id: OID }] = await raw("select id from orders where token = 't1'");
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 5, 1000)", [OID, X]);
await raw("update orders set total = 5000 where id = $1", [OID]);
await raw("insert into erp_receivables (store_id, order_id, total, balance, status) values ($1, $2, 5000, 3000, 'open')", [A, OID]);
const items = (q) => JSON.stringify([{ product_id: X, qty: q, price: 1000 }]);
const e1 = await call(CAJA, "erp_pos_order_set_items($1, $2::jsonb, 'Ana', '')", [OID, items(8)]);
ok(Number(e1.total) === 8000, "se guarda el nuevo total", e1);
const [r1] = await raw("select total, balance from erp_receivables where order_id = $1", [OID]);
ok(Number(r1.total) === 8000 && Number(r1.balance) === 6000, "la cartera sube: total 8.000, saldo 6.000 (respeta 2.000 abonados)", r1);
await call(CAJA, "erp_pos_order_set_items($1, $2::jsonb, 'Ana', '')", [OID, items(3)]);
const [r2] = await raw("select total, balance from erp_receivables where order_id = $1", [OID]);
ok(Number(r2.total) === 3000 && Number(r2.balance) === 1000, "la cartera baja: total 3.000, saldo 1.000", r2);
const err = await callErr(CAJA, "erp_pos_order_set_items($1, $2::jsonb, 'Ana', '')", [OID, items(1)]);
ok(/abonos/.test(err ?? ""), "no deja bajar el total por debajo de lo abonado", err);
const [r3] = await raw("select total, balance from erp_receivables where order_id = $1", [OID]);
ok(Number(r3.total) === 3000, "si no deja, no cambia nada", r3);
const [{ id: O2 }] = await raw("select id from orders where token = 't2'");
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1000)", [O2, X]);
const e2 = await call(CAJA, "erp_pos_order_set_items($1, $2::jsonb, 'Ana', '')", [O2, items(2)]);
ok(Number(e2.total) === 2000, "una venta de contado se edita igual (sin cartera)", e2);

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
