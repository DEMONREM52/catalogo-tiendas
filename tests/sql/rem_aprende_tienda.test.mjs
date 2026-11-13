// Pruebas de 20261322 (REM aprende en la tienda: lo que no entendió, sin nombres, y frases que enseña el dueño).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_rem_${process.pid}.sql`);
fs.writeFileSync(combined, "select 1;");
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
async function fails(uid, s, p) {
  try { await as(uid, s, p); return false; } catch { return true; }
}

const M = fs.readFileSync(path.join(MIG, "20261322_rem_aprende_en_tienda.sql"), "utf8");
await db.exec(M);
await db.exec(M); // se puede correr dos veces

const U = (n) => `ae000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ADMIN = U(2), VEND = U(3), VEND2 = U(4), FUERA = U(5), INACTIVO = U(6);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [FUERA]);
await raw(`insert into store_users (store_id, user_id, role, permissions, active) values
  ($1,$2,'store_admin','{}',true), ($1,$3,'seller','{pos}',true), ($1,$4,'seller','{users}',true), ($1,$5,'seller','{pos}',false)`, [A, ADMIN, VEND, VEND2, INACTIVO]);

const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;

console.log("1. Anotar lo que no entendió");
ok((await call(VEND, "rem_report_miss($1, $2, $3)", [A, "La plata de los muchachos", "/dashboard/pos?x=1"])).saved === true, "Un vendedor anota una frase");
await call(VEND, "rem_report_miss($1, $2, $3)", [A, "la  plata de los MUCHACHOS", "/dashboard"]);
await call(VEND2, "rem_report_miss($1, $2, $3)", [A, "la plata de los muchachos", null]);
ok((await call(VEND, "rem_report_miss($1, $2, $3)", [A, "eh", null])).saved === false, "Una palabra suelta (ruido) no se guarda");
ok((await call(FUERA, "rem_report_miss($1, $2, $3)", [A, "frase de otra tienda", null])).ok === false, "Alguien de otra tienda no puede anotar en esta");
ok((await call(INACTIVO, "rem_report_miss($1, $2, $3)", [A, "usuario inactivo habla", null])).ok === false, "Un usuario inactivo tampoco");
ok((await call(null, "rem_report_miss($1, $2, $3)", [A, "sin sesion nada", null])).ok === false, "Sin sesión: no");
const rows = await raw("select * from rem_misses where store_id = $1", [A]);
ok(rows.length === 2 && rows.find((r) => r.user_id === VEND).times === 2, "Una fila por persona y frase; si se repite, suma", rows);
ok(rows.every((r) => r.path === null || !r.path.includes("?")), "La página se guarda sin parámetros");

console.log("2. Revisar (solo dueño o administrador, sin nombres)");
ok((await call(VEND, "rem_misses_review($1)", [A])).ok === false, "Un vendedor no ve lo del equipo");
ok((await call(VEND2, "rem_misses_review($1)", [A])).ok === false, "Ni con el permiso de usuarios (solo dueño o administrador)");
ok((await call(FUERA, "rem_misses_review($1)", [A])).ok === false, "El dueño de otra tienda tampoco");
let r = await call(OWNER, "rem_misses_review($1)", [A]);
ok(r.ok && r.rows.length === 1 && r.rows[0].times === 3 && r.rows[0].people === 2, "El dueño la ve agrupada: 3 veces, 2 personas", r);
ok(!JSON.stringify(r).includes(VEND) && !JSON.stringify(r).includes(VEND2) && !("user_id" in r.rows[0]), "Sin decir quién la dijo");
ok((await call(ADMIN, "rem_misses_review($1)", [A])).ok, "Un administrador también la ve");

console.log("3. Enseñar a toda la tienda");
ok((await call(VEND, "rem_phrase_teach($1, $2, $3, $4)", [A, "la plata de los muchachos", "/dashboard/gastos?tab=payroll", "Nómina"])).ok === false, "Un vendedor no enseña para todos");
ok((await call(OWNER, "rem_phrase_teach($1, $2, $3, $4)", [A, "la plata", "https://malo.com", "x"])).ok === false, "No se enseña un enlace de afuera");
ok((await call(OWNER, "rem_phrase_teach($1, $2, $3, $4)", [A, "la plata", "/dashboard//evil.com", "x"])).ok === false, "Ni un enlace raro");
ok((await call(OWNER, "rem_phrase_teach($1, $2, $3, $4)", [A, "plata", "/dashboard/gastos", "Gastos"])).ok === false, "Una sola palabra no");
r = await call(OWNER, "rem_phrase_teach($1, $2, $3, $4)", [A, "La plata de los muchachos", "/dashboard/gastos?tab=payroll", "Nómina"]);
ok(r.ok && r.key === "la plata de los muchachos", "El dueño la enseña", r);
ok((await call(OWNER, "rem_misses_review($1)", [A])).rows.length === 0, "Enseñada: sale de lo no entendido");
r = await call(VEND, "rem_store_phrases($1)", [A]);
ok(r.ok && r.rows.length === 1 && r.rows[0].href === "/dashboard/gastos?tab=payroll", "Todos en la tienda la reciben", r);
ok((await call(FUERA, "rem_store_phrases($1)", [A])).ok === false, "Otra tienda no ve las frases de esta");
ok((await call(FUERA, "rem_store_phrases($1)", [B])).rows.length === 0, "Cada tienda las suyas");
await call(ADMIN, "rem_phrase_teach($1, $2, $3, $4)", [A, "la plata de los muchachos", "/dashboard/gastos?tab=loans", "Vales"]);
ok((await call(VEND, "rem_store_phrases($1)", [A])).rows[0].label === "Vales", "El administrador la corrige");

console.log("4. Olvidar y descartar");
ok((await call(VEND, "rem_phrase_forget($1, $2)", [A, "la plata de los muchachos"])).ok === false, "Un vendedor no la borra");
await call(OWNER, "rem_phrase_forget($1, $2)", [A, "LA PLATA DE LOS MUCHACHOS"]);
ok((await call(VEND, "rem_store_phrases($1)", [A])).rows.length === 0, "El dueño la olvida");
await call(VEND, "rem_report_miss($1, $2, $3)", [A, "algo que era ruido", null]);
ok((await call(VEND, "rem_miss_dismiss($1, $2)", [A, "algo que era ruido"])).ok === false, "Un vendedor no descarta");
await call(OWNER, "rem_miss_dismiss($1, $2)", [A, "algo que era ruido"]);
ok((await call(OWNER, "rem_misses_review($1)", [A])).rows.length === 0, "El dueño la descarta");

console.log("5. Límites y limpieza");
await raw("insert into rem_misses (store_id, user_id, phrase, last_at) values ($1, $2, 'frase vieja de antes', now() - interval '100 days')", [A, VEND]);
await call(VEND, "rem_report_miss($1, $2, $3)", [A, "otra frase nueva", null]);
ok((await raw("select count(*)::int n from rem_misses where phrase = 'frase vieja de antes'"))[0].n === 0, "Lo de más de 90 días se borra solo");
ok(await fails(VEND, "select * from rem_misses"), "Nadie lee la tabla directo");
ok(await fails(VEND, "insert into rem_store_phrases (store_id, phrase_key, href, label) values ($1, 'hola que tal', '/dashboard', 'x')", [A]), "Ni escribe directo");
ok(await fails(VEND, "select public.rem__can_teach($1)", [A]), "Las funciones internas no se llaman desde afuera");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
