/**
 * RemHub · Motor de precios y rentabilidad (único para toda la app: simulador, reglas, reportes y pruebas).
 *
 * Dinero: se calcula en CENTAVOS enteros con BigInt (sin errores de punto flotante).
 * Porcentajes: se aceptan hasta 4 decimales (ej. 15,1234 %) y se guardan escalados ×10.000.
 * Redondeo interno: al centavo, mitad hacia arriba. El redondeo comercial (al peso, a $50, $100…) es un
 * componente aparte y visible («redondeo»), nunca se esconde dentro de la parte de la madre o del punto.
 *
 * Definiciones (no se mezclan):
 *   · Incremento sobre el costo = (precio − costo) / costo × 100
 *   · Margen bruto sobre la venta = (ingreso neto − costo de lo vendido) / ingreso neto × 100
 */

export type Cents = number;

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const PCT_SCALE = BigInt(1000000); // 100 % = 1.000.000 (4 decimales)
export const MAX_MARKUP_PCT = 1000;

export const toCents = (pesos: number | string): Cents => {
  const n = typeof pesos === "string" ? Number(pesos) : pesos;
  if (!Number.isFinite(n)) throw new Error("Valor de dinero inválido");
  return Math.round(n * 100);
};
export const toPesos = (c: Cents) => c / 100;

function pctScaled(pct: number): bigint {
  if (!Number.isFinite(pct)) throw new Error("Porcentaje inválido");
  return BigInt(Math.round(pct * 10_000));
}

/** a × num / den redondeado mitad hacia arriba (para positivos y negativos, simétrico). */
function mulDivRound(a: bigint, num: bigint, den: bigint): bigint {
  const p = a * num;
  const neg = p < B0 !== den < B0;
  const ap = p < B0 ? -p : p;
  const ad = den < B0 ? -den : den;
  const q = (ap * B2 + ad) / (ad * B2);
  return neg ? -q : q;
}

/** Monto × porcentaje, al centavo. */
export function pctOf(amount: Cents, pct: number): Cents {
  return Number(mulDivRound(BigInt(amount), pctScaled(pct), PCT_SCALE));
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

/** Incremento sobre el costo (%). null si el costo es 0 (no se puede calcular, no es «infinito»). */
export function markupOnCost(price: Cents, cost: Cents): number | null {
  if (cost <= 0) return null;
  return ((price - cost) / cost) * 100;
}

/** Margen bruto sobre la venta (%). null si el ingreso neto es 0 o negativo (devoluciones netas). */
export function marginOnSale(netRevenue: Cents, cogs: Cents): number | null {
  if (netRevenue <= 0) return null;
  return ((netRevenue - cogs) / netRevenue) * 100;
}

// ---------------------------------------------------------------------------
// Redondeo comercial
// ---------------------------------------------------------------------------

export type RoundingStep = 0 | 1 | 50 | 100 | 500 | 1000; // en pesos; 0 = no redondear (deja centavos)
export type RoundingDir = "nearest" | "up" | "down";

export function roundCommercial(value: Cents, step: RoundingStep, dir: RoundingDir = "nearest"): Cents {
  if (!step) return value;
  const s = step * 100;
  const q = value / s;
  const r = dir === "up" ? Math.ceil(q - 1e-9) : dir === "down" ? Math.floor(q + 1e-9) : Math.floor(q + 0.5);
  return r * s;
}

// ---------------------------------------------------------------------------
// Precio desde el costo
// ---------------------------------------------------------------------------

export type PriceMode =
  | "chained" // A · el punto aplica su % sobre el precio de referencia de la madre
  | "independent" // B · madre y punto aplican su % sobre el costo
  | "manual" // C · precio final fijado por el punto
  | "target_margin" // D · margen objetivo sobre la venta
  | "fixed" // E · precio fijo
  | "inherit" // F · el punto usa el precio de referencia de la madre
  | "zero"; // G · sin incremento del punto

export type PriceInput = {
  cost: Cents;
  motherPct: number;
  pointPct?: number;
  mode: PriceMode;
  /** Para manual / fixed. */
  price?: Cents;
  /** Para target_margin (0 ≤ m < 100). */
  targetMarginPct?: number;
  rounding?: { step: RoundingStep; dir?: RoundingDir };
  /** No permitir vender por debajo del costo sin autorización. */
  allowBelowCost?: boolean;
};

export type Component = { key: "cost" | "mother" | "point" | "rounding"; label: string; amount: Cents; base?: string };
export type PriceWarning = { code: "BELOW_COST" | "COST_ZERO" | "NEGATIVE_POINT" | "ROUNDING_CHANGED"; message: string };

export type PriceResult = {
  ok: boolean;
  error?: string;
  /** Precio de referencia de la madre (costo + incremento de la madre). */
  refPrice: Cents;
  /** Antes del redondeo comercial. */
  unrounded: Cents;
  finalPrice: Cents;
  components: Component[];
  markupPct: number | null;
  marginPct: number | null;
  profit: Cents;
  warnings: PriceWarning[];
  explain: string[];
};

const fmt = (c: Cents) => "$" + (c / 100).toLocaleString("es-CO", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const fp = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 4 }) + " %";

