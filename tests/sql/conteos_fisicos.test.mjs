// Pruebas de 20261320 (permiso «Conteos físicos» aparte de «Inventario»).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
alter table public.store_catalogs add column if not exists slug text;
alter table public.orders add column if not exists confirmed_at timestamptz;
create table if not exists public.erp_role_templates (id uuid primary key default gen_random_uuid(), store_id uuid, name text, permissions text[] not null default '{}');
create or replace function public.erp__known_permissions() returns text[] language sql immutable as $f$ select array['inventory','inventory_adjust','perm_v2']::text[] $f$;
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_perms) x where public.erp_can(p_store, x)) $$;
`;
const combined = path.join(os.tmpdir(), `remhub_cnt_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
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
const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;
const callErr = async (u, fn, args) => { try { await call(u, fn, args); return null; } catch (e) { return e.message; } };

const U = (n) => `c4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANA = U(2), LUIS = U(3), JEFE = U(4), VENDE = U(5);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('t', 'Tienda', $1) returning id", [OWNER]);
await raw(`insert into store_users (store_id, user_id, role, permissions) values
  ($1,$2,'seller','{inventory,perm_v2}'), ($1,$3,'seller','{inventory,perm_v2}'), ($1,$4,'seller','{inventory,inventory_adjust,perm_v2}'), ($1,$5,'seller','{pos,perm_v2}')`,
  [A, ANA, LUIS, JEFE, VENDE]);
await raw("insert into erp_role_templates (store_id, name, permissions) values ($1, 'Bodega', '{inventory,transfers}'), ($1, 'Vendedor', '{pos}')", [A]);
for (const m of ["20261223_clientes_frecuentes.sql", "20261312_vender_mas_opcional.sql", "20261313_clientes_y_operacion_opcional.sql"]) {
  await db.exec(fs.readFileSync(path.join(MIG, m), "utf8"));
}
const [{ id: W }] = await raw("insert into erp_warehouses (store_id, code, name, kind) values ($1, 'Z', 'Zamora', 'point') returning id", [A]);
const [{ id: P }] = await raw("insert into products (store_id, name, price_3, stock, active, cost_price) values ($1, 'Patineta', 10000, 0, true, 4000) returning id", [A]);
await raw("insert into erp_stock_levels (warehouse_id, product_id, store_id, qty) values ($1, $2, $3, 5)", [W, P, A]);
await call(OWNER, "store_feature_save($1, 'conteo_zonas', true, null)", [A]);

const sql = fs.readFileSync(path.join(MIG, "20261320_conteos_fisicos.sql"), "utf8");
await db.exec(sql); await db.exec(sql);

console.log("1. Nadie pierde nada");
const perms = async (u) => (await raw("select permissions p from store_users where user_id = $1", [u]))[0].p;
const pa = await perms(ANA);
ok(pa.includes("inventory_counts") && pa.includes("perm_cnt"), "quien tenía «Inventario» recibe «Conteos físicos» y la marca", pa);
const pv = await perms(VENDE);
ok(!pv.includes("inventory_counts") && pv.includes("perm_cnt"), "quien no tenía «Inventario» solo recibe la marca", pv);
const tpl = await raw("select name, permissions p from erp_role_templates where store_id = $1 order by name", [A]);
ok(tpl[0].p.includes("inventory_counts") && !tpl[1].p.includes("inventory_counts"), "las plantillas con «Inventario» también", tpl);
ok((await raw("select public.erp__known_permissions() k"))[0].k.includes("inventory_counts"), "la base reconoce el permiso nuevo");
const r1 = await call(ANA, "count_start($1, $2, 'Vitrina', null)", [A, W]);
ok(r1.ok, "Ana sigue contando", r1);
const C = r1.id;
ok((await call(ANA, "count_save_lines($1, $2::jsonb)", [C, JSON.stringify([{ product_id: P, counted: 4 }])])).ok, "y guarda líneas");

// Se le quita a Luis (lo que haría la pantalla de usuarios) y se corre otra vez.
await raw("update store_users set permissions = '{inventory,perm_v2,perm_cnt}' where user_id = $1", [LUIS]);
await db.exec(sql);
ok((await perms(LUIS)).join() === "inventory,perm_v2,perm_cnt", "correr otra vez no le devuelve lo quitado");

console.log("2. El permiso se exige");
const s = await call(LUIS, "count_start($1, $2, 'Fondo', null)", [A, W]);
ok(s.ok === false && /Conteos físicos/.test(s.message), "sin «Conteos físicos» no empieza un conteo", s);
ok((await call(LUIS, "count_list($1, null)", [A])).ok === false, "ni ve la lista");
ok(/Conteos físicos/.test(await callErr(LUIS, "count_get($1)", [C]) ?? ""), "ni abre un conteo");
ok(/Conteos físicos/.test(await callErr(LUIS, "count_save_lines($1, '[]'::jsonb)", [C]) ?? ""), "ni guarda líneas");
ok(/Conteos físicos/.test(await callErr(LUIS, "count_submit($1)", [C]) ?? ""), "ni envía");
ok((await call(VENDE, "count_start($1, $2, 'Fondo', null)", [A, W])).ok === false, "sin «Inventario» tampoco");
await raw("update store_users set permissions = '{inventory,inventory_adjust,perm_v2,perm_cnt}' where user_id = $1", [JEFE]);
ok((await call(JEFE, "count_list($1, null)", [A])).items.length === 1, "quien aprueba (Ajustes) ve los conteos aunque no tenga «Conteos físicos»");
ok((await call(ANA, "count_submit($1)", [C])).ok, "Ana envía su conteo");
const d = await call(JEFE, "count_decide($1, true, null)", [C]);
ok(d.ok && d.adjusted === 1, "y el jefe lo aprueba", d);
ok(/Ajustar inventario/.test(await callErr(ANA, "count_decide($1, true, null)", [C]) ?? ""), "aprobar sigue pidiendo «Ajustes de inventario»");
const [{ d: def }] = await raw("select pg_get_functiondef('public.count_start(uuid,uuid,text,text)'::regprocedure) d");
ok((def.match(/vm__can_count/g) ?? []).length === 1, "dos corridas no repiten la revisión");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
