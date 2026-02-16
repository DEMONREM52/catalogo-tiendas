"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

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

/* ========= UI (✅ soporta tema oscuro y claro) =========
   Requisito: "las letras sean negras en el tema claro"
   - Usamos text-slate-900 (claro) y dark:text-white (oscuro)
   - Igual para inputs, botones, chips, bordes y header fijo
======================================================= */
function clsWrap() {
  return [
    "rounded-[22px] border backdrop-blur-xl",
    "border-slate-200/70 bg-white/70 text-slate-900",
    "dark:border-white/10 dark:bg-white/5 dark:text-white",
  ].join(" ");
}
function clsInput() {
  return [
    "w-full rounded-2xl border p-3 text-sm outline-none backdrop-blur-xl",
    "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400",
    "dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/40",
  ].join(" ");
}
function clsBtnSoft() {
  return [
    "rounded-2xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition disabled:opacity-60",
    "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
    "dark:border-white/10 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10",
  ].join(" ");
}
function clsBtnPrimary() {
  return [
    "rounded-2xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
    // claro
    "border-fuchsia-300 bg-fuchsia-100 text-slate-900 hover:bg-fuchsia-200",
    // oscuro
    "dark:border-fuchsia-400/30 dark:bg-fuchsia-500/15 dark:text-fuchsia-100 dark:hover:bg-fuchsia-500/25",
    "dark:shadow-[0_0_22px_rgba(217,70,239,0.15)]",
  ].join(" ");
}
function clsChipBase() {
  return [
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold",
    "text-slate-900 dark:text-white",
  ].join(" ");
}

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}
function stockLabel(stock: number | null) {
  if (stock === null) return "∞ Ilimitado";
  if (stock <= 0) return "Agotado";
  return `${stock} disp.`;
}
function clampNum(raw: any, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
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
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/* ========= Avatar (letra + color bonito) =========
   ✅ En tema claro: letra NEGRA
   ✅ En tema oscuro: letra clara
=================================================== */
function hashToIndex(seed: string, mod: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}
function avatarClass(seed: string) {
  const palette = [
    // claro -> text-slate-900 ; oscuro -> text-fuchsia-100, etc.
    "bg-fuchsia-200/70 border-fuchsia-300 text-slate-900 dark:bg-fuchsia-500/15 dark:border-fuchsia-400/25 dark:text-fuchsia-100",
    "bg-emerald-200/70 border-emerald-300 text-slate-900 dark:bg-emerald-500/15 dark:border-emerald-400/25 dark:text-emerald-100",
    "bg-sky-200/70 border-sky-300 text-slate-900 dark:bg-sky-500/15 dark:border-sky-400/25 dark:text-sky-100",
    "bg-amber-200/70 border-amber-300 text-slate-900 dark:bg-amber-500/15 dark:border-amber-400/25 dark:text-amber-100",
    "bg-rose-200/70 border-rose-300 text-slate-900 dark:bg-rose-500/15 dark:border-rose-400/25 dark:text-rose-100",
    "bg-violet-200/70 border-violet-300 text-slate-900 dark:bg-violet-500/15 dark:border-violet-400/25 dark:text-violet-100",
  ];
  return palette[hashToIndex(seed, palette.length)];
}
function firstLetter(name: string) {
  const t = (name ?? "").trim();
  return (t[0] || "?").toUpperCase();
}

/* ========= Paging helpers ========= */
const PAGE_SIZE = 20;

// Cursor por created_at (ISO). Para evitar duplicados si hay mismos created_at, también pedimos id.
type Cursor = { created_at: string; id: string } | null;

export default function ProductsListPage() {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // pagination state
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(true);

  // filters
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 250);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");

  async function ensureAuthAndStore() {
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
      return { sb, storeId: null as string | null };
    }

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
      return { sb, storeId: null as string | null };
    }

    return { sb, storeId: storeData.id as string };
  }

  async function loadCategories(sb: any, sId: string) {
    const { data: cats, error: catsErr } = await sb
      .from("product_categories")
      .select("id,name")
      .eq("store_id", sId)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (catsErr) throw catsErr;
    setCategories((cats as any[]) ?? []);
  }

  function normalizeProducts(rows: any[]): Product[] {
    return (rows ?? []).map((p) => ({
      ...p,
      price_retail: clampNum(p.price_retail, 0),
      price_wholesale: clampNum(p.price_wholesale, 0),
      min_wholesale: Math.max(1, clampNum(p.min_wholesale, 1)),
      stock:
        p.stock === null || p.stock === undefined
          ? null
          : Math.max(0, Math.floor(clampNum(p.stock, 0))),
    }));
  }

  function computeNextCursor(list: Product[]): Cursor {
    if (!list.length) return null;
    const last = list[list.length - 1];
    return { created_at: String(last.created_at), id: String(last.id) };
  }

  async function loadFirstPage() {
    setLoading(true);
    try {
      const { sb, storeId: sId } = await ensureAuthAndStore();
      if (!sId) return;

      setStoreId(sId);
      await loadCategories(sb, sId);

      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock"
        )
        .eq("store_id", sId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const normalized = normalizeProducts((data as any[]) ?? []);
      setProducts(normalized);

      // hasMore si vino lleno
      setHasMore(normalized.length === PAGE_SIZE);
      setCursor(computeNextCursor(normalized));
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

  async function loadMore() {
    if (loadingMore || !hasMore || !storeId) return;
    if (!cursor) return;

    setLoadingMore(true);
    try {
      const sb = supabaseBrowser();

      // Traemos la siguiente página: created_at más viejo que el cursor.
      // O si created_at igual, id menor (para evitar duplicados).
      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock"
        )
        .eq("store_id", storeId)
        .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const next = normalizeProducts((data as any[]) ?? []);

      setProducts((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev, ...next.filter((x) => !seen.has(x.id))];
        return merged;
      });

      setHasMore(next.length === PAGE_SIZE);

      // Actualiza cursor al último de "next" (si vino vacío, ya no hay más)
      if (next.length > 0) {
        setCursor(computeNextCursor(next));
      }
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando más",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function reloadAll() {
    // Reset paginación y vuelve a cargar
    setProducts([]);
    setCursor(null);
    setHasMore(true);
    await loadFirstPage();
  }

  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();

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
      const sb2 = b.stock === null ? Number.POSITIVE_INFINITY : Number(b.stock ?? 0);
      return sb2 - sa;
    });

    return arr;
  }, [products, dq, statusFilter, stockFilter, categoryFilter, sortBy]);

  // ✅ Altura del header (para dejar espacio arriba). Ajusta si quieres.
  const HEADER_H = 230;

  return (
    <main className="px-3 py-3 sm:p-6 text-slate-900 dark:text-white">
      {/* ✅ HEADER FIJO */}
      <div className="fixed left-0 right-0 top-0 z-50">
        <div className="bg-white/85 text-slate-900 backdrop-blur-2xl px-3 py-3 sm:px-6 sm:py-6 dark:bg-[#0b0b0b]/92 dark:text-white">
          <div className={`${clsWrap()} p-3 sm:p-5`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-tight sm:text-2xl">Productos</h1>
                <p className="text-[11px] text-slate-600 sm:text-sm dark:text-white/70">
                  Cargados: <b className="text-slate-900 dark:text-white/90">{products.length}</b> · Mostrando:{" "}
                  <b className="text-slate-900 dark:text-white/90">{filtered.length}</b>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className={clsBtnSoft()}
                  onClick={reloadAll}
                  disabled={loading || loadingMore}
                  type="button"
                  style={{ padding: "8px 10px", fontSize: 12 }}
                >
                  Recargar
                </button>

                <Link
                  href="/dashboard/products/crear"
                  className={clsBtnPrimary()}
                  style={{ padding: "8px 10px", fontSize: 12 }}
                >
                  + Crear
                </Link>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px]">
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

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            </div>

            <p className="mt-2 text-[11px] text-slate-600 sm:text-xs dark:text-white/60">
              (Cargando en bloques de {PAGE_SIZE}. Usa “Cargar más” al final)
            </p>
          </div>
        </div>
      </div>

      {/* espacio arriba */}
      <div style={{ height: HEADER_H }} />

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className={`${clsWrap()} p-6 text-sm text-slate-700 dark:text-white/70`}>Cargando productos…</div>
        ) : filtered.length === 0 ? (
          <div className={`${clsWrap()} p-6`}>
            <p className="font-semibold">No hay resultados</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-white/70">Prueba cambiando filtros o la búsqueda.</p>
          </div>
        ) : (
          <div className={`${clsWrap()} overflow-hidden`}>
            {filtered.map((p) => {
              const out = p.stock !== null && p.stock <= 0;
              const letter = firstLetter(p.name);

              return (
                <div key={p.id} className="border-b border-slate-200/70 dark:border-white/10">
                  <div className="flex w-full items-center gap-3 px-3 py-3">
                    {/* Avatar letra */}
                    <div
                      className={`h-12 w-12 shrink-0 rounded-2xl border flex items-center justify-center ${avatarClass(
                        p.id
                      )}`}
                      title={p.name}
                      aria-hidden="true"
                    >
                      <span className="text-base font-extrabold">{letter}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{p.name}</p>

                        {!p.active ? (
                          <span
                            className={`${clsChipBase()} border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white/70`}
                          >
                            Inactivo
                          </span>
                        ) : null}

                        <span
                          className={`${clsChipBase()} ${
                            out
                              ? "border-red-300 bg-red-100 text-slate-900 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100"
                              : "border-emerald-300 bg-emerald-100 text-slate-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                          }`}
                        >
                          {stockLabel(p.stock)}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-white/70">
                        <span>
                          Mayorista: <b className="text-slate-900 dark:text-white/90">{money(p.price_wholesale)}</b>
                        </span>
                        <span className="text-slate-300 dark:text-white/30">·</span>
                        <span>
                          Detal: <b className="text-slate-900 dark:text-white/90">{money(p.price_retail)}</b>
                        </span>
                        <span className="text-slate-300 dark:text-white/30">·</span>
                        <span className="text-slate-500 dark:text-white/60">{formatDate(p.created_at)}</span>
                      </div>
                    </div>

                    <Link
                      href={`/dashboard/products/${p.id}`}
                      className={clsBtnSoft()}
                      style={{ padding: "8px 10px", fontSize: 12 }}
                    >
                      Editar →
                    </Link>
                  </div>
                </div>
              );
            })}

            {/* ✅ BOTÓN CARGAR MÁS */}
            <div className="flex items-center justify-center p-3">
              {hasMore ? (
                <button className={clsBtnPrimary()} type="button" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Cargando…" : "Cargar más"}
                </button>
              ) : (
                <div className="text-xs text-slate-500 dark:text-white/50">
                  {storeId ? "No hay más productos por cargar." : "Detectando tienda…"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
