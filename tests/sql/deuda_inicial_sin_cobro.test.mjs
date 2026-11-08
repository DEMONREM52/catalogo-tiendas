// Pruebas de 20261297 (deuda inicial con traslados sin cobro y recalcular). Base copiada de deuda_inicial_ingreso.test.mjs.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
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
  signer_name text, notes text, via text, user_id uuid, created_at timestamptz default now(), unique (transfer_id, step));
alter table public.erp_transfers add column if not exists checked_by_name text;
alter table public.erp_warehouses add column if not exists phone text;
alter table public.products add column if not exists last_cost numeric;
alter table public.products add column if not exists last_cost_at timestamptz;
create table if not exists public.erp_pool_settings (store_id uuid not null, point_id uuid, mode text not null default 'margin', mode_from timestamptz not null default now(),
  deduct_expenses boolean not null default false, deduct_from timestamptz not null default now(), cost_basis text not null default 'average', cost_basis_from timestamptz,
  updated_by uuid, updated_by_name text, updated_at timestamptz default now());
create or replace function public.erp__sale_cost_basis(p_store uuid, p_point uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select case when p_point is not null and exists (select 1 from public.erp_pool_settings s where s.store_id = p_store and s.point_id = p_point
    and s.cost_basis = 'last' and (s.cost_basis_from is null or p_at >= s.cost_basis_from)) then 'last' else 'average' end;
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_tp_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261109_repartos_liquidaciones.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261110_gastos_presupuestos_nomina.sql"), "utf8"),
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_finanzas.sql"), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
  ...["20261124_credito_traslados.sql", "20261125_rentabilidad_cadena.sql", "20261126_varias_bodegas.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261209_tablero_puntos.sql"), "utf8");
await db.exec(M);
const M92 = fs.readFileSync(path.join(MIG, "20261292_valorizacion_ultimo_costo.sql"), "utf8");
await db.exec(M92);
await db.exec(M92);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const n = (v) => Number(v);

