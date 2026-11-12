"use client";

import { deviceProfile, markLocalRun } from "./device";

/**
 * Huella de imagen para la búsqueda por foto.
 *
 * Se usa MobileCLIP S0 (Apple): convierte una foto en 512 números; dos fotos del mismo producto dan huellas
 * parecidas aunque cambie la luz, el ángulo o el fondo. Se puede calcular en dos lugares, con el mismo modelo:
 *
 *  · «local»: en el navegador. La librería y el modelo (~23 MB) se descargan una vez y quedan guardados.
 *    Es lo que usan los computadores y los celulares buenos que ya lo tienen descargado.
 *  · «server»: modo liviano. El celular manda la foto en pequeño (256×256, ~15 KB) a /api/photo-embed y recibe
 *    la huella. Lo usan los celulares lentos, los que todavía no han descargado el modelo (la primera búsqueda
 *    sale de una vez y el modelo se descarga después, sin afán) y cualquiera si el modelo local falla.
 *
 * Antes de cualquiera de los dos, la foto se reduce a 256×256 centrada (lo que el modelo mira), sin abrirla
 * completa en memoria cuando el navegador lo permite.
 */

export const IMAGE_MODEL = "mobileclip_s0";
const MODEL_ID = "Xenova/mobileclip_s0";
const LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
const SERVER_URL = "/api/photo-embed";
const SIZE = 256;
/** Si el modelo local se demora más que esto, se pide al servidor (el local sigue y sirve para la próxima). */
const LOCAL_PATIENCE_MS = 25_000;

export type EmbedEngine = "local" | "server";
export type EmbedPurpose = "search" | "index";

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
let localReady = false;
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
  localReady = true;
  return async (blob: Blob) => {
    const image = await lib.RawImage.fromBlob(blob);
    markLocalRun(true);
    try {
      const { image_embeds } = await model(await processor(image));
      // 5 decimales: suficiente precisión y la mitad de datos al guardar.
      return Array.from(image_embeds.normalize().data, (x) => Math.round(x * 1e5) / 1e5);
    } finally {
      markLocalRun(false);
    }
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

/** ¿El modelo ya está descargado en este navegador? (entonces usarlo es inmediato y no gasta datos). */
export async function localModelCached(): Promise<boolean> {
  if (localReady) return true;
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open("transformers-cache");
    for (const dtype of ["_fp16", ""]) {
      if (await cache.match(`https://huggingface.co/${MODEL_ID}/resolve/main/onnx/vision_model${dtype}.onnx`)) return true;
    }
  } catch {
    /* sin caché */
  }
  return false;
}

/** Deja el modelo listo en segundo plano, solo donde conviene (computador, o celular bueno sin ahorro de datos). */
export function warmUpImageSearch(opts: { evenOnPhone?: boolean } = {}) {
  const p = deviceProfile();
  if (!p.localPossible || p.weak || p.forcedLite || p.saveData || p.slowNet) return;
  void (async () => {
    if (!p.desktop && !opts.evenOnPhone && !(await localModelCached())) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const start = () => void embedder().catch(() => {});
    if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 4000 });
    else window.setTimeout(start, 1500);
  })();
}

/** Carga el modelo local (lanza error si no se pudo descargar). */
export async function loadImageEmbedder() {
  await embedder();
}

// ------------------------------------------------------------------ preparar la foto

type Decoded = { src: CanvasImageSource; width: number; height: number; close: () => void };

/** Abre la foto sin cargarla completa cuando se puede (el navegador la reduce al decodificar). */
async function decode(blob: Blob, targetWidth: number): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { resizeWidth: targetWidth, resizeQuality: "high" });
      return { src: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      try {
        const bitmap = await createImageBitmap(blob);
        return { src: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      } catch {
        /* se intenta con <img> */
      }
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await (img.decode ? img.decode() : new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; }));
    return { src: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo preparar la foto."))), "image/jpeg", quality));
}

/** La foto como la mira el modelo: 256×256, cuadrado del centro (≈ 15 KB). */
export async function prepareModelInput(blob: Blob): Promise<Blob> {
  const img = await decode(blob, 512);
  try {
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Sin lienzo.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.src, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return await toBlob(canvas, 0.92);
  } finally {
    img.close();
  }
}

