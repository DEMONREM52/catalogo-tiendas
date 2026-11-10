import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Funciones opcionales de la tienda (20261312). Todo arranca APAGADO, salvo lo que ya existía antes
 * (cierre del día y primeros pasos), que sigue encendido hasta que lo apaguen. Apagado = nada cambia.
 */

export type FeatureKey =
  | "carritos" | "avisame" | "cupones" | "envio_gratis" | "imagen_oferta" | "recompra"
  | "traslados_sugeridos" | "conteo_zonas" | "cierre_dia" | "arranque";

export type FeatureState = { enabled: boolean; settings: Record<string, unknown> };
export type FeatureMap = Record<FeatureKey, FeatureState>;

export type FeatureGroup = "vender" | "clientes" | "operacion" | "general";
export type FeatureInfo = {
  key: FeatureKey;
  emoji: string;
  title: string;
  pitch: string;
  /** Dónde se ve cuando está encendida. */
  where: string;
  group: FeatureGroup;
  color: string;
  /** Permisos que dejan ver su bandeja (cualquiera). */
  perms: string[];
  /** Si tiene bandeja propia en «Funciones opcionales». */
  tray?: boolean;
  /** Si su pantalla vive en otro lado del panel. */
  href?: string;
};

export const FEATURE_GROUPS: Array<{ key: FeatureGroup; title: string; emoji: string }> = [
  { key: "vender", title: "Vender más en tus catálogos", emoji: "🛒" },
  { key: "clientes", title: "Clientes", emoji: "💛" },
  { key: "operacion", title: "Operación", emoji: "📦" },
  { key: "general", title: "Avisos y ayudas", emoji: "✨" },
];

export const FEATURES: FeatureInfo[] = [
  { key: "carritos", emoji: "🛒", title: "Carritos abandonados", group: "vender", color: "#f97316", perms: ["orders"], tray: true,
    pitch: "Si un cliente escribe su nombre y su WhatsApp en el carrito y no envía el pedido, te sale aquí para escribirle.",
    where: "En el carrito sale una casilla opcional de WhatsApp. La bandeja muestra quién se fue sin comprar." },
  { key: "avisame", emoji: "🔔", title: "Avísame cuando llegue", group: "vender", color: "#8b5cf6", perms: ["orders", "products"], tray: true,
    pitch: "En los productos agotados el cliente deja su WhatsApp. Cuando entra mercancía te dice a quién avisar.",
    where: "Botón «Avísame» en los productos agotados del catálogo." },
  { key: "cupones", emoji: "🎟️", title: "Cupones de descuento", group: "vender", color: "#ec4899", perms: ["products_prices", "catalogs"], tray: true,
    pitch: "Códigos como ZAMORA10, por % o por valor, con fechas, límite de usos y catálogos. No se suman a las ofertas.",
    where: "Casilla «¿Tienes un cupón?» en el carrito (solo si tienes cupones activos)." },
  { key: "envio_gratis", emoji: "🚚", title: "Envío gratis desde $X", group: "vender", color: "#10b981", perms: ["catalogs", "store"], tray: true,
    pitch: "Una barra en el carrito: «te faltan $12.000 para el envío gratis». Anima a llevar un poco más.",
    where: "Barra en el carrito y una línea en el mensaje de WhatsApp. No cobra ni descuenta nada." },
  { key: "imagen_oferta", emoji: "📸", title: "Imagen de oferta para estados", group: "vender", color: "#ef4444", perms: ["products"],
    pitch: "Una imagen lista para estados de WhatsApp con el precio de antes tachado, el de ahora y el %.",
    where: "Botón «📸 Imagen para estados» en la oferta del producto y en el kit de «¡Publícame!»." },
  { key: "recompra", emoji: "🔁", title: "Recompra y cumpleaños de clientes", group: "clientes", color: "#f59e0b", perms: ["clients"], href: "/dashboard/clientes?tab=recompra",
    pitch: "El historial de cada cliente, a quién toca escribirle porque ya debería volver y los cumpleaños de la semana.",
    where: "Pestaña «🔁 Recompra» en Clientes." },
  { key: "traslados_sugeridos", emoji: "🔀", title: "Traslados sugeridos entre puntos", group: "operacion", color: "#0ea5e9", perms: ["transfers"], href: "/dashboard/inventario?tab=transfers&rebalanceo=1",
    pitch: "«Zamora tiene 20 y no vende; Manhattan se quedó en 0». Arma el traslado con un toque y tú lo revisas.",
    where: "Botón «🔀 Desbalances» en Traslados." },
  { key: "conteo_zonas", emoji: "📷", title: "Conteo por zonas con aprobación", group: "operacion", color: "#14b8a6", perms: ["inventory"], href: "/dashboard/inventario?tab=conteos",
    pitch: "Cuenta por zonas con la cámara del celular sin cerrar la tienda. Las diferencias se ajustan solo cuando alguien las aprueba.",
    where: "Pestaña «📷 Conteos» en Stock." },
  { key: "cierre_dia", emoji: "📊", title: "Cierre del día al celular", group: "general", color: "#6366f1", perms: ["store"],
    pitch: "Cada noche (9 p. m.): ventas por punto, cajas, traslados y pedidos pendientes, agotados y ventas bajo costo.",
    where: "Aviso al celular del dueño y de quien maneja la plata." },
  { key: "arranque", emoji: "🚀", title: "Primeros pasos guiados", group: "general", color: "#8b5cf6", perms: ["store"],
    pitch: "Lista de pasos con barra de progreso para dejar la tienda lista: logo, productos, catálogo y primera venta.",
    where: "Tarjeta en el inicio del panel hasta completar todo." },
];

export const featureInfo = (k: FeatureKey) => FEATURES.find((f) => f.key === k)!;

const missing = (m?: string) => Boolean(m && /Could not find the function|schema cache|does not exist/i.test(m));

export async function loadFeatures(storeId: string): Promise<{ ok: true; canConfig: boolean; features: FeatureMap } | { ok: false; missing: boolean; message: string }> {
  const { data, error } = await supabaseBrowser().rpc("store_features_get", { p_store: storeId });
  if (error) return { ok: false, missing: missing(error.message), message: error.message };
  const r = data as { ok: boolean; message?: string; can_config?: boolean; features?: FeatureMap } | null;
  if (!r?.ok || !r.features) return { ok: false, missing: false, message: r?.message ?? "No se pudo leer." };
  return { ok: true, canConfig: Boolean(r.can_config), features: r.features };
}

export async function saveFeature(storeId: string, key: FeatureKey, enabled: boolean, settings?: Record<string, unknown> | null) {
  const { data, error } = await supabaseBrowser().rpc("store_feature_save", { p_store: storeId, p_feature: key, p_enabled: enabled, p_settings: settings ?? null });
  if (error) return { ok: false as const, message: missing(error.message) ? "Falta correr en Supabase la migración 20261312_vender_mas_opcional.sql." : error.message };
  const r = data as { ok: boolean; message?: string; features?: FeatureMap } | null;
  if (!r?.ok || !r.features) return { ok: false as const, message: r?.message ?? "No se pudo guardar." };
  return { ok: true as const, features: r.features };
}

/** Lo que se cambia en un mensaje: {cliente}, {producto}, {productos}, {tienda}, {enlace}, {total}. */
export function fillMessage(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? vars[k] : all)).replace(/[ \t]{2,}/g, " ").trim();
}

export const waLink = (phone: string, text: string) => {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 10 && digits.startsWith("3") ? `57${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
};
