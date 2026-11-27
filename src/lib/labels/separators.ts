/**
 * Separadores entre productos al imprimir etiquetas (2026-11-27).
 *
 * Como lo dibujó el usuario: cuando termina un producto, lo que queda de esa fila sale en blanco con la marca,
 * después una fila completa marcada, y el siguiente producto empieza en una fila nueva.
 * Todo se puede ajustar: cómo separa, cuántas filas, la marca, el grosor y un texto opcional.
 */
import { LABEL_FORMAT_VERSION, type LabelDesign, type LabelElement } from "./types";
import { newLine, newRect, newText } from "./templates";

/** «una»: una sola etiqueta separadora · «fila»: completa la fila · «fila+»: completa la fila y deja filas enteras marcadas. */
export type SeparatorMode = "una" | "fila" | "fila+";
/** Marca: franja, doble franja, franja cortada, recuadro, equis o etiqueta llena. */
export type SeparatorMark = "franja" | "doble" | "cortada" | "recuadro" | "equis" | "llena";
/** Texto: ninguno, o «FIN · producto» en lo que completa la fila y «SIGUE · producto» en la fila entera. */
export type SeparatorText = "ninguno" | "nombres";

export type SeparatorSettings = {
  on: boolean;
  mode: SeparatorMode;
  /** Filas enteras marcadas después de completar la fila (modo «fila+»): 1 a 3. */
  rows: number;
  mark: SeparatorMark;
  /** Grosor de la marca en mm (1 a 8). */
  thickness: number;
  text: SeparatorText;
};

export const DEFAULT_SEPARATORS: SeparatorSettings = { on: true, mode: "fila+", rows: 1, mark: "franja", thickness: 3.5, text: "ninguno" };

const MODES: SeparatorMode[] = ["una", "fila", "fila+"];
const MARKS: SeparatorMark[] = ["franja", "doble", "cortada", "recuadro", "equis", "llena"];
const TEXTS: SeparatorText[] = ["ninguno", "nombres"];

/** Lo guardado (en el equipo) puede venir viejo o roto: siempre se limpia. */
export function normalizeSeparators(raw: unknown): SeparatorSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SEPARATORS;
  const n = Number(o.thickness);
  const rows = Math.round(Number(o.rows));
  return {
    on: typeof o.on === "boolean" ? o.on : d.on,
    mode: MODES.includes(o.mode as SeparatorMode) ? (o.mode as SeparatorMode) : d.mode,
    rows: Number.isFinite(rows) ? Math.min(3, Math.max(1, rows)) : d.rows,
    mark: MARKS.includes(o.mark as SeparatorMark) ? (o.mark as SeparatorMark) : d.mark,
    thickness: Number.isFinite(n) ? Math.min(8, Math.max(1, Math.round(n * 2) / 2)) : d.thickness,
    text: TEXTS.includes(o.text as SeparatorText) ? (o.text as SeparatorText) : d.text,
  };
}

export type SeparatorSlot = {
  /** «fin»: completa la fila del producto que terminó · «fila»: fila entera · «una»: etiqueta suelta. */
  kind: "fin" | "fila" | "una";
  /** Índices del grupo que termina y del que sigue. */
  after: number;
  before: number;
};

/**
 * Ordena las etiquetas con sus separadores.
 * `start` es la posición donde empieza la impresión (para contar bien las filas); `cols` las etiquetas por fila.
 * Siempre queda al menos un separador entre dos productos, aunque el primero termine justo al final de la fila.
 */
