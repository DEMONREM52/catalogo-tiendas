// Pruebas de 20261283: comentarios por producto en los pedidos internos.
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
  qty_requested integer not null, qty_approved integer, qty_received integer, note text);
create or replace function public.erp__sr_visible(p_request uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from erp_stock_requests r join store_users su on su.store_id = r.store_id and su.user_id = auth.uid()
                 where r.id = p_request and su.point_id in (r.from_point_id, r.to_point_id));
$$;
create or replace function public.erp_actor_name(p_store uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from store_users where store_id = p_store and user_id = auth.uid()), 'Dueño');
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_sr_cmt_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261283_comentarios_por_producto.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a3300000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), MARIA = U(2), DANIEL = U(3), OTRO = U(5);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('v5', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, code]))[0].id;
const B = await wh("Bodega"), M = await wh("Manhattan"), C = await wh("Centro");
await raw("insert into store_users (store_id, user_id, role, point_id, display_name) values ($1, $2, 'seller', $3, 'MARIA BONILLA'), ($1, $4, 'seller', $5, 'DANIEL'), ($1, $6, 'seller', $7, 'Otro')",
  [A, MARIA, M, DANIEL, B, OTRO, C]);
const [{ id: P }] = await raw("insert into products (store_id, name) values ($1, 'LUZ PARA VIDEOS') returning id", [A]);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, number, status) values ($1, $2, $3, 14, 'preparing') returning id", [A, M, B]);
const [{ id: I }] = await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values ($1, $2, 4) returning id", [R, P]);

const add = (u, body, tag = "note", qty = null) => as(u, "select public.erp_sr_item_comment_add($1, $2, $3, $4, $5) r", [R, I, body, tag, qty]);
const c1 = (await add(MARIA, "Necesito 5 más", "more", 5))[0].r;
ok(c1.ok && c1.id, "Quien pidió comenta un producto («necesito 5 más»)", c1);
await add(DANIEL, "Solo hay en blanco, ¿sirve?", "variant");
let list = (await as(MARIA, "select public.erp_sr_item_comments($1) r", [R]))[0].r;
ok(list.length === 2 && list[0].by === "MARIA BONILLA" && list[0].tag === "more" && list[0].qty === 5 && list[0].mine === true && list[1].mine === false, "Los dos lados ven el hilo, con quién, etiqueta y cantidad", list);
ok((await as(OTRO, "select public.erp_sr_item_comments($1) r", [R]))[0].r.length === 0, "Alguien de otro punto no ve los comentarios");
ok(/no encontrado/i.test(await err(OTRO, "select public.erp_sr_item_comment_add($1, $2, 'hola', 'note', null)", [R, I]) ?? ""), "Ni puede comentar");
ok(Number((await err(MARIA, "select count(*) from erp_sr_item_comments") ?? "").length) > 0, "La tabla no se lee directo (solo por las funciones)");
ok(/ya se envió/.test(await err(MARIA, "select public.erp_sr_item_comment_add($1, $2, 'Necesito 5 más', 'more', 5)", [R, I]) ?? ""), "Doble toque: no se repite el mismo comentario");
ok(/Escribe/.test(await err(MARIA, "select public.erp_sr_item_comment_add($1, $2, '   ', 'note', null)", [R, I]) ?? ""), "Vacío no se acepta");
ok(/no válida/.test(await err(MARIA, "select public.erp_sr_item_comment_add($1, $2, 'x', 'otra', null)", [R, I]) ?? ""), "Etiqueta inventada no se acepta");
const [{ id: I2 }] = await raw("insert into erp_stock_request_items (request_id, product_id, qty_requested) values (gen_random_uuid(), $1, 1) returning id", [P]);
ok(/no está en el pedido/.test(await err(MARIA, "select public.erp_sr_item_comment_add($1, $2, 'x', 'note', null)", [R, I2]) ?? ""), "Producto de otro pedido no se acepta");

await as(DANIEL, "select public.erp_sr_item_comment_resolve($1, true)", [c1.id]);
list = (await as(MARIA, "select public.erp_sr_item_comments($1) r", [R]))[0].r;
ok(list[0].resolved_at && list[0].resolved_by === "DANIEL", "Quien despacha lo marca «✓ Atendido» y queda quién", list[0]);
ok(/atendido/.test(await err(MARIA, "select public.erp_sr_item_comment_delete($1)", [c1.id]) ?? ""), "Atendido ya no se puede borrar");
await as(DANIEL, "select public.erp_sr_item_comment_resolve($1, false)", [c1.id]);
ok(!(await as(MARIA, "select public.erp_sr_item_comments($1) r", [R]))[0].r[0].resolved_at, "Se puede desmarcar");
ok(/Solo quien lo escribió/.test(await err(DANIEL, "select public.erp_sr_item_comment_delete($1)", [c1.id]) ?? ""), "Nadie borra el comentario de otro");
await as(MARIA, "select public.erp_sr_item_comment_delete($1)", [c1.id]);
ok((await as(MARIA, "select public.erp_sr_item_comments($1) r", [R]))[0].r.length === 1, "El autor borra el suyo");
ok(/Inicia sesión/.test(await err(null, "select public.erp_sr_item_comment_add($1, $2, 'x', 'note', null)", [R, I]) ?? ""), "Sin sesión no se comenta");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
