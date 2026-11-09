// Pruebas de 20261305 (radar de productos y «¡Publícame!»).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_radar_${process.pid}.sql`);
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

const U = (n) => `ad000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), VEND = U(2), COSTS = U(3), FUERA = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [FUERA]);
await raw(`insert into store_users (store_id, user_id, role, permissions, display_name) values
  ($1,$2,'seller','{pos}','Vendedora'), ($1,$3,'seller','{products,costs_view}','Laura')`, [A, VEND, COSTS]);
const prod = async (name, extra = {}) => (await raw(
  `insert into products (store_id, name, image_url, price_1, cost_price, active, description, product_details)
   values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
  [extra.store ?? A, name, extra.image ?? null, extra.price ?? 0, extra.cost ?? 0, extra.active ?? true, extra.desc ?? null, JSON.stringify(extra.details ?? {})]))[0].id;
const P1 = await prod("Excavadora", { image: "x.png", price: 63000, cost: 40000, desc: "<p>Linda</p>", details: { gallery_urls: ["a", "b"], highlights: ["2.4 GHz"], long_description: "<p>Larga</p>" } });
const P2 = await prod("Muñeca", { price: 20000, cost: 25000 });
const P3 = await prod("Oculto", { active: false });
const PB = await prod("De otra tienda", { store: B });
// Una venta de P1 hace 3 días.
const [{ id: O }] = await raw("insert into orders (store_id, token, total, status, created_at) values ($1, 't1', 126000, 'completed', now() - interval '3 days') returning id", [A]);
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 2, 63000)", [O, P1]);

const M = fs.readFileSync(path.join(MIG, "20261305_radar_productos.sql"), "utf8");
await db.exec(M);
await db.exec(M); // se puede correr dos veces

const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;

console.log("1. Permisos");
ok((await call(VEND, "product_radar($1)", [A])).ok === false, "Sin permiso de Productos no ve el radar");
ok((await call(VEND, "product_publish_mark($1, $2)", [A, [P1]])).ok === false, "Sin permiso no marca publicado");
ok((await call(FUERA, "product_publish_mark($1, $2)", [A, [P1]])).ok === false, "De otra tienda: no");
ok((await call(OWNER, "product_publish_mark($1, $2)", [A, [PB]])).ok === false, "No marca productos de otra tienda");
ok((await call(VEND, "erp_publish_alerts($1)", [A])).length === 0, "Sin permiso: sin aviso en la campana");
let denied = false;
try { await as(OWNER, "select * from erp_product_publish_log"); } catch { denied = true; }
ok(denied, "Las tablas no se leen directo (solo por las funciones)");

console.log("2. Marcar publicado");
let r = await call(OWNER, "product_publish_mark($1, $2, $3)", [A, [P1], ["instagram", " ", "instagram", "whatsapp"]]);
ok(r.ok && r.count === 1 && r.state.times === 1 && r.state.days_since === 0, "Marca y queda «hoy»", r);
ok(r.state.every === 30 && r.state.due === false, "Por defecto recuerda en 30 días y hoy no toca", r.state);
let info = await call(OWNER, "product_publish_info($1, $2)", [A, P1]);
ok(info.log.length === 1 && info.log[0].by === "Dueño" && info.log[0].channels.length === 2, "Historial con quién y redes (sin repetir ni vacías)", info.log);
ok((await call(OWNER, "erp_publish_alerts($1)", [A])).length === 0, "Recién publicado: no hay aviso");

console.log("3. Recordatorio y aviso");
// Hace 31 días que se publicó la Excavadora.
await raw("update erp_product_publish set last_published_at = now() - interval '31 days' where product_id = $1", [P1]);
let al = await call(COSTS, "erp_publish_alerts($1)", [A]);
ok(al.length === 1 && al[0].count === 1 && al[0].title.includes("1 producto por publicar") && al[0].body.includes("Excavadora"), "A los 31 días (cada 30) sale el aviso", al);
ok(al[0].href === "/dashboard/products/radar?ver=publicar", "El aviso abre el radar en «Publicar»");
r = await call(OWNER, "product_publish_set_every($1, $2, $3)", [A, [P1], 0]);
ok(r.ok && r.state.next_due === null && r.state.due === false, "Con «No recordar» deja de tocar", r.state);
ok((await call(OWNER, "erp_publish_alerts($1)", [A])).length === 0, "…y no hay aviso");
r = await call(OWNER, "product_publish_set_every($1, $2, $3)", [A, [P2], 1]);
ok(r.ok && r.state.due === true, "Diario y nunca publicado: toca hoy", r.state);
r = await call(OWNER, "product_publish_set_every($1, $2, $3)", [A, [P3], 1]);
al = await call(OWNER, "erp_publish_alerts($1)", [A]);
ok(al.length === 1 && al[0].count === 1 && al[0].body.includes("Muñeca"), "Los inactivos no cuentan en el aviso", al);
ok((await call(OWNER, "product_publish_set_every($1, $2, $3)", [A, [P1], 400])).ok === false, "Más de 365 días: no");
r = await call(OWNER, "product_publish_mark($1, $2)", [A, [P2]]);
ok(r.state.due === false && r.state.next_due !== null, "Diario: al publicarlo hoy, vuelve a tocar mañana", r.state);

console.log("4. Deshacer");
r = await call(OWNER, "product_publish_undo($1, $2)", [A, P2]);
ok(r.ok && r.state.times === 0 && r.state.last_published_at === null && r.state.due === true, "Deshace la última y vuelve a tocar", r);
ok((await call(OWNER, "product_publish_undo($1, $2)", [A, P2])).ok === false, "Sin marcas: nada que deshacer");
await raw("update erp_product_publish_log set published_at = now() - interval '2 days' where product_id = $1", [P1]);
ok((await call(OWNER, "product_publish_undo($1, $2)", [A, P1])).ok === false, "Una marca de hace 2 días no se deshace");

console.log("5. Radar");
r = await call(OWNER, "product_radar($1)", [A]);
ok(r.ok && r.products.length === 3, "Solo los productos de la tienda", r.products?.length);
const e = r.products.find((x) => x.id === P1);
ok(e.desc === true && e.long === true && e.gallery === 2 && e.highlights === 1 && e.video === false, "Resumen de la ficha", e);
ok(Number(e.sold_30) === 2 && e.last_sale_at, "Ventas de 30 días y última venta", e);
ok(e.pub.times === 1 && e.pub.every === 0 && e.pub.next_due === null, "Publicación en el radar", e.pub);
ok(r.can_costs === true && Number(e.cost) === 40000, "El dueño ve el costo");
const m = r.products.find((x) => x.id === P2);
ok(m.desc === false && m.gallery === 0 && m.pub.every === 1, "La muñeca: sin descripción ni fotos, diario", m);
r = await call(COSTS, "product_radar($1)", [A]);
ok(r.ok && r.can_costs === true, "Con «Ver costos» también");
await raw("update store_users set permissions = '{products}' where user_id = $1", [COSTS]);
r = await call(COSTS, "product_radar($1)", [A]);
ok(r.ok && r.can_costs === false && r.products.every((x) => x.cost === null), "Sin «Ver costos» no llega el costo", r.products?.[0]);

console.log("6. Varios a la vez");
r = await call(OWNER, "product_publish_mark($1, $2)", [A, [P1, P2, PB]]);
ok(r.ok && r.count === 2, "Marca los de la tienda e ignora los de otra", r);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
