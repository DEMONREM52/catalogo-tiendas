// Pruebas de 20261273: responder, reacciones, visto, editar/borrar, fijar, guardar, silenciar, menciones, productos, anuncios y búsqueda.
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
alter table public.erp_stock_requests add column if not exists number int;
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp_stock_request_message(p_request uuid, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
begin insert into public.erp_stock_request_messages (request_id, user_id, user_name, body) values (p_request, auth.uid(), public.erp__member_name((select store_id from erp_stock_requests where id = p_request), auth.uid()), p_body); return '{}'::jsonb; end $$;
`;
const combined = path.join(os.tmpdir(), `remhub_mensajeria_${process.pid}.sql`);
fs.writeFileSync(combined, [...["fixtures/prod_ventas.sql", "migraciones/20261106_rentabilidad_precios_punto.sql", "migraciones/20261110_gastos_presupuestos_nomina.sql"]
  .map((f) => fs.readFileSync(path.join(here, f), "utf8")), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261267_chat_multimedia.sql", "20261268_llamadas.sql", "20261269_llamadas_rechazo.sql", "20261271_mensajes_directos.sql", "20261272_avisos_involucrados.sql",
  "20261273_mensajeria_pro.sql", "20261273_mensajeria_pro.sql"]) {
  await db.exec(fs.readFileSync(path.join(here, "migraciones", f), "utf8"));
}

const U = (n) => `a1900000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANDRES = U(2), LAURA = U(3), MARIO = U(4), SOFIA = U(5), EXTRANO = U(9);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
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
const member = (u, name, point, role = "seller") => raw("insert into store_users (store_id, user_id, role, permissions, point_id, display_name) values ($1, $2, $3, '{stock_requests}', $4, $5)", [A, u, role, point, name]);
await member(ANDRES, "Andrés", Z);
await member(LAURA, "Laura", B);
await member(MARIO, "Mario", B, "store_admin");
await member(SOFIA, "Sofía", C);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, requested_by, number) values ($1, $2, $3, $4, 7) returning id", [A, Z, B, ANDRES]);

// --- chat del pedido
const m1 = (await one(ANDRES, "select public.erp_chat_send('sr', $1, 'Necesito cascos negros @Laura', '[]'::jsonb, null, null, $2::uuid[]) r", [R, `{${LAURA},${EXTRANO}}`])).id;
ok(Boolean(m1), "Andrés escribe en el pedido");
const row1 = (await raw("select mentions from erp_stock_request_messages where id = $1", [m1]))[0];
ok(JSON.stringify(row1.mentions) === JSON.stringify([LAURA]), "La mención guarda solo a quien ve el pedido (Laura sí, el extraño no)", row1.mentions);
const m2 = (await one(LAURA, "select public.erp_chat_send('sr', $1, 'Sí hay, ya los preparo', '[]'::jsonb, $2) r", [R, m1])).id;
ok(Boolean(m2), "Laura responde citando el mensaje de Andrés");
ok(await err(SOFIA, "select public.erp_chat_send('sr', $1, 'hola') r", [R]) !== null, "Sofía (Centro) no puede escribir en un pedido que no ve");

await as(LAURA, "select public.erp_chat_react('sr', $1, '👍')", [m1]);
await as(MARIO, "select public.erp_chat_react('sr', $1, '👍')", [m1]);
await as(MARIO, "select public.erp_chat_react('sr', $1, '❤️')", [m1]);
let ex = await one(ANDRES, "select public.erp_chat_extras('sr', $1) r", [R]);
const re = ex.msgs[m1].reactions;
ok(re.length === 2 && re.find((x) => x.emoji === "👍").count === 1 && re.find((x) => x.emoji === "❤️").count === 1, "Reacciones: una por persona (Mario cambió 👍 por ❤️)", re);
ok(ex.msgs[m2].reply.id === m1 && ex.msgs[m2].reply.body.startsWith("Necesito"), "La respuesta trae la cita", ex.msgs[m2]);
ok(ex.msgs[m1].mentions[0] === LAURA, "Los extras traen las menciones");

