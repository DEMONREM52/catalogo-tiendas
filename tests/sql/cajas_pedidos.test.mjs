// Pruebas de 20261348: cajas en los pedidos internos (sin mover inventario, sin perder unidades, sin repetir).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists number int;
alter table public.erp_stock_requests add column if not exists updated_at timestamptz default now();
create table if not exists public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid not null references public.erp_stock_requests(id) on delete cascade, product_id uuid not null,
  qty_requested integer not null, qty_approved integer, qty_received integer);
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid,
  user_id uuid, user_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create or replace function public.erp__sr_perms(p_store uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from stores where id = p_store and owner_id = auth.uid())
    then jsonb_build_object('pt', null, 'manage', true, 'transfers', true, 'req', true)
    else jsonb_build_object('pt', (select point_id from store_users where store_id = p_store and user_id = auth.uid()),
      'manage', false, 'transfers', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid()), 'req', true) end;
$$;
create or replace function public.erp__sr_access(p_store uuid, p_from uuid, p_to uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'attend', ((p->>'manage')::boolean or (p->>'transfers')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_to),
    'request', ((p->>'pt') is null or (p->>'pt')::uuid = p_from)) from (select public.erp__sr_perms(p_store) p) x;
$$;
create or replace function public.erp__sr_visible(p_request uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from erp_stock_requests r cross join lateral (select public.erp__sr_access(r.store_id, r.from_point_id, r.to_point_id) a) x
    where r.id = p_request and ((x.a->>'attend')::boolean or (x.a->>'request')::boolean));
$$;
create or replace function public.erp_actor_name(p_store uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from store_users where store_id = p_store and user_id = auth.uid()), 'Dueño');
$$;
create or replace function public.erp__sr_system(p_request uuid, p_body text) returns void language sql security definer set search_path = public as $$
  insert into public.erp_stock_request_messages (request_id, user_id, kind, body) values (p_request, auth.uid(), 'system', p_body);
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_sr_cajas_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261348_cajas_pedidos.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a2400000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), SANTI = U(3), OTRO = U(5);
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
const put = (u, R, box, items, nw = null, key = null) => as(u, "select public.erp_sr_box_put($1, $2, $3::jsonb, $4::jsonb, $5) r", [R, box, J(items), nw ? J(nw) : null, key]).then((x) => x[0].r);
const boxes = async (u, R) => (await as(u, "select public.erp_sr_boxes($1) r", [R]))[0].r;
const inBoxes = async (item) => Number((await raw("select coalesce(sum(qty),0) n from erp_sr_box_items where item_id = $1", [item]))[0].n);
const nBoxes = async () => Number((await raw("select count(*) n from erp_sr_box"))[0].n);
const msgs = async (R) => (await raw("select body from erp_stock_request_messages where request_id = $1 order by created_at", [R])).map((x) => x.body);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('cajas', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), Z = await wh("Z", "Zamora"), C = await wh("C", "Centro");
await raw("insert into store_users (store_id, user_id, role, point_id, display_name) values ($1, $2, 'seller', $3, 'Sara'), ($1, $4, 'seller', $5, 'Santiago'), ($1, $6, 'seller', $7, 'Otro')",
  [A, SARA, B, SANTI, Z, OTRO, C]);
