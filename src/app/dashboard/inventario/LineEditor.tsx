"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "../MoneyInput";
import { errorMessage, inputClass, inputStyle, money, type ProductHit, type Warehouse } from "./shared";

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

/** Búsqueda de productos en el servidor (inteligente: sin orden, sin tildes, con pedazos de palabras). */
export function useProductSearch({
  storeId,
  warehouseId,
  inStockOnly,
  query,
  enabled,
  limit = 15,
}: {
  storeId: string;
  warehouseId?: string | null;
  inStockOnly?: boolean;
  query: string;
  enabled: boolean;
  limit?: number;
}) {
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, ProductHit[]>());

  useEffect(() => {
    if (!enabled) return;
    const key = `${storeId}|${warehouseId ?? ""}|${inStockOnly ? 1 : 0}|${limit}|${query.trim().toLowerCase()}`;
    let alive = true;
    const cached = cache.current.get(key);
    if (cached) {
      setHits(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const { data, error: err } = await supabaseBrowser().rpc("erp_search_products", {
        p_store: storeId,
        p_q: query,
        p_warehouse: warehouseId ?? null,
        p_in_stock: Boolean(inStockOnly),
        p_limit: limit,
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
    }, query ? 220 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [enabled, query, storeId, warehouseId, inStockOnly, limit]);

  return { hits, loading, error };
}

function HitRow({
  hit,
  thumb,
  active,
  flash,
  showWarehouse,
  added,
  onPick,
  onHover,
  big,
  stockLabel,
}: {
  hit: ProductHit;
  thumb?: string | null;
  active: boolean;
  flash: boolean;
  showWarehouse: boolean;
  /** Texto propio para la existencia (ej. "Hay 5 allá"). */
  stockLabel?: (hit: ProductHit) => string;
  added?: number;
  onPick: () => void;
  onHover: () => void;
  big?: boolean;
}) {
  const bg = flash
    ? "color-mix(in oklab, #22c55e 18%, transparent)"
    : active
      ? "color-mix(in oklab, var(--t-accent) 16%, transparent)"
      : "transparent";
  return (
    <button
      type="button"
      data-active={active || undefined}
      onClick={onPick}
      onMouseMove={onHover}
      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm transition-colors duration-150 ${big ? "py-2.5" : "py-2"}`}
      style={{ color: "var(--t-text)", background: bg }}
    >
      <Thumb src={thumb} size={big ? 52 : 44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{hit.name}</span>
        <span className="block truncate text-xs" style={{ color: "var(--t-muted)" }}>
          {[hit.sku, hit.barcode].filter(Boolean).join(" · ") || "Sin código"}
          {Number(hit.cost_price) > 0 ? ` · Costo ${money(hit.cost_price)}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs" style={{ color: "var(--t-muted)" }}>
        {stockLabel ? stockLabel(hit) : showWarehouse ? `Aquí: ${hit.wh_qty}` : `Stock: ${hit.stock}`}
        {added ? (
          <span className="mt-0.5 block font-bold" style={{ color: "#22c55e" }}>
            {flash ? "✓ " : ""}En la lista: {added}
          </span>
        ) : (
          <span className="mt-0.5 block font-bold" style={{ color: "var(--t-accent)" }}>+ Agregar</span>
        )}
      </span>
    </button>
  );
}

/** Flechas ↑↓ y Enter sobre una lista de resultados. */
function useListKeys(count: number, onEnter: (index: number) => void, onEscape: () => void) {
  const [active, setActive] = useState(0);
  const safe = count ? Math.min(active, count - 1) : 0;
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(count ? (safe + 1) % count : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(count ? (safe - 1 + count) % count : 0);
    } else if (e.key === "Enter") {
      if (count) {
        e.preventDefault();
        onEnter(safe);
      }
    } else if (e.key === "Escape") {
      onEscape();
    }
  }
  return { active: safe, setActive, onKeyDown };
}

/** Buscador desplegable de productos: trae solo unas pocas coincidencias, nunca todo el catálogo. */
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
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { hits, loading, error } = useProductSearch({ storeId, warehouseId, inStockOnly, query, enabled: open });

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const visible = hits.filter((h) => !excludeIds?.includes(h.id));
  const thumbs = useThumbs(open ? visible.map((h) => h.id) : []);

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

  const keys = useListKeys(visible.length, (i) => pick(visible[i]), () => setOpen(false));

  useEffect(() => {
    listRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [keys.active]);

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        className={inputClass}
        style={inputStyle}
        placeholder={placeholder}
        value={query}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          keys.setActive(0);
          setOpen(true);
        }}
        onKeyDown={keys.onKeyDown}
      />
      {open ? (
        <div
          ref={listRef}
          id={listId}
          className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-2xl border p-1 shadow-2xl"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}
        >
          <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            <span>{keepOpen ? "Toca para agregar · puedes elegir varios seguidos" : "↑↓ para moverte · Enter para elegir"}</span>
            {keepOpen ? (
              <button type="button" onClick={() => setOpen(false)} className="rounded-full border px-2 py-0.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                Listo
              </button>
            ) : null}
          </div>
          {error ? <p className="p-3 text-sm" style={{ color: "#ef4444" }}>{error}</p> : null}
          {!error && loading && visible.length === 0 ? <p className="p-3 text-sm" style={{ color: "var(--t-muted)" }}>Buscando…</p> : null}
          {!error && !loading && visible.length === 0 ? <p className="p-3 text-sm" style={{ color: "var(--t-muted)" }}>Sin resultados. Prueba con otra palabra o un pedazo del nombre.</p> : null}
          {visible.map((hit, i) => (
            <HitRow
              key={hit.id}
              hit={hit}
              thumb={thumbs[hit.id]}
              active={i === keys.active}
              flash={flash === hit.id}
              showWarehouse={Boolean(warehouseId)}
              added={addedQty?.[hit.id]}
              onPick={() => pick(hit)}
              onHover={() => keys.setActive(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Ventana flotante para buscar y agregar un producto sin subir hasta el buscador. */
export function ProductSearchModal({
  open,
  onClose,
  storeId,
  warehouseId,
  inStockOnly,
  excludeIds,
  addedQty,
  title = "Agregar producto",
  onPick,
  stockLabel,
}: {
  open: boolean;
  onClose: () => void;
  storeId: string;
  warehouseId?: string | null;
  inStockOnly?: boolean;
  excludeIds?: string[];
  addedQty?: Record<string, number>;
  title?: string;
  onPick: (product: ProductHit) => void;
  stockLabel?: (hit: ProductHit) => string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Solo en el navegador (el portal necesita document.body).
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const { hits, loading, error } = useProductSearch({ storeId, warehouseId, inStockOnly, query, enabled: open, limit: 20 });
  const visible = hits.filter((h) => !excludeIds?.includes(h.id));
  const thumbs = useThumbs(open ? visible.map((h) => h.id) : []);

  function pick(hit: ProductHit) {
    onPick(hit);
    setQuery("");
    onClose();
  }
  const keys = useListKeys(visible.length, (i) => pick(visible[i]), onClose);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [keys.active]);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="product-search-modal"
          className="fixed inset-0 z-120 flex items-end justify-center p-0 sm:items-start sm:p-6 sm:pt-[10vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] border shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:max-h-[78vh] sm:max-w-2xl sm:rounded-[28px]"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full sm:hidden" style={{ background: "var(--t-card-border)" }} />
            <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-3 sm:px-5 sm:pt-4">
              <div>
                <h3 className="text-base font-bold">➕ {title}</h3>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Escribe como lo recuerdes: “casa rosa”, “ro cas”, SKU o código de barras.</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border text-sm transition hover:rotate-90"
                style={{ borderColor: "var(--t-card-border)" }}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </header>
            <div className="px-4 sm:px-5">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base opacity-70">🔎</span>
                <input
                  ref={inputRef}
                  className={`${inputClass}  py-3 text-base`}
                  style={{ ...inputStyle, paddingLeft: "2.6rem", boxShadow: "0 0 0 3px color-mix(in oklab, var(--t-accent) 18%, transparent)" }}
                  placeholder="Buscar producto…"
                  value={query}
                  autoComplete="off"
                  enterKeyHint="search"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    keys.setActive(0);
                  }}
                  onKeyDown={keys.onKeyDown}
                />
                {loading ? (
                  <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "var(--t-accent)", borderTopColor: "transparent" }} />
                ) : null}
              </div>
            </div>
            <div ref={listRef} className="mt-2 min-h-[30vh] flex-1 overflow-y-auto overscroll-contain px-2 pb-2 sm:px-3">
              {error ? <p className="p-3 text-sm" style={{ color: "#ef4444" }}>{error}</p> : null}
              {!error && loading && visible.length === 0
                ? Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="mx-1 my-1.5 h-14 animate-pulse rounded-xl" style={{ background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }} />
                  ))
                : null}
              {!error && !loading && visible.length === 0 ? (
                <p className="p-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>
                  No encontramos nada parecido. Prueba con otra palabra o solo un pedazo del nombre.
                </p>
              ) : null}
              {visible.map((hit, i) => (
                <HitRow
                  key={hit.id}
                  big
                  hit={hit}
                  thumb={thumbs[hit.id]}
                  active={i === keys.active}
                  flash={false}
                  showWarehouse={Boolean(warehouseId)}
                  stockLabel={stockLabel}
                  added={addedQty?.[hit.id]}
                  onPick={() => pick(hit)}
                  onHover={() => keys.setActive(i)}
                />
              ))}
            </div>
            <footer className="hidden items-center justify-between gap-2 border-t px-5 py-2.5 text-[11px] sm:flex" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
              <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> moverte · <Kbd>Enter</Kbd> agregar · <Kbd>Esc</Kbd> cerrar</span>
              <span>Al elegir, pasas directo a escribir la cantidad</span>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]" style={{ borderColor: "var(--t-card-border)" }}>
      {children}
    </kbd>
  );
}

