export type CartMode = "detal" | "mayor";

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
  mode: CartMode;

  // ✅ nuevos campos
  customerName?: string;
  customerNote?: string;

  items: CartItem[];
};
