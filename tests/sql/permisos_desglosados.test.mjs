// Pruebas de 20261285: permisos desglosados (nadie pierde nada, la base reconoce los nuevos, eliminar productos exige el suyo).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Lo mínimo de otras migraciones que esta toca: plantillas de roles y la regla de eliminar productos (20261260).
const extra = `
create table if not exists public.erp_role_templates (id uuid primary key default gen_random_uuid(), store_id uuid, name text, icon text, permissions text[] not null default '{}');
create or replace function public.erp__product_delete_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.erp_can(p_store, 'products') and public.erp_my_points(p_store) is null;
$$;
grant execute on function public.erp__product_delete_allowed(uuid) to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_pd_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261118_compras_desde_punto.sql", "20261120_permisos_exportar_y_punto.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261285_permisos_desglosados.sql"), "utf8");

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid]); await db.exec("set role authenticated"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };

// La regla se usa desde otras funciones de la base (no se llama directo): se prueba con el usuario puesto, sin rol.
const allowed = async (uid) => { await db.query("select set_config('test.uid', $1, false)", [uid]); try { return (await db.query("select public.erp__product_delete_allowed($1) r", [A])).rows[0].r; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const U = (n) => `c5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), PROD = U(2), ADMIN_U = U(3), VEND = U(4), NUEVO = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw(`insert into store_users (store_id, user_id, role, permissions) values
  ($1,$2,'seller','{products,categories}'), ($1,$3,'seller','{users,pos}'), ($1,$4,'seller','{pos}')`, [A, PROD, ADMIN_U, VEND]);
await raw("insert into erp_role_templates (store_id, name, icon, permissions) values ($1, 'Creador', '🆕', '{products}'), ($1, 'Caja', '💵', '{pos,cash}')", [A]);

console.log("1. Antes de la migración");
ok(await allowed(PROD), "Con «Productos» se podía eliminar");

console.log("2. Migración: nadie pierde nada");
await db.exec(M);
const perms = Object.fromEntries((await raw("select user_id, permissions from store_users")).map((r) => [r.user_id, r.permissions]));
ok(["products_create", "products_import", "products_delete", "catalogs", "landing"].every((p) => perms[PROD].includes(p)), "Quien tenía «Productos» recibe crear, importar, eliminar, catálogos y landing", perms[PROD]);
ok(["users_passwords", "users_delete", "security"].every((p) => perms[ADMIN_U].includes(p)), "Quien tenía «Usuarios» recibe contraseñas, eliminar usuarios y seguridad", perms[ADMIN_U]);
ok(!perms[VEND].includes("products_delete") && !perms[VEND].includes("users_delete"), "Un vendedor no recibe permisos de productos ni de usuarios");
ok(Object.values(perms).every((p) => p.includes("messages") && p.includes("perm_v2")), "Todos conservan Mensajes y quedan marcados como desglosados");
const known = (await raw("select public.erp__known_permissions() k"))[0].k;
ok(["products_delete", "catalogs", "messages", "users_passwords", "perm_v2", "exports"].every((p) => known.includes(p)), "La base reconoce los permisos nuevos y conserva los anteriores");
const roles = Object.fromEntries((await raw("select name, permissions from erp_role_templates")).map((r) => [r.name, r.permissions]));
ok(roles.Creador.includes("products_create") && roles.Creador.includes("catalogs") && !roles.Caja.includes("products_create"), "Las plantillas de roles se desglosan igual", roles);

console.log("3. Correr dos veces no cambia nada");
await raw("update store_users set permissions = array_remove(permissions, 'products_delete') where user_id = $1", [PROD]);
await raw("update erp_role_templates set permissions = array_remove(permissions, 'products_delete') where name = 'Creador'");
await db.exec(M);
const again = (await raw("select permissions from store_users where user_id = $1", [PROD]))[0].permissions;
ok(!again.includes("products_delete"), "A quien ya está desglosado no se le vuelve a dar lo que le quitaron");
ok(again.filter((p) => p === "messages").length === 1, "No duplica permisos");
ok(!(await raw("select permissions from erp_role_templates where name = 'Creador'"))[0].permissions.includes("products_delete"), "Las plantillas tampoco se vuelven a tocar");

console.log("4. Eliminar productos exige su permiso");
ok(!(await allowed(PROD)), "Con «Productos» pero sin «Eliminar productos» la base no deja");
await raw("update store_users set permissions = permissions || '{products_delete}' where user_id = $1", [PROD]);
ok((await allowed(PROD)), "Con los dos permisos sí deja");
ok((await allowed(OWNER)), "El dueño siempre puede");
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{products_delete,perm_v2}')", [A, NUEVO]);
ok(!(await allowed(NUEVO)), "Solo «Eliminar productos» sin «Productos» no alcanza");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
