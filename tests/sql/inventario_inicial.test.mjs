// Pruebas de 20261344: «Inventario inicial» (lo que no está en la lista queda en 0), informe en plata antes de aplicar
// y revertir un conteo (sobre 20261340, la auditoría del conteo).
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
const combined = path.join(os.tmpdir(), `remhub_inv_inicial_${process.pid}.sql`);
fs.writeFileSync(combined, [extra, ...["20261340_auditoria_conteo.sql", "20261344_inventario_inicial.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8"))].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid, s, p) => { await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return (await db.query(s, p)).rows; } finally { await db.query("select set_config('test.uid', '', false)"); } };
const U = (n) => `ae000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), VIEWER = U(3);

const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into erp_warehouses (store_id, code, name, active, is_default) values ($1, 'BP', 'Bodega principal', true, false) returning id", [S]);
const [{ id: C }] = await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, 'C', 'SEDE ZAMORA', true) returning id", [S]);
const prod = async (name, cost) => (await raw("insert into products (store_id, name, sku, cost_price, stock) values ($1, $2, $2, $3, 0) returning id", [S, name, cost]))[0].id;
const P1 = await prod("PARLANTE MY261BT", 50000);
const P2 = await prod("PARLANTE MY262BT", 40000);
const P3 = await prod("CONSOLA GAM 10", 30000);
const P4 = await prod("VENTILADOR SD 10993", 10000);
const P5 = await prod("VENTILADOR SD 10991", 12000);
const P6 = await prod("ORGANIZADOR MP98-10", 5000);
const stock = async (wh, p, q) => { await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, $4)", [wh, p, S, q]); await raw("update products set stock = stock + $2 where id = $1", [p, q]); };
await stock(B, P1, 10); await stock(B, P2, 5); await stock(B, P3, 4); await stock(B, P4, 7); await stock(B, P6, -2); await stock(C, P1, 3); await stock(C, P2, 2);
for (const [id, perms, point] of [[SELLER, "{inventory_adjust,inventory}", C], [VIEWER, "{inventory}", null]]) {
  await raw("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@x.co`]);
  await raw("insert into store_users (store_id, user_id, role, permissions, active, display_name, point_id) values ($1, $2, 'seller', $3, true, $4, $5)", [S, id, perms, `U${id.slice(-1)}`, point]);
}

const preview = (uid, wh, counted, mode = "count") => as(uid, "select public.erp_count_preview($1, $2, $3::jsonb, $4) r", [S, wh, JSON.stringify(counted), mode]).then((r) => r[0].r);
const post = (uid, wh, counted, notes = "Conteo") => as(uid, "select public.erp_count_audit_post($1, $2, $3, $4::jsonb) r", [S, wh, notes, JSON.stringify(counted)]).then((r) => r[0].r);
const start = (uid, wh, counted, expect, notes = "Arranque del punto") => as(uid, "select public.erp_count_start_post($1, $2, $3, $4::jsonb, $5) r", [S, wh, notes, JSON.stringify(counted), expect]).then((r) => r[0].r);
const get = (uid, id) => as(uid, "select public.erp_count_audit_get($1) r", [id]).then((r) => r[0].r);
const list = (uid) => as(uid, "select public.erp_count_audits_list($1, 30) r", [S]).then((r) => r[0].r);
const rprev = (uid, id) => as(uid, "select public.erp_count_revert_preview($1) r", [id]).then((r) => r[0].r);
const revert = (uid, id, note = null) => as(uid, "select public.erp_count_audit_revert($1, $2) r", [id, note]).then((r) => r[0].r);
const level = async (wh, p) => Number((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [wh, p]))[0]?.qty ?? 0);
const levels = async (wh) => Object.fromEntries(await Promise.all([P1, P2, P3, P4, P5, P6].map(async (p, i) => [`P${i + 1}`, await level(wh, p)])));
const counted = [{ product_id: P1, qty: 10 }, { product_id: P2, qty: 3 }, { product_id: P5, qty: 1 }];

