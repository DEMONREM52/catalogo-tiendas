import test from "node:test";
import assert from "node:assert/strict";

// localStorage de mentiras (Node no lo trae sin archivo).
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  },
});

const { setRemScope, remKey, recordMiss, readMisses, resolveMiss, forgetEverything } = await import("@/lib/rem/memory");
const { learnPhrase, learnedPhrase, listPhrases, readLog, writeLog, learnedCount } = await import("@/lib/voice/navigate");
const { learn, learnedFor } = await import("@/lib/voice/fuzzy");

test("lo de antes (por equipo): las frases pasan a quien entra; la conversación vieja se borra", () => {
  store.clear();
  store.set("remhub:rem-phrases", JSON.stringify({ "la plata de los muchachos": { href: "/dashboard/gastos?tab=payroll", label: "Nómina", at: 1, uses: 1 } }));
  store.set("remhub:rem-log", JSON.stringify([{ who: "you", text: "algo privado de otra persona", at: 1 }]));
  setRemScope("ana", "tienda1");
  assert.equal(learnedPhrase("la plata de los muchachos")?.label, "Nómina");
  assert.equal(store.has("remhub:rem-phrases"), false);
  assert.equal(store.has("remhub:rem-log"), false, "la conversación vieja no se le muestra a nadie");
  assert.deepEqual(readLog(), []);
});

test("cada persona y cada tienda tienen lo suyo", () => {
  store.clear();
  setRemScope("ana", "tienda1");
  learnPhrase("la plata de los muchachos", "/dashboard/gastos?tab=payroll", "Nómina");
  writeLog([{ who: "you", text: "cuánto vendimos hoy", at: 1 }]);
  learn("termolico", { id: "p1", name: "Termo licuadora", sku: "HM03" });
  recordMiss("algo raro que no entendió", "/dashboard");
  assert.equal(remKey("log"), "remhub:rem-log:ana:tienda1");

  setRemScope("beto", "tienda1");
  assert.equal(learnedPhrase("la plata de los muchachos"), null, "Beto no ve lo de Ana");
  assert.deepEqual(readLog(), []);
  assert.equal(learnedFor("termolico"), null);
  assert.deepEqual(readMisses(), []);
  assert.equal(learnedCount(), 0);

  setRemScope("ana", "tienda2");
  assert.equal(learnedPhrase("la plata de los muchachos"), null, "otra tienda, otra memoria");

  setRemScope("ana", "tienda1");
  assert.equal(learnedPhrase("la plata de los muchachos")?.label, "Nómina");
  assert.equal(readLog().length, 1);
  assert.equal(learnedFor("termolico")?.id, "p1");
  assert.equal(readMisses()[0]?.text, "algo raro que no entendió");
});

test("frases que no entendió: se cuentan, se resuelven y no guardan ruido", () => {
  store.clear();
  setRemScope("ana", "tienda1");
  recordMiss("la plata de los muchachos", "/dashboard");
  recordMiss("La plata de los muchachos", "/dashboard/pos");
  recordMiss("eh", "/dashboard");
  const m = readMisses();
  assert.equal(m.length, 1);
  assert.equal(m[0].times, 2);
  resolveMiss("la plata de los muchachos");
  assert.deepEqual(readMisses(), []);
});

test("ver, corregir y borrar todo", () => {
  store.clear();
  setRemScope("ana", "tienda1");
  learnPhrase("la plata de los muchachos", "/dashboard/gastos?tab=payroll", "Nómina");
  assert.equal(listPhrases()[0]?.key, "la plata de los muchachos");
  forgetEverything();
  assert.deepEqual(listPhrases(), []);
  assert.deepEqual(readLog(), []);
  setRemScope(null, null);
});