export function arrangeWithSeparators<T, S>(
  groups: T[][],
  s: SeparatorSettings,
  cols: number,
  start: number,
  makeSep: (slot: SeparatorSlot) => S,
  max = Infinity,
): Array<T | S> {
  const out: Array<T | S> = [];
  const c = Math.max(1, Math.floor(cols));
  const groupsWithItems = groups.filter((g) => g.length);
  for (const [gi, g] of groupsWithItems.entries()) {
    if (gi > 0 && s.on) {
      const slot = (kind: SeparatorSlot["kind"]) => makeSep({ kind, after: gi - 1, before: gi });
      if (s.mode === "una") {
        out.push(slot("una"));
      } else {
        const pad = (c - ((start + out.length) % c)) % c;
        for (let k = 0; k < pad; k++) out.push(slot("fin"));
        // «fila»: si el producto terminó justo al final de la fila, igual va una fila marcada.
        const rows = s.mode === "fila+" ? s.rows : pad === 0 ? 1 : 0;
        for (let k = 0; k < rows * c; k++) out.push(slot("fila"));
      }
    }
    for (const item of g) out.push(item);
    if (out.length >= max) return out.slice(0, max);
  }
  return out;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** La etiqueta separadora, del tamaño de la plantilla. `label` es el texto opcional («FIN · …» o «SIGUE · …»). */
export function separatorLabelDesign(w: number, h: number, s: SeparatorSettings, label?: string): LabelDesign {
  const t = Math.min(s.thickness, h / 2);
  const els: LabelElement[] = [];
  const hasText = Boolean(label && s.text !== "ninguno" && s.mark !== "llena");
  // Con texto, la marca sube un poco para dejar el texto abajo.
  const cy = hasText ? h * 0.4 : h / 2;
  const bar = (y: number, hh: number, x = 0, ww = w) => newRect({ id: `s${els.length}`, x: r2(x), y: r2(y), w: r2(ww), h: r2(hh), stroke: 0, fill: "#000000", radius: 0 });
  switch (s.mark) {
    case "franja":
      els.push(bar(cy - t / 2, t));
      break;
    case "doble": {
      const gap = Math.max(1, t * 0.6);
      els.push(bar(cy - gap / 2 - t, t), bar(cy + gap / 2, t));
      break;
    }
    case "cortada": {
      const seg = Math.max(3, w / 7);
      for (let x = 0; x < w; x += seg * 1.6) els.push(bar(cy - t / 2, t, x, Math.min(seg, w - x)));
      break;
    }
    case "recuadro":
      els.push(newRect({ id: "s0", x: r2(t / 2), y: r2(t / 2), w: r2(w - t), h: r2(h - t), stroke: r2(t), strokeColor: "#000000", fill: null, radius: 0 }));
      break;
    case "equis":
      els.push(
        newLine({ id: "s0", x: 0, y: 0, w: r2(w), h: r2(h), stroke: r2(t), color: "#000000" }),
        newLine({ id: "s1", x: 0, y: r2(h), w: r2(w), h: r2(-h), stroke: r2(t), color: "#000000" }),
      );
      break;
    case "llena":
      els.push(bar(0, h));
      break;
  }
  if (hasText && label) {
    const top = s.mark === "recuadro" ? h * 0.55 : cy + t / 2 + (s.mark === "doble" ? t + 1 : 0.8);
    const y = Math.min(top, h - 5);
    els.push(newText({
      id: "stxt", x: r2(s.mark === "recuadro" ? t + 0.8 : 1), y: r2(y), w: r2(s.mark === "recuadro" ? w - 2 * t - 1.6 : w - 2), h: r2(Math.max(4, h - y - (s.mark === "recuadro" ? t + 0.6 : 0.8))),
      content: label.replace(/[{}]/g, ""), size: 7, minSize: 4, maxLines: 2, bold: true, transform: "upper",
      // Fondo blanco: en la «equis» las líneas pasan por debajo del texto y se sigue leyendo.
      background: "#ffffff",
    }));
  }
  return { v: LABEL_FORMAT_VERSION, w, h, elements: els };
}

/** El texto de cada separador según el modo de texto. */
export function separatorLabelText(s: SeparatorSettings, slot: SeparatorSlot, names: string[]): string | undefined {
  if (s.text === "ninguno") return undefined;
  if (slot.kind === "fin") return `FIN · ${names[slot.after] ?? ""}`;
  return `SIGUE · ${names[slot.before] ?? ""}`;
}