console.log("Informe antes de aplicar · conteo normal");
const pv = await preview(OWNER, B, counted);
ok(pv.ok && pv.counted === 3 && pv.matched === 1 && pv.over === 1 && pv.over_units === 1 && Number(pv.over_value) === 12000, "Sobra 1 und. por $12.000", pv);
ok(pv.short === 1 && pv.short_units === 2 && Number(pv.short_value) === 80000, "Faltan 2 und. por $80.000", pv);
ok(pv.uncounted === 2 && pv.uncounted_units === 11 && Number(pv.uncounted_value) === 190000 && pv.removed === 0, "Sin contar: 2 productos (11 und., $190.000); no se saca nada", pv);
ok(pv.net_units === -1 && Number(pv.net_value) === -68000, "Diferencia neta: −1 und. y −$68.000", pv);
ok(pv.top_diffs.length === 2 && pv.top_diffs[0].product_id === P2 && pv.top_diffs[0].diff === -2, "Las diferencias más grandes en plata primero", pv.top_diffs);
ok(JSON.stringify(await levels(B)) === JSON.stringify({ P1: 10, P2: 5, P3: 4, P4: 7, P5: 0, P6: -2 }), "Ver el informe no mueve nada");

console.log("Informe antes de aplicar · inventario inicial");
const ps = await preview(OWNER, B, counted, "start");
ok(ps.ok && ps.mode === "start" && ps.removed === 3 && ps.removed_units === 9 && ps.negatives === 1, "Se sacan 3 productos (9 und.), uno estaba en negativo", ps);
ok(Number(ps.removed_value) === 180000 && Number(ps.net_value) === -248000 && ps.uncounted === 0, "Valor de lo que se saca $180.000; neta −$248.000; nada queda sin contar", ps);
ok(ps.removed_items.length === 3 && ps.removed_items[0].product_id === P3 && ps.removed_items.some((r) => r.product_id === P6 && r.qty === -2), "La lista en rojo trae todo lo que se saca, lo más caro primero", ps.removed_items);
const pz = await preview(SELLER, C, [{ product_id: P1, qty: 3 }], "start");
ok(pz.ok && pz.can_cost === false && pz.removed === 1 && pz.removed_value === null && pz.net_value === null && pz.removed_items[0].unit_cost === null, "Sin «Ver costos» se ve en unidades, sin plata", pz);
ok((await preview(SELLER, B, counted, "start")).message === "Esa bodega no es de tu punto.", "Un usuario de punto no ve otra bodega");
ok((await preview(VIEWER, B, counted)).ok === false, "Con solo «Inventario» no hay informe de ajuste");
ok((await preview(OWNER, B, counted, "todo")).message === "Tipo de conteo no válido.", "Tipo de conteo inválido");
ok((await preview(OWNER, B, [{ product_id: P1, qty: -1 }])).message === "Hay una cantidad contada inválida.", "Valida igual que al aplicar");

console.log("Aplicar el inventario inicial");
const bad = await start(OWNER, B, counted, 2);
ok(bad.ok === false && bad.changed === true && bad.removed === 3 && /ahora se sacarían 3 productos/.test(bad.message), "Si no coincide con el informe que se vio, no aplica", bad);
ok(await level(B, P3) === 4, "…y no movió nada");
ok((await start(OWNER, B, counted, null)).ok === false, "Sin decir cuántos se sacan no aplica");
const s1 = await start(OWNER, B, counted, 3);
ok(s1.ok && s1.mode === "start" && s1.removed === 3 && s1.adjustment_id && s1.over === 1 && s1.short === 1, "Aplica: 1 sobra, 1 falta, 3 se sacan", s1);
ok(JSON.stringify(await levels(B)) === JSON.stringify({ P1: 10, P2: 3, P3: 0, P4: 0, P5: 1, P6: 0 }), "La bodega queda igual a la lista: lo demás en 0 (también el negativo)", await levels(B));
const adj = (await raw("select reason, notes from erp_adjustments where id = $1", [s1.adjustment_id]))[0];
ok(adj.reason === "count" && adj.notes === "🚩 Inventario inicial · Arranque del punto", "Un solo ajuste «Conteo físico» marcado como inventario inicial", adj);
ok((await raw("select count(*)::int n from erp_adjustment_items where adjustment_id = $1", [s1.adjustment_id]))[0].n === 5, "El ajuste lleva lo que no cuadró y lo que se sacó (5)");
ok((await raw("select count(*)::int n from erp_count_pending where warehouse_id = $1", [B]))[0].n === 0, "No queda nada pendiente por contar en esa bodega");
const g1 = await get(OWNER, s1.audit_id);
ok(g1.ok && g1.audit.mode === "start" && g1.audit.removed === 3 && g1.audit.removed_units === 9 && Number(g1.audit.removed_value) === 180000, "El informe guarda lo que se sacó y cuánto valía", g1.audit);
ok(Number(g1.audit.net_value) === -248000 && Number(g1.audit.short_value) === 80000 && Number(g1.audit.over_value) === 12000, "…con la diferencia neta en plata", g1.audit);
ok(g1.diffs.length === 2 && g1.removed.length === 3 && g1.uncounted.length === 0, "Diferencias del conteo aparte de lo que se sacó", g1);
ok(g1.can_revert === true && g1.revert_block === null, "Se puede revertir", g1);
const audLog = await raw("select action from erp_audit_logs where entity_id = $1", [s1.audit_id]);
ok(audLog.some((r) => r.action === "count.start_inventory"), "Queda en la auditoría global", audLog);
const lo = await list(OWNER);
ok(lo.items[0].mode === "start" && lo.items[0].removed === 3 && lo.items[0].reverted_at === null, "El historial lo marca como inventario inicial", lo.items[0]);

