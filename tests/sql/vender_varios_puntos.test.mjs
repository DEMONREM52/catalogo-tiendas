// Pruebas de 20261318 (un vendedor trabaja y vende en dos o más puntos).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Funciones con la misma revisión de punto que las de producción.
const extra = `
alter table auth.users add column if not exists raw_user_meta_data jsonb default '{}';
alter table public.orders add column if not exists updated_at timestamptz;
alter table public.erp_receivables add column if not exists doc_number text;
create table if not exists public.user_profiles (user_id uuid primary key, role text);
create or replace function public.erp_actor_name(p_store uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(trim(su.display_name), ''), su.username) from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()), 'Sistema') $$;
create or replace function public.erp_pos_documents(p_store uuid, p_point uuid, p_query text, p_limit integer default 30)
returns table(order_id uuid, doc_number text) language sql stable security definer set search_path = public as $f$
  with params as (
    select coalesce(public.erp_my_point(p_store), p_point) as pt
  )
  select o.id, m.doc_number
  from params, public.erp_order_meta m
  join public.orders o on o.id = m.order_id
  where public.erp_can(p_store, 'pos') and params.pt is not null and m.store_id = p_store and m.point_id = params.pt
  order by o.created_at desc $f$;
create or replace function public.fiscal_can_send(p_doc uuid) returns boolean language plpgsql stable security definer set search_path = public as $f$
declare d record;
begin
  select * into d from public.fx_docs where id = p_doc;
  if public.erp_can(d.store_id, 'pos') and d.point_id = public.erp_my_point(d.store_id)
     and d.created_by = auth.uid() then
    return true;
  end if;
  return false;
end $f$;
create table if not exists public.fx_docs (id uuid primary key default gen_random_uuid(), store_id uuid, point_id uuid, created_by uuid);
create or replace function public.erp_my_scope(p_store uuid) returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare v_points uuid[] := public.erp_my_points(p_store);
begin
  return jsonb_build_object(
    'point_ids', to_jsonb(v_points),
    'scope', 'x');
end $f$;
grant execute on function public.erp_pos_documents(uuid, uuid, text, integer), public.fiscal_can_send(uuid), public.erp_my_scope(uuid) to authenticated;
grant select on public.fx_docs to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_vvp_${process.pid}.sql`);
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

