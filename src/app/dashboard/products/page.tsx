"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../store/ImageUpload";

type Category = { id: string; name: string };

type Product = {
  id: string;
  store_id: string;
  created_at: string;
  name: string;
  description: string | null;

  price_retail: number;
  price_wholesale: number;
  min_wholesale: number;

  active: boolean;
  image_url: string | null;
  category_id: string | null;

  stock: number | null; // null = ilimitado
};

type StatusFilter = "all" | "active" | "inactive";
type StockFilter = "all" | "in" | "out" | "unlimited";
type SortBy = "newest" | "name" | "price" | "stock";

/* =========================
   Helpers
========================= */
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

function stockLabel(stock: number | null) {
  if (stock === null) return "∞ Ilimitado";
  if (stock <= 0) return "Agotado";
  return `${stock} disp.`;
}

function digitsOnlyToNumber(raw: string, fallback = 0) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return fallback;
  const n = Number(digits);
  return Number.isFinite(n) ? n : fallback;
}

function clampIntOrNull(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

function clampNum(raw: any, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Excel-like select-all */
function excelSelectHandlers() {
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      requestAnimationFrame(() => {
        try {
          el.select();
        } catch {}
      });
    },
    onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      if (document.activeElement !== el) {
        e.preventDefault();
        el.focus();
      }
    },
  };
}

/** Debounce */
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function clsInput() {
  return "w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl";
}
function clsInputSoft() {
  return "w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm outline-none placeholder:text-white/40";
}
function clsBtnSoft() {
  return "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/10 disabled:opacity-60";
}
function clsBtnPrimary() {
  return "rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-500/25 disabled:opacity-60";
}
function clsChip() {
  return "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold";
}

/* =========================
   Swipe down close (mobile)
========================= */
function useSwipeDownToClose(onClose: () => void) {
  const startY = useRef<number | null>(null);
  const lastY = useRef<number | null>(null);
  const dragging = useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? null;
    lastY.current = startY.current;
    dragging.current = true;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!dragging.current) return;
    lastY.current = e.touches[0]?.clientY ?? null;
  }
  function onTouchEnd() {
    if (!dragging.current) return;
    dragging.current = false;

    const sy = startY.current;
    const ly = lastY.current;
    startY.current = null;
    lastY.current = null;

    if (sy == null || ly == null) return;
    const delta = ly - sy;
    if (delta > 90) onClose();
  }

  return { onTouchStart, onTouchMove, onTouchEnd };
}

/** Bottom sheet simple para filtros (mobile) */
function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="absolute inset-x-0 bottom-0">
        <div className="rounded-t-[28px] border border-white/10 bg-[#0b0b0b] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 p-4 border-b border-white/10">
            <div className="min-w-0">
              <div className="h-1.5 w-12 rounded-full bg-white/20 mx-auto mb-2" />
              <p className="text-sm font-semibold">{title}</p>
            </div>
            <button type="button" className={clsBtnSoft()} onClick={onClose}>
              Cerrar
            </button>
          </div>

          <div className="p-4 max-h-[70vh] overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Page
