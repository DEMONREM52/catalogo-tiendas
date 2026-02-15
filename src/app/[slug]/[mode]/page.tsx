"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Swal from "sweetalert2";

import { supabaseBrowser } from "@/lib/supabase/client";
import { SocialIconRow } from "./socials";
import { useCart } from "@/lib/cart/CartProvider";
import { CartDrawer } from "@/lib/cart/CartDrawer";

import { applyThemeToRoot, type ThemeConfig } from "@/lib/themes/applyTheme";

/* =========================================================
   Types
========================================================= */
type Mode = "detal" | "mayor";

type StoreRow = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  active: boolean;
  catalog_retail: boolean;
  catalog_wholesale: boolean;
  theme: string | null;
  logo_url: string | null;
  banner_url: string | null;
  wholesale_key: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price_retail: number;
  price_wholesale: number;
  min_wholesale: number | null;
  active: boolean;
  image_url: string | null;
  category_id: string | null;
  stock: number | null; // null = ilimitado
};

type CategoryRow = {
  id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
};

/* =========================================================
   Helpers
========================================================= */
const PAGE_SIZE = 25; // ✅ recomendado para móvil
const SEARCH_DEBOUNCE_MS = 350;

function isValidMode(x: any): x is Mode {
  return x === "detal" || x === "mayor";
}

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

function pickStr(v: any) {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

function asNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isHexOrRgbaLike(s?: string) {
  if (!s) return false;
  const t = s.trim();
  if (!t) return false;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return true;
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(t)) return true;
  return false;
}

function stockMeta(stock: number | null) {
  if (stock === null) return { label: "Ilimitado", tone: "ok" as const };
  const s = Math.max(0, Math.floor(Number(stock || 0)));
  if (s <= 0) return { label: "Agotado", tone: "danger" as const };
  if (s <= 5) return { label: `Últimas ${s}`, tone: "warn" as const };
  return { label: `Disponible: ${s}`, tone: "ok" as const };
}

/* =========================
   Debounce hook
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
   SmartImg (reintento + placeholder)
   - Si falla: reintenta 1 vez con cache-bust
   - Si vuelve a fallar: muestra fallback
========================= */
function SmartImg(props: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
  priority?: boolean; // para las primeras imágenes
  borderColorVar?: string; // ej "var(--t-border)"
}) {
  const { src, alt, className, style, loading = "lazy", priority, borderColorVar } = props;

  const [finalSrc, setFinalSrc] = useState<string | null>(src ?? null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    setFinalSrc(src ?? null);
    setLoaded(false);
    setFailed(false);
    setRetried(false);
  }, [src]);

  const borderColor = borderColorVar ?? "rgba(255,255,255,0.10)";

  if (!finalSrc || failed) {
    return (
      <div
        className={className}
        style={{
          ...style,
          border: `1px solid ${borderColor}`,
          background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
        }}
        aria-label={alt}
      />
    );
  }

  return (
    <div className="relative">
      {/* skeleton */}
      {!loaded ? (
        <div
          className={cx("absolute inset-0 animate-pulse rounded-2xl", className?.includes("rounded") ? "" : "")}
          style={{
            border: `1px solid ${borderColor}`,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02), rgba(255,255,255,0.06))",
            borderRadius: (style as any)?.borderRadius,
          }}
        />
      ) : null}

      <img
        src={finalSrc}
        alt={alt}
        className={cx(className, loaded ? "opacity-100" : "opacity-0")}
        style={style}
        loading={priority ? "eager" : loading}
        decoding="async"
        // fetchpriority no existe en TS DOM, lo ponemos como atributo HTML (string)
        {...(priority ? ({ fetchpriority: "high" } as any) : ({ fetchpriority: "low" } as any))}
        onLoad={() => setLoaded(true)}
        onError={() => {
          // reintenta 1 vez para evitar cache de error / URL temporal
          if (!retried) {
            setRetried(true);
            const sep = finalSrc.includes("?") ? "&" : "?";
            setFinalSrc(`${finalSrc}${sep}cb=${Date.now()}`);
            return;
          }
          setFailed(true);
        }}
      />
    </div>
  );
}

