// Pruebas de 20261326: reconocer las líneas de una factura en Excel/CSV (como la remisión 30947).
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.stores (id uuid primary key default gen_random_uuid(), owner_id uuid);
create table public.store_users (store_id uuid, user_id uuid, role text, active boolean default true, permissions text[]);
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, sku text, barcode text,
  active boolean default true, auto_inactive boolean not null default false, tax_rate numeric default 0);
create table public.erp_stock_levels (warehouse_id uuid, product_id uuid, qty integer);
create table public.erp_suppliers (id uuid primary key default gen_random_uuid(), store_id uuid, name text);
create table public.erp_purchases (id uuid primary key default gen_random_uuid(), store_id uuid, number bigint, supplier_id uuid,
  invoice_ref text, status text default 'received', created_at timestamptz default now());
create table public.erp_supplier_item_map (store_id uuid, supplier_id uuid, supplier_code text, product_id uuid, description text,
  updated_by uuid, updated_at timestamptz default now(), primary key (supplier_id, supplier_code));
create function public.erp_can(s uuid, p text) returns boolean language sql stable as $$
  select auth.uid() is not null and (exists (select 1 from public.stores x where x.id = s and x.owner_id = auth.uid())
    or exists (select 1 from public.store_users u where u.store_id = s and u.user_id = auth.uid() and u.active and p = any(u.permissions))) $$;
-- Igual que 20261246.
create or replace function public.erp__norm_name(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(upper(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙ', 'aeiouunAEIOUUNaeiouAEIOU')), '[^A-Z0-9]+', ' ', 'g'))
$$;
`);
const M = fs.readFileSync(path.join(MIG, "20261326_importar_compra_excel.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 700) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const U = (n) => `ce100000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2);
const [{ id: S }] = await raw("insert into stores (owner_id) values ($1) returning id", [OWNER]);
const [{ id: S2 }] = await raw("insert into stores (owner_id) values ($1) returning id", [U(9)]);
await raw("insert into store_users values ($1, $2, 'seller', true, '{pos}')", [S, SELLER]);
const [{ id: NEXT }] = await raw("insert into erp_suppliers (store_id, name) values ($1, 'NEXT TECHNOLOGY') returning id", [S]);
const add = async (store, name, sku, extra = {}) => (await raw(
  "insert into products (store_id, name, sku, barcode, active, auto_inactive, tax_rate) values ($1, $2, $3, $4, $5, $6, $7) returning id",
  [store, name, sku, extra.barcode ?? null, extra.active ?? true, extra.auto ?? false, extra.tax ?? 0]))[0].id;
const CLOSET = await add(S, "CLOSET ARMABLE DE TELA 88130", "529");
const CH009 = await add(S, "CHAQUETA CH009", "CH009", { tax: 19 });
const EAN = await add(S, "LINTERNA", "L1", { barcode: "7701234567890" });
const DUP1 = await add(S, "ZAPATERA 4521 NEGRA", "Z1");
const DUP2 = await add(S, "ZAPATERA 4521 BLANCA", "Z2");
const MANO = await add(S, "RELOJ ÁGIL", "R7", { active: false });
const LEARN = await add(S, "AUDIFONOS PRO", "A9");
await add(S2, "OTRA TIENDA 77777", "77777");
await raw("insert into erp_supplier_item_map (store_id, supplier_id, supplier_code, product_id) values ($1, $2, 'NX-01', $3)", [S, NEXT, LEARN]);
await raw("insert into erp_purchases (store_id, number, supplier_id, invoice_ref) values ($1, 40, $2, '30947')", [S, NEXT]);

const lines = [
  { code: "88130", description: "CLOSET DE TELA" },          // 0 código en el nombre
  { code: "ch009", description: "CHAQUETA" },                // 1 sku (sin importar mayúsculas)
  { code: "7701234567890", description: "LINTERNA LED" },    // 2 código de barras
  { code: "4521", description: "ZAPATERA" },                 // 3 en el nombre de dos → elegir
  { code: "", description: "Reloj ágil" },                   // 4 mismo nombre (inactivo)
  { code: "NX-01", description: "AUDIFONOS" },               // 5 aprendido
  { code: "99999", description: "PRODUCTO NUEVO" },          // 6 nuevo, código libre
  { code: "529", description: "OTRO" },                      // 7 el código ya es de un producto → sku
  { code: "77777", description: "NUEVO 2" },                 // 8 solo existe en otra tienda
  { code: "13", description: "CORTO" },                      // 9 código muy corto: no se busca en nombres
];
const run = (uid, sup, ref, ls = lines) => as(uid, "select public.erp_purchase_import_match($1, $2, $3, $4::jsonb) r", [S, sup, ref, JSON.stringify(ls)]).then((x) => x[0].r);
let r = await run(OWNER, NEXT, " 30947 ");
const L = (i) => r.lines.find((x) => x.idx === i);
console.log("Reconocer");
ok(r.ok && r.lines.length === lines.length, "Devuelve una fila por línea", r);
ok(L(0).product_id === CLOSET && L(0).how === "name_code", "88130 → CLOSET ARMABLE DE TELA 88130 (código en el nombre)", L(0));
ok(L(1).product_id === CH009 && L(1).how === "sku" && Number(L(1).tax_rate) === 19, "ch009 → CH009 por código, con su IVA", L(1));
ok(L(2).product_id === EAN && L(2).how === "barcode", "Por código de barras", L(2));
ok(!L(3).product_id && L(3).candidates?.length === 2 && L(3).candidates.some((c) => c.id === DUP1) && L(3).candidates.some((c) => c.id === DUP2), "4521 en el nombre de dos productos: no elige, muestra los dos", L(3));
ok(L(4).product_id === MANO && L(4).how === "name" && L(4).active === false, "Mismo nombre (sin tildes) y avisa que está inactivo", L(4));
ok(L(5).product_id === LEARN && L(5).how === "learned", "Código aprendido de ese proveedor", L(5));
ok(!L(6).product_id && L(6).code_free === true && !L(6).candidates, "Producto nuevo: sin pareja y con el código libre", L(6));
ok(L(7).product_id === CLOSET && L(7).how === "sku" && L(7).code_free === false, "529 es el código del CLOSET (no está libre)", L(7));
ok(!L(8).product_id && L(8).code_free === true, "Un código que solo existe en otra tienda no cuenta", L(8));
ok(!L(9).product_id && !L(9).candidates, "Un código de 2 cifras no se busca dentro de los nombres", L(9));
ok(r.duplicate?.number === 40, "Avisa que la factura 30947 de ese proveedor ya se ingresó (#40)", r.duplicate);
r = await run(OWNER, NEXT, "30948");
ok(!r.duplicate, "Otro número de factura: sin aviso");
r = await run(OWNER, null, "30947");
ok(r.ok && !r.duplicate && r.supplier_found === false && r.lines.find((x) => x.idx === 5).how !== "learned", "Sin proveedor: no usa lo aprendido ni revisa duplicado", r.lines[5]);

console.log("Permisos y límites");
ok((await run(SELLER, NEXT, "1")).ok === false, "Sin permiso de Ingresos no consulta");
ok((await run(U(9), NEXT, "1")).ok === false, "El dueño de otra tienda tampoco");
ok((await run(OWNER, NEXT, "1", Array.from({ length: 1001 }, () => ({ code: "1" })))).ok === false, "Más de 1.000 líneas: no");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
