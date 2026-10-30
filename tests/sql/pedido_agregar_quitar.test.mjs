// Pruebas de 20261275: agregar y quitar productos de un pedido interno, con constancia en el chat.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Lo mínimo de producción que usan las funciones (acceso, nombre de quien actúa y mensajes del sistema).
const extra = `
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists number int;
alter table public.erp_stock_requests add column if not exists status text not null default 'pending';
alter table public.erp_stock_requests add column if not exists updated_at timestamptz default now();
create table if not exists public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid not null, product_id uuid not null,
  qty_requested integer not null, qty_approved integer, qty_received integer, source_qty_at_request integer, dest_qty_at_request integer, note text);
create table if not exists public.erp_stock_request_signatures (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid not null,
  step text not null, signer_name text not null, signer_doc text, signature text, notes text, via text not null default 'dashboard', user_id uuid, signed_at timestamptz not null default now());
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp__sr_access(p_store uuid, p_from uuid, p_to uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('attend', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_to),
                            'request', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_from), 'view', true);
$$;
create or replace function public.erp_actor_name(p_store uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from store_users where store_id = p_store and user_id = auth.uid()), 'Dueño');
$$;
create or replace function public.erp__sr_system(p_request uuid, p_body text) returns void language sql security definer set search_path = public as $$
  insert into public.erp_stock_request_messages (request_id, user_id, kind, body) values (p_request, auth.uid(), 'system', p_body);
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_sr_items_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261275_pedido_agregar_quitar.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), SANTI = U(3);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const lastMsg = async (R) => (await raw("select body from erp_stock_request_messages where request_id = $1 order by created_at desc limit 1", [R]))[0]?.body ?? "";

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina2', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), P = await wh("P", "Pioneros");
await raw("insert into store_users (store_id, user_id, role, point_id, display_name) values ($1, $2, 'seller', $3, 'Sara'), ($1, $4, 'seller', $5, 'Santiago')", [A, SARA, B, SANTI, P]);
const prod = async (name) => (await raw("insert into products (store_id, name) values ($1, $2) returning id", [A, name]))[0].id;
const TERMO = await prod("TERMO"), ZAPATERO = await prod("ZAPATERO"), TRIPODE = await prod("TRIPODE");
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 92)", [B, TRIPODE, A]);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, number, status) values ($1, $2, $3, 7, 'pending') returning id", [A, P, B]);
await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, 5), ($1, $3, 5)", [R, TERMO, ZAPATERO]);

// Quien pidió, mientras nadie lo toma: sube lo pedido.
await as(SANTI, "select public.erp_sr_item_add($1, $2, 3)", [R, TERMO]);
let it = (await raw("select qty_requested, qty_approved from erp_stock_request_items where request_id = $1 and product_id = $2", [R, TERMO]))[0];
ok(it.qty_requested === 8 && it.qty_approved === null, "Santiago (pidió) suma 3 termos: ahora pide 8", it);
ok((await lastMsg(R)).includes("Santiago agregó 3 × TERMO (ahora 8) al pedido"), "Queda en el chat", await lastMsg(R));

// Quien atiende agrega algo que no pidieron: sale en el envío.
await raw("update erp_stock_requests set status = 'preparing' where id = $1", [R]);
ok(/Solo quien atiende/.test(await err(SANTI, "select public.erp_sr_item_add($1, $2, 1)", [R, TRIPODE]) ?? ""), "Ya tomado: quien pidió no agrega más");
await as(SARA, "select public.erp_sr_item_add($1, $2, 2, 'van de regalo')", [R, TRIPODE]);
it = (await raw("select qty_requested, qty_approved, source_qty_at_request, note from erp_stock_request_items where request_id = $1 and product_id = $2", [R, TRIPODE]))[0];
ok(it.qty_approved === 2 && it.qty_requested === 2 && it.source_qty_at_request === 92 && it.note.includes("Agregado por Sara"), "Sara (bodega) agrega 2 trípodes al envío, con existencias de ese momento", it);
ok((await lastMsg(R)).includes("Sara agregó 2 × TRIPODE al envío: van de regalo"), "Con el motivo en el chat", await lastMsg(R));
await as(SARA, "select public.erp_sr_item_add($1, $2, 2)", [R, ZAPATERO]);
it = (await raw("select qty_requested, qty_approved from erp_stock_request_items where request_id = $1 and product_id = $2", [R, ZAPATERO]))[0];
ok(it.qty_approved === 7 && it.qty_requested === 5, "Sara manda 2 zapateros más de los 5 pedidos: envía 7", it);
ok(/cantidad válida/.test(await err(SARA, "select public.erp_sr_item_add($1, $2, 0)", [R, ZAPATERO]) ?? ""), "Cantidad 0 no");

// Quitar
const termoItem = (await raw("select id from erp_stock_request_items where request_id = $1 and product_id = $2", [R, TERMO]))[0].id;
await as(SARA, "select public.erp_sr_item_remove($1, $2, 'no hay')", [R, termoItem]);
ok(Number((await raw("select count(*) n from erp_stock_request_items where request_id = $1", [R]))[0].n) === 2, "Sara quita los termos");
ok((await lastMsg(R)).includes("Sara quitó TERMO (8 und.) del pedido: no hay"), "Queda en el chat con el motivo", await lastMsg(R));

// Después de «Revisó» ya no se cambia.
await raw("insert into erp_stock_request_signatures (request_id, store_id, step, signer_name) values ($1, $2, 'sent', 'SARA')", [R, A]);
ok(/Revisó/.test(await err(SARA, "select public.erp_sr_item_add($1, $2, 1)", [R, TERMO]) ?? ""), "Firmado «Revisó»: ya no se agrega");
await raw("delete from erp_stock_request_signatures where request_id = $1", [R]);

// No se puede dejar el pedido vacío.
const items = (await raw("select id from erp_stock_request_items where request_id = $1", [R])).map((x) => x.id);
await as(SARA, "select public.erp_sr_item_remove($1, $2)", [R, items[0]]);
ok(/único producto/.test(await err(SARA, "select public.erp_sr_item_remove($1, $2)", [R, items[1]]) ?? ""), "El último producto no se quita");

// Otra tienda
const [{ id: OTRA }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [U(9)]);
const [{ id: AJENO }] = await raw("insert into products (store_id, name) values ($1, 'AJENO') returning id", [OTRA]);
ok(/no es de la tienda/.test(await err(SARA, "select public.erp_sr_item_add($1, $2, 1)", [R, AJENO]) ?? ""), "No se agrega un producto de otra tienda");

await raw("update erp_stock_requests set status = 'dispatched' where id = $1", [R]);
ok(/ya salió/.test(await err(SARA, "select public.erp_sr_item_add($1, $2, 1)", [R, TERMO]) ?? ""), "Ya enviado: no se cambia");

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exitCode = fail ? 1 : 0;
