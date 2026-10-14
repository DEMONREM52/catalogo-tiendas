import { test } from "node:test";
import assert from "node:assert/strict";
import { distribute, marginOnSale, markupOnCost, pctOf, priceFromCost, roundCommercial, saleLine, toCents } from "@/lib/profit/engine";

const $ = toCents;

test("1 · encadenado: costo $15.000, madre 5 %, punto 15 % → $18.112,50", () => {
  const r = priceFromCost({ cost: $(15000), motherPct: 5, pointPct: 15, mode: "chained" });
  assert.ok(r.ok);
  assert.equal(r.refPrice, $(15750));
  assert.equal(r.unrounded, $(18112.5));
  assert.equal(r.finalPrice, $(18112.5));
  assert.equal(r.components.find((c) => c.key === "mother")?.amount, $(750));
  assert.equal(r.components.find((c) => c.key === "point")?.amount, $(2362.5));
});

test("2 · independiente: costo $15.000, madre 5 %, punto 15 % → $18.000", () => {
  const r = priceFromCost({ cost: $(15000), motherPct: 5, pointPct: 15, mode: "independent" });
  assert.equal(r.finalPrice, $(18000));
  assert.equal(r.components.find((c) => c.key === "mother")?.amount, $(750));
  assert.equal(r.components.find((c) => c.key === "point")?.amount, $(2250));
});

test("3 · ambos en cero: el precio es el costo, sin incrementos", () => {
  const r = priceFromCost({ cost: $(15000), motherPct: 0, pointPct: 0, mode: "chained", allowBelowCost: false });
  assert.ok(r.ok);
  assert.equal(r.finalPrice, $(15000));
  assert.equal(r.profit, 0);
  const z = priceFromCost({ cost: $(15000), motherPct: 5, pointPct: 40, mode: "zero" });
  assert.equal(z.finalPrice, $(15750), "modo cero no recupera porcentajes anteriores del punto");
});

test("4 · incremento 20 % y margen ≈ 16,67 % no se confunden", () => {
  assert.equal(markupOnCost($(18000), $(15000)), 20);
  assert.equal(Number(marginOnSale($(18000), $(15000))!.toFixed(2)), 16.67);
});

test("5 · 60/40 de $3.000 suma exacto", () => {
  const d = distribute($(3000), [{ id: "madre", pct: 60 }, { id: "punto", pct: 40 }]);
  assert.deepEqual(d.parts.map((p) => p.amount), [$(1800), $(1200)]);
  assert.equal(d.unassigned, 0);
});

test("6 · 50/50 del componente del punto ($2.250) → $1.125 cada uno", () => {
  const d = distribute($(2250), [{ id: "a", pct: 50 }, { id: "b", pct: 50 }]);
  assert.deepEqual(d.parts.map((p) => p.amount), [$(1125), $(1125)]);
});

test("7 · por debajo del costo: se bloquea sin autorización y avisa con autorización", () => {
  const no = priceFromCost({ cost: $(15000), motherPct: 0, mode: "manual", price: $(14000) });
  assert.equal(no.ok, false);
  assert.ok(no.warnings.some((w) => w.code === "BELOW_COST"));
  const si = priceFromCost({ cost: $(15000), motherPct: 0, mode: "manual", price: $(14000), allowBelowCost: true });
  assert.ok(si.ok);
  assert.equal(si.profit, -$(1000));
});

test("8 · el descuento reduce el ingreso neto y la utilidad, no el precio calculado", () => {
  const l = saleLine({ unitPrice: $(18000), qty: 2, discount: $(2000), unitCost: $(15000) });
  assert.equal(l.gross, $(36000));
  assert.equal(l.net, $(34000));
  assert.equal(l.profit, $(4000));
  const tope = saleLine({ unitPrice: $(1000), qty: 1, discount: $(5000), unitCost: 0 });
  assert.equal(tope.net, 0, "un descuento no puede dejar el ingreso negativo");
});

