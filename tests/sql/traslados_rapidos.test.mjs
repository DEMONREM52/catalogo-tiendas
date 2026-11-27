// Pruebas de 20261350: la lista de traslados en una sola función, con el MISMO alcance que los permisos de la tabla.
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
`;
const combined = path.join(os.tmpdir(), `remhub_trr_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_finanzas.sql"), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
  ...["20261124_credito_traslados.sql", "20261125_rentabilidad_cadena.sql", "20261126_varias_bodegas.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
  // Como en producción (20261123): cada quien solo ve los traslados de sus puntos.
  `drop policy if exists erp_tr_point_scope on public.erp_transfers;
   create policy erp_tr_point_scope on public.erp_transfers as restrictive for select to authenticated
     using (public.erp_my_points(store_id) is null or from_warehouse_id = any (public.erp_my_points(store_id)) or to_warehouse_id = any (public.erp_my_points(store_id)));`,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261350_traslados_rapidos.sql"), "utf8");
await db.exec(M);
await db.exec(M);

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
const U = (n) => `cfa00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SARA = U(2), NOPE = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('trr', 'LA VITRINA', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const wh = async (c, n) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, c, n]))[0].id;
const Z = await wh("Z", "Sede Zamora"), V = await wh("V", "La Vitrina"), C = await wh("C", "Cisneros");
await raw("insert into store_users (store_id, user_id, role, point_id, display_name, active, permissions) values ($1, $2, 'seller', $3, 'Sara', true, '{transfers}'), ($1, $4, 'seller', $5, 'Nadie', true, '{pos}')", [A, SARA, Z, NOPE, V]);
const prod = async (n, sku) => (await raw("insert into products (store_id, name, sku, stock, cost_price) values ($1, $2, $3, 0, 1000) returning id", [A, n, sku]))[0].id;
const P = await prod("OLLA EXPRESS", "OL-77"), Q = await prod("BATIDORA ROSA", "BT_10");
for (const p of [P, Q]) await raw("select public.erp__move($1, $2, $3, 500, 'purchase', 'test', null, 1000, 'carga', null, true)", [A, B1, p]);
const mk = async (to, items, notes = "x") => (await as(OWNER, "select public.erp_create_transfer($1, $2, $3, $4, $5::jsonb) id", [A, B1, to, notes, J(items)]))[0].id;
const T1 = await mk(Z, [{ product_id: P, qty: 5 }], "para zamora");
const T2 = await mk(V, [{ product_id: Q, qty: 3 }]);
const T3 = await mk(C, [{ product_id: P, qty: 1 }, { product_id: Q, qty: 2 }]);
const T4 = await mk(Z, [{ product_id: Q, qty: 4 }]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, '')", [T4]);
const [{ id: R }] = await raw("insert into erp_stock_requests (store_id, from_point_id, to_point_id, status, number, transfer_id) values ($1, $2, $3, 'dispatched', 21, $4) returning id", [A, Z, B1, T1]);
const page = async (u, args = {}) => (await as(u, "select public.erp_transfers_page($1, $2, $3, $4, $5, $6, $7, $8) r",
  [A, args.status ?? null, args.from ?? null, args.to ?? null, args.origin ?? null, args.dest ?? null, args.q ?? null, args.limit ?? 30]))[0].r;
const nums = (r) => r.rows.map((x) => x.number).sort((a, b) => a - b);
const num = async (T) => (await raw("select number from erp_transfers where id = $1", [T]))[0].number;
const [n1, n2, n3, n4] = [await num(T1), await num(T2), await num(T3), await num(T4)];

console.log("Mismo alcance que los permisos de la tabla");
for (const [u, who] of [[OWNER, "el dueño"], [SARA, "Sara (solo Zamora)"]]) {
  const viaRls = (await as(u, "select number from erp_transfers where store_id = $1 order by number", [A])).map((x) => x.number);
  const r = await page(u);
  ok(J(nums(r)) === J(viaRls) && r.total === viaRls.length, `${who}: ve exactamente lo mismo que hoy (${viaRls.join(", ")})`, [nums(r), viaRls]);
}
ok(/No tienes permiso/.test(await err(NOPE, "select public.erp_transfers_page($1)", [A]) ?? ""), "Sin permiso de Traslados ni Inventario: no ve nada");
ok(/Inicia sesión/.test(await err(null, "select public.erp_transfers_page($1)", [A]) ?? "") || (await err(null, "select public.erp_transfers_page($1)", [A])) !== null, "Sin sesión: no");

console.log("Contenido de cada traslado");
let r = await page(OWNER);
const row1 = r.rows.find((x) => x.number === n1);
ok(row1.erp_transfer_items.length === 1 && row1.erp_transfer_items[0].qty === 5 && row1.erp_transfer_items[0].products.name === "OLLA EXPRESS", "Trae sus productos con nombre", row1.erp_transfer_items);
ok(row1.request?.number === 21 && row1.request?.request_id === R, "Trae su pedido interno (sin otra consulta)", row1.request);
ok(row1.track_token && Array.isArray(row1.erp_transfer_signatures), "Trae enlace y firmas");
ok(!JSON.stringify(r).includes("cost") && !JSON.stringify(r).includes("price"), "No trae costos ni precios");
ok(r.rows[0].number === Math.max(n1, n2, n3, n4), "Los más recientes primero");

console.log("Filtros");
ok(J(nums(await page(OWNER, { status: "received" }))) === J([n4]), "Recibidos");
ok(J(nums(await page(OWNER, { dest: Z }))) === J([n1, n4].sort((a, b) => a - b)), "Llega a Zamora");
ok(J(nums(await page(OWNER, { q: `#${n2}` }))) === J([n2]), "Por número (#)");
ok(J(nums(await page(OWNER, { q: "batidora" }))) === J([n2, n3, n4].sort((a, b) => a - b)), "Por producto (nombre)");
ok(J(nums(await page(OWNER, { q: "bt_10" }))) === J([n2, n3, n4].sort((a, b) => a - b)), "Por referencia (el _ no es comodín)");
ok(nums(await page(OWNER, { q: "b%" })).length === 0, "El % tampoco es comodín");
ok(J(nums(await page(OWNER, { q: "zamora" }))) === J([n1]), "Por notas");
const two = await page(OWNER, { limit: 2 });
ok(two.rows.length === 2 && two.total === 4, "Página de 2 con el total de 4", [two.rows.length, two.total]);
ok(/Estado no válido/.test(await err(OWNER, "select public.erp_transfers_page($1, 'raro')", [A]) ?? ""), "Estado raro: no");

console.log("Guarda de permisos");
await raw("create policy erp_tr_otra on public.erp_transfers for select to authenticated using (public.erp_can(store_id, 'reports'))");
let stop = null;
try { await db.exec(M); } catch (e) { stop = e.message; }
ok(/no son los esperados: erp_tr_otra/.test(stop ?? ""), "Si la base tiene otra regla de acceso, la migración se detiene y la muestra", stop);
await raw("drop policy erp_tr_otra on public.erp_transfers");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
