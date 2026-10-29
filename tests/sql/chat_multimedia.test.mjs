// Pruebas de 20261267: chat de pedidos internos con fotos, videos y audios.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Tablas y función de mensajes como las de producción (la función real valida más; aquí basta con que inserte).
const extra = `
create table if not exists public.erp_stock_requests (id uuid primary key default gen_random_uuid(), store_id uuid not null, number bigint,
  status text default 'pending', from_point_id uuid, to_point_id uuid);
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp_stock_request_message(p_request uuid, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Escribe un mensaje.'; end if;
  insert into public.erp_stock_request_messages (request_id, user_id, body) values (p_request, auth.uid(), p_body);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.erp_stock_request_message(uuid, text) to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_chat_media_${process.pid}.sql`);
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(here, "migraciones/20261267_chat_multimedia.sql"), "utf8");
await db.exec(M);
await db.exec(M); // idempotente

const U = (n) => `a1600000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ZAMORA = U(2), CENTRO = U(3), OTRA = U(4);
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
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [OTRA]);
const wh = async (store, code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [store, code, name]))[0].id;
const BOD = await wh(A, "B", "Bodega"), ZAM = await wh(A, "Z", "Zamora"), CEN = await wh(A, "C", "Centro");
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{stock_requests}', $3)", [A, ZAMORA, ZAM]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{stock_requests}', $3)", [A, CENTRO, CEN]);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id) values ($1, $2, $3) returning id", [A, ZAM, BOD]);

const send = (uid, body, att) => one(uid, "select public.erp_stock_request_message_media($1, $2, $3::jsonb) r", [R, body, JSON.stringify(att)]);
const p = (f) => `${A}/${R}/${f}`;

const r1 = await send(ZAMORA, "", [{ type: "image", path: p("a.jpg"), mime: "image/jpeg", size: 120000, width: 1200, height: 900 }, { type: "image", path: p("b.jpg"), mime: "image/jpeg", size: 90000 }]);
const m1 = (await raw("select body, attachments from erp_stock_request_messages where id = $1", [r1.id]))[0];
ok(r1.ok && m1.body === "📷 2 fotos" && m1.attachments.length === 2 && m1.attachments[0].width === 1200, "Zamora manda 2 fotos sin texto: «📷 2 fotos»", m1);

const r2 = await send(OWNER, "Mira cómo llegó", [{ type: "audio", path: p("v.webm"), mime: "audio/webm", size: 30000, duration: 72 }]);
const m2 = (await raw("select body, attachments from erp_stock_request_messages where id = $1", [r2.id]))[0];
ok(m2.body === "Mira cómo llegó" && m2.attachments[0].duration === 72, "Con texto se guarda el texto y el audio", m2);
ok((await one(OWNER, "select public.erp__sr_media_label($1::jsonb) r", [JSON.stringify([{ type: "audio", duration: 72 }, { type: "video" }])])) === "🎥 Video · 🎤 Audio (1:12)", "Etiqueta de audio con duración y video");

ok(/fuera de este pedido/.test(await err(ZAMORA, "select public.erp_stock_request_message_media($1, '', $2::jsonb)", [R, JSON.stringify([{ type: "image", path: `${A}/otro/x.jpg`, size: 1 }])]) ?? ""), "No acepta archivos de otra carpeta");
ok(/no permitido/.test(await err(ZAMORA, "select public.erp_stock_request_message_media($1, '', $2::jsonb)", [R, JSON.stringify([{ type: "exe", path: p("x.exe"), size: 1 }])]) ?? ""), "No acepta otros tipos");
ok(/50 MB/.test(await err(ZAMORA, "select public.erp_stock_request_message_media($1, '', $2::jsonb)", [R, JSON.stringify([{ type: "video", path: p("x.mp4"), size: 60000000 }])]) ?? ""), "Máximo 50 MB por archivo");
ok(/Escribe un mensaje o adjunta/.test(await err(ZAMORA, "select public.erp_stock_request_message_media($1, '  ', '[]'::jsonb)", [R]) ?? ""), "Vacío no se envía");
ok(/acceso/.test(await err(CENTRO, "select public.erp_stock_request_message_media($1, 'hola', '[]'::jsonb)", [R]) ?? ""), "Centro (no es de este pedido) no puede escribir");
ok(/acceso/.test(await err(OTRA, "select public.erp_stock_request_message_media($1, 'hola', '[]'::jsonb)", [R]) ?? ""), "Otra tienda no puede escribir");

const media = await one(ZAMORA, "select public.erp_stock_request_media($1) r", [R]);
ok(Object.keys(media).length === 2 && media[r1.id].length === 2, "Zamora ve los archivos del pedido", media);
ok(Object.keys(await one(CENTRO, "select public.erp_stock_request_media($1) r", [R])).length === 0, "Centro no ve los archivos");
ok(await one(ZAMORA, "select public.erp__sr_media_ok($1, $2) r", [A, R]) === true, "Política: Zamora puede subir a la carpeta del pedido");
ok(await one(ZAMORA, "select public.erp__sr_media_ok($1, $2) r", [B, R]) === false, "Política: carpeta con otra tienda, no");
ok(await one(ZAMORA, "select public.erp__sr_media_ok('../x', $1) r", [R]) === false, "Política: carpeta inválida, no");
ok(await one(CENTRO, "select public.erp__sr_media_ok($1, $2) r", [A, R]) === false, "Política: Centro no puede subir a ese pedido");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