test("23 · redondeo de varios beneficiarios: siempre suma el total", () => {
  for (const total of [1, 2, 99, 100, 101, 333333, 1000001]) {
    const d = distribute(total, [{ id: "a", pct: 33.3333 }, { id: "b", pct: 33.3333 }, { id: "c", pct: 33.3334 }]);
    assert.equal(d.parts.reduce((s, p) => s + p.amount, 0) + d.unassigned, total);
    assert.equal(d.unassigned, 0);
  }
  const parcial = distribute($(1000), [{ id: "a", pct: 40 }]);
  assert.equal(parcial.parts[0].amount, $(400));
  assert.equal(parcial.unassigned, $(600), "lo no asignado queda visible, no se pierde");
});

test("24 · costo cero: no inventa un porcentaje infinito", () => {
  const r = priceFromCost({ cost: 0, motherPct: 5, pointPct: 15, mode: "chained" });
  assert.ok(r.ok);
  assert.equal(r.markupPct, null);
  assert.ok(r.warnings.some((w) => w.code === "COST_ZERO"));
});

test("25 · ingreso cero o negativo: el margen no se calcula", () => {
  assert.equal(marginOnSale(0, $(100)), null);
  assert.equal(marginOnSale(-$(100), $(100)), null);
});

test("26 · porcentajes negativos o fuera de límites se rechazan", () => {
  assert.equal(priceFromCost({ cost: $(100), motherPct: -5, mode: "inherit" }).ok, false);
  assert.equal(priceFromCost({ cost: $(100), motherPct: 5, pointPct: 5000, mode: "chained" }).ok, false);
  assert.equal(distribute($(100), [{ id: "a", pct: 70 }, { id: "b", pct: 40 }]).ok, false, "más del 100 % se bloquea");
  assert.equal(distribute($(100), [{ id: "a", pct: -1 }]).ok, false);
});

test("redondeo comercial: componente aparte y exacto", () => {
  assert.equal(roundCommercial($(18112.5), 100), $(18100));
  assert.equal(roundCommercial($(18112.5), 100, "up"), $(18200));
  assert.equal(roundCommercial($(18150), 100), $(18200));
  const r = priceFromCost({ cost: $(15000), motherPct: 5, pointPct: 15, mode: "chained", rounding: { step: 100, dir: "up" } });
  assert.equal(r.finalPrice, $(18200));
  assert.equal(r.components.find((c) => c.key === "rounding")?.amount, $(87.5));
  assert.equal(r.components.find((c) => c.key === "point")?.amount, $(2362.5), "el redondeo no altera la parte del punto");
  assert.equal(r.components.reduce((s, c) => s + c.amount, 0), r.finalPrice, "costo + madre + punto + redondeo = precio");
});

test("margen objetivo y porcentajes con decimales", () => {
  const r = priceFromCost({ cost: $(15000), motherPct: 0, mode: "target_margin", targetMarginPct: 25 });
  assert.equal(r.finalPrice, $(20000));
  assert.equal(r.marginPct, 25);
  assert.equal(pctOf($(15000), 12.3456), $(1851.84));
  assert.equal(pctOf(5, 50), 3, "medio centavo redondea hacia arriba");
});

test("precio del punto: igual que en la base de datos", async () => {
  const { pointPrice } = await import("@/lib/profit/engine");
  assert.equal(pointPrice($(15750), { kind: "pct", value: 15 }), $(18112.5));
  assert.equal(pointPrice($(15750), { kind: "pct", value: 15 }, 100, "up"), $(18200));
  assert.equal(pointPrice($(15750), { kind: "pct", value: 20 }), $(18900));
  assert.equal(pointPrice($(20000), { kind: "fixed", value: 21000 }), $(21000));
  assert.equal(pointPrice($(20000), null), $(20000));
  assert.equal(pointPrice($(20000), { kind: "pct", value: -10 }), $(18000));
});
