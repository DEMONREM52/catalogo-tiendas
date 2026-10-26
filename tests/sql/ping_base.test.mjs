// Pruebas de 20261242: remhub_ping responde con y sin sesión, no lee datos y se puede correr dos veces.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(path.join(here, "migraciones/20261242_ping_base.sql"), { twice: true });

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
async function as(role, s) {
  await db.exec(`set role ${role}`);
  try { return { rows: (await db.query(s)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role"); }
}

const anon = await as("anon", "select public.remhub_ping() r");
ok(anon.rows?.[0].r?.ok === true, "Sin sesión responde (se usa antes de entrar)", anon);
const auth = await as("authenticated", "select public.remhub_ping() r");
ok(auth.rows?.[0].r?.ok === true && Boolean(auth.rows?.[0].r?.at), "Con sesión responde con la hora", auth);
const def = (await db.query("select prosecdef, provolatile from pg_proc where proname = 'remhub_ping'")).rows[0];
ok(def && def.prosecdef === false && def.provolatile === "s", "No usa permisos de dueño y no escribe nada", def);

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