/**
 * Celda numérica tipo Excel: al entrar se selecciona todo y lo que escribes
 * reemplaza el valor. Enter pasa a la siguiente celda; ↑ ↓ cambian de fila.
 */
function CellNumber({
  value,
  onValue,
  min = 0,
  max,
  decimals = false,
  inputRef,
  onKeyDown,
  className,
  ariaLabel,
  suffix,
}: {
  value: number;
  onValue: (v: number) => void;
  min?: number;
  max?: number;
  decimals?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  className?: string;
  ariaLabel: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        inputMode={decimals ? "decimal" : "numeric"}
        autoComplete="off"
        aria-label={ariaLabel}
        className={`${inputClass} text-right font-semibold tabular-nums ${suffix ? "pr-7" : ""} ${className ?? ""}`}
        style={inputStyle}
        value={shown}
        onFocus={(e) => {
          setDraft(String(value));
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onMouseUp={(e) => e.preventDefault()}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const raw = decimals ? e.target.value.replace(",", ".").replace(/[^\d.]/g, "") : e.target.value.replace(/\D/g, "");
          const clean = decimals ? raw.replace(/(\..*)\./g, "$1") : raw;
          setDraft(clean);
          let n = clean === "" || clean === "." ? 0 : Number(clean);
          if (!Number.isFinite(n)) n = 0;
          if (!decimals) n = Math.floor(n);
          if (max !== undefined) n = Math.min(max, n);
          onValue(Math.max(min, n));
        }}
        onKeyDown={onKeyDown}
      />
      {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--t-muted)" }}>{suffix}</span> : null}
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
  /** Comentario corto del producto (sale en el comprobante entre paréntesis). */
  note?: string;
};

/** Comentario sutil del producto: «(“…”)»; un clic para escribirlo o editarlo. */
function LineNote({ value, onChange, name }: { value: string; onChange: (v: string) => void; name: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        maxLength={200}
        defaultValue={value}
        placeholder="COMENTARIO (OPCIONAL)"
        aria-label={`Comentario de ${name}`}
        className="mt-1 w-full rounded-lg border bg-transparent px-2 py-1 text-[11px] uppercase tracking-wide outline-none"
        style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            if (e.key === "Enter") onChange(e.currentTarget.value.toUpperCase().trim());
            setEditing(false);
          }
        }}
        onBlur={(e) => {
          onChange(e.currentTarget.value.toUpperCase().trim());
          setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-0.5 block max-w-full truncate text-left text-[11px] uppercase tracking-wide transition hover:opacity-100"
      style={{ color: "var(--t-muted)", opacity: value ? 0.95 : 0.6 }}
      title={value ? "Editar comentario" : "Agregar un comentario a este producto"}
    >
      {value ? `(“${value}”)` : "+ comentario"}
    </button>
  );
}

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

