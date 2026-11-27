import test from "node:test";
import assert from "node:assert/strict";
import { PICK_KEYS_START, pickKeyReduce } from "@/lib/search-keys";

test("lector: código + Enter solo busca, nunca elige el primero", () => {
  const r = pickKeyReduce(PICK_KEYS_START, "Enter", 10);
  assert.equal(r.action, "search");
  assert.equal(r.handled, true);
});

test("Enter sin resultados también solo busca", () => {
  assert.equal(pickKeyReduce(PICK_KEYS_START, "Enter", 0).action, "search");
});

test("↓ marca el primero y Enter lo elige", () => {
  const down = pickKeyReduce(PICK_KEYS_START, "ArrowDown", 3);
  assert.deepEqual(down.state, { index: 0, armed: true });
  const enter = pickKeyReduce(down.state, "Enter", 3);
  assert.equal(enter.action, "pick");
  assert.deepEqual(enter.state, PICK_KEYS_START);
});

test("↓↓ baja, ↑ desde el inicio va al último, y da la vuelta", () => {
  let s = pickKeyReduce(PICK_KEYS_START, "ArrowDown", 3).state;
  s = pickKeyReduce(s, "ArrowDown", 3).state;
  assert.equal(s.index, 1);
  s = pickKeyReduce(s, "ArrowDown", 3).state;
  s = pickKeyReduce(s, "ArrowDown", 3).state;
  assert.equal(s.index, 0);
  assert.deepEqual(pickKeyReduce(PICK_KEYS_START, "ArrowUp", 3).state, { index: 2, armed: true });
});

test("si la lista se vacía, lo marcado ya no cuenta: Enter busca", () => {
  const armed = { index: 2, armed: true };
  assert.equal(pickKeyReduce(armed, "Enter", 0).action, "search");
});

test("otras teclas no hacen nada; Escape avisa sin bloquear la tecla", () => {
  assert.equal(pickKeyReduce(PICK_KEYS_START, "a", 3).handled, false);
  const esc = pickKeyReduce({ index: 1, armed: true }, "Escape", 3);
  assert.equal(esc.action, "escape");
  assert.equal(esc.handled, false);
});
