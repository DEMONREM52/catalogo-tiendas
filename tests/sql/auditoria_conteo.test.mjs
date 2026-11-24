// Pruebas de 20261340: auditoría del conteo físico (lo que cuadra, sobra, falta y lo que quedó sin contar).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// erp_my_points (20261318) simplificada: un usuario con punto solo ve ese punto.
const extra = `
alter table public.store_users add column if not exists point_id uuid;
create or replace function public.erp_my_points(p_store uuid)
returns uuid[] language sql stable security definer set search_path = public as $fn$
  select case when su.point_id is null then null else array[su.point_id] end
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role <> 'store_admin'
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
  limit 1;
$fn$;
`;
const combined = path.join(os.tmpdir(), `remhub_auditoria_${process.pid}.sql`);
fs.writeFileSync(combined, [extra, fs.readFileSync(path.join(MIG, "20261340_auditoria_conteo.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return (await db.query(s, p)).rows; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const U = (n) => `ad000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), VIEWER = U(3), NOBODY = U(4);

const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: S2 }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [U(9)]);
const [{ id: B }] = await raw("insert into erp_warehouses (store_id, code, name, active, is_default) values ($1, 'BP', 'Bodega principal', true, false) returning id", [S]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'C', 'SEDE ZAMORA', true) returning id", [S]);
const prod = async (name, cost, store = S) => (await raw("insert into products (store_id, name, sku, cost_price, stock) values ($1, $2, $2, $3, 0) returning id", [store, name, cost]))[0].id;
const P1 = await prod("PARLANTE MY261BT", 50000);
const P2 = await prod("PARLANTE MY262BT", 40000);
const P3 = await prod("CONSOLA GAM 10", 30000);
const P4 = await prod("VENTILADOR SD 10993", 10000);
const P5 = await prod("VENTILADOR SD 10991", 12000);
const OTHER = await prod("DE OTRA TIENDA", 1000, S2);
const stock = async (wh, p, q) => { await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, $4)", [wh, p, S, q]); await raw("update products set stock = stock + $2 where id = $1", [p, q]); };
await stock(B, P1, 10); await stock(B, P2, 5); await stock(B, P3, 4); await stock(B, P4, 7); await stock(C, P1, 3);
for (const [id, perms, point] of [[SELLER, "{inventory_adjust,inventory}", C], [VIEWER, "{inventory}", null], [NOBODY, "{pos}", null]]) {
  await raw("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@x.co`]);
  await raw("insert into store_users (store_id, user_id, role, permissions, active, display_name, point_id) values ($1, $2, 'seller', $3, true, $4, $5)", [S, id, perms, `U${id.slice(-1)}`, point]);
}

const progress = (uid, wh) => as(uid, "select public.erp_count_progress($1, $2) r", [S, wh]).then((r) => r[0].r);
const post = (uid, wh, counted, notes = "Conteo de prueba") => as(uid, "select public.erp_count_audit_post($1, $2, $3, $4::jsonb) r", [S, wh, notes, JSON.stringify(counted)]).then((r) => r[0].r);
const get = (uid, id) => as(uid, "select public.erp_count_audit_get($1) r", [id]).then((r) => r[0].r);
const list = (uid) => as(uid, "select public.erp_count_audits_list($1, 30) r", [S]).then((r) => r[0].r);
const level = async (wh, p) => Number((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [wh, p]))[0]?.qty ?? 0);

console.log("Lo que hay en la bodega");
const pr = await progress(OWNER, B);
ok(pr.ok && pr.items.length === 4 && pr.items[0].product_id === P1 && pr.items[0].qty === 10, "Muestra los 4 productos con existencias, de más a menos", pr);
ok(pr.items.every((i) => i.pending_since === null && i.recent === false), "Al principio nada está pendiente ni contado");

console.log("Primera auditoría: cuadra, falta, sobra y lo que no se contó");
const a1 = await post(OWNER, B, [{ product_id: P1, qty: 10 }, { product_id: P2, qty: 3 }, { product_id: P5, qty: 1 }]);
ok(a1.ok && a1.adjustment_id && a1.counted === 3 && a1.matched === 1 && a1.over === 1 && a1.short === 1 && a1.uncounted === 2, "Resumen: 1 cuadra, 1 sobra, 1 falta, 2 sin contar", a1);
ok(await level(B, P2) === 3 && await level(B, P5) === 1 && await level(B, P1) === 10, "Solo se ajustó lo que no cuadraba");
ok(await level(B, P3) === 4 && await level(B, P4) === 7, "Lo que no se contó se deja como está (A1)");
const items1 = await raw("select product_id, diff from erp_adjustment_items where adjustment_id = $1", [a1.adjustment_id]);
ok(items1.length === 2, "El ajuste lleva solo las 2 diferencias", items1);
const adj1 = (await raw("select reason from erp_adjustments where id = $1", [a1.adjustment_id]))[0];
ok(adj1?.reason === "count", "El ajuste queda con motivo «Conteo físico»", adj1);
const pend1 = await raw("select product_id, qty_at from erp_count_pending where warehouse_id = $1 order by qty_at desc", [B]);
ok(pend1.length === 2 && pend1[0].product_id === P4 && pend1[0].qty_at === 7 && pend1[1].product_id === P3, "Quedan pendientes por contar: ventilador (7) y consola (4)", pend1);

const r1 = await get(OWNER, a1.audit_id);
ok(r1.ok && r1.can_cost && r1.audit.short_units === 2 && Number(r1.audit.short_value) === 80000 && r1.audit.over_units === 1 && Number(r1.audit.over_value) === 12000, "Informe con unidades y valor al costo", r1.audit);
ok(r1.audit.uncounted_units === 11 && Number(r1.audit.uncounted_value) === 190000 && r1.uncounted.length === 2 && r1.uncounted.every((u) => u.still_pending), "Sin contar: 11 und. por $190.000, siguen pendientes", r1);
ok(r1.diffs.length === 2 && r1.diffs[0].product_id === P2 && r1.diffs[0].diff === -2, "Faltantes primero en el informe", r1.diffs);
ok(r1.audit.created_by_name === "Dueño", "Queda quién lo hizo", r1.audit.created_by_name);

const pr2 = await progress(OWNER, B);
const byId = new Map(pr2.items.map((i) => [i.product_id, i]));
ok(byId.get(P4).pending_since && byId.get(P1).recent === true && byId.get(P1).pending_since === null, "La bodega marca pendientes y lo contado hace poco", pr2.items);

console.log("Segunda auditoría: todo cuadra (sin ajuste) y se cuenta un pendiente");
const since4 = (await raw("select since from erp_count_pending where product_id = $1", [P4]))[0].since;
const a2 = await post(OWNER, B, [{ product_id: P3, qty: 4 }]);
ok(a2.ok && a2.adjustment_id === null && a2.matched === 1 && a2.uncounted === 1, "Todo cuadra: queda la auditoría sin ajuste; sin contar solo lo no revisado", a2);
const r2 = await get(OWNER, a2.audit_id);
ok(r2.audit.recent === 3 && r2.uncounted.length === 1 && r2.uncounted[0].product_id === P4, "Lo contado hace poco (3) no se vuelve a pedir", r2);
const pend2 = await raw("select product_id, since from erp_count_pending where warehouse_id = $1", [B]);
ok(pend2.length === 1 && pend2[0].product_id === P4 && String(pend2[0].since) === String(since4), "La consola sale de pendientes; el ventilador conserva desde cuándo", pend2);
const r1b = await get(OWNER, a1.audit_id);
ok(r1b.uncounted.find((u) => u.product_id === P3)?.still_pending === false && r1b.uncounted.find((u) => u.product_id === P4)?.still_pending === true, "El informe viejo dice qué ya se contó después", r1b.uncounted);

console.log("Permisos y punto");
ok((await progress(SELLER, B)).message === "Esa bodega no es de tu punto.", "Un usuario de punto no ve otra bodega");
ok((await post(SELLER, B, [{ product_id: P1, qty: 1 }])).ok === false && await level(B, P1) === 10, "Ni la cuenta");
const a3 = await post(SELLER, C, [{ product_id: P1, qty: 2 }]);
ok(a3.ok && a3.short === 1 && await level(C, P1) === 2, "Sí cuenta su punto", a3);
const ls = await list(SELLER);
ok(ls.ok && ls.items.length === 1 && ls.items[0].warehouse === "SEDE ZAMORA", "Su historial solo trae su punto", ls);
const lo = await list(OWNER);
ok(lo.items.length === 3 && lo.items[0].id === a3.audit_id, "El dueño ve todas, la más reciente primero", lo.items.map((i) => i.warehouse));
const rv = await get(VIEWER, a1.audit_id);
ok(rv.ok && rv.can_cost === false && rv.audit.short_value === null && rv.diffs[0].unit_cost === null && rv.uncounted[0].unit_cost === null, "Sin «Ver costos» no salen valores en plata", rv);
ok((await progress(VIEWER, B)).ok === false && (await post(VIEWER, B, [{ product_id: P1, qty: 1 }])).ok === false, "Con solo «Inventario» no se cuenta ni se ajusta");
ok((await list(NOBODY)).ok === false && (await get(NOBODY, a1.audit_id)).ok === false, "Sin permiso de inventario no ve nada");
ok((await post(null, B, [{ product_id: P1, qty: 1 }])).ok === false, "Sin sesión no hace nada");

console.log("Datos inválidos");
ok((await post(OWNER, B, [])).message === "El conteo no tiene productos.", "Conteo vacío");
ok((await post(OWNER, B, [{ product_id: P1, qty: -1 }])).message === "Hay una cantidad contada inválida.", "Cantidad negativa");
ok((await post(OWNER, B, [{ product_id: P1, qty: 1 }, { product_id: P1, qty: 2 }])).message === "Un producto está repetido en el conteo.", "Producto repetido");
ok((await post(OWNER, B, [{ product_id: OTHER, qty: 1 }])).message === "Un producto no pertenece a esta tienda.", "Producto de otra tienda");
ok(await level(B, P1) === 10, "Nada de eso movió el inventario");

console.log("Tablas cerradas");
const priv = await raw("select has_table_privilege('authenticated', 'public.erp_count_audits', 'select') a, has_table_privilege('authenticated', 'public.erp_count_pending', 'select') b, has_table_privilege('anon', 'public.erp_count_last', 'select') c");
ok(!priv[0].a && !priv[0].b && !priv[0].c, "Solo se leen con las funciones (que revisan permiso y punto)", priv);
const anon = await raw("select has_function_privilege('anon', 'public.erp_count_audit_post(uuid, uuid, text, jsonb)', 'execute') a");
ok(!anon[0].a, "Sin sesión no se puede llamar");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
