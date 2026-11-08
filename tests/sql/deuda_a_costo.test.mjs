// Pruebas de 20261299 (deuda a costo, abono automático al liquidar, recálculo al cambiar el %, cuadre). Base copiada de deuda_inicial_ingreso.test.mjs.
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

for (const f of ["20261293_revaluar_deuda_puntos.sql", "20261295_mercancia_punto_igual_liquidacion.sql", "20261296_mercancia_punto_a_costo.sql", "20261299_deuda_a_costo_y_abono_liquidacion.sql"]) await db.exec(fs.readFileSync(path.join(MIG, f), "utf8"));
await db.exec(fs.readFileSync(path.join(MIG, "20261299_deuda_a_costo_y_abono_liquidacion.sql"), "utf8")); // se puede correr dos veces
const bal = async () => n((await raw("select public.erp__internal_balance($1, $2) b", [A, Z]))[0].b);
await raw("update products set last_cost = 10000, last_cost_at = now() where id = $1", [P]);
// El trigger de último costo deja cola; se vacía al terminar la operación.

console.log("1. Zamora tenía 10 a 11.500 (costo + 15 %) y vendió 4");
ok(await bal() === 115000, "Debe 115.000", await bal());
await raw("update erp_stock_levels set qty = 6 where warehouse_id = $1 and product_id = $2", [Z, P]);

console.log("2. Pasa a % bodega 0: se recalcula solo");
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true, \"pct\": 0}'::jsonb)", [A, Z]);
ok(n((await raw("select avg_cost from erp_point_costs where point_id = $1 and product_id = $2", [Z, P]))[0].avg_cost) === 10000, "El precio de bodega queda en el costo (10.000)");
ok(await bal() === 115000 - 6 * 1500, "Nota crédito por las 6 que tiene: 6 × 1.500", await bal());
const rv = (await raw("select source, qty::float from erp_internal_revaluations where point_id = $1 order by created_at desc limit 1", [Z]))[0];
ok(rv.source === "auto" && rv.qty === 6, "Queda en el historial como automático", rv);

console.log("3. Cuadrar con el costo");
const pv = await one(OWNER, "select public.erp_internal_reconcile($1, $2, false) r", [A, Z]);
ok(n(pv.stock) === 60000 && n(pv.target) === 60000 && n(pv.diff) === 60000 - 106000, "Debe quedar en 60.000 (6 × 10.000): baja 46.000", pv);
ok(n(await bal()) === 106000, "La vista previa no cambia nada");
const ap = await one(OWNER, "select public.erp_internal_reconcile($1, $2, true) r", [A, Z]);
ok(ap.applied && n(ap.balance_after) === 60000, "Queda debiendo 60.000", ap);
const d = (await raw("select kind, reconcile_detail from erp_internal_docs where id = $1", [ap.doc_id]))[0];
ok(d.kind === "credit" && n(d.reconcile_detail.target) === 60000, "Nota crédito «Cuadre con el costo» con el detalle", d);
ok((await one(OWNER, "select public.erp_internal_reconcile($1, $2, true) r", [A, Z])).nothing, "Si ya cuadra, no hace nada");
ok(/tienda madre/.test(await as(ZUSER, "select public.erp_internal_reconcile($1, $2, false) r", [A, Z]).then(() => "", (e) => e.message)), "Un usuario del punto no lo puede hacer");

console.log("4. Abono automático al aprobar una liquidación");
const [{ id: S1 }] = await raw(`insert into erp_settlements (store_id, point_id, number, cutoff, status, pool_total, assigned_total, unassigned_total, merch_cost)
  values ($1, $2, 7, now(), 'review', 20000, 20000, 0, 30000) returning id`, [A, Z]);
await raw("update erp_settlements set status = 'approved', decided_by_name = 'Jefe' where id = $1", [S1]);
const pm = await raw("select amount::float, reference, voided from erp_internal_payments where settlement_id = $1", [S1]);
ok(pm.length === 1 && pm[0].amount === 30000 && pm[0].reference === "Liquidación #7", "Al aprobar se abona el costo de la mercancía (30.000)", pm);
ok(await bal() === 30000, "La deuda baja a 30.000");
await raw("update erp_settlements set status = 'paid' where id = $1", [S1]);
ok(n((await raw("select count(*) c from erp_internal_payments where settlement_id = $1", [S1]))[0].c) === 1, "Al marcarla pagada no abona otra vez");
await raw("update erp_settlements set status = 'reverted' where id = $1", [S1]);
ok((await raw("select voided from erp_internal_payments where settlement_id = $1", [S1]))[0].voided === true && await bal() === 60000, "Si se revierte, el abono se anula y la deuda vuelve", await bal());
const [{ id: S2 }] = await raw(`insert into erp_settlements (store_id, point_id, number, cutoff, status, pool_total, assigned_total, unassigned_total, merch_cost)
  values ($1, $2, 8, now(), 'review', 1, 1, 0, 30000) returning id`, [A, C]);
await raw("update erp_settlements set status = 'approved' where id = $1", [S2]);
ok(n((await raw("select count(*) c from erp_internal_payments where settlement_id = $1", [S2]))[0].c) === 0, "Un punto sin crédito no recibe abono");

console.log("5. Si sube el costo de la madre, se recalcula solo (al costo, sin %)");
await raw("update products set last_cost = 12000 where id = $1", [P]);
ok(await bal() === 60000 + 6 * 2000, "Cargo por 6 × 2.000", await bal());
await raw("insert into erp_internal_pct_rules (store_id, product_id, pct) values ($1, $2, 10)", [A, P]);
ok(n((await raw("select avg_cost from erp_point_costs where point_id = $1 and product_id = $2", [Z, P]))[0].avg_cost) === 13200, "Una regla de % por producto también recalcula (12.000 + 10 %)");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
