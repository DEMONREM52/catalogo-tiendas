// Pruebas de 20261331: «Los que llevan esto también llevan…» en el POS.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
alter table public.orders add column if not exists confirmed_at timestamptz;
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.permissions && p_perms)) $$;
`;
const combined = path.join(os.tmpdir(), `remhub_tambien_${process.pid}.sql`);
fs.writeFileSync(combined, [extra, fs.readFileSync(path.join(here, "migraciones/20261331_tambien_llevan.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined);
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const U = (n) => `ce500000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), OTHER = U(3);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: S2 }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [U(9)]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}'), ($1, $3, 'seller', '{inventory}')", [S, SELLER, OTHER]);
const prod = async (store, n, active = true) => (await raw("insert into products (store_id, name, active) values ($1, $2, $3) returning id", [store, n, active]))[0].id;
const CEL = await prod(S, "CELULAR"), FUNDA = await prod(S, "FUNDA"), VIDRIO = await prod(S, "VIDRIO"), CARGADOR = await prod(S, "CARGADOR"), VIEJO = await prod(S, "VIEJO", false), RARO = await prod(S, "RARO");
let n = 0;
const sale = async (items, { status = "confirmed", days = 1, store = S } = {}) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, confirmed_at) values ($1, $2, 1, $3, now() - make_interval(days => $4)) returning id", [store, `t${++n}`, status, days]);
  for (const p of items) await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1)", [id, p]);
};
for (let i = 0; i < 5; i++) await sale([CEL, FUNDA]);
for (let i = 0; i < 3; i++) await sale([CEL, VIDRIO, VIEJO]);
await sale([CEL, RARO]);                       // solo una vez: no cuenta
await sale([CEL, CARGADOR], { status: "cancelled" });
await sale([CEL, CARGADOR], { status: "cancelled" });
await sale([CEL, CARGADOR], { days: 200 });    // muy vieja
await sale([CEL, CARGADOR], { days: 200 });
const call = async (u, ids, limit = 6) => (await as(u, "select public.erp_pos_also_bought($1, $2::uuid[], $3) r", [S, ids, limit]))[0].r;

let r = await call(SELLER, [CEL]);
ok(r.ok && r.items.length === 2 && r.items[0].product_id === FUNDA && r.items[0].times === 5 && r.items[1].product_id === VIDRIO, "Con un CELULAR: primero FUNDA (5 veces), luego VIDRIO (3)", r);
ok(Number(r.orders) === 9, "Cuenta de cuántas ventas sale (9 con celular, sin anuladas ni viejas)", r.orders);
ok(!r.items.some((x) => x.product_id === VIEJO), "No sugiere productos inactivos");
ok(!r.items.some((x) => x.product_id === RARO), "Lo vendido junto una sola vez no cuenta");
ok(!r.items.some((x) => x.product_id === CARGADOR), "Ni lo de ventas anuladas o de hace más de 120 días");
r = await call(SELLER, [CEL, FUNDA]);
ok(!r.items.some((x) => x.product_id === FUNDA) && r.items[0]?.product_id === VIDRIO, "Lo que ya está en el carrito no se sugiere", r.items);
r = await call(SELLER, [CEL], 1);
ok(r.items.length === 1, "Respeta el límite");
ok((await call(SELLER, [])).items.length === 0, "Carrito vacío: nada");
ok((await call(OTHER, [CEL])).ok === false, "Sin permiso del POS: no");
await sale([CEL, FUNDA], { store: S2 });
ok((await as(U(9), "select public.erp_pos_also_bought($1, $2::uuid[]) r", [S, [CEL]]))[0].r.ok === false, "El dueño de otra tienda no consulta esta");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
