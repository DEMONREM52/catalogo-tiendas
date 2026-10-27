// Pruebas de 20261251: cumpleaños del equipo (fecha, lo que ve todo el equipo, felicitaciones y avisos).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_cumple_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  ...["20261106_rentabilidad_precios_punto.sql", "20261110_gastos_presupuestos_nomina.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261251_cumpleanos.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
async function service(sql, params) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("set role service_role");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims', '', false)"); }
}

const U = (n) => `cb000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), RRHH = U(2), CAJA = U(3), OUT = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('vitrina', 'LA VITRINA', $1) returning id", [OWNER]);
await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1)", [OUT]);
await raw("insert into store_users (store_id, user_id, role, permissions, username) values ($1, $2, 'seller', '{payroll}', 'rrhh'), ($1, $3, 'seller', '{pos}', 'caja')", [A, RRHH, CAJA]);
await one(RRHH, "select public.erp_finance_setup($1) r", [A]);
const emp = async (name) => (await one(RRHH, "select public.erp_employee_save($1, null, $2::jsonb) r", [A, JSON.stringify({ full_name: name, base_salary: 1500000, pay_frequency: "monthly" })])).id;

// Fechas relativas a «hoy» en Colombia, con año de nacimiento 1995.
const [{ t }] = await raw("select ((now() at time zone 'America/Bogota')::date)::text t");
const shift = (days) => { const d = new Date(`${t}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return `1995-${d.toISOString().slice(5, 10)}`; };
const people = { hoy: [await emp("Gloria Emilse Giraldo"), 0], manana: [await emp("Cristian Hernández"), 1], semana: [await emp("Ana Pérez"), 7], mes: [await emp("Luis Díaz"), 20], paso: [await emp("Marta Ruiz"), -2], lejos: [await emp("Pedro Gómez"), 60] };
const set = (u, id, b, age = false) => one(u, "select public.erp_birthday_set($1, $2, $3::date, $4) r", [A, id, b, age]);

console.log("1. Guardar la fecha");
ok(!(await set(CAJA, people.hoy[0], shift(0))).ok, "Un cajero no cambia la fecha");
for (const [id, d] of Object.values(people)) if (!(await set(RRHH, id, shift(d), id === people.hoy[0])).ok) throw new Error("set");
ok(!(await set(RRHH, people.hoy[0], "2999-01-01")).ok, "No acepta una fecha futura");
ok((await one(RRHH, "select public.erp_birthday_get($1, $2) r", [A, people.hoy[0]])).show_age === true, "Se lee para editarla");
ok((await one(CAJA, "select public.erp_birthday_get($1, $2) r", [A, people.hoy[0]])).ok === false, "   pero no la lee quien no maneja empleados");

console.log("2. Lo que ve todo el equipo");
const r = await one(CAJA, "select public.erp_birthdays($1, 31) r", [A]);
const names = r.items.map((i) => i.first_name.toUpperCase());
ok(r.ok && names[0] === "MARTA" && names[1] === "GLORIA", "El cajero también ve los cumpleaños (y el de hace 2 días sigue unos días)", names);
ok(!names.includes("PEDRO"), "Lo de dentro de 60 días no sale en el mes");
const g = r.items.find((i) => i.first_name.toUpperCase() === "GLORIA");
ok(g.days_left === 0 && g.age === new Date(`${t}T12:00:00Z`).getUTCFullYear() - 1995, "Hoy, con la edad porque se permitió mostrarla", g);
ok(r.items.find((i) => i.first_name.toUpperCase() === "ANA").age === null, "Sin permiso de mostrarla no sale la edad");
ok(!("base_salary" in g) && !("document" in g), "Nunca salario ni documento");
ok((await one(OUT, "select public.erp_birthdays($1, 31) r", [A])).ok === false, "Alguien de otra tienda no los ve");

console.log("3. Felicitaciones");
ok((await one(CAJA, "select public.erp_birthday_wish($1, $2, '🎂', '¡Feliz día, Gloria!') r", [A, people.hoy[0]])).ok, "El equipo deja su felicitación");
await one(CAJA, "select public.erp_birthday_wish($1, $2, '🥳', '¡Que lo pases súper!') r", [A, people.hoy[0]]);
await one(OWNER, "select public.erp_birthday_wish($1, $2, '🎁', 'Gracias por todo') r", [A, people.hoy[0]]);
const w = (await one(CAJA, "select public.erp_birthdays($1, 31) r", [A])).items.find((i) => i.first_name.toUpperCase() === "GLORIA").wishes;
ok(w.length === 2 && w.some((x) => x.mine && x.emoji === "🥳"), "Una por persona (la segunda la cambia) y se ve cuál es la mía", w);
ok(!(await one(CAJA, "select public.erp_birthday_wish($1, $2, '🎉', 'x') r", [A, people.mes[0]])).ok, "A 20 días todavía no se abren");
ok((await one(CAJA, "select public.erp_birthday_wish($1, $2, '🎉', 'Tarde pero seguro') r", [A, people.paso[0]])).ok, "Hasta 3 días después sí");
ok(!(await one(CAJA, "select public.erp_birthday_wish($1, $2, '🎉', '   ') r", [A, people.hoy[0]])).ok, "Vacía no");

console.log("4. Avisos al celular");
const dig = await service("select * from public.erp_birthday_push_digest() where store_id = $1", [A]);
ok(dig.length === 3, "Le llega a cada persona del equipo (dueño, RR. HH. y cajero)", dig.length);
ok(dig[0].today_names[0].startsWith("Gloria") && dig[0].tomorrow_names[0].startsWith("Cristian") && dig[0].week_names[0].startsWith("Ana"), "Hoy, mañana y en 7 días", dig[0]);
ok((await raw("select public.erp__next_birthday('2000-02-29', '2027-03-01') d"))[0].d.toISOString().slice(0, 10) === "2028-02-29"
  && (await raw("select public.erp__next_birthday('2000-02-29', '2027-01-10') d"))[0].d.toISOString().slice(0, 10) === "2027-02-28", "El 29 de febrero se celebra el 28 en años no bisiestos");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