console.log("Revertir el inventario inicial");
await raw("update erp_stock_levels set qty = qty - 1 where warehouse_id = $1 and product_id = $2", [B, P2]); // se vendió 1 después
const rp = await rprev(OWNER, s1.audit_id);
ok(rp.ok && rp.changes === 4 && rp.short === 1, "Vista previa: 4 cambian y 1 no se puede devolver completo (el que estaba en negativo)", rp);
ok(rp.items.find((i) => i.product_id === P2)?.target === 4 && rp.items.find((i) => i.product_id === P4)?.target === 7, "Devuelve la diferencia, respetando lo vendido después", rp.items);
ok(Number(rp.value) === 40000 * 2 - 12000 + 30000 * 4 + 10000 * 7, "Valor de lo que vuelve", rp.value);
ok((await rprev(SELLER, s1.audit_id)).ok === false && (await revert(SELLER, s1.audit_id)).ok === false, "Un usuario de otro punto no lo revierte");
ok((await revert(VIEWER, s1.audit_id)).ok === false, "Con solo «Inventario» tampoco");
ok((await get(VIEWER, s1.audit_id)).can_revert === false, "…y el informe se lo dice");
const r1 = await revert(OWNER, s1.audit_id, "Nos equivocamos de bodega");
ok(r1.ok && r1.changes === 4 && r1.short === 1 && r1.adjustment_id, "Revierte con un ajuste nuevo", r1);
ok(JSON.stringify(await levels(B)) === JSON.stringify({ P1: 10, P2: 4, P3: 4, P4: 7, P5: 0, P6: 0 }), "Todo vuelve (menos lo vendido después; el negativo no vuelve a negativo)", await levels(B));
const radj = (await raw("select reason, notes from erp_adjustments where id = $1", [r1.adjustment_id]))[0];
ok(radj.reason === "correction" && /^Reversa del inventario inicial del \d\d\/\d\d\/\d{4} \(ajuste #\d+\) · Nos equivocamos de bodega$/.test(radj.notes), "El ajuste dice qué revierte y por qué", radj);
const g2 = await get(OWNER, s1.audit_id);
ok(g2.audit.reverted_at && g2.audit.reverted_by_name === "Dueño" && g2.audit.revert_note === "Nos equivocamos de bodega" && g2.audit.revert_adjustment_number, "El informe queda marcado como revertido", g2.audit);
ok(g2.audit.revert_short.length === 1 && g2.audit.revert_short[0].product_id === P6 && g2.can_revert === false && g2.revert_block === "Este conteo ya se revirtió.", "Dice qué no se pudo devolver y no deja revertir otra vez", g2);
ok((await revert(OWNER, s1.audit_id)).message === "Este conteo ya se revirtió.", "Una sola vez");
const pend = (await raw("select product_id from erp_count_pending where warehouse_id = $1", [B])).map((r) => r.product_id).sort();
ok(pend.length === 2 && pend.includes(P3) && pend.includes(P4), "Lo que se había sacado vuelve como «pendiente por contar»", pend);
ok((await raw("select count(*)::int n from erp_count_last where audit_id = $1", [s1.audit_id]))[0].n === 0, "Lo contado en ese conteo ya no cuenta como revisado");
ok((await raw("select action from erp_audit_logs where entity_id = $1 and action = 'count.reverted'", [s1.audit_id])).length === 1, "La reversa queda en la auditoría global");

console.log("Conteo normal: sigue igual y también se revierte");
const a1 = await post(OWNER, B, [{ product_id: P4, qty: 5 }]);
ok(a1.ok && a1.short === 1 && a1.removed === 0 && a1.mode === "count" && await level(B, P4) === 5 && await level(B, P3) === 4, "Lo no contado no se toca", a1);
const g3 = await get(OWNER, a1.audit_id);
ok(g3.audit.mode === "count" && Number(g3.audit.net_value) === -20000 && g3.removed.length === 0, "Informe con la diferencia neta (−$20.000)", g3.audit);
const a2 = await post(OWNER, B, [{ product_id: P1, qty: 10 }]);
ok(a2.ok && a2.adjustment_id === null, "Un conteo donde todo cuadró");
ok((await get(OWNER, a2.audit_id)).revert_block === "Este conteo no cambió el inventario: no hay nada que revertir.", "…no tiene nada que revertir");
const a3 = await post(OWNER, B, [{ product_id: P2, qty: 6 }]);
const blocked = await revert(OWNER, a1.audit_id);
ok(blocked.ok === false && /^Solo se puede revertir el último conteo de esta bodega: después se hizo otro el \d\d\/\d\d\/\d{4}\. Revierte primero ese\.$/.test(blocked.message), "Solo el último que cambió algo (el que todo cuadró no estorba)", blocked);
ok((await revert(OWNER, a3.audit_id)).ok && await level(B, P2) === 4, "Se revierte el último");
const r4 = await revert(OWNER, a1.audit_id);
ok(r4.ok && await level(B, P4) === 7, "…y después el anterior", r4);
const radj2 = (await raw("select notes from erp_adjustments where id = $1", [r4.adjustment_id]))[0];
ok(/^Reversa del conteo físico del /.test(radj2.notes), "Nota de la reversa del conteo", radj2);

console.log("Usuario de punto y su bodega");
const sz = await start(SELLER, C, [{ product_id: P1, qty: 3 }], 1);
ok(sz.ok && await level(C, P2) === 0 && await level(C, P1) === 3, "Hace el inventario inicial de su punto", sz);
const gz = await get(SELLER, sz.audit_id);
ok(gz.can_cost === false && gz.audit.removed_value === null && gz.audit.net_value === null && gz.can_revert === true, "Sin plata, pero lo puede revertir", gz);
ok((await revert(SELLER, sz.audit_id)).ok && await level(C, P2) === 2, "Y lo revierte");
ok((await start(SELLER, B, counted, 0)).message === "Esa bodega no es de tu punto.", "No hace inventario inicial de otra bodega");
ok((await start(VIEWER, B, counted, 0)).ok === false, "Con solo «Inventario» no");
ok((await start(null, B, counted, 0)).ok === false, "Sin sesión no");

console.log("Funciones cerradas");
const fp = await raw(`select
  has_function_privilege('anon', 'public.erp_count_start_post(uuid, uuid, text, jsonb, integer)', 'execute') a,
  has_function_privilege('anon', 'public.erp_count_audit_revert(uuid, text)', 'execute') b,
  has_function_privilege('anon', 'public.erp_count_preview(uuid, uuid, jsonb, text)', 'execute') c,
  has_function_privilege('authenticated', 'public.erp__count_post(uuid, uuid, text, jsonb, text, integer)', 'execute') d,
  has_function_privilege('authenticated', 'public.erp_count_start_post(uuid, uuid, text, jsonb, integer)', 'execute') e`);
ok(!fp[0].a && !fp[0].b && !fp[0].c && !fp[0].d && fp[0].e, "Sin sesión no se llaman; la interna no se llama desde afuera", fp[0]);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
