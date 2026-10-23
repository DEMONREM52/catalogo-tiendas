// Pruebas de 20261237: search_path fijo sin romper funciones que usan el esquema extensions.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
create schema if not exists extensions;
-- Como unaccent de Supabase: vive en extensions y se llama sin esquema.
create or replace function extensions.quita_tildes(t text) returns text language sql immutable as $$ select translate(t, 'áéíóú', 'aeiou') $$;
set search_path = public, extensions;
create or replace function public.norm_text(t text) returns text language sql immutable as $$ select lower(quita_tildes(t)) $$;
create or replace function public.ya_tiene_path() returns int language sql set search_path = public as $$ select 1 $$;
create or replace procedure public.proc_vieja() language plpgsql as $$ begin perform 1; end $$;
create or replace function public.trigger_viejo() returns trigger language plpgsql as $$ begin new.id := new.id; return new; end $$;
create or replace function public.lenta_sql(t text) returns text language sql volatile as $$ select norm_text(t) $$;
`;
const combined = path.join(os.tmpdir(), `remhub_sp_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
await db.exec("set search_path = public, extensions");

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const cfg = async (name) => (await db.query("select array_to_string(proconfig, ',') c from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [name])).rows[0]?.c ?? null;

ok((await db.query("select public.norm_text('Canción') r")).rows[0].r === "cancion", "Antes: la función funciona");
const before = (await db.query("select count(*)::int n from pg_proc p where pronamespace = 'public'::regnamespace and prokind in ('f','p') and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')")).rows[0].n;
const M = fs.readFileSync(path.join(MIG, "20261237_funciones_search_path.sql"), "utf8");
const res = await db.exec(M);
await db.exec(M);
const report = res[res.length - 1].rows;
const fixed = report.find((r) => r.resultado === "ok")?.funciones ?? 0;
const kept = report.find((r) => /se deja igual/.test(r.resultado))?.funciones ?? 0;
ok(fixed + kept === before && !report.some((r) => /no se pudo/.test(r.resultado)), `Revisa todas las que no tenían (${before}) sin errores`, report);
ok(await cfg("norm_text") === null, "norm_text (rápida de búsquedas) se deja igual para no hacer el buscador más lento", await cfg("norm_text"));
ok(/search_path=public, extensions/.test(await cfg("trigger_viejo") ?? ""), "Los triggers quedan con «public, extensions»", await cfg("trigger_viejo"));
ok(/search_path=public, extensions/.test(await cfg("lenta_sql") ?? ""), "Las funciones SQL que no son rápidas también", await cfg("lenta_sql"));
await db.exec("set search_path = pg_catalog");
ok((await db.query("select public.lenta_sql('Canción') r")).rows[0].r === "cancion", "Siguen encontrando lo de extensions aunque cambien el search_path");
await db.exec("set search_path = public, extensions");
ok(await cfg("ya_tiene_path") === "search_path=public", "No toca las que ya tenían su search_path");
ok(/search_path=public, extensions/.test(await cfg("proc_vieja") ?? ""), "También los procedimientos");
const left = (await db.query("select count(*)::int n from pg_proc p join pg_language l on l.oid = p.prolang where pronamespace = 'public'::regnamespace and prokind in ('f','p') and not (l.lanname = 'sql' and provolatile in ('i','s')) and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')")).rows[0].n;
ok(left === 0, "No queda ninguna (fuera de las rápidas) sin search_path", left);

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
