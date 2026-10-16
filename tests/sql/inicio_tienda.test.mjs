// Pruebas de 20261130: página de inicio de cada tienda y un dominio por catálogo.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Como en producción (20261014): columnas de catálogos de la tienda y catálogos de campaña.
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
`;
const combined = path.join(os.tmpdir(), `remhub_inicio_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  ...["20261129_dominios_tiendas.sql", "20261130_inicio_tienda.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
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

const OWNER = "ce000000-0000-0000-0000-000000000001", VEND = "ce000000-0000-0000-0000-000000000002";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id, catalog_wholesale, wholesale_key) values ('mitienda', 'MI TIENDA', $1, true, 'secreta') returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, VEND]);
await raw(`insert into store_catalogs (store_id, slug, name, access_key, active, sort_order) values
  ($1, 'navidad', 'Navidad', null, true, 1), ($1, 'vip', 'Clientes VIP', 'clave', true, 2), ($1, 'viejo', 'Viejo', null, false, 3)`, [A]);

const pub = async (fn, arg) => (await as(null, `select public.${fn}($1) r`, [arg], "anon"))[0].r;
ok(await pub("store_home_target", "mitienda") === "detal", "Por defecto la tienda abre su catálogo detal");
const home = await pub("store_public_home", "MiTienda");
const slugs = home.catalogs.map((c) => c.slug);
ok(slugs.includes("detal") && slugs.includes("navidad"), "La vitrina muestra los catálogos públicos", slugs);
ok(!slugs.includes("vip") && !slugs.includes("viejo") && !slugs.includes("mayor"), "Nunca los privados (con clave), inactivos ni el mayorista con clave", slugs);

ok(/Mi tienda/.test((await err(VEND, "select public.store_site_save($1, 'navidad')", [A])) ?? ""), "Sin «Mi tienda» no cambia el inicio");
ok(/no es público/.test((await err(OWNER, "select public.store_site_save($1, 'vip')", [A])) ?? ""), "No puede poner de inicio un catálogo privado");
await as(OWNER, "select public.store_site_save($1, 'navidad')", [A]);
ok(await pub("store_home_target", "mitienda") === "navidad", "Ahora mitienda.remhub.co abre la campaña de Navidad");
await as(OWNER, "select public.store_site_save($1, 'inicio')", [A]);
ok(await pub("store_home_target", "mitienda") === "inicio", "…o la vitrina con todos sus catálogos");
const panel = (await as(OWNER, "select public.store_site_get($1) r", [A]))[0].r;
ok(panel.ok && panel.home_target === "inicio" && panel.catalogs.length === 2, "El panel muestra el inicio y los catálogos para escoger", panel);

await as(OWNER, "select public.store_domain_add($1, 'navidad.mitienda.com', 'detal')", [A]);
await as(OWNER, "select public.store_domain_set_target($1, 'navidad.mitienda.com', 'navidad')", [A]);
ok((await pub("store_domain_resolve", "navidad.mitienda.com")).target === "navidad", "Un dominio puede abrir un catálogo distinto");
ok(/no es público/.test((await err(OWNER, "select public.store_domain_set_target($1, 'navidad.mitienda.com', 'vip')", [A])) ?? ""), "…pero no uno privado");
await raw("update stores set active = false where id = $1", [A]);
ok(await pub("store_public_home", "mitienda") === null, "Tienda suspendida: no muestra vitrina");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
