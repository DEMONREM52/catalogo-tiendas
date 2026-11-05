// Pruebas de 20261280: recibir el traslado (por el panel o el enlace) también cierra su pedido interno.
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
alter table public.erp_warehouses add column if not exists phone text;
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists number int;
alter table public.erp_stock_requests add column if not exists transfer_id uuid;
alter table public.erp_stock_requests add column if not exists last_message_at timestamptz;
alter table public.erp_stock_requests add column if not exists updated_at timestamptz default now();
alter table public.erp_stock_requests add column if not exists closed_at timestamptz;
create table if not exists public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid not null, product_id uuid not null,
  qty_requested integer not null, qty_approved integer, qty_received integer, note text);
create table if not exists public.erp_stock_request_signatures (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid not null,
  step text not null, signer_name text not null, signer_doc text, signature text, notes text, via text not null default 'dashboard', user_id uuid, signed_at timestamptz not null default now());
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp__sr_access(p_store uuid, p_from uuid, p_to uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('attend', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_to),
                            'request', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and point_id = p_from),
                            'view', exists (select 1 from stores where id = p_store and owner_id = auth.uid()));
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_pt_${process.pid}.sql`);
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
const M = fs.readFileSync(path.join(MIG, "20261280_pedido_traslado_unidos.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const U = (n) => `cf800000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), STRANGER = U(9);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'Z', true, 'point') returning id", [A]);
const prod = async (n) => (await raw("insert into products (store_id, name, stock, cost_price) values ($1, $2, 0, 1000) returning id", [A, n]))[0].id;
const P = await prod("OLLA"), Q = await prod("BATIDORA");
for (const p of [P, Q]) await raw("select public.erp__move($1, $2, $3, 100, 'purchase', 'test', null, 1000, 'carga', null, true)", [A, B1, p]);

async function requestWithTransfer(n) {
  const [{ id: T }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: P, qty: 5 }, { product_id: Q, qty: 3 }])]);
  const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, status, number, transfer_id) values ($1, $2, $3, 'dispatched', $4, $5) returning id", [A, Z, B1, n, T]);
  await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested, qty_approved) values ($1, $2, 5, 5), ($1, $3, 3, 3)", [R, P, Q]);
  return { T, R };
}

// 1) Recibido desde Inventario → Traslados (erp_confirm_transfer de producción), con un faltante.
const one = await requestWithTransfer(1);
await as(OWNER, "select public.erp_confirm_transfer($1, $2::jsonb, 'una batidora rota')", [one.T, JSON.stringify([{ product_id: P, received_qty: 5 }, { product_id: Q, received_qty: 2 }])]);
const r1 = (await raw("select status, closed_at from erp_stock_requests where id = $1", [one.R]))[0];
const i1 = await raw("select product_id, qty_received from erp_stock_request_items where request_id = $1", [one.R]);
const m1 = await raw("select body from erp_stock_request_messages where request_id = $1 and kind = 'system'", [one.R]);
const s1 = await raw("select step, via from erp_stock_request_signatures where request_id = $1", [one.R]);
ok(r1.status === "received" && r1.closed_at, "Al recibir el traslado en el panel, el pedido queda «Recibido»", r1);
ok(i1.find((i) => i.product_id === P)?.qty_received === 5 && i1.find((i) => i.product_id === Q)?.qty_received === 2, "El pedido guarda lo que llegó de cada producto", i1);
ok(m1.length === 1 && /traslado #\d+/.test(m1[0].body) && /faltaron 1 und/.test(m1[0].body) && /batidora rota/.test(m1[0].body), "Queda la constancia en el chat con el faltante y la nota", m1);
ok(s1.length === 1 && s1[0].step === "received", "La firma de «Recibió» se copia al pedido", s1);

// 2) Si el pedido ya se cerró por su lado (Pedidos internos), no se toca ni se repite el mensaje.
const two = await requestWithTransfer(2);
await raw("update erp_stock_requests set status = 'received' where id = $1", [two.R]);
await raw("update erp_stock_request_items set qty_received = 4 where request_id = $1 and product_id = $2", [two.R, P]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, null)", [two.T]);
const i2 = await raw("select qty_received from erp_stock_request_items where request_id = $1 and product_id = $2", [two.R, P]);
const m2 = await raw("select count(*)::int n from erp_stock_request_messages where request_id = $1", [two.R]);
ok(i2[0].qty_received === 4 && m2[0].n === 0, "Si el pedido ya estaba recibido, no se cambia nada", { i2, m2 });

// 3) Todo en la misma transacción: si la función cierra el pedido después de recibir el traslado, el disparador (diferido) no lo duplica.
const three = await requestWithTransfer(3);
await db.exec("begin");
await raw("select set_config('test.uid', $1, true)", [OWNER]);
await raw("select public.erp_confirm_transfer($1, null, null)", [three.T]);
await raw("update erp_stock_requests set status = 'received' where id = $1", [three.R]);
await db.exec("commit");
const m3 = await raw("select count(*)::int n from erp_stock_request_messages where request_id = $1", [three.R]);
ok(m3[0].n === 0, "Diferido: si el pedido se cerró en la misma operación, no hay mensaje doble", m3);

// 4) Un traslado sin pedido se recibe igual que siempre.
const [{ id: T4 }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: P, qty: 1 }])]);
const plain = await as(OWNER, "select public.erp_confirm_transfer($1, null, null)", [T4]).then(() => "ok").catch((e) => e.message);
ok(plain === "ok" && (await raw("select status from erp_transfers where id = $1", [T4]))[0].status === "received", "Traslado sin pedido: se recibe normal", plain);

