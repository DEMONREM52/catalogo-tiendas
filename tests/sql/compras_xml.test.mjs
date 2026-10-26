// Pruebas de 20261246: reconocer la factura del proveedor (XML de la DIAN) y aprender sus códigos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_xml_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261246_compras_xml.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `c0b00000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), BUYER = U(2), SELL = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: OTHER }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [U(9)]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{purchases}'), ($1, $3, 'seller', '{pos}')", [A, BUYER, SELL]);
const B = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: SUP }] = await raw("insert into erp_suppliers (store_id, name, nit) values ($1, 'DISTRIBUIDORA SUR', '900.123.456-7') returning id", [A]);
const prod = async (n, sku, barcode, store = A) => (await raw("insert into products (store_id, name, sku, barcode, tax_rate) values ($1, $2, $3, $4, 19) returning id", [store, n, sku, barcode]))[0].id;
const ALC = await prod("Alcohol antiséptico 700 ml", "ALC700", null);
const GUA = await prod("GUANTES NITRILO", "G-01", "7701234567890");
const JAB = await prod("JABÓN LÍQUIDO", "JAB1", null);
const FOREIGN = await prod("AJENO", "XYZ", "111", OTHER);
await raw("insert into erp_purchases (store_id, number, supplier_id, warehouse_id, status, invoice_ref) values ($1, 1, $2, $3, 'received', 'FE 1001')", [A, SUP, B]);

const lines = [
  { seller_code: "P-77", standard_code: null, description: "ALCOHOL ANTISEPTICO 700ML x1" },
  { seller_code: "X1", standard_code: "7701234567890", description: "Guantes" },
  { seller_code: "alc700", standard_code: null, description: "otra cosa" },
  { seller_code: null, standard_code: null, description: "jabon liquido" },
  { seller_code: "XYZ", standard_code: "111", description: "nada" },
];
const match = (u, nit, ref, l = lines) => one(u, "select public.erp_purchase_xml_match($1, $2, $3, $4::jsonb) r", [A, nit, ref, JSON.stringify(l)]);

console.log("1. Reconocer");
ok((await match(SELL, "900123456", "x")).ok === false, "Sin permiso de compras no");
let r = await match(BUYER, "9001234567", "FE1001");
ok(r.ok && r.supplier?.id === SUP, "Reconoce el proveedor por NIT con dígito de verificación (guardado con puntos y guion)", r.supplier);
ok((await match(BUYER, "900123456", "x")).supplier?.id === SUP, "   y sin el dígito");
ok(r.duplicate?.number === 1, "Avisa que esa factura ya se ingresó (sin importar espacios)", r.duplicate);
ok((await match(BUYER, "900123456", "FE 1002")).duplicate === null, "   otra factura: sin aviso");
ok(r.lines[1].product_id === GUA && r.lines[1].how === "barcode", "Línea 2 por código de barras", r.lines[1]);
ok(r.lines[2].product_id === ALC && r.lines[2].how === "sku", "Línea 3 por SKU (sin importar mayúsculas)", r.lines[2]);
ok(r.lines[3].product_id === JAB && r.lines[3].how === "name", "Línea 4 por nombre igual (sin tildes)", r.lines[3]);
ok(r.lines[0].product_id === null && r.lines[4].product_id === null, "Lo que no se reconoce queda para elegir (nada de otra tienda)", [r.lines[0], r.lines[4]]);
ok(Number(r.lines[1].tax_rate) === 19, "Trae el IVA del producto");
ok((await match(BUYER, "800000000", "x")).supplier === null, "Proveedor desconocido: null");

console.log("2. Aprender");
ok((await one(SELL, "select public.erp_supplier_item_map_save($1, $2, $3::jsonb) r", [A, SUP, JSON.stringify([{ code: "P-77", product_id: ALC }])])).ok === false, "Sin permiso no guarda");
r = await one(BUYER, "select public.erp_supplier_item_map_save($1, $2, $3::jsonb) r", [A, SUP, JSON.stringify([
  { code: "P-77", product_id: ALC, description: "ALCOHOL" }, { code: "Z", product_id: FOREIGN }, { code: "", product_id: JAB },
])]);
ok(r.ok && r.saved === 1, "Guarda solo lo válido (producto de la tienda, código no vacío)", r);
r = await match(BUYER, "900123456", "x");
ok(r.lines[0].product_id === ALC && r.lines[0].how === "learned", "La próxima vez llega solo", r.lines[0]);
await one(BUYER, "select public.erp_supplier_item_map_save($1, $2, $3::jsonb) r", [A, SUP, JSON.stringify([{ code: "P-77", product_id: JAB }])]);
ok((await match(BUYER, "900123456", "x")).lines[0].product_id === JAB, "   y se puede corregir");
ok((await as(SELL, "select count(*)::int n from erp_supplier_item_map"))[0].n === 0, "La tabla no la ve quien no compra");

console.log("3. Proveedor desde el XML");
r = await one(BUYER, "select public.erp_purchase_xml_supplier($1, '800.555.111-2', 'Nuevo Proveedor sas', 'a@b.co', '300', 'Calle 1') r", [A]);
const [nuevo] = await raw("select * from erp_suppliers where id = $1", [r.id]);
ok(r.ok && nuevo?.name === "NUEVO PROVEEDOR SAS" && nuevo.nit === "8005551112" && nuevo.email === "a@b.co", "Crea el proveedor con los datos del XML", nuevo);
ok((await one(BUYER, "select public.erp_purchase_xml_supplier($1, '8005551112', 'Otro nombre') r", [A])).id === r.id, "   si ya existe por NIT, no lo duplica");
ok((await one(BUYER, "select public.erp_purchase_xml_supplier($1, '', 'X') r", [A])).ok === false, "Sin NIT no");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
