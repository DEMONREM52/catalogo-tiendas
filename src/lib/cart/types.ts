import type { StoreContactChannel } from "@/lib/store-contacts";

/** "detal" / "mayor" para los catálogos clásicos o el enlace (slug) de un catálogo creado en RemHub Social. */
export type CartMode = string;

export type CartCatalog = {
  slug: string;
  name: string;
  key: string | null;
  wholesaleRules: boolean;
};
export type CartItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  minWholesale?: number | null;
};

export type CartState = {
  storeId: string;
  storeSlug: string;
  storeName: string;
  whatsapp: string;
  contactChannels?: StoreContactChannel[];
  selectedContactId?: string;
  contactSelectionConfirmed?: boolean;
  mode: CartMode;
  /** Presente cuando el carrito pertenece a un catálogo de RemHub Social. */
  catalog?: CartCatalog | null;

  // ✅ nuevos campos
  customerName?: string;
  customerWhatsapp?: string;
  customerNote?: string;

  items: CartItem[];
};
