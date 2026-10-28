// Pruebas de 20261265: eliminar un producto con unidades haciéndose responsable (queda en la auditoría).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_elim_unid_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  `create table if not exists public.erp_employee_loans (id uuid primary key default gen_random_uuid(), store_id uuid, status text not null default 'active', items jsonb not null default '[]');
   create table if not exists public.product_image_vectors (product_id uuid references public.products(id), store_id uuid, embedding text);
   -- Como la de producción (20261027): guarda categoría, gravedad y motivo.
   create or replace function public.erp__audit_insert(p_store uuid, p_point uuid, p_category text, p_severity text, p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb, p_reason text, p_detail jsonb)
   returns void language sql security definer set search_path = public as $f$
     insert into public.erp_audit_logs (store_id, user_id, action, entity, entity_id, detail)
     values (p_store, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_before, '{}') || p_detail || jsonb_build_object('category', p_category, 'severity', p_severity, 'reason', p_reason));
   $f$;`,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);
for (const f of ["20261260_eliminar_productos.sql", "20261263_eliminar_productos_sin_ventas.sql", "20261264_eliminar_productos_traslados.sql", "20261265_eliminar_productos_con_unidades.sql", "20261265_eliminar_productos_con_unidades.sql"]) {
  await db.exec(fs.readFileSync(path.join(here, "migraciones", f), "utf8"));
}

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const OWNER = "df000000-0000-0000-0000-000000000001";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'B', 'Bodega', true, 'warehouse') returning id", [A]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'Zamora', true, 'point') returning id", [A]);
const prod = async (name) => (await raw("insert into products (store_id, name, sku, active, stock) values ($1, $2, $3, false, 0) returning id", [A, name, `SKU-${name}`]))[0].id;
const check = (id) => one(OWNER, "select public.erp_product_delete_check($1) r", [id]);
const transfer = async (pid, status) => {
  const [{ id: T }] = await raw("insert into erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, status) values ($1, (select coalesce(max(number), 0) + 1 from erp_transfers), $2, $3, $4) returning id", [A, B, Z, status]);
  await raw("insert into erp_transfer_items (transfer_id, product_id, qty) values ($1, $2, 2)", [T, pid]);
};
const stock = (wh, pid, qty) => raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, $4)", [wh, pid, A, qty]);

const U = await prod("POWER BANK");
await raw("update products set cost_price = 30000 where id = $1", [U]);
await stock(Z, U, 3);
await stock(B, U, 7);
const c = await check(U);
ok(c.can_delete === false && c.units_only === true, "Solo lo bloquean las unidades: units_only", c);
ok(Number(c.stock.units) === 10 && Number(c.stock.value) === 300000 && c.stock.points.length === 2, "Muestra 10 unidades en 2 puntos por $300.000", c.stock);
ok(/unidades en inventario/.test(await err(OWNER, "select public.erp_product_delete($1, 'Ya no sirve') r", [U]) ?? ""), "Sin hacerse responsable no se elimina");
ok(/mínimo 10/.test(await err(OWNER, "select public.erp_product_delete($1, 'Dañado', true) r", [U]) ?? ""), "Haciéndose responsable pide un motivo de 10 letras");
const d = await one(OWNER, "select public.erp_product_delete($1, 'Se dañaron todas en la bodega', true) r", [U]);
ok(d.ok && d.responsible === true && Number(d.units) === 10, "Con motivo y responsable: se elimina", d);
ok(!(await raw("select 1 from products where id = $1", [U])).length && !(await raw("select 1 from erp_stock_levels where product_id = $1", [U])).length, "Se van el producto y sus existencias");
const [log] = await raw("select user_id::text u, action, detail from erp_audit_logs where entity_id = $1 order by created_at desc limit 1", [U]);
ok(log?.action === "product.deleted_with_units" && log.u === OWNER && Number(log.detail.units) === 10 && Number(log.detail.value) === 300000
  && log.detail.points.length === 2 && /dañaron/.test(log.detail.reason) && log.detail.severity === "critical" && log.detail.category === "catalog", "La auditoría (crítica) guarda quién, unidades por punto, valor y motivo", log);

const S = await prod("VENDIDO CON UNIDADES");
await stock(Z, S, 4);
await transfer(S, "received");
const cs = await check(S);
ok(cs.can_delete === false && cs.units_only === false, "Con traslados además de unidades: no ofrece hacerse responsable", cs);
ok(/Traslados/.test(await err(OWNER, "select public.erp_product_delete($1, 'Me hago responsable de todo', true) r", [S]) ?? ""), "Y aunque lo pida, no se elimina");

const N = await prod("SIN NADA");
const dn = await one(OWNER, "select public.erp_product_delete($1, 'Prueba') r", [N]);
ok(dn.ok && dn.responsible === false, "Sin unidades sigue igual (motivo corto, sin responsable)");
const [ln] = await raw("select action from erp_audit_logs where entity_id = $1", [N]);
ok(ln?.action === "product.deleted", "Y queda como product.deleted");

const STR = await prod("OTRO USUARIO");
await stock(Z, STR, 1);
ok(/permiso/.test(await err("df000000-0000-0000-0000-000000000009", "select public.erp_product_delete($1, 'Me hago responsable', true) r", [STR]) ?? ""), "Alguien sin permiso no puede");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
