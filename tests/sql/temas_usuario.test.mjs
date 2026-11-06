// Pruebas de 20261284: temas y apariencia por usuario (aislamiento, validación, versión, referencias).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_temas_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261284_temas_por_usuario.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `b4400000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2);
await raw("insert into auth.users (id, email) values ($1, 'a@x.co'), ($2, 'b@x.co')", [A, B]);

const cfg = (base = "dark", accent = "#3b82f6") => JSON.stringify({ v: 1, base, colors: { accent, accent2: "#2563eb", accent3: "#d946ef", bg: base === "dark" ? "#05070d" : "#ffffff", surface: "#101522", menu: "#0b0f19", dialog: "#141a2a", input: "#121827", text: "#f5f7ff", muted: "#a7b0c8" },
  background: { kind: "gradient", from: "#1e3a8a", to: "#05070d", angle: 160, intensity: 40 }, glass: { level: "elegant", opacity: 80, blur: 18, saturation: 160, border: 12, shadow: 50, sheen: 30 },
  layout: { radius: 16, density: "normal", fontScale: 100, dividers: 12 }, effects: { ambient: 40, halo: true, hover: true } });
const create = (u, name, c = cfg(), owner = null) => as(u, `insert into user_themes (name, base_mode, config${owner ? ", user_id" : ""}) values ($1, 'dark', $2::jsonb${owner ? ", $3" : ""}) returning id, user_id`, owner ? [name, c, owner] : [name, c]);

// Sin límite de cantidad (aquí 12) y cada uno es de quien lo crea.
const mine = [];
for (let i = 0; i < 12; i++) mine.push((await create(A, `Tema ${i}`))[0]);
ok(mine.length === 12 && mine.every((t) => t.user_id === A), "Ana crea 12 temas (sin límite de cantidad) y todos quedan a su nombre");
const spoof = (await create(A, "Truco", cfg(), B))[0];
ok(spoof.user_id === A, "Aunque mande el user_id de otra persona, el tema queda a nombre de quien tiene la sesión", spoof);
const [{ id: bt }] = await create(B, "Verde de Bruno", cfg("dark", "#22c55e"));

ok(Number((await as(B, "select count(*) n from user_themes"))[0].n) === 1, "Bruno solo ve su tema (no los 13 de Ana)");
await as(B, "update user_themes set name = 'hackeado' where id = $1", [mine[0].id]);
ok((await raw("select name from user_themes where id = $1", [mine[0].id]))[0].name === "Tema 0", "Bruno no puede renombrar un tema de Ana");
await as(B, "delete from user_themes where id = $1", [mine[1].id]);
ok(Number((await raw("select count(*) n from user_themes where id = $1", [mine[1].id]))[0].n) === 1, "Bruno no puede borrar un tema de Ana");
await as(A, "update user_themes set user_id = $1 where id = $2", [B, mine[2].id]);
ok((await raw("select user_id from user_themes where id = $1", [mine[2].id]))[0].user_id === A, "Un tema no se puede pasar a otra persona");
ok(typeof (await err(null, "select count(*) from user_themes")) === "string", "Sin sesión no se leen temas");

// Validación en el servidor: nada de CSS libre ni valores fuera de límites.
const bad = async (label, c) => ok(typeof (await err(A, "insert into user_themes (name, base_mode, config) values ('x', 'dark', $1::jsonb)", [c])) === "string", label);
const base = JSON.parse(cfg());
await bad("Color con CSS («red; background:url(…)») se rechaza", JSON.stringify({ ...base, colors: { ...base.colors, accent: "red; background:url(https://x)" } }));
await bad("Propiedad desconocida («css») se rechaza", JSON.stringify({ ...base, css: "body{display:none}" }));
await bad("Desenfoque exagerado (200) se rechaza", JSON.stringify({ ...base, glass: { ...base.glass, blur: 200 } }));
await bad("Número escrito como texto se rechaza", JSON.stringify({ ...base, layout: { ...base.layout, radius: "16px" } }));
await bad("Configuración gigante se rechaza", JSON.stringify({ ...base, colors: { ...base.colors, junk: "x".repeat(7000) } }));
const named = (await as(A, "insert into user_themes (name, base_mode, config) values ('<b>Azul</b>{x}', 'light', $1::jsonb) returning name, base_mode", [cfg("dark")]))[0];
ok(named.name === "bAzul/bx" && named.base_mode === "dark", "El nombre se limpia y el tipo sale de la configuración", named);

// Preferencias: una fila por persona, versión que sube y solo temas propios.
await as(A, "insert into user_appearance (prefs) values ($1::jsonb)", [JSON.stringify({ mode: "custom", themeId: mine[3].id, glass: true, animated: false })]);
let pa = (await as(A, "select user_id, prefs, version from user_appearance"))[0];
ok(pa.user_id === A && pa.prefs.themeId === mine[3].id && pa.version === 1, "Ana guarda su elección (tema propio)", pa);
await as(A, "update user_appearance set prefs = $1::jsonb", [JSON.stringify({ mode: "custom", themeId: bt })]);
pa = (await as(A, "select prefs, version from user_appearance"))[0];
ok(!pa.prefs.themeId && pa.prefs.mode === "system" && pa.version === 2, "Ana no puede elegir el tema de Bruno: se quita y vuelve a «Sistema»", pa);
const stale = await as(A, "update user_appearance set prefs = '{\"mode\":\"dark\"}'::jsonb where version = 1 returning version");
ok(stale.length === 0, "Un dispositivo con la versión vieja no pisa el cambio más nuevo");
ok(typeof (await err(A, "update user_appearance set prefs = '{\"mode\":\"neon\"}'::jsonb")) === "string", "Modo inventado se rechaza");
ok((await as(B, "select count(*) n from user_appearance"))[0].n === "0" || Number((await as(B, "select count(*) n from user_appearance"))[0].n) === 0, "Bruno no ve las preferencias de Ana");
await as(B, "update user_appearance set prefs = '{\"mode\":\"dark\"}'::jsonb");
ok((await raw("select prefs->>'mode' m from user_appearance where user_id = $1", [A]))[0].m === "system", "Bruno no puede cambiar las preferencias de Ana");

// Borrar el tema en uso: vuelve al oficial de su tipo, sin referencias rotas.
await as(A, "update user_appearance set prefs = $1::jsonb", [JSON.stringify({ mode: "custom", themeId: mine[4].id, systemDark: mine[5].id })]);
await as(A, "delete from user_themes where id = $1", [mine[4].id]);
pa = (await as(A, "select prefs from user_appearance"))[0].prefs;
ok(pa.mode === "dark" && !pa.themeId && pa.systemDark === mine[5].id, "Al borrar el tema activo queda Obsidian (oscuro) y lo demás se conserva", pa);
await as(A, "delete from user_themes where id = $1", [mine[5].id]);
pa = (await as(A, "select prefs from user_appearance"))[0].prefs;
ok(!pa.systemDark, "Al borrar el tema de «sistema oscuro» también se quita esa referencia", pa);

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
