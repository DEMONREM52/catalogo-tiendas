// Pruebas de 20261279: informe de traslados agrupable, con permisos de punto y de costos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Lo de producción que usa el informe: columnas nuevas, permisos (erp_can) y alcance de punto (erp__scope_ok).
const extra = `
alter table public.store_users add column if not exists point_id uuid;
alter table public.erp_transfers add column if not exists created_by_name text;
alter table public.erp_transfers add column if not exists received_by_name text;
alter table public.erp_transfers add column if not exists carrier_name text;
alter table public.erp_transfer_items add column if not exists received_qty integer;
alter table public.erp_transfer_items add column if not exists unit_cost numeric;
alter table public.erp_transfer_items add column if not exists internal_price numeric;
create or replace function public.erp_can(p_store uuid, p_perm text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from stores where id = p_store and owner_id = auth.uid())
      or exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and p_perm = any (permissions));
$$;
create or replace function public.erp__scope_ok(p_store uuid, p_point uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from stores where id = p_store and owner_id = auth.uid())
      or exists (select 1 from store_users where store_id = p_store and user_id = auth.uid() and (point_id is null or point_id = p_point));
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_tr_report_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261279_informe_traslados.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a2300000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ZAMORA_USER = U(2), SIN = U(3);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const rep = async (u, args = {}) => {
  const a = { p_from: null, p_to: null, p_origins: null, p_dests: null, p_status: "all", p_group: "dest", p_q: null, p_category: null, ...args };
  return (await as(u, `select public.erp_transfer_report($1, $2, $3, $4::uuid[], $5::uuid[], $6, $7, $8, $9) r`,
    [A, a.p_from, a.p_to, a.p_origins, a.p_dests, a.p_status, a.p_group, a.p_q, a.p_category]))[0].r;
};

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina5', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (code, name) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, code, name]))[0].id;
const B = await wh("B", "Bodega"), Z = await wh("Z", "Zamora"), M = await wh("M", "Manhattan");
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1, $2, 'seller', '{transfers}', $3), ($1, $4, 'seller', '{}', null)", [A, ZAMORA_USER, Z, SIN]);
const [{ id: CAT }] = await raw("insert into product_categories (store_id, name) values ($1, 'JUGUETERIA') returning id", [A]);
const prod = async (n, sku, cat) => (await raw("insert into products (store_id, name, sku, category_id) values ($1, $2, $3, $4) returning id", [A, n, sku, cat]))[0].id;
const TERMO = await prod("TERMO", "T1", null), CARRO = await prod("CARRO RC", "C1", CAT);
let n = 100;
async function tr(from, to, day, status, items, people = {}) {
  const [{ id }] = await raw(`insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, status, created_at, created_by_name, received_by_name, carrier_name)
    values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9) returning id`, [A, ++n, from, to, status, `${day}T15:00:00Z`, people.sender ?? "SARA", people.receiver ?? null, people.carrier ?? null]);
  for (const [p, qty, rec, cost, price] of items) await raw("insert into erp_transfer_items (transfer_id, product_id, qty, received_qty, unit_cost, internal_price) values ($1, $2, $3, $4, $5, $6)", [id, p, qty, rec, cost, price]);
  return id;
}
await tr(B, Z, "2026-10-01", "received", [[TERMO, 10, 10, 5000, 6000], [CARRO, 4, 3, 20000, 25000]], { receiver: "SANTIAGO", carrier: "DANIEL" });
await tr(B, M, "2026-10-02", "received", [[TERMO, 6, 6, 5000, 6000]], { receiver: "LAURA" });
await tr(B, Z, "2026-10-15", "in_transit", [[CARRO, 2, null, 20000, 25000]]);
await tr(Z, M, "2026-10-20", "received", [[TERMO, 1, 1, 5000, 6000]]);
await tr(B, M, "2026-10-21", "cancelled", [[TERMO, 50, null, 5000, 6000]]);

let r = await rep(OWNER);
ok(r.totals.transfers === 4 && r.totals.units === 23, "Totales sin anulados: 4 traslados, 23 unidades", r.totals);
ok(r.totals.missing === 1 && r.totals.in_transit === 1, "1 unidad no llegó y 1 traslado va en camino", r.totals);
ok(r.totals.value === 10 * 6000 + 4 * 25000 + 6 * 6000 + 2 * 25000 + 6000 && r.totals.cost === 10 * 5000 + 4 * 20000 + 6 * 5000 + 2 * 20000 + 5000, "Valor a precio interno y a costo (el dueño sí ve costos)", r.totals);
const zam = r.groups.find((g) => g.label === "Zamora");
ok(zam && zam.units === 16 && zam.transfers === 2 && zam.missing === 1, "Por punto que recibe: Zamora recibió 16 unidades en 2 traslados", r.groups);

r = await rep(OWNER, { p_group: "route" });
ok(r.groups.some((g) => g.label === "Bodega → Manhattan" && g.units === 6) && r.groups.length === 3, "Por ruta: Bodega → Manhattan 6 und.", r.groups);
r = await rep(OWNER, { p_group: "product" });
ok(r.groups.find((g) => g.label === "TERMO").units === 17 && r.groups.find((g) => g.label === "CARRO RC").sub === "C1", "Por producto, con su referencia", r.groups);
r = await rep(OWNER, { p_group: "category" });
ok(r.groups.find((g) => g.label === "JUGUETERIA").units === 6 && r.groups.find((g) => g.label === "Sin categoría").units === 17, "Por categoría", r.groups);
r = await rep(OWNER, { p_group: "month" });
ok(r.groups.length === 1 && r.groups[0].label === "10/2026", "Por mes", r.groups);
r = await rep(OWNER, { p_group: "receiver" });
ok(r.groups.some((g) => g.label === "SANTIAGO" && g.units === 14), "Por quién recibió", r.groups);

r = await rep(OWNER, { p_from: "2026-10-10", p_to: "2026-10-31" });
ok(r.totals.transfers === 2, "Filtro de fechas", r.totals);
r = await rep(OWNER, { p_dests: `{${M}}` });
ok(r.totals.units === 7, "Solo los que llegaron a Manhattan", r.totals);
r = await rep(OWNER, { p_status: "diff" });
ok(r.totals.transfers === 1 && r.totals.missing === 1, "Solo con diferencias", r.totals);
r = await rep(OWNER, { p_status: "cancelled" });
ok(r.totals.units === 50, "Solo anulados", r.totals);
r = await rep(OWNER, { p_q: "carro" });
ok(r.totals.units === 6, "Buscar producto", r.totals);
r = await rep(OWNER, { p_q: "#102" });
ok(r.totals.transfers === 1 && r.totals.units === 6, "Buscar por número de traslado", r.totals);
r = await rep(OWNER, { p_category: CAT });
ok(r.totals.units === 6, "Filtrar por categoría", r.totals);
ok(r.series.length === 2 && r.top_products.length === 1 && r.matrix.length === 1, "Trae serie por día, productos más trasladados y matriz de rutas", r);

// Permisos
r = await rep(ZAMORA_USER);
ok(r.totals.transfers === 3 && !r.groups.some((g) => g.label === "Manhattan" && g.units === 6), "Zamora solo ve los traslados donde participa (no Bodega → Manhattan)", r.groups);
ok(r.can_cost === false && r.totals.cost === null && r.groups.every((g) => g.cost === undefined), "Sin «Ver costos» no sale el costo", r.totals);
ok(/permiso/.test(await err(SIN, "select public.erp_transfer_report($1) r", [A]) ?? ""), "Sin permiso de traslados no hay informe");
ok(/Agrupación/.test(await err(OWNER, "select public.erp_transfer_report($1, null, null, null, null, 'all', 'otra') r", [A]) ?? ""), "Agrupación desconocida no");

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exitCode = fail ? 1 : 0;
