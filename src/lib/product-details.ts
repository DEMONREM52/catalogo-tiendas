export type ProductDetails = {
  long_description: string;
  gallery_urls: string[];
  video_url: string;
  tutorial_url: string;
  highlights: string[];
  specifications: Array<{ name: string; value: string }>;
};

export const EMPTY_PRODUCT_DETAILS: ProductDetails = {
  long_description: "",
  gallery_urls: [],
  video_url: "",
  tutorial_url: "",
  highlights: [],
  specifications: [],
};

export function hasProductLanding(
  value: unknown,
  product: { description?: unknown; imageUrl?: unknown } = {},
) {
  const details = normalizeProductDetails(value);
  return Boolean(
    details.long_description.trim() ||
      details.gallery_urls.some(isSafeHttpUrl) ||
      isSafeHttpUrl(details.video_url) ||
      isSafeHttpUrl(details.tutorial_url) ||
      details.highlights.some((item) => item.trim()) ||
      details.specifications.some((item) => item.name.trim() && item.value.trim()) ||
      (typeof product.description === "string" && product.description.trim()) ||
      (typeof product.imageUrl === "string" && isSafeHttpUrl(product.imageUrl)),
  );
}

export function buildProductShareText(product: {
  name: string;
  price: number;
  description?: string | null;
  category?: string | null;
  stock?: number | null;
  imageUrl?: string | null;
  details: unknown;
}) {
  const details = normalizeProductDetails(product.details);
  const descriptions = [...new Set(
    [product.description?.trim(), details.long_description.trim()].filter(
      (value): value is string => typeof value === "string" && Boolean(value),
    ),
  )];
  const images = [product.imageUrl, ...details.gallery_urls].filter(
    (url): url is string => typeof url === "string" && isSafeHttpUrl(url),
  );
  const uniqueImages = [...new Set(images)];

  return [
    product.name,
    `Precio: $${Number(product.price || 0).toLocaleString("es-CO")}`,
    product.stock === null || product.stock === undefined
      ? "Disponibilidad: disponible"
      : `Disponibilidad: ${product.stock} unidades`,
    product.category?.trim() ? `Categoría: ${product.category.trim()}` : "",
    ...descriptions,
    details.highlights.length
      ? `Características:\n${details.highlights.map((item) => `• ${item}`).join("\n")}`
      : "",
    details.specifications.length
      ? `Especificaciones:\n${details.specifications.map((item) => `• ${item.name}: ${item.value}`).join("\n")}`
      : "",
    isSafeHttpUrl(details.video_url) ? `Video: ${details.video_url}` : "",
    isSafeHttpUrl(details.tutorial_url) ? `Tutorial: ${details.tutorial_url}` : "",
    formatProductPhotoLinks(uniqueImages),
  ].filter(Boolean).join("\n\n");
}

export function formatProductPhotoLinks(images: string[]) {
  const uniqueImages = [...new Set(images.filter(isSafeHttpUrl))];
  if (uniqueImages.length === 0) return "";

  const heading = uniqueImages.length === 1
    ? "Foto del producto:"
    : `Fotos del producto (${uniqueImages.length}):`;
  const links = uniqueImages.map((url, index) =>
    uniqueImages.length === 1 ? url : `${index + 1}. ${url}`,
  );
  return `${heading}\n${links.join("\n")}`;
}

export function normalizeProductDetails(value: unknown): ProductDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_PRODUCT_DETAILS };
  }
  const data = value as Record<string, unknown>;
  const strings = (item: unknown) =>
    Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [];

  return {
    long_description: typeof data.long_description === "string" ? data.long_description : "",
    gallery_urls: strings(data.gallery_urls),
    video_url: typeof data.video_url === "string" ? data.video_url : "",
    tutorial_url: typeof data.tutorial_url === "string" ? data.tutorial_url : "",
    highlights: strings(data.highlights),
    specifications: Array.isArray(data.specifications)
      ? data.specifications.filter(
          (item): item is { name: string; value: string } =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { name?: unknown }).name === "string" &&
            typeof (item as { value?: unknown }).value === "string",
        )
      : [],
  };
}

export function linesToList(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function linesToSpecifications(value: string) {
  return linesToList(value).flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return [];
    const name = line.slice(0, separator).trim();
    const itemValue = line.slice(separator + 1).trim();
    return name && itemValue ? [{ name, value: itemValue }] : [];
  });
}

export function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getYoutubeEmbedUrl(value: string) {
  const id = getYoutubeVideoId(value);
  return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
}

export function getYoutubeThumbnailUrl(value: string) {
  const id = getYoutubeVideoId(value);
  return id ? `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : null;
}

function getYoutubeVideoId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      return url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
