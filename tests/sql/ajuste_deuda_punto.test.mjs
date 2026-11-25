// Pruebas de 20261342: los ajustes de un punto con crédito mueven su deuda con la bodega. Base copiada de deuda_a_costo.test.mjs.
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

const M42 = fs.readFileSync(path.join(MIG, "20261342_ajuste_mueve_deuda_punto.sql"), "utf8");
await db.exec(M42);
await db.exec(M42); // se puede correr dos veces

// Punto a costo (% bodega 0): Zamora tiene 10 a 10.000 → debe 100.000.
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true, \"pct\": 0}'::jsonb)", [A, Z]);
ok(await bal() === 100000, "Arranca debiendo 100.000 (10 × 10.000)", await bal());
const ADJ = (u, wh, reason, items) => one(u, "select public.erp_post_adjustment($1, $2, $3, 'prueba', $4::jsonb) r", [A, wh, reason, JSON.stringify(items)]);
const docOf = async (adj) => (await raw("select kind, sign, amount::float, cost_amount::float, due_date, note, status, adjustment_detail from erp_internal_docs where adjustment_id = $1", [adj]))[0];

console.log("1. Vista previa: faltan 3");
let pv = await one(OWNER, "select public.erp_adjustment_debt_preview($1, $2, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: P, qty_after: 7 }])]);
ok(pv.applies && pv.money && n(pv.short_units) === 3 && n(pv.short_value) === 30000 && n(pv.balance_after) === 70000, "Baja 30.000 y queda en 70.000", pv);
ok(await bal() === 100000, "La vista previa no cambia nada");

console.log("2. Conteo físico: faltan 3 → baja la deuda");
const a1 = await ADJ(OWNER, Z, "count", [{ product_id: P, qty_after: 7 }]);
ok(await bal() === 70000, "Debe 70.000", await bal());
let d = await docOf(a1);
ok(d && d.kind === "loss" && d.sign === -1 && d.amount === 30000 && d.cost_amount === 30000, "Una nota de faltante por 30.000 (cuenta como pérdida de la bodega)", d);
ok(d.note.startsWith("Ajuste de inventario #") && d.note.endsWith("(conteo físico) · faltan 3 und. ($30.000)"), "La nota dice el ajuste, el motivo y lo que falta", d.note);
const after = await one(OWNER, "select public.erp_adjustment_debt($1) r", [a1]);
ok(after.applies && n(after.amount) === -30000 && n(after.balance_after) === 70000, "Después de aplicar se ve cuánto bajó y cómo quedó", after);
ok(n((await raw("select count(*) c from erp_audit_logs where action = 'internal.adjustment'")).at(0).c) === 1, "Queda en la auditoría");

console.log("3. Sobrante encontrado: sobran 2 → sube la deuda");
const a2 = await ADJ(OWNER, Z, "found", [{ product_id: P, qty_after: 9 }]);
d = await docOf(a2);
ok(d && d.kind === "charge" && d.amount === 20000 && d.due_date, "Un cargo por 20.000 con su plazo", d);
ok(await bal() === 90000, "Debe 90.000", await bal());

console.log("4. Uno sobra y otro falta por lo mismo: el neto es 0, no hay nota");
const [{ id: P2 }] = await raw("insert into products (store_id, name, sku, stock, cost_price, last_cost, price_1) values ($1, 'CALDERO', 'CL1', 0, 5000, 5000, 9000) returning id", [A]);
const a3 = await ADJ(OWNER, Z, "correction", [{ product_id: P, qty_after: 8 }, { product_id: P2, qty_after: 2 }]);
ok(!(await docOf(a3)), "Sin nota (−10.000 + 10.000)");
ok(await bal() === 90000, "La deuda sigue en 90.000");
ok(n((await raw("select avg_cost from erp_point_costs where point_id = $1 and product_id = $2", [Z, P2]))[0]?.avg_cost) === 5000, "El caldero que sobró queda con su precio de bodega (5.000)");

console.log("5. Cuadra con «Cuadrar con el costo»");
const rc = await one(OWNER, "select public.erp_internal_reconcile($1, $2, false) r", [A, Z]);
ok(Math.abs(n(rc.diff)) < 1, "El cuadre no encuentra diferencia: el ajuste ya dejó la deuda bien", rc);

console.log("6. Lo que no mueve la deuda");
const a4 = await ADJ(OWNER, B1, "count", [{ product_id: P, qty_after: 50 }]);
ok(!(await docOf(a4)), "Un ajuste en la bodega no crea nota");
const a5 = await ADJ(OWNER, C, "found", [{ product_id: P, qty_after: 3 }]);
ok(!(await docOf(a5)), "Un punto sin crédito no crea nota");
ok(!(await one(OWNER, "select public.erp_adjustment_debt_preview($1, $2, $3::jsonb) r", [A, C, JSON.stringify([{ product_id: P, qty_after: 1 }])])).applies, "La vista previa dice que no aplica en un punto sin crédito");

console.log("7. No se anula a mano");
const docId = (await raw("select id from erp_internal_docs where adjustment_id = $1", [a2]))[0].id;
const err = await as(OWNER, "select public.erp_internal_doc_void($1, 'x')", [docId]).then(() => "", (e) => e.message);
ok(/ajuste de inventario/.test(err), "Anular el cargo del ajuste da error claro", err);
ok(await bal() === 90000, "La deuda no cambia");

console.log("8. Permisos de la vista previa");
const ADJUSTER = U(9);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{inventory_adjust}',$3)", [A, ADJUSTER, Z]);
pv = await one(ADJUSTER, "select public.erp_adjustment_debt_preview($1, $2, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: P, qty_after: 6 }])]);
ok(pv.applies && pv.money === false && pv.short_value === undefined && n(pv.short_units) === 2, "Quien solo ajusta ve las unidades, no la plata", pv);
pv = await one(SELLER, "select public.erp_adjustment_debt_preview($1, $2, $3::jsonb) r", [A, Z, JSON.stringify([{ product_id: P, qty_after: 6 }])]);
ok(pv.ok === false, "Sin permiso de ajustar no hay vista previa", pv);
const g = await raw("select has_function_privilege('anon', 'public.erp_adjustment_debt_preview(uuid, uuid, jsonb)', 'execute') a, has_function_privilege('authenticated', 'public.erp__internal_from_adjustment(uuid)', 'execute') b");
ok(g[0].a === false && g[0].b === false, "Sin acceso anónimo ni a las funciones internas", g[0]);

console.log(`
${pass} bien, ${fail} mal`);
if (fail) process.exit(1);
