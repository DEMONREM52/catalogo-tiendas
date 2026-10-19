import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThemeConfig } from "@/lib/themes/applyTheme";

/**
 * Tipos y datos del catálogo público que usan el servidor (primera carga ya armada) y el navegador.
 * Sin "use client": el servidor puede llamar estas funciones.
 */

/* =========================================================
   Types
========================================================= */
export type Mode = "detal" | "mayor";

export type StoreRow = {
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

export type ProductRow = {
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

export type CategoryRow = {
  id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
};

export type StoreProfile = {
  headline?: string | null;
  address?: string | null;
  city?: string | null;
  contact_channels?: unknown;
  locations?: unknown;
};

export type StoreLocation = {
  id: string;
  name: string;
  address: string;
  city: string;
  map_url: string;
  photo_url: string;
  description: string;
  active: boolean;
};

export type CatalogCampaign = {
  id: string;
  name: string;
  description: string;
  cover_image_url: string;
  category_id: string | null;
  products: ProductRow[];
};

export type CampaignSlide = {
  campaign: CatalogCampaign;
  kind: "cover" | "product";
  products: ProductRow[];
};

export type StoreLinkRow = {
  id: string;
  type: string;
  label: string | null;
  url: string;
  icon_url: string | null;
};

/** Catálogo creado en RemHub Social (respuesta de catalog_public). */
export type PublicCatalog = {
  id: string;
  slug: string;
  name: string;
  headline: string | null;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  theme: string | null;
  price_level: number;
  wholesale_rules: boolean;
  show_stock: boolean;
  has_key: boolean;
  whatsapp: string;
  contact_channels: unknown;
  locations: unknown;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  footer_note: string | null;
  point: { name: string; address: string | null; city: string | null; phone: string | null } | null;
};

export type CatalogPayload =
  | {
      status: "ok";
      store: { id: string; name: string; slug: string; whatsapp: string; logo_url: string | null; banner_url: string | null; theme: string | null };
      catalog: PublicCatalog;
      links: StoreLinkRow[];
      categories: CategoryRow[];
      campaigns: CatalogCampaign[];
      other_catalogs: Array<{ slug: string; name: string; logo_url: string | null }>;
    }
  | { status: "locked" | "inactive"; store_slug: string; store_name: string; name: string; logo_url: string | null; whatsapp?: string }
  | { status: "not_found" | "store_not_found"; store_slug?: string };

export type CatalogLock = { status: "locked" | "inactive"; storeName: string; name: string; logoUrl: string | null; whatsapp: string | null };

/* =========================================================
   Helpers
========================================================= */
export const PAGE_SIZE = 30;

/** Primera carga del catálogo hecha en el servidor (la página llega ya armada). */
export type CatalogInitial = {
  slug: string;
  mode: string;
  key: string | null;
  payload: Extract<CatalogPayload, { status: "ok" }>;
  theme: ThemeConfig | null;
  products: { total: number; items: ProductRow[] } | null;
};

/** Números de los productos tal como los usa la página. */
export function normalizeCatalogProduct(p: ProductRow): ProductRow {
  return {
    ...p,
    price_retail: Number(p.price_retail ?? 0),
    price_wholesale: Number(p.price_wholesale ?? 0),
    min_wholesale: p.min_wholesale == null ? null : Number(p.min_wholesale),
    stock: p.stock === null || p.stock === undefined ? null : Number(p.stock),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
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

export async function loadThemeConfig(sb: SupabaseClient, themeId: string | null) {
  // Las dos consultas a la vez (antes una esperaba a la otra): el catálogo aparece antes.
  const [own, fallback] = await Promise.all([
    themeId ? sb.from("themes").select("id,active,config").eq("id", themeId).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("themes").select("id,config").eq("active", true).order("sort_order", { ascending: true }).limit(1).maybeSingle(),
  ]);
  return mapDbThemeToApplyTheme(own.data?.config) ?? mapDbThemeToApplyTheme(fallback.data?.config);
}

export function mapDbThemeToApplyTheme(dbCfg: any): ThemeConfig | undefined {
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

  const colorMode = pickStr(dbCfg.colorMode ?? dbCfg.color_mode);
  if (colorMode === "light" || colorMode === "dark" || colorMode === "auto") cfg.colorMode = colorMode;
  for (const key of ["lightBg", "lightBg2", "lightText", "lightMuted", "lightBorder", "lightCardBg", "lightAccent", "lightAccent2", "lightCta"] as const) {
    const value = pickStr(dbCfg[key]);
    if (value) cfg[key] = value;
  }
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
    cfg.ctaFromAccent = true;
    cfg.ctaMode = "solid";
    cfg.ctaSolid = accent2 ?? accent!;
  }

  return cfg;
}
