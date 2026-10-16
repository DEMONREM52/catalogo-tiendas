// Pruebas de 20261127: permisos temporales y horario de acceso (envolviendo erp_can / erp_can_any sin reescribirlas).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_pt_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  ...["20261118_compras_desde_punto.sql", "20261120_permisos_exportar_y_punto.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M27 = fs.readFileSync(path.join(MIG, "20261127_permisos_temporales_horario.sql"), "utf8");

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const U = (n) => `cb000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), JEFE = U(2), JUAN = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1,$2,'seller','{users}'), ($1,$3,'seller','{pos,payables}')", [A, JEFE, JUAN]);
const can = async (u, p) => (await as(u, "select public.erp_can($1, $2) r", [A, p]))[0].r;
const canAny = async (u, ps) => (await as(u, "select public.erp_can_any($1, $2) r", [A, ps]))[0].r;

console.log("1. Envolver sin romper");
ok(await can(JUAN, "pos") && !(await can(JUAN, "credit")), "Antes: permisos normales");
await db.exec(M27);
await db.exec(M27);
ok(await can(JUAN, "pos") && !(await can(JUAN, "credit")) && await can(OWNER, "credit"), "Después: todo igual (y el dueño lo puede todo)");
const base = (await raw("select pg_get_functiondef('public.erp__can_base(uuid,text)'::regprocedure) d"))[0].d;
ok(!base.includes("erp__can_base(") || base.indexOf("erp__can_base(") === base.lastIndexOf("erp__can_base("), "La copia no se llama a sí misma (correrla dos veces es seguro)");
ok(await canAny(JUAN, ["credit", "pos"]) && !(await canAny(JUAN, ["credit", "audit"])), "erp_can_any sigue igual");

console.log("2. Permiso temporal");
ok(/Usuarios/.test((await err(JUAN, "select public.erp_permission_grant_temp($1, $2, 'credit', now() + interval '1 hour', null)", [A, JUAN])) ?? ""), "Solo quien maneja usuarios da permisos");
ok(/dueño/.test((await err(JEFE, "select public.erp_permission_grant_temp($1, $2, 'credit', now() + interval '1 hour', null)", [A, OWNER])) ?? ""), "Al dueño no se le ponen límites");
await as(JEFE, "select public.erp_permission_grant_temp($1, $2, 'credit', now() + interval '1 hour', 'Cubre turno')", [A, JUAN]);
ok(await can(JUAN, "credit"), "Juan tiene «Créditos» por una hora");
await raw("update erp_permission_grants set expires_at = now() - interval '1 minute' where user_id = $1 and permission = 'credit'", [JUAN]);
ok(!(await can(JUAN, "credit")) && (await raw("select 'credit' = any (permissions) r from store_users where user_id = $1", [JUAN]))[0].r, "Vencido: ya no sirve, aunque siga en la lista");
ok(!(await canAny(JUAN, ["credit"])) && await canAny(JUAN, ["credit", "pos"]), "erp_can_any también lo respeta");
ok((await as(JUAN, "select public.erp_my_access($1) r", [A]))[0].r.expired.includes("credit"), "La pantalla de Juan sabe que venció");
ok(Number((await raw("select public.erp_permission_grants_cleanup() n"))[0].n) === 1
   && !(await raw("select 'credit' = any (permissions) r from store_users where user_id = $1", [JUAN]))[0].r, "La limpieza diaria lo quita de la lista");
ok(/permiso fijo/.test((await err(JEFE, "select public.erp_permission_grant_temp($1, $2, 'payables', now() + interval '1 day', null)", [A, JUAN])) ?? ""), "Un permiso fijo no se vuelve temporal por error");
await as(JEFE, "select public.erp_permission_grant_temp($1, $2, 'audit', now() + interval '1 day', null)", [A, JUAN]);
await as(JEFE, "select public.erp_permission_temp_end($1, $2, 'audit', true)", [A, JUAN]);
await raw("update erp_permission_grants set expires_at = now() - interval '1 minute' where user_id = $1", [JUAN]);
ok(await can(JUAN, "audit"), "«Dejarlo fijo» quita el vencimiento");

console.log("3. Horario de acceso");
const bog = (await raw("select extract(dow from now() at time zone 'America/Bogota')::int d, to_char((now() at time zone 'America/Bogota') + interval '1 hour', 'HH24:MI') a, to_char((now() at time zone 'America/Bogota') + interval '2 hours', 'HH24:MI') b, to_char((now() at time zone 'America/Bogota') - interval '1 hour', 'HH24:MI') c"))[0];
await as(JEFE, "select public.erp_access_schedule_save($1, $2, $3::jsonb)", [A, JUAN, JSON.stringify({ days: [bog.d], from_time: bog.a, to_time: bog.b })]);
ok(!(await can(JUAN, "pos")) && !(await canAny(JUAN, ["pos"])), "Fuera de su horario: la base le niega todo");
ok((await as(JUAN, "select public.erp_my_access($1) r", [A]))[0].r.outside_schedule === true, "Su pantalla sabe que está fuera de horario");
await as(JEFE, "select public.erp_access_schedule_save($1, $2, $3::jsonb)", [A, JUAN, JSON.stringify({ days: [bog.d], from_time: bog.c, to_time: bog.a })]);
ok(await can(JUAN, "pos"), "Dentro del horario: trabaja normal");
await as(JEFE, "select public.erp_access_schedule_save($1, $2, $3::jsonb)", [A, JUAN, JSON.stringify({ days: [(bog.d + 1) % 7], from_time: "00:00", to_time: "23:59" })]);
ok(!(await can(JUAN, "pos")), "Un día que no es de su horario: tampoco");
await as(JEFE, "select public.erp_access_schedule_save($1, $2, null)", [A, JUAN]);
ok(await can(JUAN, "pos"), "Quitar el horario lo deja libre");
ok(/al menos un día/.test((await err(JEFE, "select public.erp_access_schedule_save($1, $2, '{\"days\": [], \"from_time\": \"07:00\", \"to_time\": \"19:00\"}'::jsonb)", [A, JUAN])) ?? ""), "Valida los días");

console.log("4. Reglas de seguridad existentes (RLS) también lo respetan");
await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'PROV', true)", [A]);
const [{ id: SUP }] = await raw("select id from erp_suppliers limit 1");
await raw("insert into erp_payables (store_id, supplier_id, total, balance, status) values ($1, $2, 100, 100, 'open')", [A, SUP]);
ok((await as(JUAN, "select id from erp_payables")).length === 1, "Con permiso ve cuentas por pagar");
await raw("update store_users set permissions = array_remove(permissions, 'payables') where user_id = $1", [JUAN]);
await as(JEFE, "select public.erp_permission_grant_temp($1, $2, 'payables', now() + interval '1 day', null)", [A, JUAN]);
await raw("update erp_permission_grants set expires_at = now() - interval '1 minute' where user_id = $1", [JUAN]);
ok((await as(JUAN, "select id from erp_payables")).length === 0, "Vencido: la base deja de mostrárselas");
const ov = (await as(JEFE, "select public.erp_access_overview($1) r", [A]))[0].r;
ok(ov.ok && ov.grants.some((g) => g.user_id === JUAN && g.expired), "La pantalla de usuarios ve temporales y vencidos");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
