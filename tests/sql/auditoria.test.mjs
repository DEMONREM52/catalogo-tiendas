// Pruebas de 20261117: auditoría global inalterable (cadena de integridad, alcance, rechazos y rendimiento).
// Necesita la migración fiscal 20261027 (crea erp_audit_logs y erp__audit_insert): REMHUB_FISCAL=<ruta>.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const FISCAL = process.env.REMHUB_FISCAL ?? path.join(MIG, "20261027_fiscal_multipunto.sql");
const combined = path.join(os.tmpdir(), `remhub_aud_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(FISCAL, "utf8"), fs.readFileSync(path.join(MIG, "20261117_auditoria_global.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

const U = (n) => `f1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER_A = U(1), OWNER_B = U(2), AUDITOR = U(3), POINT_BOSS = U(4), SELLER = U(5), ADMIN = U(6);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const rawErr = async (s, p) => { try { await raw(s, p); return null; } catch (e) { return e.message; } };

await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'Tienda A', $1) returning id", [OWNER_A]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'Tienda B', $1) returning id", [OWNER_B]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'C', 'CENTRO', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values
  ($1,$2,'seller','{audit,products}',null,'AUDITORA'), ($1,$3,'seller','{audit,pos}',$4,'JEFE ZAMORA'), ($1,$5,'seller','{pos}',$4,'VENDEDOR')`, [A, AUDITOR, POINT_BOSS, Z, SELLER]);

console.log("1-2. Se registra la creación y el cambio (antes → después)");
const [{ id: P }] = await as(OWNER_A, "insert into products (store_id, name, sku, active) values ($1, 'AUDIFONO', 'A1', true) returning id", [A]);
await as(OWNER_A, "update products set name = 'AUDIFONO K19' where id = $1", [P]);
const evs = await raw("select action, before, after, user_id, actor_type, actor_role, chain_seq, hash, prev_hash, module from erp_audit_logs where entity_id = $1 order by chain_seq", [P]);
ok(evs.some((e) => e.action === "producto.insert" && e.user_id === OWNER_A && e.actor_type === "user" && e.actor_role === "owner"), "Creación con autor, tipo de actor y rol", evs);
const upd = evs.find((e) => e.action === "producto.update");
ok(upd?.before?.name === "AUDIFONO" && upd?.after?.name === "AUDIFONO K19" && upd.module === "productos", "Modificación con valor anterior y nuevo", upd);
ok(evs.every((e) => e.hash && e.chain_seq) && upd.prev_hash === evs[evs.indexOf(upd) - 1]?.hash, "Cada evento queda encadenado al anterior (hash)");
await as(OWNER_A, "update products set stock = 9 where id = $1", [P]);
ok((await raw("select count(*)::int n from erp_audit_logs where entity_id = $1", [P]))[0].n === evs.length, "Cambios de existencias no llenan la auditoría (van al kardex)");

console.log("3-4. Nadie modifica ni borra eventos");
ok(/permission denied/i.test((await err(OWNER_A, "update erp_audit_logs set action = 'x'")) ?? ""), "Dueño (API): no puede editar");
ok(/permission denied/i.test((await err(OWNER_A, "delete from erp_audit_logs")) ?? ""), "Dueño (API): no puede borrar");
ok(/permission denied/i.test((await err(ADMIN, "delete from erp_audit_logs")) ?? ""), "Administrador global (API): tampoco");
ok(/no se puede modificar/i.test((await rawErr("update erp_audit_logs set action = 'x'")) ?? ""), "Ni siquiera con acceso directo a la tabla sin mantenimiento");
ok(/no se puede (borrar|modificar)/i.test((await rawErr("delete from erp_audit_logs")) ?? ""), "…ni borrar");
ok(/no se puede vaciar|permission/i.test((await rawErr("truncate erp_audit_logs")) ?? ""), "…ni vaciar (TRUNCATE)");
ok(/permission denied/i.test((await err(OWNER_A, "insert into erp_audit_logs (store_id, action, entity) values ($1, 'falso', 'x')", [A])) ?? ""), "No se pueden inventar eventos desde la API");

console.log("5-6. Aislamiento entre tiendas y puntos");
const otherStore = await one(OWNER_B, "select public.erp_audit_search($1, '{}'::jsonb, 50, null) r", [A]);
ok(otherStore.ok === false, "Dueño de otra tienda: no ve la auditoría ajena", otherStore);
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'security.audit_denied' and user_id = $1", [OWNER_B]))[0].n === 1, "…y el intento queda registrado como evento de seguridad");
const cross = await one(POINT_BOSS, "select public.erp_audit_search($1, $2::jsonb, 50, null) r", [A, JSON.stringify({ point_id: C })]);
ok(cross.ok === false && /asignado/.test(cross.message), "Jefe de punto pidiendo otro punto por su identificador: bloqueado", cross);
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'security.audit_cross_point' and user_id = $1", [POINT_BOSS]))[0].n === 1, "…y queda registrado");
ok((await one(SELLER, "select public.erp_audit_search($1, '{}'::jsonb, 50, null) r", [A])).ok === false, "Vendedor sin permiso: no consulta");
await as(OWNER_A, "select public.erp_audit_scope_save($1, 'point_users')", [A]);
const own = await one(SELLER, "select public.erp_audit_search($1, '{}'::jsonb, 50, null) r", [A]);
ok(own.ok && own.scope === "own", "Si la madre lo permite, el vendedor consulta solo su punto", own);
ok((await one(OWNER_A, "select public.erp_audit_search(null, '{}'::jsonb, 50, null) r")).ok === false, "Plataforma completa: solo el administrador global");
ok((await one(ADMIN, "select public.erp_audit_search(null, '{}'::jsonb, 50, null) r")).items.length > 0, "El administrador global sí consulta todo");

const before = (await raw("select count(*)::int n from erp_audit_logs"))[0].n;
const acc = await one(SELLER, "select public.erp_audit_access($1) r", [A]);
ok(acc.scope === "own" && acc.can_verify === false, "La interfaz sabe el alcance del usuario", acc);
ok((await one(OWNER_B, "select public.erp_audit_access($1) r", [A])).scope === null, "…y a quien no tiene acceso no le muestra el botón");
ok((await raw("select count(*)::int n from erp_audit_logs"))[0].n === before, "Consultar el acceso no llena la auditoría de falsos intentos");

console.log("7. Cambio de permisos auditado y efectivo");
await as(OWNER_A, "update store_users set permissions = '{pos,audit}' where user_id = $1 and store_id = $2", [SELLER, A]);
const perm = (await raw("select severity, before, after from erp_audit_logs where action = 'usuario.update' order by chain_seq desc limit 1"))[0];
ok(perm?.severity === "warning" && JSON.stringify(perm.after).includes("audit"), "El cambio de permisos queda con antes/después y como advertencia", perm);
ok((await one(SELLER, "select public.erp_audit_search($1, '{}'::jsonb, 50, null) r", [A])).scope === "points", "…y el nuevo permiso aplica de inmediato (solo su punto)");

console.log("8. Operación masiva");
await as(OWNER_A, "insert into products (store_id, name, active) select $1, 'MASIVO ' || g, true from generate_series(1, 30) g", [A]);
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'producto.insert' and after->>'name' like 'MASIVO %'"))[0].n === 30, "Cada registro de una carga masiva queda referenciado");

console.log("10. Integridad: detecta alteraciones y borrados");
let v = await one(AUDITOR, "select public.erp_audit_verify($1, 5000) r", [A]);
ok(v.ok && v.checked > 30, "La cadena verifica completa", v);
await raw("select set_config('remhub.audit_maintenance', 'on', false)");
const victim = (await raw("select id, chain_seq from erp_audit_logs where store_id = $1 and chain_seq = 3", [A]))[0];
await raw("update erp_audit_logs set after = jsonb_build_object('name', 'ALTERADO') where id = $1", [victim.id]);
await raw("delete from erp_audit_logs where store_id = $1 and chain_seq = 6", [A]);
await raw("select set_config('remhub.audit_maintenance', '', false)");
v = await one(AUDITOR, "select public.erp_audit_verify($1, 5000) r", [A]);
ok(!v.ok && v.breaks.some((b) => b.type === "altered" && b.seq === 3), "Detecta el evento alterado", v.breaks);
ok(v.breaks.some((b) => b.type === "gap" && b.seq === 7), "Detecta el evento borrado (hueco en la numeración)");
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'security.audit_integrity_failed' and store_id = $1", [A]))[0].n === 1, "…y genera una alerta crítica");
ok((await raw("select count(*)::int n from erp_audit_verifications where store_id = $1", [A]))[0].n === 2, "Cada verificación queda guardada");

console.log("11. Consulta y exportación con permisos");
const pg1 = await one(AUDITOR, "select public.erp_audit_search($1, $2::jsonb, 5, null) r", [A, JSON.stringify({ module: "productos", log: true })]);
ok(pg1.ok && pg1.items.length === 5 && pg1.next_cursor, "Paginación en el servidor (5 por página, con cursor)", pg1.next_cursor);
const pg2 = await one(AUDITOR, "select public.erp_audit_search($1, $2::jsonb, 5, $3::jsonb) r", [A, JSON.stringify({ module: "productos" }), JSON.stringify(pg1.next_cursor)]);
ok(pg2.items.length === 5 && !pg2.items.some((x) => pg1.items.some((y) => y.id === x.id)), "La página 2 no repite eventos");
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'audit.view' and user_id = $1", [AUDITOR]))[0].n === 1, "Abrir el centro de auditoría queda registrado (una vez, no por página)");
const ctx = await one(AUDITOR, "select public.erp_audit_search($1, $2::jsonb, 50, null) r", [A, JSON.stringify({ entity_id: P })]);
ok(ctx.items.length >= 2 && ctx.items.every((x) => x.entity_id === P), "Auditoría contextual de un registro (botón espía)", ctx.items.length);
const exp = await one(AUDITOR, "select public.erp_audit_export($1, '{}'::jsonb) r", [A]);
ok(exp.ok && exp.items.length > 30 && (await raw("select count(*)::int n from erp_audit_logs where action = 'export.audit'"))[0].n === 1, "Exportar queda registrado", exp.items?.length);
ok((await one(OWNER_B, "select public.erp_audit_export($1, '{}'::jsonb) r", [A])).ok === false, "Otra tienda no puede exportar");
const ov = await one(AUDITOR, "select public.erp_audit_overview($1, 7) r", [A]);
ok(ov.ok && ov.total > 30 && ov.last_verification && ov.last_verification.ok === false, "Resumen con datos reales (incluye la última verificación fallida)", ov);

console.log("13. Sin secretos en la auditoría");
await raw("create table public.zz_secretos (id uuid primary key default gen_random_uuid(), store_id uuid, name text, api_token text, client_secret text, bank_account_number text)");
await raw("select public.erp__audit_attach('zz_secretos', array['config','prueba','','','','id','store_id'])");
await raw("insert into zz_secretos (store_id, name, api_token, client_secret, bank_account_number) values ($1, 'X', 'tok_123', 'sec_456', '1234567890')", [A]);
const sec = (await raw("select after from erp_audit_logs where entity = 'prueba' order by chain_seq desc limit 1"))[0].after;
ok(!JSON.stringify(sec).includes("tok_123") && !JSON.stringify(sec).includes("sec_456") && sec.bank_account_number === "••••7890", "Tokens y secretos excluidos; cuenta bancaria enmascarada", sec);

console.log("Borrar una tienda deja constancia");
await raw("delete from stores where id = $1", [B]);
ok((await raw("select count(*)::int n from erp_audit_logs where action = 'tienda.eliminada' and entity_id = $1 and store_id is null", [B]))[0].n === 1, "La cadena de plataforma registra la tienda eliminada");

console.log("15. Rendimiento con muchos eventos");
await raw("insert into erp_audit_logs (store_id, category, action, entity) select $1, 'ops', 'carga.prueba', 'prueba' from generate_series(1, 3000)", [A]);
const t0 = Date.now();
const big = await one(AUDITOR, "select public.erp_audit_search($1, '{}'::jsonb, 50, null) r", [A]);
const ms = Date.now() - t0;
ok(big.items.length === 50 && ms < 3000, `Primera página con 3.000+ eventos en ${ms} ms`);
ok((await raw("select count(distinct chain_seq)::int n, count(*)::int t from erp_audit_logs where store_id = $1 and chain_seq is not null", [A]))[0].n > 3000, "La numeración de la cadena no se repite");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
