// Catálogos de la tienda (ver supabase/migrations/20261014_catalogs_reports.sql).

export type PriceLevel = 1 | 2 | 3 | 4 | 5;

export type CatalogLink = { id: string; type: string; label: string | null; url: string; icon_url?: string | null };

export type CatalogLocation = {
  id: string;
  name: string;
  address: string;
  city: string;
  map_url: string;
  photo_url: string;
  description: string;
  active: boolean;
};

export type StoreCatalog = {
  id: string;
  store_id: string;
  slug: string;
  name: string;
  headline: string | null;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  theme: string | null;
  price_level: PriceLevel;
  fallback_price_level: PriceLevel | null;
  wholesale_rules: boolean;
  access_key: string | null;
  point_id: string | null;
  include_all_products: boolean;
  show_stock: boolean;
  whatsapp: string | null;
  contact_channels: unknown[];
  locations: CatalogLocation[];
  links: CatalogLink[];
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  footer_note: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const CATALOG_COLUMNS =
  "id,store_id,slug,name,headline,description,logo_url,banner_url,theme,price_level,fallback_price_level,wholesale_rules,access_key,point_id,include_all_products,show_stock,whatsapp,contact_channels,locations,links,address,city,phone,email,footer_note,active,sort_order,created_at,updated_at";

export const PRICE_LEVELS: Array<{ level: PriceLevel; label: string; hint: string }> = [
  { level: 1, label: "Precio 1", hint: "Mínimo" },
  { level: 2, label: "Precio 2", hint: "Mayor" },
  { level: 3, label: "Precio 3", hint: "Detal" },
  { level: 4, label: "Precio 4", hint: "Lista 4" },
  { level: 5, label: "Precio 5", hint: "Lista 5" },
];

export const RESERVED_CATALOG_SLUGS = ["producto", "pedido", "acceso", "dashboard", "admin", "api", "login", "traslado", "comprobante"];

export function catalogSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function isValidCatalogSlug(slug: string) {
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(slug) && !RESERVED_CATALOG_SLUGS.includes(slug);
}

/** Enlace público del catálogo; los privados incluyen su clave. */
export function catalogPath(storeSlug: string, catalog: Pick<StoreCatalog, "slug" | "access_key">) {
  const base = `/${encodeURIComponent(storeSlug)}/${catalog.slug}`;
  return catalog.access_key ? `${base}?key=${encodeURIComponent(catalog.access_key)}` : base;
}

type PricedProduct = { price_1?: number | null; price_2?: number | null; price_3?: number | null; price_4?: number | null; price_5?: number | null };

export function productPriceForLevel(product: PricedProduct, level: number) {
  const key = `price_${level}` as keyof PricedProduct;
  return Number(product[key] ?? 0);
}

/** Mismo cálculo que catalog__items en Supabase: precio especial → nivel → nivel de respaldo. */
export function catalogPrice(
  product: PricedProduct,
  catalog: Pick<StoreCatalog, "price_level" | "fallback_price_level">,
  override?: number | null,
) {
  if (override !== null && override !== undefined) return Number(override);
  const main = productPriceForLevel(product, catalog.price_level);
  if (main > 0) return main;
  return catalog.fallback_price_level ? productPriceForLevel(product, catalog.fallback_price_level) : main;
}

export function generateCatalogKey() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function newLocalId(prefix = "id") {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Plantillas para crear catálogos en un clic. */
export const CATALOG_TEMPLATES: Array<{
  key: string;
  icon: string;
  name: string;
  slug: string;
  description: string;
  price_level: PriceLevel;
  wholesale_rules: boolean;
  private: boolean;
}> = [
  { key: "detal", icon: "🛍️", name: "Detal", slug: "detal", description: "Para tus clientes finales.", price_level: 3, wholesale_rules: false, private: false },
  { key: "mayor", icon: "📦", name: "Por mayor", slug: "mayor", description: "Privado, con mínimos por producto.", price_level: 2, wholesale_rules: true, private: true },
  { key: "sede", icon: "📍", name: "Sede", slug: "sede", description: "Muestra solo el inventario de un punto.", price_level: 3, wholesale_rules: false, private: false },
  { key: "especial", icon: "⭐", name: "Lista especial", slug: "especial", description: "Para una lista de precios distinta.", price_level: 4, wholesale_rules: false, private: false },
];
