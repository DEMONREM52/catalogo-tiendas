// Pruebas de 20261351: conteo en grupo (varias personas, cada una lo suyo, se suma; a ciegas; terminar y aplicar).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `alter table public.store_users add column if not exists point_id uuid;`;
const combined = path.join(os.tmpdir(), `remhub_gc_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261351_conteo_en_grupo.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `cfb00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANA = U(2), LUIS = U(3), PEPE = U(4), OTRO = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('gc', 'LA VITRINA', $1) returning id", [OWNER]);
const wh = async (c, n) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $3, true, 'point') returning id", [A, c, n]))[0].id;
const Z = await wh("Z", "Sede Zamora"), V = await wh("V", "La Vitrina");
// Ana y Luis cuentan en Zamora (Ana además ajusta); Pepe solo vende; Otro es de La Vitrina.
await raw(`insert into store_users (store_id, user_id, role, point_id, display_name, active, permissions) values
  ($1, $2, 'seller', $3, 'Ana', true, '{inventory,inventory_adjust}'), ($1, $4, 'seller', $3, 'Luis', true, '{inventory,inventory_counts}'),
  ($1, $5, 'seller', $3, 'Pepe', true, '{pos}'), ($1, $6, 'seller', $7, 'Otro', true, '{inventory,inventory_counts}')`, [A, ANA, Z, LUIS, PEPE, OTRO, V]);
const prod = async (n) => (await raw("insert into products (store_id, name, sku) values ($1, $2, $3) returning id", [A, n, n.slice(0, 4)]))[0].id;
const OLLA = await prod("OLLA"), SARTEN = await prod("SARTEN"), TAZA = await prod("TAZA");
await raw("insert into erp_stock_levels (store_id, warehouse_id, product_id, qty) values ($1, $2, $3, 10), ($1, $2, $4, 5)", [A, Z, OLLA, SARTEN]).catch(async () => {
  await raw("insert into erp_stock_levels (warehouse_id, product_id, qty) values ($1, $2, 10), ($1, $3, 5)", [Z, OLLA, SARTEN]);
});
const J = (x) => JSON.stringify(x);
const stock0 = J(await raw("select * from erp_stock_levels order by product_id"));
const get = async (u, id) => (await as(u, "select public.erp_gc_get($1) r", [id]))[0].r;
const set = (u, id, p, q, add = false, key = null) => as(u, "select public.erp_gc_set($1, $2, $3, $4, $5) r", [id, p, q, add, key]).then((x) => x[0].r);

console.log("Abrir");
ok(/No tienes permiso/.test(await err(PEPE, "select public.erp_gc_start($1, $2)", [A, Z]) ?? ""), "Quien solo vende no abre conteos");
ok(/No tienes permiso/.test(await err(OTRO, "select public.erp_gc_start($1, $2)", [A, Z]) ?? ""), "Otro punto no cuenta en Zamora");
const s1 = (await as(LUIS, "select public.erp_gc_start($1, $2, 'Vitrina y fondo', true) r", [A, Z]))[0].r;
ok(s1.ok && !s1.existing, "Luis abre un conteo en grupo a ciegas en Zamora", s1);
const s2 = (await as(ANA, "select public.erp_gc_start($1, $2) r", [A, Z]))[0].r;
ok(s2.existing && s2.id === s1.id, "Ana entra al mismo conteo (no se duplica)", s2);
const G = s1.id;
ok((await as(OTRO, "select public.erp_gc_list($1) r", [A]))[0].r.length === 0, "Otro punto no lo ve en la lista");
ok((await get(OTRO, G)) === null, "Ni abriéndolo directo");

