// Pruebas de 20261349: el traslado hecho en Inventario también es pedido interno (sin mover inventario dos veces),
// se sincroniza al corregirlo, deja armar cajas mientras va en camino, recibir por caja y ver las cajas en su enlace.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
create table if not exists public.erp_transfer_signatures (id uuid primary key default gen_random_uuid(), transfer_id uuid, store_id uuid, step text,
  signer_name text, signer_doc text, signature text, notes text, via text, user_id uuid, signed_at timestamptz default now(), unique (transfer_id, step));
alter table public.erp_transfers add column if not exists checked_by_name text;
alter table public.erp_transfers add column if not exists track_token uuid default gen_random_uuid();
alter table public.erp_transfers add column if not exists track_expires_at timestamptz;
alter table public.erp_warehouses add column if not exists phone text;
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists number int;
alter table public.erp_stock_requests add column if not exists transfer_id uuid;
alter table public.erp_stock_requests add column if not exists note text;
alter table public.erp_stock_requests add column if not exists requested_by_name text;
alter table public.erp_stock_requests add column if not exists handled_by_name text;
alter table public.erp_stock_requests add column if not exists last_message_at timestamptz;
alter table public.erp_stock_requests add column if not exists updated_at timestamptz default now();
alter table public.erp_stock_requests add column if not exists closed_at timestamptz;
create table if not exists public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  product_id uuid not null, qty_requested integer not null, qty_approved integer, qty_received integer, source_qty_at_request integer, dest_qty_at_request integer, note text);
create table if not exists public.erp_stock_request_signatures (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid not null,
  step text not null, signer_name text not null, signer_doc text, signature text, notes text, via text not null default 'dashboard', user_id uuid, signed_at timestamptz not null default now());
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp__sr_access(p_store uuid, p_from uuid, p_to uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('attend', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_to),
                            'request', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_from),
                            'view', exists (select 1 from stores where id = p_store and owner_id = auth.uid()));
$$;
create or replace function public.erp__sr_visible(p_request uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from erp_stock_requests r cross join lateral (select public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id) a) x
    where r.id = p_request and ((x.a->>'attend')::boolean or (x.a->>'request')::boolean or (x.a->>'view')::boolean));
