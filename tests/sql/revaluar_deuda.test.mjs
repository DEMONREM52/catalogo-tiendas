// Pruebas de 20261293 (la deuda de los puntos sigue al último costo). Base copiada de tablero_puntos.test.mjs · Pruebas de 20261209: tablero de puntos (mes a mes) y liquidación del punto (mercancía valorizada).
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

const M93 = fs.readFileSync(path.join(MIG, "20261293_revaluar_deuda_puntos.sql"), "utf8");
await db.exec(M93);
await db.exec(M93);
const bal = async () => n((await raw("select public.erp__internal_balance($1, $2) b", [A, Z]))[0].b);
const unit = async (prod) => n((await raw("select avg_cost from erp_point_costs where point_id = $1 and product_id = $2", [Z, prod]))[0]?.avg_cost);
const docs = async () => (await raw("select kind, sign, amount::float, note from erp_internal_docs where point_id = $1 and kind in ('credit', 'charge') order by created_at, number", [Z]));

console.log("1. Baja el costo: nota crédito automática");
ok(await bal() === 115000 && await unit(P) === 11500, "Antes: Zamora debe 115.000 (10 × 11.500)", { b: await bal(), u: await unit(P) });
await raw("update products set last_cost = 8000, last_cost_at = now() where id = $1", [P]);
let d = await docs();
ok(d.length === 1 && d[0].kind === "credit" && d[0].amount === 23000, "Nota crédito de 23.000: (9.200 − 11.500) × 10", d);
ok(await bal() === 92000 && await unit(P) === 9200, "Zamora ahora debe 92.000 y su precio de bodega es 9.200 (8.000 + 15 %)", { b: await bal(), u: await unit(P) });
const rv = await raw("select qty::float, old_unit::float, new_unit::float, diff_total::float, source from erp_internal_revaluations where point_id = $1", [Z]);
ok(rv.length === 1 && rv[0].old_unit === 11500 && rv[0].new_unit === 9200 && rv[0].diff_total === -23000 && rv[0].source === "auto", "Queda el detalle: 10 und., de 11.500 a 9.200", rv);

console.log("2. Sube el costo: cargo automático");
await raw("update products set last_cost = 12000, last_cost_at = now() where id = $1", [P]);
d = await docs();
ok(d.length === 2 && d[1].kind === "charge" && d[1].amount === 46000, "Cargo de 46.000: (13.800 − 9.200) × 10", d);
ok(await bal() === 138000, "Zamora debe 138.000", await bal());
const due = (await raw("select due_date from erp_internal_docs where point_id = $1 and kind = 'charge'", [Z]))[0].due_date;
ok(!!due, "El cargo tiene su plazo de pago", due);

console.log("3. Varios productos en la misma factura: una sola nota por punto");
const [{ id: P2 }] = await raw("insert into products (store_id, name, sku, stock, cost_price, price_1, price_2, price_3, price_4, price_5) values ($1, 'ESPEJO', 'YB019', 0, 10000, 20000, 18000, 16000, 15000, 14000) returning id", [A]);
await raw("select public.erp__move($1, $2, $3, 50, 'purchase', 'test', null, 10000, 'carga', null, true)", [A, B1, P2]);
const [{ id: tr2 }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: P2, qty: 5 }])]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [tr2]);
const before = (await docs()).length;
await db.exec(`begin;
  update products set last_cost = 10000 where id = '${P}';
  update products set last_cost = 5000 where id = '${P2}';
commit;`);
d = await docs();
ok(d.length === before + 1, "Una sola nota para los 2 productos", d.slice(before));
ok(d[d.length - 1].kind === "credit" && d[d.length - 1].amount === (13800 - 11500) * 10 + (11500 - 5800) * 5, "Neto: (13.800−11.500)×10 + (11.500−5.800)×5 = 51.500 a favor de Zamora", d[d.length - 1]);

console.log("4. Revaluar ahora (vista previa y aplicar)");
await raw("update erp_point_costs set avg_cost = 20000 where point_id = $1 and product_id = $2", [Z, P]);
let pv = await one(OWNER, "select public.erp_internal_revalue_now($1, null, false) r", [A]);
ok(pv.ok && !pv.applied && pv.lines === 1 && n(pv.rows[0].diff) === (11500 - 20000) * 10, "Vista previa: ZAPATERO de 20.000 a 11.500 (−85.000)", pv);
ok(await unit(P) === 20000, "La vista previa no cambia nada");
pv = await one(OWNER, "select public.erp_internal_revalue_now($1, null, true) r", [A]);
ok(pv.applied && await unit(P) === 11500, "Aplicado: vuelve a 11.500", pv);
const list = await one(OWNER, "select public.erp_internal_revaluations_list($1, $2) r", [A, Z]);
ok(list.length >= 4 && list[0].source === "manual" && list[0].doc_number, "El historial muestra cada revaluación con su nota", list[0]);
ok(/tienda madre/.test((await as(ZUSER, "select public.erp_internal_revalue_now($1, null, false) r", [A]).then(() => "", (e) => e.message))), "Un usuario del punto no revalúa");

console.log("5. Puntos sin crédito no se tocan");
const [{ id: tr3 }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, C, JSON.stringify([{ product_id: P, qty: 3 }])]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [tr3]);
const cdocs = (await raw("select count(*)::int c from erp_internal_docs where point_id = $1", [C]))[0].c;
await raw("update products set last_cost = 7000 where id = $1", [P]);
ok((await raw("select count(*)::int c from erp_internal_docs where point_id = $1", [C]))[0].c === cdocs, "CISNEROS (sin crédito) no recibe notas");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
