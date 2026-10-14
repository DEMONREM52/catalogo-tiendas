"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Calculator, Info, Plus, Search, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";
import { fetchProductCosts } from "@/lib/profit/costs";
import { distribute, marginOnSale, markupOnCost, priceFromCost, saleLine, toCents, type PriceMode, type PriceResult, type RoundingDir, type RoundingStep } from "@/lib/profit/engine";

type Product = { id: string; name: string; sku: string | null; cost_price: number | null; price_1: number | null; price_2: number | null; price_3: number | null; price_4: number | null; price_5: number | null };
type Point = { id: string; name: string };
type Beneficiary = { id: string; name: string; pct: number };
type Base = "profit" | "mother" | "point";

// Colores validados (daltonismo y contraste) para la composición del precio.
const C = { cost: "#8a8a85", mother: "#3987e5", point: "#d95926", rounding: "#199e70" };
const MODES: Array<{ key: PriceMode; label: string; hint: string }> = [
  { key: "chained", label: "Encadenado", hint: "El punto aplica su % sobre el precio de referencia de la madre" },
  { key: "independent", label: "Independiente", hint: "Madre y punto aplican su % sobre el costo" },
  { key: "target_margin", label: "Margen objetivo", hint: "Defines el % de margen sobre la venta" },
  { key: "manual", label: "Precio manual", hint: "El punto fija su precio final" },
  { key: "zero", label: "Sin incremento del punto", hint: "El punto vende al precio de referencia" },
];
const ROUNDING_OPTIONS: Array<[RoundingStep, RoundingDir]> = [[0, "nearest"], ...([1, 50, 100, 500, 1000] as RoundingStep[]).flatMap((s): Array<[RoundingStep, RoundingDir]> => [[s, "nearest"], [s, "up"]])];

const money = (c: number) => (c < 0 ? "−$" : "$") + (Math.abs(c) / 100).toLocaleString("es-CO", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const pct = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-CO", { maximumFractionDigits: 2 }) + " %");
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };

