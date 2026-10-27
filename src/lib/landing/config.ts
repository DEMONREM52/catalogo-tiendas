// Landing pages de producto (RemHub Social → Landing pages).
// Una página que muestra UN producto (con sus opciones: color, talla…) y empuja a comprar.
// Regla de oro: todo lo que presiona la compra es REAL (personas viendo, unidades, pedidos
// recientes, fecha de fin de la promo, precio «antes»). Nada inventado: lo exige la Ley 1480
// (publicidad engañosa) y Meta frena anuncios que llevan a páginas con datos falsos.

export type LandingBundle = { qty: number; pct: number; label: string; highlight: boolean };
export type LandingBenefit = { icon: string; title: string; text: string };
export type LandingStory = { title: string; text: string; image: string };
export type LandingTestimonial = { name: string; city: string; text: string; stars: number; image: string };
export type LandingFaq = { q: string; a: string };

export const SECTION_KEYS = ["hero", "poster", "benefits", "video", "stories", "details", "compare", "testimonials", "trust", "final_cta", "guarantees", "faq"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_NAMES: Record<SectionKey, string> = {
  hero: "Principal (fotos, precio y botón)", poster: "Afiche (imágenes largas con botón)", benefits: "Beneficios", video: "Video",
  stories: "Bloques de historia", details: "Detalles del producto", compare: "Comparación", testimonials: "Opiniones",
  trust: "Compra con confianza", final_cta: "Llamado final", guarantees: "Franja de garantías", faq: "Preguntas frecuentes",
};
export const LANDING_FONTS = { moderna: "Moderna", elegante: "Elegante", fuerte: "Fuerte", amable: "Amable" } as const;
export type LandingFont = keyof typeof LANDING_FONTS;

export type ViewersWindow = "now" | "15m" | "1h" | "today" | "week" | "month";
export type SoldWindow = "today" | "week" | "month" | "all";
export const VIEWERS_WINDOWS: Record<ViewersWindow, { label: string; text: string }> = {
  now: { label: "Ahora mismo", text: "personas viendo esto ahora" },
  "15m": { label: "Últimos 15 minutos", text: "personas vieron esto en los últimos 15 minutos" },
  "1h": { label: "Última hora", text: "personas vieron esto en la última hora" },
  today: { label: "Hoy", text: "personas vieron esta oferta hoy" },
  week: { label: "Últimos 7 días", text: "personas vieron esta oferta esta semana" },
  month: { label: "Últimos 30 días", text: "personas vieron esta oferta este mes" },
};
export const SOLD_WINDOWS: Record<SoldWindow, { label: string; text: string }> = {
  today: { label: "Hoy", text: "vendidos hoy" },
  week: { label: "Últimos 7 días", text: "vendidos esta semana" },
  month: { label: "Últimos 30 días", text: "vendidos este mes" },
  all: { label: "Desde siempre", text: "vendidos" },
};

export const CTA_STYLES = { boom: "¡Crece!", pulse: "Late", bounce: "Salta", shake: "Se sacude", glow: "Brilla", shine: "Destello", none: "Quieto" } as const;
export type CtaStyle = keyof typeof CTA_STYLES;
export const CTA_BACKGROUNDS = { light: "Claro", soft: "Color suave", accent: "Color fuerte", dark: "Oscuro" } as const;
export type CtaBackground = keyof typeof CTA_BACKGROUNDS;
export type CtaBlockConfig = {
  title: string; text: string; button: string;
  style: CtaStyle; background: CtaBackground;
  /** «end» = solo donde está en el orden; «every» = cada N secciones; «after» = después de las secciones elegidas. */
  repeat: "end" | "every" | "after"; every: number; after: SectionKey[];
  arrow: boolean; urgency: boolean; badge: string;
};

export type LandingConfig = {
  headline: string;
  subheadline: string;
  badge: string;
  accent: string;
  /** Precio real anterior. Si no lo hubo, se deja vacío y no se muestra «Antes». */
  compare_at_price: number | null;
  /** Precio de venta de esta landing (todas las opciones). Vacío = el del catálogo. Puede ser más alto o más bajo. */
  sale_price: number | null;
  /** Precio por opción (manda sobre sale_price). */
  option_prices: Record<string, number>;
  /** Fecha y hora real en que termina la promoción (ISO). Sin fecha, no hay cuenta regresiva. */
  promo_ends_at: string | null;
  promo_text: string;
  images: string[];
  video_url: string;
  option_label: string;
  option_names: Record<string, string>;
  benefits: LandingBenefit[];
  stories: LandingStory[];
  testimonials: LandingTestimonial[];
  faqs: LandingFaq[];
  guarantees: string[];
  bundles: LandingBundle[];
  shipping: { free: boolean; text: string; days_min: number; days_max: number; cutoff_hour: number };
  /** bold: pagar ya con Bold (cuenta del punto o bold_account), con su propio descuento bold_pct. */
  payments: { cod: boolean; online: boolean; online_pct: number; addi: boolean; bold: boolean; bold_pct: number; bold_account: string | null; bold_badge: string };
  form: { ask_document: boolean; ask_email: boolean; ask_neighborhood: boolean; confirm_address: boolean };
  urgency: {
    live_viewers: boolean; recent_orders: boolean; stock: boolean; low_stock_at: number; sold_week: boolean; countdown: boolean;
    /** Periodo que cuenta el 👁️ (siempre visitas reales): ahora, 15 min, última hora u hoy. */
    viewers_window: ViewersWindow; viewers_min: number;
    sold_window: SoldWindow; recent_hours: number; recent_every: number;
    /** «date» = la fecha de fin de la promo; «midnight» = oferta del día (termina hoy a medianoche). */
    countdown_mode: "date" | "midnight";
  };
  upsell: { enabled: boolean; product_id: string; pct: number; title: string; text: string; seconds: number };
  cta_text: string;
  whatsapp_button: boolean;
  whatsapp_text: string;
  policies: string;
  thank_you: string;
  /** Píxeles propios de esta landing (además del píxel de la tienda). */
  meta_pixel_id: string;
  tiktok_pixel_id: string;
  template: string;
  /** Si intenta irse (mouse hacia arriba en computador, o tras un rato sin comprar en celular): descuento extra real. */
  exit_offer: { enabled: boolean; pct: number; title: string; text: string };
  size_guide_image: string;
  compare_rows: Array<{ label: string; us: string; them: string }>;
  share_button: boolean;
  /** «Compra con confianza»: datos reales de la tienda (empresa, NIT, tiendas físicas, pedidos entregados, redes). */
  trust: { enabled: boolean; business: boolean; points: boolean; orders: boolean; links: boolean };
  /** WhatsApp propio de esta landing (botón flotante, confirmación del pedido). Vacío = el de la tienda. */
  whatsapp_number: string;
  /** Animaciones de toda la página: «show» espectáculo, «soft» suaves, «off» sin animación. */
  effects: "show" | "soft" | "off";
  /** Bloque «¿Listo para pedir el tuyo?»: textos, animación, fondo y si se repite entre secciones. */
  cta_block: CtaBlockConfig;
  /** Orden y visibilidad de las secciones. */
  sections: Array<{ key: SectionKey; on: boolean }>;
  /** Afiche: imágenes largas (ej. hechas en Canva) una tras otra, con botón cada N imágenes. */
  poster_images: string[];
  poster_cta_every: number;
  poster_title: string;
  font: LandingFont;
  topbar_text: string;
  sticky_text: string;
};

export const DEFAULT_LANDING: LandingConfig = {
  headline: "",
  subheadline: "",
  badge: "OFERTA",
  accent: "#e11d48",
  compare_at_price: null,
  sale_price: null,
  option_prices: {},
  promo_ends_at: null,
  promo_text: "¡Aprovecha la promo y llévalo a un precio increíble!",
  images: [],
  video_url: "",
  option_label: "Color",
  option_names: {},
  benefits: [
    { icon: "🚚", title: "Envío a toda Colombia", text: "Te lo llevamos a la puerta de tu casa." },
    { icon: "💵", title: "Paga al recibir", text: "No pagas nada por adelantado." },
    { icon: "🔁", title: "Cambios fáciles", text: "Si no te queda, lo cambiamos." },
  ],
  stories: [],
  testimonials: [],
  faqs: [
    { q: "¿Cuánto se demora en llegar?", a: "Entre 2 y 5 días hábiles según tu ciudad. Te enviamos la guía por WhatsApp." },
    { q: "¿Cómo pago?", a: "Puedes pagar en efectivo cuando lo recibas, o en línea con tarjeta, PSE o Nequi." },
    { q: "¿Y si no me queda?", a: "Escríbenos por WhatsApp y te ayudamos con el cambio." },
  ],
  guarantees: ["Satisfacción garantizada", "Pago seguro", "Envío a toda Colombia"],
  bundles: [
    { qty: 1, pct: 0, label: "Lleva 1", highlight: false },
    { qty: 2, pct: 8, label: "Lleva 2", highlight: true },
    { qty: 3, pct: 15, label: "Lleva 3", highlight: false },
  ],
  shipping: { free: true, text: "Envío gratis a toda Colombia", days_min: 2, days_max: 5, cutoff_hour: 15 },
  payments: { cod: true, online: false, online_pct: 5, addi: false, bold: false, bold_pct: 5, bold_account: null, bold_badge: "" },
  form: { ask_document: true, ask_email: false, ask_neighborhood: true, confirm_address: true },
  urgency: { live_viewers: true, recent_orders: true, stock: true, low_stock_at: 20, sold_week: true, countdown: true, viewers_window: "now", viewers_min: 2, sold_window: "week", recent_hours: 72, recent_every: 16, countdown_mode: "date" },
  upsell: { enabled: false, product_id: "", pct: 20, title: "¡Espera! Agrégalo a tu pedido", text: "Solo por ahora, con descuento y en el mismo envío.", seconds: 60 },
  cta_text: "¡Comprar ahora y paga al recibir!",
  whatsapp_button: true,
  whatsapp_text: "Hola, quiero información de",
  policies: "",
  thank_you: "¡Gracias por tu compra! Te escribiremos por WhatsApp para confirmar tu pedido y enviarte la guía.",
  meta_pixel_id: "",
  tiktok_pixel_id: "",
  template: "moda",
  exit_offer: { enabled: false, pct: 5, title: "¡Espera! No te vayas con las manos vacías", text: "Llévalo hoy con un descuento adicional, solo en esta visita." },
  size_guide_image: "",
  compare_rows: [],
  share_button: true,
  trust: { enabled: true, business: true, points: true, orders: true, links: true },
  whatsapp_number: "",
  effects: "show",
  cta_block: {
    title: "¿Listo para pedir el tuyo?", text: "", button: "", style: "boom", background: "soft",
    repeat: "end", every: 2, after: [], arrow: true, urgency: true, badge: "🔥 OFERTA POR TIEMPO LIMITADO",
  },
  sections: SECTION_KEYS.map((key) => ({ key, on: true })),
  poster_images: [],
  poster_cta_every: 2,
  poster_title: "",
  font: "moderna",
  topbar_text: "",
  sticky_text: "Comprar",
};

const str = (v: unknown, max = 500, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const arr = <T>(v: unknown, max: number, map: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.slice(0, max).map((x) => (x && typeof x === "object" ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null) : [];
const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Completa y limpia la configuración (lo que venga de la base o del editor). */
export function normalizeLanding(raw: unknown): LandingConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LANDING;
  const obj = (k: string) => ((r[k] && typeof r[k] === "object" ? r[k] : {}) as Record<string, unknown>);
  const sh = obj("shipping"), pay = obj("payments"), form = obj("form"), urg = obj("urgency"), up = obj("upsell");
  const compare = Number(r.compare_at_price);
  const ends = typeof r.promo_ends_at === "string" && !Number.isNaN(Date.parse(r.promo_ends_at)) ? r.promo_ends_at : null;
  const bundles = arr(r.bundles, 4, (b) => {
    const qty = Math.round(num(b.qty, 1, 10, 0));
    return qty ? { qty, pct: num(b.pct, 0, 90, 0), label: str(b.label, 40) || `Lleva ${qty}`, highlight: bool(b.highlight, false) } : null;
  });
  const uniq = bundles.filter((b, i) => bundles.findIndex((x) => x.qty === b.qty) === i).sort((a, b) => a.qty - b.qty);
  const names: Record<string, string> = {};
  if (r.option_names && typeof r.option_names === "object") {
    for (const [k, v] of Object.entries(r.option_names as Record<string, unknown>)) if (UUID.test(k) && typeof v === "string" && v.trim()) names[k] = v.slice(0, 40);
  }
  return {
    headline: str(r.headline, 140),
    subheadline: str(r.subheadline, 300),
    badge: str(r.badge, 24, d.badge),
    accent: typeof r.accent === "string" && HEX.test(r.accent) ? r.accent : d.accent,
    compare_at_price: Number.isFinite(compare) && compare > 0 ? Math.round(compare) : null,
    sale_price: Number(r.sale_price) > 0 ? Math.round(Number(r.sale_price)) : null,
    option_prices: (() => {
      const out: Record<string, number> = {};
      if (r.option_prices && typeof r.option_prices === "object") {
        for (const [k, v] of Object.entries(r.option_prices as Record<string, unknown>)) if (UUID.test(k) && Number(v) > 0) out[k] = Math.round(Number(v));
      }
      return out;
    })(),
    promo_ends_at: ends,
    promo_text: str(r.promo_text, 140, d.promo_text),
    images: Array.isArray(r.images) ? r.images.filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x)).slice(0, 20) : [],
    video_url: typeof r.video_url === "string" && /^https:\/\//.test(r.video_url) ? r.video_url.slice(0, 500) : "",
    option_label: str(r.option_label, 30, d.option_label) || d.option_label,
    option_names: names,
    benefits: arr(r.benefits, 8, (b) => (str(b.title, 60) ? { icon: str(b.icon, 8) || "✨", title: str(b.title, 60), text: str(b.text, 200) } : null)),
    stories: arr(r.stories, 8, (s) => (str(s.title, 120) || str(s.text, 1500) ? { title: str(s.title, 120), text: str(s.text, 1500), image: /^https:\/\//.test(str(s.image)) ? str(s.image) : "" } : null)),
    testimonials: arr(r.testimonials, 12, (t) => (str(t.text, 500) ? { name: str(t.name, 60), city: str(t.city, 60), text: str(t.text, 500), stars: Math.round(num(t.stars, 1, 5, 5)), image: /^https:\/\//.test(str(t.image)) ? str(t.image) : "" } : null)),
    faqs: arr(r.faqs, 15, (f) => (str(f.q, 200) ? { q: str(f.q, 200), a: str(f.a, 1000) } : null)),
    guarantees: Array.isArray(r.guarantees) ? r.guarantees.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.slice(0, 60)).slice(0, 6) : d.guarantees,
    bundles: uniq.length ? uniq : d.bundles,
    shipping: { free: bool(sh.free, d.shipping.free), text: str(sh.text, 140, d.shipping.text), days_min: Math.round(num(sh.days_min, 0, 30, d.shipping.days_min)), days_max: Math.round(num(sh.days_max, 0, 60, d.shipping.days_max)), cutoff_hour: Math.round(num(sh.cutoff_hour, 0, 23, d.shipping.cutoff_hour)) },
    payments: { cod: bool(pay.cod, d.payments.cod), online: bool(pay.online, d.payments.online), online_pct: num(pay.online_pct, 0, 30, d.payments.online_pct), addi: bool(pay.addi, d.payments.addi),
      bold: bool(pay.bold, d.payments.bold), bold_pct: num(pay.bold_pct, 0, 30, d.payments.bold_pct),
      bold_account: typeof pay.bold_account === "string" && /^[0-9a-f-]{36}$/i.test(pay.bold_account) ? pay.bold_account : null,
      bold_badge: typeof pay.bold_badge === "string" ? pay.bold_badge.slice(0, 60) : "" },
    form: { ask_document: bool(form.ask_document, d.form.ask_document), ask_email: bool(form.ask_email, d.form.ask_email), ask_neighborhood: bool(form.ask_neighborhood, d.form.ask_neighborhood), confirm_address: bool(form.confirm_address, d.form.confirm_address) },
    urgency: {
      live_viewers: bool(urg.live_viewers, true), recent_orders: bool(urg.recent_orders, true), stock: bool(urg.stock, true), low_stock_at: Math.round(num(urg.low_stock_at, 0, 1000, 20)), sold_week: bool(urg.sold_week, true), countdown: bool(urg.countdown, true),
      viewers_window: typeof urg.viewers_window === "string" && urg.viewers_window in VIEWERS_WINDOWS ? (urg.viewers_window as ViewersWindow) : "now",
      viewers_min: Math.round(num(urg.viewers_min, 1, 10000, 2)),
      sold_window: typeof urg.sold_window === "string" && urg.sold_window in SOLD_WINDOWS ? (urg.sold_window as SoldWindow) : "week",
      recent_hours: [24, 72, 168, 720].includes(Number(urg.recent_hours)) ? Number(urg.recent_hours) : 72,
      recent_every: Math.round(num(urg.recent_every, 8, 120, 16)),
      countdown_mode: urg.countdown_mode === "midnight" ? "midnight" : "date",
    },
    upsell: { enabled: bool(up.enabled, false) && UUID.test(str(up.product_id)), product_id: UUID.test(str(up.product_id)) ? str(up.product_id) : "", pct: num(up.pct, 0, 90, 20), title: str(up.title, 80, d.upsell.title), text: str(up.text, 240, d.upsell.text), seconds: Math.round(num(up.seconds, 0, 180, 60)) },
    cta_text: str(r.cta_text, 60, d.cta_text) || d.cta_text,
    whatsapp_button: bool(r.whatsapp_button, true),
    whatsapp_text: str(r.whatsapp_text, 200, d.whatsapp_text),
    policies: str(r.policies, 8000),
    thank_you: str(r.thank_you, 500, d.thank_you) || d.thank_you,
    meta_pixel_id: typeof r.meta_pixel_id === "string" && /^\d{6,20}$/.test(r.meta_pixel_id.trim()) ? r.meta_pixel_id.trim() : "",
    tiktok_pixel_id: typeof r.tiktok_pixel_id === "string" && /^[A-Z0-9]{10,30}$/i.test(r.tiktok_pixel_id.trim()) ? r.tiktok_pixel_id.trim() : "",
    template: str(r.template, 30, d.template),
    exit_offer: (() => { const x = obj("exit_offer"); return { enabled: bool(x.enabled, false), pct: num(x.pct, 1, 30, d.exit_offer.pct), title: str(x.title, 80, d.exit_offer.title) || d.exit_offer.title, text: str(x.text, 200, d.exit_offer.text) }; })(),
    size_guide_image: /^https:\/\//.test(str(r.size_guide_image)) ? str(r.size_guide_image) : "",
    compare_rows: arr(r.compare_rows, 8, (x) => (str(x.label, 60) ? { label: str(x.label, 60), us: str(x.us, 60), them: str(x.them, 60) } : null)),
    share_button: bool(r.share_button, true),
    whatsapp_number: (() => { const d2 = String(r.whatsapp_number ?? "").replace(/\D/g, ""); return /^\d{10,13}$/.test(d2) ? d2 : ""; })(),
    effects: r.effects === "soft" || r.effects === "off" ? r.effects : "show",
    cta_block: (() => {
      const x = obj("cta_block"), dc = d.cta_block;
      return {
        title: str(x.title, 120, dc.title),
        text: str(x.text, 300),
        button: str(x.button, 60),
        style: typeof x.style === "string" && x.style in CTA_STYLES ? (x.style as CtaStyle) : dc.style,
        background: typeof x.background === "string" && x.background in CTA_BACKGROUNDS ? (x.background as CtaBackground) : dc.background,
        repeat: x.repeat === "every" || x.repeat === "after" ? x.repeat : "end",
        every: Math.round(num(x.every, 1, 6, dc.every)),
        after: Array.isArray(x.after) ? [...new Set(x.after.filter((k): k is SectionKey => SECTION_KEYS.includes(k as SectionKey) && k !== "final_cta"))] : [],
        arrow: bool(x.arrow, dc.arrow),
        urgency: bool(x.urgency, dc.urgency),
        badge: str(x.badge, 60, dc.badge),
      };
    })(),
    sections: (() => {
      const seen = new Set<string>();
      const list = arr(r.sections, 20, (x) => (SECTION_KEYS.includes(x.key as SectionKey) && !seen.has(String(x.key)) && seen.add(String(x.key)) ? { key: x.key as SectionKey, on: bool(x.on, true) } : null));
      return [...list, ...SECTION_KEYS.filter((k) => !seen.has(k)).map((key) => ({ key, on: true }))];
    })(),
    poster_images: Array.isArray(r.poster_images) ? r.poster_images.filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x)).slice(0, 30) : [],
    poster_cta_every: Math.round(num(r.poster_cta_every, 0, 10, d.poster_cta_every)),
    poster_title: str(r.poster_title, 140),
    font: typeof r.font === "string" && r.font in LANDING_FONTS ? (r.font as LandingFont) : d.font,
    topbar_text: str(r.topbar_text, 120),
    sticky_text: str(r.sticky_text, 30, d.sticky_text) || d.sticky_text,
    trust: (() => { const x = obj("trust"); return { enabled: bool(x.enabled, true), business: bool(x.business, true), points: bool(x.points, true), orders: bool(x.orders, true), links: bool(x.links, true) }; })(),
  };
}

/** Precio con descuento, redondeado a $100 (igual que en la base). */
export function discounted(price: number, ...pcts: number[]) {
  let v = Number(price) || 0;
  // Sin descuento, el precio queda igual (no se redondea).
  if (pcts.every((p) => !(Number(p) > 0))) return Math.round(v);
  for (const p of pcts) v *= 1 - (Number(p) || 0) / 100;
  return v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v);
}

export type LandingPayment = "cod" | "online" | "addi" | "bold";

/** Descuento por pagar en línea según la forma de pago (Wompi o Bold tienen el suyo). */
export const payPct = (p: LandingConfig["payments"], pay: LandingPayment) => (pay === "online" ? p.online_pct : pay === "bold" ? p.bold_pct : 0);

/** Totales del pedido según el paquete, el pago y el adicional. */
export function landingTotals(input: { price: number; bundle: LandingBundle; payment: LandingPayment; onlinePct: number; upsell?: { price: number; pct: number } | null }) {
  const online = input.payment === "online" || input.payment === "bold" ? input.onlinePct : 0;
  const unit = discounted(input.price, input.bundle.pct, online);
  const full = (Number(input.price) || 0) * input.bundle.qty;
  const upsellUnit = input.upsell ? discounted(input.upsell.price, input.upsell.pct, online) : 0;
  const total = unit * input.bundle.qty + upsellUnit;
  const before = full + (input.upsell ? Number(input.upsell.price) || 0 : 0);
  return { unit, upsellUnit, total, before, saving: Math.max(0, before - total) };
}

/** Fecha de despacho y rango de entrega (días hábiles, lunes a sábado) desde hoy en Colombia. */
export function deliveryWindow(now: Date, shipping: LandingConfig["shipping"]) {
  const bogota = new Date(now.getTime() - 5 * 3600_000);
  const addBusiness = (from: Date, days: number) => {
    const d = new Date(from);
    let left = days;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (d.getUTCDay() !== 0) left--;
    }
    return d;
  };
  const late = bogota.getUTCHours() >= shipping.cutoff_hour || bogota.getUTCDay() === 0;
  const dispatch = late ? addBusiness(bogota, 1) : bogota;
  return { today: bogota, dispatch, from: addBusiness(dispatch, Math.max(0, shipping.days_min)), to: addBusiness(dispatch, Math.max(shipping.days_min, shipping.days_max)) };
}

export const CO_DEPARTMENTS = [
  "Amazonas", "Antioquia", "Arauca", "Atlántico", "Bogotá D.C.", "Bolívar", "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó",
  "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira", "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo",
  "Quindío", "Risaralda", "San Andrés y Providencia", "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada",
];

/** Opciones dobles: «Manga larga / Negro» → dos selectores (Estilo y Color). */
export function optionDims(names: string[], label: string) {
  const parts = names.map((n) => n.split(/\s+\/\s+/));
  const two = names.length > 1 && parts.every((p) => p.length === 2 && p[0] && p[1]);
  if (!two) return null;
  const [l1, l2] = label.includes("/") ? label.split("/").map((x) => x.trim()) : ["Opción", label || "Color"];
  const uniq = (i: number) => [...new Set(parts.map((p) => p[i]))];
  return { labels: [l1 || "Opción", l2 || "Color"] as [string, string], values: [uniq(0), uniq(1)] as [string[], string[]], parts };
}

export const LANDING_SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;