$$;
create or replace function public.erp__sr_system(p_request uuid, p_body text) returns void language sql security definer set search_path = public as $$
  insert into public.erp_stock_request_messages (request_id, user_id, kind, body) values (p_request, auth.uid(), 'system', p_body);
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_tp_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_finanzas.sql"), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
  ...["20261124_credito_traslados.sql", "20261125_rentabilidad_cadena.sql", "20261126_varias_bodegas.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261277_pedido_checklist.sql", "20261280_pedido_traslado_unidos.sql", "20261283_comentarios_por_producto.sql", "20261348_cajas_pedidos.sql", "20261349_traslado_es_pedido.sql", "20261349_traslado_es_pedido.sql"]) {
  await db.exec(fs.readFileSync(path.join(MIG, f), "utf8"));
}

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const J = (x) => JSON.stringify(x);
const U = (n) => `cf900000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), BODEGA = U(2), ZAMORA = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('tp', 'LA VITRINA', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'Sede Zamora', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, point_id, display_name, active) values ($1, $2, 'seller', $3, 'Sara', true), ($1, $4, 'seller', $5, 'Santiago', true)", [A, BODEGA, B1, ZAMORA, Z]);
const prod = async (n) => (await raw("insert into products (store_id, name, stock, cost_price) values ($1, $2, 0, 1000) returning id", [A, n]))[0].id;
const P = await prod("OLLA"), Q = await prod("BATIDORA"), S = await prod("SARTEN");
for (const p of [P, Q, S]) await raw("select public.erp__move($1, $2, $3, 100, 'purchase', 'test', null, 1000, 'carga', null, true)", [A, B1, p]);
const level = async (wh, p) => Number((await raw("select coalesce((select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2), 0) q", [wh, p]))[0].q);
const pedidoOf = async (T) => (await raw("select * from erp_stock_requests where transfer_id = $1", [T]));
const itemsOf = async (R) => (await raw("select i.id, i.product_id, i.qty_requested, i.qty_approved from erp_stock_request_items i where i.request_id = $1 order by i.qty_requested desc", [R]));

console.log("Traslado de Inventario → pedido interno");
await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, status, number) values ($1, $2, $3, 'received', 7)", [A, Z, B1]);
const [{ id: T1 }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'para la vitrina', $4::jsonb) id", [A, B1, Z, J([{ product_id: P, qty: 10 }, { product_id: Q, qty: 4 }])]);
let peds = await pedidoOf(T1);
ok(peds.length === 1, "Se crea un solo pedido unido al traslado", peds.length);
const R1 = peds[0];
ok(R1.origin === "transfer" && R1.status === "dispatched" && R1.from_point_id === Z && R1.to_point_id === B1, "En camino: entrante para Zamora (pide/recibe), saliente para la Bodega (despacha)", R1);
ok(R1.number === 8, "Toma el siguiente número de pedido (8)", R1.number);
ok(/Traslado #\d+ hecho en Inventario · para la vitrina/.test(R1.note ?? ""), "La nota dice de qué traslado viene", R1.note);
let it = await itemsOf(R1.id);
ok(it.length === 2 && it[0].qty_requested === 10 && it[0].qty_approved === 10 && it[1].qty_approved === 4, "Mismos productos y cantidades", it);
ok((await raw("select body from erp_stock_request_messages where request_id = $1", [R1.id]))[0]?.body.includes("hizo el traslado #"), "Queda en el chat");
ok((await level(B1, P)) === 90 && (await level(Z, P)) === 0, "El inventario salió UNA vez (lo movió el traslado)");

console.log("Un pedido que se envía (crea su traslado) no se duplica");
await db.exec("set role postgres");
await raw("begin");
await raw("select set_config('test.uid', $1, true)", [OWNER]);
const [{ id: T2 }] = await raw("select public.erp_create_transfer($1, $2, $3, 'del pedido', $4::jsonb) id", [A, B1, Z, J([{ product_id: S, qty: 2 }])]);
await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, status, number, transfer_id) values ($1, $2, $3, 'dispatched', 50, $4)", [A, Z, B1, T2]);
await raw("commit");
await db.exec("reset role");
peds = await pedidoOf(T2);
ok(peds.length === 1 && peds[0].number === 50 && peds[0].origin === "request", "Solo queda el pedido que lo envió", peds.map((x) => [x.number, x.origin]));

console.log("Corregir el traslado → su pedido");
await raw("update erp_transfer_items set qty = 12 where transfer_id = $1 and product_id = $2", [T1, P]);
await raw("insert into erp_transfer_items (transfer_id, product_id, qty) values ($1, $2, 3)", [T1, S]);
await raw("delete from erp_transfer_items where transfer_id = $1 and product_id = $2", [T1, Q]);
it = await itemsOf(R1.id);
ok(it.length === 2 && it.find((x) => x.product_id === P)?.qty_approved === 12 && it.find((x) => x.product_id === S)?.qty_approved === 3 && !it.some((x) => x.product_id === Q), "Mismos productos y cantidades después de corregir", it);
const IP = it.find((x) => x.product_id === P).id, IS = it.find((x) => x.product_id === S).id;

console.log("Cajas mientras va en camino");
const c1 = (await as(BODEGA, "select public.erp_sr_box_put($1, null, $2::jsonb) r", [R1.id, J([{ item_id: IP, qty: 8 }])]))[0].r;
const c2 = (await as(BODEGA, "select public.erp_sr_box_put($1, null, $2::jsonb) r", [R1.id, J([{ item_id: IP, qty: 4 }, { item_id: IS, qty: 3 }])]))[0].r;
ok(c1.number === 1 && c2.number === 2, "La Bodega arma la Caja 1 y la Caja 2 aunque el traslado ya salió", [c1, c2]);
ok(/Solo quien despacha/.test(await err(ZAMORA, "select public.erp_sr_box_put($1, null, $2::jsonb)", [R1.id, J([{ item_id: IP, qty: 1 }])]) ?? ""), "Zamora no arma cajas");
const RX = (await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, status, number) values ($1, $2, $3, 'dispatched', 60) returning id", [A, Z, B1]))[0].id;
const IX = (await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, 1) returning id", [RX, P]))[0].id;
ok(/ya salió/.test(await err(BODEGA, "select public.erp_sr_box_put($1, null, $2::jsonb)", [RX, J([{ item_id: IX, qty: 1 }])]) ?? ""), "Un pedido normal ya enviado: sin cambios en cajas (como antes)");
let bx = (await as(ZAMORA, "select public.erp_sr_boxes($1) r", [R1.id]))[0].r;
ok(bx.can_receive === true && bx.can_edit === false && bx.origin === "transfer", "Zamora puede marcar cajas recibidas", bx);

console.log("Recibir por caja");
let rc = (await as(ZAMORA, "select public.erp_sr_box_receive($1, true) r", [c1.box_id]))[0].r;
const checks = async () => (await raw("select item_id from erp_sr_item_checks where request_id = $1 and side = 'receive'", [R1.id])).map((x) => x.item_id);
ok(rc.received === 1 && rc.total === 2 && (await checks()).length === 0, "Caja 1 llegó: la OLLA aún no está completa (faltan 4 en la Caja 2)", [rc, await checks()]);
ok(/empezaron a recibirlo/.test(await err(BODEGA, "select public.erp_sr_box_take($1)", [c2.box_id]) ?? ""), "Ya empezaron a recibir: las cajas no se cambian");
rc = (await as(ZAMORA, "select public.erp_sr_box_receive($1, true) r", [c2.box_id]))[0].r;
ok(rc.received === 2 && (await checks()).length === 2, "Caja 2 llegó: OLLA y SARTÉN quedan chuleadas en «lo que llegó»", await checks());
ok((await raw("select body from erp_stock_request_messages where request_id = $1 order by created_at desc limit 1", [R1.id]))[0].body.includes("llegaron las 2 cajas"), "Queda en el chat");
await as(ZAMORA, "select public.erp_sr_box_receive($1, false)", [c2.box_id]);
ok((await checks()).length === 0, "Desmarcar la Caja 2 quita el chulo de lo que ya no está completo");
await as(ZAMORA, "select public.erp_sr_box_receive($1, true)", [c2.box_id]);
ok(/Solo quien recibe/.test(await err(BODEGA, "select public.erp_sr_box_receive($1, true)", [c1.box_id]) ?? ""), "La Bodega no marca lo recibido");
ok((await level(Z, P)) === 0, "Marcar cajas no mueve inventario");

console.log("Enlace del traslado");
const tok = (await raw("select track_token::text t from erp_transfers where id = $1", [T1]))[0].t;
const pub = (await as(null, "select public.erp_transfer_track_boxes($1) r", [tok]))[0].r;
ok(pub.length === 2 && pub[0].items[0].name === "OLLA" && pub[0].items[0].qty === 8 && pub[0].received_at, "El enlace muestra las cajas, su contenido y si llegaron", pub);
ok((await as(null, "select public.erp_transfer_track_boxes('cualquier-cosa') r"))[0].r.length === 0, "Con otro código no muestra nada");

console.log("Novedades por producto");
const nov = (await as(ZAMORA, "select public.erp_sr_item_comment_add($1, $2, 'Faltaron 2', 'missing', 2) r", [R1.id, IP]))[0].r;
ok(nov.ok, "Zamora registra «Faltó» en un producto", nov);
ok(/Etiqueta no válida/.test(await err(ZAMORA, "select public.erp_sr_item_comment_add($1, $2, 'x', 'raro')", [R1.id, IP]) ?? ""), "Un tipo de novedad desconocido: no");
ok((await level(Z, P)) === 0, "Registrar una novedad no mueve inventario");

console.log("Confirmar el recibido (una sola vez, como hoy)");
await as(OWNER, "select public.erp_confirm_transfer($1, null, '')", [T1]);
const after = (await raw("select status from erp_stock_requests where id = $1", [R1.id]))[0];
ok(after.status === "received", "Recibir el traslado cierra su pedido", after);
// (La corrección de arriba se simuló directo en la tabla, sin la función de editar que también mueve el origen: la Bodega queda en 90.)
ok((await level(Z, P)) === 12 && (await level(B1, P)) === 90, "Entró una sola vez a Zamora y recibir no volvió a tocar la Bodega", [await level(Z, P), await level(B1, P)]);
it = await itemsOf(R1.id);
ok(it.length === 2 && it.find((x) => x.product_id === P)?.qty_approved === 12, "El pedido no cambia después de recibir", it);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
