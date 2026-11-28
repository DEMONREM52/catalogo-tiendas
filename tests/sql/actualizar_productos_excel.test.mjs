// Pruebas de 20261353: actualizar productos desde Excel solo con lo revisado (antes → después), sin repetir y con permisos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const combined = path.join(os.tmpdir(), `remhub_pbu_${process.pid}.sql`);
// Como producción: % de ganancia, último costo, código de barras único por tienda y el cálculo automático del precio por %.
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  "alter table public.products add column if not exists markup_1 numeric(9,4), add column if not exists markup_2 numeric(9,4), add column if not exists markup_3 numeric(9,4), add column if not exists markup_4 numeric(9,4), add column if not exists markup_5 numeric(9,4), add column if not exists last_cost numeric;",
  "create unique index if not exists products_store_barcode_test on public.products (store_id, barcode) where barcode is not null;",
  `create or replace function public.test_autoprice() returns trigger language plpgsql as $f$
   begin
     if coalesce(current_setting('erp.skip_reprice', true), '') = '1' then return new; end if;
     if new.markup_3 is distinct from old.markup_3 and coalesce(new.cost_price, 0) > 0 then new.price_3 := round(new.cost_price * (1 + new.markup_3 / 100), -3); end if;
     return new;
   end $f$;`,
  "create trigger test_autoprice before update on public.products for each row execute function public.test_autoprice();",
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261353_actualizar_productos_excel.sql", "20261353_actualizar_productos_excel.sql"]) {
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
async function anon(s, p) {
  await db.query("select set_config('test.uid', '', false)");
  await db.exec("set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };
const U = (n) => `cfd00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ANA = U(2), LUIS = U(3), OTRO = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('pbu', 'LA VITRINA', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('pbu2', 'OTRA', $1) returning id", [OTRO]);
// Ana importa pero no cambia precios; Luis solo edita productos (sin «Importar productos»).
await raw("insert into store_users (store_id, user_id, role, display_name, active, permissions) values ($1, $2, 'seller', 'Ana', true, '{products,products_import}'), ($1, $3, 'seller', 'Luis', true, '{products}')", [A, ANA, LUIS]);
const [{ id: COCINA }] = await raw("insert into product_categories (store_id, name) values ($1, 'COCINA') returning id", [A]);
const [{ id: AJENA }] = await raw("insert into product_categories (store_id, name) values ($1, 'AJENA') returning id", [B]);
const prod = async (store, n, sku, barcode, extra = {}) => (await raw(
  "insert into products (store_id, name, sku, barcode, description, price_1, price_2, price_3, price_4, price_5, price_retail, price_wholesale, cost_price, last_cost, markup_3) values ($1, $2, $3, $4, 'Acero', 90000, 61000, 89000, 89000, 89000, 89000, 61000, $5, $6, $7) returning id",
  [store, n, sku, barcode, extra.cost ?? 0, extra.last ?? null, extra.markup ?? null]))[0].id;
const OLLA = await prod(A, "OLLA EXPRESS", "OL-77", "7701");
const TAZA = await prod(A, "TAZA ROSA", "TZ-1", "7702");
const PCT = await prod(A, "SARTEN POR %", "SP-1", "7703", { cost: 40000, last: 50000, markup: 20 });
const AJENO = await prod(B, "DE OTRA TIENDA", "X-1", "9901");
const call = (uid, key, rows, file = "precios.xlsx") => as(uid, "select public.products_bulk_update($1, $2, $3, $4::jsonb) r", [A, key, file, JSON.stringify(rows)]).then((r) => r[0].r);
const get = async (id) => (await raw("select name, barcode, category_id, description, price_1, price_2, price_3, price_4, price_5, price_retail, price_wholesale, markup_3 from products where id = $1", [id]))[0];

console.log("Permisos");
ok(/Importar productos/.test(await err(LUIS, "select public.products_bulk_update($1, 'k0', 'x', '[]'::jsonb)", [A]) ?? ""), "Sin «Importar productos»: no");
let anonErr = "";
try { await anon("select public.products_bulk_update($1, 'k0', 'x', '[]'::jsonb)", [A]); } catch (e) { anonErr = e.message; }
ok(/permission denied/.test(anonErr), "Sin sesión: no (ni siquiera puede llamarla)", anonErr);
ok(/Cambiar precios/.test(await err(ANA, "select public.products_bulk_update($1, 'k1', 'x', $2::jsonb)", [A, JSON.stringify([{ id: OLLA, set: { price_3: 95000 }, expect: { price_3: 89000 } }])]) ?? ""), "Ana sin «Cambiar precios»: los precios no");
const ana = await call(ANA, "k2", [{ id: OLLA, set: { name: "OLLA EXPRESS 6L", category_id: COCINA }, expect: { name: "OLLA EXPRESS", category_id: null } }]);
ok(ana.updated === 1 && (await get(OLLA)).name === "OLLA EXPRESS 6L" && (await get(OLLA)).category_id === COCINA, "Ana sí cambia nombre y categoría", ana);
ok(/no se cambia desde Excel/.test(await err(OWNER, "select public.products_bulk_update($1, 'k3', 'x', $2::jsonb)", [A, JSON.stringify([{ id: OLLA, set: { cost_price: 1 } }])]) ?? ""), "Costo (o unidades) nunca desde aquí");
ok(/no se cambia desde Excel/.test(await err(OWNER, "select public.products_bulk_update($1, 'k3', 'x', $2::jsonb)", [A, JSON.stringify([{ id: OLLA, set: { stock: 1 } }])]) ?? ""), "Unidades tampoco");

console.log("Solo lo que viene");
const r1 = await call(OWNER, "k4", [{ id: TAZA, set: { price_3: 95000 }, expect: { price_3: 89000 } }]);
const taza = await get(TAZA);
ok(r1.updated === 1 && Number(taza.price_3) === 95000 && Number(taza.price_retail) === 95000, "Cambia el precio 3 (y el detal viejo)", taza);
ok(Number(taza.price_1) === 90000 && Number(taza.price_2) === 61000 && Number(taza.price_4) === 89000 && taza.description === "Acero" && taza.barcode === "7702", "Lo demás queda igual", taza);
ok(Number((await raw("select count(*) n from erp_audit_logs where store_id = $1 and action = 'producto.actualizacion_excel'", [A]))[0].n) === 2, "Cada envío queda en la auditoría");
const run = (await as(ANA, "select changes, file_name from erp_product_bulk_runs where store_id = $1 and op_key = 'k4'", [A]))[0];
ok(run && Number(run.changes[0].before.price_3) === 89000 && run.changes[0].after.price_3 === 95000 && run.file_name === "precios.xlsx", "El envío guarda el antes y el después", run);
ok((await as(LUIS, "select count(*)::int n from erp_product_bulk_runs", []))[0].n === 0, "Quien no importa no ve los envíos");

console.log("No repetir y no pisar cambios ajenos");
const again = await call(OWNER, "k4", [{ id: TAZA, set: { price_3: 95000 }, expect: { price_3: 89000 } }]);
ok(again.repeated === true && again.updated === 1 && Number((await raw("select count(*) n from erp_product_bulk_runs where op_key = 'k4'"))[0].n) === 1, "El mismo envío dos veces se aplica una vez", again);
await raw("update products set price_1 = 91000 where id = $1", [OLLA]); // alguien lo cambió mientras se revisaba
const r2 = await call(OWNER, "k5", [
  { id: OLLA, set: { price_1: 99000 }, expect: { price_1: 90000 } },
  { id: TAZA, set: { price_2: 60000, description: "" }, expect: { price_2: 61000, description: "Acero" } },
]);
ok(r2.updated === 1 && r2.conflicts.length === 1 && r2.conflicts[0].fields === "price_1" && Number((await get(OLLA)).price_1) === 91000, "Cambió mientras se revisaba: no se toca y se avisa", r2);
ok(Number((await get(TAZA)).price_2) === 60000 && Number((await get(TAZA)).price_wholesale) === 60000 && (await get(TAZA)).description === "", "La otra fila sí (y se puede dejar vacía la descripción)");
const r3 = await call(OWNER, "k6", [{ id: TAZA, set: { price_2: 60000 }, expect: { price_2: 60000 } }]);
ok(r3.updated === 0 && r3.same === 1, "Ya tenía ese valor: nada que hacer", r3);

console.log("Errores por fila (las demás siguen)");
const r4 = await call(OWNER, "k7", [
  { id: OLLA, set: { category_id: AJENA }, expect: { category_id: COCINA } },
  { id: AJENO, set: { name: "ROBADO" }, expect: { name: "DE OTRA TIENDA" } },
  { id: OLLA, set: { barcode: "7702" }, expect: { barcode: "7701" } },
  { id: TAZA, set: { name: "  " }, expect: { name: "TAZA ROSA" } },
  { id: TAZA, set: { price_4: -5 }, expect: { price_4: 89000 } },
  { id: TAZA, set: { price_5: 79000 }, expect: { price_5: 89000 } },
]);
const msgs = r4.errors.map((e) => e.error).join(" | ");
ok(r4.updated === 1 && r4.errors.length === 5, "5 filas con error, 1 aplicada", r4);
ok(/categoría no es de esta tienda/.test(msgs) && /no existe en la tienda/.test(msgs) && /otro producto/.test(msgs) && /nombre no puede quedar vacío/.test(msgs) && /no es un precio válido/.test(msgs), "Dice por qué en cada una", msgs);
ok((await raw("select name from products where id = $1", [AJENO]))[0].name === "DE OTRA TIENDA", "Un producto de otra tienda nunca se toca");
ok((await get(OLLA)).barcode === "7701" && Number((await get(TAZA)).price_5) === 79000, "El código repetido no quedó; el precio 5 sí");

console.log("Precio por % de ganancia");
const r5 = await call(OWNER, "k8", [{ id: PCT, set: { price_3: 70050 }, expect: { price_3: 89000 } }]);
const pct = await get(PCT);
ok(r5.updated === 1 && Number(pct.price_3) === 70050, "El precio escrito queda exacto (sin redondear)", pct);
ok(Math.abs(Number(pct.markup_3) - 40.1) < 0.0001, "El % pasa a ser el que da ese precio sobre el último costo (50.000 → 40,1 %)", pct.markup_3);
const r6 = await call(OWNER, "k9", [{ id: PCT, set: { price_3: 45000 }, expect: { price_3: 70050 } }]);
ok(r6.updated === 0 && /debajo del costo/.test(r6.errors[0]?.error ?? "") && Number((await get(PCT)).price_3) === 70050, "Por debajo del costo: no se toca", r6);
ok(!JSON.stringify(r6).match(/50000|40000/), "El aviso no muestra el costo");
await raw("update products set markup_3 = 30 where id = $1", [PCT]);
ok(Number((await get(PCT)).price_3) === 52000, "Después, el cálculo por % sigue funcionando como siempre (fuera del envío)");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
