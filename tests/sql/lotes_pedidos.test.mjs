// Pruebas de 20261346: cantidades a enviar que no se pierden y lotes de pedidos internos (con deshacer).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Lo mínimo de pedidos internos y de 20261345 (permisos una vez: dueño sin punto = todo; cada uno atiende su punto).
const extra = `
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_stock_requests add column if not exists number int;
alter table public.erp_stock_requests add column if not exists priority text default 'normal';
alter table public.erp_stock_requests add column if not exists note text;
alter table public.erp_stock_requests add column if not exists needed_by date;
alter table public.erp_stock_requests add column if not exists requested_by_name text;
alter table public.erp_stock_requests add column if not exists handled_by_name text;
alter table public.erp_stock_requests add column if not exists updated_at timestamptz default now();
alter table public.erp_stock_requests add column if not exists last_message_at timestamptz;
alter table public.erp_stock_requests add column if not exists closed_at timestamptz;
create table if not exists public.erp_stock_request_items (id uuid primary key default gen_random_uuid(), request_id uuid not null, product_id uuid not null,
  qty_requested integer not null, qty_approved integer, qty_received integer, source_qty_at_request integer, dest_qty_at_request integer, note text);
create table if not exists public.erp_stock_request_messages (id uuid primary key default gen_random_uuid(), request_id uuid not null, store_id uuid,
  user_id uuid, user_name text, point_name text, body text not null, kind text not null default 'message', created_at timestamptz not null default clock_timestamp());
create table if not exists public.erp_stock_request_reads (request_id uuid, user_id uuid, last_read_at timestamptz);
create or replace function public.erp__sr_perms(p_store uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from stores where id = p_store and owner_id = auth.uid())
    then jsonb_build_object('pt', null, 'manage', true, 'transfers', true, 'req', true, 'audit', true)
    else jsonb_build_object('pt', (select point_id from store_users where store_id = p_store and user_id = auth.uid()),
      'manage', false, 'transfers', exists (select 1 from store_users where store_id = p_store and user_id = auth.uid()), 'req', true, 'audit', false) end;
$$;
create or replace function public.erp__sr_access_of(p jsonb, p_from uuid, p_to uuid)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'attend', ((p->>'manage')::boolean or (p->>'transfers')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_to),
    'request', ((p->>'req')::boolean or (p->>'manage')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_from),
    'view', (((p->>'manage')::boolean or (p->>'transfers')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_to))
         or (((p->>'req')::boolean or (p->>'manage')::boolean) and ((p->>'pt') is null or (p->>'pt')::uuid = p_from))
         or ((p->>'manage')::boolean and (p->>'pt') is null)
         or ((p->>'audit')::boolean and (p->>'pt') is null));
$$;
create or replace function public.erp_actor_name(p_store uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from store_users where store_id = p_store and user_id = auth.uid()), 'Dueño');
$$;
create or replace function public.erp__sr_system(p_request uuid, p_body text) returns void language sql security definer set search_path = public as $$
  insert into public.erp_stock_request_messages (request_id, user_id, kind, body) values (p_request, auth.uid(), 'system', p_body);
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_sr_lotes_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261346_lotes_pedidos.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a2300000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), SANTI = U(3), MARIA = U(4), OTRO = U(5);
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
const qty = async (item) => (await raw("select qty_approved q from erp_stock_request_items where id = $1", [item]))[0].q;
const set = (u, items) => as(u, "select public.erp_sr_qty_set($1::jsonb) r", [JSON.stringify(items)]);

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('lotes', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), V = await wh("V", "Vitrina"), M = await wh("M", "Mira Pues"), C = await wh("C", "Centro");
await raw(`insert into store_users (store_id, user_id, role, point_id, display_name) values
  ($1, $2, 'seller', $3, 'Sara'), ($1, $4, 'seller', $5, 'Santiago'), ($1, $6, 'seller', $7, 'Maria'), ($1, $8, 'seller', $9, 'Otro')`,
  [A, SARA, B, SANTI, V, MARIA, M, OTRO, C]);
const prod = async (n) => (await raw("insert into products (store_id, name) values ($1, $2) returning id", [A, n]))[0].id;
const COJIN = await prod("COJIN"), CEPILLO = await prod("CEPILLO");
const req = async (from, to, n, status = "pending") => (await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, number, status) values ($1, $2, $3, $4, $5) returning id", [A, from, to, n, status]))[0].id;
const item = async (R, p, q) => (await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, $3) returning id", [R, p, q]))[0].id;

const R64 = await req(V, B, 64), R66 = await req(M, B, 66, "preparing"), RC = await req(V, C, 70), RX = await req(V, B, 71, "dispatched");
const I64a = await item(R64, COJIN, 5), I64b = await item(R64, CEPILLO, 2), I66a = await item(R66, COJIN, 3), ICa = await item(RC, COJIN, 1), IXa = await item(RX, COJIN, 4);

console.log("Cantidades a enviar");
ok(/Solo quien despacha/.test(await err(SANTI, "select public.erp_sr_qty_set($1::jsonb)", [JSON.stringify([{ item_id: I64a, qty: 8 }])]) ?? ""), "Quien pidió no cambia lo que se envía");
ok(/Solo quien despacha/.test(await err(OTRO, "select public.erp_sr_qty_set($1::jsonb)", [JSON.stringify([{ item_id: I64a, qty: 8 }])]) ?? ""), "Otro punto tampoco");
let res = (await set(SARA, [{ item_id: I64a, qty: 8 }]))[0].r;
ok(res.changed === 1 && (await qty(I64a)) === 8, "Sara pone 8: queda guardado en la base (no solo en su pantalla)", res);
ok((await raw("select status from erp_stock_requests where id = $1", [R64]))[0].status === "pending", "Guardar la cantidad no toma el pedido");
ok((await msgs(R64)).at(-1) === "✏️ Sara: COJIN 5 → 8 para enviar.", "Queda en el chat", await msgs(R64));
await set(SARA, [{ item_id: I64a, qty: 9 }]);
ok((await msgs(R64)).length === 1 && (await msgs(R64))[0] === "✏️ Sara: COJIN 5 → 9 para enviar.", "Cambiarlo enseguida corrige el mismo mensaje (5 → 9)", await msgs(R64));
await set(SARA, [{ item_id: I64a, qty: 5 }]);
ok((await msgs(R64)).length === 0 && (await qty(I64a)) === 5, "Volver a lo pedido borra la constancia", await msgs(R64));
await set(SARA, [{ item_id: I64a, qty: 8 }]);
res = (await set(SARA, [{ item_id: I64a, qty: 8 }]))[0].r;
ok(res.changed === 0 && (await msgs(R64)).length === 1, "Guardar lo mismo otra vez no hace nada", res);
await as(OWNER, "select public.erp_sr_qty_set($1::jsonb)", [JSON.stringify([{ item_id: I64a, qty: 7 }])]);
ok((await msgs(R64)).length === 2 && (await msgs(R64))[1] === "✏️ Dueño: COJIN 8 → 7 para enviar.", "Si lo cambia otra persona, va en un mensaje aparte", await msgs(R64));
ok(/cantidad válida/.test(await err(SARA, "select public.erp_sr_qty_set($1::jsonb)", [JSON.stringify([{ item_id: I64b, qty: -1 }])]) ?? ""), "Cantidad negativa: no");
ok(/cantidad válida/.test(await err(SARA, "select public.erp_sr_qty_set($1::jsonb)", [JSON.stringify([{ item_id: I64b, qty: "2.5" }])]) ?? ""), "Cantidad con decimales: no");
ok(/ya salió/.test(await err(SARA, "select public.erp_sr_qty_set($1::jsonb)", [JSON.stringify([{ item_id: IXa, qty: 1 }])]) ?? ""), "Pedido en camino: ya no se cambia");
// Todo o nada: si uno falla, ninguno queda.
ok(/Solo quien despacha/.test(await err(SARA, "select public.erp_sr_qty_set($1::jsonb)", [JSON.stringify([{ item_id: I66a, qty: 1 }, { item_id: ICa, qty: 9 }])]) ?? "") && (await qty(I66a)) === null, "Todo o nada (uno de otro punto)");
await set(SARA, [{ item_id: I64b, qty: 0 }]);
ok((await qty(I64b)) === 0, "Se puede poner 0 (no se envía ese producto)");

console.log("Lotes");
ok(/al menos dos/.test(await err(SARA, "select public.erp_sr_batch_create($1, $2::uuid[])", [A, `{${R64}}`]) ?? ""), "Un solo pedido: no es lote");
ok(/mismo lugar/.test(await err(OWNER, "select public.erp_sr_batch_create($1, $2::uuid[])", [A, `{${R64},${RC}}`]) ?? ""), "Pedidos que salen de lugares distintos: no");
ok(/ya salió/.test(await err(SARA, "select public.erp_sr_batch_create($1, $2::uuid[])", [A, `{${R64},${RX}}`]) ?? ""), "Uno en camino: no");
ok(/no lo despachas/.test(await err(SANTI, "select public.erp_sr_batch_create($1, $2::uuid[])", [A, `{${R64},${R66}}`]) ?? ""), "Quien pidió no arma lotes");
const KEY = "b0000000-0000-0000-0000-000000000001";
const b1 = (await as(SARA, "select public.erp_sr_batch_create($1, $2::uuid[], $3) r", [A, `{${R64},${R66}}`, KEY]))[0].r;
ok(b1.ok && b1.number === 1, "Sara junta #64 y #66 en el lote #1", b1);
const again = (await as(SARA, "select public.erp_sr_batch_create($1, $2::uuid[], $3) r", [A, `{${R64},${R66}}`, KEY]))[0].r;
ok(again.id === b1.id && again.repeated, "Doble toque con la misma llave: el mismo lote", again);
ok(Number((await raw("select count(*) n from erp_sr_batches where store_id = $1", [A]))[0].n) === 1, "Solo un lote creado");
ok((await msgs(R66)).some((m) => m.includes("juntó los pedidos #64, #66 en el lote #1")), "Queda en el chat de cada pedido", await msgs(R66));
ok(/ya está en el lote #1/.test(await err(SARA, "select public.erp_sr_batch_create($1, $2::uuid[])", [A, `{${R64},${R66}}`]) ?? ""), "Un pedido no puede estar en dos lotes");
let list = (await as(SARA, "select public.erp_stock_requests_list($1) r", [A]))[0].r;
ok(list.find((x) => x.id === R64)?.batch?.number === 1 && list.find((x) => x.id === R66)?.batch?.id === b1.id && list.find((x) => x.id === RX)?.batch === null, "La lista dice el lote de cada pedido", list.map((x) => [x.number, x.batch]));
ok(list.length === 3, "Sara ve lo de su bodega (no el pedido al Centro)", list.map((x) => x.number));
await set(SARA, [{ item_id: I64a, qty: 6 }, { item_id: I66a, qty: 4 }]);
ok((await qty(I64a)) === 6 && (await qty(I66a)) === 4, "Repartir en el lote: guarda las dos partes a la vez");
ok(Number((await raw("select count(*) n from erp_sr_batches where id = $1 and undone_at is null", [b1.id]))[0].n) === 1, "Repartir no deshace el lote");

console.log("Deshacer");
ok(/Solo quien despacha/.test(await err(SANTI, "select public.erp_sr_batch_undo($1)", [b1.id]) ?? ""), "Quien pidió no deshace el lote");
res = (await as(SARA, "select public.erp_sr_batch_undo($1, $2) r", [b1.id, R66]))[0].r;
ok(res.undone === true, "Sacar uno de dos deshace el lote entero (no queda lote de uno)", res);
ok(Number((await raw("select count(*) n from erp_stock_requests where batch_id is not null"))[0].n) === 0, "Ningún pedido queda en el lote");
ok((await qty(I64a)) === 6 && (await qty(I66a)) === 4, "Las cantidades quedan como estaban");
ok((await msgs(R64)).at(-1).includes("deshizo el lote #1"), "Queda en el chat", await msgs(R64));
res = (await as(SARA, "select public.erp_sr_batch_undo($1) r", [b1.id]))[0].r;
ok(res.repeated, "Deshacer dos veces no falla", res);
// Lote de tres: sacar uno deja los otros dos.
const R67 = await req(V, B, 67);
await item(R67, COJIN, 1);
const b2 = (await as(SARA, "select public.erp_sr_batch_create($1, $2::uuid[]) r", [A, `{${R64},${R66},${R67}}`]))[0].r;
ok(b2.number === 2, "Los pedidos de un lote deshecho se pueden volver a juntar (lote #2)", b2);
res = (await as(SARA, "select public.erp_sr_batch_undo($1, $2) r", [b2.id, R67]))[0].r;
ok(res.undone === false && (await raw("select batch_id from erp_stock_requests where id = $1", [R64]))[0].batch_id === b2.id
  && (await raw("select batch_id from erp_stock_requests where id = $1", [R67]))[0].batch_id === null, "Sacar uno de tres deja los otros dos", res);
ok((await msgs(R67)).at(-1).includes("sacó este pedido del lote #2"), "El que sale lo dice en su chat", await msgs(R67));
ok(/no está en el lote/.test(await err(SARA, "select public.erp_sr_batch_undo($1, $2)", [b2.id, R67]) ?? ""), "Sacar uno que ya no está: aviso claro");

console.log("Seguridad");
ok(/permission denied/.test(await err(SARA, "select * from erp_sr_batches") ?? ""), "La tabla de lotes no se lee directo (solo con las funciones)");
const defs = await raw(`select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') cfg,
  has_function_privilege('anon', p.oid, 'execute') anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('erp_sr_qty_set', 'erp_sr_batch_create', 'erp_sr_batch_undo', 'erp_stock_requests_list')`);
ok(defs.length === 4 && defs.every((d) => d.prosecdef && /search_path=public/.test(d.cfg)), "security definer con search_path = public", defs);
ok(defs.filter((d) => d.proname !== "erp_stock_requests_list").every((d) => !d.anon), "Sin acceso anónimo", defs);

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
