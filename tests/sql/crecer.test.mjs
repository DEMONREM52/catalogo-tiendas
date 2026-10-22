// Pruebas de 20261227: datos para Google y videos de ayuda.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create table if not exists public.store_profiles (store_id uuid primary key, headline text, address text, city text);
alter table public.products add column if not exists category_id uuid;
alter table public.stores add column if not exists logo_url text;
alter table public.stores add column if not exists catalog_retail boolean default true;
alter table public.stores add column if not exists active boolean default true;
alter table public.stores add column if not exists whatsapp text;
create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'); $$;
grant execute on function public.erp_is_platform_admin() to authenticated;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
grant usage on schema public to anon;
`;
const combined = path.join(os.tmpdir(), `remhub_cr_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261227_crecer.sql"), "utf8");
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
const U = (n) => `ce800000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ADMIN = U(2);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id, active, catalog_retail) values ('vitrina', 'LA VITRINA', $1, true, true) returning id", [OWNER]);
await raw("insert into stores (slug, name, owner_id, active, catalog_retail) values ('apagada', 'APAGADA', $1, false, true)", [OWNER]);
await raw("insert into store_profiles (store_id, headline, city, address) values ($1, 'Tecnología y hogar al mejor precio', 'Bucaramanga', 'Cra 51 #45-75')", [A]);
const [{ id: C }] = await raw("insert into product_categories (store_id, name) values ($1, 'AUDIO') returning id", [A]);
await raw("insert into products (store_id, name, category_id, image_url, price_3, cost_price, stock) values ($1, 'PARLANTE', $2, 'https://x/p.jpg', 50000, 30000, 7), ($1, 'SIN FOTO', $2, null, 1000, 500, 1)", [A, C]);

let r = (await as("anon", null, "select public.store_public_seo('VITRINA') r"))[0].r;
ok(r && r.city === "Bucaramanga" && r.headline && r.categories[0] === "AUDIO" && r.count === 2, "Cualquiera (sin sesión) obtiene ciudad, frase y categorías", r);
ok(r.products.length === 1 && r.products[0].name === "PARLANTE" && !("cost" in r.products[0]) && !("stock" in r.products[0]), "Solo productos con foto y sin costo ni existencias", r.products);
ok((await as("anon", null, "select public.store_public_seo('apagada') r"))[0].r === null, "Una tienda apagada no entrega nada");

console.log("Videos de ayuda");
r = (await as("authenticated", OWNER, "select public.saas_admin_help_video_save('pos', 'Cómo vender', 'https://youtu.be/abc') r"))[0].r;
ok(r.ok === false, "Un dueño de tienda no puede cargar videos", r);
r = (await as("authenticated", ADMIN, "select public.saas_admin_help_video_save('pos', 'Cómo vender', 'https://youtu.be/abc') r"))[0].r;
ok(r.ok, "El administrador de RemHub carga el video del POS", r);
ok((await as("authenticated", ADMIN, "select public.saas_admin_help_video_save('pos', 'x', 'http://inseguro') r"))[0].r.ok === false, "Solo enlaces https");
const vids = await as("authenticated", OWNER, "select screen, url from saas_help_videos");
ok(vids.length === 1 && vids[0].url === "https://youtu.be/abc", "Cualquier usuario con sesión lo ve en el botón «?»", vids);
await as("authenticated", ADMIN, "select public.saas_admin_help_video_save('pos', '', '') r");
ok((await raw("select count(*)::int n from saas_help_videos"))[0].n === 0, "Dejar el enlace vacío lo quita");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
