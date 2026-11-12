import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/**
 * Huella de una foto calculada en el servidor (para celulares que no pueden con el modelo).
 *
 * Es EL MISMO modelo que usa el navegador (MobileCLIP S0, versión fp16, de Xenova/mobileclip_s0) y el mismo
 * preparado (256×256 centrado, valores 0-1 sin normalizar), así que las huellas sirven contra las que ya están
 * guardadas (coinciden ≈ 0,99). El modelo se baja de Hugging Face la primera vez que arranca el servidor, en una
 * versión fija y con su huella SHA-256 comprobada; queda en memoria y en /tmp mientras la instancia viva.
 */

const MODEL_REVISION = "757d59c9c6870a76a4b0306f05f5061bca15c39f";
const MODEL_URL = `https://huggingface.co/Xenova/mobileclip_s0/resolve/${MODEL_REVISION}/onnx/vision_model_fp16.onnx`;
const MODEL_SHA256 = "22b1d36ecc6837e8205aee05003440a25e1c1ee0c7e2945dbb9dd597211c59dc";
const MODEL_FILE = path.join(os.tmpdir(), `mobileclip_s0_fp16_${MODEL_REVISION.slice(0, 8)}.onnx`);
const SIZE = 256;

type Ort = typeof import("onnxruntime-web");
type Session = Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;

let loading: Promise<{ ort: Ort; session: Session }> | null = null;
// Una foto a la vez por instancia: el motor usa un solo hilo y así no se dispara la memoria.
let queue: Promise<unknown> = Promise.resolve();

const sha256 = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");

async function modelBytes(): Promise<Uint8Array> {
  try {
    const cached = new Uint8Array(await fs.readFile(MODEL_FILE));
    if (sha256(cached) === MODEL_SHA256) return cached;
  } catch {
    /* todavía no está en /tmp */
  }
  const res = await fetch(MODEL_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo descargar el modelo (${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (sha256(buf) !== MODEL_SHA256) throw new Error("El modelo descargado no es el esperado.");
  await fs.writeFile(MODEL_FILE, buf).catch(() => {});
  return buf;
}

async function load() {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(await modelBytes(), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return { ort, session };
}

function engine() {
  if (!loading) {
    loading = load().catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/** Imagen (JPEG/PNG/WebP, cualquier tamaño) → 512 números normalizados con 5 decimales (igual que el navegador). */
export async function embedPhoto(image: Uint8Array): Promise<number[]> {
  const { data } = await sharp(image, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate()
    .removeAlpha()
    .resize(SIZE, SIZE, { fit: "cover", position: "centre", kernel: "linear" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = SIZE * SIZE;
  const pixels = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    pixels[i] = data[i * 3] / 255;
    pixels[plane + i] = data[i * 3 + 1] / 255;
    pixels[2 * plane + i] = data[i * 3 + 2] / 255;
  }
  const { ort, session } = await engine();
  const run = queue.then(() => session.run({ [session.inputNames[0]]: new ort.Tensor("float32", pixels, [1, 3, SIZE, SIZE]) }));
  queue = run.catch(() => undefined);
  const out = await run;
  const raw = out[session.outputNames[0]].data as Float32Array;
  let norm = 0;
  for (const x of raw) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Array.from(raw, (x) => Math.round((x / norm) * 1e5) / 1e5);
}