const prod = async (n) => (await raw("insert into products (store_id, name) values ($1, $2) returning id", [A, n]))[0].id;
const P = [];
for (const n of ["COJIN", "CEPILLO", "RELOJ K41", "PATILLERA WB999", "ATOMIZADOR K7", "OLLA", "SARTEN"]) P.push(await prod(n));
// Zamora le pide a la Bodega: la Bodega (Sara) despacha.
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, number, status) values ($1, $2, $3, 582, 'preparing') returning id", [A, Z, B]);
const I = [];
for (const [k, p] of P.entries()) I.push((await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, $3) returning id", [R, p, k === 0 ? 100 : 6]))[0].id);
const snapshot = async () => J(await raw("select * from products where store_id = $1 order by id", [A]));
const stock0 = await snapshot();

console.log("Permisos");
ok(/Solo quien despacha/.test(await err(SANTI, "select public.erp_sr_box_put($1, null, $2::jsonb)", [R, J([{ item_id: I[1], qty: 1 }])]) ?? ""), "Quien pidió no arma cajas");
ok(/Solo quien despacha/.test(await err(OTRO, "select public.erp_sr_box_put($1, null, $2::jsonb)", [R, J([{ item_id: I[1], qty: 1 }])]) ?? ""), "Otro punto tampoco");
const otro = await boxes(OTRO, R);
ok(otro.boxes.length === 0 && otro.can_edit === false, "Otro punto no ve las cajas", otro);
ok(/no está en el pedido/.test(await err(SARA, "select public.erp_sr_box_put($1, null, $2::jsonb)", [R, J([{ item_id: "00000000-0000-0000-0000-000000000000", qty: 1 }])]) ?? ""), "Un producto de otro pedido: no");
ok(/cantidad válida/.test(await err(SARA, "select public.erp_sr_box_put($1, null, $2::jsonb)", [R, J([{ item_id: I[1], qty: 0 }])]) ?? ""), "Cantidad 0: no");
ok(/cantidad válida/.test(await err(SARA, "select public.erp_sr_box_put($1, null, $2::jsonb)", [R, J([{ item_id: I[1], qty: "2.5" }])]) ?? ""), "Decimales: no");
ok((await nBoxes()) === 0, "Los intentos fallidos no dejan cajas a medias");

console.log("Caja 1 y Caja 2");
const KEY1 = "c0000000-0000-0000-0000-000000000001";
const c1 = await put(SARA, R, null, I.slice(1, 6).map((x) => ({ item_id: x, qty: 6 })), { name: "Frágiles", color: "#22c55e" }, KEY1);
ok(c1.ok && c1.number === 1 && c1.refs === 5 && c1.units === 30, "Cinco productos → Caja 1 (5 ref · 30 und)", c1);
const again = await put(SARA, R, null, I.slice(1, 6).map((x) => ({ item_id: x, qty: 6 })), { name: "Frágiles" }, KEY1);
ok(again.repeated && again.box_id === c1.box_id && (await nBoxes()) === 1, "Doble toque con la misma llave: una sola caja", again);
ok((await msgs(R)).at(-1) === "📦 Sara armó la Caja 1 «Frágiles»: 5 ref. · 30 und.", "Queda en el chat", await msgs(R));
const c2 = await put(SARA, R, null, [{ item_id: I[0], qty: 30 }, { item_id: I[6], qty: 6 }]);
ok(c2.number === 2, "Otros productos → Caja 2", c2);

console.log("Un producto repartido en varias cajas");
const c3 = await put(SARA, R, null, [{ item_id: I[0], qty: 40 }]);
await put(SARA, R, c3.box_id, [{ item_id: I[0], qty: 20 }]);
ok((await inBoxes(I[0])) === 90, "COJÍN: 30 en la Caja 2 + 60 en la Caja 3 = 90; quedan 10 sin caja");
ok(/solo quedan 10 sin caja/.test(await err(SARA, "select public.erp_sr_box_put($1, $2, $3::jsonb)", [R, c2.box_id, J([{ item_id: I[0], qty: 11 }])]) ?? ""), "No se mete más de lo que se envía (ni una unidad en dos cajas)");
ok(/solo quedan 0 sin caja/.test(await err(SARA, "select public.erp_sr_box_put($1, null, $2::jsonb)", [R, J([{ item_id: I[1], qty: 1 }])]) ?? "") && (await nBoxes()) === 3, "Producto ya todo en cajas: no se crea una caja vacía");
ok(/solo quedan 10/.test(await err(SARA, "select public.erp_sr_box_put($1, $2, $3::jsonb)", [R, c2.box_id, J([{ item_id: I[0], qty: 6 }, { item_id: I[0], qty: 6 }])]) ?? ""), "Repetido en la misma lista: se suma antes de validar");
// Dos personas a la vez: el dueño también despacha. Lo que deja el primero lo ve el segundo.
await put(OWNER, R, c2.box_id, [{ item_id: I[0], qty: 10 }]);
ok(/solo quedan 0/.test(await err(SARA, "select public.erp_sr_box_put($1, $2, $3::jsonb)", [R, c3.box_id, J([{ item_id: I[0], qty: 10 }])]) ?? "") && (await inBoxes(I[0])) === 100, "Dos personas empacando: la segunda no puede volver a meter las mismas 10");

console.log("Mover, sacar, cerrar, borrar");
let mv = (await as(SARA, "select public.erp_sr_box_move($1, $2, $3::jsonb) r", [c3.box_id, c2.box_id, J([{ item_id: I[0], qty: 20 }])]))[0].r;
ok(mv.ok && mv.from === 3 && mv.to === 2, "Mover 20 de la Caja 3 a la Caja 2", mv);
let b = await boxes(SARA, R);
const q = (n, item) => b.boxes.find((x) => x.number === n)?.items.find((x) => x.item_id === item)?.qty ?? 0;
ok(q(2, I[0]) === 60 && q(3, I[0]) === 40 && (await inBoxes(I[0])) === 100, "Totales cuadran: 60 + 40 = 100", b.boxes.map((x) => [x.number, x.items]));
mv = (await as(SARA, "select public.erp_sr_box_move($1, null, $2::jsonb) r", [c3.box_id, J([{ item_id: I[0], qty: 15 }])]))[0].r;
ok(mv.to === 4 && (await inBoxes(I[0])) === 100, "Mover a una caja nueva (Caja 4)", mv);
ok(/hay 25 de COJIN/.test(await err(SARA, "select public.erp_sr_box_take($1, $2::jsonb)", [c3.box_id, J([{ item_id: I[0], qty: 30 }])]) ?? ""), "No se saca más de lo que hay");
await as(SARA, "select public.erp_sr_box_take($1, $2::jsonb)", [c3.box_id, J([{ item_id: I[0], qty: 5 }])]);
ok((await inBoxes(I[0])) === 95, "Sacar 5: vuelven a «sin caja»");
const c5 = await put(SARA, R, null, [{ item_id: I[0], qty: 1 }]);
await as(SARA, "select public.erp_sr_box_take($1)", [c5.box_id]);
ok(/está vacía/.test(await err(SARA, "select public.erp_sr_box_close($1, true)", [c5.box_id]) ?? ""), "Una caja vacía no se cierra");
await as(SARA, "select public.erp_sr_box_update($1, $2::jsonb)", [c1.box_id, J({ seal: "PR-778", weight_kg: "4.5", fragile: true, color: "#0ea5e9" })]);
const cl = (await as(SARA, "select public.erp_sr_box_close($1, true) r", [c1.box_id]))[0].r;
ok(cl.status === "closed" && (await msgs(R)).at(-1) === "🔒 Sara cerró la Caja 1 «Frágiles»: 5 ref. · 30 und. · sello PR-778", "Cerrar la Caja 1 (con sello) queda en el chat", await msgs(R));
ok(/está cerrada/.test(await err(SARA, "select public.erp_sr_box_take($1)", [c1.box_id]) ?? ""), "Caja cerrada: no se saca nada");
ok(/está cerrada/.test(await err(SARA, "select public.erp_sr_box_put($1, $2, $3::jsonb)", [R, c1.box_id, J([{ item_id: I[0], qty: 1 }])]) ?? ""), "Caja cerrada: no se agrega nada");
const reab = (await as(SARA, "select public.erp_sr_box_close($1, false) r", [c1.box_id]))[0].r;
ok(reab.status === "open" && (await msgs(R)).at(-1).startsWith("🔓 Sara volvió a abrir la Caja 1"), "Volver a abrir queda en el chat", await msgs(R));
await as(SARA, "select public.erp_sr_box_close($1, true)", [c1.box_id]);
ok(/Color no válido/.test(await err(SARA, "select public.erp_sr_box_update($1, $2::jsonb)", [c1.box_id, J({ color: "red;" })]) ?? ""), "Color raro: no");
ok(/Peso no válido/.test(await err(SARA, "select public.erp_sr_box_update($1, $2::jsonb)", [c1.box_id, J({ weight_kg: "-1" })]) ?? ""), "Peso raro: no");
ok(/tiene productos/.test(await err(SARA, "select public.erp_sr_box_delete($1)", [c3.box_id]) ?? ""), "Una caja con productos no se borra (nunca se pierden)");
await as(SARA, "select public.erp_sr_box_take($1)", [c3.box_id]);
ok((await inBoxes(I[0])) === 75, "Vaciar la Caja 3: sus 20 vuelven a «sin caja»");
await as(SARA, "select public.erp_sr_box_delete($1)", [c3.box_id]);
b = await boxes(SARA, R);
ok(b.boxes.map((x) => x.number).join(",") === "1,2,4,5", "Borrar la Caja 3 vacía: las demás conservan su número", b.boxes.map((x) => x.number));
const c6 = await put(SARA, R, null, [{ item_id: I[0], qty: 1 }]);
ok(c6.number === 6, "La siguiente caja es la 6 (no repite números)", c6);

console.log("QR de la caja");
const tok = b.boxes.find((x) => x.number === 1).token;
ok((await as(SANTI, "select public.erp_sr_box_resolve($1) r", [tok]))[0].r?.number === 1, "Quien recibe escanea la caja y llega a su pedido");
ok((await as(OTRO, "select public.erp_sr_box_resolve($1) r", [tok]))[0].r === null, "Otro punto: el QR no dice nada");
ok(Number((await as(OTRO, "select count(*) n from erp_sr_box"))[0].n) === 0, "Otro punto no lee la tabla");
ok(/permission denied|denegado/i.test(await err(SARA, "insert into erp_sr_box (request_id, store_id, number) values ($1, $2, 99)", [R, A]) ?? ""), "No se escribe directo en las tablas");

console.log("Inventario intacto y pedido enviado");
ok((await snapshot()) === stock0, "Armar cajas no mueve el inventario");
await raw("update erp_stock_requests set status = 'dispatched' where id = $1", [R]);
ok(/ya salió/.test(await err(SARA, "select public.erp_sr_box_close($1, false)", [c1.box_id]) ?? ""), "Pedido en camino: las cajas ya no se cambian");
b = await boxes(SANTI, R);
ok(b.can_edit === false && b.boxes.length === 5, "Quien recibe ve las cajas (solo ver)", b);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
