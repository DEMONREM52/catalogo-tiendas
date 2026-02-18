"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "@/app/dashboard/store/ImageUpload";

type StoreMini = { id: string; name: string; slug: string };
type Cat = { id: string; name: string };

type Product = {
  id: string;
  store_id: string;
  created_at: string;

  name: string;
  description: string | null;

  price_retail: number | null;
  price_wholesale: number | null;
  min_wholesale: number | null;

  stock: number | null; // null = ilimitado

  active: boolean; // DB
  active_draft?: boolean; // UI

  image_url: string | null;
  category_id: string | null;
};

type StatusFilter = "all" | "active" | "inactive" | "out";

/* =========================
   UI helpers (classes)
========================= */
function clsWrap() {
  return "ap-wrap rounded-[22px]";
}
function inputBase() {
  return "ap-input rounded-2xl p-3 text-sm outline-none";
}
function buttonGhost() {
  return "ap-btn ap-btn-ghost rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60";
}
function buttonPrimary() {
  return "ap-btn ap-btn-primary rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60";
}
function buttonDanger() {
  return "ap-btn ap-btn-danger rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60";
}
function clsChip() {
  return "ap-chip inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold";
}
function badgeActive(active: boolean) {
  return active ? "ap-pill ap-pill-on" : "ap-pill ap-pill-off";
}

