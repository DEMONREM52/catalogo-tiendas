// Pruebas de 20261274: quita solo los índices de búsqueda sin uso de products, guarda su definición y se pueden recrear.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const rows = async (s) => (await db.query(s)).rows;
const exists = async (n) => (await rows(`select to_regclass('public.${n}') is not null as e`))[0].e;

await db.exec(`
  create role anon; create role authenticated;
  create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, description text, sku text, barcode text);
  create index products_desc_trgm_idx on public.products (lower(description));
  create index products_name_trgm on public.products (lower(name));
  create index products_name_trgm_idx on public.products (lower(name));
  create unique index products_sku_trgm_idx on public.products (store_id, sku);   -- único: no se toca aunque esté en la lista
  create index products_store_name on public.products (store_id, name);         -- no está en la lista: no se toca
`);
const migration = fs.readFileSync(path.join(here, "migraciones", "20261274_indices_sin_uso.sql"), "utf8");
await db.exec(migration);
await db.exec(migration);

ok(!(await exists("products_desc_trgm_idx")) && !(await exists("products_name_trgm")) && !(await exists("products_name_trgm_idx")), "Quita los índices de texto sin uso");
ok(await exists("products_sku_trgm_idx"), "Un índice único de la lista se conserva");
ok(await exists("products_store_name"), "Los índices que sí se usan no se tocan");
const saved = await rows("select index_name from erp_dropped_indexes order by 1");
ok(saved.length === 3 && saved.every((r) => r.index_name !== "products_sku_trgm_idx"), "Guarda la definición de los 3 quitados", saved);
const n = (await rows("select public.erp_restore_dropped_indexes() n"))[0].n;
ok(n === 3 && (await exists("products_desc_trgm_idx")), "Volver atrás los recrea", n);

console.log(`\n${pass} pasaron, ${fail} fallaron`);
// Sin process.exit: en Windows, salir de golpe con PGlite abierto revienta libuv.
process.exitCode = fail ? 1 : 0;
