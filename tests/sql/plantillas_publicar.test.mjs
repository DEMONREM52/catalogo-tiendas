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

var r = await call(OWNER, "publish_template_save($1, null, $2, $3, true)", [A, "Instagram", "📸 {nombre} {precio}"]);
ok(r.ok, "Crea una plantilla", r);
const T1 = r.id;
r = await call(OWNER, "publish_template_save($1, null, $2, $3, true)", [A, "Oferta", "⚡ {nombre}"]);
const T2 = r.id;
var list = (await call(OWNER, "publish_templates_list($1)", [A])).templates;
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

console.log("— 20261308: catálogo por plantilla y lo más vendido");
const M2 = fs.readFileSync(path.join(MIG, "20261308_catalogo_vender_mas.sql"), "utf8");
await db.exec(M2); await db.exec(M2);
r = await call(OWNER, "publish_template_save($1, null, $2, $3, false, $4)", [A, "Para Zamora", "{nombre}", " Zamora-Centro "]);
ok(r.ok, "Guarda con catálogo", r);
list = (await call(OWNER, "publish_templates_list($1)", [A])).templates;
ok(list.some((t) => t.name === "Para Zamora" && t.catalog_slug === "zamora-centro"), "El catálogo queda guardado (en minúsculas)", list);
ok((await call(OWNER, "publish_template_save($1, null, $2, $3, false, $4)", [A, "Mala", "x", "../hack"])).ok === false, "Catálogo raro: no");
const P = async (name, stock = 5) => (await raw("insert into products (store_id, name, stock, active) values ($1, $2, $3, true) returning id", [A, name, stock]))[0].id;
const X1 = await P("Top"), X2 = await P("Segundo"), X3 = await P("Agotado", 0), X4 = await P("Viejo");
const sale = async (pid, qty, ago = "2 days", status = "completed") => {
  const [{ id }] = await raw("insert into orders (store_id, token, total, status, created_at) values ($1, md5(random()::text), 1, $2, now() - $3::interval) returning id", [A, status, ago]);
  await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, $3, 1)", [id, pid, qty]);
};
await sale(X1, 9); await sale(X2, 3); await sale(X3, 50); await sale(X4, 99, "90 days"); await sale(X2, 40, "1 day", "draft");
await raw("update stores set slug = 'tienda-a' where id = $1", [A]);
const pub = async () => { await db.exec("set role anon"); try { return (await db.query("select public.store_public_best_sellers('Tienda-A', 10) r")).rows[0].r; } finally { await db.exec("reset role"); } };
let best = await pub();
ok(JSON.stringify(best.ids) === JSON.stringify([X1, X2]) && best.badges === true, "Visitante: el orden de los más vendidos (sin agotados, viejos ni borradores)", best);
ok(best.ids.every((x) => typeof x === "string") && !("q" in best), "Solo ids, sin cantidades");
// Erp_can_any no está en la base de prueba: se crea igual que en producción (dueño o permiso).
await db.exec(`create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.permissions && p_perms)) $$;`);
let cfg = await call(OWNER, "best_sellers_config_get($1)", [A]);
ok(cfg.ok && cfg.config.mode === "auto" && cfg.config.days === 60, "Configuración por defecto: automático, 60 días", cfg);
cfg = await call(OWNER, "best_sellers_config_save($1, $2, $3, $4, $5, $6)", [A, "auto", "🔥 Los favoritos", [X4, X4, X3], 120, false]);
ok(cfg.ok && cfg.config.product_ids.length === 2 && cfg.config.title === "🔥 Los favoritos", "Fija productos (sin repetir)", cfg);
best = await pub();
ok(JSON.stringify(best.ids) === JSON.stringify([X4, X1, X2]) && best.title === "🔥 Los favoritos" && best.badges === false, "Fijado primero (el agotado no sale), luego por ventas", best);
await call(OWNER, "best_sellers_config_save($1, $2, $3, $4, $5, $6)", [A, "manual", null, [X2, X1], 60, true]);
best = await pub();
ok(JSON.stringify(best.ids) === JSON.stringify([X2, X1]), "A mano: solo los escogidos, en ese orden", best);
await call(OWNER, "best_sellers_config_save($1, $2, $3, $4, $5, $6)", [A, "off", null, [], 60, true]);
ok((await pub()).ids.length === 0, "Apagado: no sale");
ok((await call(VEND, "best_sellers_config_save($1, $2, $3, $4, $5, $6)", [A, "off", null, [], 60, true])).ok === false, "Sin permiso: no lo cambia");
ok((await call(OWNER, "best_sellers_config_save($1, $2, $3, $4, $5, $6)", [A, "raro", null, [], 60, true])).ok === false, "Modo raro: no");

