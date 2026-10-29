// Pruebas de 20261272: los avisos del chat de un pedido van solo a los involucrados (o a los escogidos).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists requested_by uuid;
alter table public.erp_stock_requests add column if not exists handled_by uuid;
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp_stock_request_message(p_request uuid, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
begin insert into public.erp_stock_request_messages (request_id, user_id, body) values (p_request, auth.uid(), p_body); return '{}'::jsonb; end $$;
`;
const combined = path.join(os.tmpdir(), `remhub_avisos_inv_${process.pid}.sql`);
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261267_chat_multimedia.sql", "20261268_llamadas.sql", "20261269_llamadas_rechazo.sql", "20261271_mensajes_directos.sql", "20261272_avisos_involucrados.sql", "20261272_avisos_involucrados.sql"]) {
  await db.exec(fs.readFileSync(path.join(here, "migraciones", f), "utf8"));
}

const U = (n) => `a1800000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANDRES = U(2), LAURA = U(3), MARIO = U(4), SOFIA = U(5), OTRO = U(9);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), Z = await wh("Z", "Zamora"), C = await wh("C", "Centro");
const member = (u, name, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values ($1, $2, 'seller', '{stock_requests}', $3, $4)", [A, u, point, name]);
await member(ANDRES, "Andrés", Z);
await member(LAURA, "Laura", B);
await member(MARIO, "Mario", B);
await member(SOFIA, "Sofía", C);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, requested_by) values ($1, $2, $3, $4) returning id", [A, Z, B, ANDRES]);
const users = async () => [...(await raw("select public.erp_sr_notify_users($1) r", [R]))[0].r].sort();
const S = (...x) => [...x].sort();

ok(JSON.stringify(await users()) === JSON.stringify(S(ANDRES, LAURA, MARIO)), "Pedido nuevo sin tomar: avisa a Andrés (pidió) y a Bodega (Laura y Mario); no al dueño ni a Centro", await users());
await raw("update erp_stock_requests set handled_by = $1 where id = $2", [LAURA, R]);
ok(JSON.stringify(await users()) === JSON.stringify(S(ANDRES, LAURA)), "Laura lo tomó: solo Andrés y Laura (Mario ya no)", await users());
await raw("insert into erp_stock_request_messages (request_id, user_id, body) values ($1, $2, 'yo ayudo')", [R, MARIO]);
ok(JSON.stringify(await users()) === JSON.stringify(S(ANDRES, LAURA, MARIO)), "Mario escribió en el chat: ahora también le avisa", await users());

const g = await one(ANDRES, "select public.erp_sr_notify_get($1) r", [R]);
ok(g.custom === false && g.people[0].me === true && g.people.find((p) => p.name === "Laura").selected && !g.people.some((p) => p.name === "Sofía"), "La lista para escoger: yo primero, Laura marcada; Sofía (Centro) no aparece", g);
const set = await one(ANDRES, "select public.erp_sr_notify_set($1, $2::uuid[]) r", [R, [ANDRES, MARIO, SOFIA]]);
ok(set.count === 2 && JSON.stringify(await users()) === JSON.stringify(S(ANDRES, MARIO)), "Andrés escoge avisar solo a él y a Mario (Sofía se ignora)", await users());
ok(JSON.stringify(await one(LAURA, "select public.erp_sr_should_notify($1::uuid[]) r", [[R]])) === "[]", "A Laura ya no le suena ese chat");
ok(JSON.stringify(await one(MARIO, "select public.erp_sr_should_notify($1::uuid[]) r", [[R]])) === JSON.stringify([R]), "A Mario sí");
ok((await one(ANDRES, "select public.erp_sr_notify_set($1, '{}'::uuid[]) r", [R])).custom === false && (await users()).length === 3, "Lista vacía: vuelve al automático (involucrados)");
ok(/acceso/.test(await err(SOFIA, "select public.erp_sr_notify_set($1, $2::uuid[])", [R, [SOFIA]]) ?? ""), "Sofía no puede cambiar los avisos de un pedido ajeno");
ok(/permission denied|no tiene permiso|denied/i.test(await err(ANDRES, "select public.erp_sr_notify_users($1)", [R]) ?? ""), "La lista del servidor no se puede pedir desde la app");

console.log(`
${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