/** Miniatura para mostrar (y guardar para retomar la búsqueda al volver). */
export async function previewDataUrl(blob: Blob, max = 360): Promise<string> {
  const img = await decode(blob, max * 2);
  try {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img.src, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    img.close();
  }
}

// ------------------------------------------------------------------ calcular la huella

class ServerBusy extends Error {}

async function embedOnServer(input: Blob, purpose: EmbedPurpose): Promise<number[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(SERVER_URL, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: input, signal: ctrl.signal, cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; embedding?: number[]; error?: string } | null;
      if (res.ok && data?.ok && Array.isArray(data.embedding) && data.embedding.length === 512) return data.embedding;
      if (res.status === 429 && purpose === "index") {
        // Analizando muchas fotos: se espera lo que pide el servidor y se sigue.
        const wait = Math.min(60, Number(res.headers.get("Retry-After") ?? 10));
        await new Promise((r) => window.setTimeout(r, wait * 1000));
        continue;
      }
      if (res.status === 429) throw new ServerBusy(data?.error ?? "Demasiadas fotos seguidas. Espera un momento.");
      if (res.status === 503 && attempt === 0) continue;
      throw new Error(data?.error ?? `El servidor no pudo analizar la foto (${res.status}).`);
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw new ServerBusy("El servidor está ocupado. Intenta de nuevo en un momento.");
}

async function embedLocally(input: Blob): Promise<number[]> {
  const run = await embedder();
  return run(input);
}

function withPatience<T>(work: Promise<T>, ms: number): Promise<T | "late"> {
  return Promise.race([work, new Promise<"late">((r) => window.setTimeout(() => r("late"), ms))]);
}

/** Qué motor conviene para esta foto. */
export async function pickEngine(purpose: EmbedPurpose): Promise<EmbedEngine> {
  const p = deviceProfile();
  if (!p.localPossible || p.forcedLite || p.weak) return "server";
  if (localReady) return "local";
  // Analizar las fotos del catálogo: en un equipo bueno conviene descargar el modelo una vez (no gasta servidor).
  if (purpose === "index") return "local";
  return (await localModelCached()) ? "local" : "server";
}

/**
 * Huella de una foto (cámara, galería o foto de producto). Escoge el motor y, si uno falla, usa el otro.
 * `input` puede ser la foto original o la ya preparada con prepareModelInput.
 */
export async function embedPhoto(blob: Blob, purpose: EmbedPurpose = "search"): Promise<{ embedding: number[]; engine: EmbedEngine }> {
  const input = await prepareModelInput(blob);
  const p = deviceProfile();
  const first = await pickEngine(purpose);

  if (first === "server") {
    try {
      const embedding = await embedOnServer(input, purpose);
      // Celular bueno sin el modelo: se descarga ahora, sin afán, para que la próxima vez no dependa del servidor.
      if (purpose === "search" && p.localPossible && !p.weak && !p.forcedLite && !p.saveData && !p.slowNet) warmUpImageSearch({ evenOnPhone: true });
      return { embedding, engine: "server" };
    } catch (error) {
      if (error instanceof ServerBusy || !p.localPossible || p.weak) throw error;
      return { embedding: await embedLocally(input), engine: "local" };
    }
  }

  try {
    const work = embedLocally(input);
    // Analizando fotos del catálogo no hay afán; buscando, sí.
    const result = purpose === "search" ? await withPatience(work, LOCAL_PATIENCE_MS) : await work;
    if (result !== "late") return { embedding: result, engine: "local" };
    work.catch(() => {});
    return { embedding: await embedOnServer(input, purpose), engine: "server" };
  } catch {
    return { embedding: await embedOnServer(input, purpose), engine: "server" };
  }
}

/** Compatibilidad: solo la huella. */
export async function embedImageBlob(blob: Blob) {
  return (await embedPhoto(blob)).embedding;
}

/** Descarga una imagen publicada (foto del producto). Lanza error si no se puede. */
export async function fetchImageBlob(url: string) {
  const res = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.startsWith("image/")) throw new Error("El enlace no es una imagen.");
  return res.blob();
}

/** El navegador puede buscar por foto (con el modo liviano basta un lienzo; ya no hace falta WebAssembly). */
export function imageSearchSupported() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof HTMLCanvasElement !== "undefined" && typeof fetch === "function";
}