const U = (n) => `b2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANA = U(2), LUIS = U(3);
await raw("insert into auth.users (id, email) values ($1, 'd@x.co'), ($2, 'a@x.co'), ($3, 'l@x.co')", [OWNER, ANA, LUIS]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('t', 'Tienda', $1) returning id", [OWNER]);
const wh = async (name) => (await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, $2, $2, 'point') returning id", [A, name]))[0].id;

const sql17 = fs.readFileSync(path.join(MIG, "20261317_prefijos_nombre_cartera.sql"), "utf8");
await db.exec(sql17);
const P1 = await wh("Centro"), P2 = await wh("Norte"), P3 = await wh("Sur");
// Ana: principal Centro, consulta Sur. Luis: solo Centro.
await raw(`insert into store_users (store_id, user_id, role, permissions, display_name, point_id, point_ids) values
  ($1, $2, 'seller', '{pos}', 'Ana', $4, array[$5]::uuid[]), ($1, $3, 'seller', '{pos}', 'Luis', $4, '{}')`, [A, ANA, LUIS, P1, P3]);

let n = 0;
const order = async () => (await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, $2, 1000, 'draft', 'C') returning token", [A, `t${++n}`]))[0].token;

console.log("0. Antes");
ok(/punto/i.test(await callErr(ANA, "erp_tag_order($1, $2, $3, null, 'remision')", [A, await order(), P2]) ?? ""), "Ana no podía vender en Norte");

const sql = fs.readFileSync(path.join(MIG, "20261318_vender_varios_puntos.sql"), "utf8");
await db.exec(sql); await db.exec(sql);
const [{ d: tagDef }] = await raw("select pg_get_functiondef('public.erp_tag_order(uuid,text,uuid,uuid,text)'::regprocedure) d");
ok((tagDef.match(/erp_can_sell_at/g) ?? []).length === 1, "correr dos veces no repite la revisión");

console.log("1. Puntos de venta");
ok((await call(ANA, "erp_my_sell_points($1)", [A])).join() === P1, "sin marcar nada, Ana vende solo en Centro (la consulta no da ventas)");
ok(/punto/i.test(await callErr(ANA, "erp_tag_order($1, $2, $3, null, 'remision')", [A, await order(), P3]) ?? ""), "en Sur (solo consulta) sigue sin poder vender");
await raw("update store_users set sell_point_ids = array[$2, $2, $3]::uuid[] where user_id = $1", [ANA, P2, P1]);
ok((await raw("select sell_point_ids s from store_users where user_id = $1", [ANA]))[0].s.join() === P2, "se guardan sin repetidos y sin el principal");
const mine = await call(ANA, "erp_my_sell_points($1)", [A]);
ok(mine.length === 2 && mine.includes(P1) && mine.includes(P2), "Ana vende en Centro y Norte", mine);
ok((await call(ANA, "erp_my_points($1)", [A])).length === 3, "y ve Centro, Norte y Sur");
const [{ id: OTRA }] = await raw("insert into stores (slug, name, owner_id) values ('o', 'Otra', $1) returning id", [OWNER]);
const [{ id: AJENO }] = await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, 'X', 'X', 'point') returning id", [OTRA]);
ok(/no pertenece/.test(await raw("update store_users set sell_point_ids = array[$2]::uuid[] where user_id = $1", [ANA, AJENO]).then(() => "", (e) => e.message)), "no acepta un punto de otra tienda");

console.log("2. Vender");
const t2 = await order();
const tag = await call(ANA, "erp_tag_order($1, $2, $3, null, 'remision')", [A, t2, P2]);
ok(/^REM/.test(tag.doc_number ?? ""), "Ana vende en Norte", tag);
ok((await raw("select m.point_id from erp_order_meta m join orders o on o.id = m.order_id where o.token = $1", [t2]))[0].point_id === P2, "la venta queda en Norte");
ok(/punto/i.test(await callErr(ANA, "erp_tag_order($1, $2, $3, null, 'remision')", [A, await order(), P3]) ?? ""), "en Sur sigue sin poder");
ok(/punto/i.test(await callErr(LUIS, "erp_tag_order($1, $2, $3, null, 'remision')", [A, await order(), P2]) ?? ""), "Luis (sin puntos de venta extra) no vende en Norte");
const t3 = await order();
ok(!!(await call(OWNER, "erp_tag_order($1, $2, $3, null, 'remision')", [A, t3, P3])).doc_number, "el dueño vende en cualquier punto");
// Inserción directa (sin la función): la regla de la tabla también revisa.
const [{ id: O5 }] = await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, 'directo', 1, 'draft', 'C') returning id", [A]);
await raw("select set_config('test.uid', $1, false)", [ANA]);
const guard = await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, doc_number) values ($1, $2, $3, 'remision', 'Z-1')", [O5, A, P3]).then(() => "ok", (e) => e.message);
await raw("select set_config('test.uid', '', false)");
ok(/puntos asignados/.test(guard), "el guardia de la tabla bloquea un punto ajeno", guard);

console.log("3. Editar y documentos");
const X = (await raw("insert into products (store_id, name, price_3, active) values ($1, 'Vaso', 1000, true) returning id", [A]))[0].id;
const [{ id: OID }] = await raw("select id from orders where token = $1", [t2]);
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1000)", [OID, X]);
const e = await call(ANA, "erp_pos_order_set_items($1, $2::jsonb, 'C', '')", [OID, JSON.stringify([{ product_id: X, qty: 2, price: 1000 }])]);
ok(Number(e.total) === 2000, "Ana edita una venta de Norte", e);
const [{ id: O3 }] = await raw("select id from orders where token = $1", [t3]);
ok(/otro punto/.test(await callErr(ANA, "erp_pos_order_set_items($1, $2::jsonb, 'C', '')", [O3, JSON.stringify([{ product_id: X, qty: 1, price: 1000 }])]) ?? ""), "no edita una de Sur");
const docsNorte = await as(ANA, "select * from public.erp_pos_documents($1, $2, '')", [A, P2]);
ok(docsNorte.some((x) => x.order_id === OID), "en el POS, con Norte elegido, ve los documentos de Norte", docsNorte);
const docsSur = await as(ANA, "select * from public.erp_pos_documents($1, $2, '')", [A, P3]);
ok(!docsSur.some((x) => x.order_id === O3), "con Sur elegido no ve los de Sur (cae a su punto)", docsSur);

console.log("4. Facturar, existencias, vendedores, alcance");
const [{ id: D2 }] = await raw("insert into fx_docs (store_id, point_id, created_by) values ($1, $2, $3) returning id", [A, P2, ANA]);
const [{ id: D3 }] = await raw("insert into fx_docs (store_id, point_id, created_by) values ($1, $2, $3) returning id", [A, P3, ANA]);
ok((await call(ANA, "fiscal_can_send($1)", [D2])) === true, "envía a la DIAN lo que emitió en Norte");
ok((await call(ANA, "fiscal_can_send($1)", [D3])) === false, "lo de Sur no");
await raw("insert into erp_stock_levels (store_id, warehouse_id, product_id, qty) values ($1, $2, $5, 3), ($1, $3, $5, 4), ($1, $4, $5, 5)", [A, P1, P2, P3, X]);
const st = await as(ANA, "select warehouse_id from erp_stock_levels where product_id = $1", [X]);
ok(st.length === 2 && !st.some((r) => r.warehouse_id === P3), "ve las existencias de Centro y Norte, no las de Sur", st);
ok((await as(LUIS, "select warehouse_id from erp_stock_levels where product_id = $1", [X])).length === 1, "Luis solo las de Centro");
const sel = await as(OWNER, "select * from public.erp_sellers($1)", [A]);
ok(sel.find((s) => s.user_id === ANA)?.sell_point_ids?.includes(P2), "la lista de vendedores trae dónde más vende", sel);
ok((await call(ANA, "erp_my_scope($1)", [A])).sell_point_ids?.length === 2, "el alcance trae sus puntos de venta");
await raw("update store_users set point_id = null where user_id = $1", [ANA]);
ok((await raw("select sell_point_ids s from store_users where user_id = $1", [ANA]))[0].s.length === 0, "sin punto principal (vende en todos) se limpian los puntos de venta");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
