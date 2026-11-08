// Pruebas de 20261292 (valorizar con el último costo). Base copiada de tablero_puntos.test.mjs · Pruebas de 20261209: tablero de puntos (mes a mes) y liquidación del punto (mercancía valorizada).
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

console.log("1. Producto trasladado: precio de bodega fijado al trasladar");
// Inventario inicial de Zamora como factura propia: entró a 33.800; la madre después compró a 20.000.
const [{ id: Q }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3, price_4, price_5) values ($1, 'CARRITO', 'RHOG131', 0, 0, 23000, 20000, 20000, 20000, 20000) returning id", [A]);
await raw("select public.erp__move($1, $2, $3, 4, 'purchase', 'test', null, 33800, 'inicial', null, true)", [A, Z, Q]);
await raw("update products set cost_price = 26900, last_cost = 20000, last_cost_at = now() where id = $1", [Q]);
const line = (v, id) => v.lines.find((l) => l.id === id);
let v = await one(OWNER, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(v.ok && v.basis === "average" && v.point_basis === "average", "Sin activar: costo promedio (como antes)", v);
ok(n(line(v, P).internal) === 11500 && line(v, P).frozen === true, "El zapatero trasladado mantiene su precio de bodega fijado (11.500)", line(v, P));
ok(n(line(v, Q).cost) === 26900 && n(line(v, Q).internal) === 31000, "El carrito de inventario inicial: costo promedio 26.900 → bodega 31.000", line(v, Q));
ok(n(line(v, Q).avg_cost) === 26900 && n(line(v, Q).last_cost) === 20000, "Trae el promedio y el último costo para comparar", line(v, Q));

console.log("2. Con «Último costo» activado en Zamora");
await raw("insert into erp_pool_settings (store_id, point_id, cost_basis, cost_basis_from) values ($1, $2, 'last', now() - interval '1 minute')", [A, Z]);
v = await one(OWNER, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(v.basis === "last" && v.point_basis === "last", "Toma la base del punto", v.basis);
ok(n(line(v, Q).cost) === 20000 && n(line(v, Q).internal) === 23000, "El carrito: costo de la última factura 20.000 → bodega 23.000 (20.000 + 15 %)", line(v, Q));
ok(n(line(v, P).internal) === 11500, "Lo trasladado no cambia: es la deuda real", line(v, P));
const cmp = await one(OWNER, "select public.erp_point_valuation($1, $2, 3, 'average') r", [A, Z]);
ok(cmp.basis === "average" && n(line(cmp, Q).internal) === 31000, "Se puede pedir la otra base para comparar", line(cmp, Q));
const zu = await one(ZUSER, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(zu.ok && n(line(zu, Q).last_cost) === 20000, "El usuario de Zamora con «Ver rentabilidad» también lo ve", line(zu, Q));
const co = await one(CREDIT_ONLY, "select public.erp_point_valuation($1, $2, 3) r", [A, Z]);
ok(co.ok && line(co, Q).cost === null && line(co, Q).last_cost === null, "Sin permiso de costos no ve costos", line(co, Q));

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
