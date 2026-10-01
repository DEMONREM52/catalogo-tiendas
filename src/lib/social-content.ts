import {
  formatProductPhotoLinks,
  hasProductLanding,
  isSafeHttpUrl,
  type ProductDetails,
} from "@/lib/product-details";

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "facebook_marketplace"
  | "whatsapp"
  | "tiktok"
  | "pinterest"
  | "mercadolibre";

export type SocialProduct = {
  id: string;
  name: string;
  description: string | null;
  price_retail: number;
  image_url: string | null;
  stock: number | null;
  active?: boolean;
  details: ProductDetails;
};

export const SOCIAL_PLATFORMS: Array<{ id: SocialPlatform; label: string }> = [
  { id: "facebook", label: "Facebook Pages" },
  { id: "instagram", label: "Instagram profesional" },
  { id: "facebook_marketplace", label: "Facebook Marketplace" },
  { id: "whatsapp", label: "WhatsApp Business" },
  { id: "tiktok", label: "TikTok" },
  { id: "pinterest", label: "Pinterest" },
  { id: "mercadolibre", label: "Mercado Libre" },
];

function hashtagsFrom(text: string) {
  const words = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((word) => word.length > 2))].slice(0, 5).map((word) => `#${word}`);
}

export function createSocialCaption(
  product: SocialProduct,
  platform: SocialPlatform,
  options: { style?: string; objective?: string } = {},
) {
  const descriptions = [...new Set(
    [product.description?.trim(), product.details.long_description.trim()].filter(
      (value): value is string => typeof value === "string" && Boolean(value),
    ),
  )];
  const cta =
    options.objective === "conversaciones"
      ? "Escríbenos si quieres resolver alguna duda."
      : "Escríbenos para más información.";
  const title = product.name.trim();
  const images = [product.image_url, ...product.details.gallery_urls].filter(
    (url): url is string => typeof url === "string" && isSafeHttpUrl(url),
  );
  const details = [
    title,
    ...descriptions,
    Number(product.price_retail) > 0
      ? `Precio: $${Number(product.price_retail).toLocaleString("es-CO")}`
      : "",
    product.active === false || (product.stock !== null && product.stock <= 0)
      ? "Disponibilidad: consultar"
      : product.stock === null ? "Disponible" : `Disponibles: ${product.stock} unidades`,
    product.details.highlights.length
      ? `Características:\n${product.details.highlights.map((item) => `• ${item}`).join("\n")}`
      : "",
    product.details.specifications.length
      ? `Especificaciones:\n${product.details.specifications.map((item) => `• ${item.name}: ${item.value}`).join("\n")}`
      : "",
    isSafeHttpUrl(product.details.video_url) ? `Video: ${product.details.video_url}` : "",
    isSafeHttpUrl(product.details.tutorial_url) ? `Tutorial: ${product.details.tutorial_url}` : "",
    formatProductPhotoLinks(images),
    cta,
    hashtagsFrom(product.name).join(" "),
  ].filter(Boolean);

  if (platform === "whatsapp" || platform === "facebook_marketplace") {
    return details.filter((line) => !line.startsWith("#")).join("\n\n");
  }
  return details.join("\n\n");
}

export function reviewProductForPost(product: SocialProduct) {
  const warnings: string[] = [];
  if (product.active === false) {
    warnings.push("El producto está inactivo y su página pública no se puede abrir mientras siga así.");
  }
  if (!product.description?.trim() && !product.details.long_description.trim()) {
    warnings.push("Completa una descripción real para dar más contexto del producto.");
  }
  if (!hasProductLanding(product.details, { description: product.description, imageUrl: product.image_url })) {
    warnings.push("Completa la ficha ampliada del producto para incluir más información en la publicación.");
  }
  if (!product.image_url && product.details.gallery_urls.length === 0) {
    warnings.push("Añade una foto propia del producto antes de compartirlo.");
  }
  if (!Number.isFinite(product.price_retail) || product.price_retail <= 0) {
    warnings.push("El producto no tiene un precio al detal válido; el borrador no incluirá un precio.");
  }
  if (product.stock !== null && product.stock <= 0) {
    warnings.push("El producto aparece agotado. Verifica la disponibilidad antes de publicar.");
  }
  warnings.push("Esta revisión preventiva no garantiza la aprobación de la plataforma.");
  return warnings;
}
