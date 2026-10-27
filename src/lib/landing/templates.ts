// Plantillas de landing por tipo de negocio + kit de pauta (textos de anuncio y enlaces con seguimiento).
// Cada plantilla trae textos, beneficios, preguntas, paquetes y colores pensados para vender ese tipo de producto.
// {producto} y {precio} se reemplazan con los datos reales.
import { DEFAULT_LANDING, SECTION_KEYS, type LandingConfig, type SectionKey } from "./config";

const order = (first: SectionKey[], off: SectionKey[] = []) => [...first, ...SECTION_KEYS.filter((k) => !first.includes(k))].map((key) => ({ key, on: !off.includes(key) }));

export type LandingTemplate = {
  key: string;
  name: string;
  emoji: string;
  hint: string;
  config: Partial<LandingConfig>;
};

const faq = (q: string, a: string) => ({ q, a });

export const LANDING_TEMPLATES: LandingTemplate[] = [
  {
    key: "combo", name: "Combo / Pack (afiche)", emoji: "🎁", hint: "Imágenes largas tipo Canva, packs de 3, 6 y 9, estilo + color",
    config: {
      accent: "#111827", badge: "COMBO", option_label: "Estilo / Color", font: "fuerte",
      headline: "{producto}", subheadline: "Arma tu pack con los estilos y colores que quieras.",
      promo_text: "Esta oferta termina pronto", topbar_text: "🚚 Entregas a toda Colombia · 💵 Paga al recibir",
      poster_title: "Elige tu pack con cualquiera de estos estilos:", poster_cta_every: 1,
      sections: order(["poster", "hero", "trust", "faq", "guarantees"], ["benefits", "stories", "compare", "details"]),
      bundles: [
        { qty: 3, pct: 0, label: "Pack x3", highlight: false },
        { qty: 6, pct: 8, label: "Pack x6 · ahorra más", highlight: true },
        { qty: 9, pct: 15, label: "Pack x9 · mejor precio", highlight: false },
      ],
      faqs: [
        faq("¿Puedo mezclar estilos y colores?", "Sí. En cada unidad del pack eliges el estilo y el color que quieras."),
        faq("¿Cuánto se demora?", "Entre 2 y 5 días hábiles según tu ciudad."),
        faq("¿Cómo pago?", "En efectivo cuando lo recibes, o en línea."),
      ],
      guarantees: ["Satisfacción garantizada", "Pago seguro", "Envío a toda Colombia"],
      cta_text: "¡Comprar ahora y paga al recibir!", sticky_text: "Comprar pack",
    },
  },
  {
    key: "moda", name: "Moda y ropa", emoji: "👗", hint: "Colores y tallas, paquete 2x y 3x, cambios fáciles",
    config: {
      accent: "#e11d48", badge: "NUEVA COLECCIÓN", option_label: "Color",
      headline: "{producto}: cómoda, elegante y lista para cualquier plan",
      subheadline: "Se adapta a tu figura, no se transparenta y la puedes usar todo el día.",
      promo_text: "¡Aprovecha la promo y llévala a un precio increíble!",
      benefits: [
        { icon: "✨", title: "Tela que se adapta", text: "Elástica y suave, se siente como una segunda piel." },
        { icon: "👜", title: "Para cualquier ocasión", text: "Combínala con tenis o tacones." },
        { icon: "🚚", title: "Envío a toda Colombia", text: "Te llega a la puerta de tu casa." },
        { icon: "💵", title: "Paga al recibir", text: "No pagas nada por adelantado." },
      ],
      faqs: [
        faq("¿Qué talla pido?", "Revisa la guía de tallas en las fotos. Si tienes dudas, escríbenos por WhatsApp y te asesoramos."),
        faq("¿Cuánto se demora?", "Entre 2 y 5 días hábiles según tu ciudad. Te enviamos la guía por WhatsApp."),
        faq("¿Y si no me queda?", "Te hacemos el cambio de talla o color. Solo debe estar sin usar y con etiquetas."),
        faq("¿Cómo pago?", "En efectivo cuando la recibes, o en línea con tarjeta, PSE o Nequi."),
      ],
      bundles: [
        { qty: 1, pct: 0, label: "Lleva 1", highlight: false },
        { qty: 2, pct: 8, label: "Lleva 2 · más vendido", highlight: true },
        { qty: 3, pct: 15, label: "Lleva 3 · mejor precio", highlight: false },
      ],
      guarantees: ["Cambio de talla", "Paga al recibir", "Envío a toda Colombia"],
      cta_text: "¡Comprar ahora y paga al recibir!",
    },
  },
  {
    key: "calzado", name: "Calzado", emoji: "👟", hint: "Tallas, comodidad y garantía",
    config: {
      accent: "#0f172a", badge: "EDICIÓN LIMITADA", option_label: "Talla",
      headline: "{producto}: comodidad para caminar todo el día",
      subheadline: "Suela antideslizante, plantilla acolchada y un diseño que combina con todo.",
      benefits: [
        { icon: "🦶", title: "Plantilla acolchada", text: "Menos cansancio al final del día." },
        { icon: "🛡️", title: "Garantía", text: "Si tiene defectos de fábrica, te lo cambiamos." },
        { icon: "📏", title: "Cambio de talla", text: "Si no te queda, lo cambiamos." },
        { icon: "💵", title: "Paga al recibir", text: "Revisa y paga cuando te llegue." },
      ],
      faqs: [
        faq("¿Hormas grande o pequeño?", "Horma normal. Pide tu talla de siempre; si estás entre dos, pide la mayor."),
        faq("¿Tiene garantía?", "Sí, por defectos de fábrica."),
        faq("¿Cuánto se demora?", "Entre 2 y 5 días hábiles."),
      ],
      bundles: [
        { qty: 1, pct: 0, label: "1 par", highlight: false },
        { qty: 2, pct: 10, label: "2 pares · ahorra más", highlight: true },
      ],
      guarantees: ["Garantía de fábrica", "Cambio de talla", "Paga al recibir"],
      cta_text: "¡Lo quiero, pago al recibir!",
    },
  },
  {
    key: "belleza", name: "Belleza y cuidado", emoji: "💄", hint: "Resultados, modo de uso y combos",
    config: {
      accent: "#db2777", badge: "FAVORITO", option_label: "Tono",
      headline: "{producto}: resultados que se notan desde la primera semana",
      subheadline: "Fácil de usar en casa. Así lo usan nuestras clientas.",
      benefits: [
        { icon: "🌿", title: "Ingredientes de calidad", text: "Cuida tu piel mientras la embellece." },
        { icon: "⏱️", title: "Rápido de aplicar", text: "Menos de 5 minutos al día." },
        { icon: "💖", title: "Para todo tipo de piel", text: "Suave y sin irritar." },
        { icon: "💵", title: "Paga al recibir", text: "Sin riesgo." },
      ],
      faqs: [
        faq("¿Cómo se usa?", "Aplica sobre la piel limpia, mañana y noche. Te enviamos la guía por WhatsApp."),
        faq("¿En cuánto tiempo veo resultados?", "Depende de cada persona; la mayoría nota cambios en 1 a 3 semanas de uso constante."),
        faq("¿Es original?", "Sí, producto original con registro."),
      ],
      bundles: [
        { qty: 1, pct: 0, label: "1 unidad", highlight: false },
        { qty: 2, pct: 10, label: "Tratamiento completo (2)", highlight: true },
        { qty: 3, pct: 18, label: "Kit 3 · el mejor precio", highlight: false },
      ],
      guarantees: ["Producto original", "Pago seguro", "Envío a toda Colombia"],
      cta_text: "¡Quiero el mío!",
    },
  },
  {
    key: "tecnologia", name: "Tecnología", emoji: "🎧", hint: "Características, garantía y comparación",
    config: {
      accent: "#2563eb", badge: "TOP VENTAS", option_label: "Color",
      headline: "{producto}: más potencia, menos complicaciones",
      subheadline: "Conéctalo en segundos y disfrútalo todo el día.",
      benefits: [
        { icon: "🔋", title: "Batería de larga duración", text: "Úsalo todo el día sin preocuparte." },
        { icon: "⚡", title: "Conexión rápida", text: "Listo en segundos." },
        { icon: "🛡️", title: "Garantía", text: "Te respaldamos." },
        { icon: "💵", title: "Paga al recibir", text: "Pruébalo y paga." },
      ],
      faqs: [
        faq("¿Tiene garantía?", "Sí. Si falla por defecto de fábrica, lo cambiamos."),
        faq("¿Es compatible con mi celular?", "Funciona con Android y iPhone."),
        faq("¿Qué incluye la caja?", "Revisa las fotos: ahí ves todo lo que trae."),
      ],
      bundles: [
        { qty: 1, pct: 0, label: "1 unidad", highlight: false },
        { qty: 2, pct: 10, label: "2 unidades · para regalar", highlight: true },
      ],
      guarantees: ["Garantía", "Pago seguro", "Soporte por WhatsApp"],
      cta_text: "¡Comprar ahora!",
    },
  },
  {
    key: "hogar", name: "Hogar y cocina", emoji: "🏠", hint: "Problema → solución, antes y después",
    config: {
      accent: "#ea580c", badge: "SÚPER PRÁCTICO", option_label: "Modelo",
      headline: "{producto}: la solución que tu casa estaba pidiendo",
      subheadline: "Ahorra tiempo y espacio desde el primer día.",
      benefits: [
        { icon: "⏱️", title: "Ahorra tiempo", text: "Haz en minutos lo que antes te tomaba horas." },
        { icon: "🧼", title: "Fácil de limpiar", text: "Sin complicaciones." },
        { icon: "💪", title: "Resistente", text: "Hecho para durar." },
        { icon: "💵", title: "Paga al recibir", text: "Sin riesgo." },
      ],
      faqs: [faq("¿Cómo se usa?", "Te enviamos el video de uso por WhatsApp."), faq("¿Cuánto se demora?", "Entre 2 y 5 días hábiles.")],
      bundles: [
        { qty: 1, pct: 0, label: "1 unidad", highlight: false },
        { qty: 2, pct: 12, label: "2 · uno para regalar", highlight: true },
      ],
      guarantees: ["Garantía", "Paga al recibir", "Envío a toda Colombia"],
      cta_text: "¡Lo quiero en mi casa!",
    },
  },
  {
    key: "salud", name: "Bienestar y suplementos", emoji: "💪", hint: "Tratamiento por meses, con cuidado legal",
    config: {
      accent: "#16a34a", badge: "BIENESTAR", option_label: "Presentación",
      headline: "{producto}: acompaña tu rutina de bienestar",
      subheadline: "Fácil de incluir en tu día a día.",
      benefits: [
        { icon: "🌱", title: "Fácil de tomar", text: "Inclúyelo en tu rutina." },
        { icon: "📦", title: "Tratamiento por meses", text: "Lleva más y ahorra." },
        { icon: "🚚", title: "Envío a toda Colombia", text: "Discreto y seguro." },
        { icon: "💵", title: "Paga al recibir", text: "Sin riesgo." },
      ],
      faqs: [
        faq("¿Tiene registro INVIMA?", "Escríbelo aquí con el número real del registro sanitario."),
        faq("¿Cómo se toma?", "Sigue las indicaciones de la etiqueta. Consulta a tu médico si tienes alguna condición."),
      ],
      bundles: [
        { qty: 1, pct: 0, label: "1 mes", highlight: false },
        { qty: 2, pct: 10, label: "2 meses", highlight: true },
        { qty: 3, pct: 18, label: "3 meses · tratamiento completo", highlight: false },
      ],
      guarantees: ["Registro sanitario", "Pago seguro", "Envío discreto"],
      cta_text: "¡Empezar mi tratamiento!",
      policies: "Este producto no es un medicamento y no reemplaza una alimentación balanceada. Consulta a tu médico.",
    },
  },
];

