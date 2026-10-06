"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "../MoneyInput";
import { Btn, errorMessage, inputClass, inputStyle, money, tableWrap, td, th, type ProductHit, type Warehouse } from "./shared";

/** Trae las miniaturas de los productos indicados (una sola consulta por lote nuevo). */
export function useThumbs(ids: string[]) {
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const key = ids.join(",");
  useEffect(() => {
    const missing = key ? key.split(",").filter((id) => !(id in thumbs)) : [];
    if (!missing.length) return;
    let alive = true;
    void supabaseBrowser().from("products").select("id,image_url").in("id", missing).then(({ data }) => {
      if (!alive) return;
      const next: Record<string, string | null> = {};
      missing.forEach((id) => { next[id] = null; });
      (data ?? []).forEach((r: { id: string; image_url: string | null }) => { next[r.id] = r.image_url; });
      setThumbs((cur) => ({ ...cur, ...next }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return thumbs;
}

export function Thumb({ src, size = 40 }: { src?: string | null; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" style={{ width: size, height: size }} className="shrink-0 rounded-lg object-cover" />
  ) : (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-lg text-lg" aria-hidden>📦</span>
  );
}

/** Buscador de productos contra el servidor: trae solo unas pocas coincidencias, nunca todo el catálogo. */
export function ProductPicker({
  storeId,
  warehouseId,
  inStockOnly,
  excludeIds,
  addedQty,
  keepOpen,
  inputRef,
  placeholder = "Buscar por nombre, SKU o código de barras…",
  onPick,
}: {
  storeId: string;
  warehouseId?: string | null;
  inStockOnly?: boolean;
  excludeIds?: string[];
  /** Productos ya agregados: se muestran con su cantidad en vez de ocultarse. */
  addedQty?: Record<string, number>;
  /** Mantiene la lista abierta tras elegir, para agregar varios productos seguidos. */
  keepOpen?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  onPick: (product: ProductHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, ProductHit[]>());
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const key = `${storeId}|${warehouseId ?? ""}|${inStockOnly ? 1 : 0}|${query.trim().toLowerCase()}`;
    let alive = true;
    const timer = window.setTimeout(async () => {
      const cached = cache.current.get(key);
      if (cached) {
        setHits(cached);
        return;
      }
      setLoading(true);
      const { data, error: err } = await supabaseBrowser().rpc("erp_search_products", {
        p_store: storeId,
        p_q: query,
        p_warehouse: warehouseId ?? null,
        p_in_stock: Boolean(inStockOnly),
        p_limit: 15,
      });
      if (!alive) return;
      setLoading(false);
      if (err) {
        setError(errorMessage(err));
        return;
      }
      setError(null);
      const rows = (data ?? []) as ProductHit[];
      cache.current.set(key, rows);
      setHits(rows);
    }, query ? 250 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, query, storeId, warehouseId, inStockOnly]);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const visible = hits.filter((h) => !excludeIds?.includes(h.id));
  const thumbs = useThumbs(open ? visible.map((h) => h.id) : []);

  const [flash, setFlash] = useState<string | null>(null);

  function pick(hit: ProductHit) {
    onPick(hit);
    setQuery("");
    if (keepOpen) {
      setFlash(hit.id);
      window.setTimeout(() => setFlash((cur) => (cur === hit.id ? null : cur)), 900);
      inputRef?.current?.focus();
    } else {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        className={inputClass}
        style={inputStyle}
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && visible[0]) {
            e.preventDefault();
            pick(visible[0]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open ? (
        <div
          className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-2xl border p-1 shadow-2xl"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}
        >
          {keepOpen ? (
            <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
              <span>Toca para agregar · puedes elegir varios seguidos</span>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full border px-2 py-0.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                Listo
              </button>
            </div>
          ) : null}
          {error ? <p className="p-3 text-sm" style={{ color: "#ef4444" }}>{error}</p> : null}
          {!error && loading && visible.length === 0 ? <p className="p-3 text-sm" style={{ color: "var(--t-muted)" }}>Buscando…</p> : null}
          {!error && !loading && visible.length === 0 ? <p className="p-3 text-sm" style={{ color: "var(--t-muted)" }}>Sin resultados.</p> : null}
          {visible.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => pick(hit)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition"
              style={{ color: "var(--t-text)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--t-accent) 14%, transparent)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = flash === hit.id ? "color-mix(in oklab, #22c55e 18%, transparent)" : "transparent")}
              ref={(el) => {
                if (el && flash === hit.id) el.style.background = "color-mix(in oklab, #22c55e 18%, transparent)";
              }}
            >
              <Thumb src={thumbs[hit.id]} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{hit.name}</span>
                {hit.sku ? <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{hit.sku}</span> : null}
              </span>
              <span className="shrink-0 text-right text-xs" style={{ color: "var(--t-muted)" }}>
                {warehouseId ? `Aquí: ${hit.wh_qty}` : `Stock: ${hit.stock}`}
                {addedQty?.[hit.id] ? (
                  <span className="mt-0.5 block font-bold" style={{ color: "#22c55e" }}>
                    {flash === hit.id ? "✓ " : ""}En la lista: {addedQty[hit.id]} · +1
                  </span>
                ) : (
                  <span className="mt-0.5 block font-bold" style={{ color: "var(--t-accent)" }}>+ Agregar</span>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type Line = {
  product_id: string;
  name: string;
  sku: string | null;
  current: number;
  qty: number;
  unit_cost: number;
  tax_rate: number;
  warehouse_id: string;
};

export function lineFromHit(hit: ProductHit, mode: "purchase" | "adjust", warehouseId: string): Line {
  return {
    product_id: hit.id,
    name: hit.name,
    sku: hit.sku,
    current: hit.wh_qty,
    qty: mode === "adjust" ? hit.wh_qty : 1,
    unit_cost: Number(hit.cost_price ?? 0),
    tax_rate: Number(hit.tax_rate ?? 0),
    warehouse_id: warehouseId,
  };
}

export function LineEditor({
  storeId,
  lines,
  onChange,
  mode,
  warehouseId,
  warehouses,
  lineExtra,
}: {
  storeId: string;
  lineExtra?: (line: Line) => ReactNode;
  lines: Line[];
  onChange: (lines: Line[]) => void;
  mode: "purchase" | "adjust";
  /** Adjust: bodega contada. Purchase: bodega sugerida para productos nuevos. */
  warehouseId: string;
  warehouses?: Warehouse[];
}) {
  const isPurchase = mode === "purchase";
  const lineThumbs = useThumbs(lines.map((l) => l.product_id));
  const searchRef = useRef<HTMLInputElement>(null);
  const addedQty = Object.fromEntries(lines.map((l) => [l.product_id, l.qty]));

  // Si el producto ya está en la lista se suma una unidad (en compras); si no, se agrega una línea nueva.
  function addHit(hit: ProductHit) {
    const index = lines.findIndex((l) => l.product_id === hit.id);
    if (index === -1) onChange([...lines, lineFromHit(hit, mode, warehouseId)]);
    else if (isPurchase) patch(index, { qty: lines[index].qty + 1 });
  }

  function patch(index: number, change: Partial<Line>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));
  }

  const total = lines.reduce((sum, l) => sum + l.qty * l.unit_cost * (1 + l.tax_rate / 100), 0);

  return (
    <div className="space-y-3">
      <ProductPicker
        storeId={storeId}
        warehouseId={isPurchase ? null : warehouseId}
        excludeIds={isPurchase ? undefined : lines.map((l) => l.product_id)}
        addedQty={isPurchase ? addedQty : undefined}
        keepOpen
        inputRef={searchRef}
        placeholder={lines.length ? "➕ Buscar otro producto para agregar (nombre, SKU o código de barras)…" : undefined}
        onPick={addHit}
      />

      {lines.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>Busca y agrega productos para empezar.</p>
      ) : (
        <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full min-w-[620px]">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr>
                <th className={th}>Producto</th>
                {isPurchase ? <th className={th}>Bodega destino</th> : <th className={th}>En bodega</th>}
                <th className={th}>{isPurchase ? "Cantidad" : "Cantidad contada"}</th>
                {isPurchase ? <th className={th}>Costo unit.</th> : null}
                {isPurchase ? <th className={th}>IVA %</th> : null}
                {!isPurchase ? <th className={th}>Diferencia</th> : <th className={th}>Total</th>}
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const diff = line.qty - line.current;
                return (
                  <tr key={line.product_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <Thumb src={lineThumbs[line.product_id]} size={48} />
                        <div className="min-w-0">
                          <div className="font-semibold">{line.name}</div>
                          {line.sku ? <div className="text-xs" style={{ color: "var(--t-muted)" }}>{line.sku}</div> : null}
                          {lineExtra ? lineExtra(line) : null}
                        </div>
                      </div>
                    </td>
                    {isPurchase ? (
                      <td className={td}>
                        <select
                          className={`${inputClass} min-w-36`}
                          style={inputStyle}
                          value={line.warehouse_id}
                          onChange={(e) => patch(index, { warehouse_id: e.target.value })}
                        >
                          {(warehouses ?? []).filter((w) => w.active).map((w) => (
                            <option key={w.id} value={w.id}>{w.kind === "point" ? "📍 " : "🏬 "}{w.name}</option>
                          ))}
                        </select>
                      </td>
                    ) : (
                      <td className={td}>{line.current}</td>
                    )}
                    <td className={td}>
                      <input
                        type="number"
                        min={isPurchase ? 1 : 0}
                        step={1}
                        className={`${inputClass} w-24`}
                        style={inputStyle}
                        value={line.qty}
                        onChange={(e) => patch(index, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      />
                    </td>
                    {isPurchase ? (
                      <td className={td}>
                        <MoneyInput
                          className={`${inputClass} w-36`}
                          style={inputStyle}
                          value={line.unit_cost}
                          onValueChange={(v) => patch(index, { unit_cost: v ?? 0 })}
                        />
                      </td>
                    ) : null}
                    {isPurchase ? (
                      <td className={td}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className={`${inputClass} w-20`}
                          style={inputStyle}
                          value={line.tax_rate}
                          onChange={(e) => patch(index, { tax_rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                        />
                      </td>
                    ) : null}
                    {!isPurchase ? (
                      <td className={td} style={{ color: diff === 0 ? "var(--t-muted)" : diff > 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                        {diff > 0 ? `+${diff}` : diff}
                      </td>
                    ) : (
                      <td className={td}>{money(line.qty * line.unit_cost * (1 + line.tax_rate / 100))}</td>
                    )}
                    <td className={td}>
                      <Btn variant="ghost" onClick={() => onChange(lines.filter((_, i) => i !== index))}>Quitar</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {isPurchase ? (
              <tfoot>
                <tr className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className={td} colSpan={5} style={{ textAlign: "right", fontWeight: 700 }}>
                    <span className="float-left font-normal">
                      <Btn
                        variant="ghost"
                        onClick={() => {
                          searchRef.current?.focus();
                          searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      >
                        ➕ Agregar otro producto
                      </Btn>
                    </span>
                    {lines.length} producto{lines.length === 1 ? "" : "s"} · {lines.reduce((s, l) => s + l.qty, 0)} und. · Total factura (con IVA)
                  </td>
                  <td className={td} style={{ fontWeight: 800 }}>{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
  );
}
