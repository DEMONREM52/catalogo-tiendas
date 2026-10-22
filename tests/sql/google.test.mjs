// Pruebas de 20261232: verificación de Google y qué tan lista está la tienda para Google.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create table if not exists public.store_profiles (store_id uuid primary key, headline text, address text, city text);
alter table public.stores add column if not exists catalog_retail boolean default true;
alter table public.store_catalogs add column if not exists slug text;
alter table public.store_catalogs add column if not exists active boolean default true;
alter table public.store_catalogs add column if not exists access_key text;
alter table public.store_catalogs add column if not exists address text;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
grant usage on schema public to anon;
`;
const combined = path.join(os.tmpdir(), `remhub_go_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261232_google.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(role, uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as("authenticated", u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as("authenticated", u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `ce900000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), OTHER = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id, active, catalog_retail, logo_url) values ('vitrina', 'LA VITRINA', $1, true, true, 'https://x.co/l.png') returning id", [OWNER]);
await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1)", [OTHER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, SELLER]);
await raw("insert into store_profiles (store_id, headline, city) values ($1, 'Hogar y tecnología', 'Bucaramanga')", [A]);

console.log("Código de verificación");
const TAG = '<meta name="google-site-verification" content="AbC123_xyz-9876543210" />';
let r = await one(OWNER, "select public.store_seo_save($1, $2, '') r", [A, TAG]);
ok(r?.ok && r.google === "AbC123_xyz-9876543210" && r.bing === null, "Pegar la etiqueta completa de Google guarda solo el código", r);
r = await one(OWNER, "select public.store_seo_get($1) r", [A]);
ok(r.ok && r.google === "AbC123_xyz-9876543210", "El panel lo vuelve a mostrar", r);
ok(/no se ve bien/.test(await err(OWNER, "select public.store_seo_save($1, 'hola <script>', null)", [A]) ?? ""), "Un código raro se rechaza");
ok(/permiso/.test(await err(SELLER, "select public.store_seo_save($1, 'AbC123_xyz-0000000000', null)", [A]) ?? ""), "Un vendedor sin «Mi tienda» no lo cambia");
ok((await one(SELLER, "select public.store_seo_get($1) r", [A])).ok === false, "   ni lo ve");
ok(/permiso/.test(await err(OTHER, "select public.store_seo_save($1, 'AbC123_xyz-0000000000', null)", [A]) ?? ""), "Otra tienda no lo cambia");
const pub = (await as("anon", null, "select public.store_public_verification('VITRINA') r"))[0].r;
ok(pub?.google === "AbC123_xyz-9876543210", "La página pública lo lee sin sesión (para ponerlo en el HTML)", pub);
const denied = await (async () => { try { await as("anon", null, "select * from public.store_seo_settings"); return false; } catch { return true; } })();
ok(denied, "La tabla no se lee directo sin sesión");
r = await one(OWNER, "select public.store_seo_save($1, '', null) r", [A]);
ok(r.ok && (await as("anon", null, "select public.store_public_verification('vitrina') r"))[0].r?.google === null, "Borrar el código lo quita de las páginas");
await one(OWNER, "select public.store_seo_save($1, 'AbC123_xyz-9876543210', null) r", [A]);

console.log("Lista para Google");
await raw(`insert into products (store_id, name, description, image_url, stock, active) values
  ($1, 'Zapatero de madera 4 niveles', 'Para 12 pares', 'https://x.co/z.png', 5, true),
  ($1, 'ZAP-04', null, null, 3, true),
  ($1, 'Silla', null, 'https://x.co/s.png', null, true),
  ($1, 'Mesa auxiliar redonda', null, 'https://x.co/m.png', 2, true),
  ($1, 'AGOTADO-1', null, null, 0, true),
  ($1, 'INACTIVO-1', null, null, 5, false)`, [A]);
const [{ id: W }] = await raw("insert into erp_warehouses (store_id, code, name) values ($1, 'ZAM', 'Zamora') returning id", [A]);
await raw("insert into store_catalogs (store_id, name, slug, point_id, active) values ($1, 'La Vitrina Zamora', 'zamora', $2, true)", [A, W]);
r = await one(OWNER, "select public.store_seo_health($1) r", [A]);
ok(r?.ok && r.counts.published === 4, "Cuenta solo productos publicados (activos y con existencias)", r?.counts);
ok(r.counts.good === 1 && r.counts.no_photo === 1 && r.counts.code_name === 1 && r.counts.short_name === 1 && r.counts.no_description === 3, "Cuenta cada problema", r.counts);
ok(r.products[0].name === "ZAP-04" && r.products[0].issues.length === 3, "Primero el que tiene más problemas", r.products[0]);
ok(!r.products.some((p) => p.name === "Zapatero de madera 4 niveles"), "El que está bien no sale en la lista");
ok(r.store.logo && r.store.city && r.store.headline && !r.store.address && r.verification, "Datos del negocio y verificación", r.store);
ok(r.points.length === 1 && r.points[0].slug === "zamora" && r.points[0].has_address === false, "Avisa del punto sin dirección", r.points);
ok((await one(SELLER, "select public.store_seo_health($1) r", [A])).ok === false, "Un vendedor sin «Mi tienda» no lo ve");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
