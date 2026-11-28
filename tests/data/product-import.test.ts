// Data Studio §22 y §42: exportar productos → editar en Excel → volver a subir → ver antes y después (sin tocar la base).
import test from "node:test";
import assert from "node:assert/strict";
import { buildXlsxAsync, type XCell } from "../../src/lib/data/xlsx";
import { pickSheet } from "../../src/lib/data/read-table";
import { matchRows, parseCsv, reviewRows, toRows } from "../../src/lib/data/product-import";
import type { CurrentProduct, UpdField } from "../../src/lib/data/product-update";

const ID1 = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222", ID3 = "33333333-3333-4333-8333-333333333333";
const CUR: CurrentProduct[] = [
  { id: ID1, name: "OLLA EXPRESS", sku: "OL-77", barcode: "0012345678905", category_id: "c1", description: "Acero", price_1: 90000, price_2: 61000, price_3: 89000, price_4: 89000, price_5: 89000 },
  { id: ID2, name: "TAZA ROSA", sku: "TZ-1", barcode: null, category_id: null, description: "", price_1: 12000, price_2: 6000, price_3: 9000, price_4: 9000, price_5: 9000 },
  { id: ID3, name: "SARTEN", sku: "SP-1", barcode: "7703", category_id: "c1", description: "Teflón", price_1: 50000, price_2: 40000, price_3: 48000, price_4: 48000, price_5: 48000 },
];
const catName = new Map([["c1", "COCINA"]]);
// Los mismos encabezados que «Importar y exportar → Productos» (src/app/dashboard/datos/exports.ts).
const HEAD = ["Referencia", "Código de barras", "Nombre", "Categoría", "Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5",
  "Unidades (solo lectura)", "Costo (solo lectura)", "Activo", "Descripción", "Foto", "Creado", "ID RemHub (no cambiar)"];
const exported = (): XCell[][] => CUR.map((p) => [p.sku, p.barcode ?? "", p.name, p.category_id ? catName.get(p.category_id)! : "", p.price_1, p.price_2, p.price_3, p.price_4, p.price_5,
  25, 30000, "Sí", p.description ?? "", "", "27/11/2026", p.id]);
const ALL = new Set<UpdField>(["name", "barcode", "category", "description", "p1", "p2", "p3", "p4", "p5"]);

async function roundTrip(rows: XCell[][]) {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const bytes = await buildXlsxAsync({ meta: { company: "PRUEBA", title: "Productos" }, sheets: [{ name: "Productos", head: HEAD, rows }] });
  const sheets = (await readXlsxFile(Buffer.from(bytes))) as Array<{ sheet: string; data: unknown[][] }>;
  const book = sheets.map((s) => ({ name: s.sheet, rows: s.data }));
  return book[pickSheet(book, { name: "Productos", known: ["id remhub", "nombre", "referencia"] })].rows;
}
const review = (table: unknown[][], o: Partial<{ mode: "skip" | "update" | "update_only"; fields: Set<UpdField>; empty: "keep" | "clear" }> = {}) => {
  const { rows } = toRows(table);
  matchRows(rows, CUR);
  return reviewRows(rows, { mode: o.mode ?? "update_only", fields: o.fields ?? ALL, empty: o.empty ?? "keep", current: new Map(CUR.map((p) => [p.id, p])), catName });
};

test("lo exportado, sin cambios, vuelve sin nada que aplicar (y nunca mueve unidades ni costo)", async () => {
  const table = await roundTrip(exported());
  const parsed = toRows(table);
  assert.equal(parsed.hasId, true);
  assert.deepEqual([...parsed.present].sort(), ["barcode", "category", "description", "name", "p1", "p2", "p3", "p4", "p5"]);
  assert.ok(parsed.unknown.includes("Unidades (solo lectura)") && parsed.unknown.includes("Costo (solo lectura)"), "las columnas de solo lectura no se usan");
  assert.ok(parsed.rows.every((r) => r.qty === 0 && r.cost === 0), "las unidades exportadas no entran como ingreso");
  assert.equal(parsed.rows[0].barcode, "0012345678905", "el código de barras conserva los ceros");
  const r = review(table);
  assert.deepEqual(r.map((x) => x.kind), ["same", "same", "same"]);
});

test("cambio el precio 3 de uno en Excel: solo ese producto y solo ese precio", async () => {
  const rows = exported();
  rows[1][6] = 9500;
  const r = review(await roundTrip(rows));
  assert.deepEqual(r.map((x) => x.kind), ["same", "update", "same"]);
  assert.deepEqual(r[1].changes, [{ field: "p3", before: 9000, after: 9500 }]);
});

test("elijo campos: con «solo precios» un nombre cambiado no se aplica; celda vacía conserva o borra según se pida", async () => {
  const rows = exported();
  rows[0][2] = "OLLA EXPRESS 6 LITROS";
  rows[0][7] = 92000;
  rows[2][12] = "";
  const table = await roundTrip(rows);
  const prices = review(table, { fields: new Set<UpdField>(["p1", "p2", "p3", "p4", "p5"]) });
  assert.deepEqual(prices[0].changes, [{ field: "p4", before: 89000, after: 92000 }]);
  assert.equal(prices[2].kind, "same", "descripción vacía: se conserva");
  const clear = review(table, { empty: "clear" });
  assert.deepEqual(clear[0].changes.map((c) => c.field), ["name", "p4"]);
  assert.deepEqual(clear[2].changes, [{ field: "description", before: "Teflón", after: null }]);
});

test("se reconoce por ID aunque cambie la referencia (y se avisa); un ID ajeno nunca crea ni toca nada", async () => {
  const rows = exported();
  rows[0][0] = "OL-77-NUEVA";
  rows[1][15] = "99999999-9999-4999-8999-999999999999";
  const r = review(await roundTrip(rows), { mode: "update" });
  assert.equal(r[0].kind, "same");
  assert.match(r[0].warns?.[0] ?? "", /no es la del producto/);
  assert.equal(r[1].kind, "error");
  assert.match(r[1].errors[0], /no es de un producto de esta tienda/);
});

test("un Excel propio sin ID: por referencia, luego por código de barras; nunca por nombre", () => {
  const csv = "nombre;referencia;codigo de barras;precio 3\nCUALQUIER NOMBRE;tz-1;;9900\nOTRO;;7703;47000\nSARTEN;;;1\nNUEVO;NV-1;;5000\nNUEVO;NV-1;;5000\n";
  const r = review(parseCsv(csv), { mode: "update" });
  assert.deepEqual(r.map((x) => x.kind), ["update", "update", "new", "new", "error"]);
  assert.deepEqual(r[0].changes.map((c) => c.field), ["name", "p3"], "por referencia (en minúscula también)");
  assert.equal(r[1].row.exists, ID3, "por código de barras");
  assert.equal(r[2].row.exists, null, "«SARTEN» se llama igual pero no tiene referencia ni código: no se toca el que existe");
  assert.match(r[4].errors[0], /Repetido en el archivo/);
  const only = review(parseCsv(csv), { mode: "update_only" });
  assert.deepEqual(only.map((x) => x.kind), ["update", "update", "missing", "missing", "error"], "«solo actualizar» nunca crea");
});

test("una sola columna «precio»: al actualizar cuenta para los 5 (se ve en la revisión)", () => {
  const r = review(parseCsv("referencia;precio\nTZ-1;10000\n"), { mode: "update" });
  assert.deepEqual(r[0].changes.map((c) => c.field), ["p1", "p2", "p3", "p4", "p5"]);
});
