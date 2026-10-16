// Pruebas de 20261203: quita índices duplicados exactos, guarda su definición y se puede revertir.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create table public.stores (id uuid primary key, slug text, owner_id uuid, constraint stores_slug_key unique (slug));
create unique index stores_slug_unique_idx on public.stores (slug);
create index idx_stores_owner on public.stores (owner_id);
create index stores_owner_idx on public.stores (owner_id);
create table public.products (id uuid primary key, store_id uuid, sku text, name text, category_id uuid);
create index products_store_sku_idx on public.products (store_id, sku);
create index idx_products_store_sku on public.products (store_id, sku);
create unique index products_store_sku_uq on public.products (store_id, sku) where sku is not null and btrim(sku) <> '';
create index products_store_name on public.products (store_id, name);
create index products_name_lower on public.products (lower(name));
create index products_name_lower2 on public.products (lower(name)) where category_id is not null;
`);
const sql = fs.readFileSync(path.join(MIG, "20261203_indices_duplicados.sql"), "utf8");
await db.exec(sql);
await db.exec(sql); // dos veces: idempotente

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const idx = async () => (await db.query("select indexname from pg_indexes where schemaname = 'public' and tablename in ('stores','products') order by 1")).rows.map((r) => r.indexname);
let names = await idx();
ok(names.includes("stores_slug_key") && !names.includes("stores_slug_unique_idx"), "Se conserva el índice de la regla única; se quita su copia", names);
ok(names.filter((n) => /owner/.test(n)).length === 1, "De dos índices iguales del dueño queda uno", names);
ok(names.filter((n) => /store_sku/.test(n)).length === 2 && names.includes("products_store_sku_uq"), "SKU: queda uno normal y el único con condición (no son iguales)", names);
ok(names.includes("products_name_lower") && names.includes("products_name_lower2") && names.includes("products_store_name"), "Índices distintos (otra condición u otras columnas) no se tocan", names);
const saved = (await db.query("select index_name, definition from public.erp_dropped_indexes order by 1")).rows;
ok(saved.length === 3 && saved.every((r) => /^CREATE /.test(r.definition)), "Cada índice quitado queda guardado con su definición", saved);
const restored = (await db.query("select public.erp_restore_dropped_indexes() n")).rows[0].n;
names = await idx();
ok(restored === 3 && names.includes("stores_slug_unique_idx") && names.includes("idx_products_store_sku"), "Se puede volver atrás y recrearlos", { restored, names });

console.log(`\n${pass} ok · ${fail} fallas`);
await db.close();
process.exitCode = fail ? 1 : 0;
