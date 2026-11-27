// Cajas de un pedido interno: reparto por caja, lo que falta por empacar y la selección.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boxColor, clampSelection, distribution, distributionText, type SrBox } from "../../src/app/dashboard/pedidos/internos/boxes";

const box = (number: number, items: Array<[string, number]>, status: SrBox["status"] = "open"): SrBox => ({
  id: `b${number}`, number, name: null, color: null, notes: null, fragile: false, weight_kg: null, dims: null, seal: null, status,
  token: `t${number}`, received_at: null, created_by_name: null, created_at: "", updated_at: "", closed_at: null, closed_by_name: null,
  items: items.map(([item_id, qty]) => ({ item_id, qty })),
});

test("producto A repartido: 30 + 40 + 20 en cajas y 10 sin caja", () => {
  const d = distribution([{ id: "A", toSend: 100 }, { id: "B", toSend: 5 }], [box(2, [["A", 40]]), box(1, [["A", 30], ["B", 5]]), box(3, [["A", 20]], "closed")]);
  assert.equal(d.boxed.get("A"), 90);
  assert.equal(d.unboxed.get("A"), 10);
  assert.equal(d.unboxed.get("B"), 0);
  assert.deepEqual(d.perItem.get("A")!.map((x) => [x.box.number, x.qty]), [[1, 30], [2, 40], [3, 20]]);
  assert.equal(distributionText(d.perItem.get("A")!, d.unboxed.get("A")!), "C1·30 · C2·40 · C3·20 · 10 sin caja");
  assert.deepEqual(d.totals, { refsUnboxed: 1, unitsUnboxed: 10, unitsBoxed: 95, unitsToSend: 105, boxes: 3, open: 2 });
  assert.deepEqual(d.over, []);
});

test("si bajan lo que se envía después de empacar, se avisa (sin cifras negativas)", () => {
  const d = distribution([{ id: "A", toSend: 20 }], [box(1, [["A", 30]])]);
  assert.equal(d.unboxed.get("A"), 0);
  assert.deepEqual(d.over, [{ id: "A", boxed: 30, toSend: 20 }]);
});

test("la selección nunca pasa de lo que queda sin caja y quita lo ya empacado", () => {
  const unboxed = new Map([["A", 10], ["B", 0], ["C", 3]]);
  assert.deepEqual(clampSelection({ A: 25, B: 2, C: 0, D: 4 }, unboxed), { A: 10, C: 1 });
  assert.deepEqual(clampSelection({ A: 2.7 }, unboxed), { A: 2 });
});

test("color automático por número; el elegido manda", () => {
  assert.notEqual(boxColor({ number: 1, color: null }), boxColor({ number: 2, color: null }));
  assert.equal(boxColor({ number: 11, color: null }), boxColor({ number: 1, color: null }));
  assert.equal(boxColor({ number: 1, color: "#123456" }), "#123456");
});
