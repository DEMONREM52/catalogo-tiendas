// Pruebas de 20261307 (plantillas de mensajes para publicar).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_tpl_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const U = (n) => `af000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), VEND = U(2), OTRO = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [OTRO]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, VEND]);

const M = fs.readFileSync(path.join(MIG, "20261307_plantillas_publicar.sql"), "utf8");
await db.exec(M); await db.exec(M);
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;

let r = await call(OWNER, "publish_template_save($1, null, $2, $3, true)", [A, "Instagram", "📸 {nombre} {precio}"]);
ok(r.ok, "Crea una plantilla", r);
const T1 = r.id;
r = await call(OWNER, "publish_template_save($1, null, $2, $3, true)", [A, "Oferta", "⚡ {nombre}"]);
const T2 = r.id;
let list = (await call(OWNER, "publish_templates_list($1)", [A])).templates;
ok(list.length === 2 && list.filter((t) => t.is_default).length === 1 && list[0].id === T2, "Solo una queda como la de siempre (la última)", list);
r = await call(OWNER, "publish_template_save($1, $2, $3, $4, false)", [A, T1, "Insta", "Nuevo {nombre}"]);
list = (await call(OWNER, "publish_templates_list($1)", [A])).templates;
ok(list.some((t) => t.name === "Insta" && t.body === "Nuevo {nombre}"), "Se edita");
ok((await call(OWNER, "publish_template_save($1, null, $2, $3)", [A, " ", "x"])).ok === false, "Sin nombre: no");
ok((await call(OWNER, "publish_template_save($1, null, $2, $3)", [A, "Larga", "x".repeat(4001)])).ok === false, "Más de 4.000 letras: no");
ok((await call(VEND, "publish_templates_list($1)", [A])).ok === false, "Sin permiso de Productos: no");
ok((await call(OTRO, "publish_template_save($1, $2, $3, $4)", [A, T1, "x", "y"])).ok === false, "De otra tienda: no la cambia");
ok((await call(OTRO, "publish_template_save($1, $2, $3, $4)", [B, T1, "x", "y"])).ok === false, "Ni desde su tienda con el id ajeno");
ok((await call(OTRO, "publish_templates_list($1)", [B])).templates.length === 0, "Cada tienda ve solo las suyas");
ok((await call(OWNER, "publish_template_delete($1, $2)", [A, T1])).ok, "Se borra");
ok((await call(OWNER, "publish_templates_list($1)", [A])).templates.length === 1, "Queda una");
let denied = false;
try { await as(OWNER, "select * from erp_publish_templates"); } catch { denied = true; }
ok(denied, "La tabla no se lee directo");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
