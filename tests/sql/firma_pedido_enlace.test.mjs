// Pruebas de 20261276: enlace para firmar el pedido interno sin iniciar sesión.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Lo mínimo de producción que usan las funciones.
const extra = `
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists number int;
alter table public.erp_stock_requests add column if not exists status text not null default 'pending';
alter table public.erp_stock_requests add column if not exists priority text default 'normal';
alter table public.erp_stock_requests add column if not exists note text;
alter table public.erp_stock_requests add column if not exists needed_by date;
alter table public.erp_stock_requests add column if not exists requested_by_name text;
alter table public.erp_stock_requests add column if not exists handled_by_name text;
alter table public.erp_stock_requests add column if not exists transfer_id uuid;
alter table public.erp_stock_requests add column if not exists last_message_at timestamptz;
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
create or replace function public.erp__sr_step_label(p_step text) returns text language sql immutable as $$
  select case p_step when 'packed' then 'Preparó' when 'sent' then 'Revisó' when 'delivered' then 'En camino (lo lleva)' when 'received' then 'Recibió' else p_step end;
$$;
create table if not exists public.copias_al_traslado (request_id uuid, step text);
create or replace function public.erp__sr_push_signature(p_request uuid, p_step text) returns void language sql security definer set search_path = public as $$
  insert into public.copias_al_traslado values (p_request, p_step);
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_sr_link_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261276_firma_pedido_enlace.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a2100000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), SANTI = U(3), OTRO = U(4);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p, role = "authenticated") {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const anon = (s, p) => as(null, s, p, "anon");
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const SIG = "data:image/png;base64,iVBORw0KGgo=";

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina3', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), P = await wh("P", "Pioneros");
await raw("insert into store_users (store_id, user_id, role, point_id, display_name) values ($1, $2, 'seller', $3, 'Sara'), ($1, $4, 'seller', $5, 'Santiago')", [A, SARA, B, SANTI, P]);
const [{ id: TERMO }] = await raw("insert into products (store_id, name) values ($1, 'TERMO') returning id", [A]);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, number, status) values ($1, $2, $3, 7, 'pending') returning id", [A, P, B]);
await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, 5)", [R, TERMO]);

ok(/No puedes/.test(await err(() => as(OTRO, "select public.erp_sr_sign_link($1)", [R])) ?? ""), "Alguien sin acceso al pedido no saca el enlace");
const link = (await as(SARA, "select public.erp_sr_sign_link($1) r", [R]))[0].r;
ok(/^[0-9a-f]{64}$/.test(link.token), "Sara (bodega) saca el enlace de firmas", link);
const again = (await as(SANTI, "select public.erp_sr_sign_link($1) r", [R]))[0].r;
ok(again.token === link.token, "Un solo enlace por pedido: Santiago recibe el mismo");
ok(Number((await raw("select count(*) n from erp_stock_request_messages where request_id = $1 and body like '🔗%'", [R]))[0].n) === 1, "Queda una sola vez en el chat");

const T = link.token;
const view = (await anon("select public.erp_sr_sign_link_get($1) r", [T]))[0].r;
ok(view.number === 7 && view.items[0].name === "TERMO" && view.from.name === "Pioneros" && view.to.name === "Bodega", "Sin iniciar sesión se ve el pedido y sus productos", view);
ok(/no es válido/.test(await err(() => anon("select public.erp_sr_sign_link_get($1)", ["f".repeat(64)])) ?? ""), "Un enlace inventado no abre nada");

ok(/Primero se firma «Preparó»/.test(await err(() => anon("select public.erp_sr_sign_link_sign($1, 'sent', 'JUAN PEREZ', null, $2)", [T, SIG])) ?? ""), "No se puede firmar «Revisó» antes de «Preparó»");
ok(/firma/.test(await err(() => anon("select public.erp_sr_sign_link_sign($1, 'packed', 'JUAN PEREZ', null, 'hola')", [T])) ?? ""), "Sin firma dibujada no se firma");
const after = (await anon("select public.erp_sr_sign_link_sign($1, 'packed', 'juan perez', '1037', $2, 'cajas selladas') r", [T, SIG]))[0].r;
const s1 = after.signatures.find((x) => x.step === "packed");
ok(s1 && s1.signer_name === "JUAN PEREZ" && s1.via === "link" && s1.signer_doc === "1037", "Juan (bodeguero) firma «Preparó» desde el enlace", after.signatures);
const req = (await raw("select status, handled_by_name from erp_stock_requests where id = $1", [R]))[0];
ok(req.status === "preparing" && req.handled_by_name === "JUAN PEREZ", "Firmar «Preparó» pone el pedido en preparación", req);
const msg = (await raw("select body from erp_stock_request_messages where request_id = $1 order by created_at desc limit 1", [R]))[0].body;
ok(msg.includes("JUAN PEREZ firmó «Preparó» desde el enlace: cajas selladas"), "Queda en el chat", msg);
ok((await raw("select count(*) n from copias_al_traslado where request_id = $1 and step = 'packed'", [R]))[0].n == 1, "Se pide copiar la firma al traslado");
ok(/ya está firmado/.test(await err(() => anon("select public.erp_sr_sign_link_sign($1, 'packed', 'OTRO NOMBRE', null, $2)", [T, SIG])) ?? ""), "No se firma dos veces el mismo paso");
await anon("select public.erp_sr_sign_link_sign($1, 'sent', 'MARIA LOPEZ', null, $2)", [T, SIG]);
ok(Number((await raw("select count(*) n from erp_stock_request_signatures where request_id = $1", [R]))[0].n) === 2, "María firma «Revisó»");
ok(/seguimiento del envío/.test(await err(() => anon("select public.erp_sr_sign_link_sign($1, 'delivered', 'PEDRO', null, $2)", [T, SIG])) ?? ""), "«En camino» se firma en el seguimiento del envío");

await raw("update erp_sr_sign_links set expires_at = now() - interval '1 day' where token = $1", [T]);
await raw("delete from erp_stock_request_signatures where request_id = $1 and step = 'sent'", [R]);
ok(/venció/.test(await err(() => anon("select public.erp_sr_sign_link_sign($1, 'sent', 'MARIA LOPEZ', null, $2)", [T, SIG])) ?? ""), "Un enlace vencido ya no firma");
const renewed = (await as(SARA, "select public.erp_sr_sign_link($1) r", [R]))[0].r;
ok(renewed.token !== T, "Pedirlo de nuevo da un enlace nuevo");
ok(/permission denied/.test(await err(() => anon("select * from erp_sr_sign_links")) ?? ""), "La tabla de enlaces no se puede leer directamente");

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exitCode = fail ? 1 : 0;
