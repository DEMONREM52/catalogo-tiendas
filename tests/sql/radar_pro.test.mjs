// Pruebas de 20261306 (radar pro: plan, por punto, efecto, metas, tareas, calendario y aviso al celular).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_radarpro_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}

const U = (n) => `ae000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), LAURA = U(2), CIS = U(3), VEND = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const BOD = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const wh = async (n) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, 'point') returning id", [A, n]))[0].id;
const C = await wh("CISNEROS"), Z = await wh("ZAMORA");
await raw(`insert into store_users (store_id, user_id, role, permissions, display_name, point_id) values
  ($1,$2,'seller','{products}','Laura',null), ($1,$3,'seller','{products}','Caro',$5), ($1,$4,'seller','{pos}','Vende',null)`, [A, LAURA, CIS, VEND, C]);
const P1 = (await raw("insert into products (store_id, name, price_1) values ($1, 'Secador', 30000) returning id", [A]))[0].id;
const P2 = (await raw("insert into products (store_id, name, price_1) values ($1, 'Carro', 10000) returning id", [A]))[0].id;
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1,$3,$4,10), ($2,$3,$4,0)", [Z, C, P1, A]);
const sale = async (point, product, qty, ago) => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, created_at) values ($1, md5(random()::text), 1, 'completed', now() - $2::interval) returning id", [A, ago]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, 1)", [id, product, qty]);
  await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, doc_number) values ($1, $2, $3, 'remision', md5(random()::text))", [id, A, point]);
};
await sale(C, P1, 5, "3 days");
await sale(C, P1, 1, "20 days");

for (const f of ["20261305_radar_productos.sql", "20261306_radar_productos_pro.sql"]) {
  const M = fs.readFileSync(path.join(MIG, f), "utf8");
  await db.exec(M); await db.exec(M);
}
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;

console.log("1. Configuración");
let r = await call(OWNER, "product_radar_settings_get($1)", [A]);
ok(r.ok && r.settings.daily_target === 5 && r.settings.push_hour === 9 && r.settings.health_goal === 85, "Por defecto: 5 al día, 9 a. m., meta 85", r);
r = await call(LAURA, "product_radar_settings_save($1, $2, $3, $4)", [A, 8, null, 90]);
ok(r.ok && r.settings.daily_target === 8 && r.settings.push_hour === null, "Se guarda (sin aviso al celular)", r);
ok((await call(OWNER, "product_radar_settings_save($1, $2, $3, $4)", [A, 0, 9, 90])).ok === false, "0 al día: no");
ok((await call(VEND, "product_radar_settings_get($1)", [A])).ok === false, "Sin permiso: no");

console.log("2. Radar por punto");
r = await call(OWNER, "product_radar($1)", [A]);
let s = r.products.find((x) => x.id === P1);
ok(r.ok && Number(s.stock) === 10 && Number(s.sold_30) === 6, "Todos: 10 en Zamora y 6 vendidos en Cisneros", s);
ok(s.by_point.length === 2 && s.by_point[0].id === C && Number(s.by_point[0].sold_30) === 6, "Detalle por punto (para sugerir traslado)", s.by_point);
r = await call(OWNER, "product_radar($1, $2)", [A, Z]);
s = r.products.find((x) => x.id === P1);
ok(Number(s.stock) === 10 && Number(s.sold_30) === 0 && s.last_sale_at === null, "Solo Zamora: tiene 10 y no vende", s);
ok(r.points.length >= 3, "Lista de puntos");
r = await call(CIS, "product_radar($1)", [A]);
s = r.products.find((x) => x.id === P1);
ok(Number(s.stock) === 0 && Number(s.sold_30) === 6 && s.by_point.every((b) => b.id === C), "Caro (Cisneros) solo ve su punto", s);
ok((await call(CIS, "product_radar($1, $2)", [A, Z])).ok === false, "Caro no puede mirar Zamora");

console.log("3. Efecto de publicar");
await call(OWNER, "product_publish_mark($1, $2)", [A, [P1]]);
await raw("update erp_product_publish_log set published_at = now() - interval '10 days' where product_id = $1", [P1]);
r = await call(OWNER, "product_publish_info($1, $2)", [A, P1]);
ok(Number(r.log[0].before_7) === 0 && Number(r.log[0].after_7) === 5 && r.log[0].after_complete === true, "7 días antes: 0 · 7 días después: 5", r.log[0]);

console.log("4. Salud por día");
ok((await call(OWNER, "product_radar_snapshot_save($1, $2, $3, $4)", [A, 70, 2, { no_photo: 2 }])).ok, "Guarda la salud de hoy");
ok((await call(OWNER, "product_radar_snapshot_save($1, $2, $3, $4)", [A, 74, 2, {}])).ok, "Se actualiza el mismo día");
r = await call(LAURA, "product_radar_history($1)", [A]);
ok(r.days.length === 1 && r.days[0].avg === 74, "Historial: un día con 74", r);
ok((await call(OWNER, "product_radar_snapshot_save($1, $2, $3, $4)", [A, 140, 2, {}])).ok === false, "Más de 100: no");

console.log("5. Tareas");
const team = await call(OWNER, "product_team($1)", [A]);
ok(team.length === 3 && !team.some((t) => t.name === "Vende"), "Equipo: dueño, Laura y Caro (no quien no tiene Productos)", team);
ok((await call(OWNER, "product_task_create($1, $2, $3, $4, $5)", [A, VEND, "Fotos", null, [P1]])).ok === false, "No se asigna a quien no tiene Productos");
r = await call(OWNER, "product_task_create($1, $2, $3, $4, $5, $6)", [A, LAURA, "Subir fotos", "las de juguetes", [P1, P2], "no_photo"]);
ok(r.ok && r.count === 2, "Tarea a Laura con 2 productos", r);
const T = r.id;
let al = await call(LAURA, "erp_product_task_alerts($1)", [A]);
ok(al.length === 1 && al[0].title.includes("1 tarea") && al[0].href.includes("ver=tareas"), "Laura la ve en la campana", al);
ok((await call(OWNER, "erp_product_task_alerts($1)", [A])).length === 0, "El dueño no (no es suya)");
ok((await call(CIS, "product_task_set_status($1, $2, $3)", [A, T, "done"])).ok === false, "Otra persona no la termina");
ok((await call(LAURA, "product_task_set_status($1, $2, $3)", [A, T, "cancelled"])).ok === false, "Laura no la anula (la creó el dueño)");
ok((await call(LAURA, "product_task_set_status($1, $2, $3)", [A, T, "done"])).ok, "Laura la termina");
r = await call(OWNER, "product_task_list($1)", [A]);
ok(r.tasks.length === 1 && r.tasks[0].status === "done", "Queda terminada", r.tasks);
ok((await call(LAURA, "erp_product_task_alerts($1)", [A])).length === 0, "Ya no sale en la campana");

console.log("6. Calendario");
await call(LAURA, "product_publish_mark($1, $2)", [A, [P2]]);
await call(OWNER, "product_publish_set_every($1, $2, $3)", [A, [P2], 1]);
r = await call(OWNER, "product_publish_calendar($1)", [A]);
ok(r.ok && r.published.some((d) => d.items.some((i) => i.name === "Carro")), "Lo publicado hoy aparece en su día", r.published);
ok(r.by_user.some((u) => u.name === "Laura" && u.n === 1), "Quién publicó cuánto", r.by_user);
ok(r.due.some((d) => d.items.some((i) => i.name === "Carro")) || new Date().getDate() >= 28, "El Carro (diario) aparece mañana por publicar", r.due);

console.log("7. Aviso al celular");
await raw("update erp_product_publish set last_published_at = now() - interval '3 days' where product_id = $1", [P2]);
await raw("update erp_publish_settings set push_hour = 7 where store_id = $1", [A]);
let dg = await raw("select * from public.erp_publish_push_digest(7)");
ok(dg.length === 3 && dg.every((d) => d.due >= 1) && dg[0].target === 8, "A las 7: a los 3 del equipo con Productos", dg);
ok((await raw("select * from public.erp_publish_push_digest(9)")).length === 0, "A las 9 no (la tienda escogió 7)");
let denied = false;
try { await as(OWNER, "select * from public.erp_publish_push_digest(7)"); } catch { denied = true; }
ok(denied, "Solo el servidor puede pedir el resumen");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
