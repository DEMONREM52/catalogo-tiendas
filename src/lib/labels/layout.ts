/**
 * Papel: cómo van las etiquetas en el rollo o la hoja, y el documento que se imprime.
 *
 * Rollo («roll»): cada FILA de etiquetas es una página del controlador (p. ej. 102 × 25 mm con 3 columnas
 * de 31 × 25 mm); la separación entre filas la pone la impresora con su sensor de espacios.
 * Hoja («sheet»): carta, A4 o adhesivas, con filas y columnas dentro de la hoja.
 */
import { MONO_DEFS, renderLabel, type ElementIssue, type RenderInput } from "./render";
import { round2, snapMm, type PrinterProfile } from "./types";

/** Perfil inicial: STARPOS STAR-iF4 a 203 dpi, rollo de 102 mm con 3 etiquetas de 31 × 25 mm. Editable. */
export const STARPOS_IF4: PrinterProfile = {
  name: "STARPOS iF4 · 3 × 31×25 mm",
  brand: "STARPOS", model: "STAR-iF4", dpi: 203, method: "driver", language: "zpl", connection: "usb", media: "gap",
  mode: "roll", pageW: 102, pageH: 25, labelW: 31, labelH: 25, cols: 3, gapX: 2, gapY: 2,
  marginLeft: 2.5, marginRight: 2.5, marginTop: 0, marginBottom: 0, offsetX: 0, offsetY: 0,
  speed: "Baja", density: "≈60 % en el controlador", output: "Arrancar (Tear Off)",
  notes: "Márgenes y separaciones aproximados: calíbralos con la hoja de prueba.",
};

export const PROFILE_PRESETS: Array<{ key: string; label: string; profile: PrinterProfile }> = [
  { key: "starpos", label: "STARPOS iF4 · rollo 102 mm, 3 × 31×25", profile: STARPOS_IF4 },
  { key: "r50x25", label: "Rollo de 1 columna 50×25 mm", profile: { ...STARPOS_IF4, name: "Rollo 50×25 mm", brand: "", model: "", pageW: 50, labelW: 50, labelH: 25, pageH: 25, cols: 1, gapX: 0, marginLeft: 0, marginRight: 0, notes: "" } },
  { key: "r2x50x30", label: "Rollo de 2 columnas 50×30 mm", profile: { ...STARPOS_IF4, name: "Rollo 2 × 50×30 mm", brand: "", model: "", pageW: 104, labelW: 50, labelH: 30, pageH: 30, cols: 2, gapX: 2, marginLeft: 1, marginRight: 1, notes: "" } },
  { key: "carta", label: "Hoja carta adhesiva (3 × 10, 66,7×25,4 mm)", profile: { ...STARPOS_IF4, name: "Hoja carta 3 × 10", brand: "", model: "", dpi: 300, language: "otro", media: "sheet", mode: "sheet", pageW: 215.9, pageH: 279.4, labelW: 66.7, labelH: 25.4, cols: 3, gapX: 3.2, gapY: 0, marginLeft: 4.8, marginRight: 4.8, marginTop: 12.7, marginBottom: 12.7, speed: "", density: "", output: "", notes: "" } },
  { key: "a4", label: "Hoja A4 adhesiva (3 × 8, 70×37 mm)", profile: { ...STARPOS_IF4, name: "Hoja A4 3 × 8", brand: "", model: "", dpi: 300, language: "otro", media: "sheet", mode: "sheet", pageW: 210, pageH: 297, labelW: 70, labelH: 37, cols: 3, gapX: 0, gapY: 0, marginLeft: 0, marginRight: 0, marginTop: 0.5, marginBottom: 0.5, speed: "", density: "", output: "", notes: "" } },
];

export type ProfileIssue = { level: "error" | "warn"; message: string };

const num = (v: unknown, d: number, min: number, max: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d;
};

/** Limpia un perfil que viene de la base o de un archivo (nunca confía en lo que trae). */
export function normalizeProfile(raw: unknown): PrinterProfile {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<PrinterProfile>;
  const s = (v: unknown, d: string, max = 80) => (typeof v === "string" ? v.slice(0, max) : d);
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T) => (list.includes(v as T) ? (v as T) : d);
  const b = STARPOS_IF4;
  const mode = pick(p.mode, ["roll", "sheet"] as const, b.mode);
  const labelH = num(p.labelH, b.labelH, 5, 500);
  return {
    id: typeof p.id === "string" ? p.id : undefined,
    name: s(p.name, "Mi impresora") || "Mi impresora",
    brand: s(p.brand, ""), model: s(p.model, ""),
    dpi: num(p.dpi, 203, 100, 1200),
    method: "driver",
    language: pick(p.language, ["zpl", "tspl", "epl", "escpos", "otro"] as const, "otro"),
    connection: pick(p.connection, ["usb", "red", "bluetooth", "serial"] as const, "usb"),
    media: pick(p.media, ["gap", "continuous", "blackmark", "sheet"] as const, "gap"),
    mode,
    pageW: num(p.pageW, b.pageW, 10, 500),
    pageH: mode === "sheet" ? num(p.pageH, 279.4, 10, 1000) : labelH,
    labelW: num(p.labelW, b.labelW, 5, 500),
    labelH,
    cols: Math.round(num(p.cols, 1, 1, 20)),
    gapX: num(p.gapX, 0, 0, 100), gapY: num(p.gapY, 0, 0, 100),
    marginLeft: num(p.marginLeft, 0, 0, 100), marginRight: num(p.marginRight, 0, 0, 100),
    marginTop: num(p.marginTop, 0, 0, 100), marginBottom: num(p.marginBottom, 0, 0, 100),
    offsetX: num(p.offsetX, 0, -20, 20), offsetY: num(p.offsetY, 0, -20, 20),
    speed: s(p.speed, ""), density: s(p.density, ""), output: s(p.output, ""), notes: s(p.notes, "", 500),
  };
}