/* =========================================================
   Theme mapping
========================================================= */
function mapDbThemeToApplyTheme(dbCfg: any): ThemeConfig | undefined {
  if (!dbCfg || typeof dbCfg !== "object") return undefined;

  const bg = pickStr(dbCfg.bg);
  const card = pickStr(dbCfg.card);
  const cardBorder = pickStr(dbCfg.card_border);
  const text = pickStr(dbCfg.text);
  const muted = pickStr(dbCfg.muted);
  const accent = pickStr(dbCfg.accent);
  const accent2 = pickStr(dbCfg.accent2);

  const bgGradA = pickStr(dbCfg.bgGradA ?? dbCfg.bg_grad_a);
  const bgGradB = pickStr(dbCfg.bgGradB ?? dbCfg.bg_grad_b);
  const bgAngle = asNum(dbCfg.bgAngle ?? dbCfg.bg_angle);

  const cta = pickStr(dbCfg.cta);
  const ctaA = pickStr(dbCfg.ctaA ?? dbCfg.cta_a);
  const ctaB = pickStr(dbCfg.ctaB ?? dbCfg.cta_b);
  const ctaAngle = asNum(dbCfg.ctaAngle ?? dbCfg.cta_angle);

  const cfg: ThemeConfig = {};

  if (bg) {
    if (isHexOrRgbaLike(bg)) {
      cfg.bgMode = "solid";
      cfg.bgSolid = bg;
    } else if (/gradient\(/i.test(bg)) {
      cfg.bgMode = "gradient";
      if (bgGradA) cfg.bgGradA = bgGradA;
      if (bgGradB) cfg.bgGradB = bgGradB;
      if (bgAngle != null) cfg.bgAngle = bgAngle;
      (cfg as any).__rawBg = bg;
    }
  } else if (bgGradA || bgGradB) {
    cfg.bgMode = "gradient";
    if (bgGradA) cfg.bgGradA = bgGradA;
    if (bgGradB) cfg.bgGradB = bgGradB;
    if (bgAngle != null) cfg.bgAngle = bgAngle;
  }

  if (text) cfg.text = text;
  if (muted) cfg.mutedText = muted;

  if (cardBorder) {
    cfg.border = cardBorder;
    cfg.cardBorder = cardBorder;
  }
  if (card) cfg.cardBg = card;

  if (accent) cfg.accent = accent;
  if (accent2) cfg.accent2 = accent2;

  if (cta) {
    cfg.ctaMode = "solid";
    cfg.ctaSolid = cta;
  } else if (ctaA || ctaB) {
    cfg.ctaMode = "gradient";
    if (ctaA) cfg.ctaA = ctaA;
    if (ctaB) cfg.ctaB = ctaB;
    if (ctaAngle != null) cfg.ctaAngle = ctaAngle;
  } else if (accent2 || accent) {
    cfg.ctaMode = "solid";
    cfg.ctaSolid = accent2 ?? accent!;
  }

  return cfg;
}

function syncGlobalBodyBackground(cfg?: ThemeConfig) {
  if (typeof document === "undefined") return;

  const r = document.documentElement;
  const isSolid = cfg?.bgMode === "solid" && !!cfg?.bgSolid;

  if (isSolid) {
    r.style.setProperty("--t-bg-base", cfg!.bgSolid!);
    r.style.setProperty("--t-bg", "none");
    return;
  }

  r.style.setProperty("--t-bg-base", "#070014");

  const raw = (cfg as any)?.__rawBg as string | undefined;
  if (raw && /gradient\(/i.test(raw)) {
    r.style.setProperty("--t-bg", raw);
  }
}

/* =========================================================
   Page
========================================================= */
export default function StoreCatalogPage() {
  const params = useParams<{ slug: string; mode: string }>();
  const searchParams = useSearchParams();

  const slug = String(params?.slug ?? "");
  const mode = String(params?.mode ?? "detal");
  const key = searchParams.get("key");

  const safeMode: Mode = useMemo(() => (isValidMode(mode) ? mode : "detal"), [mode]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [store, setStore] = useState<StoreRow | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [links, setLinks] = useState<any[]>([]);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [totalCount, setTotalCount] = useState<number | null>(null);

  const { initCart, addItem } = useCart();

  /* -------------------------
     Load base
  ------------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setMsg(null);
      setLoading(true);

      try {
        const sb = supabaseBrowser();

        if (!slug || !isValidMode(mode)) {
          if (!cancelled) setMsg("❌ Ruta inválida.");
          return;
        }

        const { data: storeData, error: storeErr } = await sb
          .from("stores")
          .select("id,name,slug,whatsapp,active,catalog_retail,catalog_wholesale,theme,logo_url,banner_url,wholesale_key")
          .eq("slug", slug)
          .maybeSingle();

        if (storeErr || !storeData) {
          if (!cancelled) setMsg("❌ Tienda no encontrada.");
          return;
        }

        const st = storeData as StoreRow;

        if (safeMode === "mayor") {
          if (!st.wholesale_key) {
            if (!cancelled) setMsg("❌ Este catálogo mayorista no está disponible.");
            return;
          }
          if (key !== st.wholesale_key) {
            if (!cancelled) setMsg("🔒 Catálogo mayorista privado. Solicita acceso por WhatsApp.");
            return;
          }
        }

        if (!st.active) {
          if (!cancelled) setMsg("❌ Esta tienda está desactivada.");
          return;
        }

        if (safeMode === "detal" && !st.catalog_retail) {
          if (!cancelled) setMsg("❌ Catálogo detal no disponible.");
          return;
        }

        if (safeMode === "mayor" && !st.catalog_wholesale) {
          if (!cancelled) setMsg("❌ Catálogo mayor no disponible.");
          return;
        }

        if (!cancelled) setStore(st);

        // theme
        const themeId = st.theme?.trim() || null;
        let cfg: ThemeConfig | undefined;

        if (themeId) {
          const { data: themeRow } = await sb.from("themes").select("id,active,config").eq("id", themeId).maybeSingle();
          cfg = mapDbThemeToApplyTheme(themeRow?.config);
        }

        if (!cfg) {
          const { data: fallback } = await sb
            .from("themes")
            .select("id,config")
            .eq("active", true)
            .order("sort_order", { ascending: true })
            .limit(1)
            .maybeSingle();

          cfg = mapDbThemeToApplyTheme(fallback?.config);
        }

        applyThemeToRoot(cfg);
        syncGlobalBodyBackground(cfg);

        initCart({
          storeId: st.id,
          storeSlug: st.slug,
          storeName: st.name,
          whatsapp: st.whatsapp,
          mode: safeMode,
        });

        // profile
        const { data: profData } = await sb.from("store_profiles").select("*").eq("store_id", st.id).maybeSingle();
        if (!cancelled) setProfile(profData ?? null);

        // links
        const { data: linksData } = await sb
          .from("store_links")
          .select("id,type,label,url,active,sort_order,icon_url")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (!cancelled) setLinks(linksData ?? []);

        // categories
        const { data: catData } = await sb
          .from("product_categories")
          .select("id,name,image_url,sort_order")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (!cancelled) setCategories((catData as any) ?? []);
      } catch (err: any) {
        if (!cancelled) setMsg(err?.message ?? "Error cargando catálogo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, mode, key, initCart, safeMode]);

  /* -------------------------
     favicon (normal)
  ------------------------- */
  useEffect(() => {
    if (!store?.name) return;

    document.title = `${store.name} - Catálogos online`;

    const favicon =
      (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null) ||
      (document.createElement("link") as HTMLLinkElement);

    favicon.rel = "icon";
    favicon.href = store.logo_url ? store.logo_url : "/favicon.ico";
    document.head.appendChild(favicon);
  }, [store]);

  /* -------------------------
     Query builder
  ------------------------- */
  function buildProductsQuery(sb: ReturnType<typeof supabaseBrowser>, storeId: string) {
    let query = sb
      .from("products")
      .select("id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock")
      .eq("store_id", storeId)
      .eq("active", true)
      .or("stock.is.null,stock.gt.0");

    if (selectedCat) query = query.eq("category_id", selectedCat);

    const s = (dq ?? "").trim();
    if (s.length >= 2) {
      const safe = s.replace(/,/g, " ");
      query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
    }

    return query.order("name", { ascending: true }).order("id", { ascending: true });
  }

  async function fetchCountEstimated() {
    if (!store?.id) return;
    try {
      const sb = supabaseBrowser();

      let q = sb
        .from("products")
        .select("id", { head: true, count: "estimated" })
        .eq("store_id", store.id)
        .eq("active", true)
        .or("stock.is.null,stock.gt.0");

      if (selectedCat) q = q.eq("category_id", selectedCat);

      const s = (dq ?? "").trim();
      if (s.length >= 2) {
        const safe = s.replace(/,/g, " ");
        q = q.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
      }

      const { count } = await q;
      setTotalCount(typeof count === "number" ? count : null);
    } catch {
      setTotalCount(null);
    }
  }

  async function fetchProductsPage(opts: { reset: boolean; pageIndex?: number }) {
    if (!store?.id) return;

    const sb = supabaseBrowser();
    const pageIndex = opts.reset ? 0 : (opts.pageIndex ?? page);
    const from = pageIndex * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await buildProductsQuery(sb, store.id).range(from, to);
    if (error) throw error;

    const normalized: ProductRow[] = ((data as any[]) ?? [])
      .map((p) => ({
        ...p,
        price_retail: Number(p.price_retail ?? 0),
        price_wholesale: Number(p.price_wholesale ?? 0),
        min_wholesale: p.min_wholesale == null ? null : Number(p.min_wholesale),
        stock: p.stock === null || p.stock === undefined ? null : Number(p.stock),
      }))
      .filter((p) => p.stock === null || Number(p.stock) > 0);

    if (opts.reset) {
      setProducts(normalized);
      setPage(0);
      setHasMore(normalized.length === PAGE_SIZE);
    } else {
      setProducts((prev) => [...prev, ...normalized]);
      setHasMore(normalized.length === PAGE_SIZE);
    }
  }

  // reset al cambiar filtros/busqueda (debounced)
  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;

    (async () => {
      setLoadingMore(true);
      setHasMore(false);
      setPage(0);

      try {
        await fetchCountEstimated();
        await fetchProductsPage({ reset: true });
      } catch (e: any) {
        if (!cancelled) setMsg(e?.message ?? "Error cargando productos.");
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.id, selectedCat, dq]);

  async function loadMore() {
    if (!store?.id) return;
    if (loadingMore) return;

    setLoadingMore(true);
    try {
      const next = page + 1;
      await fetchProductsPage({ reset: false, pageIndex: next });
      setPage(next);
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando más productos.");
    } finally {
      setLoadingMore(false);
    }
  }

  /* -------------------------
     Add to cart
  ------------------------- */
  async function addToCartWithQty(p: ProductRow, price: number) {
    const isUnlimited = p.stock === null;
    const stockNum = isUnlimited ? Infinity : Math.max(0, Math.floor(Number(p.stock || 0)));

    if (!isUnlimited && stockNum <= 0) {
      await Swal.fire({
        icon: "info",
        title: "Producto agotado",
        text: "Este producto no tiene unidades disponibles por ahora.",
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    const min = safeMode === "mayor" ? Math.max(1, Number(p.min_wholesale ?? 1)) : 1;
    const start = min;

    const res = await Swal.fire({
      title: "Agregar al carrito",
      html: `
        <div style="text-align:left; opacity:.92">
          <div style="font-weight:900; margin-bottom:6px;">${p.name}</div>
          <div style="opacity:.88; margin-bottom:10px;">
            Precio: <b>${money(price)}</b>
          </div>

          <div style="font-size:12px; opacity:.82; margin-bottom:10px;">
            Disponible: <b>${isUnlimited ? "Ilimitado" : stockNum}</b>
            ${safeMode === "mayor" ? ` · Mínimo: <b>${min}</b>` : ""}
          </div>

          <label style="font-size:12px; opacity:.8;">Cantidad</label>
          <input
            id="qty"
            type="number"
            class="swal2-input"
            value="${start}"
            min="${min}"
            ${isUnlimited ? "" : `max="${stockNum}"`}
            style="margin-top:6px;"
          />
        </div>
      `,
      background: "#0b0b0b",
      color: "#fff",
      showCancelButton: true,
      confirmButtonText: "Agregar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#22c55e",
      preConfirm: () => {
        const el = document.getElementById("qty") as HTMLInputElement | null;
        const raw = el?.value ?? start;
        const qty = Math.max(min, Math.floor(Number(raw)));

        if (!Number.isFinite(qty) || qty < min) {
          Swal.showValidationMessage(`La cantidad mínima es ${min}.`);
          return;
        }

        if (!isUnlimited && qty > stockNum) {
          Swal.showValidationMessage(`Solo hay ${stockNum} unidades disponibles.`);
          return;
        }

        return qty;
      },
    });

    if (!res.isConfirmed) return;

    const qty = Number(res.value ?? start);

    try {
      (addItem as any)(
        { productId: p.id, name: p.name, price: Number(price ?? 0), qty, minWholesale: p.min_wholesale ?? null },
        { openDrawer: false }
      );
    } catch {
      addItem({ productId: p.id, name: p.name, price: Number(price ?? 0), qty, minWholesale: p.min_wholesale ?? null } as any);
    }

    await Swal.fire({
      icon: "success",
      title: "Agregado",
      text: `Se agregó ${qty} × ${p.name} al carrito.`,
      timer: 950,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
  }

  /* =========================================================
     Render
  ========================================================= */
  if (loading) {
    return (
      <main className="p-6" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <div className="mx-auto max-w-6xl">
          <div
            className="rounded-3xl border p-5"
            style={{
              borderColor: "var(--t-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              Cargando catálogo...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!store) {
    return (
      <main className="p-6" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <div className="mx-auto max-w-6xl">
          <p>{msg ?? "No se pudo cargar."}</p>
        </div>
      </main>
    );
  }

  const accentChipBg = "color-mix(in oklab, var(--t-accent2) 70%, white 0%)";
  const glassBg = "color-mix(in oklab, var(--t-card-bg) 78%, transparent)";
  const glassBg2 = "color-mix(in oklab, var(--t-card-bg) 64%, transparent)";

  return (
    <main className="min-h-screen" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)", opacity: 0.22 }} />
      </div>

      <style jsx global>{`
        .t-glass {
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .t-ring:focus {
          outline: none;
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--t-accent2) 35%, transparent);
        }
        .t-card {
          transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
        }
        .t-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 22px 55px rgba(0, 0, 0, 0.28);
          border-color: color-mix(in oklab, var(--t-border) 60%, white 15%);
        }
        .t-btn {
          transition: transform 180ms ease, filter 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
        }
        .t-btn:active {
          transform: scale(0.99);
        }
        .t-btn:hover {
          filter: brightness(1.05);
        }
        .t-btn[disabled] {
          opacity: 0.55;
          cursor: not-allowed;
          filter: none !important;
        }
      `}</style>

      {/* Topbar */}
      <div className="sticky top-0 z-40 border-b t-glass" style={{ borderColor: "var(--t-border)", background: glassBg }}>
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <SmartImg
                src={store.logo_url}
                alt={store.name}
                className="h-10 w-10 rounded-2xl border object-cover"
                style={{ borderColor: "var(--t-border)" } as any}
                loading="eager"
                priority
                borderColorVar="var(--t-border)"
              />

              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">{store.name}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {safeMode === "detal" ? "Catálogo Detal" : "Catálogo Mayoristas"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="hidden sm:inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
                style={{ borderColor: "var(--t-border)", background: glassBg2 }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentChipBg }} />
                {safeMode === "detal" ? "DETAL" : "MAYOR"}
              </span>

              {safeMode === "detal" ? (
                <a
                  className="t-btn rounded-2xl border px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                  href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(
                    `Hola! Quiero acceso al catálogo MAYORISTA de ${store.name}.`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Solicitar mayoristas
                </a>
              ) : (
                <a
                  className="t-btn rounded-2xl border px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                  href={`/${store.slug}/detal`}
                >
                  Ver Detal
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div className="rounded-[28px] border p-5 t-glass" style={{ borderColor: "var(--t-border)", background: glassBg }}>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight">{store.name}</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              {safeMode === "detal" ? "Compra al detal" : "Compra al por mayor"} ·{" "}
              {totalCount != null ? (
                <>
                  Mostrando <b style={{ color: "var(--t-text)" }}>{products.length}</b> de{" "}
                  <b style={{ color: "var(--t-text)" }}>{totalCount}</b>
                </>
              ) : (
                <>
                  Mostrando <b style={{ color: "var(--t-text)" }}>{products.length}</b>
                </>
              )}
            </p>

            {profile?.headline ? <p className="mt-3 text-sm opacity-90">{profile.headline}</p> : null}

            {links.length ? (
              <div className="mt-4">
                <SocialIconRow links={links} />
              </div>
            ) : null}
          </div>
        </div>

        {/* Banner (carga normal, pero con reintento y placeholder) */}
        {store.banner_url ? (
          <div className="mt-5">
            <div className="relative overflow-hidden rounded-[28px] border" style={{ borderColor: "var(--t-border)" }}>
              <SmartImg
                src={store.banner_url}
                alt="Banner"
                className="h-56 w-full rounded-[28px] object-cover sm:h-64 md:h-80"
                style={{ borderColor: "var(--t-border)" } as any}
                loading="eager"
                priority
                borderColorVar="var(--t-border)"
              />
            </div>
          </div>
        ) : null}
      </header>

      {/* BODY */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
        {/* Categorías */}
        {categories.length > 0 ? (
          <div className="mt-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold">Categorías</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                  Filtra para encontrar más rápido
                </p>
              </div>

              {selectedCat ? (
                <button
                  className="t-btn rounded-2xl border px-3 py-2 text-xs font-semibold sm:text-sm"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                  onClick={() => setSelectedCat(null)}
                >
                  Ver todo
                </button>
              ) : null}
            </div>

            <div className="mt-3 flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((c) => {
                const active = selectedCat === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCat(c.id)}
                    className={cx("t-btn shrink-0 rounded-2xl border p-2 text-left", active && "ring-2 ring-white/25")}
                    style={{ width: 150, borderColor: "var(--t-border)", background: glassBg }}
                  >
                    <SmartImg
                      src={c.image_url}
                      alt={c.name}
                      className="aspect-square w-full rounded-xl border object-cover"
                      style={{ borderColor: "var(--t-border)" } as any}
                      loading="lazy"
                      borderColorVar="var(--t-border)"
                    />
                    <p className="mt-2 line-clamp-2 text-sm font-bold">{c.name}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Buscador */}
        <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--t-border)", background: glassBg2 }}>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
            Buscar producto (2+ letras)
          </label>
          <input
            className="t-ring mt-2 w-full rounded-xl border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--t-border)",
              background: "color-mix(in oklab, var(--t-bg-base) 70%, transparent)",
              color: "var(--t-text)",
            }}
            placeholder="Ej: cepillo, plancha, perfume..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {q ? (
            <button type="button" className="mt-2 text-xs underline opacity-80" onClick={() => setQ("")} style={{ color: "var(--t-muted)" }}>
              Limpiar búsqueda
            </button>
          ) : null}
        </div>

        {/* Productos */}
        <div className="mt-7 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold">Productos</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              {products.length} cargados {totalCount != null ? `· aprox ${totalCount} total` : ""}
            </p>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-border)", background: glassBg2 }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentChipBg }} />
            {safeMode === "detal" ? "DETAL" : "MAYOR"}
          </span>
        </div>

        {products.length === 0 && !loadingMore ? (
          <div className="mt-5 rounded-[28px] border p-6" style={{ borderColor: "var(--t-border)", background: glassBg }}>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              No hay productos disponibles (o están agotados).
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p, idx) => {
                const price = safeMode === "detal" ? p.price_retail : p.price_wholesale;

                const isUnlimited = p.stock === null;
                const stockNum = isUnlimited ? Infinity : Math.max(0, Math.floor(Number(p.stock || 0)));
                const isOut = !isUnlimited && stockNum <= 0;

                const stockInfo = stockMeta(p.stock);

                const stockPill =
                  stockInfo.tone === "danger"
                    ? {
                        border: "color-mix(in oklab, red 35%, var(--t-border))",
                        bg: "color-mix(in oklab, red 12%, transparent)",
                        color: "color-mix(in oklab, white 92%, red 8%)",
                      }
                    : stockInfo.tone === "warn"
                    ? {
                        border: "color-mix(in oklab, orange 35%, var(--t-border))",
                        bg: "color-mix(in oklab, orange 12%, transparent)",
                        color: "color-mix(in oklab, white 92%, orange 8%)",
                      }
                    : {
                        border: "color-mix(in oklab, lime 30%, var(--t-border))",
                        bg: "color-mix(in oklab, lime 10%, transparent)",
                        color: "color-mix(in oklab, white 92%, lime 8%)",
                      };

                // ✅ primeras 6 imágenes eager para que “se vea normal” rápido
                const priority = idx < 6;

                return (
                  <div key={p.id} className="t-card rounded-[28px] border p-4" style={{ borderColor: "var(--t-border)", background: glassBg }}>
                    <SmartImg
                      src={p.image_url}
                      alt={p.name}
                      className="mb-3 aspect-square w-full rounded-2xl border object-cover"
                      style={{ borderColor: "var(--t-border)" } as any}
                      loading={priority ? "eager" : "lazy"}
                      priority={priority}
                      borderColorVar="var(--t-border)"
                    />

                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-extrabold leading-tight">{p.name}</h3>
                      <span className="rounded-full px-3 py-1 text-[11px] font-extrabold" style={{ background: accentChipBg, color: "#0b0b0b" }}>
                        {safeMode === "detal" ? "DETAL" : "MAYOR"}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold"
                        style={{ borderColor: stockPill.border, background: stockPill.bg, color: stockPill.color }}
                      >
                        {stockInfo.tone === "danger" ? "⛔" : stockInfo.tone === "warn" ? "⚠️" : "✅"} {stockInfo.label}
                      </span>

                      {safeMode === "mayor" && p.min_wholesale ? (
                        <span
                          className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold"
                          style={{
                            borderColor: "color-mix(in oklab, var(--t-border) 80%, transparent)",
                            background: "color-mix(in oklab, var(--t-card-bg) 62%, transparent)",
                            color: "var(--t-muted)",
                          }}
                        >
                          Mínimo: <b style={{ color: "var(--t-text)" }}>{p.min_wholesale}</b>
                        </span>
                      ) : null}
                    </div>

                    {p.description ? (
                      <p className="mt-2 line-clamp-3 text-sm" style={{ color: "var(--t-muted)" }}>
                        {p.description}
                      </p>
                    ) : null}

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                          Precio
                        </p>
                        <p className="text-lg font-black">{money(price)}</p>
                      </div>

                      <button
                        className="t-btn rounded-2xl px-4 py-2 text-sm font-extrabold"
                        style={{ background: "var(--t-cta)", color: "#0b0b0b", boxShadow: "0 18px 48px rgba(0,0,0,0.22)" }}
                        onClick={() => addToCartWithQty(p, Number(price ?? 0))}
                        disabled={isOut}
                      >
                        {isOut ? "Agotado" : "Agregar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-center">
              {hasMore ? (
                <button
                  type="button"
                  className="t-btn rounded-2xl border px-5 py-3 text-sm font-extrabold"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Cargando..." : `Cargar más (+${PAGE_SIZE})`}
                </button>
              ) : (
                <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
                  ✅ Ya no hay más productos para cargar.
                </p>
              )}
            </div>
          </>
        )}

        <div className="mt-10 border-t pt-6" style={{ borderColor: "var(--t-border)" }}>
          <div className="text-sm" style={{ color: "var(--t-muted)" }}>
            {profile?.address || profile?.city ? (
              <p>
                {profile?.address ? profile.address + " · " : ""}
                {profile?.city ?? ""}
              </p>
            ) : (
              <p>Catálogo generado por la tienda.</p>
            )}
          </div>
        </div>
      </section>

      {msg ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
          <div
            className="rounded-2xl border px-4 py-3 text-sm t-glass"
            style={{
              borderColor: "var(--t-border)",
              background: "rgba(0,0,0,0.55)",
              color: "rgba(255,255,255,0.92)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
            }}
          >
            {msg}
          </div>
        </div>
      ) : null}

      <CartDrawer />
    </main>
  );
}
