/**
 * Medición del catálogo: un solo lugar para enviar eventos a
 *  - Google Tag Manager (dataLayer, formato de comercio electrónico de GA4)
 *  - Píxel de Meta de la tienda (si la tienda lo configuró en Mi tienda → Marketing)
 *
 * Todo es "a prueba de fallos": si un bloqueador quita los scripts, nada se rompe.
 */

export const GTM_ID = "GTM-TGC9KVT3";
export const CURRENCY = "COP";

export type TrackItem = { id: string; name: string; price: number; quantity?: number; category?: string | null };

export type StorePixelConfig = {
  meta_pixel_id: string;
  order_event: "Purchase" | "Lead" | "none";
  events: { view_content: boolean; add_to_cart: boolean; checkout: boolean; search: boolean; contact: boolean };
};

type Fbq = (...args: unknown[]) => void;
type TrackWindow = Window & {
  dataLayer?: unknown[];
  fbq?: Fbq;
  __remhubPixel?: StorePixelConfig | null;
};

function w(): TrackWindow | null {
  return typeof window === "undefined" ? null : (window as TrackWindow);
}

/** Lo llama el componente del píxel de la tienda para que los eventos sepan a dónde ir. */
export function setStorePixel(config: StorePixelConfig | null) {
  const win = w();
  if (win) win.__remhubPixel = config;
}

function pushEcommerce(event: string, ecommerce: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const win = w();
  if (!win) return;
  try {
    win.dataLayer = win.dataLayer || [];
    win.dataLayer.push({ ecommerce: null });
    win.dataLayer.push({ event, ecommerce, ...extra });
  } catch {
    /* sin GTM */
  }
}

function meta(event: string, params: Record<string, unknown>, gate: keyof StorePixelConfig["events"] | null, eventId?: string) {
  const win = w();
  const cfg = win?.__remhubPixel;
  if (!win || !cfg?.meta_pixel_id || typeof win.fbq !== "function") return;
  if (gate && cfg.events?.[gate] === false) return;
  try {
    // trackSingle: el evento va solo al píxel de esta tienda, nunca al de otra.
    win.fbq("trackSingle", cfg.meta_pixel_id, event, params, eventId ? { eventID: eventId } : undefined);
  } catch {
    /* sin píxel */
  }
}

const gaItem = (item: TrackItem) => ({
  item_id: item.id,
  item_name: item.name,
  price: Number(item.price) || 0,
  quantity: item.quantity ?? 1,
  ...(item.category ? { item_category: item.category } : {}),
});

const value = (items: TrackItem[]) => items.reduce((sum, i) => sum + (Number(i.price) || 0) * (i.quantity ?? 1), 0);

export const track = {
  viewItem(item: TrackItem, store?: string) {
    pushEcommerce("view_item", { currency: CURRENCY, value: Number(item.price) || 0, items: [gaItem(item)] }, { store });
    meta("ViewContent", {
      content_ids: [item.id], content_name: item.name, content_type: "product",
      value: Number(item.price) || 0, currency: CURRENCY,
    }, "view_content");
  },

  addToCart(item: TrackItem, store?: string) {
    pushEcommerce("add_to_cart", { currency: CURRENCY, value: value([item]), items: [gaItem(item)] }, { store });
    meta("AddToCart", {
      content_ids: [item.id], content_name: item.name, content_type: "product",
      contents: [{ id: item.id, quantity: item.quantity ?? 1 }], value: value([item]), currency: CURRENCY,
    }, "add_to_cart");
  },

  search(term: string, store?: string, results?: number) {
    const clean = term.trim();
    if (clean.length < 2) return;
    w()?.dataLayer?.push({ event: "search", search_term: clean, store, results });
    meta("Search", { search_string: clean }, "search");
  },

  beginCheckout(items: TrackItem[], store?: string) {
    pushEcommerce("begin_checkout", { currency: CURRENCY, value: value(items), items: items.map(gaItem) }, { store });
    meta("InitiateCheckout", {
      content_ids: items.map((i) => i.id), content_type: "product",
      contents: items.map((i) => ({ id: i.id, quantity: i.quantity ?? 1 })),
      num_items: items.reduce((s, i) => s + (i.quantity ?? 1), 0), value: value(items), currency: CURRENCY,
    }, "checkout");
  },

  /** Pedido enviado: en GA4 es "purchase"; en Meta, Purchase o Lead según la tienda. */
  order(orderId: string, items: TrackItem[], store?: string) {
    pushEcommerce("purchase", { transaction_id: orderId, currency: CURRENCY, value: value(items), items: items.map(gaItem) }, { store });
    const cfg = w()?.__remhubPixel;
    const event = cfg?.order_event ?? "Purchase";
    if (event === "none") return;
    meta(event, {
      content_ids: items.map((i) => i.id), content_type: "product",
      contents: items.map((i) => ({ id: i.id, quantity: i.quantity ?? 1 })),
      num_items: items.reduce((s, i) => s + (i.quantity ?? 1), 0), value: value(items), currency: CURRENCY,
    }, null, orderId);
  },

  contact(channel: string, store?: string) {
    w()?.dataLayer?.push({ event: "contact", method: channel, store });
    meta("Contact", { content_name: channel }, "contact");
  },
};