// 5) Aunque la parte del pedido falle, la recepción del traslado no se frena.
const five = await requestWithTransfer(5);
await raw("alter table erp_stock_request_messages add constraint corto check (char_length(body) < 5) not valid");
const res5 = await as(OWNER, "select public.erp_confirm_transfer($1, null, null)", [five.T]).then(() => "ok").catch((e) => e.message);
await raw("alter table erp_stock_request_messages drop constraint corto");
ok(res5 === "ok" && (await raw("select status from erp_transfers where id = $1", [five.T]))[0].status === "received", "Si algo del pedido falla, el traslado igual queda recibido", res5);

// 6) Enlazar en pantalla: el pedido de cada traslado, solo para quien puede verlo.
const links = (await as(OWNER, "select public.erp_transfer_requests($1, $2::uuid[]) r", [A, [one.T, T4]]))[0].r;
ok(Array.isArray(links) && links.length === 1 && links[0].number === 1 && links[0].request_id === one.R, "El panel sabe qué pedido originó cada traslado", links);
const hidden = (await as(STRANGER, "select public.erp_transfer_requests($1, $2::uuid[]) r", [A, [one.T]]))[0].r;
ok(Array.isArray(hidden) && hidden.length === 0, "Quien no tiene acceso no ve el pedido", hidden);
const anon = await db.query("select has_function_privilege('anon', 'public.erp_transfer_requests(uuid, uuid[])', 'execute') r");
ok(anon.rows[0].r === false, "Sin sesión no se puede consultar");

// 7) 20261281: llegó de más.
const M2 = fs.readFileSync(path.join(MIG, "20261281_traslado_llego_de_mas.sql"), "utf8");
await db.exec(M2);
await db.exec(M2);
const qty = async (w, p) => Number((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [w, p]))[0]?.qty ?? 0);
const seven = await requestWithTransfer(7);
const [bP, bQ, zP] = [await qty(B1, P), await qty(B1, Q), await qty(Z, P)];
await as(OWNER, "select public.erp_confirm_transfer($1, $2::jsonb, 'venía una de más')", [seven.T, JSON.stringify([{ product_id: P, received_qty: 6 }, { product_id: Q, received_qty: 3 }])]);
ok(await qty(Z, P) === zP + 6 && await qty(B1, P) === bP - 1 && await qty(B1, Q) === bQ, "Llegó una de más: el destino suma 6 y esa unidad sale del origen", { z: await qty(Z, P) - zP, b: await qty(B1, P) - bP });
const ti7 = await raw("select received_qty from erp_transfer_items where transfer_id = $1 and product_id = $2", [seven.T, P]);
const m7 = await raw("select body from erp_stock_request_messages where request_id = $1", [seven.R]);
ok(ti7[0].received_qty === 6 && m7.length === 1 && /llegaron 1 und\. de más/.test(m7[0].body), "Queda anotado y el chat del pedido dice «llegaron 1 de más»", { ti7, m7 });
const [{ id: T8 }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: Q, qty: 1 }])]);
const tooMany = await as(OWNER, "select public.erp_confirm_transfer($1, $2::jsonb, null)", [T8, JSON.stringify([{ product_id: Q, received_qty: 9999 }])]).then(() => null).catch((e) => e.message);
ok(typeof tooMany === "string" && /origen solo tiene/.test(tooMany) && (await raw("select status from erp_transfers where id = $1", [T8]))[0].status === "in_transit", "Si el origen no tiene esas unidades de más, no deja recibir y lo explica", tooMany);
const neg = await as(OWNER, "select public.erp_confirm_transfer($1, $2::jsonb, null)", [T8, JSON.stringify([{ product_id: Q, received_qty: -1 }])]).then(() => null).catch((e) => e.message);
ok(typeof neg === "string" && /no es válida/.test(neg), "Cantidades negativas siguen sin aceptarse", neg);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
