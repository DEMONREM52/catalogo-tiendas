// Pruebas de 20261319 (POS fino: crédito, apartados, cotizaciones y ventas de otros vendedores).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Funciones con la misma revisión de permiso que las de producción.
const extra = `
create table if not exists public.erp_role_templates (id uuid primary key default gen_random_uuid(), store_id uuid, name text, permissions text[] not null default '{}');
create or replace function public.erp__known_permissions() returns text[] language sql immutable as $f$ select array['pos','credit','orders','perm_v2']::text[] $f$;
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_perms) x where public.erp_can(p_store, x)) $$;
create or replace function public.erp_credit_register(p_store uuid, p_token text, p_customer uuid, p_days integer default null, p_override boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if not public.erp_can(p_store, 'pos') then raise exception 'No tienes permiso para facturar.'; end if;
  return jsonb_build_object('ok', true);
end $f$;
create or replace function public.erp_pos_documents(p_store uuid, p_point uuid, p_query text, p_limit integer default 30)
returns table(order_id uuid, doc_number text) language sql stable security definer set search_path = public as $f$
  with params as (select p_point as pt)
  select o.id, m.doc_number
  from params, public.erp_order_meta m
  join public.orders o on o.id = m.order_id
  where public.erp_can(p_store, 'pos')
    and params.pt is not null
    and m.store_id = p_store
    and m.point_id = params.pt
  order by o.created_at desc $f$;
create or replace function public.erp_layaway_create(p_store uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso de POS.'); end if;
  return jsonb_build_object('ok', true);
end $f$;
create or replace function public.erp_layaways_list(p_store uuid, p_status text default 'open') returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'pos') then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso de POS.'); end if;
  return jsonb_build_object('ok', true);
end $f$;
create or replace function public.erp_quote_save(p_store uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'pos') or public.erp_can(p_store, 'orders')) then return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso de POS.'); end if;
  return jsonb_build_object('ok', true);
end $f$;
create or replace function public.erp_quote_public(p_token text) returns jsonb language sql security definer set search_path = public as $f$ select '{}'::jsonb $f$;
grant execute on function public.erp_credit_register(uuid, text, uuid, integer, boolean), public.erp_pos_documents(uuid, uuid, text, integer),
  public.erp_layaway_create(uuid, jsonb), public.erp_layaways_list(uuid, text), public.erp_quote_save(uuid, jsonb) to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_posf_${process.pid}.sql`);
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

const U = (n) => `c3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANA = U(2), LUIS = U(3), PEDIDOS = U(4), CARTERA = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('t', 'Tienda', $1) returning id", [OWNER]);
await raw(`insert into store_users (store_id, user_id, role, permissions) values
  ($1, $2, 'seller', '{pos,perm_v2}'), ($1, $3, 'seller', '{pos,perm_v2}'), ($1, $4, 'seller', '{orders,perm_v2}'), ($1, $5, 'seller', '{pos,credit,perm_v2}')`, [A, ANA, LUIS, PEDIDOS, CARTERA]);
await raw("insert into erp_role_templates (store_id, name, permissions) values ($1, 'Vendedor', '{pos,clients}'), ($1, 'Bodega', '{inventory}')", [A]);
const [{ id: P }] = await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, 'C', 'Centro', 'point') returning id", [A]);
const sale = async (seller, n) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, customer_name) values ($1, $2, 1, 'confirmed', 'C') returning id", [A, `t${n}`]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, seller_id, created_by, doc_kind, doc_number) values ($1, $2, $3, $4, $4, 'remision', $5)", [id, A, P, seller, `R-${n}`]);
  return id;
};
const SA = await sale(ANA, 1), SL = await sale(LUIS, 2);

const sql = fs.readFileSync(path.join(MIG, "20261319_pos_fino.sql"), "utf8");
await db.exec(sql); await db.exec(sql);

console.log("1. Nadie pierde nada");
const perms = async (u) => (await raw("select permissions p from store_users where user_id = $1", [u]))[0].p;
const pa = await perms(ANA);
ok(["pos_credit", "pos_layaways", "pos_quotes", "pos_all_sales", "perm_pos2"].every((x) => pa.includes(x)), "quien tenía POS recibe los cuatro y la marca", pa);
const pp = await perms(PEDIDOS);
ok(!pp.includes("pos_credit") && pp.includes("perm_pos2"), "quien no tenía POS solo recibe la marca", pp);
const tpl = await raw("select name, permissions p from erp_role_templates where store_id = $1 order by name", [A]);
ok(tpl[1].p.includes("pos_quotes") && !tpl[0].p.includes("pos_quotes"), "las plantillas con POS también", tpl);
ok((await raw("select public.erp__known_permissions() k"))[0].k.includes("pos_all_sales"), "la base reconoce los permisos nuevos");
ok((await call(ANA, "erp_credit_register($1, 'x', null)", [A])).ok, "Ana sigue vendiendo a crédito");
ok((await call(ANA, "erp_layaway_create($1, '{}')", [A])).ok, "y apartando");
ok((await call(ANA, "erp_quote_save($1, '{}')", [A])).ok, "y cotizando");
ok((await as(ANA, "select * from public.erp_pos_documents($1, $2, '')", [A, P])).length === 2, "y ve las ventas de todos");

// Se le quitan a Luis uno por uno (lo que haría la pantalla de usuarios).
await raw("update store_users set permissions = '{pos,perm_v2,perm_pos2}' where user_id = $1", [LUIS]);
await db.exec(sql);
ok((await perms(LUIS)).join() === "pos,perm_v2,perm_pos2", "correr otra vez no le devuelve lo quitado");

console.log("2. Cada permiso se exige");
ok(/vender a crédito/.test(await callErr(LUIS, "erp_credit_register($1, 'x', null)", [A]) ?? ""), "sin «Vender a crédito» no registra el crédito");
ok((await call(CARTERA, "erp_credit_register($1, 'x', null)", [A])).ok === true, "«Créditos y cupos» también sirve");
await raw("update store_users set permissions = '{pos,credit,perm_v2,perm_pos2}' where user_id = $1", [CARTERA]);
ok((await call(CARTERA, "erp_credit_register($1, 'x', null)", [A])).ok === true, "…aunque no tenga «Vender a crédito»");
ok((await call(LUIS, "erp_layaway_create($1, '{}')", [A])).ok === false, "sin «Apartados» no aparta");
ok((await call(LUIS, "erp_layaways_list($1)", [A])).ok === false, "ni ve la lista de apartados");
ok((await call(LUIS, "erp_quote_save($1, '{}')", [A])).ok === false, "sin «Cotizaciones» no cotiza");
ok((await call(PEDIDOS, "erp_quote_save($1, '{}')", [A])).ok === true, "«Pedidos» sigue pudiendo cotizar");
const docs = await as(LUIS, "select * from public.erp_pos_documents($1, $2, '')", [A, P]);
ok(docs.length === 1 && docs[0].order_id === SL, "sin «Ver ventas de otros» solo ve las suyas", docs);
ok((await as(OWNER, "select * from public.erp_pos_documents($1, $2, '')", [A, P])).length === 2, "el dueño ve todas");
ok(!!SA, "(venta de Ana creada)");
const [{ d }] = await raw("select pg_get_functiondef('public.erp_quote_public(text)'::regprocedure) d");
ok(!/pos_quotes/.test(d), "la cotización pública (enlace del cliente) no se toca");
const [{ d: d2 }] = await raw("select pg_get_functiondef('public.erp_layaway_create(uuid,jsonb)'::regprocedure) d");
ok((d2.match(/pos_layaways/g) ?? []).length === 1, "dos corridas no repiten la revisión");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
