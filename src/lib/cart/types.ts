export type CartMode = "detal" | "mayor";

export type CartItem = {
  productId: string;
  name: string;
  price: number;        // precio según modo
  qty: number;
  minWholesale?: number | null; // mínimo si mayor
};

export type CartState = {
  storeId: string;
  storeSlug: string;
  storeName: string;
  whatsapp: string;
  mode: CartMode;
  items: CartItem[];
};