export type LineEditorHandle = { openPicker: () => void };

type Col = "qty" | "cost" | "tax";

export function LineEditor({
  storeId,
  lines,
  onChange,
  mode,
  warehouseId,
  warehouses,
  lineExtra,
  editorRef,
}: {
  storeId: string;
  lineExtra?: (line: Line) => ReactNode;
  lines: Line[];
  onChange: (lines: Line[]) => void;
  mode: "purchase" | "adjust";
  /** Adjust: bodega contada. Purchase: bodega sugerida para productos nuevos. */
  warehouseId: string;
  warehouses?: Warehouse[];
  /** Permite abrir la ventana de "Agregar producto" desde fuera (p. ej. una barra fija). */
  editorRef?: Ref<LineEditorHandle>;
}) {
  const isPurchase = mode === "purchase";
  const lineThumbs = useThumbs(lines.map((l) => l.product_id));
  const searchRef = useRef<HTMLInputElement>(null);
  const cells = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const addedQty = Object.fromEntries(lines.map((l) => [l.product_id, l.qty]));
  const cols: Col[] = isPurchase ? ["qty", "cost", "tax"] : ["qty"];

  useImperativeHandle(editorRef, () => ({ openPicker: () => setModalOpen(true) }), []);

  function cellRef(productId: string, col: Col) {
    return (el: HTMLInputElement | null) => {
      const key = `${productId}:${col}`;
      if (el) cells.current.set(key, el);
      else cells.current.delete(key);
    };
  }

  function focusCell(productId: string, col: Col) {
    const el = cells.current.get(`${productId}:${col}`);
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  // Tras agregar un producto, el cursor queda listo en su cantidad.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    if (focusCell(id, "qty")) {
      pendingFocus.current = null;
      setFlashId(id);
      const timer = window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1400);
      return () => window.clearTimeout(timer);
    }
  }, [lines]);

  // Producto nuevo: se agrega una línea. Si ya estaba, NO se suma nada: se lleva el cursor a su cantidad
  // (resaltada) para que la cambies tú.
  function addHit(hit: ProductHit) {
    const exists = lines.some((l) => l.product_id === hit.id);
    pendingFocus.current = hit.id;
    if (!exists) {
      onChange([...lines, lineFromHit(hit, mode, warehouseId)]);
      return;
    }
    if (focusCell(hit.id, "qty")) {
      pendingFocus.current = null;
      cells.current.get(`${hit.id}:qty`)?.select();
      setFlashId(hit.id);
      window.setTimeout(() => setFlashId((cur) => (cur === hit.id ? null : cur)), 1400);
    }
  }

  function patch(index: number, change: Partial<Line>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));
  }

  function remove(index: number) {
    const next = lines.filter((_, i) => i !== index);
    onChange(next);
  }

  function onCellKey(index: number, col: Col) {
    return (e: KeyboardEvent<HTMLElement>) => {
      const line = lines[index];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const target = lines[index + (e.key === "ArrowDown" ? 1 : -1)];
        if (target) {
          e.preventDefault();
          focusCell(target.product_id, col);
        }
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const nextCol = cols[cols.indexOf(col) + 1];
      if (nextCol) {
        focusCell(line.product_id, nextCol);
        return;
      }
      const nextLine = lines[index + 1];
      if (nextLine) focusCell(nextLine.product_id, cols[0]);
      else setModalOpen(true);
    };
  }

  const total = lines.reduce((sum, l) => sum + l.qty * l.unit_cost * (1 + l.tax_rate / 100), 0);
  const activeWarehouses = (warehouses ?? []).filter((w) => w.active);
  const grid = isPurchase
    ? "md:grid-cols-[minmax(0,2.4fr)_minmax(130px,1.1fr)_96px_150px_84px_120px_40px]"
    : "md:grid-cols-[minmax(0,2.4fr)_96px_120px_96px_40px]";
  const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide md:hidden";

  return (
    <div className="space-y-3">
      <ProductPicker
        storeId={storeId}
        warehouseId={isPurchase ? null : warehouseId}
        excludeIds={isPurchase ? undefined : lines.map((l) => l.product_id)}
        addedQty={isPurchase ? addedQty : undefined}
        inputRef={searchRef}
        placeholder={lines.length ? "🔎 Buscar otro producto (nombre, SKU o código de barras)…" : "🔎 Busca el primer producto: nombre, SKU o código de barras…"}
        onPick={addHit}
      />

      {lines.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>
          Busca y elige un producto: el cursor pasa directo a la <b>cantidad</b>. Escribe y presiona <b>Enter</b> para seguir con el costo, el IVA y el siguiente producto.
        </p>
      ) : (
        <div className="space-y-2">
          <div
            className={`hidden gap-3 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide md:grid ${grid}`}
            style={{ color: "var(--t-muted)", background: "color-mix(in oklab, var(--t-card-bg) 60%, transparent)" }}
          >
            <span>Producto</span>
            {isPurchase ? <span>Bodega destino</span> : null}
            <span className="text-right">{isPurchase ? "Cantidad" : "Contado"}</span>
            {isPurchase ? <span className="text-right">Costo unit.</span> : <span className="text-right">En bodega</span>}
            {isPurchase ? <span className="text-right">IVA</span> : null}
            <span className="text-right">{isPurchase ? "Total" : "Diferencia"}</span>
            <span />
          </div>
          <AnimatePresence initial={false}>
            {lines.map((line, index) => {
              const diff = line.qty - line.current;
              const flash = flashId === line.product_id;
              return (
                <motion.div
                  key={line.product_id}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                  className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 rounded-2xl border p-3 transition-colors duration-500 md:gap-y-0 md:py-2 ${grid}`}
                  style={{
                    borderColor: flash ? "color-mix(in oklab, #22c55e 55%, transparent)" : "var(--t-card-border)",
                    background: flash ? "color-mix(in oklab, #22c55e 10%, transparent)" : "color-mix(in oklab, var(--t-card-bg) 55%, transparent)",
                  }}
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
                    <span className="hidden w-5 shrink-0 text-center text-xs tabular-nums md:block" style={{ color: "var(--t-muted)" }}>{index + 1}</span>
                    <Thumb src={lineThumbs[line.product_id]} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold" title={line.name}>{line.name}</div>
                      {line.sku ? <div className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{line.sku}</div> : null}
                      {isPurchase ? <LineNote value={line.note ?? ""} name={line.name} onChange={(v) => patch(index, { note: v })} /> : null}
                      {lineExtra ? lineExtra(line) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs transition hover:brightness-125 md:hidden"
                      style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)", color: "#ef4444" }}
                      aria-label={`Quitar ${line.name}`}
                    >
                      ✕
                    </button>
                  </div>
                  {isPurchase ? (
                    <div className="col-span-2 md:col-span-1">
                      <span className={label} style={{ color: "var(--t-muted)" }}>Bodega destino</span>
                      <select
                        className={inputClass}
                        style={inputStyle}
                        value={line.warehouse_id}
                        onChange={(e) => patch(index, { warehouse_id: e.target.value })}
                        aria-label={`Bodega destino de ${line.name}`}
                      >
                        {activeWarehouses.map((w) => (
                          <option key={w.id} value={w.id}>{w.kind === "point" ? "📍 " : "🏬 "}{w.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <span className={label} style={{ color: "var(--t-muted)" }}>{isPurchase ? "Cantidad" : "Contado"}</span>
                    <CellNumber
                      ariaLabel={`Cantidad de ${line.name}`}
                      value={line.qty}
                      min={0}
                      max={1000000}
                      inputRef={cellRef(line.product_id, "qty")}
                      onKeyDown={onCellKey(index, "qty")}
                      onValue={(v) => patch(index, { qty: v })}
                    />
                  </div>
                  {isPurchase ? (
                    <div>
                      <span className={label} style={{ color: "var(--t-muted)" }}>Costo unit.</span>
                      <div onKeyDown={onCellKey(index, "cost")} ref={(el) => cellRef(line.product_id, "cost")(el?.querySelector("input") ?? null)}>
                        <MoneyInput
                          className={`${inputClass} text-right`}
                          style={inputStyle}
                          ariaLabel={`Costo unitario de ${line.name}`}
                          value={line.unit_cost}
                          onValueChange={(v) => patch(index, { unit_cost: v ?? 0 })}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-right text-sm">
                      <span className={label} style={{ color: "var(--t-muted)" }}>En bodega</span>
                      {line.current}
                    </div>
                  )}
                  {isPurchase ? (
                    <div>
                      <span className={label} style={{ color: "var(--t-muted)" }}>IVA</span>
                      <CellNumber
                        ariaLabel={`IVA de ${line.name}`}
                        value={line.tax_rate}
                        decimals
                        min={0}
                        max={100}
                        suffix="%"
                        inputRef={cellRef(line.product_id, "tax")}
                        onKeyDown={onCellKey(index, "tax")}
                        onValue={(v) => patch(index, { tax_rate: v })}
                      />
                    </div>
                  ) : null}
                  {isPurchase ? (
                    <div className="text-right">
                      <span className={label} style={{ color: "var(--t-muted)" }}>Total</span>
                      <span className="text-sm font-bold tabular-nums">{money(line.qty * line.unit_cost * (1 + line.tax_rate / 100))}</span>
                    </div>
                  ) : (
                    <div className="text-right" style={{ color: diff === 0 ? "var(--t-muted)" : diff > 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                      <span className={label} style={{ color: "var(--t-muted)" }}>Diferencia</span>
                      {diff > 0 ? `+${diff}` : diff}
                    </div>
                  )}
                  <div className="hidden justify-end md:flex">
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="grid h-8 w-8 place-items-center rounded-full border text-xs transition hover:brightness-125"
                      style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)", color: "#ef4444" }}
                      title="Quitar"
                      aria-label={`Quitar ${line.name}`}
                    >
                      ✕
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-3 text-sm font-semibold transition hover:-translate-y-0.5"
            style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", color: "var(--t-accent)" }}
          >
            <span className="grid h-7 w-7 place-items-center rounded-full text-base transition group-hover:scale-110" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }}>＋</span>
            Agregar otro producto
          </button>

          {isPurchase ? (
            <p className="text-right text-sm" style={{ color: "var(--t-muted)" }}>
              {lines.length} producto{lines.length === 1 ? "" : "s"} · {lines.reduce((s, l) => s + l.qty, 0)} und. · Total factura (con IVA){" "}
              <b className="text-base" style={{ color: "var(--t-text)" }}>{money(total)}</b>
            </p>
          ) : null}
        </div>
      )}

      <ProductSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        storeId={storeId}
        warehouseId={isPurchase ? null : warehouseId}
        excludeIds={isPurchase ? undefined : lines.map((l) => l.product_id)}
        addedQty={isPurchase ? addedQty : undefined}
        title={isPurchase ? "Agregar producto a la factura" : "Agregar producto al conteo"}
        onPick={addHit}
      />
    </div>
  );
}
