"use client";

/**
 * Prepara una imagen antes de subirla: la reduce al tamaño en que se muestra y la guarda en WebP.
 * Una foto de celular (3–6 MB) queda en ~100–300 KB: menos almacenamiento y mucha menos transferencia
 * en cada visita al catálogo. La original del usuario no se modifica (solo se sube la versión liviana).
 * GIF y SVG se suben tal cual (animación / vector). Si el navegador no puede, se sube la original.
 */
export const IMAGE_CACHE_SECONDS = "31536000"; // 1 año: cada subida usa una dirección nueva (?t=…)

export type PreparedImage = { blob: Blob; contentType: string; ext: string; compressed: boolean };

export async function prepareImage(file: File, { maxSide = 1600, quality = 0.82 }: { maxSide?: number; quality?: number } = {}): Promise<PreparedImage> {
  const original: PreparedImage = { blob: file, contentType: file.type || "application/octet-stream", ext: extOf(file), compressed: false };
  if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type)) return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    // Safari viejo no genera WebP: devuelve PNG; en ese caso se intenta JPEG (sin transparencia).
    let out = webp && webp.type === "image/webp" ? webp : null;
    if (!out && file.type !== "image/png") out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!out || (out.size >= file.size && scale === 1)) return original;
    return { blob: out, contentType: out.type, ext: out.type === "image/webp" ? "webp" : "jpg", compressed: true };
  } catch {
    return original;
  }
}

function extOf(file: File) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(file.name);
  return (m?.[1] ?? "bin").toLowerCase();
}
