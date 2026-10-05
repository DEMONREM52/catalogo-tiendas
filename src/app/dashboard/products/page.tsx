"use client";

import { MoneyInput } from "@/app/dashboard/MoneyInput";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Megaphone, Pencil, Power } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { ShareProductButton } from "@/components/ShareProductButton";
import { buildProductShareText, hasProductLanding, normalizeProductDetails } from "@/lib/product-details";

type Category = { id: string; name: string; active?: boolean };

type Product = {
  id: string;
  store_id: string;
  created_at: string;
  name: string;
  description: string | null;
  price_retail: number;
  price_wholesale: number;
  price_1?: number | null;
  price_2?: number | null;
  price_3?: number | null;
  price_4?: number | null;
  price_5?: number | null;
  min_wholesale: number;
  active: boolean;
  image_url: string | null;
  category_id: string | null;
  stock: number | null; // null = ilimitado
  product_details: unknown;
};

type StatusFilter = "all" | "active" | "inactive";
type StockFilter = "all" | "in" | "out" | "unlimited";
type SocialFilter = "all" | "pending" | "prepared" | "none";
type SortBy = "newest" | "oldest" | "name" | "price" | "price-desc" | "stock";
type LandingFilter = "all" | "landing" | "no-landing";
type ImageFilter = "all" | "with-image" | "without-image";

