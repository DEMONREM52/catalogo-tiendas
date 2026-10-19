"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import Link from "next/link";
import { Lock, Percent, Receipt, Settings2, Sparkles, Warehouse } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LastPurchases } from "./LastPurchases";
import { ChoiceChips, NumberField } from "@/components/forms/Fields";
import { pctOf, roundCommercial, toCents, type RoundingDir, type RoundingStep } from "@/lib/profit/engine";

export type Markups = [number | null, number | null, number | null, number | null, number | null];
/** cost_basis: los precios por % salen del último costo de compra (por defecto) o del costo promedio. */
type Pricing = { round_step: RoundingStep; round_dir: RoundingDir; default_markup: number; can_edit: boolean; cost_basis?: "last" | "average" };
type LastCost = { last_cost: number | null; last_cost_at: string | null; avg_cost: number | null };
type Preview = { basis: string; changes: number; up: number; down: number; sample: Array<{ name: string; old_price: number; new_price: number }> };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
type StockRow = { warehouse_id: string; name: string; kind: string; qty: number; updated_at: string | null };

const LEVELS = ["Precio 1 · mínimo", "Precio 2 · mayor", "Precio 3 · detal", "Precio 4", "Precio 5"];
const cop = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };

/** Precio de un nivel: costo × (1 + %) redondeado (igual que la base de datos). */
export function priceFromMarkup(cost: number, markup: number | null, step: RoundingStep, dir: RoundingDir) {
  if (!cost || markup === null) return null;
  const c = toCents(cost);
  // Igual que la base: primero al peso y luego al paso de redondeo (así un precio escrito queda exacto).
  const peso = Math.round((c + pctOf(c, markup)) / 100) * 100;
  return roundCommercial(peso, step, dir) / 100;
}

/** Usa el % por defecto de la tienda (para productos nuevos). */
export async function loadDefaultMarkup(storeId: string): Promise<number> {
  const { data } = await supabaseBrowser().rpc("erp_product_pricing_get", { p_store: storeId });
  return Number((data as Pricing | null)?.default_markup ?? 15);
}

/**
 * Precios por porcentaje de ganancia (y, al editar, costo y existencias SOLO de lectura).
 * El costo y las unidades solo cambian con ingreso de factura, ajustes o traslados.
 */
