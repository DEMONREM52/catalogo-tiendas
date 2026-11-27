// Pruebas de 20261352: invitados sin cuenta entran al conteo en grupo con el enlace y una contraseña.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_gcp_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), "alter table public.store_users add column if not exists point_id uuid;"].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261351_conteo_en_grupo.sql", "20261352_conteo_con_contrasena.sql", "20261352_conteo_con_contrasena.sql"]) {
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
/** Sin sesión (como un invitado con el enlace). */
async function anon(s, p) {
  await db.query("select set_config('test.uid', '', false)");
  await db.exec("set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); }
}
const errA = async (s, p) => { try { await anon(s, p); return null; } catch (e) { return e.message; } };
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `cfc00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANA = U(2), LUIS = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('gcp', 'LA VITRINA', $1) returning id", [OWNER]);
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'Sede Zamora', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, point_id, display_name, active, permissions) values ($1, $2, 'seller', $3, 'Ana', true, '{inventory,inventory_adjust}'), ($1, $4, 'seller', $3, 'Luis', true, '{inventory,inventory_counts}')", [A, ANA, Z, LUIS]);
const prod = async (n, sku, barcode) => (await raw("insert into products (store_id, name, sku, barcode, price_3, cost_price) values ($1, $2, $3, $4, 50000, 30000) returning id", [A, n, sku, barcode]))[0].id;
const OLLA = await prod("OLLA EXPRESS", "OL-77", "0077123"), TAZA = await prod("TAZA ROSA", "TZ_1", null);
await raw("insert into erp_stock_levels (store_id, warehouse_id, product_id, qty) values ($1, $2, $3, 10)", [A, Z, OLLA]).catch(() => raw("insert into erp_stock_levels (warehouse_id, product_id, qty) values ($1, $2, 10)", [Z, OLLA]));
const G = (await as(LUIS, "select public.erp_gc_start($1, $2, 'Diciembre', false) r", [A, Z]))[0].r.id;

console.log("La contraseña la pone el anfitrión");
ok(/de 4 a 8 números/.test(await err(LUIS, "select public.erp_gc_set_pin($1, '123')", [G]) ?? ""), "Menos de 4 dígitos: no");
ok(/de 4 a 8 números/.test(await err(LUIS, "select public.erp_gc_set_pin($1, '12a4')", [G]) ?? ""), "Letras: no");
ok((await anon("select public.erp_gc_guest_info($1) r", [(await raw("select share_token::text t from erp_group_counts where id = $1", [G]))[0].t]))[0].r.ok === false, "Sin contraseña, el enlace público no abre nada");
const pin = (await as(LUIS, "select public.erp_gc_set_pin($1, '0482') r", [G]))[0].r;
ok(pin.ok && pin.has_pin && pin.share_token, "Luis (quien lo abrió) pone la contraseña 0482", pin);
const TOK = pin.share_token;
ok(TOK !== G, "El enlace público no es el código del conteo");
const stored = (await raw("select pin_hash, pin_salt from erp_group_counts where id = $1", [G]))[0];
ok(stored.pin_hash && !JSON.stringify(stored).includes("0482"), "La contraseña no se guarda en claro");
let view = (await as(ANA, "select public.erp_gc_get($1) r", [G]))[0].r;
ok(view.count.has_pin && view.count.share_token === TOK && view.can_host, "Ana (ajustes) ve que tiene contraseña y el enlace");

console.log("Entrar sin cuenta");
const info = (await anon("select public.erp_gc_guest_info($1) r", [TOK]))[0].r;
ok(info.ok && info.warehouse === "Sede Zamora" && info.store === "LA VITRINA" && info.locked_minutes === 0, "El enlace muestra tienda, bodega y nombre", info);
let j = (await anon("select public.erp_gc_guest_join($1, '1111', 'Pedro') r", [TOK]))[0].r;
ok(!j.ok && /equivocada/.test(j.error) && j.left === 9, "Contraseña equivocada: no entra (quedan 9 intentos)", j);
j = (await anon("select public.erp_gc_guest_join($1, '0482', '') r", [TOK]))[0].r;
ok(!j.ok && /nombre/.test(j.error), "Sin nombre: no", j);
const pedro = (await anon("select public.erp_gc_guest_join($1, '0482', 'Pedro') r", [TOK]))[0].r;
ok(pedro.ok && pedro.guest_id && pedro.secret?.length === 64, "Pedro entra con el enlace y la contraseña, sin cuenta", pedro);
ok(Number((await raw("select pin_failed n from erp_group_counts where id = $1", [G]))[0].n) === 0, "Al acertar, los intentos vuelven a cero");

console.log("El invitado cuenta (y nada más)");
const P = [TOK, pedro.guest_id, pedro.secret];
const found = (await anon("select public.erp_gc_guest_search($1, $2, $3, 'olla') r", P))[0].r;
ok(found.length === 1 && found[0].name === "OLLA EXPRESS", "Busca productos por nombre", found);
ok(!JSON.stringify(found).match(/price|cost|qty|stock/), "La búsqueda no trae precios, costos ni existencias", found);
ok((await anon("select public.erp_gc_guest_search($1, $2, $3, '0077123') r", P))[0].r[0]?.exact === true, "Por código de barras exacto (con ceros)");
ok((await anon("select public.erp_gc_guest_search($1, $2, $3, 'TZ_1') r", P))[0].r.length === 1, "Por referencia (el _ no es comodín)");
await anon("select public.erp_gc_guest_set($1, $2, $3, $4, 3) r", [...P, OLLA]);
await as(LUIS, "select public.erp_gc_set($1, $2, 4)", [G, OLLA]);
const k = "e0000000-0000-0000-0000-000000000001";
await anon("select public.erp_gc_guest_set($1, $2, $3, $4, 1, true, $5) r", [...P, OLLA, k]);
const rep = (await anon("select public.erp_gc_guest_set($1, $2, $3, $4, 1, true, $5) r", [...P, OLLA, k]))[0].r;
ok(rep.repeated && rep.mine === 4, "Escáner: un reintento no suma dos veces", rep);
const gv = (await anon("select public.erp_gc_guest_get($1, $2, $3) r", P))[0].r;
const ol = gv.lines.find((l) => l.product_id === OLLA);
ok(ol.total === 8 && ol.mine === 4 && ol.by.some((b) => b.name === "Pedro (invitado)"), "Se suma con lo de Luis: 4 + 4 = 8, y se ve «Pedro (invitado)»", ol);
ok(ol.system === null, "El invitado no ve lo que dice el sistema (aunque no sea a ciegas)");
ok((await as(ANA, "select public.erp_gc_get($1) r", [G]))[0].r.lines.find((l) => l.product_id === OLLA).system === 10, "Ana (con cuenta) sí lo ve");
ok(/Vuelve a entrar/.test(await errA("select public.erp_gc_guest_get($1, $2, 'secreto-falso')", [TOK, pedro.guest_id]) ?? ""), "Con otro secreto: no");
ok((await errA("select public.erp_gc_close($1)", [G])) !== null, "Sin cuenta no termina el conteo");
ok((await errA("select public.erp_gc_set_pin($1, '9999')", [G])) !== null, "Sin cuenta no cambia la contraseña");
ok((await errA("select * from erp_group_count_lines")) !== null, "Sin cuenta no lee las tablas");

console.log("Cambiar contraseña o enlace saca a los invitados");
await as(ANA, "select public.erp_gc_set_pin($1, '7777')", [G]);
ok(/Vuelve a entrar/.test(await errA("select public.erp_gc_guest_get($1, $2, $3)", P) ?? ""), "Con contraseña nueva, Pedro debe volver a entrar");
ok((await as(ANA, "select public.erp_gc_get($1) r", [G]))[0].r.lines.find((l) => l.product_id === OLLA).total === 8, "Lo que anotó se queda");
const pedro2 = (await anon("select public.erp_gc_guest_join($1, '7777', 'Pedro') r", [TOK]))[0].r;
ok(pedro2.ok, "Vuelve a entrar con la nueva");
const nl = (await as(LUIS, "select public.erp_gc_new_link($1) r", [G]))[0].r;
ok(nl.share_token && nl.share_token !== TOK, "Enlace nuevo");
ok((await anon("select public.erp_gc_guest_info($1) r", [TOK]))[0].r.ok === false, "El enlace viejo ya no sirve");
await as(ANA, "select public.erp_gc_set_pin($1, '')", [G]);
ok((await anon("select public.erp_gc_guest_info($1) r", [nl.share_token]))[0].r.ok === false, "Quitar la contraseña cierra el enlace público");

console.log("Bloqueo por intentos");
const p3 = (await as(ANA, "select public.erp_gc_set_pin($1, '2468') r", [G]))[0].r.share_token;
for (let i = 0; i < 10; i++) await anon("select public.erp_gc_guest_join($1, '0000', 'X')", [p3]);
const locked = (await anon("select public.erp_gc_guest_join($1, '2468', 'Pedro') r", [p3]))[0].r;
ok(!locked.ok && /Demasiados intentos/.test(locked.error), "10 equivocadas: bloqueado 15 min, aunque luego acierte", locked);
ok((await anon("select public.erp_gc_guest_info($1) r", [p3]))[0].r.locked_minutes > 0, "La entrada dice cuánto falta");

console.log("Terminado: el invitado ya no anota");
await raw("update erp_group_counts set pin_locked_until = null where id = $1", [G]);
const p4 = (await anon("select public.erp_gc_guest_join($1, '2468', 'Pedro') r", [p3]))[0].r;
await as(ANA, "select public.erp_gc_close($1)", [G]);
ok(/ya terminó/.test(await errA("select public.erp_gc_guest_set($1, $2, $3, $4, 1)", [p3, p4.guest_id, p4.secret, TAZA]) ?? ""), "Conteo terminado: no se anota");
ok((await anon("select public.erp_gc_guest_get($1, $2, $3) r", [p3, p4.guest_id, p4.secret]))[0].r.count.status === "closed", "Pero puede ver cómo quedó");
const closed = (await as(ANA, "select public.erp_gc_close($1) r", [G]))[0].r;
ok(closed.items.find((x) => x.product_id === OLLA).qty === 8, "Ana pasa al ajuste el total con lo de los invitados (8)");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
