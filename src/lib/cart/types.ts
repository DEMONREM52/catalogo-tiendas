import type { StoreContactChannel } from "@/lib/store-contacts";

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
  contactChannels?: StoreContactChannel[];
  selectedContactId?: string;
  contactSelectionConfirmed?: boolean;
  mode: CartMode;

  // ✅ nuevos campos
  customerName?: string;
  customerWhatsapp?: string;
  customerNote?: string;

  items: CartItem[];
};