console.log("Contar entre varios");
await set(LUIS, G, OLLA, 4);
await set(ANA, G, OLLA, 3);
const k = "d0000000-0000-0000-0000-000000000001";
await set(ANA, G, SARTEN, 1, true, k);
const again = await set(ANA, G, SARTEN, 1, true, k);
ok(again.repeated && again.mine === 1, "Un reintento del escáner no suma dos veces", again);
await set(ANA, G, SARTEN, 1, true);
await set(LUIS, G, TAZA, 0);
let v = await get(ANA, G);
const line = (p) => v.lines.find((l) => l.product_id === p);
ok(line(OLLA).total === 7 && line(OLLA).mine === 3 && line(OLLA).by.length === 2, "OLLA: Luis 4 + Ana 3 = 7 (cada uno lo suyo)", line(OLLA));
ok(line(SARTEN).total === 2, "SARTÉN: dos lecturas de Ana = 2");
ok(line(TAZA).total === 0 && line(TAZA).mine === null, "TAZA contada en 0 por Luis (cuenta como contada)", line(TAZA));
ok(line(OLLA).system === null, "A ciegas: no muestra lo que dice el sistema");
ok(v.people.length === 2 && v.can_adjust === true, "Se ve quién está contando; Ana puede terminar", v.people);
ok((await get(LUIS, G)).can_adjust === false, "Luis solo cuenta");
await set(ANA, G, SARTEN, -5, true);
ok((await get(ANA, G)).lines.find((l) => l.product_id === SARTEN).total === 0, "Restar nunca deja negativo");
ok(/negativa/.test(await err(LUIS, "select public.erp_gc_set($1, $2, -1)", [G, OLLA]) ?? ""), "Poner una cantidad negativa: no");
await as(LUIS, "select public.erp_gc_remove($1, $2)", [G, TAZA]);
ok(!(await get(ANA, G)).lines.some((l) => l.product_id === TAZA), "Luis quita su TAZA: deja de estar contada");
ok(J(await raw("select * from erp_stock_levels order by product_id")) === stock0, "Contar no mueve inventario");

console.log("Terminar, reabrir y aplicar");
ok(/Ajustes de inventario/.test(await err(LUIS, "select public.erp_gc_close($1)", [G]) ?? ""), "Luis no termina el conteo");
let c = (await as(ANA, "select public.erp_gc_close($1) r", [G]))[0].r;
const it = (p) => c.items.find((x) => x.product_id === p);
ok(it(OLLA).qty === 7 && it(OLLA).current === 10 && it(SARTEN).qty === 0 && it(SARTEN).current === 5, "Ana termina: trae 7 OLLAS (hay 10) y 0 SARTENES (hay 5) para el ajuste", c.items);
ok(/ya se terminó/.test(await err(LUIS, "select public.erp_gc_set($1, $2, 1)", [G, OLLA]) ?? ""), "Terminado: ya nadie anota");
await as(ANA, "select public.erp_gc_reopen($1)", [G]);
await set(LUIS, G, OLLA, 5);
c = (await as(ANA, "select public.erp_gc_close($1) r", [G]))[0].r;
ok(c.items.find((x) => x.product_id === OLLA).qty === 8, "Reabrir, Luis corrige a 5: ahora son 8");
await as(ANA, "select public.erp_gc_applied($1)", [G]);
ok((await get(ANA, G)).count.status === "applied", "Al aplicar el ajuste queda «aplicado»");
ok(/ya se aplicó/.test(await err(ANA, "select public.erp_gc_reopen($1)", [G]) ?? ""), "Uno aplicado no se reabre");
const s3 = (await as(LUIS, "select public.erp_gc_start($1, $2) r", [A, Z]))[0].r;
ok(!s3.existing && s3.id !== G, "Después se puede abrir otro conteo en Zamora", s3);
ok((await get(LUIS, s3.id)).lines.length === 0, "El nuevo empieza vacío");
await as(ANA, "select public.erp_gc_cancel($1)", [s3.id]);
ok((await get(ANA, s3.id)).count.status === "cancelled", "Anular un conteo");
const notBlind = (await as(ANA, "select public.erp_gc_start($1, $2, 'normal', false) r", [A, Z]))[0].r;
await set(ANA, notBlind.id, OLLA, 2);
ok((await get(ANA, notBlind.id)).lines[0].system === 10, "Sin «a ciegas» sí muestra lo que dice el sistema");
ok(/permission denied|denegado/i.test(await err(ANA, "select * from erp_group_count_lines") ?? ""), "Las tablas no se leen directo");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