// Visto
await as(LAURA, "select public.erp_chat_seen('sr', $1)", [R]);
ex = await one(ANDRES, "select public.erp_chat_extras('sr', $1) r", [R]);
ok(ex.reads.some((x) => x.user_id === LAURA && x.name === "Laura"), "Visto: Laura aparece leyendo el pedido", ex.reads);

// Editar y borrar
ok(await err(LAURA, "select public.erp_chat_edit('sr', $1, 'cambio')", [m1]) !== null, "Laura no puede editar el mensaje de Andrés");
await as(ANDRES, "select public.erp_chat_edit('sr', $1, 'Necesito cascos negros talla M')", [m1]);
ex = await one(ANDRES, "select public.erp_chat_extras('sr', $1) r", [R]);
ok(ex.msgs[m1].edited === true, "Editado queda marcado");
await raw("update erp_stock_request_messages set created_at = now() - interval '20 minutes' where id = $1", [m2]);
ok(/15 minutos/.test(await err(LAURA, "select public.erp_chat_delete('sr', $1)", [m2]) ?? ""), "Pasados 15 minutos ya no se puede borrar");
await as(ANDRES, "select public.erp_chat_delete('sr', $1)", [m1]);
const del = (await raw("select body, deleted_at from erp_stock_request_messages where id = $1", [m1]))[0];
ok(del.deleted_at && del.body.includes("eliminó"), "Borrado: queda «Se eliminó este mensaje»", del);
ok(Number((await raw("select count(*) n from erp_chat_reactions where message_id = $1", [m1]))[0].n) === 0, "Al borrar se quitan sus reacciones");

// Fijar y guardar
await as(LAURA, "select public.erp_chat_pin('sr', $1, true)", [m2]);
await as(ANDRES, "select public.erp_chat_star('sr', $1, true)", [m2]);
ex = await one(ANDRES, "select public.erp_chat_extras('sr', $1) r", [R]);
ok(ex.pinned.length === 1 && ex.pinned[0].id === m2 && ex.msgs[m2].starred === true, "Fijado arriba y guardado con ⭐", ex.pinned);
const stars = await one(ANDRES, "select public.erp_chat_starred($1) r", [A]);
ok(stars.length === 1 && stars[0].chat_name === "Pedido #7", "Mensajes guardados: dice de qué chat es", stars);
ok((await one(LAURA, "select public.erp_chat_starred($1) r", [A])).length === 0, "Los guardados son de cada quien");

// Silenciar
await as(LAURA, "select public.erp_chat_mute('sr', $1, 8)", [R]);
let muted = (await raw("select public.erp_chat_muted_users('sr', $1) r", [R]))[0].r;
ok(muted.includes(LAURA), "Laura silenció el pedido por 8 horas");
await as(LAURA, "select public.erp_chat_mute('sr', $1, 0)", [R]);
muted = (await raw("select public.erp_chat_muted_users('sr', $1) r", [R]))[0].r;
ok(!muted.includes(LAURA), "Y lo volvió a activar");

// --- mensajes directos y anuncios
const T = (await one(ANDRES, "select public.erp_dm_open($1, $2) r", [A, LAURA])).id;
const d1 = (await one(ANDRES, "select public.erp_chat_send('dm', $1, 'hola Laura') r", [T])).id;
ok(Boolean(d1), "Chat directo con erp_chat_send");
await as(LAURA, "select public.erp_chat_seen('dm', $1)", [T]);
ex = await one(ANDRES, "select public.erp_chat_extras('dm', $1) r", [T]);
ok(ex.reads.length === 1 && new Date(ex.reads[0].at) >= new Date((await raw("select created_at from erp_dm_messages where id = $1", [d1]))[0].created_at), "✓✓ en el chat directo: Laura leyó después del mensaje", ex.reads);