function fail(error: string): PriceResult {
  return { ok: false, error, refPrice: 0, unrounded: 0, finalPrice: 0, components: [], markupPct: null, marginPct: null, profit: 0, warnings: [], explain: [] };
}

export function validatePct(pct: number, label: string, min = 0, max = MAX_MARKUP_PCT): string | null {
  if (!Number.isFinite(pct)) return `${label}: no es un número.`;
  if (pct < min) return `${label}: no puede ser menor que ${min} %.`;
  if (pct > max) return `${label}: no puede ser mayor que ${max} %.`;
  return null;
}

export function priceFromCost(input: PriceInput): PriceResult {
  const { cost, mode } = input;
  const motherPct = input.motherPct ?? 0;
  const pointPct = input.pointPct ?? 0;
  if (!Number.isInteger(cost) || cost < 0) return fail("El costo no puede ser negativo.");
  const e1 = validatePct(motherPct, "Incremento de la madre");
  if (e1) return fail(e1);
  if (mode === "chained" || mode === "independent") {
    const e2 = validatePct(pointPct, "Incremento del punto");
    if (e2) return fail(e2);
  }

  const explain: string[] = [];
  const warnings: PriceWarning[] = [];
  const motherAmt = pctOf(cost, motherPct);
  const refPrice = cost + motherAmt;
  explain.push(`Madre: ${fp(motherPct)} sobre el costo ${fmt(cost)} = ${fmt(motherAmt)} → precio de referencia ${fmt(refPrice)}.`);

  let unrounded: Cents;
  switch (mode) {
    case "chained": {
      const p = pctOf(refPrice, pointPct);
      unrounded = refPrice + p;
      explain.push(`Punto: ${fp(pointPct)} sobre el precio de referencia ${fmt(refPrice)} = ${fmt(p)} (encadenado).`);
      break;
    }
    case "independent": {
      const p = pctOf(cost, pointPct);
      unrounded = refPrice + p;
      explain.push(`Punto: ${fp(pointPct)} sobre el costo ${fmt(cost)} = ${fmt(p)} (independiente).`);
      break;
    }
    case "inherit":
    case "zero":
      unrounded = refPrice;
      explain.push(mode === "zero" ? "Punto: sin incremento (0 %)." : "Punto: usa el precio de referencia de la madre.");
      break;
    case "manual":
    case "fixed": {
      if (input.price === undefined || !Number.isInteger(input.price) || input.price < 0) return fail("Escribe un precio válido.");
      unrounded = input.price;
      explain.push(`${mode === "manual" ? "Precio manual del punto" : "Precio fijo"}: ${fmt(input.price)}.`);
      break;
    }
    case "target_margin": {
      const m = input.targetMarginPct ?? 0;
      const err = validatePct(m, "Margen objetivo", 0, 99.99);
      if (err) return fail(err);
      // precio = costo / (1 − m)
      unrounded = Number(mulDivRound(BigInt(cost), PCT_SCALE, PCT_SCALE - pctScaled(m)));
      if (unrounded < refPrice) explain.push("El margen objetivo da un precio menor que la referencia de la madre.");
      explain.push(`Margen objetivo ${fp(m)} sobre la venta → ${fmt(unrounded)}.`);
      break;
    }
    default:
      return fail("Modo de precio desconocido.");
  }

  const step = input.rounding?.step ?? 0;
  const finalPrice = roundCommercial(unrounded, step, input.rounding?.dir ?? "nearest");
  const roundingAmt = finalPrice - unrounded;
  if (roundingAmt) {
    explain.push(`Redondeo comercial a $${step.toLocaleString("es-CO")}: ${roundingAmt > 0 ? "+" : ""}${fmt(roundingAmt)} (componente aparte).`);
    warnings.push({ code: "ROUNDING_CHANGED", message: `El redondeo cambia el precio en ${fmt(roundingAmt)}.` });
  }

  const pointAmt = unrounded - refPrice;
  if (pointAmt < 0) warnings.push({ code: "NEGATIVE_POINT", message: `El precio del punto queda ${fmt(-pointAmt)} por debajo de la referencia de la madre.` });
  if (cost === 0) warnings.push({ code: "COST_ZERO", message: "El costo es $0: el incremento sobre el costo no se puede calcular. Revisa el costo del producto." });
  if (finalPrice < cost) {
    warnings.push({ code: "BELOW_COST", message: `El precio ${fmt(finalPrice)} es menor que el costo ${fmt(cost)}: pierdes ${fmt(cost - finalPrice)} por unidad.` });
    if (!input.allowBelowCost) return { ...fail("No se puede vender por debajo del costo sin autorización."), warnings, explain };
  }

  return {
    ok: true,
    refPrice,
    unrounded,
    finalPrice,
    components: [
      { key: "cost", label: "Costo", amount: cost },
      { key: "mother", label: "Incremento de la madre", amount: motherAmt, base: "costo" },
      { key: "point", label: "Incremento del punto", amount: pointAmt, base: mode === "chained" ? "precio de referencia" : mode === "independent" ? "costo" : mode },
      { key: "rounding", label: "Redondeo", amount: roundingAmt },
    ],
    markupPct: markupOnCost(finalPrice, cost),
    marginPct: marginOnSale(finalPrice, cost),
    profit: finalPrice - cost,
    warnings,
    explain,
  };
}

