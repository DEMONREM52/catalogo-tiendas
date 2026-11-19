import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../../src/lib/data/read-table";
import { detect, parseLines } from "../../src/lib/purchases/file-columns";

// Como la remisión 30947: título arriba, encabezados en la fila 3, totales al final.
const CSV = [
  "NEXT TECHNOLOGY;;;;",
  "REMISION 30947;;;;",
  "CODIGO;DESCRIPCION;CANTIDAD;VALOR UNITARIO;VALOR TOTAL",
  "88130;CLOSET DE TELA;173;30.000;5.190.000",
  "ch009;CHAQUETA;20;80.000;1.600.000",
  ";SIN CODIGO;2;1.500,50;3.001",
  "X1;;0;1000;0",
  ";TOTAL;;;6.793.001",
].join("\n");

test("encuentra la fila de encabezados y las columnas", () => {
  const rows = parseCsv(CSV);
  const { header, map } = detect(rows);
  assert.equal(header, 2);
  assert.deepEqual([map.code, map.description, map.qty, map.cost, map.total], [0, 1, 2, 3, 4]);
});

test("lee las líneas: códigos en mayúscula, miles con punto, salta vacías y totales", () => {
  const rows = parseCsv(CSV);
  const { header, map } = detect(rows);
  const lines = parseLines(rows, header, map);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => [l.code, l.qty, l.cost]), [["88130", 173, 30000], ["CH009", 20, 80000], ["", 2, 1500.5]]);
  assert.equal(lines[0].fileTotal, 5190000);
  assert.equal(lines[0].row, 4);
});

test("sin costo unitario lo calcula con el total; «precio» no se confunde con «total»", () => {
  const rows = parseCsv("Ref,Producto,Cant,Total\nA1,Uno,4,10000\n");
  const { header, map } = detect(rows);
  assert.equal(map.cost, -1);
  assert.equal(map.total, 3);
  const [l] = parseLines(rows, header, map);
  assert.equal(l.cost, 2500);
});

test("cantidad con decimales se redondea y se marca", () => {
  const rows = parseCsv("codigo;descripcion;cantidad;costo\nB2;Dos;2,5;100\n");
  const { header, map } = detect(rows);
  const [l] = parseLines(rows, header, map);
  assert.equal(l.qty, 3);
  assert.equal(l.qtyRounded, true);
});
