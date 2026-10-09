"use client";

/**
 * Lee el texto que aparece en una foto (códigos como «V322», marcas, nombres en la caja) con Tesseract
 * en el navegador. La librería y los idiomas (español + inglés, ~4 MB) se descargan solo la primera vez.
 */

const LIB_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js";

type Word = { text: string; confidence: number };
type Line = { words?: Word[] };
type Paragraph = { lines?: Line[] };
type Block = { paragraphs?: Paragraph[] };
type Result = { data: { text: string; blocks?: Block[] | null } };
type Worker = { recognize: (image: HTMLCanvasElement, opts?: object, output?: object) => Promise<Result> };
type Lib = { createWorker: (langs: string, oem?: number, opts?: object) => Promise<Worker> };

let worker: Promise<Worker> | null = null;

function getWorker() {
  if (!worker) {
    worker = (async () => {
      const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ LIB_URL)) as Lib & { default?: Lib };
      const lib = mod.default ?? mod;
      return lib.createWorker("spa+eng", 1);
    })().catch((error) => {
      worker = null;
      throw error;
    });
  }
  return worker;
}

/** Descarga el lector en segundo plano (al abrir el modo foto). */
export function warmUpOcr() {
  void getWorker().catch(() => {});
}

// Foto en grises, a un tamaño cómodo para leer (las letras pequeñas se agrandan); invert = letras claras sobre fondo oscuro.
async function prepare(blob: Blob, invert: boolean) {
  const bitmap = await createImageBitmap(blob);
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = longSide < 900 ? 900 / longSide : longSide > 1800 ? 1800 / longSide : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Sin lienzo.");
  ctx.filter = `grayscale(1) contrast(1.35)${invert ? " invert(1)" : ""}`;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

const STOP = new Set(["de", "del", "la", "las", "el", "los", "con", "para", "por", "una", "uno", "que", "sin", "the", "and", "for", "with", "made", "new"]);

/** Palabras confiables del texto leído: códigos (letras + números) y palabras de 3 letras o más. */
function words(result: Result): string[] {
  const out: string[] = [];
  for (const b of result.data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          const text = w.text.normalize("NFC").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
          if (!text) continue;
          const hasDigit = /\d/.test(text);
          const hasLetter = /\p{L}/u.test(text);
          const isCode = hasDigit && (hasLetter || text.length >= 3);
          // Los códigos se aceptan con menos confianza; las palabras necesitan ser claras.
          if (isCode ? w.confidence < 45 : w.confidence < 65) continue;
          if (!isCode && (text.length < 3 || !hasLetter || STOP.has(text.toLowerCase()))) continue;
          // Ruido típico: letras sueltas repetidas («lll», «iii»).
          if (!isCode && /^(.)\1+$/i.test(text)) continue;
          out.push(text.toUpperCase());
        }
      }
    }
  }
  return [...new Set(out)].slice(0, 12);
}

/** Lee el texto de la foto. Devuelve [] si no encuentra nada claro (o si el lector no se pudo cargar). */
export async function readPhotoText(blob: Blob): Promise<string[]> {
  try {
    const w = await getWorker();
    const normal = words(await w.recognize(await prepare(blob, false), {}, { blocks: true, text: true }));
    if (normal.length) return normal;
    // Letras claras sobre fondo oscuro (como una etiqueta negra con letras blancas).
    return words(await w.recognize(await prepare(blob, true), {}, { blocks: true, text: true }));
  } catch {
    return [];
  }
}
