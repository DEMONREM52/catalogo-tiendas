"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MONO_DEFS, renderLabel, type ElementIssue } from "@/lib/labels/render";
import { SAMPLE_DATA, type LabelData } from "@/lib/labels/data";
import { cellOrigins, pageHeight } from "@/lib/labels/layout";
import { canvasMeasure } from "@/lib/labels/measure-browser";
import type { LabelDesign, PrinterProfile } from "@/lib/labels/types";

/** Una etiqueta dibujada (el mismo SVG que se imprime). El SVG viene escapado del motor: no lleva HTML del usuario. */
export function LabelSvg({ design, data = SAMPLE_DATA, dpi = 203, images, className = "", style, outline = true }: {
  design: LabelDesign; data?: LabelData; dpi?: number; images?: { logo?: string | null; foto?: string | null };
  className?: string; style?: React.CSSProperties; outline?: boolean;
}) {
  const html = useMemo(() => {
    const r = renderLabel({ design, data, dpi, measure: canvasMeasure, images });
    const w = design.w, h = design.h;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" style="display:block">${MONO_DEFS}<rect width="${w}" height="${h}" fill="#fff"/>${r.body}${outline ? `<rect x="0.05" y="0.05" width="${w - 0.1}" height="${h - 0.1}" fill="none" stroke="#cbd5e1" stroke-width="0.12"/>` : ""}</svg>`;
  }, [design, data, dpi, images, outline]);
  return <div className={className} style={{ aspectRatio: `${design.w} / ${design.h}`, ...style }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Una página (o fila del rollo) como se imprime: papel, posiciones vacías y etiquetas en su lugar. */
export function PageSvg({ profile, cells, highlight }: { profile: PrinterProfile; cells: Array<{ body: string; w: number; h: number; bad?: boolean } | null>; highlight?: boolean }) {
  const origins = cellOrigins(profile);
  const ph = pageHeight(profile);
  const inner = cells.map((c, i) => {
    const o = origins[i];
    if (!o) return "";
    const slot = `<rect x="${o.x}" y="${o.y}" width="${profile.labelW}" height="${profile.labelH}" rx="0.8" fill="${c ? "#fff" : "#f1f5f9"}" stroke="${c?.bad ? "#ef4444" : "#cbd5e1"}" stroke-width="${c?.bad ? 0.4 : 0.15}" ${c ? "" : 'stroke-dasharray="0.8 0.6"'}/>`;
    return c ? `${slot}<svg x="${o.x}" y="${o.y}" width="${c.w}" height="${c.h}" viewBox="0 0 ${c.w} ${c.h}" overflow="hidden">${c.body}</svg>` : slot;
  }).join("");
  const html = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${profile.pageW} ${ph}" width="100%" style="display:block">${MONO_DEFS}<rect width="${profile.pageW}" height="${ph}" fill="${highlight ? "#e0e7ff" : "#e2e8f0"}"/>${inner}</svg>`;
  return <div className="overflow-hidden rounded-lg" style={{ boxShadow: "0 1px 4px rgba(0,0,0,.18)" }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Diagrama del papel con sus medidas (para configurar la impresora sin adivinar). */
export function PaperDiagram({ p }: { p: PrinterProfile }) {
  const ph = pageHeight(p);
  const origins = cellOrigins({ ...p, offsetX: 0, offsetY: 0 }).slice(0, p.cols * Math.min(3, p.mode === "roll" ? 1 : 99));
  const fs = Math.max(2.2, Math.min(4, p.pageW / 30));
  const html = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -${fs * 2.6} ${p.pageW + 4} ${Math.min(ph, p.labelH * 3 + p.marginTop + 2 * p.gapY) + fs * 3.6}" width="100%" style="display:block;font-family:Arial,sans-serif">
    <rect x="0" y="0" width="${p.pageW}" height="${Math.min(ph, p.labelH * 3 + p.marginTop + 2 * p.gapY)}" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.25"/>
    ${origins.map((o, i) => `<rect x="${o.x}" y="${o.y}" width="${p.labelW}" height="${p.labelH}" rx="0.8" fill="#fff" stroke="#8b5cf6" stroke-width="0.3"/><text x="${o.x + p.labelW / 2}" y="${o.y + p.labelH / 2 + fs / 3}" font-size="${fs}" text-anchor="middle" fill="#8b5cf6" font-weight="700">${i + 1}</text>`).join("")}
    <text x="${p.pageW / 2}" y="-${fs * 1.2}" font-size="${fs}" text-anchor="middle" fill="#475569">${p.mode === "roll" ? "Rollo" : "Hoja"} ${p.pageW} mm</text>
    <text x="${(origins[0]?.x ?? 0) + p.labelW / 2}" y="${(origins[0]?.y ?? 0) + p.labelH + fs * 1.3}" font-size="${fs * 0.85}" text-anchor="middle" fill="#475569">${p.labelW} × ${p.labelH} mm</text>
    ${p.marginLeft ? `<text x="${p.marginLeft / 2}" y="${(origins[0]?.y ?? 0) + p.labelH + fs * 1.3}" font-size="${fs * 0.75}" text-anchor="middle" fill="#94a3b8">${p.marginLeft}</text>` : ""}
    ${p.cols > 1 && p.gapX ? `<text x="${(origins[0]?.x ?? 0) + p.labelW + p.gapX / 2}" y="${(origins[0]?.y ?? 0) - 0.8}" font-size="${fs * 0.75}" text-anchor="middle" fill="#94a3b8">${p.gapX}</text>` : ""}
  </svg>`;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Campo numérico en mm (acepta coma decimal), con flechas de ±paso. */
export function MmField({ label, value, onChange, step = 0.1, min = -500, max = 1000, unit = "mm", disabled, title }: {
  label: ReactNode; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; disabled?: boolean; title?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(Math.round(value * 100) / 100).replace(".", ",");
  const commit = (raw: string) => {
    const v = Number(raw.replace(",", "."));
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
    setText(null);
  };
  return (
    <label className="block min-w-0 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }} title={title}>
      {label}
      <span className="mt-0.5 flex items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <input type="text" inputMode="decimal" disabled={disabled} value={shown}
          onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const v = value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
              setText(null);
            }
          }}
          className="h-8 w-full min-w-0 bg-transparent px-2 text-sm font-semibold normal-case tabular-nums outline-none" style={{ color: "var(--t-text)" }} />
        {unit ? <span className="pr-2 text-[10px] font-semibold normal-case">{unit}</span> : null}
      </span>
    </label>
  );
}

/** Lista de avisos de una etiqueta (errores en rojo bloquean la impresión). */
export function IssueList({ issues, max = 6 }: { issues: ElementIssue[]; max?: number }) {
  if (!issues.length) return null;
  const uniq = [...new Map(issues.map((i) => [`${i.level}|${i.elementName}|${i.message}`, i])).values()];
  return (
    <ul className="space-y-1 text-xs">
      {uniq.slice(0, max).map((i, k) => (
        <li key={k} className="rounded-lg border px-2 py-1" style={i.level === "error"
          ? { borderColor: "color-mix(in oklab, #ef4444 45%, transparent)", background: "color-mix(in oklab, #ef4444 9%, transparent)", color: "#f87171" }
          : { borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)", background: "color-mix(in oklab, #f59e0b 9%, transparent)", color: "#d97706" }}>
          {i.level === "error" ? "⛔" : "⚠️"} <b>{i.elementName}:</b> {i.message}
        </li>
      ))}
      {uniq.length > max ? <li style={{ color: "var(--t-muted)" }}>…y {uniq.length - max} aviso(s) más.</li> : null}
    </ul>
  );
}

export const segBtn = (on: boolean): React.CSSProperties => on
  ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" }
  : { borderColor: "var(--t-card-border)", color: "var(--t-text)" };
