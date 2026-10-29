// Pruebas de 20261271: llamadas solo a los involucrados y mensajes directos del equipo.
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
const combined = path.join(os.tmpdir(), `remhub_dm_${process.pid}.sql`);
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261267_chat_multimedia.sql", "20261268_llamadas.sql", "20261269_llamadas_rechazo.sql", "20261271_mensajes_directos.sql", "20261271_mensajes_directos.sql"]) {
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
const [{ id: B2 }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [OTRO]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), Z = await wh("Z", "Zamora"), C = await wh("C", "Centro");
const member = (u, name, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values ($1, $2, 'seller', '{stock_requests}', $3, $4)", [A, u, point, name]);
await member(ANDRES, "Andrés", Z);
await member(LAURA, "Laura", B);
await member(MARIO, "Mario", B);
await member(SOFIA, "Sofía", C);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, requested_by, handled_by) values ($1, $2, $3, $4, $5) returning id", [A, Z, B, ANDRES, LAURA]);
const offer = JSON.stringify({ type: "offer", sdp: "v=0 o=- 1 2 IN IP4 127.0.0.1 s=- t=0 0 ..." });

// ---- llamadas del pedido
const cands = await one(ANDRES, "select public.erp_call_candidates($1) r", [R]);
ok(cands[0].name === "Laura" && cands[0].involved === true && cands.some((c) => c.name === "Mario" && !c.involved) && !cands.some((c) => c.name === "Sofía"), "Candidatos: Laura (atiende) primero; Mario de Bodega se puede escoger; Sofía (Centro) no", cands);
const c1 = await one(ANDRES, "select public.erp_call_start($1, false, $2::jsonb) r", [R, offer]);
ok(JSON.stringify(c1.invited) === JSON.stringify([LAURA]), "Sin escoger: solo le timbra a Laura (involucrada), no a Mario ni al dueño", c1.invited);
const c2 = await one(ANDRES, "select public.erp_call_start($1, true, $2::jsonb, $3::uuid[]) r", [R, offer, [MARIO, SOFIA]]);
ok(JSON.stringify(c2.invited) === JSON.stringify([MARIO]), "Escogiendo Mario y Sofía: solo Mario (Sofía no es de este pedido)", c2.invited);
ok(/Escoge/.test(await err(ANDRES, "select public.erp_call_start($1, false, $2::jsonb, $3::uuid[])", [R, offer, [SOFIA]]) ?? ""), "Escoger solo a alguien ajeno: no se llama");
await raw("insert into erp_stock_request_messages (request_id, user_id, body) values ($1, $2, 'yo reviso')", [R, MARIO]);
ok((await one(ANDRES, "select public.erp_call_candidates($1) r", [R])).find((c) => c.name === "Mario").involved === true, "Mario escribió en el pedido: ahora es involucrado");

// ---- mensajes directos
const people = await one(ANDRES, "select public.erp_dm_people($1) r", [A]);
ok(people.length === 4 && !people.some((p) => p.user_id === ANDRES) && people.find((p) => p.name === "Sofía").point === "Centro", "Directorio: todo el equipo menos yo, con su punto", people);
const t1 = await one(ANDRES, "select public.erp_dm_open($1, $2) r", [A, SOFIA]);
const t1b = await one(SOFIA, "select public.erp_dm_open($1, $2) r", [A, ANDRES]);
ok(t1.ok && t1.id === t1b.id, "Abrir el chat Andrés–Sofía desde cualquiera de los dos da el mismo chat");
ok(/no es de la tienda/.test(await err(ANDRES, "select public.erp_dm_open($1, $2)", [A, OTRO]) ?? ""), "No se puede abrir chat con alguien de otra tienda");
ok(/acceso/.test(await err(OTRO, "select public.erp_dm_open($1, $2)", [A, ANDRES]) ?? ""), "Alguien de otra tienda no puede escribir al equipo");

await one(ANDRES, "select public.erp_dm_send($1, 'Hola Sofía, ¿tienes cargadores?', '[]'::jsonb) r", [t1.id]);
const p = `${A}/dm/${t1.id}/x.jpg`;
const s2 = await one(ANDRES, "select public.erp_dm_send($1, '', $2::jsonb) r", [t1.id, JSON.stringify([{ type: "image", path: p, mime: "image/jpeg", size: 1000 }])]);
ok(s2.ok, "Envía una foto sin texto");
ok(/fuera de este chat/.test(await err(ANDRES, "select public.erp_dm_send($1, '', $2::jsonb)", [t1.id, JSON.stringify([{ type: "image", path: `${A}/dm/otro/x.jpg`, size: 1 }])]) ?? ""), "No acepta archivos de otro chat");
const list = await one(SOFIA, "select public.erp_dm_list($1) r", [A]);
ok(list.length === 1 && list[0].unread === 2 && list[0].members[0].name === "Andrés" && list[0].last.body === "📷 Foto", "Sofía ve el chat con Andrés: 2 sin leer, último «📷 Foto»", list);
const msgs = await one(SOFIA, "select public.erp_dm_messages($1) r", [t1.id]);
ok(msgs.length === 2 && msgs[0].body.startsWith("Hola") && msgs[1].attachments[0].path === p && msgs[0].mine === false, "Sofía lee los mensajes en orden, con la foto");
await one(SOFIA, "select public.erp_dm_read($1) r", [t1.id]);
ok((await one(SOFIA, "select public.erp_dm_list($1) r", [A]))[0].unread === 0, "Al leer quedan en 0");
ok((await as(LAURA, "select id from erp_dm_messages")).length === 0, "Laura no ve los mensajes de Andrés y Sofía (RLS)");
ok(/No estás en este chat/.test(await err(LAURA, "select public.erp_dm_messages($1)", [t1.id]) ?? ""), "Laura no puede leer ese chat");
ok(await one(SOFIA, "select public.erp__dm_media_ok($1, 'dm', $2) r", [A, t1.id]) === true && await one(LAURA, "select public.erp__dm_media_ok($1, 'dm', $2) r", [A, t1.id]) === false, "Archivos del chat: Sofía sí, Laura no");

const g = await one(LAURA, "select public.erp_dm_group_create($1, 'Bodega y Zamora', $2::uuid[]) r", [A, [ANDRES, MARIO]]);
ok(g.ok && (await one(ANDRES, "select public.erp_dm_list($1) r", [A])).some((t) => t.kind === "group" && t.title === "Bodega y Zamora"), "Laura crea un grupo con Andrés y Mario");
ok(/al menos dos/.test(await err(LAURA, "select public.erp_dm_group_create($1, 'Solo', $2::uuid[])", [A, [ANDRES]]) ?? ""), "Un grupo necesita al menos dos personas más");

const dc = await one(MARIO, "select public.erp_call_start_dm($1, true, $2::jsonb) r", [g.id, offer]);
ok([...dc.invited].sort().join() === [ANDRES, LAURA].sort().join(), "Videollamada en el grupo: timbra a Andrés y Laura", dc.invited);
ok((await one(LAURA, "select public.erp_call_end($1, 'rechazó') r", [dc.id])).status === "declined", "Laura rechaza");
const sys = (await one(MARIO, "select public.erp_dm_messages($1) r", [g.id])).map((m) => m.body);
ok(sys.some((b) => b === "🎥 Videollamada de Mario rechazada por Laura"), "Queda en el chat del grupo", sys);
ok(/No estás/.test(await err(SOFIA, "select public.erp_call_start_dm($1, false, $2::jsonb)", [g.id, offer]) ?? ""), "Sofía no puede llamar a un grupo en el que no está");
void B2;

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
