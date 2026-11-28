import test from "node:test";
import assert from "node:assert/strict";
import { expectOf, matchProduct, productChanges, updatePayload, type CurrentProduct, type UpdField } from "../../src/lib/data/product-update";

const CUR: CurrentProduct = { id: "p1", name: "OLLA EXPRESS", sku: "OL-77", barcode: "7701", category_id: "c1", description: "Acero", price_1: 90000, price_2: 61000, price_3: 89000, price_4: 89000, price_5: 89000 };
const catName = new Map([["c1", "COCINA"], ["c2", "HOGAR"]]);
const ALL = new Set<UpdField>(["name", "barcode", "category", "description", "p1", "p2", "p3", "p4", "p5"]);

test("solo cambia lo que viene en el archivo: si solo trae el precio 3, no toca los otros precios", () => {
  const r = productChanges(CUR, { p3: 95000 }, { fields: ALL, empty: "keep", catName });
  assert.deepEqual(r.changes, [{ field: "p3", before: 89000, after: 95000 }]);
  assert.deepEqual(updatePayload(r.changes, () => null), { price_3: 95000 });
  assert.deepEqual(expectOf(CUR, r.changes), { price_3: 89000 }, "lo que se vio antes, para no pisar un cambio de otro");
});

test("sin cambios: nada que aplicar (también con «$ 89.000» escrito como texto)", () => {
  const r = productChanges(CUR, { name: "olla express", p3: "$ 89.000", p2: 61000 }, { fields: ALL, empty: "keep", catName });
  assert.deepEqual(r.changes, []);
});

test("celda vacía conserva por defecto; con «dejar vacío» borra descripción, código o categoría, nunca nombre ni precios", () => {
  const file = { name: "", description: "", barcode: "", category: "", p1: "" };
  assert.deepEqual(productChanges(CUR, file, { fields: ALL, empty: "keep", catName }).changes, []);
  const clear = productChanges(CUR, file, { fields: ALL, empty: "clear", catName }).changes;
  assert.deepEqual(clear.map((c) => c.field).sort(), ["barcode", "category", "description"]);
  assert.deepEqual(updatePayload(clear, () => null), { barcode: null, category_id: null, description: "" });
  assert.deepEqual(expectOf(CUR, clear), { barcode: "7701", category_id: "c1", description: "Acero" });
});

test("solo los campos elegidos; categoría nueva se avisa; errores no se aplican", () => {
  const r = productChanges(CUR, { name: "OLLA NUEVA", category: "jardín", p2: -5, p4: "abc" }, { fields: new Set<UpdField>(["category", "p2", "p4"]), empty: "keep", catName });
  assert.deepEqual(r.changes, [{ field: "category", before: "COCINA", after: "JARDÍN" }]);
  assert.equal(r.newCategory, "JARDÍN");
  assert.equal(r.errors.length, 2);
  assert.deepEqual(updatePayload(r.changes, (n) => (n === "JARDÍN" ? "c9" : null)), { category_id: "c9" });
});

test("reconocer el producto: ID → referencia → código de barras único; nunca por nombre", () => {
  const idx = { byId: new Map([["p1", "p1"]]), bySku: new Map([["OL-77", "p1"]]), byBarcode: new Map([["7701", ["p1"]], ["9999", ["p1", "p2"]]]) };
  assert.deepEqual(matchProduct({ id: "P1" }, idx), { id: "p1", by: "id" });
  assert.equal(matchProduct({ id: "otro" }, idx).id, null);
  assert.deepEqual(matchProduct({ sku: "ol-77" }, idx), { id: "p1", by: "referencia" });
  assert.deepEqual(matchProduct({ barcode: "7701" }, idx), { id: "p1", by: "codigo" });
  assert.match(matchProduct({ barcode: "9999" }, idx).problem ?? "", /es de 2 productos/);
  assert.deepEqual(matchProduct({}, idx), { id: null, by: null });
});
