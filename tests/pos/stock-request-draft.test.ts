import test from "node:test";
import assert from "node:assert/strict";

// localStorage y eventos mínimos para correr en Node.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { readStockDraft, saveStockDraft, draftAge } = await import("@/lib/stock-request-draft");

const line = (id: string, qty = 2) => ({ product_id: id, name: `P ${id}`, sku: null, qty, there: 5, here: 0 });

test("el pedido interno a medio armar se guarda y se recupera igual", () => {
  const lines = Array.from({ length: 120 }, (_, i) => line(String(i), i + 1));
  saveStockDraft("tienda", { from: "zamora", to: "bodega", lines, note: "para el sábado", urgent: true, neededBy: "2026-11-12" });
  const d = readStockDraft("tienda");
  assert.ok(d);
  assert.equal(d.lines.length, 120);
  assert.equal(d.lines[119].qty, 120);
  assert.equal(d.note, "para el sábado");
  assert.equal(d.urgent, true);
  assert.equal(d.from, "zamora");
  assert.equal(readStockDraft("otra"), null, "cada tienda tiene el suyo");
});

test("vacío o enviado: se borra", () => {
  saveStockDraft("tienda", { from: "a", to: "b", lines: [], note: "  ", urgent: false, neededBy: "" });
  assert.equal(readStockDraft("tienda"), null);
  saveStockDraft("tienda", { from: "a", to: "b", lines: [line("x")], note: "", urgent: false, neededBy: "" });
  saveStockDraft("tienda", null);
  assert.equal(readStockDraft("tienda"), null);
});

test("a los 14 días se descarta", () => {
  store.set("remhub:sr-draft:vieja", JSON.stringify({ at: new Date(Date.now() - 15 * 86400_000).toISOString(), from: "a", to: "b", lines: [line("x")], note: "", urgent: false, neededBy: "" }));
  assert.equal(readStockDraft("vieja"), null);
  assert.equal(store.has("remhub:sr-draft:vieja"), false);
});

test("texto de antigüedad", () => {
  assert.equal(draftAge(new Date(Date.now() - 5 * 60_000).toISOString()), "hace 5 min");
  assert.equal(draftAge(new Date(Date.now() - 3 * 3600_000).toISOString()), "hace 3 h");
  assert.equal(draftAge(new Date(Date.now() - 2 * 86400_000).toISOString()), "hace 2 días");
});