/** Filas por página: 1 en rollo; en hoja, las que caben. */
export function rowsPerPage(p: PrinterProfile) {
  if (p.mode === "roll") return 1;
  return Math.max(1, Math.floor((p.pageH - p.marginTop - p.marginBottom + p.gapY + 1e-6) / (p.labelH + p.gapY)));
}
export const perPage = (p: PrinterProfile) => p.cols * rowsPerPage(p);
export const pageHeight = (p: PrinterProfile) => (p.mode === "roll" ? p.marginTop + p.labelH + p.marginBottom : p.pageH);

/** ¿El papel tiene sentido físico? (no confunde el ancho del rollo con el de una etiqueta). */
export function validateProfile(p: PrinterProfile): ProfileIssue[] {
  const out: ProfileIssue[] = [];
  const used = p.marginLeft + p.cols * p.labelW + (p.cols - 1) * p.gapX + p.marginRight;
  if (used > p.pageW + 0.3) {
    out.push({ level: "error", message: `No cabe a lo ancho: ${round2(p.marginLeft)} + ${p.cols} × ${round2(p.labelW)} + ${p.cols - 1} × ${round2(p.gapX)} + ${round2(p.marginRight)} = ${round2(used)} mm y el ${p.mode === "roll" ? "rollo" : "papel"} mide ${round2(p.pageW)} mm.` });
  } else if (p.pageW - used > 3) {
    out.push({ level: "warn", message: `Sobran ${round2(p.pageW - used)} mm a lo ancho: revisa márgenes y separaciones (o calibra).` });
  }
  if (p.mode === "sheet") {
    const rows = rowsPerPage(p);
    const usedH = p.marginTop + rows * p.labelH + (rows - 1) * p.gapY + p.marginBottom;
    if (usedH > p.pageH + 0.3) out.push({ level: "error", message: `No cabe a lo alto: ${round2(usedH)} mm en una hoja de ${round2(p.pageH)} mm.` });
  }
  if (p.cols > 1 && p.gapX === 0 && p.mode === "roll") out.push({ level: "warn", message: "Varias columnas sin separación: revisa la medida real entre etiquetas." });
  return out;
}

/** Dónde empieza cada posición de la página (mm), con la calibración sumada. */
export function cellOrigins(p: PrinterProfile): Array<{ x: number; y: number }> {
  const rows = rowsPerPage(p);
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      out.push({ x: p.marginLeft + c * (p.labelW + p.gapX) + p.offsetX, y: p.marginTop + r * (p.labelH + p.gapY) + p.offsetY });
    }
  }
  return out;
}

/**
 * Reparte las etiquetas en páginas (filas en rollo). `start` deja vacías las primeras posiciones
 * (para aprovechar una hoja o fila ya usada). Las posiciones vacías quedan en null.
 */
export function paginate<T>(items: T[], p: PrinterProfile, start = 0): Array<Array<T | null>> {
  const size = perPage(p);
  const skip = Math.max(0, Math.min(size - 1, Math.floor(start)));
  const cells: Array<T | null> = [...Array.from({ length: skip }, () => null), ...items];
  const pages: Array<Array<T | null>> = [];
  for (let i = 0; i < cells.length; i += size) {
    const page = cells.slice(i, i + size);
    while (page.length < size) page.push(null);
    pages.push(page);
  }
  return pages;
}

export type JobLabel = { input: RenderInput; key: string };

/**
 * El documento que se imprime: páginas del tamaño exacto del papel (@page), cada etiqueta en su posición
 * en mm, sin márgenes del navegador. Se imprime con la ventana del sistema (controlador de la impresora).
 */
export function printDocument(pages: Array<Array<JobLabel | null>>, p: PrinterProfile, title = "Etiquetas"): { html: string; issues: ElementIssue[] } {
  const origins = cellOrigins(p);
  const ph = pageHeight(p);
  const issues: ElementIssue[] = [];
  const parts: string[] = [];
  // Etiquetas iguales (misma clave) se dibujan una sola vez: 500 copias de un producto no cuestan 500 veces.
  const cache = new Map<string, ReturnType<typeof renderLabel>>();
  for (const page of pages) {
    let cells = "";
    page.forEach((lbl, i) => {
      if (!lbl) return;
      const o = origins[i];
      let r = cache.get(lbl.key);
      if (!r) {
        r = renderLabel(lbl.input);
        cache.set(lbl.key, r);
        issues.push(...r.issues);
      }
      const { w, h } = lbl.input.design;
      const x = snapMm(o.x, p.dpi), y = snapMm(o.y, p.dpi);
      cells += `<svg class="c" style="left:${Math.round(x * 10000) / 10000}mm;top:${Math.round(y * 10000) / 10000}mm" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" overflow="hidden">${r.body}</svg>`;
    });
    parts.push(`<div class="p">${cells}</div>`);
  }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, "")}</title><style>
@page{size:${p.pageW}mm ${ph}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
.p{position:relative;width:${p.pageW}mm;height:${ph}mm;overflow:hidden;break-after:page;page-break-after:always}
.p:last-child{break-after:auto;page-break-after:auto}
.c{position:absolute;display:block}
@media screen{body{background:#e5e7eb;padding:8px}.p{background:#fff;margin:0 auto 6px;box-shadow:0 1px 3px rgba(0,0,0,.2)}}
</style></head><body><svg width="0" height="0" style="position:absolute">${MONO_DEFS}</svg>${parts.join("")}<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250);};</script></body></html>`;
  return { html, issues };
}