export function PricingPanel({ storeId, productId, cost: avgCost, costKnown, prices, markups, onChange, isNew }: {
  storeId: string; productId: string | null; cost: number; costKnown: boolean; prices: number[]; markups: Markups; onChange: (m: Markups) => void; isNew?: boolean;
}) {
  const [cfg, setCfg] = useState<Pricing | null>(null);
  const [lastInfo, setLastInfo] = useState<LastCost | null>(null);
  const [repricing, setRepricing] = useState(false);
  // Costo con el que se calculan los precios: el último de compra (regla de la tienda) o el promedio.
  const basis = cfg?.cost_basis ?? "last";
  const lastCost = Number(lastInfo?.last_cost ?? 0);
  const cost = basis === "last" && lastCost > 0 ? lastCost : avgCost;
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const legacy = markups.every((m) => m === null);
  const allSame = markups.every((m) => m === markups[0]);
  const [same, setSame] = useState(allSame);
  const step = cfg?.round_step ?? 100;
  const dir = cfg?.round_dir ?? "nearest";

  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_product_pricing_get", { p_store: storeId }).then(({ data }) => alive && data && setCfg(data as Pricing));
    if (productId) void supabaseBrowser().rpc("erp_product_stock_by_point", { p_product: productId }).then(({ data, error }) => alive && setStock(error ? [] : ((data ?? []) as StockRow[])));
    // Último costo de compra (sin la migración 20261206 o sin permiso de costos, se usa el promedio).
    if (productId) void supabaseBrowser().rpc("erp_product_last_costs", { p_store: storeId, p_ids: [productId] }).then(({ data, error }) => {
      if (alive && !error && Array.isArray(data) && data[0]) setLastInfo(data[0] as LastCost);
    });
    return () => { alive = false; };
  }, [storeId, productId]);

  const total = useMemo(() => (stock ?? []).reduce((s, r) => s + r.qty, 0), [stock]);
  const setAll = (v: number | null) => onChange([v, v, v, v, v]);
  const setOne = (i: number, v: number | null) => { const m = [...markups] as Markups; m[i] = v; onChange(m); };
  const [priceWarn, setPriceWarn] = useState<string | null>(null);
  /** Escribiste el precio: se calcula el % exacto sobre el costo (4 decimales). */
  const setPrice = (i: number, price: number) => {
    if (!(cost > 0) || !(price > 0)) return;
    if (price < cost) return setPriceWarn(`${LEVELS[i]}: ${cop(price)} está por debajo del costo (${cop(cost)}). Súbelo o revisa el costo.`);
    setPriceWarn(null);
    const pct = Math.min(1000, Math.round(((price / cost) - 1) * 100 * 10000) / 10000);
    if (same) setSame(false);
    setOne(i, pct);
  };
  const implied = (i: number) => (cost > 0 && prices[i] > 0 ? Math.round(((prices[i] - cost) / cost) * 10000) / 100 : null);

  /** Cambia la regla (último costo / promedio) y muestra cuántos precios cambian antes de recalcularlos todos. */
  async function reprice(nextBasis: "last" | "average") {
    const sb = supabaseBrowser();
    setRepricing(true);
    try {
      // Primero se guarda la regla sin tocar precios, para ver qué cambiaría.
      const saved = await sb.rpc("erp_reprice_apply", { p_store: storeId, p_basis: nextBasis, p_apply: false });
      if (saved.error) throw saved.error;
      setCfg((c) => (c ? { ...c, cost_basis: nextBasis } : c));
      const { data, error } = await sb.rpc("erp_reprice_preview", { p_store: storeId });
      if (error) throw error;
      const pv = data as Preview;
      if (!pv.changes) {
        await Swal.fire({ icon: "success", title: "Todo al día", text: "Ningún precio cambia con esta regla.", background: "var(--t-bg-base)", color: "var(--t-text)" });
        return;
      }
      const esc = (t: string) => t.replace(/[<>&"]/g, "");
      const rows = pv.sample.slice(0, 8).map((s) => `<li>${esc(s.name)}: <s>${cop(Number(s.old_price))}</s> → <b>${cop(Number(s.new_price))}</b></li>`).join("");
      const more = pv.changes > 8 ? `<p style="opacity:.7;font-size:12px">…y ${pv.changes - 8} más.</p>` : "";
      const ok = await Swal.fire({
        icon: "question",
        title: `Cambian ${pv.changes} precio${pv.changes === 1 ? "" : "s"}`,
        html: `<p>${pv.down} bajan y ${pv.up} suben al calcular con el <b>${nextBasis === "last" ? "último costo" : "costo promedio"}</b>.</p><ul style="text-align:left;margin-top:10px;font-size:13px">${rows}</ul>${more}`,
        showCancelButton: true,
        confirmButtonText: "Recalcular todos",
        cancelButtonText: "Ahora no",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
      if (!ok.isConfirmed) return;
      const applied = await sb.rpc("erp_reprice_apply", { p_store: storeId, p_basis: nextBasis, p_apply: true });
      if (applied.error) throw applied.error;
      await Swal.fire({ icon: "success", title: "Precios recalculados", text: "Recarga la página para ver los precios nuevos de este producto.", timer: 2200, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
    } catch (e) {
      const m = (e as Error)?.message ?? String(e);
      await Swal.fire({ icon: "error", title: "No se pudo", text: /reprice|Could not find|schema cache/i.test(m) ? "Falta correr en Supabase la migración 20261206_precio_ultimo_costo.sql." : m, background: "var(--t-bg-base)", color: "var(--t-text)" });
    } finally {
      setRepricing(false);
    }
  }

  async function saveCfg(patch: Partial<Pricing>) {
    const next = { ...(cfg ?? { round_step: 100, round_dir: "nearest", default_markup: 15, can_edit: true }), ...patch } as Pricing;
    setCfg(next);
    await supabaseBrowser().rpc("erp_product_pricing_save", { p_store: storeId, p_round_step: next.round_step, p_round_dir: next.round_dir, p_default_markup: next.default_markup });
  }

  return (
    <div className="space-y-3">
      {!isNew ? (
        <section className="rounded-2xl border p-4" style={card}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex flex-1 items-center gap-1.5 text-sm font-black"><Warehouse size={16} /> Costo y existencias</p>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}><Lock size={11} /> Solo lectura</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>💰 {basis === "last" && lastCost > 0 ? "ÚLTIMO COSTO" : "COSTO PROMEDIO"}</p>
              <p className="text-xl font-black tabular-nums">{costKnown ? (cost > 0 ? cop(cost) : "Sin costo") : "🔒"}</p>
              {costKnown && lastInfo ? (
                <p className="mt-0.5 text-[10px]" style={{ color: "var(--t-muted)" }}>
                  {basis === "last" && lastCost > 0
                    ? <>Factura del {fmtDate(lastInfo.last_cost_at)} · promedio del inventario {cop(Number(lastInfo.avg_cost ?? avgCost))}</>
                    : lastCost > 0 ? <>Último costo de compra {cop(lastCost)}</> : null}
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>📦 UNIDADES EN TOTAL</p>
              <p className="text-xl font-black tabular-nums">{stock === null ? "…" : total.toLocaleString("es-CO")}</p>
            </div>
          </div>
          {/* Factura de donde salió el último costo (y las compras anteriores). */}
          {costKnown && productId ? <LastPurchases storeId={storeId} productId={productId} /> : null}
          {stock && stock.length ? (
            <ul className="mt-3 space-y-1">
              {stock.map((s) => (
                <li key={s.warehouse_id} className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm" style={{ background: "color-mix(in oklab, var(--t-card-border) 25%, transparent)" }}>
                  <span>{s.kind === "point" ? "📍" : "🏬"}</span>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <b className={`tabular-nums ${s.qty <= 0 ? "text-red-400" : ""}`}>{s.qty.toLocaleString("es-CO")} und.</b>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[11px]" style={{ color: "var(--t-muted)" }}>
            🔒 El costo y las unidades solo cambian con <b>ingreso de factura</b>, <b>ajustes</b> o <b>traslados</b> (todo queda en el kardex). Así el inventario nunca se descuadra.
          </p>
          <Link href="/dashboard/inventario?tab=purchases" className="mt-2 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}>
            <Receipt size={14} /> Hacer ingreso de factura
          </Link>
        </section>
      ) : (
        <p className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          🧾 El <b>costo</b> y las <b>unidades</b> se agregan con el <b>ingreso de factura</b> (Inventario → Ingreso de factura). Ahí mismo se calculan los precios con el % de ganancia.
        </p>
      )}

      <section className="rounded-2xl border p-4" style={card}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex flex-1 items-center gap-1.5 text-sm font-black"><Percent size={16} /> Ganancia por porcentaje</p>
          {cfg?.can_edit ? <button type="button" onClick={() => setShowCfg((v) => !v)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}><Settings2 size={12} /> Redondeo</button> : null}
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
          Precio = {basis === "last" ? "último costo de compra" : "costo promedio"} + % de ganancia, redondeado {step ? `${dir === "up" ? "hacia arriba" : dir === "down" ? "hacia abajo" : "al más cercano"} a $${step.toLocaleString("es-CO")}` : "sin redondeo"}. Si entra una factura con otro costo, los precios se ajustan solos.
        </p>
        {showCfg && cfg ? (
          <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <ChoiceChips value={String(step)} onChange={(v) => void saveCfg({ round_step: Number(v) as RoundingStep })} options={[["0", "Sin redondeo"], ["50", "$50"], ["100", "$100"], ["500", "$500"], ["1000", "$1.000"]].map(([v, l]) => ({ value: v, label: l }))} />
            <ChoiceChips value={dir} onChange={(v) => void saveCfg({ round_dir: v as RoundingDir })} options={[{ value: "nearest", label: "Al más cercano" }, { value: "up", label: "Hacia arriba ⬆️" }, { value: "down", label: "Hacia abajo ⬇️" }]} />
            <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-xs font-bold">Calcular los precios con</p>
              <ChoiceChips value={basis} onChange={(v) => void reprice(v as "last" | "average")}
                options={[{ value: "last", label: "🧾 Último costo de compra" }, { value: "average", label: "⚖️ Costo promedio" }]} />
              <button type="button" disabled={repricing} onClick={() => void reprice(basis)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
                <Sparkles size={12} /> {repricing ? "Revisando…" : "Recalcular todos los precios con esta regla"}
              </button>
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>El promedio sigue valorando el inventario; esto solo cambia de qué costo salen los precios. Antes de cambiar nada te muestra cuáles cambian.</p>
            </div>
            <div className="flex items-center gap-2 text-xs"><span className="flex-1">% por defecto para productos nuevos</span><div className="w-28"><NumberField value={cfg.default_markup} onChange={(v) => void saveCfg({ default_markup: v ?? 0 })} suffix="%" min={0} max={1000} /></div></div>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Aplica a toda la tienda.</p>
          </div>
        ) : null}

        {legacy && !isNew ? (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>✋ Este producto tiene <b>precios fijos</b> (no usa porcentaje).</p>
            <button type="button" disabled={!(cost > 0)} onClick={() => { const m = [0, 1, 2, 3, 4].map(implied) as Markups; onChange(m); setSame(m.every((x) => x === m[0])); }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: "var(--t-accent)" }}>
              <Sparkles size={13} /> Usar porcentaje (desde los precios actuales)
            </button>
            {!(cost > 0) ? <p className="mt-1 text-[11px]">Primero necesita costo (ingreso de factura).</p> : null}
          </div>
        ) : (
          <>
            <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={same} onChange={(e) => { setSame(e.target.checked); if (e.target.checked) setAll(markups[0]); }} className="h-4 w-4 accent-violet-500" />
              El mismo % para los 5 precios
            </label>
            {same ? (
              <div className="mt-2 flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm font-bold">Ganancia</span>
                <div className="w-36"><NumberField value={markups[0]} onChange={setAll} suffix="%" min={0} max={1000} decimals={2} ariaLabel="Porcentaje de ganancia" /></div>
              </div>
            ) : null}
            <ul className="mt-3 space-y-1.5">
              {LEVELS.map((l, i) => {
                const p = priceFromMarkup(cost, markups[i], step, dir);
                const margin = p && p > 0 ? ((p - cost) / p) * 100 : null;
                return (
                  <li key={l} className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                    <span className="min-w-0 flex-1 text-xs font-semibold">{l}</span>
                    {!same ? <div className="w-28"><NumberField value={markups[i]} onChange={(v) => setOne(i, v)} suffix="%" min={0} max={1000} decimals={2} ariaLabel={`Ganancia ${l}`} /></div> : null}
                    <span className="w-32 text-right">
                      {cost > 0 ? (
                        <PriceInput value={p} onCommit={(v) => setPrice(i, v)} label={`Precio ${l}`} />
                      ) : (
                        <b className="block text-sm tabular-nums">Al ingresar</b>
                      )}
                      {margin !== null ? <span className="text-[10px]" style={{ color: "var(--t-muted)" }}>margen {margin.toFixed(1)} %</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {priceWarn ? <p className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-xs">⚠️ {priceWarn}</p> : null}
            {cost > 0 ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>✏️ Puedes escribir el <b>%</b> o el <b>precio</b>: si escribes el precio, el % se calcula solo.</p> : null}
            {!isNew && cost > 0 ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Precio actual en la tienda: {prices.map((x, i) => `P${i + 1} ${cop(x)}`).join(" · ")}. Al guardar se reemplazan por los calculados.</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

/** Precio que se escribe a mano; se aplica al salir del campo o con Enter. */
function PriceInput({ value, onCommit, label }: { value: number | null; onCommit: (v: number) => void; label: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (value !== null ? `$ ${Math.round(value).toLocaleString("es-CO")}` : "");
  const commit = () => {
    if (typed !== null) { const n = Number(typed.replace(/\D/g, "")); if (n > 0) onCommit(n); }
    setTyped(null);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      title="Escribe el precio y el % se calcula solo"
      value={shown}
      placeholder="$ 0"
      onFocus={(e) => { setTyped(value ? String(Math.round(value)) : ""); const el = e.currentTarget; window.setTimeout(() => el.select(), 0); }}
      onChange={(e) => { const d = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 11); setTyped(d ? Number(d).toLocaleString("es-CO") : ""); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={commit}
      className="w-full rounded-xl border px-2 text-right text-sm font-black tabular-nums"
      style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)", minHeight: 34, padding: "4px 8px" }}
    />
  );
}
