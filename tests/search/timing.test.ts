import test from "node:test";
import assert from "node:assert/strict";
import { peekSearch, searchDelay, storeSearch } from "@/lib/search-timing";

test("el temporizador espera más mientras menos se ha escrito", () => {
  assert.equal(searchDelay(""), 0);
  assert.equal(searchDelay("   "), 0);
  assert.equal(searchDelay("t"), 900);
  assert.equal(searchDelay("te"), 550);
  assert.equal(searchDelay("ten"), 400);
  assert.equal(searchDelay("tendedero triple"), 400);
});

test("un código de barras (lector) busca casi al instante", () => {
  assert.equal(searchDelay("7701234567890"), 120);
  assert.equal(searchDelay("125"), 400);
});

test("las búsquedas recientes se guardan y no se repiten", () => {
  assert.equal(peekSearch("x|tende"), undefined);
  storeSearch("x|tende", [1, 2]);
  assert.deepEqual(peekSearch("x|tende"), [1, 2]);
  assert.equal(peekSearch("x|tende", -1), undefined);
});
