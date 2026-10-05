export const MAX_INVOICE_EDGE = 1600;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Reduce el tamaño de una imagen (máx. 1600 px por lado) y la recomprime. */
export async function compressImage(file: Blob, maxEdge = MAX_INVOICE_EDGE, quality = 0.72): Promise<{ blob: Blob; width: number; height: number; type: string }> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no permite procesar imágenes.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return { blob: webp, width, height, type: "image/webp" };
  const jpeg = await toBlob(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error("No se pudo comprimir la imagen.");
  return { blob: jpeg, width, height, type: "image/jpeg" };
}

/** Une varias imágenes en un único PDF (una página por imagen, JPEG comprimido). */
export async function imagesToPdf(files: Blob[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: Uint8Array | string, dict?: string) => {
    offsets[id] = length;
    if (dict !== undefined) {
      const bytes = typeof body === "string" ? enc.encode(body) : body;
      push(`${id} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      push("\nendstream\nendobj\n");
    } else {
      push(`${id} 0 obj\n${body}\nendobj\n`);
    }
  };

  const pages: Array<{ jpeg: Uint8Array; w: number; h: number }> = [];
  for (const file of files) {
    const img = await loadImage(file);
    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d");
    if (!c) throw new Error("Tu navegador no permite procesar imágenes.");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, w, h);
    c.drawImage(img, 0, 0, w, h);
    const blob = await toBlob(canvas, "image/jpeg", 0.7);
    if (!blob) throw new Error("No se pudo comprimir la imagen.");
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w, h });
  }
  if (!pages.length) throw new Error("No hay imágenes para convertir.");

  push("%PDF-1.4\n");
  // 1 = catálogo, 2 = páginas; por página: página, contenido, imagen
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const base = 3 + i * 3;
    // Tamaño A4 en puntos (595 x 842) ajustando la imagen sin deformarla.
    const pw = 595;
    const ph = 842;
    const k = Math.min(pw / p.w, ph / p.h);
    const dw = Math.round(p.w * k);
    const dh = Math.round(p.h * k);
    const x = Math.round((pw - dw) / 2);
    const y = Math.round((ph - dh) / 2);
    object(base, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`);
    object(base + 1, `q ${dw} 0 0 ${dh} ${x} ${y} cm /Im0 Do Q`, "");
    object(base + 2, p.jpeg, `/Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`);
  });
  const total = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
