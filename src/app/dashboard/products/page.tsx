"use client";

import { MoneyInput } from "@/app/dashboard/MoneyInput";
import { isPermissionOrMissing, searchProductsDirect } from "@/lib/products/safe-search";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { storeHref } from "@/lib/share/store-path";
import { Eye, Megaphone, Pencil, Power, Trash2 } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { ShareProductButton } from "@/components/ShareProductButton";
import { buildProductShareText, hasProductLanding, normalizeProductDetails } from "@/lib/product-details";
import { useRouter } from "next/navigation";
import { PhotoIndexStatus, PhotoSearchButton } from "../PhotoSearchControls";
import { useErpFinderSource } from "../useErpFinder";
import { DateField } from "@/components/forms/Fields";
import { useCan } from "@/lib/permission-runtime";
import { CleanupProductsSheet, deleteProductFlow } from "./DeleteProducts";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ZoomableThumb } from "@/components/ui/ZoomableImage";
import { useSearchValue } from "@/lib/search-timing";
import { SearchTimer } from "@/components/ui/SearchTimer";
import { ScrollButtons } from "@/components/ui/ScrollButtons";
import { ProductsModeSwitch } from "./ModeSwitch";

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
  sku?: string | null;
};

type StatusFilter = "all" | "active" | "inactive";
type StockFilter = "all" | "in" | "out" | "unlimited";
type SocialFilter = "all" | "pending" | "prepared" | "none";
type SortBy = "newest" | "oldest" | "name" | "price" | "price-desc" | "stock";
type LandingFilter = "all" | "landing" | "no-landing";
type ImageFilter = "all" | "with-image" | "without-image";

/**
 * Cómo estaba la lista la última vez (en este equipo): búsqueda, filtros, categoría, orden y filtros abiertos.
 * Y hasta dónde se había bajado (en esta pestaña), para volver ahí después de editar un producto.
 */
const VIEW_KEY = "remhub:products-view";
const SCROLL_KEY = "remhub:products-scroll";
type ProductsView = {
  q: string; statusFilter: StatusFilter; stockFilter: StockFilter; categoryFilter: string; sortBy: SortBy;
  minPrice: string; maxPrice: string; landingFilter: LandingFilter; imageFilter: ImageFilter;
  createdFrom: string; createdTo: string; socialFilter: SocialFilter; showFilters: boolean;
};
type ProductsScroll = { y: number; count: number; mode: "list" | "search" };

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function readProductsView(): ProductsView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return null;
    return {
      q: str(v.q),
      statusFilter: oneOf(v.statusFilter, ["all", "active", "inactive"] as const, "all"),
      stockFilter: oneOf(v.stockFilter, ["all", "in", "out", "unlimited"] as const, "all"),
      categoryFilter: str(v.categoryFilter) || "all",
      sortBy: oneOf(v.sortBy, ["newest", "oldest", "name", "price", "price-desc", "stock"] as const, "newest"),
      minPrice: str(v.minPrice), maxPrice: str(v.maxPrice),
      landingFilter: oneOf(v.landingFilter, ["all", "landing", "no-landing"] as const, "all"),
      imageFilter: oneOf(v.imageFilter, ["all", "with-image", "without-image"] as const, "all"),
      createdFrom: str(v.createdFrom), createdTo: str(v.createdTo),
      socialFilter: oneOf(v.socialFilter, ["all", "pending", "prepared", "none"] as const, "all"),
      showFilters: v.showFilters === true,
    };
  } catch { return null; }
}

function readProductsScroll(): ProductsScroll | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "null") as ProductsScroll | null;
    return v && Number.isFinite(v.y) && Number.isFinite(v.count) ? v : null;
  } catch { return null; }
}

