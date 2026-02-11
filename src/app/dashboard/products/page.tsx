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

/* ========= UI ========= */
function clsWrap() {
  return "rounded-[22px] border border-white/10 bg-white/5 backdrop-blur-xl";
}
function clsInput() {
  return "w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl";
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

export default function ProductsListPage() {
  const [loading, setLoading] = useState(true);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // filters
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 250);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");

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
      const sb = b.stock === null ? Number.POSITIVE_INFINITY : Number(b.stock ?? 0);
      return sb - sa;
    });

    return arr;
  }, [products, dq, statusFilter, stockFilter, categoryFilter, sortBy]);

  // ✅ Altura del header (para dejar espacio arriba). Si quieres más/menos, cambia este número.
  const HEADER_H = 230; // px aprox (en desktop). En móvil igual funciona bien.

  return (
    <main className="px-3 py-3 sm:p-6">
      {/* ✅ HEADER FIJO: NO se mueve con el scroll */}
      <div className="fixed top-0 left-0 right-0 z-50">
        {/* Fondo sólido para que no se vea la lista detrás */}
        <div className="bg-[#0b0b0b]/92 backdrop-blur-2xl px-3 py-3 sm:px-6 sm:py-6">
          <div className={`${clsWrap()} p-3 sm:p-5`}>
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
                  disabled={loading}
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

            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
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

            <p className="mt-2 text-[11px] sm:text-xs text-white/60">
              Tip: con 10.000 productos, escribir 2–3 letras filtra rapidísimo.
            </p>
          </div>
        </div>
      </div>

      {/* ✅ ESPACIO ARRIBA para que la lista no quede debajo del header */}
      <div style={{ height: HEADER_H }} />

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className={`${clsWrap()} p-6 text-sm text-white/70`}>Cargando productos…</div>
        ) : filtered.length === 0 ? (
          <div className={`${clsWrap()} p-6`}>
            <p className="font-semibold">No hay resultados</p>
            <p className="text-sm text-white/70 mt-1">Prueba cambiando filtros o la búsqueda.</p>
          </div>
        ) : (
          <div className={`${clsWrap()} overflow-hidden`}>
            {filtered.map((p) => {
              const out = p.stock !== null && p.stock <= 0;

              return (
                <div key={p.id} className="border-b border-white/10">
                  <div className="w-full px-3 py-3 flex items-center gap-3">
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

                      {/* ✅ Mayorista → Detal → Fecha */}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                        <span>
                          Mayorista: <b className="text-white/90">{money(p.price_wholesale)}</b>
                        </span>
                        <span className="text-white/30">·</span>
                        <span>
                          Detal: <b className="text-white/90">{money(p.price_retail)}</b>
                        </span>
                        <span className="text-white/30">·</span>
                        <span className="text-white/60">{formatDate(p.created_at)}</span>
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

            <div className="p-3 text-xs text-white/50">
              {storeId ? "Mostrando productos de tu tienda." : "Detectando tienda…"}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
