// Pruebas de 20261202: catálogos por punto, enlaces con fecha y origen, vitrina por puntos, tienda pausada y tablero del admin.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Como en producción: columnas de catálogos (20261014), admin de RemHub (20261027), RLS de catálogos y una función del panel.
const extra = `
alter table public.stores add column if not exists catalog_retail boolean default true;
alter table public.stores add column if not exists catalog_wholesale boolean default false;
alter table public.stores add column if not exists wholesale_key text;
alter table public.store_catalogs add column if not exists slug text;
alter table public.store_catalogs add column if not exists headline text;
alter table public.store_catalogs add column if not exists logo_url text;
alter table public.store_catalogs add column if not exists access_key text;
alter table public.store_catalogs add column if not exists active boolean not null default true;
alter table public.store_catalogs add column if not exists sort_order integer not null default 0;
alter table public.store_catalogs add column if not exists city text;
alter table public.store_catalogs add column if not exists address text;
alter table public.store_catalogs add column if not exists whatsapp text;
create table if not exists public.store_catalog_products (catalog_id uuid not null, store_id uuid not null, product_id uuid not null, primary key (catalog_id, product_id));
create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin');
$$;
grant execute on function public.erp_is_platform_admin() to authenticated;
alter table public.store_catalogs enable row level security;
drop policy if exists cat_members on public.store_catalogs;
create policy cat_members on public.store_catalogs for all to authenticated using (public.erp_can(store_id, 'products')) with check (public.erp_can(store_id, 'products'));
alter table public.store_catalog_products enable row level security;
drop policy if exists catp_members on public.store_catalog_products;
create policy catp_members on public.store_catalog_products for all to authenticated using (public.erp_can(store_id, 'products')) with check (public.erp_can(store_id, 'products'));
create or replace function public.catalog_admin_bulk(p_catalog uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare n int := 0;
begin
  update public.store_catalogs set headline = p_rows->>'headline' where id = p_catalog;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;
grant execute on function public.catalog_admin_bulk(uuid, jsonb) to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_espacio_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  ...["20261129_dominios_tiendas.sql", "20261130_inicio_tienda.sql", "20261201_nombres_enlaces_cortos.sql", "20261202_espacio_tienda.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p, role = "authenticated") {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const OWNER = "ce200000-0000-0000-0000-000000000001", ZAM = "ce200000-0000-0000-0000-000000000002";
const MADRE = "ce200000-0000-0000-0000-000000000003", ADMIN = "ce200000-0000-0000-0000-000000000004";
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
await raw("insert into auth.users (id, email) values ($1, 'duena@lavitrina.co')", [OWNER]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('lavitrina', 'LA VITRINA', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CISNEROS', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{pos,products}', $3)", [A, ZAM, Z]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{products}')", [A, MADRE]);
const [{ id: CZ }] = await raw("insert into store_catalogs (store_id, slug, name, point_id, city, address, whatsapp, sort_order) values ($1, 'zamora', 'Sede Zamora', $2, 'Zamora', 'Calle 1 # 2-3', '3001112233', 1) returning id", [A, Z]);
const [{ id: CC }] = await raw("insert into store_catalogs (store_id, slug, name, point_id, sort_order) values ($1, 'cisneros', 'Sede Cisneros', $2, 2) returning id", [A, C]);
const [{ id: CN }] = await raw("insert into store_catalogs (store_id, slug, name, sort_order) values ($1, 'navidad', 'Navidad', 3) returning id", [A]);

// Catálogos por punto.
const upd = async (u, id) => (await as(u, "update store_catalogs set headline = 'x' where id = $1 returning id", [id])).length;
ok(await upd(ZAM, CZ) === 1, "El usuario de Zamora edita el catálogo de Zamora");
ok(await upd(ZAM, CC) === 0 && await upd(ZAM, CN) === 0, "…pero no el de Cisneros ni el de la tienda madre");
ok(await upd(MADRE, CC) === 1 && await upd(OWNER, CZ) === 1, "La madre (usuario sin punto y dueña) edita todos");
ok((await as(ZAM, "select count(*)::int n from store_catalogs where store_id = $1", [A]))[0].n === 3, "Ver, puede ver todos");
ok(/row-level security|violates/.test((await err(ZAM, "insert into store_catalogs (store_id, slug, name) values ($1, 'otro', 'Otro')", [A])) ?? ""), "Un punto no crea catálogos de la tienda madre");
ok((await as(ZAM, "insert into store_catalogs (store_id, slug, name, point_id) values ($1, 'zamora-promo', 'Promo Zamora', $2) returning id", [A, Z])).length === 1, "…sí de su punto");
ok((await as(ZAM, "delete from store_catalogs where id = $1 returning id", [CC])).length === 0, "No borra catálogos de otro punto");
const [{ id: P1 }] = await raw("insert into products (store_id, name) values ($1, 'Gorra') returning id", [A]);
ok(/row-level security|violates/.test((await err(ZAM, "insert into store_catalog_products (catalog_id, store_id, product_id) values ($1, $2, $3)", [CC, A, P1])) ?? ""), "No mete productos en el catálogo de otro punto");
ok((await as(ZAM, "insert into store_catalog_products (catalog_id, store_id, product_id) values ($1, $2, $3) returning catalog_id", [CZ, A, P1])).length === 1, "…sí en el suyo");
ok(/otro punto/.test((await err(ZAM, "select public.catalog_admin_bulk($1, '{\"headline\":\"y\"}')", [CC])) ?? ""), "Las funciones del panel (cambios masivos) también respetan el punto");
ok((await as(ZAM, "select public.catalog_admin_bulk($1, '{\"headline\":\"y\"}') r", [CZ]))[0].r.n === 1, "…y siguen funcionando en su catálogo");

// Enlaces cortos por punto.
ok((await as(ZAM, "select public.store_short_link_save($1, null, 'z', '/zamora') r", [A]))[0].r.ok, "Zamora crea /z a su catálogo");
ok(/catálogos de tu punto/.test((await err(ZAM, "select public.store_short_link_save($1, null, 'c', '/cisneros')", [A])) ?? ""), "…pero no a Cisneros");
await as(MADRE, "select public.store_short_link_save($1, null, 'c', '/cisneros')", [A]);
let panel = (await as(ZAM, "select public.store_links_get($1) r", [A]))[0].r;
ok(panel.links.map((l) => l.code).join() === "z" && panel.catalogs.every((c) => c.point_id === Z) && panel.point_scope, "Zamora solo ve sus enlaces y sus catálogos", panel);
const cId = (await as(MADRE, "select public.store_links_get($1) r", [A]))[0].r.links.find((l) => l.code === "c").id;
ok(/otro punto/.test((await err(ZAM, "select public.store_short_link_delete($1, $2)", [A, cId])) ?? ""), "Zamora no borra el enlace de Cisneros");

// Fechas y origen.
await as(OWNER, `select public.store_short_link_save($1, null, 'promo', '/navidad', '{"ends_at":"2000-01-01T00:00:00Z","fallback_target":"/zamora"}')`, [A]);
await as(OWNER, `select public.store_short_link_save($1, null, 'ig', '/zamora', '{"source":"instagram"}')`, [A]);
await as(OWNER, `select public.store_short_link_save($1, null, 'pronto', '/navidad', '{"starts_at":"2999-01-01T00:00:00Z"}')`, [A]);
let info = (await as(null, "select public.store_host_info('lavitrina') r", [], "anon"))[0].r;
ok(info.links.promo === "/zamora", "Un enlace vencido lleva a su destino de respaldo", info.links);
ok(info.links.ig === "/zamora?utm_source=instagram&utm_medium=enlace", "Con origen: se marca de dónde llegó el cliente", info.links.ig);
ok(info.links.pronto === "/", "Antes de su fecha lleva al inicio", info.links.pronto);
ok(/después de la inicial/.test((await err(OWNER, `select public.store_short_link_save($1, null, 'mal', '/navidad', '{"starts_at":"2030-01-02","ends_at":"2030-01-01"}')`, [A])) ?? ""), "Fechas al revés no se aceptan");

// Vitrina por puntos.
const home = (await as(null, "select public.store_public_home('lavitrina') r", [], "anon"))[0].r;
const zc = home.catalogs.find((c) => c.slug === "zamora");
ok(zc?.point?.name === "ZAMORA" && zc.point.city === "Zamora" && zc.point.whatsapp === "3001112233", "La vitrina sabe de qué punto es cada catálogo", zc);
ok(home.catalogs.find((c) => c.slug === "navidad")?.point === null, "Los catálogos de la madre no tienen punto");

// Tienda pausada.
await raw("update stores set active = false where id = $1", [A]);
info = (await as(null, "select public.store_host_info('lavitrina') r", [], "anon"))[0].r;
ok(info.suspended === true && !info.links, "Tienda pausada: el proxy muestra la página de pausa (sin enlaces)", info);
ok((await as(null, "select public.store_public_paused('lavitrina') r", [], "anon"))[0].r?.name === "LA VITRINA", "La página de pausa muestra su nombre");
await raw("update stores set active = true where id = $1", [A]);
ok((await as(null, "select public.store_public_paused('lavitrina') r", [], "anon"))[0].r === null, "Activa: no hay página de pausa");

// Admin de RemHub.
ok(/Solo el admin/.test((await err(OWNER, "select public.admin_store_spaces()")) ?? ""), "El tablero de espacios es solo del admin");
const spaces = (await as(ADMIN, "select public.admin_store_spaces() r"))[0].r;
const sp = spaces.find((s) => s.slug === "lavitrina");
ok(sp && sp.subdomain_ok && sp.owner_email === "duena@lavitrina.co" && sp.links === 5 && sp.catalogs === 4, "El admin ve el espacio de cada tienda", sp);
ok((await as(ADMIN, "select public.store_slug_available('lavitrina') r"))[0].r.ok === false
  && (await as(ADMIN, "select public.store_slug_available('nueva-tienda') r"))[0].r.ok === true, "Al crear una tienda, el admin ve si el nombre está libre");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