/* ========= UI ========= */
function clsWrap() {
  return [
    "rounded-xl border backdrop-blur-xl",
    "border-slate-200/70 bg-white/70 text-slate-900",
    "dark:border-white/10 dark:bg-white/5 dark:text-white",
  ].join(" ");
}
function clsInput() {
  return [
    "w-full rounded-xl border p-3 text-sm outline-none backdrop-blur-xl",
    "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400",
    "dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/40",
  ].join(" ");
}
function clsBtnSoft() {
  return [
    "rounded-xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition disabled:opacity-60",
    "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
    "dark:border-white/10 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10",
  ].join(" ");
}
function clsBtnPrimary() {
  return [
    "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
    "border-fuchsia-300 bg-fuchsia-100 text-slate-900 hover:bg-fuchsia-200",
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
function localDateStart(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toISOString();
}
function localDateAfterEnd(isoDate: string) {
  const nextDay = new Date(`${isoDate}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay.toISOString();
}
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/* ========= Avatar (miniatura + fallback letra) ========= */
function hashToIndex(seed: string, mod: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}
function avatarClass(seed: string) {
  const palette = [
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

/* ========= Paging ========= */
const PAGE_SIZE = 20;   // normal (sin búsqueda)
const SEARCH_PAGE = 50; // ✅ búsqueda pro

type Cursor = { created_at: string; id: string } | null;

export default function ProductsListPage() {
  // carga inicial
  const [loading, setLoading] = useState(true);

  // buscando (sin bloquear input)
  const [searching, setSearching] = useState(false);

  // cargar más (modo normal)
  const [loadingMore, setLoadingMore] = useState(false);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const [catalogRetail, setCatalogRetail] = useState(false);
  const [socialStatuses, setSocialStatuses] = useState<Record<string, string[]>>({});
  const [socialFilter, setSocialFilter] = useState<SocialFilter>("all");
  const [socialDataError, setSocialDataError] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [updatingProductStatusId, setUpdatingProductStatusId] = useState<string | null>(null);

  // paginación normal
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(true);

  // paginación búsqueda pro
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreSearch, setHasMoreSearch] = useState(false);

  // filtros
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 250);
  const isSearchMode = dq.trim().length > 0;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [landingFilter, setLandingFilter] = useState<LandingFilter>("all");
  const [imageFilter, setImageFilter] = useState<ImageFilter>("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");

  // cancelar requests viejos cuando el usuario sigue escribiendo
  const reqIdRef = useRef(0);

  function normalizeProducts(rows: Product[]): Product[] {
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
      return { sb, storeId: null as string | null, storeSlug: null as string | null, catalogRetail: false };
    }

    const access = await getDashboardStore();
    if (!access.store) {
      await Swal.fire({
        icon: "error",
        title: "No se encontró tu tienda",
        background: "#0b0b0b",
        color: "#fff",
      });
      return { sb, storeId: null as string | null, storeSlug: null as string | null, catalogRetail: false };
    }

    return {
      sb,
      storeId: access.store.id,
      storeSlug: access.store.slug,
      catalogRetail: access.store.catalog_retail,
    };
  }

  async function loadCategories(sb: any, sId: string) {
    const { data: cats, error: catsErr } = await sb
      .from("product_categories")
      .select("id,name,active")
      .eq("store_id", sId)
      .order("sort_order", { ascending: true });

    if (catsErr) throw catsErr;
    setCategories((cats as any[]) ?? []);
  }

  // ✅ carga normal inicial (20)
  async function loadFirstPage() {
    setLoading(true);
    try {
      const { sb, storeId: sId, storeSlug: slug, catalogRetail: isRetailEnabled } = await ensureAuthAndStore();
      if (!sId) return;

      setStoreId(sId);
      setStoreSlug(slug);
      setCatalogRetail(isRetailEnabled);
      await loadCategories(sb, sId);

      let query = sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,price_1,price_2,price_3,price_4,price_5,min_wholesale,active,image_url,category_id,stock,product_details"
        )
        .eq("store_id", sId);
      if (statusFilter !== "all") query = query.eq("active", statusFilter === "active");
      if (categoryFilter !== "all") query = query.eq("category_id", categoryFilter);
      if (stockFilter === "in") query = query.gt("stock", 0);
      if (stockFilter === "out") query = query.eq("stock", 0);
      if (stockFilter === "unlimited") query = query.is("stock", null);
      if (minPrice.trim()) query = query.gte("price_retail", Number(minPrice));
      if (maxPrice.trim()) query = query.lte("price_retail", Number(maxPrice));
      if (createdFrom) query = query.gte("created_at", localDateStart(createdFrom));
      if (createdTo) query = query.lt("created_at", localDateAfterEnd(createdTo));
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const rows = normalizeProducts(data ?? []);
      const normalized = rows;
      setProducts(normalized);

      setHasMore(rows.length === PAGE_SIZE);
      setCursor(computeNextCursor(rows));
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

  // ✅ cargar más (modo normal)
  async function loadMore() {
    if (isSearchMode) return;
    if (loadingMore || !hasMore || !storeId || !cursor) return;

    setLoadingMore(true);
    try {
      const sb = supabaseBrowser();

      let query = sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,price_1,price_2,price_3,price_4,price_5,min_wholesale,active,image_url,category_id,stock,product_details"
        )
        .eq("store_id", storeId)
        .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
      if (statusFilter !== "all") query = query.eq("active", statusFilter === "active");
      if (categoryFilter !== "all") query = query.eq("category_id", categoryFilter);
      if (stockFilter === "in") query = query.gt("stock", 0);
      if (stockFilter === "out") query = query.eq("stock", 0);
      if (stockFilter === "unlimited") query = query.is("stock", null);
      if (minPrice.trim()) query = query.gte("price_retail", Number(minPrice));
      if (maxPrice.trim()) query = query.lte("price_retail", Number(maxPrice));
      if (createdFrom) query = query.gte("created_at", localDateStart(createdFrom));
      if (createdTo) query = query.lt("created_at", localDateAfterEnd(createdTo));
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const next = normalizeProducts(data ?? []);

      setProducts((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...next.filter((x) => !seen.has(x.id))];
      });

      setHasMore(next.length === PAGE_SIZE);
      if (next.length > 0) setCursor(computeNextCursor(next));
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
    reqIdRef.current += 1; // cancela búsquedas
    setSearching(false);

    setProducts([]);
    setCursor(null);
    setHasMore(true);

    setSearchOffset(0);
    setHasMoreSearch(false);

    await loadFirstPage();
  }

  /* ==========================================================
     ✅ BUSCADOR PRO (RPC): search_products_pro
     - requiere que hayas creado el SQL del RPC en Supabase
     - trae 50 por página, ranking pro, tolera typos y multi-palabras
  ========================================================== */
  async function runProSearchPage(offset: number, append: boolean) {
    if (!storeId) return;

    const sb = supabaseBrowser();
    const myReq = ++reqIdRef.current;

    setSearching(true);

    const query = dq.trim();

    const { data, error } = await sb.rpc("search_products_pro", {
      p_store_id: storeId,
      p_query: query,
      p_limit: SEARCH_PAGE,
      p_offset: offset,
      p_status: statusFilter, // 'all'|'active'|'inactive'
      p_category_id: categoryFilter === "all" ? null : categoryFilter,
    });

    if (reqIdRef.current !== myReq) return; // cancelado por escribir más

    if (error) {
      setSearching(false);
      throw error;
    }

    const rows = (data ?? []) as any[];

    // mapea numeric -> number
    let mapped: Product[] = rows.map((r) => ({
      id: String(r.id),
      store_id: String(r.store_id),
      created_at: String(r.created_at),
      name: String(r.name ?? ""),
      description: r.description == null ? null : String(r.description),
      price_retail: Number(r.price_retail ?? 0),
      price_wholesale: Number(r.price_wholesale ?? 0),
      price_1: Number(r.price_1 ?? 0),
      price_2: Number(r.price_2 ?? 0),
      price_3: Number(r.price_3 ?? 0),
      price_4: Number(r.price_4 ?? 0),
      price_5: Number(r.price_5 ?? 0),
      min_wholesale: Number(r.min_wholesale ?? 1),
      active: !!r.active,
      image_url: r.image_url == null ? null : String(r.image_url),
      category_id: r.category_id == null ? null : String(r.category_id),
      stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
      product_details: r.product_details ?? {},
    }));

    const { data: detailRows, error: detailsError } = await sb
      .from("products")
      .select("id,product_details")
      .eq("store_id", storeId)
      .in("id", mapped.map((product) => product.id));
    if (detailsError) throw detailsError;
    const detailsById = new Map(
      (detailRows ?? []).map((row) => [String(row.id), row.product_details]),
    );
    mapped = mapped.map((product) => ({
      ...product,
      product_details: detailsById.get(product.id) ?? {},
    }));

    // stock filter final (por si acaso)
    mapped = mapped.filter((product) => {
      if (stockFilter === "in" && product.stock !== null && product.stock <= 0) return false;
      if (stockFilter === "out" && (product.stock === null || product.stock > 0)) return false;
      if (stockFilter === "unlimited" && product.stock !== null) return false;
      if (minPrice.trim() && product.price_retail < Number(minPrice)) return false;
      if (maxPrice.trim() && product.price_retail > Number(maxPrice)) return false;
      if (createdFrom && new Date(product.created_at) < new Date(localDateStart(createdFrom))) return false;
      if (createdTo && new Date(product.created_at) >= new Date(localDateAfterEnd(createdTo))) return false;
      return true;
    });

    setProducts((prev) => (append ? [...prev, ...mapped] : mapped));
    setSearchOffset(offset + SEARCH_PAGE);
    setHasMoreSearch(rows.length === SEARCH_PAGE);

    // modo búsqueda no usa paginado normal
    setHasMore(false);

    setSearching(false);
  }

  async function loadMoreSearch() {
    if (!isSearchMode) return;
    if (!hasMoreSearch || searching) return;
    await runProSearchPage(searchOffset, true);
  }

  async function toggleProductStatus(product: Product) {
    if (!storeId) return;
    setUpdatingProductStatusId(product.id);
    try {
      const nextActive = !product.active;
      const { data, error } = await supabaseBrowser()
        .from("products")
        .update({ active: nextActive })
        .eq("id", product.id)
        .eq("store_id", storeId)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("No se actualizó el estado. Verifica tus permisos y vuelve a intentarlo.");

      setProducts((current) => {
        if (
          (statusFilter === "active" && !nextActive) ||
          (statusFilter === "inactive" && nextActive)
        ) {
          return current.filter((item) => item.id !== product.id);
        }
        return current.map((item) =>
          item.id === product.id ? { ...item, active: nextActive } : item,
        );
      });
      await Swal.fire({
        toast: true,
        position: "top",
        icon: "success",
        title: nextActive ? "Producto activado" : "Producto inactivado",
        timer: 1800,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo actualizar el estado del producto.";
      await Swal.fire({
        icon: "error",
        title: "No se pudo actualizar",
        text: message,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } finally {
      setUpdatingProductStatusId(null);
    }
  }

  // init
  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storeId || !products.length) {
      setSocialStatuses({});
      return;
    }
    let cancelled = false;
    const productIds = products.map((product) => product.id);
    void supabaseBrowser()
      .from("store_social_posts")
      .select("product_id,status")
      .eq("store_id", storeId)
      .in("product_id", productIds)
      .limit(2000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setSocialDataError(error.message);
          return;
        }
        setSocialDataError("");
        const grouped: Record<string, string[]> = {};
        for (const row of data ?? []) {
          const productId = String(row.product_id ?? "");
          if (productId) grouped[productId] = [...(grouped[productId] ?? []), String(row.status)];
        }
        setSocialStatuses(grouped);
      });
    return () => {
      cancelled = true;
    };
  }, [products, storeId]);

  // búsqueda dinámica PRO: cuando cambia texto o filtros
  useEffect(() => {
    if (!storeId) return;

    (async () => {
      const s = dq.trim();

      // cancela request anterior y reinicia paginación de búsqueda
      reqIdRef.current += 1;
      setSearching(false);
      setSearchOffset(0);
      setHasMoreSearch(false);

      try {
        if (s) {
          await runProSearchPage(0, false);
        } else {
          await reloadAll();
        }
      } catch (e: any) {
        setSearching(false);

        await Swal.fire({
          icon: "error",
          title: "Error buscando",
          text:
            e?.message ??
            "Si este error dice que no existe search_products_pro, primero debes pegar el SQL del RPC en Supabase.",
          background: "#0b0b0b",
          color: "#fff",
        });
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, dq, statusFilter, categoryFilter, stockFilter, minPrice, maxPrice, createdFrom, createdTo]);

  const filtered = useMemo(() => {
    const matching = products.filter((product) => {
      const statuses = socialStatuses[product.id] ?? [];
      if (statusFilter === "active" && !product.active) return false;
      if (statusFilter === "inactive" && product.active) return false;
      if (categoryFilter !== "all" && product.category_id !== categoryFilter) return false;
      if (stockFilter === "in" && product.stock !== null && product.stock <= 0) return false;
      if (stockFilter === "out" && (product.stock === null || product.stock > 0)) return false;
      if (stockFilter === "unlimited" && product.stock !== null) return false;
      if (minPrice.trim() && product.price_retail < Number(minPrice)) return false;
      if (maxPrice.trim() && product.price_retail > Number(maxPrice)) return false;
      if (createdFrom && new Date(product.created_at) < new Date(localDateStart(createdFrom))) return false;
      if (createdTo && new Date(product.created_at) >= new Date(localDateAfterEnd(createdTo))) return false;
      if (socialFilter === "pending" && !statuses.some((status) => status === "draft" || status === "review")) return false;
      if (socialFilter === "prepared" && !statuses.some((status) => ["ready", "scheduled", "published"].includes(status))) return false;
      if (socialFilter === "none" && statuses.length !== 0) return false;
      const details = normalizeProductDetails(product.product_details);
      const hasLanding = hasProductLanding(details, { description: product.description, imageUrl: product.image_url });
      if (landingFilter === "landing" && !hasLanding) return false;
      if (landingFilter === "no-landing" && hasLanding) return false;
      const hasImage = Boolean(product.image_url || details.gallery_urls.length);
      if (imageFilter === "with-image" && !hasImage) return false;
      if (imageFilter === "without-image" && hasImage) return false;
      return true;
    });
    return matching.sort((a, b) => {
      if (sortBy === "newest") return b.created_at.localeCompare(a.created_at);
      if (sortBy === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sortBy === "name") return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
      if (sortBy === "price") return a.price_retail - b.price_retail;
      if (sortBy === "price-desc") return b.price_retail - a.price_retail;
      const stockA = a.stock === null ? Number.POSITIVE_INFINITY : a.stock;
      const stockB = b.stock === null ? Number.POSITIVE_INFINITY : b.stock;
      return stockB - stockA;
    });
  }, [categoryFilter, createdFrom, createdTo, imageFilter, landingFilter, maxPrice, minPrice, products, socialFilter, socialStatuses, sortBy, statusFilter, stockFilter]);

  const activeFilterCount = [
    Boolean(q.trim()),
    statusFilter !== "all",
    stockFilter !== "all",
    categoryFilter !== "all",
    socialFilter !== "all",
    landingFilter !== "all",
    imageFilter !== "all",
    Boolean(minPrice.trim()),
    Boolean(maxPrice.trim()),
    Boolean(createdFrom),
    Boolean(createdTo),
  ].filter(Boolean).length;

  function clearFilters() {
    setQ("");
    setStatusFilter("all");
    setStockFilter("all");
    setCategoryFilter("all");
    setSocialFilter("all");
    setLandingFilter("all");
    setImageFilter("all");
    setMinPrice("");
    setMaxPrice("");
    setCreatedFrom("");
    setCreatedTo("");
    setSortBy("newest");
  }

  return (
    <main className="min-w-0 px-4 py-3 text-slate-900 dark:text-white sm:px-6 sm:py-4 md:px-8">
      <div className="space-y-4">
        <div className={`${clsWrap()} p-3.5 sm:p-5`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-tight sm:text-2xl">Productos</h1>
                <p className="text-[11px] text-slate-600 sm:text-sm dark:text-white/70">
                  Cargados: <b className="text-slate-900 dark:text-white/90">{products.length}</b> · Mostrando:{" "}
                  <b className="text-slate-900 dark:text-white/90">{filtered.length}</b>
                  {searching ? (
                    <span className="ml-2">
                      · <b>Buscando…</b>
                    </span>
                  ) : null}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className={clsBtnSoft()}
                  onClick={reloadAll}
                  disabled={loading || loadingMore || searching}
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

            <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-black/15 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold">Búsqueda y filtros</h2>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-white/55">
                    Encuentra y organiza los productos de tu tienda.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeFilterCount ? (
                    <span className="rounded-full border border-fuchsia-300 bg-fuchsia-100 px-2.5 py-1 text-[11px] font-bold text-fuchsia-800 dark:border-fuchsia-400/25 dark:bg-fuchsia-500/10 dark:text-fuchsia-200">
                      {activeFilterCount} {activeFilterCount === 1 ? "filtro activo" : "filtros activos"}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={activeFilterCount === 0}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_190px]">
              <input
                className={clsInput()}
                placeholder='Busca tipo WhatsApp: "zapatera" / "belleza secador"'
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              <select className={clsInput()} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                <option value="newest">Más nuevos</option>
                <option value="oldest">Más antiguos</option>
                <option value="name">Nombre (A-Z)</option>
                <option value="price">Precio detal</option>
                <option value="price-desc">Precio detal (mayor a menor)</option>
                <option value="stock">Stock</option>
              </select>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <select className={clsInput()} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">Estado: Todos</option>
                <option value="active">Estado: Activos</option>
                <option value="inactive">Estado: Inactivos</option>
              </select>

              <select className={clsInput()} value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)}>
                <option value="all">Stock: Todos</option>
                <option value="in">Stock: Con stock</option>
                <option value="out">Stock: Agotados</option>
                <option value="unlimited">Stock: Ilimitados</option>
              </select>

              <select className={clsInput()} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">Categoría: Todas</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.active === false ? " (inactiva)" : ""}
                  </option>
                ))}
              </select>

              <select className={clsInput()} value={socialFilter} onChange={(e) => setSocialFilter(e.target.value as SocialFilter)}>
                <option value="all">Social: Todos</option>
                <option value="pending">Social: Pendiente / revisión</option>
                <option value="prepared">Social: Listo / publicado</option>
                <option value="none">Social: Sin publicaciones</option>
              </select>
            </div>
            <details className="mt-3 rounded-xl border border-slate-200 bg-white/75 p-3 dark:border-white/10 dark:bg-white/[0.035]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-bold">
                <span>Filtros avanzados</span>
                <span className="text-slate-500 dark:text-white/50">Precio · ficha · fotos · fechas</span>
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-white/65">
                  Precio mínimo
                  <MoneyInput allowEmpty className={`${clsInput()} mt-1`} placeholder="$ 0" value={minPrice === "" ? null : Number(minPrice)} onValueChange={(v) => setMinPrice(v === null ? "" : String(v))} />
                </label>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-white/65">
                  Precio máximo
                  <MoneyInput allowEmpty className={`${clsInput()} mt-1`} placeholder="Sin límite" value={maxPrice === "" ? null : Number(maxPrice)} onValueChange={(v) => setMaxPrice(v === null ? "" : String(v))} />
                </label>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-white/65">
                  Ficha del producto
                  <select className={`${clsInput()} mt-1`} value={landingFilter} onChange={(event) => setLandingFilter(event.target.value as LandingFilter)}>
                    <option value="all">Todas las fichas</option>
                    <option value="landing">Con ficha pública</option>
                    <option value="no-landing">Sin ficha pública</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-white/65">
                  Fotos
                  <select className={`${clsInput()} mt-1`} value={imageFilter} onChange={(event) => setImageFilter(event.target.value as ImageFilter)}>
                    <option value="all">Con o sin fotos</option>
                    <option value="with-image">Con fotos</option>
                    <option value="without-image">Sin fotos</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-white/65">
                  Creado desde
                  <input type="date" className={`${clsInput()} mt-1`} value={createdFrom} max={createdTo || undefined} onChange={(event) => setCreatedFrom(event.target.value)} />
                </label>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-white/65">
                  Creado hasta
                  <input type="date" className={`${clsInput()} mt-1`} value={createdTo} min={createdFrom || undefined} onChange={(event) => setCreatedTo(event.target.value)} />
                </label>
              </div>
              {minPrice && maxPrice && Number(minPrice) > Number(maxPrice) ? (
                <p role="alert" className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-300">El precio mínimo no puede superar al precio máximo.</p>
              ) : null}
            </details>
            {socialDataError ? (
              <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                No se pudieron cargar los estados sociales. Ejecuta la migración RemHub Social y vuelve a cargar. ({socialDataError})
              </p>
            ) : null}

            <p className="mt-2 text-[11px] text-slate-600 sm:text-xs dark:text-white/60">
              {isSearchMode
                ? "Búsqueda PRO: corrige palabras, permite varias palabras y rankea resultados. (50 por página)"
                : `(Cargando en bloques de ${PAGE_SIZE}. Usa “Cargar más” al final)`}
            </p>
            </section>
        </div>
      </div>

      {/* LISTA */}
      <div className="space-y-2">
        {loading ? (
          <div className={`${clsWrap()} p-6 text-sm text-slate-700 dark:text-white/70`}>Cargando productos…</div>
        ) : filtered.length === 0 ? (
          <div className={`${clsWrap()} p-6`}>
            <p className="font-semibold">No hay resultados</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
              {hasMoreSearch || hasMore
                ? "No hay coincidencias en los productos cargados. Puedes cargar más o ajustar los filtros."
                : "Prueba cambiando filtros o la búsqueda."}
            </p>
            {hasMoreSearch ? (
              <button className={`${clsBtnPrimary()} mt-3`} type="button" onClick={loadMoreSearch} disabled={searching}>
                {searching ? "Buscando…" : "Buscar más coincidencias"}
              </button>
            ) : null}
            {!isSearchMode && hasMore ? (
              <button className={`${clsBtnPrimary()} mt-3`} type="button" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Cargando…" : "Cargar más productos"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className={`${clsWrap()} overflow-hidden`}>
            {filtered.map((p) => {
              const out = p.stock !== null && p.stock <= 0;
              const letter = firstLetter(p.name);

              return (
                <div key={p.id} className="border-b border-slate-200/50 transition-colors hover:bg-slate-50/60 dark:border-white/[0.07] dark:hover:bg-white/[0.025]">
                  <div className="flex w-full items-center gap-3 px-3 py-3">
                    {/* Miniatura */}
                    <div
                      className={`h-12 w-12 shrink-0 rounded-2xl border overflow-hidden flex items-center justify-center ${avatarClass(
                        p.id
                      )}`}
                      title={p.name}
                      aria-hidden="true"
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
                        <p className="min-w-0 whitespace-normal break-words font-semibold leading-snug [overflow-wrap:anywhere]">{p.name}</p>

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
                        {([p.price_1, p.price_2, p.price_3, p.price_4, p.price_5] as Array<number | null | undefined>).map((v, i) => (
                          <span key={i} className="rounded-md border border-slate-300 px-1.5 py-0.5 dark:border-white/15" title={`Precio ${i + 1}${i === 1 ? " (mayor)" : i === 2 ? " (detal)" : ""}`}>
                            P{i + 1}: <b className="text-slate-900 dark:text-white/90">{money(Number(v ?? 0))}</b>
                          </span>
                        ))}
                        <span className="text-slate-300 dark:text-white/30">·</span>
                        <span className="text-slate-500 dark:text-white/60">{formatDate(p.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <Link
                        href={`/dashboard/products/${p.id}`}
                        className={`${clsBtnSoft()} product-row-action`}
                        aria-label={`Editar ${p.name}`}
                        title="Editar producto"
                      >
                        <Pencil size={16} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void toggleProductStatus(p)}
                        disabled={updatingProductStatusId === p.id}
                        className={`product-row-action inline-flex items-center justify-center gap-1 rounded-xl border text-xs font-semibold transition disabled:cursor-wait disabled:opacity-50 ${
                          p.active
                            ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20"
                            : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
                        }`}
                        aria-label={`${p.active ? "Inactivar" : "Activar"} ${p.name}`}
                        title={p.active ? "Inactivar producto" : "Activar producto"}
                      >
                        <Power size={17} className={updatingProductStatusId === p.id ? "animate-pulse" : ""} />
                      </button>
                      {storeSlug && catalogRetail && p.active && (p.stock === null || p.stock > 0) && hasProductLanding(p.product_details, { description: p.description, imageUrl: p.image_url }) ? (
                        <>
                          <Link
                            href={`/${storeSlug}/producto/${p.id}`}
                            target="_blank"
                            className={`${clsBtnSoft()} product-row-action`}
                            aria-label={`Ver página de ${p.name}`}
                            title="Ver página del producto"
                          >
                            <Eye size={17} />
                          </Link>
                          <ShareProductButton
                            title={p.name}
                            compact
                            iconOnly
                            text={buildProductShareText({
                              name: p.name,
                              price: p.price_retail,
                              description: p.description,
                              stock: p.stock,
                              imageUrl: p.image_url,
                              details: p.product_details,
                            })}
                          />
                        </>
                      ) : null}
                      <Link
                        href={`/dashboard/social?product=${encodeURIComponent(p.id)}`}
                        className={`${clsBtnPrimary()} product-row-action`}
                        aria-label={`Preparar campaña para ${p.name}`}
                        title="Preparar campaña o publicación"
                      >
                        <Megaphone size={17} />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* FOOTER */}
            <div className="flex items-center justify-center p-3">
              {isSearchMode ? (
                hasMoreSearch ? (
                  <button className={clsBtnPrimary()} type="button" onClick={loadMoreSearch} disabled={searching}>
                    {searching ? "Cargando…" : "Cargar más resultados"}
                  </button>
                ) : (
                  <div className="text-xs text-slate-500 dark:text-white/50">No hay más resultados de búsqueda.</div>
                )
              ) : hasMore ? (
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