/* =========================
   Data helpers
========================= */
function clampNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safeIntOrNull(v: any) {
  const t = String(v ?? "").trim();
  if (!t) return null; // vacío => ilimitado
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}
function isOutOfStock(stock: number | null) {
  return stock !== null && stock <= 0;
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
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

/* =========================
   Avatar (letra + color)
========================= */
function hashToIndex(seed: string, mod: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}
function avatarClass(seed: string) {
  const palette = ["ap-av-1", "ap-av-2", "ap-av-3", "ap-av-4", "ap-av-5", "ap-av-6"];
  return palette[hashToIndex(seed, palette.length)];
}
function firstLetter(name: string) {
  const t = (name ?? "").trim();
  return (t[0] || "?").toUpperCase();
}

/* =========================
   Normalización de búsqueda
========================= */
function norm(s: string) {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/* =========================
   Debounce
========================= */
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/* =========================
   Pagination
========================= */
const PAGE_SIZE = 20; // modo normal
const SEARCH_PAGE = 50; // ✅ búsqueda pro/paginada
type Cursor = { created_at: string; id: string } | null;

export default function AdminProductosPage() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [storeId, setStoreId] = useState<string>("");

  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 250);

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // paginado normal
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // paginado búsqueda
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreSearch, setHasMoreSearch] = useState(false);
  const [searching, setSearching] = useState(false);

  // cancelar requests viejos cuando el usuario sigue escribiendo
  const reqIdRef = useRef(0);

  const [openId, setOpenId] = useState<string | null>(null);

  const currentStore = useMemo(
    () => stores.find((s) => s.id === storeId) ?? null,
    [stores, storeId]
  );

  const isSearchMode = useMemo(() => dq.trim().length > 0, [dq]);

  function patch(id: string, p: Partial<Product>) {
    setProducts((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  function toggleActiveDraft(id: string) {
    setProducts((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const cur = x.active_draft ?? x.active;
        return { ...x, active_draft: !cur };
      })
    );
  }

  function setStockWithRule(id: string, newStock: number | null) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next: Product = { ...p, stock: newStock };
        if (newStock !== null && newStock <= 0) next.active_draft = false;
        return next;
      })
    );
  }

  function normalizeRows(rows: any[]): Product[] {
    return (rows ?? []).map((p: any) => ({
      ...p,
      price_retail: p.price_retail == null ? 0 : clampNum(p.price_retail, 0),
      price_wholesale: p.price_wholesale == null ? 0 : clampNum(p.price_wholesale, 0),
      min_wholesale: p.min_wholesale == null ? 1 : Math.max(1, clampNum(p.min_wholesale, 1)),
      stock:
        p.stock === null || p.stock === undefined
          ? null
          : Math.max(0, Math.floor(clampNum(p.stock, 0))),
      active_draft: p.active,
    }));
  }

  function computeCursor(list: Product[]): Cursor {
    if (!list.length) return null;
    const last = list[list.length - 1];
    return { created_at: String(last.created_at), id: String(last.id) };
  }

  /* =========================
     Loaders
  ========================= */
  async function loadStores() {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("stores")
      .select("id,name,slug")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const arr = (data as StoreMini[]) ?? [];
    setStores(arr);
    if (!storeId && arr[0]) setStoreId(arr[0].id);
  }

  async function loadCats(sid: string) {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("product_categories")
      .select("id,name")
      .eq("store_id", sid)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    setCats((data as Cat[]) ?? []);
  }

  async function loadFirstPage(sid: string) {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .eq("store_id", sid)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const normalized = normalizeRows((data as any[]) ?? []);
      setProducts(normalized);
      setCursor(computeCursor(normalized));
      setHasMore(normalized.length === PAGE_SIZE);
      setOpenId(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (isSearchMode) return;
    if (!storeId || !hasMore || loadingMore) return;
    if (!cursor) return;

    setLoadingMore(true);
    try {
      const sb = supabaseBrowser();
      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .eq("store_id", storeId)
        .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const next = normalizeRows((data as any[]) ?? []);
      setProducts((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...next.filter((x) => !seen.has(x.id))];
      });

      setHasMore(next.length === PAGE_SIZE);
      if (next.length > 0) setCursor(computeCursor(next));
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando más",
        text: e?.message ?? "Error",
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function reloadStoreData() {
    if (!storeId) return;

    // reset estados
    reqIdRef.current += 1; // cancela búsquedas previas
    setSearching(false);
    setSearchOffset(0);
    setHasMoreSearch(false);

    setProducts([]);
    setCursor(null);
    setHasMore(true);
    setOpenId(null);

    await Promise.all([loadCats(storeId), loadFirstPage(storeId)]);
  }

  /* ==========================================================
     ✅ BÚSQUEDA PRO (tipo WhatsApp) con RPC
     - requiere la función: public.search_products_pro(...)
     - trae 50 por página y rankea por similitud
  ========================================================== */
  async function runProSearchPage(sid: string, query: string, offset: number, append: boolean) {
    const sb = supabaseBrowser();
    const myReq = ++reqIdRef.current;

    setSearching(true);

    const { data, error } = await sb.rpc("search_products_pro", {
      p_store_id: sid,
      p_query: query,
      p_limit: SEARCH_PAGE,
      p_offset: offset,
      p_status: statusFilter, // 'all'|'active'|'inactive'
      p_category_id: categoryFilter === "all" ? null : categoryFilter,
    });

    // si ya cambió la búsqueda, ignorar este resultado
    if (reqIdRef.current !== myReq) return;

    if (error) {
      setSearching(false);
      throw error;
    }

    let rows = normalizeRows((data as any[]) ?? []);

    // statusFilter === "out" se filtra aquí (RPC no tiene este estado)
    if (statusFilter === "out") rows = rows.filter((p) => isOutOfStock(p.stock));

    setProducts((prev) => (append ? [...prev, ...rows] : rows));
    setSearchOffset(offset + SEARCH_PAGE);
    setHasMoreSearch(((data as any[]) ?? []).length === SEARCH_PAGE);

    // en modo búsqueda no usamos paginado normal
    setHasMore(false);
    setCursor(null);

    setSearching(false);
    setOpenId(null);
  }

  async function loadMoreSearch() {
    if (!storeId) return;
    if (!isSearchMode) return;
    if (searching || !hasMoreSearch) return;

    try {
      await runProSearchPage(storeId, dq.trim(), searchOffset, true);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando más resultados",
        text:
          e?.message ??
          "Si el error dice que no existe search_products_pro, pega el SQL del RPC en Supabase primero.",
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
      setSearching(false);
    }
  }

  /* =========================
     Effects
  ========================= */
  useEffect(() => {
    (async () => {
      try {
        await loadStores();
      } catch (e: any) {
        await Swal.fire({
          icon: "error",
          title: "Error",
          text: e?.message ?? "Error cargando tiendas",
          background: "var(--ap-bg-base)",
          color: "var(--ap-text)",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      try {
        await reloadStoreData();
      } catch (e: any) {
        await Swal.fire({
          icon: "error",
          title: "Error",
          text: e?.message ?? "Error cargando productos",
          background: "var(--ap-bg-base)",
          color: "var(--ap-text)",
        });
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  // ✅ Búsqueda dinámica PRO: cuando cambia texto o filtros
  useEffect(() => {
    if (!storeId) return;

    (async () => {
      const s = dq.trim();

      // cancelar request anterior y reset búsqueda
      reqIdRef.current += 1;
      setSearching(false);
      setSearchOffset(0);
      setHasMoreSearch(false);

      try {
        if (s) {
          // modo búsqueda pro
          setLoading(true);
          await runProSearchPage(storeId, s, 0, false);
          setLoading(false);
        } else {
          // modo normal
          await reloadStoreData();
        }
      } catch (e: any) {
        setLoading(false);
        setSearching(false);
        await Swal.fire({
          icon: "error",
          title: "Error buscando",
          text:
            e?.message ??
            "Si el error dice que no existe search_products_pro, primero debes pegar el SQL del RPC en Supabase.",
          background: "var(--ap-bg-base)",
          color: "var(--ap-text)",
        });
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, dq, categoryFilter, statusFilter]);

  /* =========================
     CRUD
  ========================= */
  async function create() {
    if (!storeId) return;

    setSavingId("create");
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("products")
        .insert({
          store_id: storeId,
          name: "Nuevo producto",
          description: "",
          price_retail: 0,
          price_wholesale: 0,
          min_wholesale: 1,
          stock: null,
          active: true,
          image_url: null,
          category_id: null,
        })
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .single();

      if (error) throw error;

      const row = normalizeRows([data])[0];
      setProducts((prev) => [row, ...prev]);
      setOpenId(row.id);

      await Swal.fire({
        icon: "success",
        title: "Producto creado",
        timer: 900,
        showConfirmButton: false,
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: e?.message ?? "Error",
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function save(p: Product) {
    setSavingId(p.id);
    try {
      const sb = supabaseBrowser();
      const validCategory = cats.some((c) => c.id === p.category_id);

      const payloadStock = p.stock === null ? null : Math.max(0, Math.floor(clampNum(p.stock, 0)));
      const payloadActive = !!(p.active_draft ?? p.active);

      const { error } = await sb
        .from("products")
        .update({
          name: p.name,
          description: p.description,
          price_retail: clampNum(p.price_retail, 0),
          price_wholesale: clampNum(p.price_wholesale, 0),
          min_wholesale: Math.max(1, clampNum(p.min_wholesale, 1)),
          stock: payloadStock,
          active: payloadActive,
          image_url: p.image_url,
          category_id: validCategory ? p.category_id : null,
        })
        .eq("id", p.id);

      if (error) throw error;

      patch(p.id, {
        active: payloadActive,
        active_draft: payloadActive,
        stock: payloadStock,
      });

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        timer: 800,
        showConfirmButton: false,
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: e?.message ?? "Error",
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function remove(p: Product) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar producto",
      text: `Se eliminará "${p.name}".`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      background: "var(--ap-bg-base)",
      color: "var(--ap-text)",
    });
    if (!res.isConfirmed) return;

    setDeletingId(p.id);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.from("products").delete().eq("id", p.id);
      if (error) throw error;

      setProducts((prev) => prev.filter((x) => x.id !== p.id));
      if (openId === p.id) setOpenId(null);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: e?.message ?? "Error",
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      await Swal.fire({
        icon: "success",
        title: "ID copiado",
        timer: 650,
        showConfirmButton: false,
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
    } catch {
      await Swal.fire({
        icon: "error",
        title: "No se pudo copiar",
        text: "Copia manualmente el ID.",
        background: "var(--ap-bg-base)",
        color: "var(--ap-text)",
      });
    }
  }

  /* =========================
     Filtrado local (solo para modo normal)
     En modo búsqueda, ya viene filtrado desde RPC + out
  ========================= */
  const filtered = useMemo(() => {
    if (isSearchMode) return products;

    const s = norm(q);

    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category_id !== categoryFilter) return false;

      const out = isOutOfStock(p.stock);

      if (statusFilter === "active") {
        if (!p.active) return false;
        if (out) return false;
      }
      if (statusFilter === "inactive") {
        if (p.active) return false;
      }
      if (statusFilter === "out") {
        if (!out) return false;
      }

      if (!s) return true;
      return norm(p.name).includes(s) || norm(p.description ?? "").includes(s);
    });
  }, [products, q, categoryFilter, statusFilter, isSearchMode]);

  const HEADER_H = 0;

  return (
    <main className="px-3 py-3 sm:p-6 text-[color:var(--ap-text)]">
      <style jsx global>{`
        :root {
          --ap-text: rgba(255, 255, 255, 0.92);
          --ap-muted: rgba(255, 255, 255, 0.7);
          --ap-border: rgba(255, 255, 255, 0.12);
          --ap-card: rgba(255, 255, 255, 0.06);
          --ap-card-2: rgba(255, 255, 255, 0.045);
          --ap-bg-base: #0b0b0b;

          --ap-cta: #d946ef;
          --ap-cta2: #a855f7;

          --ap-danger: #ef4444;
          --ap-success: #10b981;
          --ap-warn: #f59e0b;
        }

        @media (prefers-color-scheme: light) {
          :root {
            --ap-text: rgba(17, 24, 39, 0.92);
            --ap-muted: rgba(17, 24, 39, 0.65);
            --ap-border: rgba(17, 24, 39, 0.14);
            --ap-card: rgba(255, 255, 255, 0.82);
            --ap-card-2: rgba(255, 255, 255, 0.72);
            --ap-bg-base: #f7f7fb;

            --ap-cta: #db2777;
            --ap-cta2: #7c3aed;

            --ap-danger: #dc2626;
            --ap-success: #059669;
            --ap-warn: #d97706;
          }
        }

        .ap-wrap {
          border: 1px solid var(--ap-border);
          background: var(--ap-card);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .ap-input {
          width: 100%;
          border: 1px solid var(--ap-border);
          background: var(--ap-card-2);
          color: var(--ap-text);
          border-radius: 16px;
        }
        .ap-input::placeholder {
          color: color-mix(in oklab, var(--ap-text) 35%, transparent);
        }

        .ap-btn {
          border: 1px solid var(--ap-border);
          background: var(--ap-card-2);
          color: var(--ap-text);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .ap-btn:hover {
          filter: brightness(1.04);
        }

        .ap-btn-primary {
          border-color: color-mix(in oklab, var(--ap-cta) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-cta) 18%, transparent);
          box-shadow: 0 0 22px color-mix(in oklab, var(--ap-cta) 18%, transparent);
        }

        .ap-btn-danger {
          border-color: color-mix(in oklab, var(--ap-danger) 30%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-danger) 12%, transparent);
          color: color-mix(in oklab, var(--ap-text) 70%, var(--ap-danger));
        }

        .ap-btn-ghost {
          /* mismo base ap-btn */
        }

        .ap-chip {
          border-color: var(--ap-border);
          background: color-mix(in oklab, var(--ap-card) 70%, transparent);
          color: color-mix(in oklab, var(--ap-text) 82%, transparent);
        }

        .ap-pill {
          border: 1px solid var(--ap-border);
          background: var(--ap-card-2);
          color: var(--ap-text);
        }
        .ap-pill-on {
          border-color: color-mix(in oklab, var(--ap-success) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-success) 14%, transparent);
          color: color-mix(in oklab, var(--ap-text) 75%, var(--ap-success));
        }
        .ap-pill-off {
          border-color: var(--ap-border);
          background: var(--ap-card-2);
          color: color-mix(in oklab, var(--ap-text) 70%, transparent);
        }

        .ap-av-1 {
          background: color-mix(in oklab, var(--ap-cta) 16%, transparent);
          border-color: color-mix(in oklab, var(--ap-cta) 25%, var(--ap-border));
          color: var(--ap-text);
        }
        .ap-av-2 {
          background: color-mix(in oklab, var(--ap-success) 14%, transparent);
          border-color: color-mix(in oklab, var(--ap-success) 22%, var(--ap-border));
          color: var(--ap-text);
        }
        .ap-av-3 {
          background: color-mix(in oklab, #0ea5e9 14%, transparent);
          border-color: color-mix(in oklab, #0ea5e9 22%, var(--ap-border));
          color: var(--ap-text);
        }
        .ap-av-4 {
          background: color-mix(in oklab, var(--ap-warn) 14%, transparent);
          border-color: color-mix(in oklab, var(--ap-warn) 22%, var(--ap-border));
          color: var(--ap-text);
        }
        .ap-av-5 {
          background: color-mix(in oklab, #fb7185 14%, transparent);
          border-color: color-mix(in oklab, #fb7185 22%, var(--ap-border));
          color: var(--ap-text);
        }
        .ap-av-6 {
          background: color-mix(in oklab, var(--ap-cta2) 14%, transparent);
          border-color: color-mix(in oklab, var(--ap-cta2) 22%, var(--ap-border));
          color: var(--ap-text);
        }
      `}</style>

      {/* HEADER */}
      <div className="top-0 left-0 right-0 z-50">
        <div
          className="backdrop-blur-2xl px-3 py-3 sm:px-6 sm:py-6 "
          style={{
            background: "color-mix(in oklab, var(--ap-bg-base) 88%, transparent)",
          }}
        >
          <div className={`${clsWrap()} p-3 sm:p-5`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold leading-tight">Admin · Productos</h2>
                <p className="text-[11px] sm:text-sm" style={{ color: "var(--ap-muted)" }}>
                  Tienda:{" "}
                  <b style={{ color: "var(--ap-text)" }}>
                    {currentStore ? `${currentStore.name} (${currentStore.slug})` : "—"}
                  </b>{" "}
                  · Cargados: <b style={{ color: "var(--ap-text)" }}>{products.length}</b> · Mostrando:{" "}
                  <b style={{ color: "var(--ap-text)" }}>{filtered.length}</b>
                  {isSearchMode ? (
                    <span style={{ marginLeft: 8, opacity: 0.85 }}>
                      · <b>{searching ? "Buscando…" : "Búsqueda PRO"}</b>
                    </span>
                  ) : null}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={buttonGhost()}
                  onClick={reloadStoreData}
                  disabled={!storeId || loading || loadingMore || searching}
                >
                  Recargar
                </button>

                <a
                  href={`/${currentStore?.slug ?? ""}/detal`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonGhost()}
                >
                  Ver Detal
                </a>

                <a
                  href={`/${currentStore?.slug ?? ""}/mayor`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonGhost()}
                >
                  Ver Mayor
                </a>

                <button className={buttonPrimary()} onClick={create} disabled={!storeId || savingId === "create"}>
                  {savingId === "create" ? "Creando…" : "+ Crear"}
                </button>
              </div>
            </div>

            {/* filtros */}
            <div
              className="mt-3 grid gap-2"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              }}
            >
              <select className={inputBase()} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.slug})
                  </option>
                ))}
              </select>

              <select
                className={inputBase()}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">Todas las categorías</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                className={inputBase()}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">Estado: Todos</option>
                <option value="active">Estado: Activos</option>
                <option value="inactive">Estado: Inactivos</option>
                <option value="out">Stock: Agotados</option>
              </select>

              <input
                className={inputBase()}
                placeholder='Buscar tipo WhatsApp: "zapatera" / "belleza secador"...'
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <p className="mt-2 text-[11px] sm:text-xs" style={{ color: "var(--ap-muted)" }}>
              {isSearchMode
                ? "Búsqueda PRO: corrige palabras, permite varias palabras y rankea resultados. (50 por página)"
                : `Cargando en bloques de ${PAGE_SIZE}. Usa “Cargar más” al final.`}
            </p>
          </div>
        </div>
      </div>

      <div style={{ height: HEADER_H }} />

      {/* BODY */}
      {loading ? (
        <div className={`${clsWrap()} p-6 text-sm`} style={{ color: "var(--ap-muted)" }}>
          Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${clsWrap()} p-6`}>
          <p className="font-semibold">No hay productos</p>
          <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
            Crea un producto o cambia los filtros.
          </p>
        </div>
      ) : (
        <div className={`${clsWrap()} overflow-hidden`}>
          {filtered.map((p) => {
            const out = isOutOfStock(p.stock);
            const uiActive = p.active_draft ?? p.active;
            const dirtyActive = uiActive !== p.active;

            const isOpen = openId === p.id;
            const letter = firstLetter(p.name);

            return (
              <div key={p.id} className="border-b" style={{ borderColor: "var(--ap-border)" }}>
                {/* ROW compacta */}
                <div className="px-3 py-3 flex items-center gap-3">
                  {/* ✅ MINIATURA */}
                  <div
                    className={`h-12 w-12 rounded-2xl border overflow-hidden flex items-center justify-center shrink-0 ${avatarClass(
                      p.id
                    )}`}
                    style={{ borderColor: "var(--ap-border)" }}
                  >
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="text-base font-extrabold">{letter}</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{p.name}</p>

                      {!p.active ? (
                        <span className={`${clsChip()}`} style={{ opacity: 0.85 }}>
                          Inactivo
                        </span>
                      ) : null}

                      <span
                        className={`${clsChip()}`}
                        style={{
                          borderColor: out
                            ? "color-mix(in oklab, var(--ap-danger) 30%, var(--ap-border))"
                            : "color-mix(in oklab, var(--ap-success) 30%, var(--ap-border))",
                          background: out
                            ? "color-mix(in oklab, var(--ap-danger) 12%, transparent)"
                            : "color-mix(in oklab, var(--ap-success) 12%, transparent)",
                          color: out
                            ? "color-mix(in oklab, var(--ap-text) 70%, var(--ap-danger))"
                            : "color-mix(in oklab, var(--ap-text) 70%, var(--ap-success))",
                        }}
                      >
                        {stockLabel(p.stock)}
                      </span>

                      {dirtyActive ? (
                        <span className="text-[11px]" style={{ color: "var(--ap-muted)" }}>
                          (cambios sin guardar)
                        </span>
                      ) : null}
                    </div>

                    <div
                      className="mt-1 flex flex-wrap items-center gap-2 text-[11px]"
                      style={{ color: "var(--ap-muted)" }}
                    >
                      <span>
                        Mayorista:{" "}
                        <b style={{ color: "var(--ap-text)" }}>{money(Number(p.price_wholesale ?? 0))}</b>
                      </span>
                      <span style={{ opacity: 0.35 }}>·</span>
                      <span>
                        Detal: <b style={{ color: "var(--ap-text)" }}>{money(Number(p.price_retail ?? 0))}</b>
                      </span>
                      <span style={{ opacity: 0.35 }}>·</span>
                      <span style={{ opacity: 0.85 }}>{formatDate(p.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link className={buttonGhost()} href={`/admin/productos/${p.id}`}>
                      Abrir →
                    </Link>

                    <button className={buttonGhost()} type="button" onClick={() => setOpenId(isOpen ? null : p.id)}>
                      {isOpen ? "Cerrar" : "Editar"}
                    </button>
                  </div>
                </div>

                {/* PANEL DE EDICIÓN */}
                {isOpen ? (
                  <div className="px-3 pb-4">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
                      {/* Left */}
                      <div className={`${clsWrap()} p-4 space-y-3`}>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                              Nombre
                            </label>
                            <input
                              className={`mt-1 ${inputBase()}`}
                              value={p.name}
                              onChange={(e) => patch(p.id, { name: e.target.value })}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                              Descripción
                            </label>
                            <textarea
                              className={`mt-1 min-h-[90px] ${inputBase()}`}
                              value={p.description ?? ""}
                              onChange={(e) => patch(p.id, { description: e.target.value })}
                            />
                          </div>

                          <div>
                            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                              Precio Detal
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 ${inputBase()}`}
                              value={String(p.price_retail ?? 0)}
                              onChange={(e) => patch(p.id, { price_retail: digitsOnlyToNumber(e.target.value, 0) })}
                            />
                          </div>

                          <div>
                            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                              Precio Mayor
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 ${inputBase()}`}
                              value={String(p.price_wholesale ?? 0)}
                              onChange={(e) =>
                                patch(p.id, { price_wholesale: digitsOnlyToNumber(e.target.value, 0) })
                              }
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                              Mínimo Mayor
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 ${inputBase()}`}
                              value={String(p.min_wholesale ?? 1)}
                              onChange={(e) =>
                                patch(p.id, { min_wholesale: Math.max(1, digitsOnlyToNumber(e.target.value, 1)) })
                              }
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                              Stock <span style={{ opacity: 0.55 }}>(vacío = ilimitado)</span>
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 ${inputBase()}`}
                              value={(p.stock ?? "") as any}
                              placeholder="Ej: 10 o vacío"
                              onChange={(e) => setStockWithRule(p.id, safeIntOrNull(e.target.value))}
                            />
                            <p className="mt-2 text-[11px]" style={{ color: "var(--ap-muted)" }}>
                              Si el stock llega a <b>0</b>, se marca <b>inactivo (sin guardar)</b>.
                            </p>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                              Categoría
                            </label>
                            <select
                              className={`mt-1 ${inputBase()}`}
                              value={p.category_id ?? ""}
                              onChange={(e) => patch(p.id, { category_id: e.target.value || null })}
                            >
                              <option value="">Sin categoría</option>
                              {cats.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Active draft */}
                        <div className="flex items-center gap-2">
                          <div
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold border ${badgeActive(
                              uiActive
                            )}`}
                          >
                            <input type="checkbox" checked={uiActive} onChange={() => toggleActiveDraft(p.id)} />
                            {uiActive ? "Activo" : "Inactivo"}
                          </div>
                          <span className="text-xs" style={{ color: "var(--ap-muted)" }}>
                            (Se aplica al guardar)
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button className={buttonPrimary()} onClick={() => save(p)} disabled={savingId === p.id}>
                            {savingId === p.id ? "Guardando…" : "Guardar"}
                          </button>

                          <button className={buttonDanger()} onClick={() => remove(p)} disabled={deletingId === p.id}>
                            {deletingId === p.id ? "Eliminando…" : "Eliminar"}
                          </button>

                          <button className={buttonGhost()} type="button" onClick={() => copyId(p.id)}>
                            Copiar ID
                          </button>

                          <span className="ml-auto text-xs" style={{ color: "var(--ap-muted)" }}>
                            ID:{" "}
                            <span style={{ color: "color-mix(in oklab, var(--ap-text) 85%, transparent)" }}>
                              {p.id}
                            </span>
                          </span>
                        </div>
                      </div>

                      {/* Right image */}
                      <div className={`${clsWrap()} p-4`}>
                        <p className="font-semibold">Imagen principal</p>
                        <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
                          Sube la imagen y luego presiona Guardar.
                        </p>

                        <div className="mt-3">
                          <ImageUpload
                            label="Subir imagen"
                            currentUrl={p.image_url}
                            pathPrefix={`admin/products/${p.store_id}/`}
                            fileName={`${p.id}.png`}
                            bucket="product-images"
                            onUploaded={(url) => patch(p.id, { image_url: url })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* footer: cargar más */}
          <div className="p-3 flex items-center justify-center">
            {isSearchMode ? (
              hasMoreSearch ? (
                <button className={buttonPrimary()} type="button" onClick={loadMoreSearch} disabled={searching}>
                  {searching ? "Cargando…" : "Cargar más resultados"}
                </button>
              ) : (
                <div className="text-xs" style={{ color: "var(--ap-muted)" }}>
                  {searching ? "Buscando…" : "No hay más resultados de búsqueda."}
                </div>
              )
            ) : hasMore ? (
              <button className={buttonPrimary()} type="button" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Cargando…" : "Cargar más"}
              </button>
            ) : (
              <div className="text-xs" style={{ color: "var(--ap-muted)" }}>
                No hay más productos por cargar.
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
