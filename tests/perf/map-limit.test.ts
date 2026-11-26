import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "../../src/lib/net/map-limit";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("mapLimit: devuelve en el mismo orden aunque terminen en otro", async () => {
  const res = await mapLimit([30, 5, 15, 1], 4, async (ms, i) => { await wait(ms); return i * 10; });
  assert.deepEqual(res.map((r) => (r.ok ? r.value : null)), [0, 10, 20, 30]);
});

test("mapLimit: nunca corre más de `limit` a la vez", async () => {
  let now = 0, peak = 0;
  await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => { now++; peak = Math.max(peak, now); await wait(5); now--; });
  assert.equal(peak, 3);
});

test("mapLimit: un error no frena a los demás y queda en su posición", async () => {
  const res = await mapLimit(["a", "b", "c"], 2, async (x) => { if (x === "b") throw new Error("falló b"); return x.toUpperCase(); });
  assert.equal(res[0].ok && res[0].value, "A");
  assert.equal(res[1].ok, false);
  assert.equal(!res[1].ok && (res[1].error as Error).message, "falló b");
  assert.equal(res[2].ok && res[2].value, "C");
});

test("mapLimit: lista vacía y límites raros", async () => {
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
  const res = await mapLimit([1, 2], 0, async (x) => x * 2);
  assert.deepEqual(res.map((r) => r.ok && r.value), [2, 4]);
});

test("mapLimit: en paralelo tarda como el más lento por tanda, no la suma", async () => {
  const t0 = Date.now();
  await mapLimit([40, 40, 40, 40], 4, (ms) => wait(ms));
  assert.ok(Date.now() - t0 < 120, `tardó ${Date.now() - t0} ms (en serie serían ~160)`);
});