const U = (n) => `cb000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ZUSER = U(2), SELLER = U(3), CREDIT_ONLY = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const wh = async (code, kind) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, $3) returning id", [A, code, kind]))[0].id;
const Z = await wh("ZAMORA", "point"), C = await wh("CISNEROS", "point");
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{profit_view,internal_credit}',$3)", [A, ZUSER, Z]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{pos}',$3)", [A, SELLER, Z]);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{internal_credit}',$3)", [A, CREDIT_ONLY, Z]);
const [{ id: P }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3, price_4, price_5) values ($1, 'ZAPATERO', 'BX1', 0, 10000, 20000, 18000, 16000, 15000, 14000) returning id", [A]);
await raw("select public.erp__move($1, $2, $3, 100, 'purchase', 'test', null, 10000, 'carga', null, true)", [A, B1, P]);

// Crédito con 15 % (por defecto) y redondeo a 100; regla de precio del punto: +15 %.
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true}'::jsonb)", [A, Z]);
await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, status, reason, valid_from) values ($1, $2, 'point', 'pct', 15, 'active', 'margen', now() - interval '1 day')", [A, Z]);
const [{ id: tr }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: P, qty: 10 }])]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [tr]);

for (const f of ["20261293_revaluar_deuda_puntos.sql", "20261294_deuda_inicial_desde_ingreso.sql", "20261297_deuda_inicial_traslados_sin_cobro.sql"]) await db.exec(fs.readFileSync(path.join(MIG, f), "utf8"));
await db.exec(fs.readFileSync(path.join(MIG, "20261297_deuda_inicial_traslados_sin_cobro.sql"), "utf8")); // se puede correr dos veces

console.log("1. Cisneros: ingreso propio, luego un traslado ANTES de activar su crédito");
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, active) values ($1, 'INVENTARIO INICIAL', true) returning id", [A]);
const [{ id: Q }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3, price_4, price_5) values ($1, 'CARRITO', 'RHOG131', 0, 20000, 40000, 38000, 36000, 35000, 34000) returning id", [A]);
const [{ id: PU }] = await raw("insert into erp_purchases (store_id, number, supplier_id, warehouse_id, status, invoice_ref, total, created_at) values ($1, 1, $2, $3, 'received', 'Fact. 1', 200000, now() - interval '5 days') returning id", [A, SUP, C]);
await raw("insert into erp_purchase_items (purchase_id, product_id, qty, unit_cost, line_total) values ($1, $2, 10, 20000, 200000)", [PU, Q]);
await raw("select public.erp__move($1, $2, $3, 10, 'purchase', 'test', null, 20000, 'inicial', null, true)", [A, C, Q]);
await raw("select public.erp__move($1, $2, $3, 50, 'purchase', 'test', null, 20000, 'madre', null, true)", [A, B1, Q]);
await raw("update products set last_cost = 20000, last_cost_at = now() where id = $1", [Q]);
const [{ id: t1 }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, C, JSON.stringify([{ product_id: Q, qty: 8 }])]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [t1]);
ok(n((await raw("select count(*) c from erp_internal_docs where transfer_id = $1", [t1]))[0].c) === 0, "Ese traslado no generó deuda (el crédito no estaba activo)");

console.log("2. Se activa el crédito, llega un traslado que sí se cobra, y se vende algo");
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true}'::jsonb)", [A, C]);
const [{ id: t2 }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, C, JSON.stringify([{ product_id: Q, qty: 3 }])]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [t2]);
ok(n((await raw("select count(*) c from erp_internal_docs where transfer_id = $1 and status = 'active'", [t2]))[0].c) === 1, "El segundo traslado sí se cobró");
await raw("update erp_stock_levels set qty = qty - 4 where warehouse_id = $1 and product_id = $2", [C, Q]); // 10 + 8 + 3 − 4 = 17

console.log("3. Vista previa: suma lo que entró sin cobro y resta solo lo cobrado");
const pv = await one(OWNER, "select public.erp_internal_opening_from_purchase($1, $2, $3, false) r", [A, C, PU]);
const row = pv.rows.find((x) => x.product_id === Q);
ok(n(row.purchased) === 10 && n(row.uncharged_in) === 8 && n(row.stock_now) === 17 && n(row.transferred_after) === 3, "Ingresó 10 · traslado sin cobro 8 · hoy 17 · cobrado después 3", row);
ok(n(row.qty) === 14 && n(pv.total) === 14 * 23000, "Se cobran 14 (17 − 3) a 23.000", pv);

console.log("4. Recalcular un ingreso que ya se cobró con la regla vieja");
// Simula el cobro viejo (regla 1294): solo 17 − 11 = 6 unidades.
const [{ id: OLD }] = await raw(`insert into erp_internal_docs (store_id, point_id, number, kind, sign, amount, due_date, note)
  values ($1, $2, 900, 'opening', 1, 138000, current_date + 90, 'viejo') returning id`, [A, C]);
await raw(`insert into erp_internal_opening_lines (store_id, doc_id, purchase_id, point_id, product_id, purchased, stock_now, transferred_after, qty, unit, total)
  values ($1, $2, $3, $4, $5, 10, 17, 11, 6, 23000, 138000)`, [A, OLD, PU, C, Q]);
const bal0 = n((await raw("select public.erp__internal_balance($1, $2) b", [A, C]))[0].b);
ok(/Recalcular/.test(await as(OWNER, "select public.erp_internal_opening_from_purchase($1, $2, $3, true) r", [A, C, PU]).then(() => "", (e) => e.message)), "Sin «recalcular» no lo cobra dos veces");
const pv2 = await one(OWNER, "select public.erp_internal_opening_from_purchase($1, $2, $3, false) r", [A, C, PU]);
ok(pv2.replaces && n(pv2.replaces.amount) === 138000 && n(pv2.total) === 322000, "La vista previa muestra el cobro que reemplaza (138.000 → 322.000)", pv2);
const ap = await one(OWNER, "select public.erp_internal_opening_from_purchase($1, $2, $3, true, null, true) r", [A, C, PU]);
ok(ap.applied && ap.replaced && n(ap.total) === 322000, "Recalcula y reemplaza", ap);
ok((await raw("select status from erp_internal_docs where id = $1", [OLD]))[0].status === "void", "El cobro viejo queda anulado");
ok(n((await raw("select public.erp__internal_balance($1, $2) b", [A, C]))[0].b) === bal0 - 138000 + 322000, "La deuda sube solo la diferencia (184.000)");
const due = (await raw("select due_date::text d from erp_internal_docs where id = $1", [ap.doc_id]))[0].d;
const oldDue = (await raw("select due_date::text d from erp_internal_docs where id = $1", [OLD]))[0].d;
ok(due === oldDue, "Conserva el vencimiento del cobro anterior", { due, oldDue });

console.log("5. No se cobra dos veces el traslado sin cobro");
const pv3 = await one(OWNER, "select public.erp_internal_opening_from_purchase($1, $2, $3, false) r", [A, C, PU]);
ok(n(pv3.rows.find((x) => x.product_id === Q).uncharged_in) === 8, "Al recalcular otra vez, el mismo ingreso vuelve a contar sus 8 (se excluye su propio cobro)", pv3.rows);
const [{ id: PU2 }] = await raw("insert into erp_purchases (store_id, number, supplier_id, warehouse_id, status, total, created_at) values ($1, 2, $2, $3, 'received', 0, now() - interval '4 days') returning id", [A, SUP, C]);
await raw("insert into erp_purchase_items (purchase_id, product_id, qty, unit_cost, line_total) values ($1, $2, 1, 20000, 20000)", [PU2, Q]);
const pv4 = await one(OWNER, "select public.erp_internal_opening_from_purchase($1, $2, $3, false) r", [A, C, PU2]);
ok(n(pv4.rows.find((x) => x.product_id === Q).uncharged_in) === 0, "Otro ingreso ya no cuenta esos 8 (ya se cobraron)", pv4.rows);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
