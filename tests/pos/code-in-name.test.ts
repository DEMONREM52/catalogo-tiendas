import { test } from "node:test";
import assert from "node:assert/strict";
import { codeInName } from "../../src/lib/products/radar";

test("encuentra el código del proveedor metido en el nombre", () => {
  assert.equal(codeInName("CLOSET ARMABLE DE TELA 88130", "529", null), "88130");
  assert.equal(codeInName("LECTOR DE TARJETAS CH21250", "484", null), "CH21250");
  assert.equal(codeInName("CAFETERA DE 0.6L 550W STARLUX SL 29001", "1065", null), "SL29001");
});

test("no lo marca si es su propio código o el de barras", () => {
  assert.equal(codeInName("CHAQUETA CH009", "CH009", null), null);
  assert.equal(codeInName("CAFETERA STARLUX SL 29001", "SL 29001", null), null);
  assert.equal(codeInName("LECTOR CH21250", "1", "RYL CH21250"), null);
});

test("medidas, años y números cortos no son códigos", () => {
  assert.equal(codeInName("CAFETERA DE 0.6L 550W", "1", null), null);
  assert.equal(codeInName("CELULAR 128GB 10000MAH", "1", null), null);
  assert.equal(codeInName("AGENDA 2026", "1", null), null);
  assert.equal(codeInName("MINI WAFLERA 4 PULGADAS", "1", null), null);
});
