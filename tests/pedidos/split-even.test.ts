// «Repartir lo que hay» en un lote de pedidos internos: proporcional a lo pedido, sin pasarse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitEven } from "../../src/app/dashboard/pedidos/internos/split";

test("reparte en proporción a lo que pidió cada punto", () => {
  assert.deepEqual(splitEven(6, [6, 3]), [4, 2]);
  assert.deepEqual(splitEven(5, [10, 10]), [3, 2]);
});

test("lo que sobra por redondeo se reparte de a uno y nunca se pasa de lo pedido", () => {
  const out = splitEven(7, [1, 5, 4]);
  assert.equal(out.reduce((s, x) => s + x, 0), 7);
  out.forEach((x, i) => assert.ok(x <= [1, 5, 4][i]));
});

test("si alcanza, cada uno recibe lo que pidió; si no hay, cero", () => {
  assert.deepEqual(splitEven(50, [6, 3]), [6, 3]);
  assert.deepEqual(splitEven(0, [6, 3]), [0, 0]);
  assert.deepEqual(splitEven(-4, [6, 3]), [0, 0]);
  assert.deepEqual(splitEven(3, [0, 0]), [0, 0]);
});
