// Pruebas de 20261268 y 20261269: llamadas y videollamadas en los pedidos internos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
alter table public.store_users add column if not exists point_id uuid;
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp_stock_request_message(p_request uuid, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
begin insert into public.erp_stock_request_messages (request_id, user_id, body) values (p_request, auth.uid(), p_body); return '{}'::jsonb; end $$;
`;
const combined = path.join(os.tmpdir(), `remhub_llamadas_${process.pid}.sql`);
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261267_chat_multimedia.sql", "20261268_llamadas.sql", "20261268_llamadas.sql", "20261269_llamadas_rechazo.sql", "20261269_llamadas_rechazo.sql"]) await db.exec(fs.readFileSync(path.join(here, "migraciones", f), "utf8"));

const U = (n) => `a1700000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ZAM = U(2), BOD1 = U(3), BOD2 = U(4), CEN = U(5), VENTAS = U(6);
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
const member = (u, name, point, perms = "{stock_requests}") => raw("insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values ($1, $2, 'seller', $3, $4, $5)", [A, u, perms, point, name]);
await member(ZAM, "Andrés", Z);
await member(BOD1, "Laura", B);
await member(BOD2, "Mario", B);
await member(CEN, "Sofía", C);
await member(VENTAS, "Pedro", B, "{pos}");
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id) values ($1, $2, $3) returning id", [A, Z, B]);
const offer = JSON.stringify({ type: "offer", sdp: "v=0 o=- 1 2 IN IP4 127.0.0.1 s=- t=0 0 ..." });
const answer = JSON.stringify({ type: "answer", sdp: "v=0 o=- 3 4 IN IP4 127.0.0.1 s=- t=0 0 ..." });

const s1 = await one(ZAM, "select public.erp_call_start($1, true, $2::jsonb) r", [R, offer]);
const invited = [...s1.invited].sort();
ok(s1.ok && JSON.stringify(invited) === JSON.stringify([OWNER, BOD1, BOD2].sort()), "Zamora llama: timbra a Laura y Mario (Bodega) y al dueño; no a Centro ni a ventas", s1.invited);
ok((await as(BOD1, "select id, video, caller_name from erp_calls")).length === 1 && (await as(BOD1, "select caller_name from erp_calls"))[0].caller_name === "Andrés", "Laura ve la llamada y quién llama");
ok((await as(CEN, "select id from erp_calls")).length === 0, "Centro no ve la llamada (RLS)");
ok(/no es para ti/.test(await err(CEN, "select public.erp_call_answer($1, $2::jsonb)", [s1.id, answer]) ?? ""), "Centro no puede contestar");

ok((await one(BOD1, "select public.erp_call_answer($1, $2::jsonb) r", [s1.id, answer])).ok, "Laura contesta");
ok(/ya contestó/.test(await err(BOD2, "select public.erp_call_answer($1, $2::jsonb)", [s1.id, answer]) ?? ""), "Mario ya no puede: otra persona contestó");
const inv = Object.fromEntries((await raw("select user_id::text u, status from erp_call_invites where call_id = $1", [s1.id])).map((x) => [x.u, x.status]));
ok(inv[BOD1] === "answered" && inv[BOD2] === "elsewhere", "A Mario se le deja de timbrar", inv);
ok((await as(ZAM, "select answer from erp_calls where id = $1", [s1.id]))[0].answer.type === "answer", "Andrés recibe la respuesta de conexión");
await raw("update erp_calls set answered_at = now() - interval '192 seconds' where id = $1", [s1.id]);
ok((await one(ZAM, "select public.erp_call_end($1, 'colgó') r", [s1.id])).status === "ended", "Andrés cuelga");
const sys = (await raw("select body from erp_stock_request_messages where request_id = $1 and kind = 'system'", [R]))[0]?.body;
ok(/^🎥 Videollamada · 3:12 \(Andrés con Laura\)$/.test(sys ?? ""), "Queda en el chat: «🎥 Videollamada · 3:12 (Andrés con Laura)»", sys);

const s2 = await one(BOD1, "select public.erp_call_start($1, false, $2::jsonb) r", [R, offer]);
ok(s2.invited.includes(ZAM) && !s2.invited.includes(BOD2), "Laura (Bodega) llama: timbra a Zamora, no a su compañero de Bodega", s2.invited);
ok((await one(ZAM, "select public.erp_call_end($1, 'rechazó') r", [s2.id])).status === "declined", "Andrés rechaza: la llamada termina para todos (20261269)");
ok((await raw("select count(*)::int n from erp_call_invites where call_id = $1 and status = 'ringing'", [s2.id]))[0].n === 0, "Al dueño ya no le timbra");
ok((await raw("select count(*)::int n from erp_stock_request_messages where body = '📞 Llamada de Laura rechazada por Andrés'"))[0].n === 1, "Queda «📞 Llamada de Laura rechazada por Andrés»");
ok((await one(OWNER, "select public.erp_call_end($1, 'rechazó') r", [s2.id])).status === "declined", "Rechazar otra vez no cambia nada");

const s3 = await one(ZAM, "select public.erp_call_start($1, false, $2::jsonb) r", [R, offer]);
ok((await one(ZAM, "select public.erp_call_end($1, 'sin respuesta') r", [s3.id])).status === "missed", "Nadie contesta: llamada perdida");
ok((await raw("select count(*)::int n from erp_stock_request_messages where body like '📞 Llamada perdida de Andrés'"))[0].n === 1, "Queda «📞 Llamada perdida de Andrés»");

ok(/acceso/.test(await err(CEN, "select public.erp_call_start($1, false, $2::jsonb)", [R, offer]) ?? ""), "Centro no puede llamar en un pedido que no es suyo");
ok(/preparar/.test(await err(ZAM, "select public.erp_call_start($1, false, '{}'::jsonb)", [R]) ?? ""), "Sin oferta de conexión no se llama");
ok(/no es tuya/.test(await err(CEN, "select public.erp_call_end($1, 'x')", [s1.id]) ?? ""), "Centro no puede colgar llamadas ajenas");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
