"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_CACHE_SECONDS, prepareImage } from "@/lib/image-prepare";
import { THUMB_BUCKETS, THUMB_QUALITY, THUMB_SIDE, thumbPath } from "./thumb";

/**
 * Sube la miniatura de una foto recién subida (ver lib/images/thumb.ts). No frena ni rompe la subida: si falla,
 * el catálogo muestra la foto grande y el script de miniaturas la crea después.
 */
export async function uploadThumb(sb: SupabaseClient, bucket: string, path: string, file: Blob, version?: string | number | null): Promise<void> {
  if (!(THUMB_BUCKETS as readonly string[]).includes(bucket)) return;
  if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type)) return;
  try {
    const small = await prepareImage(new File([file], "thumb", { type: file.type }), { maxSide: THUMB_SIDE, quality: THUMB_QUALITY });
    if (!small.compressed || small.contentType !== "image/webp") return;
    await sb.storage.from(bucket).upload(thumbPath(path, version), small.blob, { cacheControl: IMAGE_CACHE_SECONDS, contentType: "image/webp", upsert: false });
  } catch {
    /* la foto grande ya quedó; la miniatura no es indispensable */
  }
}
