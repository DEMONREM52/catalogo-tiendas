"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IMAGE_CACHE_SECONDS, prepareImage } from "@/lib/image-prepare";
import { requestImageIndex } from "@/lib/image-search/indexer";
import { EMPTY_PRODUCT_DETAILS } from "@/lib/product-details";
import { MoneyInput } from "../MoneyInput";
import { checkProductCode, cleanProductCode } from "../products/product-code";
import Swal from "sweetalert2";
import { errorMessage, inputClass, inputStyle, money, toast, type ProductHit } from "./shared";
import type { Line } from "./LineEditor";
import { PctInput } from "./PctInput";
import { QuickCategories } from "./QuickCategories";
import { saveProductCategoryIds } from "../products/CategoryPicker";

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
  // Categorías en orden: la primera es la principal.
  const [cats, setCats] = useState<string[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState<number | null>(null);
  const [tax, setTax] = useState("0");
  const [markup, setMarkup] = useState("");
  const [cfg, setCfg] = useState<{ step: number; dir: string; def: number }>({ step: 100, dir: "nearest", def: 15 });
  const [busy, setBusy] = useState(false);
  // Foto (opcional): se sube apenas se elige, así al crear ya está lista.
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadImage(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast("Eso no es una imagen", "warning");
    if (file.size > 15 * 1024 * 1024) return void toast("La imagen pesa más de 15 MB", "warning");
    setUploading(true);
    try {
      const sb = supabaseBrowser();
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) throw new Error("Tu sesión se cerró. Vuelve a entrar.");
      const prepared = await prepareImage(file);
      if (prepared.blob.size > 2 * 1024 * 1024) throw new Error("La imagen sigue pesando más de 2 MB. Prueba con otra.");
      const ext = prepared.ext;
      const path = `${auth.user.id}/products/new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await sb.storage.from("product-images").upload(path, prepared.blob, { upsert: true, cacheControl: IMAGE_CACHE_SECONDS, contentType: prepared.contentType });
      if (error) throw error;
      setImage(sb.storage.from("product-images").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      void toast("No se pudo subir la foto", "error", errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Pegar una foto copiada (Ctrl + V) en cualquier parte de la ventana.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (file) { e.preventDefault(); void uploadImage(file); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
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

  // Si ya escribió algo, pregunta antes de cerrar (un clic por error afuera no borra lo escrito).
  const closing = useRef(false);
  // Solo cuenta como «clic afuera» si empezó afuera (arrastrar para seleccionar texto y soltar afuera no cierra).
  const downOutside = useRef(false);
  async function requestClose() {
    if (closing.current) return;
    const dirty = Boolean(name.trim() && name.trim() !== initialName.trim().toUpperCase()) || Boolean(sku.trim() || barcode.trim() || image || cats.length) || Number(cost ?? 0) > 0 || (qty !== "1" && qty !== "");
    if (!dirty) return onClose();
    closing.current = true;
    const res = await Swal.fire({
      icon: "question", title: "¿Salir sin crear el producto?", text: "Lo que escribiste en esta ventana se pierde. La factura sigue igual.",
      showCancelButton: true, confirmButtonText: "Sí, salir", cancelButtonText: "Seguir escribiendo", reverseButtons: true, focusCancel: true,
      background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444",
    });
    const leave = res.isConfirmed;
    closing.current = false;
    if (leave) onClose();
    else window.setTimeout(() => nameRef.current?.focus(), 50);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { e.preventDefault(); void requestClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, name, sku, barcode, cost, image, qty, cats]);

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
    if (uploading) return void toast("Espera a que termine de subir la foto", "warning");
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
        store_id: storeId, name: n, ...(code ? { sku: code } : {}), ...(barcode.trim() ? { barcode: barcode.trim().replace(/\s+/g, " ").toUpperCase() } : {}),
        description: "", cost_price: 0, price_1: 0, price_2: 0, price_3: 0, price_4: 0, price_5: 0, price_retail: 0, price_wholesale: 0,
        min_wholesale: 1, stock: 0, active: true, image_url: image, category_id: cats[0] ?? null, product_details: EMPTY_PRODUCT_DETAILS,
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
      // Búsqueda por foto: se indexa la imagen nueva (igual que al crear desde Productos).
      if (image) requestImageIndex();
      const row = data as { id: string; name: string; sku: string | null; barcode: string | null };
      if (cats.length > 1) {
        const warn = await saveProductCategoryIds(row.id, cats);
        if (warn) void toast("Producto creado, pero no todas sus categorías", "warning", warn);
      }
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
        setName(""); setSku(""); setBarcode(""); setQty("1"); setCost(null); setImage(null);
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
    <div className="fixed inset-0 z-[160] grid place-items-center bg-black/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { downOutside.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOutside.current && !busy) void requestClose(); downOutside.current = false; }}>
      <div role="dialog" aria-modal="true" aria-label="Crear producto" className="flex max-h-[92vh] w-[min(640px,100%)] flex-col overflow-hidden rounded-3xl border text-sm shadow-2xl"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div>
            <h3 className="text-base font-black">✨ Crear producto</h3>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Queda agregado a esta factura. Fotos y descripción las puedes poner después.</p>
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} onClick={() => void requestClose()} aria-label="Cerrar">✕</button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" onKeyDown={onEnter}>
          {created.length ? (
            <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, #10b981 45%, transparent)", color: "#10b981" }}>
              ✅ Creados y agregados: {created.join(" · ")}
            </p>
          ) : null}
          <div className="flex gap-3">
            {/* Foto: tocar, arrastrar o pegar (Ctrl + V) */}
            <div className="shrink-0">
              <span className={label} style={{ color: "var(--t-muted)" }}>Foto</span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); void uploadImage(e.dataTransfer.files?.[0]); }}
                className="relative grid h-[104px] w-[104px] place-items-center overflow-hidden rounded-2xl border-2 border-dashed text-center text-[11px] font-semibold transition"
                style={{ borderColor: dragging ? "var(--t-accent)" : "var(--t-card-border)", background: dragging ? "color-mix(in oklab, var(--t-accent) 10%, transparent)" : "color-mix(in oklab, var(--t-card-bg) 70%, transparent)", color: "var(--t-muted)" }}
                title="Toca para elegir, arrastra una foto o pégala con Ctrl + V"
                aria-label="Foto del producto"
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="h-full w-full object-cover" />
                ) : uploading ? "Subiendo…" : <span>📷<br />Foto<br /><span className="font-normal">tocar, arrastrar o Ctrl+V</span></span>}
                {image && uploading ? <span className="absolute inset-0 grid place-items-center bg-black/50 text-white">Subiendo…</span> : null}
              </button>
              {image ? (
                <button type="button" className="mt-1 block w-full text-center text-[11px] font-bold" style={{ color: "#ef4444" }} onClick={() => setImage(null)}>Quitar</button>
              ) : null}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadImage(e.target.files?.[0])} />
            </div>
            <div className="min-w-0 flex-1">
              <span className={label} style={{ color: "var(--t-muted)" }}>Nombre *</span>
              <input ref={nameRef} className={`${inputClass} font-bold uppercase`} style={inputStyle} value={name} onChange={(e) => { const el = e.target; const at = el.selectionStart; setName(el.value.toUpperCase()); requestAnimationFrame(() => { try { el.setSelectionRange(at, at); } catch {} }); }} placeholder="EJ: RADIO 3 BANDAS SPARTAN ICF P10BT" />
              <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>La foto es opcional: se reduce sola para que cargue rápido en los catálogos.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className={label} style={{ color: "var(--t-muted)" }}>Código (SKU)</span>
              <input className={`${inputClass} uppercase`} style={inputStyle} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Vacío = número interno" />
            </div>
            <div>
              <span className={label} style={{ color: "var(--t-muted)" }}>Código de barras</span>
              <input className={`${inputClass} uppercase`} style={inputStyle} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Escanéalo o escríbelo" autoComplete="off" />
            </div>
          </div>
          <div>
            <span className={label} style={{ color: "var(--t-muted)" }}>Categorías <span className="font-normal normal-case">(puedes poner varias · ⭐ = principal)</span></span>
            <QuickCategories storeId={storeId} categories={categories} onCategories={setCategories} value={cats} onChange={setCats} />
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
                  <PctInput value={markup} placeholder={String(cfg.def)} ariaLabel="% de ganancia" onChange={setMarkup} />
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
