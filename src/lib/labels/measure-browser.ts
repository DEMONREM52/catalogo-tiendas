"use client";

import { FONT_FAMILY, approxMeasure, type Measure } from "./text-fit";
import { MM_PER_PT } from "./types";

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

/**
 * Ancho real del texto con la misma letra que usa la impresión (la del sistema de este equipo).
 * Se mide a 100 px y se lleva a mm; sin lienzo (servidor), una tabla aproximada.
 */
export const canvasMeasure: Measure = (text, f, ls) => {
  if (typeof document === "undefined") return approxMeasure(text, f, ls);
  if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return approxMeasure(text, f, ls);
  const key = `${f.font}|${f.bold ? 1 : 0}|${f.italic ? 1 : 0}|${text}`;
  let em = cache.get(key);
  if (em === undefined) {
    ctx.font = `${f.italic ? "italic " : ""}${f.bold ? 700 : 400} 100px ${FONT_FAMILY[f.font]}`;
    em = ctx.measureText(text).width / 100;
    if (cache.size > 20000) cache.clear();
    cache.set(key, em);
  }
  return em * f.size * MM_PER_PT + Math.max(0, [...text].length - 1) * ls;
};
