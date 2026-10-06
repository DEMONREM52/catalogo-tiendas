import type { StoreCatalog } from "@/lib/catalogs";

export type WarehouseOption = {
  id: string;
  name: string;
  kind: "point" | "warehouse";
  active: boolean;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
};

export type ThemeOption = { id: string; name: string; config: Record<string, unknown> | null };

export type BaseCategory = { id: string; name: string; image_url: string | null; sort_order: number; active: boolean };

export type CatalogCategoryRow = {
  id: string;
  category_id: string | null;
  name: string | null;
  image_url: string | null;
  sort_order: number;
  visible: boolean;
  isNew?: boolean;
};

export type CatalogProductEdit = {
  included?: boolean;
  price_override?: number | null;
  catalog_category_id?: string | null;
  featured?: boolean;
};

export type CatalogProductRow = {
  product_id: string;
  included: boolean;
  price_override: number | null;
  catalog_category_id: string | null;
  featured: boolean;
};

export type ProductLite = {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  category_id: string | null;
  stock: number | null;
  active: boolean;
  cost_price: number | null;
  price_1: number;
  price_2: number;
  price_3: number;
  price_4: number;
  price_5: number;
};

/** Producto tal como se ve en el catálogo (precio especial y unidades del punto incluidos). */
export type PreviewItem = {
  id: string;
  name: string;
  image_url: string | null;
  price_1: number;
  price_2: number;
  price_3: number;
  price_4: number;
  price_5: number;
  price_override: number | null;
  catalog_stock: number | null;
};

export const PRODUCT_LITE_COLUMNS ="id,name,sku,image_url,category_id,stock,active,cost_price,price_1,price_2,price_3,price_4,price_5";

export type CatalogDraft = StoreCatalog;