// ---------------------------------------------------------------------------
// Venta real: descuentos e impuestos separados del precio calculado
// ---------------------------------------------------------------------------

export function saleLine(input: { unitPrice: Cents; qty: number; discount?: Cents; unitCost: Cents }) {
  const gross = input.unitPrice * input.qty;
  const discount = Math.min(Math.max(0, input.discount ?? 0), gross);
  const net = gross - discount;
  const cogs = input.unitCost * input.qty;
  return { gross, discount, net, cogs, profit: net - cogs, markupPct: markupOnCost(net, cogs), marginPct: marginOnSale(net, cogs) };
}

// ---------------------------------------------------------------------------
// Distribución: las partes SIEMPRE suman exactamente el total (método del mayor residuo)
// ---------------------------------------------------------------------------

export type Share = { id: string; pct: number };
export type DistributionResult = { ok: boolean; error?: string; parts: Array<{ id: string; amount: Cents }>; unassigned: Cents };

export function distribute(total: Cents, shares: Share[]): DistributionResult {
  if (!Number.isInteger(total)) return { ok: false, error: "Total inválido.", parts: [], unassigned: 0 };
  for (const s of shares) {
    const e = validatePct(s.pct, `Participación de ${s.id}`, 0, 100);
    if (e) return { ok: false, error: e, parts: [], unassigned: 0 };
  }
  const sum = shares.reduce((a, s) => a + pctScaled(s.pct), B0);
  if (sum > PCT_SCALE) return { ok: false, error: "Las participaciones suman más del 100 %: no se puede repartir más de lo que hay.", parts: [], unassigned: 0 };
  if (total <= 0) return { ok: true, parts: shares.map((s) => ({ id: s.id, amount: 0 })), unassigned: total };

  const T = BigInt(total);
  const assigned = Number(mulDivRound(T, sum, PCT_SCALE));
  const raw = shares.map((s, i) => {
    const num = T * pctScaled(s.pct);
    return { i, id: s.id, floor: num / PCT_SCALE, rem: num % PCT_SCALE };
  });
  let left = BigInt(assigned) - raw.reduce((a, r) => a + r.floor, B0);
  const order = [...raw].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const extra = new Map<number, bigint>();
  for (const r of order) {
    if (left <= B0) break;
    extra.set(r.i, B1);
    left -= B1;
  }
  const parts = raw.map((r) => ({ id: r.id, amount: Number(r.floor + (extra.get(r.i) ?? B0)) }));
  return { ok: true, parts, unassigned: total - parts.reduce((a, p) => a + p.amount, 0) };
}

// ---------------------------------------------------------------------------
// Precio del punto sobre un precio de la madre (igual que erp__point_price en la base de datos)
// ---------------------------------------------------------------------------

export type PointRule = { kind: "pct" | "fixed" | "none"; value: number };

export function pointPrice(motherPrice: Cents, rule: PointRule | null, step: RoundingStep = 0, dir: RoundingDir = "nearest"): Cents {
  if (!rule || rule.kind === "none") return motherPrice;
  if (rule.kind === "fixed") return toCents(rule.value);
  return roundCommercial(motherPrice + pctOf(motherPrice, rule.value), step, dir);
}