/** Aplica una plantilla sobre la configuración actual (conserva fotos, opciones, precio anterior y píxeles). */
export function applyTemplate(current: LandingConfig, key: string): LandingConfig {
  const t = LANDING_TEMPLATES.find((x) => x.key === key);
  if (!t) return current;
  return {
    ...DEFAULT_LANDING,
    ...t.config,
    template: key,
    images: current.images,
    video_url: current.video_url,
    option_names: current.option_names,
    compare_at_price: current.compare_at_price,
    sale_price: current.sale_price,
    option_prices: current.option_prices,
    promo_ends_at: current.promo_ends_at,
    testimonials: current.testimonials,
    stories: current.stories,
    upsell: current.upsell,
    payments: current.payments,
    poster_images: current.poster_images,
    size_guide_image: current.size_guide_image,
    meta_pixel_id: current.meta_pixel_id,
    tiktok_pixel_id: current.tiktok_pixel_id,
    policies: t.config.policies ?? current.policies,
  };
}

export const fillText = (text: string, product: string, price: string) => text.replaceAll("{producto}", product).replaceAll("{precio}", price);

// ------------------------------------------------------------ kit de pauta

export type AdChannel = { key: string; name: string; emoji: string; utm: Record<string, string> };

export const AD_CHANNELS: AdChannel[] = [
  { key: "facebook", name: "Facebook (anuncio)", emoji: "📘", utm: { utm_source: "facebook", utm_medium: "paid" } },
  { key: "instagram", name: "Instagram (anuncio)", emoji: "📸", utm: { utm_source: "instagram", utm_medium: "paid" } },
  { key: "tiktok", name: "TikTok (anuncio)", emoji: "🎵", utm: { utm_source: "tiktok", utm_medium: "paid" } },
  { key: "youtube", name: "YouTube (anuncio o descripción del video)", emoji: "▶️", utm: { utm_source: "youtube", utm_medium: "video" } },
  { key: "google", name: "Google (anuncio)", emoji: "🔎", utm: { utm_source: "google", utm_medium: "paid" } },
  { key: "whatsapp", name: "Estados y grupos de WhatsApp", emoji: "💬", utm: { utm_source: "whatsapp", utm_medium: "social" } },
  { key: "bio", name: "Link en la biografía", emoji: "🔗", utm: { utm_source: "instagram", utm_medium: "bio" } },
  { key: "influencer", name: "Influenciador / aliado", emoji: "⭐", utm: { utm_source: "influencer", utm_medium: "referral" } },
  { key: "mensaje", name: "Correo o mensaje de texto (SMS)", emoji: "✉️", utm: { utm_source: "mensaje", utm_medium: "directo" } },
];

