// Pruebas de 20261277: lista de chequeo de productos (empacado y recibido).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists number int;
alter table public.erp_stock_requests add column if not exists status text not null default 'pending';
create table if not exists public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid not null, product_id uuid not null,
  qty_requested integer not null, qty_approved integer, qty_received integer, source_qty_at_request integer, dest_qty_at_request integer, note text);
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp__sr_access(p_store uuid, p_from uuid, p_to uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('attend', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_to),
                            'request', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_from), 'view', true);
$$;
create or replace function public.erp__sr_visible(p_request uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from erp_stock_requests r join store_users su on su.store_id = r.store_id and su.user_id = auth.uid()
                 where r.id = p_request and su.point_id in (r.from_point_id, r.to_point_id));
$$;
create or replace function public.erp_actor_name(p_store uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from store_users where store_id = p_store and user_id = auth.uid()), 'Dueño');
$$;
create or replace function public.erp__sr_system(p_request uuid, p_body text) returns void language sql security definer set search_path = public as $$
  insert into public.erp_stock_request_messages (request_id, user_id, kind, body) values (p_request, auth.uid(), 'system', p_body);
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_sr_check_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261277_pedido_checklist.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a2200000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), SANTI = U(3), LUIS = U(4), OTRO = U(5);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const msgs = async (R) => (await raw("select body from erp_stock_request_messages where request_id = $1 order by created_at", [R])).map((x) => x.body);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina4', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), P = await wh("P", "Pioneros"), C = await wh("C", "Centro");
await raw("insert into store_users (store_id, user_id, role, point_id, display_name) values ($1, $2, 'seller', $3, 'Sara'), ($1, $4, 'seller', $5, 'Santiago'), ($1, $6, 'seller', $3, 'Luis'), ($1, $7, 'seller', $8, 'Otro')",
  [A, SARA, B, SANTI, P, LUIS, OTRO, C]);
const prod = async (n) => (await raw("insert into products (store_id, name) values ($1, $2) returning id", [A, n]))[0].id;
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, number, status) values ($1, $2, $3, 8, 'preparing') returning id", [A, P, B]);
const ids = [];
for (const n of ["CEPILLO", "COJIN", "TRENZADOR"]) ids.push((await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, 5) returning id", [R, await prod(n)]))[0].id);

ok(/Solo quien despacha/.test(await err(SANTI, "select public.erp_sr_item_check($1, $2, 'pack', true)", [R, ids[0]]) ?? ""), "Quien pidió no chulea el empaque");
await as(SARA, "select public.erp_sr_item_check($1, $2, 'pack', true)", [R, ids[2]]);
await as(LUIS, "select public.erp_sr_item_check($1, $2, 'pack', true)", [R, ids[0]]);
await as(SARA, "select public.erp_sr_item_check($1, $2, 'pack', true)", [R, ids[2]]);
let list = (await as(SANTI, "select public.erp_sr_item_checks($1) r", [R]))[0].r;
ok(list.length === 2 && list[0].item_id === ids[2] && list[0].by === "Sara" && list[1].by === "Luis", "Sara y Luis chulean en cualquier orden; queda quién y en qué orden (y Santiago lo ve)", list);
ok(Number((await as(SANTI, "select count(*) n from erp_sr_item_checks where request_id = $1", [R]))[0].n) === 2, "Santiago lo ve en vivo (puede leer la tabla)");
ok(Number((await as(OTRO, "select count(*) n from erp_sr_item_checks where request_id = $1", [R]))[0].n) === 0, "Alguien de otro punto no lo ve");
ok(!(await msgs(R)).some((m) => m.includes("terminó")), "Todavía no está completo: nada en el chat");
await as(SARA, "select public.erp_sr_item_check($1, $2, 'pack', false)", [R, ids[0]]);
ok((await as(SARA, "select public.erp_sr_item_checks($1) r", [R]))[0].r.length === 1, "Sara deschulea uno");
await as(SARA, "select public.erp_sr_item_check($1, $2, 'pack', true)", [R, ids[0]]);
const done = (await as(SARA, "select public.erp_sr_item_check($1, $2, 'pack', true) r", [R, ids[1]]))[0].r;
ok(done.done === 3 && done.total === 3, "Lista completa", done);
ok((await msgs(R)).filter((m) => m.includes("terminó de chulear el empaque: 3 de 3")).length === 1, "Al completarla queda en el chat una vez", await msgs(R));
await as(SARA, "select public.erp_sr_item_check($1, $2, 'pack', true)", [R, ids[1]]);
ok((await msgs(R)).filter((m) => m.includes("terminó")).length === 1, "Volver a chulear lo mismo no repite el aviso");

ok(/en camino/.test(await err(SANTI, "select public.erp_sr_item_check($1, $2, 'receive', true)", [R, ids[0]]) ?? ""), "Lo recibido se chulea cuando va en camino");
await raw("update erp_stock_requests set status = 'dispatched' where id = $1", [R]);
ok(/ya salió/.test(await err(SARA, "select public.erp_sr_item_check($1, $2, 'pack', false)", [R, ids[0]]) ?? ""), "Ya salió: el empaque no se cambia");
for (const id of ids) await as(SANTI, "select public.erp_sr_item_check($1, $2, 'receive', true)", [R, id]);
ok((await msgs(R)).some((m) => m.includes("Santiago terminó de chulear lo recibido: 3 de 3")), "Santiago chulea lo que llegó y queda en el chat");
list = (await as(SARA, "select public.erp_sr_item_checks($1) r", [R]))[0].r;
ok(list.filter((x) => x.side === "pack").length === 3 && list.filter((x) => x.side === "receive").length === 3, "Empaque y recibido se guardan por separado");

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exitCode = fail ? 1 : 0;
