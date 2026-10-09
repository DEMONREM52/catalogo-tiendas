"use client";

/**
 * Huella de imagen para la búsqueda por foto.
 *
 * Se usa MobileCLIP S0 (Apple) en el navegador: convierte una foto en 512 números; dos fotos del mismo
 * producto dan huellas parecidas aunque cambie la luz, el ángulo o el fondo. La librería y el modelo
 * (~23 MB) se descargan solo la primera vez que alguien usa la búsqueda por foto y quedan guardados
 * en el navegador.
 */

export const IMAGE_MODEL = "mobileclip_s0";
const MODEL_ID = "Xenova/mobileclip_s0";
const LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";

type Tensor = { data: Float32Array; normalize: () => Tensor };
type RawImage = unknown;
type Lib = {
  env: { allowLocalModels: boolean };
  AutoProcessor: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<(img: RawImage) => Promise<Record<string, unknown>>> };
  CLIPVisionModelWithProjection: {
    from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<(inputs: Record<string, unknown>) => Promise<{ image_embeds: Tensor }>>;
  };
  RawImage: { fromBlob: (blob: Blob) => Promise<RawImage> };
};

export type EmbedProgress = { stage: "lib" | "model" | "ready"; percent: number };
type Listener = (p: EmbedProgress) => void;

let loading: Promise<(blob: Blob) => Promise<number[]>> | null = null;
const listeners = new Set<Listener>();
let lastProgress: EmbedProgress = { stage: "lib", percent: 0 };

function emit(p: EmbedProgress) {
  lastProgress = p;
  listeners.forEach((fn) => fn(p));
}

/** Avisos de descarga del modelo (para mostrar «Preparando… 40 %»). */
export function onEmbedProgress(fn: Listener) {
  listeners.add(fn);
  fn(lastProgress);
  return () => {
    listeners.delete(fn);
  };
}

async function create() {
  emit({ stage: "lib", percent: 0 });
  const lib = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ LIB_URL)) as Lib;
  lib.env.allowLocalModels = false;
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (info: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== "progress" || !info.file) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    let loaded = 0;
    let total = 0;
    files.forEach((f) => { loaded += f.loaded; total += f.total; });
    if (total > 0) emit({ stage: "model", percent: Math.min(99, Math.round((loaded / total) * 100)) });
  };
  emit({ stage: "model", percent: 0 });
  const processor = await lib.AutoProcessor.from_pretrained(MODEL_ID);
  let model;
  try {
    model = await lib.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: "fp16", device: "wasm", progress_callback });
  } catch {
    // Navegadores sin soporte para la versión liviana: modelo completo (da la misma huella).
    model = await lib.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: "fp32", device: "wasm", progress_callback });
  }
  emit({ stage: "ready", percent: 100 });
  return async (blob: Blob) => {
    const image = await lib.RawImage.fromBlob(blob);
    const { image_embeds } = await model(await processor(image));
    // 5 decimales: suficiente precisión y la mitad de datos al guardar.
    return Array.from(image_embeds.normalize().data, (x) => Math.round(x * 1e5) / 1e5);
  };
}

function embedder() {
  if (!loading) {
    loading = create().catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/** Deja el modelo listo en segundo plano (p. ej. al abrir el buscador). */
export function warmUpImageSearch() {
  void embedder().catch(() => {});
}

/** Reduce la foto (las del celular pesan varios MB) antes de analizarla. */
async function shrink(blob: Blob, max = 512): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close();
      return blob;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? blob), "image/jpeg", 0.9));
  } catch {
    return blob;
  }
}

/** Huella de una foto (archivo de la cámara o galería). */
export async function embedImageBlob(blob: Blob) {
  const run = await embedder();
  return run(await shrink(blob));
}

/** Carga el modelo (lanza error si no se pudo descargar). */
export async function loadImageEmbedder() {
  await embedder();
}

/** Descarga una imagen publicada (foto del producto). Lanza error si no se puede. */
export async function fetchImageBlob(url: string) {
  const res = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.startsWith("image/")) throw new Error("El enlace no es una imagen.");
  return res.blob();
}

/** El navegador puede usar la búsqueda por foto. */
export function imageSearchSupported() {
  return typeof window !== "undefined" && typeof WebAssembly === "object" && typeof createImageBitmap === "function";
}
