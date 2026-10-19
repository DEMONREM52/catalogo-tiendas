"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EMPTY_PRODUCT_DETAILS } from "@/lib/product-details";
import { MoneyInput } from "../MoneyInput";
import { checkProductCode, cleanProductCode } from "../products/product-code";
import { errorMessage, inputClass, inputStyle, money, toast, type ProductHit } from "./shared";
import type { Line } from "./LineEditor";

/**
 * Crear un producto sin salir del ingreso de factura: nombre, códigos, categoría, y de una vez la cantidad, el costo,
 * el IVA y el % de venta de esta factura. Al crearlo queda agregado a la factura.
 * «Crear y seguir editando» abre el producto en otra pestaña (fotos, descripción…) y la factura sigue aquí.
 * El costo y las existencias los pone la factura al registrarse (como cualquier ingreso).
 */

type Extra = Pick<Line, "qty" | "unit_cost" | "tax_rate" | "markup">;
type Mode = "add" | "another" | "edit";

export function QuickProductModal({ storeId, initialName, withMarkup, onClose, onCreated }: {
  storeId: string;
  initialName: string;
  withMarkup: boolean;
  onClose: () => void;
  onCreated: (hit: ProductHit, extra: Extra) => void;
}) {
  const [name, setName] = useState(initialName.toUpperCase());
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState<number | null>(null);
  const [tax, setTax] = useState("0");
  const [markup, setMarkup] = useState("");
  const [cfg, setCfg] = useState<{ step: number; dir: string; def: number }>({ step: 100, dir: "nearest", def: 15 });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    void sb.from("product_categories").select("id,name").eq("store_id", storeId).eq("active", true).order("name").then(({ data }) => setCategories((data ?? []) as Array<{ id: string; name: string }>));
    if (withMarkup) void sb.rpc("erp_product_pricing_get", { p_store: storeId }).then(({ data }) => {
      const d = (data ?? {}) as { round_step?: number; round_dir?: string; default_markup?: number };
      setCfg({ step: Number(d.round_step ?? 100), dir: d.round_dir ?? "nearest", def: Number(d.default_markup ?? 15) });
      setMarkup((cur) => cur || String(Number(d.default_markup ?? 15)).replace(".", ","));
    });
    window.setTimeout(() => nameRef.current?.focus(), 30);
  }, [storeId, withMarkup]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const num = (s: string) => Number(s.replace(",", "."));
  const pct = markup.trim() ? num(markup) : null;
  const sale = (() => {
    if (pct === null || !Number.isFinite(pct) || !(Number(cost) > 0)) return 0;
    const raw = Math.round(Number(cost) * (1 + pct / 100));
    if (!cfg.step) return raw;
    const q = raw / cfg.step;
    return (cfg.dir === "up" ? Math.ceil(q - 1e-9) : cfg.dir === "down" ? Math.floor(q + 1e-9) : Math.floor(q + 0.5)) * cfg.step;
  })();

  async function create(mode: Mode) {
    const n = name.trim().toUpperCase();
    if (!n) { nameRef.current?.focus(); return void toast("Escribe el nombre del producto", "warning"); }
    const q = Math.max(0, Math.floor(num(qty) || 0));
    // La pestaña del producto se abre ya (los navegadores bloquean ventanas que se abren después de esperar).
    const win = mode === "edit" ? window.open("", "_blank") : null;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const code = cleanProductCode(sku);
      await checkProductCode(storeId, code);
      const m = withMarkup && pct !== null && Number.isFinite(pct) ? Math.min(1000, Math.max(0, pct)) : null;
      const base = {
        store_id: storeId, name: n, ...(code ? { sku: code } : {}), ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        description: "", cost_price: 0, price_1: 0, price_2: 0, price_3: 0, price_4: 0, price_5: 0, price_retail: 0, price_wholesale: 0,
        min_wholesale: 1, stock: 0, active: true, image_url: null, category_id: category || null, product_details: EMPTY_PRODUCT_DETAILS,
      };
      const marks = m !== null ? { markup_1: m, markup_2: m, markup_3: m, markup_4: m, markup_5: m } : {};
      let { data, error } = await sb.from("products").insert({ ...base, ...marks }).select("id,name,sku,barcode").single();
      if (error && /markup_|permission denied/i.test(error.message)) ({ data, error } = await sb.from("products").insert(base).select("id,name,sku,barcode").single());
      if (error && /barcode/i.test(error.message)) {
        const { barcode: _b, ...noBarcode } = base as typeof base & { barcode?: string };
        void _b;
        ({ data, error } = await sb.from("products").insert({ ...noBarcode, ...marks }).select("id,name,sku,barcode").single());
      }
      if (error || !data) throw error ?? new Error("No se pudo crear.");
      const row = data as { id: string; name: string; sku: string | null; barcode: string | null };
      onCreated(
        { id: row.id, name: row.name, sku: row.sku, barcode: row.barcode, cost_price: Number(cost ?? 0), tax_rate: num(tax) || 0, stock: 0, wh_qty: 0 },
        { qty: q, unit_cost: Number(cost ?? 0), tax_rate: Math.min(100, Math.max(0, num(tax) || 0)), markup: m },
      );
      setCreated((cur) => [...cur, row.name]);
      if (mode === "edit") {
        if (win && !win.closed) win.location.href = `/dashboard/products/${row.id}`;
        else window.open(`/dashboard/products/${row.id}`, "_blank");
        onClose();
      } else if (mode === "another") {
        void toast(`«${row.name}» creado y agregado`, "success", "Escribe el siguiente.");
        setName(""); setSku(""); setBarcode(""); setQty("1"); setCost(null);
        window.setTimeout(() => nameRef.current?.focus(), 30);
      } else {
        void toast(`«${row.name}» creado y agregado a la factura`);
        onClose();
      }
    } catch (e) {
      win?.close();
      void toast("No se pudo crear el producto", "error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void create(e.ctrlKey || e.metaKey ? "another" : "add"); }
  };
  const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[160] grid place-items-center bg-black/55 p-3 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Crear producto" className="flex max-h-[92vh] w-[min(640px,100%)] flex-col overflow-hidden rounded-3xl border text-sm shadow-2xl"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div>
            <h3 className="text-base font-black">✨ Crear producto</h3>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Queda agregado a esta factura. Fotos y descripción las puedes poner después.</p>
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" onKeyDown={onEnter}>
          {created.length ? (
            <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, #10b981 45%, transparent)", color: "#10b981" }}>
              ✅ Creados y agregados: {created.join(" · ")}
            </p>
          ) : null}
          <div>
            <span className={label} style={{ color: "var(--t-muted)" }}>Nombre *</span>
            <input ref={nameRef} className={`${inputClass} font-bold uppercase`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="EJ: RADIO 3 BANDAS SPARTAN ICF P10BT" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <span className={label} style={{ color: "var(--t-muted)" }}>Código (SKU)</span>
              <input className={`${inputClass} uppercase`} style={inputStyle} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Vacío = número interno" />
            </div>
            <div>
              <span className={label} style={{ color: "var(--t-muted)" }}>Código de barras</span>
              <input className={inputClass} style={inputStyle} value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\s+/g, ""))} placeholder="Escanéalo aquí" inputMode="numeric" />
            </div>
            <div>
              <span className={label} style={{ color: "var(--t-muted)" }}>Categoría</span>
              <select className={inputClass} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Sin categoría</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="mb-2 text-xs font-bold">🧾 En esta factura</p>
            <div className={`grid gap-3 ${withMarkup ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
              <div>
                <span className={label} style={{ color: "var(--t-muted)" }}>Cantidad</span>
                <input className={`${inputClass} text-right font-bold`} style={inputStyle} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <div>
                <span className={label} style={{ color: "var(--t-muted)" }}>Costo unit.</span>
                <MoneyInput className={`${inputClass} text-right font-bold`} style={inputStyle} ariaLabel="Costo unitario" value={cost} onValueChange={(v) => setCost(v ?? null)} />
              </div>
              <div>
                <span className={label} style={{ color: "var(--t-muted)" }}>IVA %</span>
                <input className={`${inputClass} text-right`} style={inputStyle} inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value.replace(/[^\d,.]/g, ""))} onFocus={(e) => e.currentTarget.select()} />
              </div>
              {withMarkup ? (
                <div>
                  <span className={label} style={{ color: "var(--t-muted)" }}>% venta</span>
                  <div className="relative">
                    <input className={`${inputClass} pr-9 text-right font-bold tabular-nums`} style={inputStyle} inputMode="decimal" value={markup} placeholder={String(cfg.def)}
                      onChange={(e) => setMarkup(e.target.value.replace(/[^\d,.]/g, ""))} onFocus={(e) => e.currentTarget.select()} />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: "var(--t-muted)" }}>%</span>
                  </div>
                  <span className="mt-1 block text-right text-[11px] font-bold" style={{ color: "var(--t-accent)" }}>{sale > 0 ? `Venta ${money(sale)}` : " "}</span>
                </div>
              ) : null}
            </div>
          </div>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
            <b>Enter</b> crea y agrega · <b>Ctrl + Enter</b> crea y deja la ventana lista para el siguiente · <b>Esc</b> cierra.
          </p>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
          <button type="button" disabled={busy} className="rounded-xl border px-3.5 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }} onClick={() => void create("edit")} title="Lo crea, lo agrega y abre su ficha en otra pestaña para poner fotos y más datos">
            ✏️ Crear y seguir editando ↗
          </button>
          <button type="button" disabled={busy} className="rounded-xl border px-3.5 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }} onClick={() => void create("another")}>
            ➕ Crear y crear otro
          </button>
          <button type="button" disabled={busy} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))" }} onClick={() => void create("add")}>
            {busy ? "Creando…" : "✅ Crear y agregar"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
