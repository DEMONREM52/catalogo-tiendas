/**
 * Miniaturas de las fotos de productos y categorías (480 px, WebP).
 *
 * Por qué: las fotos se guardan en WebP de 1.600 px (~100–300 KB) y las tarjetas del catálogo, del POS y de las listas
 * las muestran de ~150–300 px. Con la miniatura (~20–40 KB) cada tarjeta descarga varias veces menos: es lo que más
 * pesa en la transferencia de Storage (Cached Egress).
 *
 * Cómo:
 *   · Al lado de cada foto va su miniatura: `<ruta>.v<versión>.thumb.webp`. La versión es el `?t=` de la dirección de
 *     la foto, así una foto reemplazada en la misma ruta tiene OTRA miniatura (nunca se ve una vieja y no hay que
 *     sobrescribir archivos, que la regla de Storage solo permite al dueño).
 *   · Las nuevas las sube ImageUpload / la creación rápida (lib/images/thumb-upload.ts); las que ya existen las crea
 *     scripts/miniaturas-imagenes.mjs.
 *   · Se usan solo si NEXT_PUBLIC_IMAGE_THUMBS=1 (en Vercel, después de correr el script). Si falta una, la imagen
 *     vuelve sola a la foto grande (components/ui/ThumbImg.tsx).
 * Solo para los buckets públicos de fotos de producto y categoría; las demás direcciones no cambian.
 */
export const THUMB_SIDE = 480;
export const THUMB_QUALITY = 0.75;
export const THUMB_BUCKETS = ["product-images", "category-images"] as const;

const PUBLIC_MARK = "/storage/v1/object/public/";
const NO_THUMB = /\.(gif|svg)$/i;

/** ¿Están encendidas? (se fija al compilar: NEXT_PUBLIC_*). */
export function thumbsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_IMAGE_THUMBS === "1";
}

/** Ruta de la miniatura dentro del bucket, para una ruta de foto y su versión (`?t=`). */
export function thumbPath(path: string, version?: string | number | null): string {
  const v = version === null || version === undefined || version === "" ? "" : `.v${version}`;
  return `${path}${v}.thumb.webp`;
}

/** Lo que hace falta para crear la miniatura de una dirección pública de Storage (o null si no lleva). */
export function thumbTarget(url: string | null | undefined): { bucket: string; path: string; version: string | null; thumbUrl: string } | null {
  if (!url) return null;
  const q = url.indexOf("?");
  const base = q < 0 ? url : url.slice(0, q);
  const at = base.indexOf(PUBLIC_MARK);
  if (at < 0) return null;
  const rest = base.slice(at + PUBLIC_MARK.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  if (!(THUMB_BUCKETS as readonly string[]).includes(bucket)) return null;
  const encodedPath = rest.slice(slash + 1);
  if (!encodedPath || /\.thumb\.webp$/i.test(encodedPath) || NO_THUMB.test(encodedPath)) return null;
  const t = q < 0 ? null : new URLSearchParams(url.slice(q + 1)).get("t");
  const version = t && /^\d{1,16}$/.test(t) ? t : null;
  let path: string;
  try { path = decodeURIComponent(encodedPath); } catch { return null; }
  return { bucket, path, version, thumbUrl: base.slice(0, at + PUBLIC_MARK.length + slash + 1) + thumbPath(encodedPath, version) };
}

/** Dirección de la miniatura para mostrar (null si están apagadas o la foto no lleva). */
export function thumbUrl(url: string | null | undefined): string | null {
  return thumbsEnabled() ? thumbTarget(url)?.thumbUrl ?? null : null;
}