function NumField({ label, value, onChange, suffix, step = 0.5, min = 0, max = 1000, hint }: { label: string; value: number; onChange: (v: number) => void; suffix: string; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-bold" style={{ color: "var(--t-muted)" }}>{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <input type="number" inputMode="decimal" className="w-full min-w-0 bg-transparent text-base font-bold tabular-nums outline-none" value={Number.isFinite(value) ? value : ""} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
        <span className="text-sm font-bold" style={{ color: "var(--t-muted)" }}>{suffix}</span>
      </div>
      {hint ? <span className="mt-1 block text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
    </label>
  );
}

function Tile({ label, value, sub, tone, info }: { label: string; value: string; sub?: string; tone?: "bad" | "ok"; info: string }) {
  return (
    <div className="rounded-2xl border p-3" style={card} title={info}>
      <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
        {label} <Info size={11} aria-hidden />
      </p>
      <p className="mt-1 text-xl font-black tabular-nums" style={tone === "bad" ? { color: "#e66767" } : undefined}>{value}</p>
      {sub ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{sub}</p> : null}
      <p className="sr-only">{info}</p>
    </div>
  );
}

/** Composición del precio: barra apilada con etiquetas directas y leyenda (nunca solo color). */
function PriceBar({ r }: { r: PriceResult }) {
  const segs = r.components.filter((c) => c.amount > 0).map((c) => ({ ...c, color: C[c.key] }));
  const total = segs.reduce((s, c) => s + c.amount, 0) || 1;
  return (
    <div>
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={`Precio ${money(r.finalPrice)}: ${segs.map((s) => `${s.label} ${money(s.amount)}`).join(", ")}`}>
        {segs.map((s) => (
          <motion.div key={s.key} layout title={`${s.label}: ${money(s.amount)} (${pct((s.amount / total) * 100)})`} className="relative h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ background: s.color, flexGrow: s.amount, flexBasis: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {r.components.map((c) => (
          <li key={c.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: C[c.key] }} aria-hidden />
            <span style={{ color: "var(--t-muted)" }}>{c.label}</span>
            <b className="tabular-nums">{money(c.amount)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Simulador: prueba precios y repartos sin cambiar nada en la base de datos. */
export function Simulator({ storeId }: { storeId: string }) {
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [q, setQ] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [manualCost, setManualCost] = useState(15000);
  const [pointId, setPointId] = useState("");
  const [motherPct, setMotherPct] = useState(5);
  const [pointPct, setPointPct] = useState(15);
  const [mode, setMode] = useState<PriceMode>("chained");
  const [manualPrice, setManualPrice] = useState(18000);
  const [target, setTarget] = useState(25);
  const [step, setStep] = useState<RoundingStep>(0);
  const [dir, setDir] = useState<RoundingDir>("nearest");
  const [discountPct, setDiscountPct] = useState(0);
  const [allowBelow, setAllowBelow] = useState(false);
  const [level, setLevel] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [base, setBase] = useState<Base>("profit");
  const [people, setPeople] = useState<Beneficiary[]>([
    { id: "madre", name: "Tienda madre", pct: 60 },
    { id: "punto", name: "Punto", pct: 40 },
  ]);

  useEffect(() => {
    void (async () => {
      const sb = supabaseBrowser();
      const rows: Product[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await sb.from("products").select("id,name,sku,price_1,price_2,price_3,price_4,price_5").eq("store_id", storeId).eq("active", true).order("name").range(from, from + 999);
        if (error || !data) break;
        rows.push(...(data as Product[]));
        if (data.length < 1000) break;
      }
      const costs = await fetchProductCosts(storeId, rows.map((r) => r.id)).catch(() => null);
      for (const r of rows) r.cost_price = costs?.get(r.id) ?? 0;
      const { data: wh } = await sb.from("erp_warehouses").select("id,name").eq("store_id", storeId).eq("active", true).order("name");
      setProducts(rows);
      setPoints((wh ?? []) as Point[]);
      setReady(true);
    })();
  }, [storeId]);

  const product = products.find((p) => p.id === productId) ?? null;
  const found = useMemo(() => (q.trim() ? smartFilter(products, q, (p) => `${p.name} ${p.sku ?? ""}`).slice(0, 8) : []), [products, q]);
  const cost = toCents(product ? Number(product.cost_price ?? 0) : manualCost);
  const current = product ? toCents(Number(product[`price_${level}`] ?? 0)) : null;

  const input = { cost, motherPct, pointPct, mode, price: toCents(manualPrice), targetMarginPct: target, rounding: { step, dir }, allowBelowCost: allowBelow };
  const r = priceFromCost(input);
  const alt = priceFromCost({ ...input, mode: mode === "chained" ? "independent" : "chained" });
  const line = saleLine({ unitPrice: r.finalPrice, qty: 1, discount: Math.round((r.finalPrice * discountPct) / 100), unitCost: cost });

  const motherAmt = r.components.find((c) => c.key === "mother")?.amount ?? 0;
  const pointAmt = (r.components.find((c) => c.key === "point")?.amount ?? 0) + (r.components.find((c) => c.key === "rounding")?.amount ?? 0);
  // El descuento sale de la utilidad: la bolsa es la utilidad real después del descuento.
  const pool = base === "profit" ? line.profit : base === "mother" ? motherAmt : pointAmt;
  const dist = distribute(Math.max(0, pool), people.map((p) => ({ id: p.id, pct: p.pct })));

  if (!ready) return <main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</main>;
  const scenarios = [
    ...(current !== null ? [{ key: "now", label: `Actual (precio ${level})`, price: current, profit: current - cost }] : []),
    { key: "new", label: `Propuesto · ${MODES.find((m) => m.key === mode)?.label}`, price: r.ok ? r.finalPrice : NaN, profit: r.ok ? r.profit : NaN },
    ...(mode === "chained" || mode === "independent" ? [{ key: "alt", label: `Alternativo · ${mode === "chained" ? "Independiente" : "Encadenado"}`, price: alt.ok ? alt.finalPrice : NaN, profit: alt.ok ? alt.profit : NaN }] : []),
  ];

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm" style={card}>
        <Calculator size={16} className="shrink-0" />
        <span>Prueba precios, porcentajes y repartos. <b>No cambia</b> precios, ventas ni inventario.</span>
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ------- Entradas ------- */}
        <section className="space-y-4">
          <div className="rounded-2xl border p-4" style={card}>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>1 · Producto y costo</p>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input className="w-full rounded-xl border py-2 pr-3 text-sm outline-none" style={{ paddingLeft: "2.1rem", borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${products.length} productos por nombre o código…`} />
            </div>
            {found.length ? (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {found.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => { setProductId(p.id); setQ(""); }} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                      <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                      <span className="text-xs tabular-nums" style={{ color: "var(--t-muted)" }}>costo {money(toCents(Number(p.cost_price ?? 0)))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {product ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
                <b className="w-full truncate sm:w-auto sm:min-w-0 sm:flex-1">{product.name}</b>
                <span className="tabular-nums">Costo promedio {money(cost)}</span>
                <button type="button" onClick={() => setProductId(null)} className="text-xs font-bold underline">Usar costo manual</button>
              </div>
            ) : (
              <div className="mt-3"><NumField label="Costo (manual)" value={manualCost} onChange={setManualCost} suffix="COP" step={100} max={1e12} /></div>
            )}
            {product ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span style={{ color: "var(--t-muted)" }}>Comparar con:</span>
                {([1, 2, 3, 4, 5] as const).map((l) => (
                  <button key={l} type="button" onClick={() => setLevel(l)} className="rounded-full px-2.5 py-1 font-bold" style={level === l ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>
                    Precio {l} · {money(toCents(Number(product[`price_${l}`] ?? 0)))}
                  </button>
                ))}
              </div>
            ) : null}
            {points.length ? (
              <label className="mt-3 block text-xs font-bold" style={{ color: "var(--t-muted)" }}>
                Punto
                <select value={pointId} onChange={(e) => setPointId(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
                  <option value="">Cualquier punto (simulación general)</option>
                  {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>

          <div className="space-y-3 rounded-2xl border p-4" style={card}>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>2 · Cómo se calcula el precio</p>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button key={m.key} type="button" title={m.hint} onClick={() => setMode(m.key)} className="rounded-full px-3 py-1.5 text-xs font-bold transition" style={mode === m.key ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)", color: "var(--t-muted)" }}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{MODES.find((m) => m.key === mode)?.hint}.</p>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Incremento de la madre" value={motherPct} onChange={setMotherPct} suffix="%" hint="Sobre el costo" />
              {mode === "chained" || mode === "independent" ? (
                <NumField label="Incremento del punto" value={pointPct} onChange={setPointPct} suffix="%" hint={mode === "chained" ? "Sobre el precio de referencia" : "Sobre el costo"} />
              ) : mode === "manual" ? (
                <NumField label="Precio del punto" value={manualPrice} onChange={setManualPrice} suffix="COP" step={100} max={1e12} />
              ) : mode === "target_margin" ? (
                <NumField label="Margen objetivo" value={target} onChange={setTarget} suffix="%" max={99.99} hint="Sobre el precio de venta" />
              ) : <div />}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold" style={{ color: "var(--t-muted)" }}>
                Redondeo comercial
                <select value={`${step}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); setStep(Number(s) as RoundingStep); setDir(d as RoundingDir); }} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
                  {ROUNDING_OPTIONS.map(([s, d]) => (
                    <option key={`${s}:${d}`} value={`${s}:${d}`}>{s === 0 ? "Sin redondeo" : `A $${s.toLocaleString("es-CO")} ${d === "up" ? "hacia arriba" : "más cercano"}`}</option>
                  ))}
                </select>
              </label>
              <NumField label="Descuento esperado" value={discountPct} onChange={setDiscountPct} suffix="%" max={100} hint="Reduce la venta neta, no el precio" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allowBelow} onChange={(e) => setAllowBelow(e.target.checked)} className="h-4 w-4 accent-violet-500" />
              Permitir simular por debajo del costo (requiere autorización en la vida real)
            </label>
          </div>
        </section>

        {/* ------- Resultados ------- */}
        <section className="space-y-4">
          <div className="rounded-2xl border p-4" style={card}>
            {r.ok ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Precio resultante{pointId ? ` · ${points.find((p) => p.id === pointId)?.name}` : ""}</p>
                <motion.p key={r.finalPrice} initial={{ scale: 0.97, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 text-4xl font-black tabular-nums">{money(r.finalPrice)}</motion.p>
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>Referencia de la madre {money(r.refPrice)}{r.unrounded !== r.finalPrice ? ` · antes de redondear ${money(r.unrounded)}` : ""}</p>
                <div className="mt-4"><PriceBar r={r} /></div>
              </>
            ) : (
              <p className="flex items-start gap-2 text-sm font-semibold" style={{ color: "#e66767" }}><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {r.error}</p>
            )}
            {r.warnings.filter((w) => w.code !== "ROUNDING_CHANGED").map((w) => (
              <p key={w.code} className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" /> {w.message}</p>
            ))}
          </div>

          {r.ok ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Ganancia / und." value={money(line.profit)} sub={discountPct ? `con ${pct(discountPct)} de descuento` : "venta neta − costo"} tone={line.profit < 0 ? "bad" : undefined} info="Ganancia bruta = venta neta (después de descuentos) − costo." />
              <Tile label="Incremento sobre costo" value={pct(markupOnCost(line.net, cost))} sub="(precio − costo) ÷ costo" info="Cuánto por encima del costo vendes. Con costo $0 no se puede calcular." />
              <Tile label="Margen sobre venta" value={pct(marginOnSale(line.net, line.cogs))} sub="(venta − costo) ÷ venta" tone={line.profit < 0 ? "bad" : undefined} info="Qué parte de cada peso vendido es ganancia. Siempre es menor que el incremento." />
              <Tile label="Venta neta" value={money(line.net)} sub={line.discount ? `descuento ${money(line.discount)}` : "sin descuento"} info="Precio menos descuentos (antes de impuestos)." />
            </div>
          ) : null}

          {r.ok ? (
            <div className="rounded-2xl border p-4" style={card}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Por qué da este precio</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {r.explain.map((e, i) => <li key={i}>{e}</li>)}
              </ol>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border" style={card}>
            <p className="px-4 pt-4 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Comparar escenarios (por unidad, sin descuento)</p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}>
                    <th className="px-4 py-2 font-semibold">Escenario</th>
                    <th className="px-2 py-2 text-right font-semibold">Precio</th>
                    <th className="px-2 py-2 text-right font-semibold">Ganancia</th>
                    <th className="px-2 py-2 text-right font-semibold">Incremento</th>
                    <th className="px-4 py-2 text-right font-semibold">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.key} className="border-t" style={{ borderColor: "var(--t-card-border)", fontWeight: s.key === "new" ? 800 : 500 }}>
                      <td className="px-4 py-2">{s.label}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{Number.isNaN(s.price) ? "—" : money(s.price)}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={s.profit < 0 ? { color: "#e66767" } : undefined}>{Number.isNaN(s.profit) ? "—" : money(s.profit)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{Number.isNaN(s.price) ? "—" : pct(markupOnCost(s.price, cost))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{Number.isNaN(s.price) ? "—" : pct(marginOnSale(s.price, cost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {current !== null && r.ok ? (
              <p className="px-4 pb-4 pt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                Frente al precio {level} actual: {r.finalPrice >= current ? "+" : "−"}{money(Math.abs(r.finalPrice - current))} por unidad.
              </p>
            ) : <div className="pb-2" />}
          </div>

          {r.ok ? (
            <div className="space-y-3 rounded-2xl border p-4" style={card}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Reparto de la ganancia (simulación)</p>
              <div className="flex flex-wrap gap-1.5 text-xs font-bold">
                {([["profit", `Utilidad total · ${money(Math.max(0, line.profit))}`], ["mother", `Parte de la madre · ${money(motherAmt)}`], ["point", `Parte del punto · ${money(pointAmt)}`]] as Array<[Base, string]>).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setBase(k)} className="rounded-full px-3 py-1.5" style={base === k ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)", color: "var(--t-muted)" }}>{l}</button>
                ))}
              </div>
              <ul className="space-y-1.5">
                {people.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <input value={p.name} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Beneficiario" />
                    <div className="flex w-20 shrink-0 items-center rounded-lg border px-2" style={{ borderColor: "var(--t-card-border)" }}>
                      <input type="number" inputMode="decimal" value={p.pct} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))} className="w-full bg-transparent py-1.5 text-right text-sm font-bold tabular-nums outline-none" aria-label={`Porcentaje de ${p.name}`} />
                      <span className="text-xs">%</span>
                    </div>
                    <b className="w-[5.5rem] shrink-0 text-right text-xs tabular-nums sm:w-24 sm:text-sm">{dist.ok ? money(dist.parts[i]?.amount ?? 0) : "—"}</b>
                    <button type="button" onClick={() => setPeople(people.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label={`Quitar ${p.name}`}><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setPeople([...people, { id: crypto.randomUUID(), name: "Socio", pct: 0 }])} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Plus size={13} /> Beneficiario</button>
                <span className="flex-1 text-right text-xs" style={{ color: dist.ok ? "var(--t-muted)" : "#e66767" }}>
                  {dist.ok ? (dist.unassigned ? `Sin asignar: ${money(dist.unassigned)}` : "✓ Reparto completo, suma exacta") : dist.error}
                </span>
              </div>
            </div>
          ) : null}
        </section>
      </div>
      <p className="text-center text-xs" style={{ color: "var(--t-muted)" }}>El costo es el costo promedio ponderado actual del producto (se recalcula con cada compra). Todos los cálculos se hacen al centavo.</p>
    </div>
  );
}
