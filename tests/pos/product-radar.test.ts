import test from "node:test";
import assert from "node:assert/strict";
import { duplicateImages, planToday, stockValue, transferHint, duplicateNames, healthScore, productIssues, publishStatusText, ddmmyyyy, agoDays, type RadarProduct } from "@/lib/products/radar";

const NOW = Date.parse("2026-11-09T15:00:00Z");
const base = (over: Partial<RadarProduct> = {}): RadarProduct => ({
  id: "1", name: "Excavadora", image: "x.png", active: true, code: "9808", barcode: "770", created_at: "2026-01-01T00:00:00Z",
  prices: [63000, 0, 0, 0, 0], cost: 40000, category_id: "c", cats: 1, desc: true, long: true, gallery: 2, video: false,
  highlights: 3, specs: 0, stock: 5, stock_points: 1, last_sale_at: "2026-11-05T00:00:00Z", sold_30: 2, sold_90: 6,
  pub: { every_days: 7, every: 7, last: "2026-11-08T20:00:00Z", by: "Javier", times: 3, next_due: "2026-11-15" },
  ...over,
});
const ctx = (over = {}) => ({ today: "2026-11-09", now: NOW, canCosts: true, duplicates: new Set<string>(), ...over });

test("un producto completo no tiene falencias y vale 100", () => {
  const issues = productIssues(base(), ctx());
  assert.deepEqual(issues, []);
  assert.equal(healthScore(issues), 100);
});

test("falencias graves primero", () => {
  const issues = productIssues(base({ image: null, prices: [0, 0, 0, 0, 0], cats: 0, desc: false }), ctx());
  assert.deepEqual(issues.slice(0, 2).map((i) => i.key).sort(), ["no_photo", "no_price"]);
  assert.ok(issues.some((i) => i.key === "no_category"));
  assert.ok(healthScore(issues) <= 45);
});

test("precio por debajo del costo solo con permiso de costos", () => {
  const p = base({ prices: [30000, 0, 0, 0, 0] });
  assert.ok(productIssues(p, ctx()).some((i) => i.key === "below_cost"));
  assert.ok(!productIssues({ ...p, cost: null }, ctx({ canCosts: false })).some((i) => i.key === "below_cost" || i.key === "no_cost"));
});

test("quieto: con unidades y sin ventas en 60 días", () => {
  assert.ok(productIssues(base({ last_sale_at: "2026-08-01T00:00:00Z" }), ctx()).some((i) => i.key === "no_sales"));
  assert.ok(productIssues(base({ last_sale_at: null }), ctx()).some((i) => i.key === "no_sales"));
  // Recién creado (menos de 30 días) todavía no cuenta como quieto.
  assert.ok(!productIssues(base({ last_sale_at: null, created_at: "2026-11-01T00:00:00Z" }), ctx()).some((i) => i.key === "no_sales"));
  // Sin unidades no es «quieto», es «agotado».
  const out = productIssues(base({ stock: 0, last_sale_at: null }), ctx()).map((i) => i.key);
  assert.ok(out.includes("out_of_stock") && !out.includes("no_sales"));
});

test("publicación: toca, nunca, oculto", () => {
  assert.ok(productIssues(base({ pub: { every_days: 1, every: 1, last: "2026-11-08T12:00:00Z", by: null, times: 1, next_due: "2026-11-09" } }), ctx()).some((i) => i.key === "publish_due"));
  assert.ok(productIssues(base({ pub: { every_days: null, every: 30, last: null, by: null, times: 0, next_due: null } }), ctx()).some((i) => i.key === "never_published"));
  const hidden = productIssues(base({ active: false, pub: { every_days: 1, every: 1, last: null, by: null, times: 0, next_due: "2026-11-01" } }), ctx()).map((i) => i.key);
  assert.ok(!hidden.includes("publish_due") && hidden.includes("hidden_with_stock"));
});

test("nombres repetidos sin importar tildes ni mayúsculas", () => {
  const d = duplicateNames([{ name: "Muñeca Bebé" }, { name: "muñeca  bebe" }, { name: "Carro" }]);
  assert.equal(d.size, 1);
  assert.ok(productIssues(base({ name: "MUÑECA BEBÉ" }), ctx({ duplicates: d })).some((i) => i.key === "duplicate_name"));
});