========================= */
export default function ProductsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // filters
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 250);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [onlyWithImage, setOnlyWithImage] = useState(false);

  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");

  const [sortBy, setSortBy] = useState<SortBy>("newest");

  // UI: filtros en mobile como sheet
  const [filtersOpen, setFiltersOpen] = useState(false);

  // editor
  const [selected, setSelected] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);

  // list
  const parentRef = useRef<HTMLDivElement | null>(null);

  const isDirty = useMemo(() => {
    if (!selected || !draft) return false;
    return JSON.stringify(selected) !== JSON.stringify(draft);
  }, [selected, draft]);

  async function loadAll() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;

      if (!userData.user) {
        await Swal.fire({
          icon: "error",
          title: "Debes iniciar sesión",
          background: "#0b0b0b",
          color: "#fff",
        });
        return;
      }
      setUserId(userData.user.id);

      const { data: storeData, error: storeErr } = await sb
        .from("stores")
        .select("id")
        .eq("owner_id", userData.user.id)
        .maybeSingle();

      if (storeErr) throw storeErr;
      if (!storeData) {
        await Swal.fire({
          icon: "error",
          title: "No se encontró tu tienda",
          background: "#0b0b0b",
          color: "#fff",
        });
        return;
      }
      setStoreId(storeData.id);

      const { data: cats, error: catsErr } = await sb
        .from("product_categories")
        .select("id,name")
        .eq("store_id", storeData.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (catsErr) throw catsErr;
      setCategories((cats as any[]) ?? []);

      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock"
        )
        .eq("store_id", storeData.id)
        .order("created_at", { ascending: false })
        .limit(20000);

      if (error) throw error;

      setProducts(
        ((data as any[]) ?? []).map((p) => ({
          ...p,
          price_retail: clampNum(p.price_retail, 0),
          price_wholesale: clampNum(p.price_wholesale, 0),
          min_wholesale: Math.max(1, clampNum(p.min_wholesale, 1)),
          stock:
            p.stock === null || p.stock === undefined
              ? null
              : Math.max(0, Math.floor(clampNum(p.stock, 0))),
        }))
      );
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando productos",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters() {
    setQ("");
    setStatusFilter("all");
    setStockFilter("all");
    setCategoryFilter("all");
    setOnlyWithImage(false);
    setMinPrice("");
    setMaxPrice("");
    setSortBy("newest");
  }

  function patchProduct(id: string, patch: Partial<Product>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (q.trim()) n++;
    if (statusFilter !== "all") n++;
    if (stockFilter !== "all") n++;
    if (categoryFilter !== "all") n++;
    if (onlyWithImage) n++;
    if (minPrice.trim()) n++;
    if (maxPrice.trim()) n++;
    if (sortBy !== "newest") n++;
    return n;
  }, [q, statusFilter, stockFilter, categoryFilter, onlyWithImage, minPrice, maxPrice, sortBy]);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();
    const minP = minPrice.trim() ? clampNum(minPrice, 0) : null;
    const maxP = maxPrice.trim() ? clampNum(maxPrice, 0) : null;

    let arr = products.filter((p) => {
      if (statusFilter === "active" && !p.active) return false;
      if (statusFilter === "inactive" && p.active) return false;

      const out = p.stock !== null && p.stock <= 0;
      const unlimited = p.stock === null;

      if (stockFilter === "in") {
        if (!unlimited && (p.stock ?? 0) <= 0) return false;
      }
      if (stockFilter === "out") {
        if (!out) return false;
      }
      if (stockFilter === "unlimited") {
        if (!unlimited) return false;
      }

      if (categoryFilter !== "all" && p.category_id !== categoryFilter) return false;
      if (onlyWithImage && !p.image_url) return false;

      if (minP !== null && Number(p.price_retail ?? 0) < minP) return false;
      if (maxP !== null && Number(p.price_retail ?? 0) > maxP) return false;

      if (!s) return true;
      const txt = `${p.name} ${p.description ?? ""}`.toLowerCase();
      return txt.includes(s);
    });

    arr = [...arr];
    arr.sort((a, b) => {
      if (sortBy === "newest") return String(b.created_at).localeCompare(String(a.created_at));
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "price") return Number(a.price_retail ?? 0) - Number(b.price_retail ?? 0);

      const sa = a.stock === null ? Number.POSITIVE_INFINITY : Number(a.stock ?? 0);
      const sb = b.stock === null ? Number.POSITIVE_INFINITY : Number(b.stock ?? 0);
      return sb - sa;
    });

    return arr;
  }, [
    products,
    dq,
    statusFilter,
    stockFilter,
    categoryFilter,
    onlyWithImage,
    minPrice,
    maxPrice,
    sortBy,
  ]);

  // ✅ CLAVE: altura fija para móvil (evita que se monten)
  const ROW_H = 96;

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 18,
  });

  function openEditor(p: Product) {
    setSelected(p);
    setDraft({ ...p });
  }

  async function tryCloseEditor() {
    if (!selected || !draft) {
      setSelected(null);
      setDraft(null);
      return;
    }
    if (!isDirty) {
      setSelected(null);
      setDraft(null);
      return;
    }

    const res = await Swal.fire({
      icon: "warning",
      title: "Tienes cambios sin guardar",
      text: "¿Quieres cerrar sin guardar?",
      showCancelButton: true,
      confirmButtonText: "Cerrar sin guardar",
      cancelButtonText: "Seguir editando",
      confirmButtonColor: "#ef4444",
      background: "#0b0b0b",
      color: "#fff",
    });

    if (res.isConfirmed) {
      setSelected(null);
      setDraft(null);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const payload = {
        name: draft.name,
        description: draft.description,
        price_retail: clampNum(draft.price_retail, 0),
        price_wholesale: clampNum(draft.price_wholesale, 0),
        min_wholesale: Math.max(1, clampNum(draft.min_wholesale, 1)),
        stock: draft.stock === null ? null : Math.max(0, Math.floor(clampNum(draft.stock, 0))),
        active: !!draft.active,
        image_url: draft.image_url,
        category_id: draft.category_id || null,
      };

      const { error } = await sb.from("products").update(payload).eq("id", draft.id);
      if (error) throw error;

      patchProduct(draft.id, payload as any);

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        timer: 850,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });

      setSelected(null);
      setDraft(null);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft() {
    if (!draft) return;

    const res = await Swal.fire({
      icon: "warning",
      title: "¿Eliminar producto?",
      text: `Se eliminará "${draft.name}"`,
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonText: "Cancelar",
      confirmButtonText: "Sí, eliminar",
      background: "#0b0b0b",
      color: "#fff",
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.from("products").delete().eq("id", draft.id);
      if (error) throw error;

      setProducts((prev) => prev.filter((p) => p.id !== draft.id));
      setSelected(null);
      setDraft(null);

      await Swal.fire({
        icon: "success",
        title: "Eliminado",
        timer: 850,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error eliminando",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  const drawerSwipe = useSwipeDownToClose(() => void tryCloseEditor());

  return (
    <main className="px-3 py-3 sm:p-6 space-y-3 panel-enter">
      {/* Header sticky */}
      <div className="sticky top-2 z-10">
        <div className="rounded-[22px] border border-white/10 bg-white/5 backdrop-blur-xl p-3 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold leading-tight">Productos</h1>
              <p className="text-[11px] sm:text-sm text-white/70">
                Total: <b className="text-white/90">{products.length}</b> · Filtrados:{" "}
                <b className="text-white/90">{filtered.length}</b>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                className={clsBtnSoft()}
                onClick={loadAll}
                disabled={saving}
                type="button"
                style={{ padding: "8px 10px", fontSize: 12 }}
              >
                Recargar
              </button>

              <button
                className={clsBtnSoft()}
                onClick={() => setFiltersOpen(true)}
                disabled={saving}
                type="button"
                style={{ padding: "8px 10px", fontSize: 12 }}
              >
                Filtros
                {activeFilterCount > 0 ? (
                  <span className={`${clsChip()} ml-2 border-white/10 bg-white/10 text-white/90`}>
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2">
            <input
              className={clsInput()}
              placeholder="Buscar (nombre o descripción)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={loading}
            />

            <select
              className={clsInput()}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              disabled={loading}
            >
              <option value="newest">Más nuevos</option>
              <option value="name">Nombre</option>
              <option value="price">Precio detal</option>
              <option value="stock">Stock</option>
            </select>
          </div>

          <p className="mt-2 text-[11px] sm:text-xs text-white/60">
            Tip: con 10.000 productos, escribir 2–3 letras filtra rapidísimo.
          </p>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="rounded-[22px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl text-sm text-white/70">
          Cargando productos…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[22px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="font-semibold">No hay resultados</p>
          <p className="text-sm text-white/70 mt-1">Prueba cambiando filtros o la búsqueda.</p>
          <button className={`${clsBtnSoft()} mt-3`} type="button" onClick={resetFilters}>
            Reset filtros
          </button>
        </div>
      ) : (
        <div className="rounded-[22px] border border-white/10 bg-white/5 overflow-hidden backdrop-blur-xl">
          <div ref={parentRef} className="h-[72vh] overflow-auto">
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const p = filtered[vRow.index];
                if (!p) return null;

                const out = p.stock !== null && p.stock <= 0;

                return (
                  <div
                    key={p.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vRow.start}px)`,
                      height: ROW_H,
                    }}
                    className="border-b border-white/10"
                  >
                    <button
                      type="button"
                      onClick={() => openEditor(p)}
                      className="w-full h-full text-left hover:bg-white/[0.06] transition"
                    >
                      <div className="flex items-center gap-3 px-3 py-3">
                        <div className="h-12 w-12 rounded-2xl border border-white/10 bg-white/5 overflow-hidden shrink-0">
                          {p.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.image_url}
                              alt={p.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-xs text-white/40">
                              —
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold truncate">{p.name}</p>

                            {!p.active ? (
                              <span className={`${clsChip()} border-white/10 bg-white/10 text-white/70`}>
                                Inactivo
                              </span>
                            ) : null}

                            <span
                              className={`${clsChip()} ${
                                out
                                  ? "border-red-400/30 bg-red-500/10 text-red-100"
                                  : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                              }`}
                            >
                              {stockLabel(p.stock)}
                            </span>
                          </div>

                          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/70">
                            <span>
                              Detal: <b className="text-white/90">{money(p.price_retail)}</b>
                            </span>
                            <span className="text-white/30">·</span>
                            <span className="text-white/60">{formatDate(p.created_at)}</span>
                          </div>

                          {/* en móvil NO mostramos descripción para no romper altura */}
                          <p className="hidden sm:block mt-1 text-xs text-white/45 truncate">
                            {p.description ?? ""}
                          </p>
                        </div>

                        <div className="shrink-0 text-[11px] text-white/60">Editar →</div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom sheet filtros */}
      <BottomSheet open={filtersOpen} title="Filtros" onClose={() => setFiltersOpen(false)}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <select
              className={clsInput()}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              disabled={loading}
            >
              <option value="all">Estado: Todos</option>
              <option value="active">Estado: Activos</option>
              <option value="inactive">Estado: Inactivos</option>
            </select>

            <select
              className={clsInput()}
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
              disabled={loading}
            >
              <option value="all">Stock: Todos</option>
              <option value="in">Stock: Con stock</option>
              <option value="out">Stock: Agotados</option>
              <option value="unlimited">Stock: Ilimitados</option>
            </select>

            <select
              className={clsInput()}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              disabled={loading}
            >
              <option value="all">Categoría: Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
              <input
                type="checkbox"
                checked={onlyWithImage}
                onChange={() => setOnlyWithImage((v) => !v)}
                disabled={loading}
              />
              Solo con imagen
            </label>

            <input
              className={clsInput()}
              type="text"
              inputMode="numeric"
              placeholder="Precio detal mín"
              value={minPrice}
              {...excelSelectHandlers()}
              onChange={(e) => setMinPrice(e.target.value.replace(/[^\d]/g, ""))}
              disabled={loading}
            />

            <input
              className={clsInput()}
              type="text"
              inputMode="numeric"
              placeholder="Precio detal máx"
              value={maxPrice}
              {...excelSelectHandlers()}
              onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d]/g, ""))}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button className={clsBtnSoft()} type="button" onClick={resetFilters}>
              Reset
            </button>
            <button className={clsBtnSoft()} type="button" onClick={() => setFiltersOpen(false)}>
              Listo
            </button>
          </div>

          <p className="text-xs text-white/55">
            Consejo: en móvil usa 1–2 filtros máximo + búsqueda.
          </p>
        </div>
      </BottomSheet>

      {/* Drawer editor */}
      {selected && draft ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            onClick={() => void tryCloseEditor()}
            className="absolute inset-0 bg-black/60"
            aria-label="Cerrar"
          />

          <div className="absolute inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[560px]">
            <div
              className="h-[92vh] sm:h-full rounded-t-[28px] sm:rounded-l-[28px] sm:rounded-tr-none border border-white/10 bg-[#0b0b0b] shadow-2xl overflow-hidden"
              {...drawerSwipe}
            >
              <div className="h-full flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-white/10 bg-white/[0.04]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-12 rounded-full bg-white/20 sm:hidden" />
                        {isDirty ? (
                          <span className={`${clsChip()} border-amber-400/30 bg-amber-500/10 text-amber-100`}>
                            Cambios sin guardar
                          </span>
                        ) : (
                          <span className={`${clsChip()} border-white/10 bg-white/10 text-white/70`}>
                            Sin cambios
                          </span>
                        )}
                      </div>

                      <h2 className="mt-2 text-lg font-semibold truncate">{draft.name || "Producto"}</h2>
                      <p className="text-xs text-white/60">
                        Stock: <b className="text-white/80">{stockLabel(draft.stock)}</b> ·{" "}
                        {draft.active ? "Activo" : "Inactivo"}
                      </p>
                    </div>

                    <button className={clsBtnSoft()} onClick={() => void tryCloseEditor()} type="button">
                      Cerrar
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-28">
                  {/* Imagen */}
                  <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                    <p className="font-semibold">Imagen</p>
                    <p className="text-xs text-white/60">Se guarda cuando presionas Guardar.</p>

                    <div className="mt-3">
                      {userId ? (
                        <ImageUpload
                          label="Subir imagen"
                          currentUrl={draft.image_url}
                          pathPrefix={`${userId}/products/`}
                          fileName={`${draft.id}.png`}
                          bucket="product-images"
                          onUploaded={(url) => setDraft({ ...draft, image_url: url })}
                        />
                      ) : (
                        <div className="text-xs text-white/60">Cargando usuario…</div>
                      )}
                    </div>
                  </div>

                  {/* Nombre */}
                  <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                    <label className="text-xs text-white/70">Nombre</label>
                    <input
                      className={`mt-1 ${clsInputSoft()}`}
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </div>

                  {/* Desc */}
                  <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                    <label className="text-xs text-white/70">Descripción</label>
                    <textarea
                      className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm outline-none min-h-[90px]"
                      value={draft.description ?? ""}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>

                  {/* Quick toggles */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={clsBtnSoft()}
                      onClick={() => setDraft({ ...draft, active: !draft.active })}
                    >
                      {draft.active ? "Desactivar" : "Activar"}
                    </button>

                    <button
                      type="button"
                      className={clsBtnSoft()}
                      onClick={() => setDraft({ ...draft, stock: null })}
                    >
                      Stock ilimitado
                    </button>
                  </div>

                  {/* Precios / stock */}
                  <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                    <p className="font-semibold">Precios y stock</p>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-white/70">Precio Detal</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`mt-1 ${clsInputSoft()}`}
                          value={String(draft.price_retail ?? 0)}
                          {...excelSelectHandlers()}
                          onChange={(e) =>
                            setDraft({ ...draft, price_retail: digitsOnlyToNumber(e.target.value, 0) })
                          }
                        />
                      </div>

                      <div>
                        <label className="text-xs text-white/70">Precio Mayor</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`mt-1 ${clsInputSoft()}`}
                          value={String(draft.price_wholesale ?? 0)}
                          {...excelSelectHandlers()}
                          onChange={(e) =>
                            setDraft({ ...draft, price_wholesale: digitsOnlyToNumber(e.target.value, 0) })
                          }
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-xs text-white/70">Mínimo Mayor</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`mt-1 ${clsInputSoft()}`}
                          value={String(draft.min_wholesale ?? 1)}
                          {...excelSelectHandlers()}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              min_wholesale: Math.max(1, digitsOnlyToNumber(e.target.value, 1)),
                            })
                          }
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-xs text-white/70">Stock (vacío = ilimitado)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`mt-1 ${clsInputSoft()}`}
                          placeholder="Vacío = ilimitado"
                          value={draft.stock ?? ""}
                          {...excelSelectHandlers()}
                          onChange={(e) => setDraft({ ...draft, stock: clampIntOrNull(e.target.value) })}
                        />

                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className={clsBtnSoft()} onClick={() => setDraft({ ...draft, stock: 0 })}>
                            Agotado (0)
                          </button>
                          <button
                            type="button"
                            className={clsBtnSoft()}
                            onClick={() => setDraft({ ...draft, stock: Math.max(0, (draft.stock ?? 0) + 10) })}
                          >
                            +10
                          </button>
                          <button
                            type="button"
                            className={clsBtnSoft()}
                            onClick={() => setDraft({ ...draft, stock: Math.max(0, (draft.stock ?? 0) + 100) })}
                          >
                            +100
                          </button>
                          <button type="button" className={clsBtnSoft()} onClick={() => setDraft({ ...draft, stock: null })}>
                            Ilimitado
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Categoría */}
                  <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                    <label className="text-xs text-white/70">Categoría</label>
                    <select
                      className={`mt-1 ${clsInputSoft()}`}
                      value={draft.category_id ?? ""}
                      onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
                    >
                      <option value="">Sin categoría</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Footer fijo */}
                <div className="sticky bottom-0 p-4 border-t border-white/10 bg-[#0b0b0b]">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button className={clsBtnPrimary()} disabled={saving} onClick={() => void saveDraft()} type="button">
                      Guardar
                    </button>

                    <button
                      className={clsBtnSoft()}
                      disabled={saving}
                      onClick={() => void deleteDraft()}
                      type="button"
                      style={{
                        borderColor: "color-mix(in oklab, red 30%, var(--t-card-border))",
                        background: "color-mix(in oklab, red 10%, transparent)",
                        color: "color-mix(in oklab, white 85%, red 15%)",
                      }}
                    >
                      Eliminar
                    </button>
                  </div>

                  <p className="mt-2 text-[11px] text-white/50">En celular: desliza el panel hacia abajo para cerrar.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
