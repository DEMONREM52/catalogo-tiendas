// Pruebas de 20261316 (Catálogos y Landing sin necesitar «Editar productos»).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Funciones con la misma forma de revisar el permiso que las de producción, y las reglas originales.
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_perms) x where public.erp_can(p_store, x)) $$;
create or replace function public.store_user_has_permission(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_can_any(p_store, p_perms) $$;
create or replace function public.erp_catalog_visible(p_store uuid, p_point uuid) returns boolean language sql stable as $$ select true $$;
create or replace function public.catalog_admin_bulk(p_catalog uuid) returns integer language plpgsql security definer set search_path = public as $f$
declare c public.store_catalogs;
begin
  select * into c from public.store_catalogs where id = p_catalog;
  if not public.erp_can(c.store_id, 'products') then raise exception 'Necesitas el permiso de Productos.'; end if;
  return 1;
end; $f$;
create or replace function public.catalog_admin_summary(p_store uuid) returns integer language plpgsql stable security definer set search_path = public as $f$
begin
  if not (public.erp_can(p_store, 'products') or public.erp_can(p_store, 'audit')) then raise exception 'Necesitas el permiso de Productos.'; end if;
  return 1;
end; $f$;
create or replace function public.erp_landing_stats(p_store uuid) returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if not public.erp_can(p_store, 'products') then raise exception 'Sin permiso'; end if;
  return jsonb_build_object('cost', public.erp_can(p_store, 'costs_view'));
end; $f$;
create or replace function public.can_manage_store_social(p_store uuid) returns boolean language sql stable security definer set search_path = public as $f$
  select public.store_user_has_permission(p_store, '{products}'::text[]) $f$;
create or replace function public.erp_landing_orders_list(p_store uuid) returns integer language plpgsql security definer set search_path = public as $f$
begin
  if not public.erp_can(p_store, 'orders') then raise exception 'Sin permiso'; end if;
  return 1;
end; $f$;
grant execute on function public.catalog_admin_bulk(uuid), public.catalog_admin_summary(uuid), public.erp_landing_stats(uuid),
  public.can_manage_store_social(uuid), public.erp_landing_orders_list(uuid) to authenticated;
alter table public.store_catalogs enable row level security;
alter table public.store_catalog_categories enable row level security;
grant select, insert, update, delete on public.store_catalogs, public.store_catalog_categories to authenticated;
create policy store_catalogs_read on public.store_catalogs for select using ((erp_can(store_id, 'products') or erp_can(store_id, 'audit') or erp_can(store_id, 'orders')) and erp_catalog_visible(store_id, point_id));
create policy store_catalogs_write on public.store_catalogs for all using (erp_can(store_id, 'products') and erp_catalog_visible(store_id, point_id)) with check (erp_can(store_id, 'products') and erp_catalog_visible(store_id, point_id));
`;
const combined = path.join(os.tmpdir(), `remhub_cat_land_${process.pid}.sql`);
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
const tryAs = async (u, s, p) => { try { return await as(u, s, p); } catch (e) { return { error: e.message }; } };

const U = (n) => `f0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PROD = U(2), CAT = U(3), LAND = U(4), NADA = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('t', 'Tienda', $1) returning id", [OWNER]);
await raw(`insert into store_users (store_id, user_id, role, permissions) values
  ($1,$2,'seller','{products,perm_v2}'), ($1,$3,'seller','{catalogs,perm_v2}'), ($1,$4,'seller','{landing,perm_v2}'), ($1,$5,'seller','{pos,perm_v2}')`, [A, PROD, CAT, LAND, NADA]);
const [{ id: C }] = await raw("insert into store_catalogs (store_id, name) values ($1, 'Detal') returning id", [A]);

console.log("0. Antes de la migración");
ok((await tryAs(CAT, "select public.catalog_admin_bulk($1) r", [C])).error, "con solo «Catálogos» no podía");

const sql = fs.readFileSync(path.join(MIG, "20261316_catalogos_landing_sin_productos.sql"), "utf8");
await db.exec(sql); await db.exec(sql);

console.log("1. Catálogos");
ok((await tryAs(CAT, "select public.catalog_admin_bulk($1) r", [C]))[0]?.r === 1, "«Catálogos» ya puede editar productos del catálogo");
ok((await tryAs(CAT, "select public.catalog_admin_summary($1) r", [A]))[0]?.r === 1, "«Catálogos» ve el resumen");
ok((await tryAs(PROD, "select public.catalog_admin_bulk($1) r", [C]))[0]?.r === 1, "«Productos» sigue pudiendo");
ok((await tryAs(OWNER, "select public.catalog_admin_bulk($1) r", [C]))[0]?.r === 1, "el dueño sigue pudiendo");
ok((await tryAs(NADA, "select public.catalog_admin_bulk($1) r", [C])).error, "sin permiso sigue sin poder");
ok((await tryAs(LAND, "select public.catalog_admin_bulk($1) r", [C])).error, "«Landing» no edita catálogos");
ok((await as(CAT, "select count(*)::int n from store_catalogs"))[0].n === 1, "«Catálogos» lee la tabla de catálogos");
ok((await as(LAND, "select count(*)::int n from store_catalogs"))[0].n === 1, "«Landing» lee los catálogos (para escoger uno)");
ok((await as(NADA, "select count(*)::int n from store_catalogs"))[0].n === 0, "sin permiso no ve catálogos");
const up = await tryAs(CAT, "update store_catalogs set name = 'Nuevo' where id = $1 returning name", [C]);
ok(up[0]?.name === "Nuevo", "«Catálogos» puede editar un catálogo", up);
const upL = await tryAs(LAND, "update store_catalogs set name = 'X' where id = $1 returning name", [C]);
ok(Array.isArray(upL) && upL.length === 0, "«Landing» no puede editar catálogos", upL);
ok((await as(CAT, "select public.can_manage_store_social($1) r", [A]))[0].r === true, "redes y campañas: «Catálogos» puede");
ok((await as(NADA, "select public.can_manage_store_social($1) r", [A]))[0].r === false, "redes y campañas: sin permiso no");

console.log("2. Landing");
const st = await tryAs(LAND, "select public.erp_landing_stats($1) r", [A]);
ok(st[0]?.r?.cost === false, "«Landing» ve sus estadísticas (sin costos)", st);
ok((await tryAs(CAT, "select public.erp_landing_stats($1) r", [A])).error, "«Catálogos» no entra a landings");
ok((await tryAs(PROD, "select public.erp_landing_stats($1) r", [A]))[0]?.r, "«Productos» sigue entrando a landings");
ok((await tryAs(LAND, "select public.erp_landing_orders_list($1) r", [A])).error, "los pedidos de landing siguen pidiendo «Pedidos»");
const [{ d }] = await raw("select pg_get_functiondef('public.erp_landing_stats(uuid)'::regprocedure) d");
ok(/erp_can\(p_store, 'costs_view'\)/.test(d), "la revisión de costos no se toca");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