test("textos de publicación y fechas", () => {
  const pub = (next_due: string | null, last: string | null = "2026-11-01T00:00:00Z") => ({ every_days: 7, every: 7, last, by: null, times: 1, next_due });
  assert.equal(publishStatusText(pub("2026-11-09"), "2026-11-09").text, "¡Toca hoy!");
  assert.equal(publishStatusText(pub("2026-11-06"), "2026-11-09").text, "Atrasado 3 días");
  assert.equal(publishStatusText(pub("2026-11-13"), "2026-11-09").text, "En 4 días");
  assert.equal(publishStatusText(pub(null), "2026-11-09").tone, "off");
  assert.equal(publishStatusText(pub(null, null), "2026-11-09").tone, "never");
  assert.equal(ddmmyyyy("2026-10-01"), "01/10/2026");
  assert.equal(ddmmyyyy("2026-10-01T03:00:00Z"), "30/09/2026");
  assert.equal(agoDays(39), "hace 39 días");
  assert.equal(agoDays(1), "ayer");
});

test("foto repetida, foto mala, margen bajo y nombre largo", () => {
  const imgs = duplicateImages([{ image: "a.png" }, { image: "a.png" }, { image: "b.png" }]);
  const keys = (over: Partial<RadarProduct>, c = {}) => productIssues(base(over), ctx(c)).map((i) => i.key);
  assert.ok(keys({ image: "a.png" }, { duplicateImages: imgs }).includes("photo_repeated"));
  assert.ok(keys({ image: "b.png" }, { photoChecks: new Map([["b.png", "small"]]) }).includes("photo_bad"));
  assert.ok(keys({ prices: [42000, 0, 0, 0, 0] }).includes("low_margin"));
  assert.ok(!keys({ prices: [30000, 0, 0, 0, 0] }).includes("low_margin"), "bajo el costo no es además margen bajo");
  assert.ok(keys({ name: "x".repeat(95) }).includes("long_name"));
});

test("valor quieto y sugerencia de traslado", () => {
  assert.deepEqual(stockValue(base({ stock: 10 }), true), { value: 400000, basis: "cost" });
  assert.deepEqual(stockValue(base({ stock: 10 }), false), { value: 630000, basis: "price" });
  const p = base({ by_point: [{ id: "Z", qty: 10, sold_30: 0 }, { id: "C", qty: 1, sold_30: 6 }] });
  assert.deepEqual(transferHint(p, null), { pointId: "C", sold: 6, from: "Z", fromQty: 10 });
  assert.equal(transferHint(p, "C"), null, "en Cisneros sí se vende");
});

test("plan del día: lo atrasado primero y lo publicado hoy cuenta", () => {
  const rows = [
    base({ id: "hoy", pub: { every_days: 1, every: 1, last: "2026-11-09T14:00:00Z", by: null, times: 1, next_due: "2026-11-10" } }),
    base({ id: "atrasado", pub: { every_days: 7, every: 7, last: "2026-10-20T00:00:00Z", by: null, times: 1, next_due: "2026-10-27" } }),
    base({ id: "toca", pub: { every_days: 7, every: 7, last: "2026-11-02T00:00:00Z", by: null, times: 1, next_due: "2026-11-09" } }),
    base({ id: "nunca", pub: { every_days: null, every: 30, last: null, by: null, times: 0, next_due: null } }),
    base({ id: "aldia" }),
    base({ id: "agotado", stock: 0, pub: { every_days: 1, every: 1, last: null, by: null, times: 0, next_due: "2026-11-09" } }),
  ];
  const plan = planToday(rows, "2026-11-09", 3, (r) => productIssues(r, ctx()).map((i) => i.key));
  assert.deepEqual(plan.done.map((r) => r.id), ["hoy"]);
  assert.deepEqual(plan.todo.map((r) => r.id), ["atrasado", "toca"]);
  assert.equal(plan.fresh, 1, "«nunca» es la única sugerencia sin recordatorio");
});

test("plan del día: «Ver otros» cambia las sugerencias pero deja lo que toca", () => {
  const rows = [
    base({ id: "toca", pub: { every_days: 1, every: 1, last: "2026-11-08T14:00:00Z", by: null, times: 3, next_due: "2026-11-09" } }),
    base({ id: "nunca1", stock: 90, pub: { every_days: null, every: 30, last: null, by: null, times: 0, next_due: null } }),
    base({ id: "nunca2", stock: 50, pub: { every_days: null, every: 30, last: null, by: null, times: 0, next_due: null } }),
    base({ id: "nunca3", stock: 10, pub: { every_days: null, every: 30, last: null, by: null, times: 0, next_due: null } }),
  ];
  const issues = (r: RadarProduct) => productIssues(r, ctx()).map((i) => i.key);
  const first = planToday(rows, "2026-11-09", 2, issues);
  assert.deepEqual(first.todo.map((r) => r.id), ["toca", "nunca1"]);
  assert.equal(first.fresh, 3);
  const next = planToday(rows, "2026-11-09", 2, issues, new Set(["nunca1", "toca"]));
  assert.deepEqual(next.todo.map((r) => r.id), ["toca", "nunca2"], "lo que toca por recordatorio no se salta");
  assert.equal(next.fresh, 2);
});
