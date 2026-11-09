// Pruebas de 20261303 (avisos de pedidos sin confirmar y sin completar). Base copiada de caja.test.mjs.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
create or replace function public.erp__order_visible(p_store uuid, p_order uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public.erp_my_points(p_store);
begin
  if v is null then return true; end if;
  return exists (select 1 from public.erp_order_meta m where m.order_id = p_order and m.point_id = any (v));
end;
$$;
`;
const combined = path.join(os.tmpdir(), `remhub_avisos_ped_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}

const U = (n) => `ce000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CIS = U(2), NADA = U(3), FUERA = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
await raw("select public.erp_ensure_default_warehouse($1)", [A]);
const wh = async (n) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, n]))[0].id;
const C = await wh("CISNEROS"), Z = await wh("ZAMORA");
await raw(`insert into store_users (store_id, user_id, role, permissions, point_id) values
  ($1,$2,'seller','{pos}',$4), ($1,$3,'seller','{products}',null)`, [A, CIS, NADA, C]);

const order = async (point, status, total, ago = "1 hour") => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, created_at, confirmed_at) values ($1, md5(random()::text), $2, $3, now() - $4::interval, case when $3 = 'confirmed' then now() - $4::interval end) returning id", [A, total, status, ago]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind) values ($1, $2, $3, 'remision')", [id, A, point]);
};
await order(C, "draft", 50000);
await order(C, "sent", 20000, "3 days");
await order(Z, "draft", 10000);
await order(C, "confirmed", 120000);
await order(Z, "confirmed", 30000, "2 days");
await order(C, "completed", 999000);
await order(C, "cancelled", 999000);
await order(C, "draft", 999000, "90 days"); // muy viejo: no cuenta

const M = fs.readFileSync(path.join(MIG, "20261303_avisos_pedidos_pendientes.sql"), "utf8");
await db.exec(M);
await db.exec(M); // se puede correr dos veces

const alerts = async (u) => (await as(u, "select public.erp_order_alerts($1) a", [A]))[0].a;
const get = (list, k) => list.find((a) => a.key.startsWith(k));

console.log("1. Dueño: ve todos los puntos");
let a = await alerts(OWNER);
ok(get(a, "orders-to-confirm")?.count === 3, "3 sin confirmar (borrador y enviado; no el de hace 90 días)", a);
ok(/\$80\.000/.test(get(a, "orders-to-confirm")?.body ?? ""), "Total de los sin confirmar $80.000", get(a, "orders-to-confirm"));
ok(get(a, "orders-to-confirm")?.severity === "warning" && /1 lleva más de un día/.test(get(a, "orders-to-confirm")?.body ?? ""), "Uno lleva más de un día → atención");
ok(get(a, "orders-to-complete")?.count === 2, "2 confirmados sin completar", a);
ok(get(a, "orders-to-complete")?.href === "/dashboard/pedidos?ver=to_complete", "Lleva a Pedidos → por completar");
ok(get(a, "orders-to-confirm")?.key === "orders-to-confirm-3", "La clave cambia con la cantidad");

console.log("2. Vendedora de Cisneros: solo su punto");
a = await alerts(CIS);
ok(get(a, "orders-to-confirm")?.count === 2, "2 sin confirmar en Cisneros", a);
ok(get(a, "orders-to-complete")?.count === 1 && get(a, "orders-to-complete")?.severity === "info", "1 por completar, reciente → aviso", a);

console.log("3. Sin permiso");
ok((await alerts(NADA)).length === 0, "Sin Pedidos ni POS: nada");
ok((await alerts(FUERA)).length === 0, "De otra tienda: nada");

console.log("4. Al completar desaparece");
await raw("update orders set status = 'completed' where store_id = $1 and status = 'confirmed'", [A]);
a = await alerts(OWNER);
ok(!get(a, "orders-to-complete"), "Sin confirmados pendientes no sale el aviso", a);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