/* ========= UI ========= */
// Todo con los tokens del tema (Pearl, Obsidian o el personal): sin colores fijos.
function clsWrap() {
  return "rounded-2xl border border-[color:var(--t-card-border)] bg-[color:var(--t-card-bg)] text-[color:var(--t-text)] shadow-[var(--t-shadow)]";
}
function clsInput() {
  return "w-full rounded-xl border border-[color:var(--t-card-border)] bg-[color:var(--t-input-bg)] p-3 text-sm text-[color:var(--t-text)] outline-none placeholder:text-[color:var(--t-muted)]";
}
function clsBtnSoft() {
  // Neutro (Editar, Ver, Recargar).
  return "rounded-xl border border-[color:var(--t-card-border)] bg-[color:var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[color:var(--t-text)] transition hover:border-[color:color-mix(in_oklab,var(--t-text)_22%,transparent)] disabled:opacity-60";
}
function clsBtnPrimary() {
  // Acción principal (Crear): el único botón con acento lleno.
  return "rounded-xl border border-transparent bg-[color:var(--t-accent)] px-4 py-2 text-sm font-bold text-[color:var(--t-on-accent)] shadow-[0_8px_22px_-12px_var(--t-accent)] transition hover:brightness-110 disabled:opacity-60";
}
function clsChipBase() {
  return "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold text-[color:var(--t-text)]";
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

/* ========= Avatar (miniatura + fallback letra) ========= */
function hashToIndex(seed: string, mod: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}
function avatarClass(seed: string) {
  const palette = [
    "bg-brand/18 border-brand/40 text-slate-900 dark:bg-brand/15 dark:border-brand/25 dark:text-brand",
    "bg-emerald-200/70 border-emerald-300 text-slate-900 dark:bg-emerald-500/15 dark:border-emerald-400/25 dark:text-emerald-100",
    "bg-sky-200/70 border-sky-300 text-slate-900 dark:bg-sky-500/15 dark:border-sky-400/25 dark:text-sky-100",
    "bg-amber-200/70 border-amber-300 text-slate-900 dark:bg-amber-500/15 dark:border-amber-400/25 dark:text-amber-100",
    "bg-danger/18 border-danger/40 text-slate-900 dark:bg-danger/15 dark:border-danger/25 dark:text-danger",
    "bg-brand/18 border-brand/40 text-slate-900 dark:bg-brand/15 dark:border-brand/25 dark:text-brand",
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

const PRODUCT_COLUMNS = "id,store_id,created_at,name,description,price_retail,price_wholesale,price_1,price_2,price_3,price_4,price_5,min_wholesale,active,image_url,category_id,stock,product_details,sku";
/** Filtra por cualquiera de las categorías del producto (no solo la principal). */
const CATEGORY_JOIN = ",product_category_links!inner(category_id)";
let linksAvailable: boolean | null = null;
async function categoryLinksAvailable(sb: ReturnType<typeof supabaseBrowser>) {
  if (linksAvailable === null) {
    const { error } = await sb.from("product_category_links").select("product_id").limit(1);
    linksAvailable = !error;
  }
  return linksAvailable;
}

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
  // Celular: los filtros van plegados (en computador siempre se ven).
  const [showFilters, setShowFilters] = useState(false);
  const [socialDataError, setSocialDataError] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [updatingProductStatusId, setUpdatingProductStatusId] = useState<string | null>(null);
  // Eliminar productos que no se han vendido (20261260 y 20261263): permiso «Productos»; la base exige además ser de la madre.
  const canDelete = useCan("products_delete");
  const canImport = useCan("products_import");
  const canCreate = useCan("products_create");
  const [cleaning, setCleaning] = useState(false);

  // paginación normal
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(true);

  // paginación búsqueda pro
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreSearch, setHasMoreSearch] = useState(false);

  // filtros
  const [q, setQ] = useState("");
  // Temporizador: busca cuando paras de escribir (una letra espera más); Enter busca ya.
  const { value: dq, pending: qPending, delay: qDelay, flush: flushQ } = useSearchValue(q);
  const router = useRouter();
  const finderSource = useErpFinderSource(storeId);
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

  // Recordar la lista: primero se recupera cómo estaba y luego se carga con eso.
  const [restored, setRestored] = useState(false);
  const firstLimit = useRef(PAGE_SIZE);
  const pendingScroll = useRef<(ProductsScroll & { until: number }) | null>(null);
  const skipFirstReload = useRef(true);
  const listNow = useRef<{ count: number; mode: "list" | "search" }>({ count: 0, mode: "list" });

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

      const byLinks = categoryFilter !== "all" && (await categoryLinksAvailable(sb));
      let query = sb
        .from("products")
        .select(`id,store_id,created_at,name,description,price_retail,price_wholesale,price_1,price_2,price_3,price_4,price_5,min_wholesale,active,image_url,category_id,stock,product_details,sku${byLinks ? CATEGORY_JOIN : ""}` as typeof PRODUCT_COLUMNS)
        .eq("store_id", sId);
      if (statusFilter !== "all") query = query.eq("active", statusFilter === "active");
      if (categoryFilter !== "all") query = byLinks ? query.eq("product_category_links.category_id", categoryFilter) : query.eq("category_id", categoryFilter);
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
        .limit(firstLimit.current);

      if (error) throw error;

      const rows = normalizeProducts(data ?? []);
      const normalized = rows;
      setProducts(normalized);

      setHasMore(rows.length === firstLimit.current);
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

      const byLinks = categoryFilter !== "all" && (await categoryLinksAvailable(sb));
      let query = sb
        .from("products")
        .select(`id,store_id,created_at,name,description,price_retail,price_wholesale,price_1,price_2,price_3,price_4,price_5,min_wholesale,active,image_url,category_id,stock,product_details,sku${byLinks ? CATEGORY_JOIN : ""}` as typeof PRODUCT_COLUMNS)
        .eq("store_id", storeId)
        .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
      if (statusFilter !== "all") query = query.eq("active", statusFilter === "active");
      if (categoryFilter !== "all") query = byLinks ? query.eq("product_category_links.category_id", categoryFilter) : query.eq("category_id", categoryFilter);
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

    const searchArgs = {
      p_store_id: storeId,
      p_query: query,
      p_limit: SEARCH_PAGE,
      p_offset: offset,
      p_status: statusFilter, // 'all'|'active'|'inactive'
      p_category_id: categoryFilter === "all" ? null : categoryFilter,
    };
    // Búsqueda segura (sin costo). Si aún no existe la migración 20261111, se usa la anterior.
    let { data, error } = await sb.rpc("search_products_safe", searchArgs);
    if (error && /Could not find the function|schema cache/i.test(error.message)) ({ data, error } = await sb.rpc("search_products_pro", searchArgs));
    // Si el buscador avanzado falla por el costo protegido, se busca directo (sin el costo).
    if (isPermissionOrMissing(error)) {
      try {
        data = await searchProductsDirect(storeId, query, { limit: SEARCH_PAGE, offset, status: statusFilter, categoryId: categoryFilter === "all" ? null : categoryFilter });
        error = null;
      } catch (e) { error = e as typeof error; }
    }

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
      sku: r.sku == null ? null : String(r.sku),
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

  async function deleteProduct(product: Product) {
    const result = await deleteProductFlow(product);
    if (result === "deleted") setProducts((current) => current.filter((item) => item.id !== product.id));
    else if (result === "inactivate") await toggleProductStatus(product);
  }

  // init: recupera cómo estaba la lista (filtros, búsqueda, hasta dónde se bajó) y luego carga.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const v = readProductsView();
      if (v) {
        setQ(v.q); setStatusFilter(v.statusFilter); setStockFilter(v.stockFilter); setCategoryFilter(v.categoryFilter);
        setSortBy(v.sortBy); setMinPrice(v.minPrice); setMaxPrice(v.maxPrice); setLandingFilter(v.landingFilter);
        setImageFilter(v.imageFilter); setCreatedFrom(v.createdFrom); setCreatedTo(v.createdTo); setSocialFilter(v.socialFilter);
        setShowFilters(v.showFilters);
      }
      const sc = readProductsScroll();
      if (sc && sc.y > 150) {
        const count = sc.mode === "search" ? Math.min(sc.count, SEARCH_PAGE) : Math.min(Math.max(sc.count, PAGE_SIZE), 200);
        if (sc.mode === "list") firstLimit.current = count;
        pendingScroll.current = { ...sc, count, until: Date.now() + 12000 };
      }
      setRestored(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!restored) return;
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // Se guarda cada cambio de búsqueda o filtros.
  useEffect(() => {
    if (!restored) return;
    const view: ProductsView = { q, statusFilter, stockFilter, categoryFilter, sortBy, minPrice, maxPrice, landingFilter, imageFilter, createdFrom, createdTo, socialFilter, showFilters };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* sin almacenamiento */ }
  }, [restored, q, statusFilter, stockFilter, categoryFilter, sortBy, minPrice, maxPrice, landingFilter, imageFilter, createdFrom, createdTo, socialFilter, showFilters]);

  // Hasta dónde se bajó (para volver ahí al regresar de un producto).
  useEffect(() => { listNow.current = { count: products.length, mode: isSearchMode ? "search" : "list" }; });
  useEffect(() => {
    if (!restored) return;
    let t = 0;
    const save = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (window.location.pathname !== "/dashboard/products" || pendingScroll.current) return;
        try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y: Math.round(window.scrollY), ...listNow.current })); } catch { /* sin almacenamiento */ }
      }, 150);
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => { window.clearTimeout(t); window.removeEventListener("scroll", save); };
  }, [restored]);

  // Al volver: cuando la lista ya tiene lo que se había cargado, baja a donde se estaba.
  useEffect(() => {
    const p = pendingScroll.current;
    if (!p || loading) return;
    if (Date.now() > p.until) { pendingScroll.current = null; firstLimit.current = PAGE_SIZE; return; }
    if (searching || p.mode !== (isSearchMode ? "search" : "list") || !products.length) return;
    const enough = products.length >= p.count || (isSearchMode ? !hasMoreSearch : !hasMore);
    if (!enough) return;
    pendingScroll.current = null;
    firstLimit.current = PAGE_SIZE;
    requestAnimationFrame(() => window.scrollTo({ top: p.y }));
  }, [products, loading, searching, isSearchMode, hasMore, hasMoreSearch]);

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
    // La primera vez la lista ya la trajo loadFirstPage con estos mismos filtros: no se carga dos veces.
    if (skipFirstReload.current) {
      skipFirstReload.current = false;
      if (!dq.trim()) return;
    }

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
    <main className="min-w-0 px-4 py-3 text-[color:var(--t-text)] sm:px-6 sm:py-4 md:px-8">
      <ScrollButtons />
      <div className="space-y-4">
        <div className={`${clsWrap()} p-3.5 sm:p-5`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-bold leading-tight sm:text-2xl">Productos</h1>
                  <ProductsModeSwitch mode="simple" />
                </div>
                <p className="text-[11px] text-[color:var(--t-muted)] sm:text-sm">
                  <b className="text-[color:var(--t-text)]">{filtered.length}</b> de <b className="text-[color:var(--t-text)]">{products.length}</b> cargados
                  {searching ? <span className="ml-1">· <b>Buscando…</b></span> : null}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Computador: todos los botones a la vista. */}
                <div className="hidden items-center gap-2 md:flex">
                  <button className={clsBtnSoft()} onClick={reloadAll} disabled={loading || loadingMore || searching} type="button" style={{ padding: "8px 10px", fontSize: 12 }}>
                    Recargar
                  </button>
                  {canDelete && storeId ? (
                    <button type="button" onClick={() => setCleaning(true)} className="rounded-xl border px-2.5 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }} title="Eliminar productos que nunca se vendieron ni trasladaron">
                      🧹 Limpiar
                    </button>
                  ) : null}
                  {canImport ? (
                    <Link href="/dashboard/products/importar" className="rounded-xl border px-2.5 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }} title="Subir muchos productos de una vez desde Excel">
                      📥 Importar Excel
                    </Link>
                  ) : null}
                  <Link href="/dashboard/datos" className="rounded-xl border px-2.5 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }} title="Exportar o importar productos, terceros, cartera, inventario y más">
                    🔄 Exportar / importar todo
                  </Link>
                </div>
                {/* Celular: lo de siempre en un menú «⋯». */}
                <details className="relative md:hidden">
                  <summary className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl border text-lg font-black [&::-webkit-details-marker]:hidden" style={{ borderColor: "var(--t-card-border)" }} aria-label="Más opciones">⋯</summary>
                  <div role="menu" className="absolute right-0 z-30 mt-2 grid w-60 gap-1 rounded-2xl border p-1.5 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                    <button type="button" role="menuitem" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); void reloadAll(); }} disabled={loading || loadingMore || searching} className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg-soft)] disabled:opacity-50">🔄 Recargar</button>
                    {canImport ? <Link role="menuitem" href="/dashboard/products/importar" className="rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-[color:var(--t-card-bg-soft)]">📥 Importar Excel</Link> : null}
                    <Link role="menuitem" href="/dashboard/datos" className="rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-[color:var(--t-card-bg-soft)]">📦 Exportar / importar todo</Link>
                    {canDelete && storeId ? (
                      <button type="button" role="menuitem" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); setCleaning(true); }} className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg-soft)]">🧹 Limpiar sin movimientos</button>
                    ) : null}
                  </div>
                </details>
                {canCreate ? (
                  <Link href="/dashboard/products/crear" className={clsBtnPrimary()} style={{ padding: "9px 14px", fontSize: 13 }}>
                    + Crear
                  </Link>
                ) : null}
              </div>
            </div>

            <section className="mt-3 md:mt-4 md:rounded-2xl md:border md:border-[color:var(--t-card-border)] md:bg-[color:var(--t-card-bg-soft)] md:p-4">
              <div className="hidden flex-wrap items-center justify-between gap-2 md:flex">
                <div>
                  <h2 className="text-sm font-bold">Búsqueda y filtros</h2>
                  <p className="mt-0.5 text-[11px] text-[color:var(--t-muted)]">
                    Encuentra y organiza los productos de tu tienda.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeFilterCount ? (
                    <span className="rounded-full border border-[color:color-mix(in_oklab,var(--t-accent)_35%,transparent)] bg-[color:var(--t-accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--t-accent)]">
                      {activeFilterCount} {activeFilterCount === 1 ? "filtro activo" : "filtros activos"}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={activeFilterCount === 0}
                    className="rounded-lg border border-[color:var(--t-card-border)] bg-[color:var(--t-card-bg-soft)] px-3 py-1.5 text-xs font-semibold text-[color:var(--t-text)] transition disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_190px] md:mt-3">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    className={clsInput()}
                    placeholder='Nombre o código: "zapatera", "belleza secador", "125"'
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") flushQ(); }}
                    enterKeyHint="search"
                  />
                  <SearchTimer pending={qPending} delay={qDelay} term={q} />
                </div>
                <PhotoSearchButton
                  source={finderSource}
                  pickLabel="Editar"
                  subtitle="Toma una foto del producto o escribe su nombre o código para abrirlo."
                  storageKey={`products:${storeId ?? ""}`}
                  onPick={(hit) => router.push(`/dashboard/products/${hit.id}`)}
                />
                <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
                  className="relative inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold md:hidden"
                  style={showFilters || activeFilterCount ? { borderColor: "var(--t-accent)", color: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>
                  ⚙️ Filtros
                  {activeFilterCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] text-white" style={{ background: "var(--t-accent)" }}>{activeFilterCount}</span> : null}
                </button>
              </div>

              <select className={`${clsInput()} ${showFilters ? "" : "hidden"} sm:block`} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                <option value="newest">Más nuevos</option>
                <option value="oldest">Más antiguos</option>
                <option value="name">Nombre (A-Z)</option>
                <option value="price">Precio detal</option>
                <option value="price-desc">Precio detal (mayor a menor)</option>
                <option value="stock">Stock</option>
              </select>
            </div>
            <div className="mt-1.5 hidden px-0.5 md:block"><PhotoIndexStatus storeId={storeId} /></div>

            <div className={`${showFilters ? "" : "hidden"} md:block`}>
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
            <details className="mt-3 rounded-xl border border-[color:var(--t-card-border)] bg-[color:var(--t-card-bg-soft)] p-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-bold">
                <span>Filtros avanzados</span>
                <span className="text-[color:var(--t-muted)]">Precio · ficha · fotos · fechas</span>
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <label className="text-[11px] font-semibold text-[color:var(--t-muted)]">
                  Precio mínimo
                  <MoneyInput allowEmpty className={`${clsInput()} mt-1`} placeholder="$ 0" value={minPrice === "" ? null : Number(minPrice)} onValueChange={(v) => setMinPrice(v === null ? "" : String(v))} />
                </label>
                <label className="text-[11px] font-semibold text-[color:var(--t-muted)]">
                  Precio máximo
                  <MoneyInput allowEmpty className={`${clsInput()} mt-1`} placeholder="Sin límite" value={maxPrice === "" ? null : Number(maxPrice)} onValueChange={(v) => setMaxPrice(v === null ? "" : String(v))} />
                </label>
                <label className="text-[11px] font-semibold text-[color:var(--t-muted)]">
                  Ficha del producto
                  <select className={`${clsInput()} mt-1`} value={landingFilter} onChange={(event) => setLandingFilter(event.target.value as LandingFilter)}>
                    <option value="all">Todas las fichas</option>
                    <option value="landing">Con ficha pública</option>
                    <option value="no-landing">Sin ficha pública</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[color:var(--t-muted)]">
                  Fotos
                  <select className={`${clsInput()} mt-1`} value={imageFilter} onChange={(event) => setImageFilter(event.target.value as ImageFilter)}>
                    <option value="all">Con o sin fotos</option>
                    <option value="with-image">Con fotos</option>
                    <option value="without-image">Sin fotos</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[color:var(--t-muted)]">
                  Creado desde
                  <DateField value={createdFrom} onChange={(v) => setCreatedFrom(v)} max={createdTo || undefined} className="mt-1" />
                </label>
                <label className="text-[11px] font-semibold text-[color:var(--t-muted)]">
                  Creado hasta
                  <DateField value={createdTo} onChange={(v) => setCreatedTo(v)} min={createdFrom || undefined} className="mt-1" />
                </label>
              </div>
              {minPrice && maxPrice && Number(minPrice) > Number(maxPrice) ? (
                <p role="alert" className="mt-2 text-xs font-semibold text-danger ">El precio mínimo no puede superar al precio máximo.</p>
              ) : null}
            </details>
            {socialDataError ? (
              <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                No se pudieron cargar los estados sociales. Ejecuta la migración RemHub Social y vuelve a cargar. ({socialDataError})
              </p>
            ) : null}

            {activeFilterCount ? (
              <button type="button" onClick={clearFilters} className="mt-2 w-full rounded-xl border px-3 py-2 text-xs font-bold md:hidden" style={{ borderColor: "var(--t-card-border)" }}>
                ✕ Quitar los {activeFilterCount} filtros
              </button>
            ) : null}
            </div>

            <p className="mt-2 hidden text-[11px] text-[color:var(--t-muted)] sm:text-xs md:block">
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
          <div className={`${clsWrap()} p-3`}><SkeletonList rows={8} label="Cargando productos…" /></div>
        ) : filtered.length === 0 ? (
          <div className={`${clsWrap()} p-6`}>
            <p className="font-semibold">No hay resultados</p>
            <p className="mt-1 text-sm text-[color:var(--t-muted)]">
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
                <div key={p.id} className="border-b border-[color:var(--t-border)] transition-colors last:border-b-0 hover:bg-[color:var(--t-card-bg-soft)]">
                  {/* Celular: foto y nombre a todo lo ancho; las acciones bajan a su propia fila. */}
                  <div className="flex w-full flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3 sm:flex-nowrap sm:items-center">
                    {/* Miniatura */}
                    <div
                      className={`h-16 w-16 shrink-0 rounded-2xl border overflow-hidden flex items-center justify-center shadow-md sm:h-20 sm:w-20 ${avatarClass(
                        p.id
                      )}`}
                      title={p.name}
                    >
                      {p.image_url ? (
                        <ZoomableThumb src={p.image_url} alt={p.name} className="block h-full w-full" imgClassName="h-full w-full object-cover transition duration-300 hover:scale-110" />
                      ) : (
                        <span className="text-base font-extrabold" aria-hidden="true">{letter}</span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 whitespace-normal break-words text-sm font-semibold leading-snug [overflow-wrap:anywhere] sm:text-base">
                          {p.name}
                          {p.sku ? <span className="ml-1.5 whitespace-nowrap rounded-md bg-[color:var(--t-card-bg-soft)] px-1.5 py-0.5 align-middle text-[10px] font-bold text-[color:var(--t-muted)]">Cód. {p.sku}</span> : null}
                        </p>

                        {!p.active ? (
                          <span
                            className={`${clsChipBase()} border-[color:var(--t-card-border)] bg-[color:var(--t-card-bg-soft)] text-[color:var(--t-muted)]`}
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

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--t-muted)]">
                        {([p.price_1, p.price_2, p.price_3, p.price_4, p.price_5] as Array<number | null | undefined>).map((v, i) => (
                          <span key={i} className={`${i === 1 || i === 2 ? "" : "hidden sm:inline"} rounded-md border border-[color:var(--t-card-border)] px-1.5 py-0.5`} title={`Precio ${i + 1}${i === 1 ? " (mayor)" : i === 2 ? " (detal)" : ""}`}>
                            P{i + 1}: <b className="text-[color:var(--t-text)]">{money(Number(v ?? 0))}</b>
                          </span>
                        ))}
                        <span className="hidden text-[color:var(--t-muted)] opacity-50 sm:inline">·</span>
                        <span className="hidden text-[color:var(--t-muted)] sm:inline">{formatDate(p.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex basis-full flex-wrap items-center justify-start gap-1.5 pl-19 sm:basis-auto sm:shrink-0 sm:justify-end sm:pl-0">
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
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => void deleteProduct(p)}
                          className="product-row-action inline-flex items-center justify-center rounded-xl border border-red-300 bg-red-50 text-red-700 transition hover:bg-red-100 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                          aria-label={`Eliminar ${p.name}`}
                          title="Eliminar (solo si nunca se vendió ni se trasladó)"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                      {storeSlug && catalogRetail && p.active && (p.stock === null || p.stock > 0) && hasProductLanding(p.product_details, { description: p.description, imageUrl: p.image_url }) ? (
                        <>
                          <Link
                            href={storeHref(storeSlug, `/producto/${p.id}`)}
                            prefetch={false}
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
                  <div className="text-xs text-[color:var(--t-muted)]">No hay más resultados de búsqueda.</div>
                )
              ) : hasMore ? (
                <button className={clsBtnPrimary()} type="button" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Cargando…" : "Cargar más"}
                </button>
              ) : (
                <div className="text-xs text-[color:var(--t-muted)]">
                  {storeId ? "No hay más productos por cargar." : "Detectando tienda…"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {cleaning && storeId ? <CleanupProductsSheet storeId={storeId} onClose={() => setCleaning(false)} onChanged={() => void reloadAll()} /> : null}
    </main>
  );
}
