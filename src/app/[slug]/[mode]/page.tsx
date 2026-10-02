"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, MapPin, Pause, Play, Sparkles, X } from "lucide-react";
import Swal from "sweetalert2";

import { supabaseBrowser } from "@/lib/supabase/client";
import { StoreContactIcon } from "@/components/StoreContactIcon";
import { ShareProductButton } from "@/components/ShareProductButton";
import { buildProductShareText, hasProductLanding } from "@/lib/product-details";
import { SocialIconRow } from "./socials";
import { useCart } from "@/lib/cart/CartProvider";
import { CartDrawer } from "@/lib/cart/CartDrawer";
import { normalizeStoreContactChannels, whatsappUrl } from "@/lib/store-contacts";

import { applyThemeToElement, type ThemeConfig } from "@/lib/themes/applyTheme";

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
  stock: number | null; // ✅ inventario (null = ilimitado)
  product_details: unknown;
};

type CategoryRow = {
  id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
};

type StoreProfile = {
  headline?: string | null;
  address?: string | null;
  city?: string | null;
  contact_channels?: unknown;
  locations?: unknown;
};

type StoreLocation = {
  id: string;
  name: string;
  address: string;
  city: string;
  map_url: string;
  photo_url: string;
  description: string;
  active: boolean;
};

type CatalogCampaign = {
  id: string;
  name: string;
  description: string;
  cover_image_url: string;
  category_id: string | null;
  products: ProductRow[];
};

type CampaignSlide = {
  campaign: CatalogCampaign;
  kind: "cover" | "product";
  products: ProductRow[];
};

type StoreLinkRow = {
  id: string;
  type: string;
  label: string | null;
  url: string;
  icon_url: string | null;
};

/* =========================================================
   Helpers
========================================================= */
const PAGE_SIZE = 30;

function normalizeStoreSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function normalizeLegacyStoreSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

function normalizeStoreLocations(value: unknown): StoreLocation[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const text = (key: string) => typeof item[key] === "string" ? item[key].trim() : "";
    const name = text("name");
    const active = item.active !== false;
    if (!name || !active) return [];
    const mapUrl = text("map_url");
    const photoUrl = text("photo_url");
    const safeUrl = (url: string) => {
      try {
        return ["https:", "http:"].includes(new URL(url).protocol);
      } catch {
        return false;
      }
    };
    return [{
      id: text("id") || `location-${index}`,
      name,
      address: text("address"),
      city: text("city"),
      map_url: safeUrl(mapUrl) ? mapUrl : "",
      photo_url: safeUrl(photoUrl) ? photoUrl : "",
      description: text("description"),
      active,
    }];
  });
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