export function trackedLink(base: string, channel: AdChannel, campaign: string) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(channel.utm)) u.searchParams.set(k, v);
  if (campaign.trim()) u.searchParams.set("utm_campaign", campaign.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  return u.toString();
}

/** Textos de anuncio listos (gancho → beneficio → oferta → llamado). Solo usan datos reales de la landing. */
export function adCopies(input: { product: string; price: string; before: string | null; bundlePct: number; cod: boolean; freeShipping: boolean; endsAt: string | null }) {
  const pay = input.cod ? "Pagas al recibir 💵" : "Pago 100 % seguro 🔒";
  const ship = input.freeShipping ? "Envío GRATIS a toda Colombia 🚚" : "Envíos a toda Colombia 🚚";
  const offer = input.before ? `Antes ${input.before}, HOY ${input.price}` : `Hoy a ${input.price}`;
  const ends = input.endsAt ? `⏰ La promo termina el ${input.endsAt}.` : "";
  const bundle = input.bundlePct > 0 ? `Lleva más y ahorra hasta ${input.bundlePct} % adicional.` : "";
  return [
    { title: "Oferta directa", text: [`🔥 ${input.product}`, offer, bundle, ship, pay, ends, "👉 Pide el tuyo aquí:"].filter(Boolean).join("\n") },
    { title: "Problema → solución", text: [`¿Buscas algo cómodo que se vea increíble? 😍`, `${input.product} es justo lo que necesitas.`, `✅ ${offer}`, `✅ ${ship}`, `✅ ${pay}`, "Toca el enlace y elige el tuyo 👇"].join("\n") },
    { title: "Corto para historias y TikTok", text: [`${input.product} 😱 ${offer}`, pay, "Link 👇"].join("\n") },
    { title: "Prueba social (con datos reales)", text: [`Nuestros clientes lo están pidiendo 🛍️`, `${input.product}: ${offer}.`, ship, pay, ends, "Pide el tuyo antes de que se agote 👇"].filter(Boolean).join("\n") },
    { title: "WhatsApp (estado o grupo)", text: [`✨ ${input.product} ✨`, offer, bundle, ship, pay, "Pídelo aquí 👉"].filter(Boolean).join("\n") },
  ];
}
