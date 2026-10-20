// Pruebas de 20261213: los permisos de siempre (erp_can / erp_can_any) respetan los módulos del plan.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $f$
  select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin') $f$;
grant execute on function public.erp_is_platform_admin() to authenticated;
alter table public.erp_warehouses add column if not exists kind text;
`;
const combined = path.join(os.tmpdir(), `remhub_mp_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  ...["20261118_compras_desde_punto.sql", "20261120_permisos_exportar_y_punto.sql", "20261127_permisos_temporales_horario.sql", "20261211_saas_planes_suscripciones.sql"]
    .map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const U = (n) => `cd000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), ADMIN = U(9), OLD_OWNER = U(3);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos,transfers,products}')", [A, SELLER]);
const can = async (u, p, s = A) => (await as(u, "select public.erp_can($1, $2) r", [s, p]))[0].r;
const canAny = async (u, ps, s = A) => (await as(u, "select public.erp_can_any($1, $2) r", [s, ps]))[0].r;

const M = fs.readFileSync(path.join(MIG, "20261213_modulos_por_plan.sql"), "utf8");
await db.exec(M);
await db.exec(M);
ok((await raw("select count(*)::int n from pg_proc where proname = 'erp_can'"))[0].n === 1, "Sigue habiendo una sola erp_can");

console.log("1. Apagado: nada cambia");
ok(await can(SELLER, "pos") === true && await can(SELLER, "transfers") === true, "Con el bloqueo apagado el vendedor usa POS y traslados (aunque la tienda sea Gratis)");

console.log("2. Encendido");
await raw("update saas_settings set enforce_modules = true");
ok(await can(SELLER, "pos") === false, "Plan Gratis: el POS queda bloqueado por el plan");
ok(await can(SELLER, "products") === true, "Productos (sin módulo) nunca se bloquea");
ok(await canAny(SELLER, ["pos", "transfers"]) === false, "erp_can_any también respeta el plan");
ok(await can(OWNER, "pos") === false, "Ni el dueño usa un módulo que su plan no tiene");
const blocked = (await as(SELLER, "select public.saas_plan_blocked_permissions($1) r", [A]))[0].r;
ok(blocked.some((b) => b.permission === "pos") && !blocked.some((b) => b.permission === "products"), "La pantalla sabe qué permisos frena el plan", blocked.length);
await raw("update saas_subscriptions set plan_id = 'emprendedor', status = 'active', current_period_end = now() + interval '30 days' where store_id = $1", [A]);
ok(await can(SELLER, "pos") === true && await can(SELLER, "transfers") === false, "Emprendedor: POS sí, traslados no");
ok(await canAny(SELLER, ["pos", "transfers"]) === true, "erp_can_any: basta con uno permitido");
await raw("update saas_subscriptions set plan_id = 'negocio' where store_id = $1", [A]);
ok(await can(SELLER, "transfers") === true, "Negocio: traslados sí");
ok(await can(SELLER, "payroll") === false, "…pero el permiso que el usuario no tiene sigue siendo «no»");
await raw("update saas_subscriptions set current_period_end = now() - interval '10 days' where store_id = $1", [A]);
ok(await can(SELLER, "pos") === false, "Al vencer (pasada la gracia) vuelve a Gratis y se frena el POS");

console.log("3. Fundadores y admin");
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [OLD_OWNER]);
await raw("update saas_subscriptions set plan_id = 'fundador', status = 'active', current_period_end = null where store_id = $1", [B]);
ok(await can(OLD_OWNER, "payroll", B) === true && await can(OLD_OWNER, "fiscal", B) === true, "Un Fundador tiene todos los módulos");
ok((await as(ADMIN, "select public.saas__perm_allowed($1, 'pos') r", [A]))[0].r === true, "El admin de RemHub nunca se frena");

await raw("update saas_settings set enforce_modules = false");
ok(await can(SELLER, "pos") === true, "Al apagarlo vuelve todo como antes");

console.log("4. Avisos diarios");
await raw("update saas_subscriptions set status = 'trialing', trial_plan_id = 'negocio', trial_ends_at = now() + interval '1 day' where store_id = $1", [A]);
const dig = await as(null, "select * from public.saas_push_digest()").catch((e) => e.message);
ok(typeof dig === "string" && /permission denied/i.test(dig), "El navegador no puede leer la lista de avisos");
await db.exec("set role service_role");
const rows = (await db.query("select * from public.saas_push_digest()")).rows;
await db.exec("reset role");
ok(rows.length === 1 && rows[0].kind === "trial_ending" && rows[0].user_id === OWNER, "Avisa al dueño que su prueba termina (y no al Fundador)", rows);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
