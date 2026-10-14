// Pruebas de 20261106_rentabilidad_precios_punto.sql sobre PGlite (Postgres real en memoria)
// con las funciones de ventas de producción (fixtures/prod_ventas.sql).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_rentabilidad_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8") + "\n" +
  fs.readFileSync(path.join(here, "../../supabase/migrations/20261106_rentabilidad_precios_punto.sql"), "utf8"));
const report = (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); };
process.on("uncaughtException", report);
process.on("unhandledRejection", report);
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

const U = (n) => `b0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), OWNER_B = U(2), APPROVER = U(3), MANAGER = U(4), SELLER = U(5), VIEWER_J = U(6);
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log("  ✔ " + label); } else { fail++; console.log("  ✘ " + label + (extra !== undefined ? " → " + JSON.stringify(extra).slice(0, 300) : "")); } };
const raw = async (sql, p) => (await db.query(sql, p)).rows;
async function as(uid, sql, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(sql, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (uid, sql, p) => { try { await as(uid, sql, p); return null; } catch (e) { return e.message; } };
const one = async (uid, sql, p) => (await as(uid, sql, p))[0]?.r;

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('robin', 'ROBIN', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [OWNER_B]);
const wh = async (store, name) => (await raw("insert into erp_warehouses (store_id, code, name, active) values ($1, $2, $2, true) returning id", [store, name]))[0].id;
const JAVIER = await wh(A, "JAVIER"), MARIA = await wh(A, "MARIA"), BP = await wh(B, "B1");
const member = (uid, role, perms, point) => raw("insert into store_users (store_id, user_id, role, permissions, point_id, active) values ($1, $2, $3, $4, $5, true)", [A, uid, role, perms, point]);
await member(APPROVER, "seller", ["profit_approve", "profit_view"], null);
await member(MANAGER, "seller", ["profit_rules", "pos"], JAVIER);
await member(SELLER, "seller", ["pos"], JAVIER);
await member(VIEWER_J, "seller", ["profit_view"], JAVIER);
const [{ id: P }] = await raw("insert into products (store_id, name, cost_price, price_1, price_2, price_3, price_4, price_5, stock) values ($1, 'ORGANIZADOR', 15000, 20000, 17000, 15750, 18000, 19000, 100) returning id", [A]);
const [{ id: P2 }] = await raw("insert into products (store_id, name, cost_price, price_3, stock) values ($1, 'SIN REGLA', 1000, 1500, 100) returning id", [A]);
for (const w of [JAVIER, MARIA]) for (const p of [P, P2]) await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 50)", [w, p, A]);

const save = (uid, point, scope, target, kind, value, reason = "Prueba de regla", from = null, to = null) =>
  one(uid, "select public.erp_price_rule_save($1, $2, $3, $4, $5, $6, $7, $8, $9) r", [A, point, scope, target, kind, value, from, to, reason]);
const prices = (uid, point) => as(uid, "select * from public.erp_point_prices($1, $2)", [A, point]);

console.log("Permisos y aislamiento");
ok(/permiso/i.test(await err(SELLER, "select public.erp_price_rule_save($1,$2,'product',$3,'pct',15,null,null,'x y z')", [A, JAVIER, P]) ?? ""), "Un vendedor sin permiso no crea reglas");
ok(/tus puntos/i.test(await err(MANAGER, "select public.erp_price_rule_save($1,$2,'product',$3,'pct',15,null,null,'otro punto')", [A, MARIA, P]) ?? ""), "El encargado de JAVIER no toca los precios de MARÍA");
ok(/no pertenece/i.test(await err(OWNER, "select public.erp_price_rule_save($1,$2,'product',$3,'pct',15,null,null,'cruzado')", [A, BP, P]) ?? ""), "No se puede usar un punto de otra tienda madre");
ok(/no perteneces/i.test(await err(OWNER_B, "select * from public.erp_point_prices($1,$2)", [A, JAVIER]) ?? ""), "Otra tienda madre no ve los precios de esta");
ok(/permission denied/i.test(await err(null, "select * from public.erp_point_prices($1,$2)", [A, JAVIER]) ?? ""), "Sin sesión no se puede consultar");
ok(/motivo/i.test(await err(MANAGER, "select public.erp_price_rule_save($1,$2,'product',$3,'pct',15,null,null,'')", [A, JAVIER, P]) ?? ""), "El motivo es obligatorio");

console.log("Aprobación y precio encadenado");
const r1 = await save(MANAGER, JAVIER, "product", P, "pct", 15, "Punto de alto tráfico");
ok(r1?.status === "pending", "La regla del encargado queda pendiente de aprobación", r1);
ok((await prices(SELLER, JAVIER)).length === 0, "Una regla pendiente no cambia precios");
ok(/permiso/i.test(await err(MANAGER, "select public.erp_price_rule_decide($1, true, null)", [r1.id]) ?? ""), "El encargado no se aprueba a sí mismo");
ok(/permiso/i.test(await err(OWNER_B, "select public.erp_price_rule_decide($1, true, null)", [r1.id]) ?? ""), "Otra tienda madre no aprueba");
ok((await one(APPROVER, "select public.erp_price_rule_decide($1, true, 'ok') r", [r1.id]))?.status === "active", "La madre la aprueba");
let pr = (await prices(SELLER, JAVIER)).find((x) => x.product_id === P);
ok(Number(pr?.price_3) === 18112.5, "Encadenado: referencia $15.750 + 15 % = $18.112,50", pr);
ok(Number(pr?.price_1) === 23000, "Aplica a cada nivel: precio 1 $20.000 + 15 % = $23.000", pr);
ok((await prices(SELLER, MARIA)).length === 0, "El vendedor de JAVIER no recibe precios de MARÍA");
ok((await prices(OWNER, MARIA)).length === 0, "MARÍA sin reglas sigue con los precios de la madre");

ok(/permite entre/i.test(await err(MANAGER, "select public.erp_price_rule_save($1,$2,'product',$3,'pct',500,null,null,'demasiado')", [A, JAVIER, P2]) ?? ""), "Fuera de los límites de la madre: bloqueado");
ok(/costo/i.test(await err(MANAGER, "select public.erp_price_rule_save($1,$2,'product',$3,'fixed',900,null,null,'bajo costo')", [A, JAVIER, P2]) ?? ""), "Precio fijo bajo el costo necesita aprobación");
ok(/entre -90/i.test(await err(OWNER, "select public.erp_price_rule_save($1,$2,'product',$3,'pct',-95,null,null,'negativo')", [A, JAVIER, P2]) ?? ""), "Porcentajes fuera de rango se rechazan");

await one(OWNER, "select public.erp_profit_settings_save($1, $2::jsonb, 'Redondeo comercial') r", [A, JSON.stringify({ rounding_step: 100, rounding_dir: "up", point_min_pct: 0, point_max_pct: 100, require_approval: true, price_guard: "observe" })]);
pr = (await prices(SELLER, JAVIER)).find((x) => x.product_id === P);
ok(Number(pr?.price_3) === 18200, "Con redondeo a $100 hacia arriba: $18.200", pr);
ok(/madre/i.test(await err(MANAGER, "select public.erp_profit_settings_save($1, '{}'::jsonb, 'cambio')", [A]) ?? ""), "Un punto no cambia la configuración de la madre");

const r2 = await save(OWNER, JAVIER, "product", P, "pct", 20, "Nueva versión");
const rules = await as(OWNER, "select id, status, version, live from public.erp_price_rules_list($1, $2)", [A, JAVIER]);
ok(r2.version === 2 && rules.find((x) => x.id === r1.id)?.status === "retired" && rules.find((x) => x.id === r2.id)?.live, "Una versión nueva reemplaza a la anterior sin borrarla", rules);
const [{ n: hist }] = await raw("select count(*)::int n from erp_price_rules where store_id = $1", [A]);
ok(hist === 2, "El historial de reglas se conserva");
const future = await save(OWNER, JAVIER, "point", null, "pct", 5, "Temporada", new Date(Date.now() + 86400000).toISOString());
ok((await prices(OWNER, JAVIER)).find((x) => x.product_id === P2) === undefined, "Una regla futura todavía no aplica", future);
await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, valid_from, valid_to, status, reason) values ($1, $2, 'point', 'pct', 50, now() - interval '10 days', now() - interval '1 day', 'active', 'vencida')", [A, MARIA]);
ok((await prices(OWNER, MARIA)).length === 0, "Una regla vencida ya no aplica");
ok(/ver las reglas/i.test(await err(SELLER, "select * from public.erp_price_rules_list($1)", [A]) ?? ""), "El vendedor no ve las reglas");
ok((await as(MANAGER, "select point_name from public.erp_price_rules_list($1)", [A])).every((x) => x.point_name === "JAVIER"), "El encargado solo ve reglas de su punto");

console.log("Guardián de precios");
const sell = async (uid, point, price, qty = 2) => {
  const r = await one(uid, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'CLIENTE') r", [A, JSON.stringify([{ product_id: P, qty, price }])]);
  const [{ id }] = await raw("select id from orders where token = $1", [r.token]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, point]);
  return id;
};
const oBad = await sell(SELLER, JAVIER, 1000);
const [{ n: logged }] = await raw("select count(*)::int n from erp_price_guard_log where order_id = $1 and not blocked", [oBad]);
ok(logged === 1, "Modo observar: un precio manipulado ($1.000) se deja pasar pero queda anotado");
await one(OWNER, "select public.erp_profit_settings_save($1, $2::jsonb, 'Activar bloqueo') r", [A, JSON.stringify({ rounding_step: 100, rounding_dir: "up", price_guard: "enforce" })]);
ok(/PRICE_MISMATCH/.test(await err(SELLER, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'X')", [A, JSON.stringify([{ product_id: P, qty: 1, price: 1000 }])]) ?? ""), "Modo bloquear: el precio manipulado se rechaza");
ok(/PRICE_MISMATCH/.test(await err(null, "select public.create_order_from_cart($1, 'retail', $2::jsonb, 'X')", [A, JSON.stringify([{ product_id: P, qty: 1, price: 1 }])]) ?? ""), "También bloquea pedidos sin sesión (catálogo público antiguo)");
const oPoint = await sell(SELLER, JAVIER, 18900); // 15750 * 1.20 = 18900 (versión 2)
ok(Boolean(oPoint), "El precio del punto ($18.900) pasa el guardián");
const oLevel = await sell(SELLER, MARIA, 20000, 1);
ok(Boolean(oLevel), "Un precio 1-5 de la madre pasa el guardián");

console.log("Foto financiera de la venta");
await raw("update orders set status = 'confirmed', confirmed_at = now() where id = any($1)", [[oPoint, oLevel, oBad]]);
for (const o of [oPoint, oLevel, oBad]) await raw("select public.erp__apply_order_stock($1)", [o]);
const f = (await raw("select * from erp_sale_finance where order_id = $1", [oPoint]))[0];
ok(f && Number(f.revenue) === 37800 && Number(f.cost_total) === 30000 && Number(f.ref_total) === 31500, "Venta en JAVIER: venta $37.800, costo $30.000, referencia $31.500", f);
ok(f && Number(f.mother_amount) === 1500 && Number(f.point_amount) === 6300 && Number(f.profit) === 7800, "Madre $1.500 + punto $6.300 = ganancia $7.800 (sin duplicar)", f);
ok(f?.ref_source === "point_rule" && f?.rule_id === r2.id && Number(f?.ref_level) === 3, "Guarda la regla y el nivel usados", f);
const fl = (await raw("select * from erp_sale_finance where order_id = $1", [oLevel]))[0];
ok(fl?.ref_source === "level" && Number(fl?.point_amount) === 0 && Number(fl?.mother_amount) === 5000, "Venta en MARÍA al precio 1: toda la ganancia es de la madre", fl);
const fb = (await raw("select * from erp_sale_finance where order_id = $1", [oBad]))[0];
ok(fb?.ref_source === "sold_price" && Number(fb?.profit) === -28000, "Precio que no coincide: queda marcado y muestra la pérdida", fb);
await raw("update products set cost_price = 99999 where id = $1", [P]);
const f2 = (await raw("select cost_total from erp_sale_finance where order_id = $1", [oPoint]))[0];
ok(Number(f2.cost_total) === 30000, "Si el costo cambia después, la venta conserva su costo original");
await raw("select public.erp__apply_order_stock($1)", [oPoint]);
const [{ n: dup }] = await raw("select count(*)::int n from erp_sale_finance where order_id = $1", [oPoint]);
ok(dup === 1, "Aplicar dos veces no duplica la foto");

console.log("Informe");
const day = [new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString()];
const sum = await one(APPROVER, "select public.erp_profit_summary($1, $2, $3) r", [A, ...day]);
ok(sum && Number(sum.kpis.revenue) === 37800 + 20000 + 2000 && sum.kpis.lines_estimated === 0, "La madre ve todas las ventas con costo real", sum?.kpis);
ok(Number(sum.kpis.mother) + Number(sum.kpis.point) === Number(sum.kpis.profit), "Partes madre + punto = ganancia total", sum?.kpis);
ok(sum.guard.mismatches >= 1 && sum.guard.recent.length >= 1, "El informe muestra los precios anotados por el guardián", sum?.guard);
const sj = await one(VIEWER_J, "select public.erp_profit_summary($1, $2, $3) r", [A, ...day]);
ok(sj.by_point.length === 1 && sj.by_point[0].name === "JAVIER" && sj.guard.recent.length === 0, "Un usuario de JAVIER solo ve JAVIER (sin detalles de la madre)", sj?.by_point);
ok(/tus puntos/i.test(await err(VIEWER_J, "select public.erp_profit_summary($1, $2, $3, $4)", [A, ...day, MARIA]) ?? ""), "Pedir el informe de MARÍA desde JAVIER: bloqueado");
ok(/permiso/i.test(await err(SELLER, "select public.erp_profit_summary($1, $2, $3)", [A, ...day]) ?? ""), "El vendedor no ve costos ni ganancias");
ok(/permiso/i.test(await err(OWNER_B, "select public.erp_profit_summary($1, $2, $3)", [A, ...day]) ?? ""), "Otra tienda madre no ve el informe");

console.log("Retiro");
await one(OWNER, "select public.erp_price_rule_retire($1, 'Fin de la prueba') r", [r2.id]);
ok((await prices(OWNER, JAVIER)).find((x) => x.product_id === P) === undefined, "Al retirar la regla vuelven los precios de la madre");
const [{ n: audits }] = await raw("select count(*)::int n from erp_audit_logs where store_id = $1 and action like 'price_rule.%'", [A]);
ok(audits >= 5, "Cada cambio de regla queda en auditoría", audits);

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
