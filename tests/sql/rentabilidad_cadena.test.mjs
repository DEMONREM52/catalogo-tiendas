// Pruebas de 20261125: ganancia de la cadena proveedor → bodega → punto con la función REAL de ventas de producción.
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
`;
const combined = path.join(os.tmpdir(), `remhub_rc_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_finanzas.sql"), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
  fs.readFileSync(path.join(MIG, "20261124_credito_traslados.sql"), "utf8"),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M25 = fs.readFileSync(path.join(MIG, "20261125_rentabilidad_cadena.sql"), "utf8");

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}

const U = (n) => `c9000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CIS = U(2), VEND = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'CIS', 'CISNEROS', true, 'point') returning id", [A]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'ZAM', 'ZAMORA', true, 'point') returning id", [A]);
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{transfers,internal_credit}',$4), ($1,$3,'seller','{pos}',null)`, [A, CIS, VEND, C]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock, cost_price, price_1, price_2, price_3, price_4, price_5) values ($1, 'OLLAS', 0, 18000, 30000, 28000, 26000, 25000, 24000) returning id", [A]);
await raw("select public.erp__move($1, $2, $3, 100, 'purchase', 'test', null, 18000, 'carga', null, true)", [A, B, P]);
await raw("select public.erp__move($1, $2, $3, 10, 'purchase', 'test', null, 18000, 'carga', null, true)", [A, Z, P]);

// Cisneros con crédito (15 %) y un traslado recibido ANTES de esta migración.
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true, \"term_days\": 30}'::jsonb)", [A, C]);
const [{ id: T }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B, C, JSON.stringify([{ product_id: P, qty: 10 }])]);
await as(CIS, "select public.erp_confirm_transfer($1, null, 'ok')", [T]);
ok((await raw("select count(*)::int n from information_schema.columns where table_name = 'erp_internal_docs' and column_name = 'cost_amount'"))[0].n === 0
   && (await raw("select count(*)::int n from erp_internal_docs where transfer_id = $1", [T]))[0].n === 1, "Antes de 20261125 ya había deuda, pero sin costo real");

console.log("1. Migración");
await db.exec(M25);
await db.exec(M25);
ok(Number((await raw("select cost_amount from erp_internal_docs where transfer_id = $1", [T]))[0].cost_amount) === 180000, "Completa el costo real de lo que ya existía (10 × $18.000)");
const def = (await raw("select pg_get_functiondef('public.erp__capture_sale_finance()'::regprocedure) d"))[0].d;
ok((def.match(/v_icost numeric/g) ?? []).length === 1 && (def.match(/v_src := 'internal'/g) ?? []).length === 1, "Ajuste aplicado una sola vez (idempotente)");
ok(def.includes("Nunca frena la venta"), "El resto de la función de ventas sigue igual");

console.log("2. Venta en Cisneros (con crédito)");
const sell = async (point, qty, price) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status) values ($1, md5(random()::text), $2, 'confirmed') returning id", [A, qty * price]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, $4)", [id, P, qty, price]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, point]);
  await raw("insert into erp_order_stock (order_id, store_id, warehouse_id) values ($1, $2, $3)", [id, A, point]);
  return (await raw("select * from erp_sale_finance where order_id = $1", [id]))[0];
};
const f1 = await sell(C, 2, 26000);
ok(f1 && f1.ref_source === "internal" && Number(f1.ref_unit) === 20700, "Costo de Cisneros = lo que la bodega le cobró ($20.700)", f1);
ok(Number(f1.cost_total) === 36000 && Number(f1.mother_amount) === 5400 && Number(f1.point_amount) === 10600 && Number(f1.profit) === 16000,
  "Bodega gana $5.400, Cisneros $10.600, total $16.000", f1 && { c: f1.cost_total, m: f1.mother_amount, p: f1.point_amount });
ok((await raw("select count(*)::int n from erp_finance_capture_errors"))[0].n === 0, "Sin errores al registrar la venta");

console.log("3. Venta en Zamora (sin crédito): igual que siempre");
const f2 = await sell(Z, 1, 30000);
ok(f2 && f2.ref_source !== "internal" && Number(f2.mother_amount) === 12000 && Number(f2.point_amount) === 0, "Sin crédito: toda la ganancia para la madre, como antes", f2);

console.log("4. Informe de la cadena");
const today = (await raw("select public.erp__internal_today()::text d"))[0].d;
const rep = (await as(OWNER, "select public.erp_internal_profit($1, $2::date - 30, $2::date) r", [A, today]))[0].r;
const t = rep.totals;
ok(rep.ok && t.revenue === 52000 && t.internal_cost === 41400 && t.real_cost === 36000 && t.bodega_profit === 5400 && t.point_profit === 10600, "Proveedor $36.000 → bodega $41.400 → Cisneros vende $52.000", t);
ok(t.charged === 207000 && rep.points[0].charged_cost === 180000 && t.balance === 207000, "Trasladado $207.000 (costo real $180.000) y deuda", { charged: t.charged, cost: rep.points[0].charged_cost, bal: t.balance });

console.log("5. Novedad: la bodega pierde su costo real");
const [{ id: CL }] = await as(CIS, "select public.erp_internal_claim_create($1, $2, $3, 1, 'damaged', 'rota', null) id", [A, C, P]);
await as(OWNER, "select public.erp_internal_claim_decide($1, true, 'ok')", [CL]);
const loss = (await raw("select amount, cost_amount from erp_internal_docs where claim_id = $1", [CL]))[0];
ok(Number(loss.amount) === 20700 && Number(loss.cost_amount) === 18000, "Le baja $20.700 a Cisneros; la bodega pierde $18.000 reales", loss);
ok((await as(OWNER, "select public.erp_internal_profit($1, $2::date - 30, $2::date) r", [A, today]))[0].r.totals.loss_cost === 18000, "El informe muestra la pérdida");

console.log("6. Permisos");
ok((await as(VEND, "select public.erp_internal_profit($1, $2::date - 30, $2::date) r", [A, today]))[0].r.ok === false, "Sin permiso no ve ganancias");
ok((await as(CIS, "select public.erp_internal_profit($1, $2::date - 30, $2::date) r", [A, today]))[0].r.ok === false, "El punto sin «Ver rentabilidad» tampoco");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