ok(/administrador/.test(await err(ANDRES, "select public.erp_dm_announce_create($1, 'Horario', 'Mañana abrimos a las 9', null)", [A]) ?? ""), "Un vendedor no manda anuncios");
const an = await one(MARIO, "select public.erp_dm_announce_create($1, 'Horario', 'Mañana abrimos a las 9', $2::uuid[]) r", [A, `{${B}}`]);
const members = (await raw("select user_id from erp_dm_members where thread_id = $1", [an.id])).map((x) => x.user_id).sort();
ok(JSON.stringify(members) === JSON.stringify([OWNER, LAURA, MARIO].sort()), "Anuncio para Bodega: Laura, Mario (quien lo manda) y el dueño", members);
ok(/anuncios/.test(await err(LAURA, "select public.erp_chat_send('dm', $1, 'ok') r", [an.id]) ?? ""), "En el anuncio Laura no puede escribir");
ex = await one(LAURA, "select public.erp_chat_extras('dm', $1) r", [an.id]);
ok(ex.kind === "announce" && ex.can_post === false, "Laura ve el anuncio como solo lectura", ex);
await as(LAURA, "select public.erp_chat_seen('dm', $1)", [an.id]);
ex = await one(MARIO, "select public.erp_chat_extras('dm', $1) r", [an.id]);
const laura = ex.reads.find((x) => x.user_id === LAURA), owner = ex.reads.find((x) => x.user_id === OWNER);
ok(laura && owner && new Date(laura.at) > new Date(owner.at), "Mario ve que Laura lo leyó y el dueño todavía no", ex.reads);

// Producto
const [{ id: P }] = await raw("insert into products (store_id, name, price_retail, sku) values ($1, 'CASCO NEGRO', 120000, 'CN1') returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 4)", [B, P, A]);
const pm = (await one(ANDRES, "select public.erp_chat_send('dm', $1, '', '[]'::jsonb, null, $2::jsonb) r", [T, JSON.stringify({ type: "product", product_id: P })])).id;
const pmRow = (await raw("select body, meta from erp_dm_messages where id = $1", [pm]))[0];
ok(pmRow.body === "📦 CASCO NEGRO" && pmRow.meta.product_id === P, "Tarjeta de producto: el mensaje lleva el producto", pmRow);
const card = (await one(ANDRES, "select public.erp_chat_products($1, $2::uuid[]) r", [A, `{${P}}`]))[0];
ok(card.stock.find((s) => s.id === B).qty === 4 && card.stock.length === 4, "La tarjeta trae existencias de cada punto (los 3 y la bodega principal)", card);
ok(await err(ANDRES, "select public.erp_chat_send('dm', $1, '', '[]'::jsonb, null, $2::jsonb) r", [T, JSON.stringify({ type: "product", product_id: U(77) })]) !== null, "No se puede mandar un producto de otra tienda");

// Búsqueda
const found = await one(LAURA, "select public.erp_chat_search($1, 'preparo') r", [A]);
ok(found.length === 1 && found[0].scope === "sr", "Buscar encuentra el mensaje del pedido", found);
ok((await one(SOFIA, "select public.erp_chat_search($1, 'preparo') r", [A])).length === 0, "Sofía no encuentra mensajes de pedidos que no ve");
const found2 = await one(LAURA, "select public.erp_chat_search($1, 'hola') r", [A]);
ok(found2.length === 1 && found2[0].scope === "dm" && found2[0].chat_name === "Andrés", "Y los del chat directo", found2);

// Lista: silenciado y mención sin leer
await as(LAURA, "select public.erp_chat_mute('dm', $1, null)", [T]);
await one(ANDRES, "select public.erp_chat_send('dm', $1, 'mira esto @Laura', '[]'::jsonb, null, null, $2::uuid[]) r", [T, `{${LAURA}}`]);
const list = await one(LAURA, "select public.erp_dm_list($1) r", [A]);
const t = list.find((x) => x.id === T);
ok(t.muted === true && t.mentioned === true, "La lista marca silenciado y que me mencionaron", t);

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
