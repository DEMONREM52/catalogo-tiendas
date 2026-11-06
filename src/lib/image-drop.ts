/**
 * Sacar una imagen de lo que se arrastró o se pegó: un archivo del computador, una captura copiada
 * o una foto arrastrada desde otra página (llega como enlace y se descarga si esa página lo permite).
 */

/** ¿Lo que se arrastra trae algo que puede ser una imagen (archivo o enlace)? */
export function dragHasImage(data: DataTransfer | null) {
  const types = Array.from(data?.types ?? []);
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html");
}

/** Primera imagen como archivo (portapapeles o arrastre). */
export function imageFileFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** Imagen arrastrada desde otra página: viene como enlace. Lanza error si esa página no deja descargarla. */
export async function imageFromDroppedUrl(data: DataTransfer | null): Promise<File | null> {
  const html = data?.getData("text/html") ?? "";
  const fromHtml = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1]?.replace(/&amp;/g, "&");
  const raw = fromHtml || (data?.getData("text/uri-list") ?? "").split(/\r?\n/).find((l) => l && !l.startsWith("#")) || "";
  if (!raw) return null;
  if (raw.startsWith("data:image/") || raw.startsWith("blob:")) {
    const blob = await (await fetch(raw)).blob();
    return new File([blob], "imagen", { type: blob.type || "image/png" });
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  const res = await fetch(raw, { mode: "cors" });
  if (!res.ok) throw new Error("no se pudo descargar");
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) return null;
  return new File([blob], "imagen", { type: blob.type });
}

/** Archivo o, si no hay, la imagen del enlace arrastrado. */
export async function imageFromDrop(data: DataTransfer | null): Promise<File | null> {
  return imageFileFrom(data) ?? (await imageFromDroppedUrl(data));
}

export const DROP_BLOCKED_MSG = "Esa página no deja copiar la foto arrastrándola. Usa clic derecho → «Copiar imagen» y pégala con Ctrl+V, o guárdala y elígela.";
