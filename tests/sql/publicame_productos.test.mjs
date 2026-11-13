// Pruebas de 20261321 («¡Publícame!» de varios productos en una consulta, para la lista de Productos).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_pubstates_${process.pid}.sql`);
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

await db.exec(fs.readFileSync(path.join(MIG, "20261305_radar_productos.sql"), "utf8"));
const M = fs.readFileSync(path.join(MIG, "20261321_publicame_en_productos.sql"), "utf8");
await db.exec(M);
await db.exec(M); // se puede correr dos veces

const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;

console.log("1. Permisos");
ok((await call(VEND, "product_publish_states($1, $2)", [A, [P1, P2]])).ok === false, "Sin permiso de Productos: no");
ok((await call(FUERA, "product_publish_states($1, $2)", [A, [P1]])).ok === false, "De otra tienda: no");

console.log("2. Estados en una sola consulta");
let r = await call(OWNER, "product_publish_states($1, $2)", [A, [P1, P2, P3, PB]]);
ok(r.ok && Object.keys(r.states).length === 3, "Trae los 3 de la tienda (también el oculto) y no el de otra tienda", r);
ok(r.states[P1].times === 0 && r.states[P1].last_published_at === null, "Nunca publicado: sin fecha", r.states[P1]);
await call(OWNER, "product_publish_mark($1, $2)", [A, [P1]]);
r = await call(COSTS, "product_publish_states($1, $2)", [A, [P1, P2]]);
ok(r.ok && r.states[P1].times === 1 && r.states[P1].last_published_at && r.states[P1].due === false, "Publicado hoy: con fecha y no toca", r.states[P1]);
ok(r.states[P2].times === 0, "El otro sigue sin publicar");
ok((await call(OWNER, "product_publish_states($1, $2)", [A, []])).states && Object.keys((await call(OWNER, "product_publish_states($1, $2)", [A, []])).states).length === 0, "Lista vacía: nada");
ok((await call(OWNER, "product_publish_states($1, null)", [A])).ok, "Sin lista: no falla");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
