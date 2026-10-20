// Pruebas de 20261212: registro público (cada persona crea su tienda) sobre 20261211.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_reg_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  `create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $f$
     select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin') $f$;
   grant execute on function public.erp_is_platform_admin() to authenticated;
   alter table public.erp_warehouses add column if not exists kind text;
   alter table public.stores add column if not exists catalog_retail boolean, add column if not exists catalog_wholesale boolean;
   create unique index if not exists stores_slug_u on public.stores (lower(slug));
   -- Reglas de nombre (simplificadas; en producción son las de 20261201).
   create or replace function public.store__slug_problem(p_store uuid, p_slug text) returns text language sql stable as $f$
     select case when p_slug !~ '^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])?$' then 'Usa solo letras, números y guiones.'
                 when p_slug in ('admin', 'www', 'api') then 'Ese nombre está reservado.'
                 when exists (select 1 from public.stores s where lower(s.slug) = p_slug and s.id is distinct from p_store) then 'Ese nombre ya lo usa otra tienda.' end $f$;`,
  ...["20261211_saas_planes_suscripciones.sql", "20261212_registro_tiendas.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `7e000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const NEW = U(1), OTHER = U(2), EMPLOYEE = U(3), ADMIN = U(9);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);

ok((await one(NEW, "select public.saas_my_store_status() r")).owned === null, "Recién registrado: todavía sin tienda");
ok(/permission denied/i.test(await err(null, "select public.saas_signup_create_store('X', 'x-store', '3001234567')") ?? ""), "Sin sesión no se crea tienda");
ok((await one(NEW, "select public.saas_signup_create_store('Mi Tienda', 'Admin', '3001234567') r")).reason === "slug", "Un subdominio reservado no se acepta");
ok(/WhatsApp/.test((await one(NEW, "select public.saas_signup_create_store('Mi Tienda', 'mi-tienda', '123') r")).error ?? ""), "El WhatsApp se valida");
const r = await one(NEW, "select public.saas_signup_create_store('Mi Tienda', 'mi-tienda', '300 123 4567', true) r");
const [st] = await raw("select owner_id, name, whatsapp from stores where id = $1", [r.store_id]);
const ent = await one(NEW, "select public.saas_entitlements($1) r", [r.store_id]);
const [{ n: wh }] = await raw("select count(*)::int n from erp_warehouses where store_id = $1", [r.store_id]);
ok(r.ok && st.owner_id === NEW && st.name === "MI TIENDA" && st.whatsapp === "573001234567", "Crea la tienda con quien llama como dueño", { r, st });
ok(wh === 1, "Queda con su bodega principal", wh);
ok(ent.status === "trialing" && ent.plan.id === "negocio", "Pidió la prueba: queda probando Negocio", ent.status);
ok((await one(NEW, "select public.saas_signup_create_store('Otra', 'otra-tienda', '3001234567') r")).reason === "has_store", "Una sola tienda por cuenta");
ok((await one(OTHER, "select public.saas_signup_create_store('Copia', 'mi-tienda', '3001234567') r")).reason === "slug", "No puede tomar un subdominio ocupado");
const r2 = await one(OTHER, "select public.saas_signup_create_store('Sin prueba', 'sin-prueba', '3001234567', false) r");
ok(r2.ok && (await one(OTHER, "select public.saas_entitlements($1) r", [r2.store_id])).status === "free", "Sin pedir prueba queda en Gratis");
await raw("insert into store_users (store_id, user_id, role) values ($1, $2, 'seller')", [r.store_id, EMPLOYEE]);
ok((await one(EMPLOYEE, "select public.saas_signup_create_store('Mía', 'mia', '3001234567') r")).reason === "is_member", "Un empleado no crea otra tienda con la misma cuenta");
ok((await one(ADMIN, "select public.saas_signup_create_store('Admin', 'adm-x', '3001234567') r")).ok === false, "El admin de RemHub no usa el registro");
const s = await one(NEW, "select public.saas_my_store_status() r");
ok(s.owned?.slug === "mi-tienda", "Después del registro ve su tienda", s);

console.log("Crecimiento");
await db.exec(fs.readFileSync(path.join(MIG, "20261215_crecimiento.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(MIG, "20261215_crecimiento.sql"), "utf8"));
const FRIEND = U(4);
const rf = await one(FRIEND, "select public.saas_signup_create_store('Amiga', 'amiga', '3001234567') r");
ok((await one(FRIEND, "select public.saas_set_referrer($1, 'amiga') r", [rf.store_id])).ok === false, "No se puede referir a sí misma");
ok((await one(FRIEND, "select public.saas_set_referrer($1, 'mi-tienda') r", [rf.store_id])).result === "linked", "Queda referida por la tienda que la invitó");
ok((await one(FRIEND, "select public.saas_set_referrer($1, 'sin-prueba') r", [rf.store_id])).result === "already", "Solo una vez");
ok((await one(OTHER, "select public.saas_set_referrer($1, 'mi-tienda') r", [rf.store_id])).ok === false, "Otra persona no puede cambiarlo");
const mine = await one(NEW, "select public.saas_my_referrals($1) r", [r.store_id]);
ok(mine.ok && Number(mine.signups) === 1 && Number(mine.paid) === 0, "La tienda ve cuántas invitó", mine);
await raw("grant update on public.stores to authenticated");
await raw("alter table public.stores disable row level security");
const eShow = await err(NEW, "update stores set showcase = true where id = $1", [r.store_id]);
ok(/RemHub/.test(eShow ?? ""), "Una tienda no se pone sola en la vitrina", eShow);
ok(await err(NEW, "update stores set name = 'MI TIENDA 2' where id = $1", [r.store_id]) === null, "…pero sí puede cambiar sus otros datos");
ok((await one(NEW, "select public.saas_admin_referrals() r")).length === 0 && (await one(ADMIN, "select public.saas_admin_referrals() r")).length === 1, "Solo el admin ve el ranking de referidos");
const rw = await one(ADMIN, "select public.saas_admin_referral_reward($1, 30, 'trajo a Amiga') r", [r.store_id]);
ok(rw.ok && (await one(NEW, "select public.saas_my_referrals($1) r", [r.store_id])).rewards_days === 30, "El admin premia con 30 días", rw);
await one(ADMIN, "select public.saas_admin_store_growth($1, true) r", [r.store_id]);
const sc = await one(null, "select public.saas_public_showcase() r").catch(() => null);
ok(Array.isArray(sc) && sc.length === 1 && sc[0].slug === "mi-tienda" && !("owner_id" in sc[0]), "La vitrina pública muestra solo nombre, logo y enlace", sc);
const onb = await one(NEW, "select public.saas_onboarding($1) r", [r.store_id]);
ok(onb.ok && onb.steps.length === 6 && onb.steps.find((x) => x.key === "product").done === false, "Primeros pasos de la tienda nueva", onb.steps);
ok((await one(OTHER, "select public.saas_onboarding($1) r", [r.store_id])).ok === false, "Otra tienda no ve sus primeros pasos");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
