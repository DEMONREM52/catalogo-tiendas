import test from "node:test";
import assert from "node:assert/strict";
import { pickSheet } from "../../src/lib/data/read-table";

const resumen = { name: "Resumen", rows: [["Inventario"], ["Empresa", "X"]] };
const productos = { name: "Productos", rows: [["Referencia", "Nombre", "Precio 3"], ["A", "B", 1]] };
const otra = { name: "Hoja2", rows: [["Nombre", "Precio 3"]] };

test("importar: con la portada «Resumen» se toma la hoja de datos, no la primera", () => {
  assert.equal(pickSheet([resumen, productos], { name: "Productos" }), 1);
  assert.equal(pickSheet([resumen, otra, productos], { known: ["referencia", "nombre", "precio 3"] }), 2);
  assert.equal(pickSheet([resumen, otra]), 1);
  assert.equal(pickSheet([otra]), 0);
  assert.equal(pickSheet([]), 0);
});
