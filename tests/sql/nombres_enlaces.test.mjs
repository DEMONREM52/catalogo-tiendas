// Pruebas de 20261201: nombre de tienda con historial (los enlaces viejos siguen funcionando) y enlaces cortos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Como en producción (20261014 y 20261027): columnas de catálogos y admin de RemHub.
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
create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin');
$$;
grant execute on function public.erp_is_platform_admin() to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_nombres_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  ...["20261129_dominios_tiendas.sql", "20261130_inicio_tienda.sql", "20261201_nombres_enlaces_cortos.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
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
const rawErr = async (s, p) => { try { await raw(s, p); return null; } catch (e) { return e.message; } };

const OWNER = "ce100000-0000-0000-0000-000000000001", VEND = "ce100000-0000-0000-0000-000000000002";
const ADMIN = "ce100000-0000-0000-0000-000000000003", OTRO = "ce100000-0000-0000-0000-000000000004";
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('lavitrina', 'LA VITRINA', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('otratienda', 'OTRA', $1) returning id", [OTRO]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos,products}')", [A, VEND]);
await raw(`insert into store_catalogs (store_id, slug, name, active, sort_order) values ($1, 'la-vitrina-mellos-barber-sede-zamora', 'Zamora', true, 1)`, [A]);

const pub = async (fn, ...args) => (await as(null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args, "anon"))[0].r;
let info = await pub("store_host_info", "lavitrina");
ok(info.slug === "lavitrina" && info.target === "detal" && Object.keys(info.links).length === 0, "La tienda abre su inicio y aún no tiene enlaces cortos", info);

// Nombre de la tienda.
ok(/Mi tienda/.test((await err(VEND, "select public.store_slug_change($1, 'vitrina-nueva')", [A])) ?? ""), "Sin «Mi tienda» no se cambia el nombre");
ok(/minúsculas/.test((await err(OWNER, "select public.store_slug_change($1, 'la.vitrina')", [A])) ?? ""), "Nombres con punto no sirven de subdominio");
ok(/reservado/.test((await err(OWNER, "select public.store_slug_change($1, 'dashboard')", [A])) ?? ""), "Nombres del sistema están reservados");
ok(/otra tienda/.test((await err(OWNER, "select public.store_slug_change($1, 'otratienda')", [A])) ?? ""), "No se puede usar el nombre de otra tienda");
const chk = (await as(OWNER, "select public.store_slug_check($1, 'vitrina-zamora') r", [A]))[0].r;
ok(chk.ok === true, "El panel avisa que el nombre está libre", chk);
await as(OWNER, "select public.store_slug_change($1, 'Vitrina-Zamora')", [A]);
ok((await raw("select slug from stores where id = $1", [A]))[0].slug === "vitrina-zamora", "El dueño cambia el nombre (queda en minúsculas)");
ok((await pub("store_host_info", "lavitrina")).moved_to === "vitrina-zamora", "lavitrina.remhub.co lleva solo al nombre nuevo");
ok(/usó otra tienda/.test((await err(OTRO, "select public.store_slug_change($1, 'lavitrina')", [B])) ?? ""), "Nadie más puede quedarse con el nombre viejo");
ok(/usó otra tienda/.test((await rawErr("insert into stores (slug, name, owner_id) values ('lavitrina', 'X', $1)", [OTRO])) ?? ""), "…ni al crear una tienda nueva");
await as(ADMIN, "select public.store_slug_change($1, 'lavitrina')", [A]);
info = await pub("store_host_info", "vitrina-zamora");
ok((await raw("select slug from stores where id = $1", [A]))[0].slug === "lavitrina" && info.moved_to === "lavitrina", "El admin de RemHub lo cambia; volver al nombre de antes funciona y el intermedio redirige", info);
ok((await pub("store_host_info", "lavitrina")).slug === "lavitrina", "El nombre recuperado vuelve a ser la tienda (no una redirección)");
const panel = (await as(OWNER, "select public.store_links_get($1) r", [A]))[0].r;
ok(panel.ok && panel.history.map((h) => h.slug).join() === "vitrina-zamora" && panel.can_rename, "El panel muestra los nombres viejos que siguen redirigiendo", panel.history);
await raw("update stores set active = false where id = $1", [A]);
ok(await pub("store_host_info", "vitrina-zamora") === null && await pub("store_host_info", "lavitrina") === null, "Tienda suspendida: ni la dirección ni los nombres viejos abren");
await raw("update stores set active = true where id = $1", [A]);

// Enlaces cortos.
ok(/Productos/.test((await err(OTRO, "select public.store_short_link_save($1, null, 'z', '/zamora')", [A])) ?? ""), "Alguien de otra tienda no crea enlaces aquí");
const [{ r: z }] = await as(VEND, "select public.store_short_link_save($1, null, 'Z', 'la-vitrina-mellos-barber-sede-zamora') r", [A]);
ok(z.ok, "Con «Productos» se crea /z (el destino se completa con /)");
info = await pub("store_host_info", "lavitrina");
ok(info.links.z === "/la-vitrina-mellos-barber-sede-zamora", "lavitrina.remhub.co/z lleva al catálogo de Zamora", info.links);
ok(/reservado/.test((await err(OWNER, "select public.store_short_link_save($1, null, 'detal', '/x')", [A])) ?? ""), "No se puede tapar /detal, /producto…");
ok(/catálogo con ese nombre/.test((await err(OWNER, "select public.store_short_link_save($1, null, 'la-vitrina-mellos-barber-sede-zamora', '/x')", [A])) ?? ""), "Ni un catálogo que ya existe");
ok(/página de tu tienda/.test((await err(OWNER, "select public.store_short_link_save($1, null, 'fuera', 'https://otro.com')", [A])) ?? ""), "Solo lleva a páginas de la tienda (nunca a otro sitio)");
ok(/sí mismo/.test((await err(OWNER, "select public.store_short_link_save($1, null, 'bucle', '/bucle')", [A])) ?? ""), "Un enlace no puede llevar a sí mismo");

// Renombrar el catálogo largo a «zamora».
await raw("insert into store_site (store_id, home_target) values ($1, 'la-vitrina-mellos-barber-sede-zamora')", [A]);
await raw("update store_catalogs set slug = 'zamora' where store_id = $1", [A]);
info = await pub("store_host_info", "lavitrina");
ok(info.links["la-vitrina-mellos-barber-sede-zamora"] === "/zamora", "El enlace largo viejo lleva a /zamora", info.links);
ok(info.links.z === "/zamora", "/z se actualiza solo al nombre nuevo", info.links);
ok(info.target === "zamora", "El inicio que usaba el catálogo se actualiza solo", info.target);
await raw("insert into store_catalogs (store_id, slug, name) values ($1, 'z', 'Catálogo Z')", [A]);
ok(!("z" in (await pub("store_host_info", "lavitrina")).links), "Si después se crea un catálogo /z, el catálogo manda");

await pub("store_short_link_hit", "LaVitrina", "la-vitrina-mellos-barber-sede-zamora");
const links = (await as(OWNER, "select public.store_links_get($1) r", [A]))[0].r.links;
ok(links.find((l) => l.code === "la-vitrina-mellos-barber-sede-zamora")?.hits === 1, "Se cuentan las visitas de cada enlace", links);
const del = links.find((l) => l.code === "la-vitrina-mellos-barber-sede-zamora");
await as(OWNER, "select public.store_short_link_delete($1, $2)", [A, del.id]);
ok(!("la-vitrina-mellos-barber-sede-zamora" in (await pub("store_host_info", "lavitrina")).links), "Se puede borrar un enlace");
ok(/no es de tu tienda/.test((await err(OTRO, "select public.store_short_link_delete($1, $2)", [B, links[0].id])) ?? ""), "Otra tienda no borra enlaces ajenos");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