console.log("— 20261311: lo más vendido por catálogo");
await raw("alter table store_catalogs add column if not exists slug text");
const M3 = fs.readFileSync(path.join(MIG, "20261311_mas_vendido_por_catalogo.sql"), "utf8");
await db.exec(M3); await db.exec(M3);
cfg = await call(OWNER, "best_sellers_config_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [A, "auto", "Top", [], 60, true, ["Zamora", "mayor", "../x"], 3, "Lo que más sale", "🏆"]);
ok(cfg.ok && JSON.stringify(cfg.config.catalog_slugs.sort()) === JSON.stringify(["mayor", "zamora"]) && cfg.config.max_items === 3 && cfg.config.icon === "🏆", "Guarda catálogos, cantidad, subtítulo y emoji", cfg);
const pubCat = async (cat) => { await db.exec("set role anon"); try { return (await db.query("select public.store_public_best_sellers('tienda-a', 12, $1) r", [cat])).rows[0].r; } finally { await db.exec("reset role"); } };
best = await pubCat("zamora");
ok(best.ids.length === 2 && best.subtitle === "Lo que más sale" && best.icon === "🏆", "En Zamora sale (máx. 3)", best);
ok((await pubCat("detal")).ids.length === 0, "En el catálogo al detal no sale (no está escogido)");
ok((await call(OWNER, "best_sellers_config_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [A, "auto", null, [], 60, true, [], 50, null, null])).ok === false, "Más de 30 productos: no");
await call(OWNER, "best_sellers_config_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [A, "auto", null, [], 60, true, [], 12, null, null]);
ok((await pubCat("detal")).ids.length === 2, "Sin catálogos escogidos: sale en todos");
// Independiente por catálogo
cfg = await call(OWNER, "best_sellers_catalog_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [A, "Mayor", "manual", "Lo top mayorista", [X2], 60, false, 6, null, "💎"]);
ok(cfg.ok && cfg.catalogs.mayor?.mode === "manual", "El catálogo mayor tiene la suya", cfg.catalogs);
best = await pubCat("mayor");
ok(JSON.stringify(best.ids) === JSON.stringify([X2]) && best.title === "Lo top mayorista" && best.own === true && best.badges === false, "Mayor: solo su escogido, con su título", best);
ok((await pubCat("detal")).ids.length === 2, "Detal sigue con la general");
await call(OWNER, "best_sellers_catalog_save($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [A, "detal", "off", null, [], 60, true, 12, null, null]);
ok((await pubCat("detal")).ids.length === 0, "Detal apagado solo en ese catálogo");
ok((await pubCat("zamora")).ids.length === 2, "Los demás siguen igual");
cfg = await call(OWNER, "best_sellers_catalog_reset($1, $2)", [A, "detal"]);
ok(!cfg.catalogs.detal && (await pubCat("detal")).ids.length === 2, "Volver a la general");
// Catálogo con punto: cuenta las ventas de ese punto
const [{ id: PT }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'ZAM', 'Zamora', true, 'point') returning id", [A]);
await raw("insert into store_catalogs (store_id, name, slug, point_id) values ($1, 'Zamora', 'zamora', $2)", [A, PT]);
const [{ id: OZ }] = await raw("insert into orders (store_id, token, total, status) values ($1, md5(random()::text), 1, 'completed') returning id", [A]);
await raw("insert into order_items (order_id, product_id, quantity, price) values ($1, $2, 1, 1)", [OZ, X2]);
await raw("insert into erp_order_meta (order_id, store_id, point_id, doc_kind, doc_number) values ($1, $2, $3, 'remision', 'Z-1')", [OZ, A, PT]);
best = await pubCat("zamora");
ok(JSON.stringify(best.ids) === JSON.stringify([X2]), "Zamora (con punto): solo lo vendido en Zamora", best);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