/* =========================================================
   Page  ✅ PAGINADO 30 + BOTÓN "CARGAR MÁS"
   - Carga imágenes normal (como antes)
   - Pero NO trae todos los productos de golpe
========================================================= */
export default function StoreCatalogPage() {
  const params = useParams<{ slug: string; mode: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const slug = String(params?.slug ?? "");
  const mode = String(params?.mode ?? "detal");
  const key = searchParams.get("key");

  const safeMode: Mode = useMemo(() => (isValidMode(mode) ? mode : "detal"), [mode]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [store, setStore] = useState<StoreRow | null>(null);
  const [catalogTheme, setCatalogTheme] = useState<ThemeConfig>();
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [links, setLinks] = useState<StoreLinkRow[]>([]);
  const [campaigns, setCampaigns] = useState<CatalogCampaign[]>([]);
  const [campaignLoadMessage, setCampaignLoadMessage] = useState<string | null>(null);
  const [dailyCampaign, setDailyCampaign] = useState<CatalogCampaign | null>(null);
  const [campaignSlideIndex, setCampaignSlideIndex] = useState(0);
  const [campaignCarouselPaused, setCampaignCarouselPaused] = useState(false);
  const [campaignCarouselHovered, setCampaignCarouselHovered] = useState(false);
  const [loadedCampaignSlideKey, setLoadedCampaignSlideKey] = useState<string | null>(null);
  const [visitorLocation, setVisitorLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearbyMessage, setNearbyMessage] = useState<string | null>(null);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [pendingCampaignScroll, setPendingCampaignScroll] = useState<{
    categoryId: string | null;
    productId: string | null;
  } | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [imgLoaded, setImgLoaded] = useState(false);

  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const { initCart, addItem } = useCart();
  const campaignSlides = useMemo<CampaignSlide[]>(
    () => campaigns.flatMap((campaign) => [
      {
        campaign,
        kind: "cover" as const,
        products: [],
      },
      ...Array.from(
        { length: Math.ceil(campaign.products.filter((product) => product.image_url).length / 2) },
        (_, index) => ({
          campaign,
          kind: "product" as const,
          products: campaign.products.filter((product) => product.image_url).slice(index * 2, index * 2 + 2),
        }),
      ),
    ]),
    [campaigns],
  );

  useEffect(() => {
    setCampaignSlideIndex((index) => campaignSlides.length ? index % campaignSlides.length : 0);
  }, [campaignSlides.length]);

  useEffect(() => {
    if (campaignSlides.length < 2 || campaignCarouselPaused || campaignCarouselHovered || dailyCampaign) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setCampaignSlideIndex((index) => (index + 1) % campaignSlides.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [campaignCarouselHovered, campaignCarouselPaused, campaignSlides.length, dailyCampaign]);

  useEffect(() => {
    if (loading || !store || campaigns.length === 0) return;
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const storageKey = `remhub:campaign-announcement:${store.id}:${dateKey}`;
    try {
      if (window.localStorage.getItem(storageKey)) return;
      window.localStorage.setItem(storageKey, "shown");
    } catch (error) {
      console.warn("No fue posible recordar el aviso diario de campaña en este navegador.", error);
    }
    setDailyCampaign(campaigns[0]);
  }, [campaigns, loading, store]);

  useEffect(() => {
    if (!pendingCampaignScroll || loadingMore || selectedCat !== pendingCampaignScroll.categoryId) return;
    if (pendingCampaignScroll.productId) {
      const target = document.getElementById(`catalog-product-${pendingCampaignScroll.productId}`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingCampaignScroll(null);
      return;
    }
    if (!products.length || (pendingCampaignScroll.categoryId &&
      products.some((product) => product.category_id !== pendingCampaignScroll.categoryId))) return;
    const firstProduct = products[0];
    document.getElementById(`catalog-product-${firstProduct.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingCampaignScroll(null);
  }, [loadingMore, pendingCampaignScroll, products, selectedCat]);

  /* -------------------------
     Load base (store/theme/profile/links/categories)
  ------------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setMsg(null);
      setLoading(true);
      setCampaigns([]);
      setCampaignLoadMessage(null);

      try {
        const sb = supabaseBrowser();

        if (!slug || !isValidMode(mode)) {
          if (!cancelled) setMsg("❌ Ruta inválida.");
          return;
        }

        // 1) store
        let { data: storeData, error: storeErr } = await sb
          .from("stores")
          .select("id,name,slug,whatsapp,active,catalog_retail,catalog_wholesale,theme,logo_url,banner_url,wholesale_key")
          .eq("slug", slug)
          .maybeSingle();

        if (storeErr) throw storeErr;
        const slugCandidates = [...new Set([normalizeStoreSlug(slug), normalizeLegacyStoreSlug(slug)].filter((candidate) => candidate && candidate !== slug))];
        for (const candidate of slugCandidates) {
          if (storeData) break;
          const normalizedStoreResult = await sb
            .from("stores")
            .select("id,name,slug,whatsapp,active,catalog_retail,catalog_wholesale,theme,logo_url,banner_url,wholesale_key")
            .eq("slug", candidate)
            .maybeSingle();
          if (normalizedStoreResult.error) {
            storeErr = normalizedStoreResult.error;
            break;
          }
          storeData = normalizedStoreResult.data;
        }

        if (storeErr) throw storeErr;
        if (!storeData) {
          if (!cancelled) setMsg("❌ Tienda no encontrada.");
          return;
        }

        const st = storeData as StoreRow;
        if (st.slug !== slug) {
          const query = window.location.search;
          router.replace(`/${encodeURIComponent(st.slug)}/${safeMode}${query}`);
        }

        // mayorista key
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

        // 2) theme
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

        if (!cancelled) setCatalogTheme(cfg);

        // 3) profile
        const profileResult = await sb
          .from("store_profiles")
          .select("headline,address,city,contact_channels,locations")
          .eq("store_id", st.id)
          .maybeSingle();
        let profileData: StoreProfile | null = profileResult.data;
        let profileError = profileResult.error;
        if (profileError && ["42703", "PGRST204"].includes(profileError.code)) {
          const legacyProfile = await sb
            .from("store_profiles")
            .select("headline,address,city")
            .eq("store_id", st.id)
            .maybeSingle();
          profileData = legacyProfile.data;
          profileError = legacyProfile.error;
        }
        if (profileError) throw profileError;
        const profData = profileData;
        if (!cancelled) setProfile(profData ?? null);
        const contactChannels = normalizeStoreContactChannels(profData?.contact_channels, st.whatsapp)
          .filter((channel) => channel.active);

        // Initialize checkout routing with the latest store contact settings.
        initCart({
          storeId: st.id,
          storeSlug: st.slug,
          storeName: st.name,
          whatsapp: st.whatsapp,
          contactChannels,
          mode: safeMode,
        });

        // 4) links
        const { data: linksData, error: linksError } = await sb
          .from("store_links")
          .select("id,type,label,url,active,sort_order,icon_url")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (linksError) throw linksError;
        if (!cancelled) setLinks((linksData ?? []) as StoreLinkRow[]);

        // 5) categories
        const { data: catData, error: categoriesError } = await sb
          .from("product_categories")
          .select("id,name,image_url,sort_order")
          .eq("store_id", st.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (categoriesError) throw categoriesError;
        if (!cancelled) setCategories((catData as any) ?? []);

        try {
          const campaignQuery = new URLSearchParams({ mode: safeMode });
          if (safeMode === "mayor" && key) campaignQuery.set("key", key);
          const campaignResponse = await fetch(
            `/api/catalog/${encodeURIComponent(st.slug)}/campaigns?${campaignQuery.toString()}`,
            { cache: "no-store" },
          );
          const campaignPayload = await campaignResponse.json() as {
            campaigns?: CatalogCampaign[];
            error?: string;
          };
          if (!campaignResponse.ok) {
            throw new Error(campaignPayload.error || "No se pudieron cargar las campañas visibles.");
          }
          const publicCampaigns = (campaignPayload.campaigns ?? []).filter(
            (campaign) => Boolean(campaign.cover_image_url?.trim()),
          );
          if (!cancelled) {
            setCampaigns(publicCampaigns);
            setCampaignLoadMessage(null);
          }
        } catch (campaignError) {
          console.error("No se pudieron cargar las campañas públicas del catálogo.", campaignError);
          if (!cancelled) {
            setCampaigns([]);
            setCampaignLoadMessage(
              campaignError instanceof Error
                ? campaignError.message
                : "No se pudieron cargar las campañas. Revisa la configuración de Supabase.",
            );
          }
        }
      } catch (err: any) {
        if (!cancelled) setMsg(err?.message ?? "Error cargando catálogo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, mode, key, initCart, router, safeMode]);

  useEffect(() => {
    const catalog = document.querySelector<HTMLElement>("[data-store-catalog]");
    if (catalog) applyThemeToElement(catalogTheme, catalog);
  }, [catalogTheme, loading, store]);

  /* -------------------------
     favicon (✅ sin cache-bust)
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
     Load products (paged)
     - 30 al inicio
     - "Cargar más" suma 30
     - Filtros (q + category) se aplican en el server
  ------------------------- */
  async function fetchProducts(opts: { reset: boolean; nextPage?: number }) {
    if (!store?.id) return;

    const sb = supabaseBrowser();

    const pageToLoad = opts.reset ? 0 : (opts.nextPage ?? page);
    const from = pageToLoad * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // base
    let query = sb
      .from("products")
      .select(
        "id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock,product_details",
        { count: "exact" }
      )
      .eq("store_id", store.id)
      .eq("active", true)
      .or("stock.is.null,stock.gt.0"); // disponibles

    // category (server)
    if (selectedCat) query = query.eq("category_id", selectedCat);

    // search (server) — si quieres, puedes quitarlo y dejarlo local
    const s = q.trim();
    if (s.length >= 2) {
      const safe = s.replace(/,/g, " ");
      query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
    }

    // orden estable + rango
    const { data, error, count } = await query
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

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
    } else {
      setProducts((prev) => [...prev, ...normalized]);
    }

    setHasMore(to + 1 < Number(count ?? 0));
  }

  // reset paging cuando cambian filtros
  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;

    (async () => {
      try {
        setLoadingMore(true);
        setHasMore(false);
        setPage(0);
        await fetchProducts({ reset: true });
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
  }, [store?.id, selectedCat, q]);

  async function loadMore() {
    if (!store?.id) return;
    if (loadingMore) return;

    setLoadingMore(true);
    try {
      const next = page + 1;
      await fetchProducts({ reset: false, nextPage: next });
      setPage(next);
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando más productos.");
    } finally {
      setLoadingMore(false);
    }
  }

  /* -------------------------
     Add to cart (with stock limits + ilimitado)
  ------------------------- */
  async function addToCartWithQty(p: ProductRow, price: number) {
    const isUnlimited = p.stock === null;

    const stockNum = isUnlimited ? Infinity : Math.max(0, Math.floor(Number(p.stock || 0)));

    if (!isUnlimited && stockNum <= 0) {
      await Swal.fire({
        icon: "info",
        title: "Producto agotado",
        text: "Este producto no tiene unidades disponibles por ahora.",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
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

          <div style="font-size:12px; opacity:.7; margin-top:6px;">
            ${isUnlimited ? "* Sin límite de stock." : "* No se permite pedir más que el stock disponible."}
          </div>
        </div>
      `,
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
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
        {
          productId: p.id,
          name: p.name,
          price: Number(price ?? 0),
          qty,
          minWholesale: p.min_wholesale ?? null,
        },
        { openDrawer: false }
      );
    } catch {
      addItem({
        productId: p.id,
        name: p.name,
        price: Number(price ?? 0),
        qty,
        minWholesale: p.min_wholesale ?? null,
      } as any);
    }

    await Swal.fire({
      icon: "success",
      title: "Agregado",
      text: `Se agregó ${qty} × ${p.name} al carrito.`,
      timer: 950,
      showConfirmButton: false,
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
    });
  }

  /* =========================================================
     Render states
  ========================================================= */
  if (loading) {
    return (
      <main data-store-catalog className="min-h-screen p-6" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
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
      <main data-store-catalog className="min-h-screen p-6" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <div className="mx-auto max-w-6xl">
          <p>{msg ?? "No se pudo cargar."}</p>
        </div>
      </main>
    );
  }

  const contactChannels = normalizeStoreContactChannels(profile?.contact_channels, store.whatsapp)
    .filter((channel) => channel.active);
  const storeLocations = normalizeStoreLocations(profile?.locations);
  function findNearbyLocations() {
    setNearbyMessage(null);
    if (!navigator.geolocation) {
      setNearbyMessage("Tu navegador no permite compartir ubicación. Puedes abrir el mapa de cada punto.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setVisitorLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setNearbyMessage(null);
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "No se autorizó la ubicación. Puedes abrir el mapa de cada punto manualmente."
          : error.code === error.POSITION_UNAVAILABLE
            ? "No pudimos obtener tu ubicación. Intenta de nuevo o abre un punto manualmente."
            : "La ubicación tardó demasiado. Intenta de nuevo o abre un punto manualmente.";
        setNearbyMessage(message);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  function openCampaign(campaign: CatalogCampaign, productId?: string) {
    const categoryId = campaign.category_id
      ?? campaign.products.find((product) => product.category_id)?.category_id
      ?? null;
    setQ("");
    setSelectedCat(categoryId);
    setPendingCampaignScroll({
      categoryId,
      productId: productId ?? null,
    });
  }
  function showCampaignSlide(index: number) {
    setCampaignSlideIndex((index + campaignSlides.length) % campaignSlides.length);
  }
  const glassBg = "color-mix(in oklab, var(--t-card-bg) 78%, transparent)";
  const glassBg2 = "color-mix(in oklab, var(--t-card-bg) 64%, transparent)";

  return (
    <main data-store-catalog className="min-h-screen" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      {/* overlay SOLO si hay gradient */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)", opacity: "var(--t-store-bg-opacity, 0.14)" }} />
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
          box-shadow: var(--t-shadow);
          border-color: color-mix(in oklab, var(--t-border) 70%, var(--t-accent) 30%);
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
              {store.logo_url ? (
                <img
                  src={store.logo_url}
                  alt={store.name}
                  className="h-10 w-10 rounded-2xl border object-cover"
                  style={{ borderColor: "var(--t-border)" }}
                />
              ) : (
                <div className="h-10 w-10 rounded-2xl border" style={{ borderColor: "var(--t-border)" }} />
              )}

              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">{store.name}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <details className="relative z-0 open:z-[100]">
                <summary
                  className="t-btn cursor-pointer list-none rounded-2xl border px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                >
                  Encuéntranos
                </summary>
                <div
                  className="absolute right-0 top-[calc(100%+0.5rem)] z-[100] max-h-[min(78vh,44rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border p-3 shadow-2xl sm:p-4"
                  style={{
                    borderColor: "var(--t-border)",
                    background: "var(--t-bg-base)",
                    color: "var(--t-text)",
                    boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
                  }}
                >
                  {links.length ? (
                    <section className="space-y-2">
                      <p className="px-1 text-xs font-extrabold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Redes y enlaces</p>
                      {links.map((link) => (
                        <a
                          key={link.id}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold transition hover:brightness-110"
                          style={{ borderColor: "var(--t-border)", background: "color-mix(in srgb, var(--t-bg-base) 90%, var(--t-text) 10%)", color: "var(--t-text)" }}
                        >
                          <span className="min-w-0 truncate">{link.label || link.type}</span><span aria-hidden="true" style={{ color: "var(--t-muted)" }}>↗</span>
                        </a>
                      ))}
                    </section>
                  ) : (
                    <p className="rounded-xl border px-3 py-2.5 text-xs" style={{ borderColor: "var(--t-border)", background: "color-mix(in srgb, var(--t-bg-base) 90%, var(--t-text) 10%)", color: "var(--t-muted)" }}>
                      Agrega tus redes y enlaces desde Mi tienda.
                    </p>
                  )}
                  {storeLocations.length ? (
                    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--t-border)" }}>
                      <p className="mb-2 flex items-center gap-2 px-1 text-xs font-extrabold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
                        <MapPin size={14} /> Nuestros puntos
                      </p>
                      <div className="mb-3 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--t-border)", background: "color-mix(in srgb, var(--t-bg-base) 90%, var(--t-text) 10%)" }}>
                        <p className="text-xs leading-5" style={{ color: "var(--t-text)" }}>
                          Activa tu ubicación para ver rutas desde donde estás y elegir el punto que te convenga. No guardamos tu ubicación.
                        </p>
                        <button
                          type="button"
                          onClick={findNearbyLocations}
                          className="t-btn mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold text-white"
                          style={{ background: "var(--t-cta)" }}
                        >
                          <MapPin size={16} /> {visitorLocation ? "Actualizar mi ubicación" : "Ver rutas desde mi ubicación"}
                        </button>
                        {nearbyMessage ? <p role="status" className="mt-2 text-xs leading-5" style={{ color: "var(--t-muted)" }}>{nearbyMessage}</p> : null}
                        {visitorLocation ? (
                          <p role="status" className="mt-2 text-xs leading-5" style={{ color: "var(--t-muted)" }}>
                            Ya puedes abrir la ruta desde aquí en cada punto.
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-3">
                        {storeLocations.map((location) => {
                          const place = [location.address, location.city].filter(Boolean).join(", ");
                          const mapSearch = place || location.name;
                          const directionsUrl = visitorLocation
                            ? `https://www.google.com/maps/dir/?api=1&origin=${visitorLocation.latitude},${visitorLocation.longitude}&destination=${encodeURIComponent(`${location.name}, ${mapSearch}`)}&travelmode=driving`
                            : location.map_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapSearch)}`;
                          const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(mapSearch)}&output=embed`;
                          return (
                            <article key={location.id} className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-border)", background: "color-mix(in srgb, var(--t-bg-base) 94%, var(--t-text) 6%)" }}>
                              {location.photo_url ? (
                                <img src={location.photo_url} alt={location.name} className="h-32 w-full object-cover" loading="lazy" />
                              ) : null}
                              <div className="p-3 sm:p-4">
                                <h3 className="text-sm font-bold">{location.name}</h3>
                                {place ? <p className="mt-1 break-words text-xs leading-5" style={{ color: "var(--t-muted)" }}>{place}</p> : null}
                                {location.description ? <p className="mt-2 whitespace-pre-line break-words text-xs leading-5" style={{ color: "var(--t-text)" }}>{location.description}</p> : null}
                                <iframe
                                  title={`Mapa de ${location.name}`}
                                  src={embedUrl}
                                  loading="lazy"
                                  referrerPolicy="no-referrer-when-downgrade"
                                  className="mt-3 h-44 w-full rounded-xl border sm:h-52"
                                  style={{ borderColor: "var(--t-border)" }}
                                />
                                <a href={directionsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>
                                  <MapPin size={14} /> Cómo llegar ↗
                                </a>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {safeMode === "mayor" ? (
                    <a
                      href={`/${store.slug}/detal`}
                      className="mt-1 block rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-white/10"
                    >
                      Catálogo público ↗
                    </a>
                  ) : null}
                </div>
              </details>
              <details className="relative z-0 open:z-[100]">
                <summary
                  className="t-btn cursor-pointer list-none rounded-2xl border px-3 py-2 text-xs font-semibold sm:px-4 sm:text-sm"
                  style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                >
                  Contáctanos
                </summary>
                <div
                  className="absolute right-0 top-[calc(100%+0.5rem)] z-[100] max-h-[min(70vh,28rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border p-2.5 shadow-2xl backdrop-blur-xl"
                  style={{
                    borderColor: "var(--t-border)",
                    background: "var(--t-bg-base)",
                    color: "var(--t-text)",
                    boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
                  }}
                >
                  {contactChannels.length > 1 ? (
                    <p className="px-3 pb-2 pt-1 text-xs leading-5" style={{ color: "var(--t-muted)" }}>
                      Elige el asesor del punto de atención más cercano.
                    </p>
                  ) : null}
                  {contactChannels.map((channel) => {
                    const message = safeMode === "detal"
                      ? `Hola, vi el catálogo de ${store.name}. Quiero información.`
                      : `Hola, vi el catálogo mayorista de ${store.name}. Quiero información.`;
                    const href = whatsappUrl(channel.phone, message);
                    return href ? (
                      <a
                        key={channel.id}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-semibold transition hover:bg-emerald-500/10"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-500/10 text-emerald-500">
                          <StoreContactIcon icon={channel.icon} size={38} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{channel.label}</span>
                          <span className="block truncate text-xs font-normal opacity-65">{channel.phone}</span>
                        </span>
                      </a>
                    ) : null;
                  })}
                  {safeMode === "detal" && store.catalog_wholesale && contactChannels[0] ? (
                    <a
                      href={whatsappUrl(
                        contactChannels[0].phone,
                        `Hola, quiero solicitar acceso al catálogo mayorista de ${store.name}.`,
                      ) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block rounded-xl border-t px-3 py-2.5 text-sm font-semibold transition hover:bg-emerald-500/10"
                      style={{ borderColor: "var(--t-border)" }}
                    >
                      Solicitar acceso mayorista
                    </a>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>

      {campaignSlides.length ? (() => {
        const slide = campaignSlides[campaignSlideIndex] ?? campaignSlides[0];
        const slideKey = `${slide.campaign.id}-${slide.kind}-${slide.products.map((product) => product.id).join("-") || "cover"}`;
        const slideLoaded = loadedCampaignSlideKey === slideKey;
        return (
          <section
            aria-label="Campañas y productos destacados"
            className="mx-auto w-full max-w-screen-2xl px-6 pt-6 sm:px-8 lg:px-12"
            onMouseEnter={() => setCampaignCarouselHovered(true)}
            onMouseLeave={() => setCampaignCarouselHovered(false)}
          >
            <div className="relative overflow-hidden rounded-[24px] border shadow-xl" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-base)" }}>
              {slide.kind === "cover" ? (
                <button
                  type="button"
                  onClick={() => openCampaign(slide.campaign)}
                  className="group flex h-[clamp(27rem,78svh,48rem)] w-full flex-col overflow-hidden text-left sm:h-[clamp(31rem,78svh,50rem)]"
                  aria-label={`Ver los productos de ${slide.campaign.name} en su categoría`}
                >
                  <span className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-5">
                    <img
                      key={slideKey}
                      src={slide.campaign.cover_image_url}
                      alt={`Portada de ${slide.campaign.name}`}
                      className={`max-h-full max-w-full object-contain object-center transition duration-700 ease-out group-hover:scale-[1.015] ${slideLoaded ? "opacity-100" : "scale-[1.02] opacity-0"}`}
                      onLoad={() => setLoadedCampaignSlideKey(slideKey)}
                      onError={() => setLoadedCampaignSlideKey(slideKey)}
                      loading="eager"
                    />
                    {!slideLoaded ? (
                      <span className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                    ) : null}
                  </span>
                  <span className="shrink-0 bg-gradient-to-r from-black/95 via-black/85 to-black/70 px-5 py-3 text-white sm:flex sm:items-center sm:gap-5 sm:px-8 sm:py-4">
                    <span className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold backdrop-blur-sm">
                        <Sparkles size={14} aria-hidden="true" />
                        Campaña destacada
                      </span>
                      <span className="mt-2 block text-xl font-black sm:text-2xl">{slide.campaign.name}</span>
                      <span className="mt-1 block max-w-3xl line-clamp-1 text-sm text-white/85">
                        {slide.campaign.description || "Toca para descubrir esta campaña"}
                      </span>
                    </span>
                    <span className="mt-3 inline-flex shrink-0 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-bold backdrop-blur-sm transition group-hover:bg-white/20 sm:mt-0">
                      Explorar campaña
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </span>
                </button>
              ) : (
                <div className={cx(
                  "grid h-[clamp(27rem,72svh,44rem)] gap-2 p-2 sm:h-[clamp(31rem,76svh,48rem)] sm:gap-4 sm:p-4",
                  slide.products.length === 1 ? "grid-cols-1 place-items-center" : "grid-cols-2",
                )}>
                  {slide.products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => openCampaign(slide.campaign, product.id)}
                      className={cx(
                        "group flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/10 text-left",
                        slide.products.length === 1 && "w-full max-w-2xl",
                      )}
                      aria-label={`Ver ${product.name} de la campaña ${slide.campaign.name}`}
                    >
                      <span className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
                        <img
                          src={product.image_url ?? ""}
                          alt={product.name}
                          className="max-h-full max-w-full object-contain object-center transition duration-500 group-hover:scale-[1.025]"
                          loading="lazy"
                        />
                      </span>
                      <span className="shrink-0 bg-gradient-to-r from-black/95 via-black/85 to-black/70 px-3 py-2.5 text-white sm:px-5 sm:py-3">
                        <span className="block line-clamp-1 text-sm font-extrabold sm:text-lg">{product.name}</span>
                        <span className="mt-0.5 block text-xs font-semibold text-white/85 sm:text-sm">
                          {money(safeMode === "detal" ? product.price_retail : product.price_wholesale)} · Ver producto ↓
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {campaignSlides.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => showCampaignSlide(campaignSlideIndex - 1)}
                    className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/45 text-white shadow-lg backdrop-blur transition hover:scale-105 hover:bg-black/65 sm:left-5 sm:h-12 sm:w-12"
                    aria-label="Ver imagen anterior"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <button
                    type="button"
                    onClick={() => showCampaignSlide(campaignSlideIndex + 1)}
                    className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/45 text-white shadow-lg backdrop-blur transition hover:scale-105 hover:bg-black/65 sm:right-5 sm:h-12 sm:w-12"
                    aria-label="Ver siguiente imagen"
                  >
                    <ChevronRight size={22} />
                  </button>
                  <div className="absolute right-3 top-3 flex items-center gap-2 sm:right-5 sm:top-5">
                    <span className="rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                      {campaignSlideIndex + 1} / {campaignSlides.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCampaignCarouselPaused((paused) => !paused)}
                      className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
                      aria-label={campaignCarouselPaused ? "Reanudar carrusel automático" : "Pausar carrusel automático"}
                      title={campaignCarouselPaused ? "Reanudar" : "Pausar"}
                    >
                      {campaignCarouselPaused ? <Play size={15} /> : <Pause size={15} />}
                    </button>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15" aria-hidden="true">
                    <span
                      className="block h-full bg-white/80 transition-[width] duration-500"
                      style={{ width: `${((campaignSlideIndex + 1) / campaignSlides.length) * 100}%` }}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </section>
        );
      })() : store.banner_url ? (
        <div className="mx-auto w-full max-w-screen-2xl px-6 pt-6 sm:px-8 lg:px-12">
          <div className="relative overflow-hidden rounded-[24px] border shadow-xl" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-base)" }}>
            <img
              src={store.banner_url}
              alt={`Portada de ${store.name}`}
              className={cx("h-72 w-full object-contain transition-opacity duration-500 sm:h-80 md:h-[26rem] lg:h-[30rem]", imgLoaded ? "opacity-100" : "opacity-0")}
              onLoad={() => setImgLoaded(true)}
            />
            {!imgLoaded ? (
              <div
                className="absolute inset-0 animate-pulse"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02), rgba(255,255,255,0.06))",
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {campaignLoadMessage ? (
        <p role="status" className="mx-auto mt-3 w-full max-w-screen-2xl px-6 text-xs opacity-70 sm:px-8 lg:px-12">
          {campaignLoadMessage}
        </p>
      ) : null}

      <header className="mx-auto w-full max-w-screen-2xl px-6 pt-6 sm:px-8 lg:px-12">
        <div
          className="flex min-h-14 items-center gap-2 overflow-hidden rounded-2xl border px-4 py-2 sm:gap-4"
          style={{ borderColor: "var(--t-border)", background: glassBg }}
        >
          <h1 className="shrink-0 text-base font-black tracking-tight sm:text-lg">{store.name}</h1>
          <span className="hidden h-5 w-px shrink-0 sm:block" style={{ background: "var(--t-border)" }} />
          <p className="shrink-0 text-xs sm:text-sm" style={{ color: "var(--t-muted)" }}>
            Explora los productos
          </p>
          {profile?.headline ? (
            <p className="hidden min-w-0 flex-1 truncate text-xs opacity-80 md:block" title={profile.headline}>
              {profile.headline}
            </p>
          ) : <span className="min-w-0 flex-1" />}
          {links.length ? (
            <div className="max-w-[36%] shrink-0 overflow-x-auto [&>div]:flex-nowrap [&>div]:gap-1 [&_a]:rounded-lg [&_a]:px-2 [&_a]:py-1 [&_a]:text-xs [&_svg]:h-4 [&_svg]:w-4">
              <SocialIconRow links={links} />
            </div>
          ) : null}
        </div>
      </header>

      {campaigns.length ? (
        <section aria-label="Productos de campañas activas" className="mx-auto w-full max-w-screen-2xl space-y-5 px-6 pt-6 sm:px-8 lg:px-12">
          {campaigns.map((campaign) => (
            <article
              key={campaign.id}
              className="rounded-[28px] border p-4 sm:p-6"
              style={{ borderColor: "var(--t-border)", background: glassBg }}
            >
              <div className="mb-4">
                <div>
                  <h2 className="text-xl font-extrabold sm:text-2xl">{campaign.name}</h2>
                  {campaign.description ? <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{campaign.description}</p> : null}
                  <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Productos disponibles de esta campaña</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {campaign.products.map((product) => (
                  <article
                    key={product.id}
                    id={`campaign-product-${campaign.id}-${product.id}`}
                    className="t-card min-w-0 overflow-hidden rounded-2xl border"
                    style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                  >
                    {product.image_url ? (
                      <Link
                        href={`/${store.slug}/producto/${product.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Ver ficha de ${product.name}`}
                        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"
                      >
                        <img src={product.image_url} alt={product.name} className="aspect-square w-full object-cover" loading="lazy" />
                      </Link>
                    ) : (
                      <div className="grid aspect-square w-full place-items-center text-3xl" style={{ color: "var(--t-muted)" }}>📦</div>
                    )}
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm font-bold">{product.name}</p>
                      <p className="mt-1 text-sm font-black">
                        {money(safeMode === "detal" ? product.price_retail : product.price_wholesale)}
                      </p>
                      {safeMode === "mayor" && product.min_wholesale ? (
                        <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                          Mínimo: {product.min_wholesale}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void addToCartWithQty(
                          product,
                          Number(safeMode === "detal" ? product.price_retail : product.price_wholesale),
                        )}
                        disabled={product.stock !== null && Number(product.stock ?? 0) <= 0}
                        className="t-btn mt-3 w-full rounded-xl px-3 py-2 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ background: "var(--t-cta)", color: "var(--t-text)" }}
                      >
                        {product.stock !== null && Number(product.stock ?? 0) <= 0 ? "Agotado" : "Agregar al carrito"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {/* BODY */}
      <section className="mx-auto w-full max-w-screen-2xl px-6 pb-12 pt-6 sm:px-8 lg:px-12">
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
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name}
                        className="aspect-square w-full rounded-xl border object-cover"
                        style={{ borderColor: "var(--t-border)" }}
                        loading="lazy"
                      />
                    ) : (
                      <div className="aspect-square w-full rounded-xl border" style={{ borderColor: "var(--t-border)" }} />
                    )}
                    <p className="mt-2 line-clamp-2 text-sm font-bold">{c.name}</p>
                  </button>
                );
              })}
            </div>

            {/* Buscador */}
            <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--t-border)", background: glassBg2 }}>
              <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                Buscar producto
              </label>
              <input
                className="t-ring mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--t-border)",
                  background: "color-mix(in oklab, var(--t-bg-base) 70%, transparent)",
                  color: "var(--t-text)",
                }}
                placeholder="Ej: camiseta, bolso, perfume..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q ? (
                <button
                  type="button"
                  className="mt-2 text-xs underline opacity-80"
                  onClick={() => setQ("")}
                  style={{ color: "var(--t-muted)" }}
                >
                  Limpiar búsqueda
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-border)", background: glassBg2 }}>
            <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
              Buscar producto
            </label>
            <input
              className="t-ring mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--t-border)",
                background: "color-mix(in oklab, var(--t-bg-base) 70%, transparent)",
                color: "var(--t-text)",
              }}
              placeholder="Ej: camiseta, bolso, perfume..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}

        {/* Productos */}
        <div className="mt-7 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold">Productos</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              {products.length} productos mostrados
              {q ? ` · filtrados por “${q}”` : ""}
            </p>
          </div>

        </div>

        {products.length === 0 && !loadingMore ? (
          <div className="mt-5 rounded-[28px] border p-6" style={{ borderColor: "var(--t-border)", background: glassBg }}>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              No encontramos productos con esos filtros. Prueba otra búsqueda o categoría.
            </p>
            {q || selectedCat ? (
              <button
                type="button"
                className="t-btn mt-3 rounded-xl border px-3 py-2 text-sm font-semibold"
                style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                onClick={() => {
                  setQ("");
                  setSelectedCat(null);
                }}
              >
                Limpiar filtros
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => {
                const price = safeMode === "detal" ? p.price_retail : p.price_wholesale;

                const isUnlimited = p.stock === null;
                const stockNum = isUnlimited ? Infinity : Math.max(0, Math.floor(Number(p.stock || 0)));
                const isOut = !isUnlimited && stockNum <= 0;
                const productPageUrl = `/${store.slug}/producto/${p.id}`;
                const canViewProductLanding =
                  (safeMode === "detal" || store.catalog_retail) &&
                  hasProductLanding(p.product_details, { description: p.description, imageUrl: p.image_url });

                const stockInfo = stockMeta(p.stock);

                const stockPill =
                  stockInfo.tone === "danger"
                    ? {
                        border: "color-mix(in oklab, red 35%, var(--t-border))",
                        bg: "color-mix(in oklab, red 12%, var(--t-card-bg))",
                        color: "var(--t-text)",
                      }
                    : stockInfo.tone === "warn"
                    ? {
                        border: "color-mix(in oklab, orange 35%, var(--t-border))",
                        bg: "color-mix(in oklab, orange 12%, var(--t-card-bg))",
                        color: "var(--t-text)",
                      }
                    : {
                        border: "color-mix(in oklab, lime 30%, var(--t-border))",
                        bg: "color-mix(in oklab, lime 10%, var(--t-card-bg))",
                        color: "var(--t-text)",
                      };

                return (
                  <div
                    key={p.id}
                    id={`catalog-product-${p.id}`}
                    className="t-card rounded-[28px] border p-4"
                    style={{ borderColor: "var(--t-border)", background: glassBg }}
                  >
                    {p.image_url ? canViewProductLanding ? (
                      <Link
                        href={productPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-3 block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"
                        aria-label={`Ver más sobre ${p.name}`}
                      >
                        <img
                          src={p.image_url}
                          alt={p.name}
                          loading="lazy"
                          className="aspect-square w-full rounded-2xl border object-cover"
                          style={{ borderColor: "var(--t-border)" }}
                        />
                      </Link>
                    ) : (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        className="mb-3 aspect-square w-full rounded-2xl border object-cover"
                        style={{ borderColor: "var(--t-border)" }}
                      />
                    ) : (
                      <div className="mb-3 aspect-square w-full rounded-2xl border" style={{ borderColor: "var(--t-border)" }} />
                    )}

                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-extrabold leading-tight">{p.name}</h3>
                    </div>

                    {/* Inventario */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold"
                        style={{
                          borderColor: stockPill.border,
                          background: stockPill.bg,
                          color: stockPill.color,
                        }}
                        title="Inventario disponible"
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

                    <div className="mt-3 flex flex-wrap gap-2">
                      {canViewProductLanding ? (
                        <Link
                          href={productPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="t-btn rounded-2xl border px-4 py-2 text-sm font-bold"
                          style={{ borderColor: "var(--t-border)", background: glassBg2 }}
                        >
                          Ver más
                        </Link>
                      ) : null}
                      {safeMode === "detal" && canViewProductLanding ? (
                        <ShareProductButton
                          title={p.name}
                          text={buildProductShareText({
                            name: p.name,
                            price: p.price_retail,
                            description: p.description,
                            stock: p.stock,
                            imageUrl: p.image_url,
                            details: p.product_details,
                          })}
                        />
                      ) : null}
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                          Precio
                        </p>
                        <p className="text-lg font-black">{money(price)}</p>
                      </div>

                      <button
                        className="t-btn rounded-2xl px-4 py-2 text-sm font-extrabold"
                        style={{
                          background: "var(--t-cta)",
                          color: "var(--t-text)",
                          boxShadow: "0 18px 48px rgba(0,0,0,0.22)",
                        }}
                        onClick={() => addToCartWithQty(p, Number(price ?? 0))}
                        disabled={isOut}
                        title={isOut ? "Producto agotado" : "Agregar al carrito"}
                      >
                        {isOut ? "Agotado" : "Agregar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ✅ Cargar más */}
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
                  ✅ Ya no hay más productos.
                </p>
              )}
            </div>
          </>
        )}

        {/* Footer */}
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

      {dailyCampaign ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-md sm:p-5"
          onClick={() => setDailyCampaign(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-campaign-title"
            className="relative max-h-[min(92vh,48rem)] w-full max-w-2xl overflow-y-auto rounded-[2rem] border shadow-[0_30px_100px_rgba(0,0,0,0.45)]"
            style={{
              borderColor: "var(--t-border)",
              background: "linear-gradient(145deg, color-mix(in oklab, var(--t-accent) 12%, var(--t-card-bg)), var(--t-card-bg) 62%)",
              color: "var(--t-text)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative flex h-[min(35vh,16rem)] items-center justify-center overflow-hidden bg-black/10 p-3 sm:h-72 sm:p-5">
              <img
                src={dailyCampaign.cover_image_url}
                alt={`Portada de ${dailyCampaign.name}`}
                className="max-h-full max-w-full object-contain object-center"
              />
              <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/45 px-3.5 py-2 text-xs font-extrabold text-white shadow-lg backdrop-blur-md sm:left-6 sm:top-6">
                <Sparkles size={16} aria-hidden="true" />
                Una sorpresa para ti
              </div>
              <button
                type="button"
                onClick={() => setDailyCampaign(null)}
                aria-label="Cerrar anuncio de campaña"
                className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full border border-white/30 bg-black/45 text-white shadow-lg backdrop-blur-md transition hover:rotate-90 hover:bg-black/65 sm:right-5 sm:top-5"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>
            <div className="p-4 sm:p-8">
              <p className="inline-flex items-center gap-2 text-sm font-extrabold" style={{ color: "var(--t-accent)" }}>
                <Sparkles size={17} aria-hidden="true" />
                ¡Mira lo que preparamos para ti!
              </p>
              <h2 id="daily-campaign-title" className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
                {dailyCampaign.name}
              </h2>
              {dailyCampaign.description ? (
                <p className="mt-2 max-w-xl text-sm leading-6 sm:text-base" style={{ color: "var(--t-muted)" }}>
                  {dailyCampaign.description}
                </p>
              ) : <p className="mt-2 text-sm leading-6" style={{ color: "var(--t-muted)" }}>Descubre novedades y productos seleccionados especialmente para ti.</p>}
              <div className="mt-4 flex flex-col-reverse gap-3 sm:mt-6 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setDailyCampaign(null)}
                  className="rounded-2xl border px-5 py-3 text-sm font-bold transition hover:bg-black/5"
                  style={{ borderColor: "var(--t-border)" }}
                >
                  Quizá más tarde
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDailyCampaign(null);
                    openCampaign(dailyCampaign);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-extrabold text-white shadow-lg transition hover:-translate-y-0.5 hover:brightness-110"
                  style={{ background: "var(--t-cta)" }}
                >
                  Descubrir campaña
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* Toast */}
      {msg ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
          <div
            className="rounded-2xl border px-4 py-3 text-sm t-glass"
            style={{
              borderColor: "var(--t-border)",
              background: "var(--t-card-bg)",
              color: "var(--t-text)",
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