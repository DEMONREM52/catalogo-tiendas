"use client";

import { useMemo } from "react";
import { labelSvg } from "@/lib/labels/render";
import { canvasMeasure } from "@/lib/labels/measure-browser";
import {
  DEFAULT_SEPARATORS, normalizeSeparators, separatorLabelDesign,
  type SeparatorMark, type SeparatorMode, type SeparatorSettings,
} from "@/lib/labels/separators";
import { segBtn } from "./parts";

const KEY = "remhub:labels:separadores";

/** Lo elegido se recuerda en este equipo (la impresora es de este equipo). */
export function loadSeparators(): SeparatorSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return normalizeSeparators(JSON.parse(raw));
    // Antes solo había «Separar productos» sí/no.
    if (window.localStorage.getItem("remhub:labels:separar") === "0") return { ...DEFAULT_SEPARATORS, on: false };
  } catch { /* sin almacenamiento */ }
  return DEFAULT_SEPARATORS;
}
export function saveSeparators(s: SeparatorSettings) {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}

const MODES: Array<{ id: SeparatorMode; label: string; hint: string }> = [
  { id: "fila+", label: "Fila completa", hint: "Completa la fila y deja filas enteras marcadas; el siguiente empieza en fila nueva." },
  { id: "fila", label: "Solo completar", hint: "Completa la fila marcada y el siguiente empieza en fila nueva." },
  { id: "una", label: "Una etiqueta", hint: "Una sola etiqueta marcada entre productos." },
];
const MARKS: Array<{ id: SeparatorMark; label: string }> = [
  { id: "franja", label: "Franja" },
  { id: "doble", label: "Doble" },
  { id: "cortada", label: "Cortada" },
  { id: "recuadro", label: "Recuadro" },
  { id: "equis", label: "Equis" },
  { id: "llena", label: "Llena" },
];

function Mini({ w, h, s, label }: { w: number; h: number; s: SeparatorSettings; label?: string }) {
  const svg = useMemo(() => labelSvg({ design: separatorLabelDesign(w, h, s, label), data: {}, dpi: 203, measure: canvasMeasure }, { outline: true }).svg
    .replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%" height="100%"'), [w, h, s, label]);
  return <span className="block aspect-[31/25] w-full overflow-hidden rounded-md" style={{ aspectRatio: `${w} / ${h}` }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function SeparatorPanel({ value, onChange, w, h, cols, count }: {
  value: SeparatorSettings;
  onChange: (s: SeparatorSettings) => void;
  w: number;
  h: number;
  cols: number;
  /** Separadores que lleva esta impresión. */
  count: number;
}) {
  const set = (p: Partial<SeparatorSettings>) => onChange(normalizeSeparators({ ...value, ...p }));
  const s = value;
  const lab = "text-[11px] font-bold";
  return (
    <div className="rounded-xl border p-3 text-xs" style={s.on ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 6%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
      <button type="button" onClick={() => set({ on: !s.on })} className="flex w-full items-center gap-2 text-left">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border font-black" style={s.on ? { background: "var(--t-accent)", borderColor: "var(--t-accent)", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>{s.on ? "✓" : ""}</span>
        <span className="min-w-0 flex-1"><b>Separar productos</b>{" "}
          <span style={{ color: "var(--t-muted)" }}>— para ver dónde termina uno y empieza el otro{s.on && count ? ` · ${count} separador${count === 1 ? "" : "es"}` : ""}</span>
        </span>
      </button>

      {s.on ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px]">
          <div className="space-y-3">
            <div>
              <p className={lab} style={{ color: "var(--t-muted)" }}>Cómo separa</p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {MODES.map((m) => (
                  <button key={m.id} type="button" title={m.hint} onClick={() => set({ mode: m.id })} className="rounded-lg border px-2 py-1.5 font-bold" style={segBtn(s.mode === m.id)}>{m.label}</button>
                ))}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{MODES.find((m) => m.id === s.mode)?.hint}{cols === 1 && s.mode !== "una" ? " (Tu papel es de 1 por fila: cada fila es una etiqueta.)" : ""}</p>
            </div>

            {s.mode === "fila+" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className={lab} style={{ color: "var(--t-muted)" }}>Filas enteras en blanco</span>
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" onClick={() => set({ rows: n })} className="h-7 w-8 rounded-lg border font-bold" style={segBtn(s.rows === n)}>{n}</button>
                ))}
              </div>
            ) : null}

            <div>
              <p className={lab} style={{ color: "var(--t-muted)" }}>Marca</p>
              <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {MARKS.map((m) => (
                  <button key={m.id} type="button" onClick={() => set({ mark: m.id })} className="rounded-lg border p-1 text-[10px] font-bold" style={segBtn(s.mark === m.id)}>
                    <Mini w={w} h={h} s={{ ...s, mark: m.id, text: "ninguno" }} />
                    <span className="mt-0.5 block">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {s.mark !== "llena" ? (
              <label className="flex items-center gap-2">
                <span className={lab} style={{ color: "var(--t-muted)" }}>Grosor</span>
                <input type="range" min={1} max={8} step={0.5} value={s.thickness} onChange={(e) => set({ thickness: Number(e.target.value) })} className="min-w-0 flex-1" style={{ accentColor: "var(--t-accent)" }} />
                <span className="w-12 text-right font-bold">{s.thickness.toLocaleString("es-CO")} mm</span>
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className={lab} style={{ color: "var(--t-muted)" }}>Texto</span>
              <button type="button" onClick={() => set({ text: "ninguno" })} className="rounded-lg border px-2 py-1 font-bold" style={segBtn(s.text === "ninguno")}>Sin texto</button>
              <button type="button" onClick={() => set({ text: "nombres" })} disabled={s.mark === "llena"} className="rounded-lg border px-2 py-1 font-bold disabled:opacity-40" style={segBtn(s.text === "nombres")}>«FIN» y «SIGUE» con el nombre</button>
            </div>
            <button type="button" onClick={() => onChange({ ...DEFAULT_SEPARATORS, on: true })} className="text-[11px] font-bold underline" style={{ color: "var(--t-muted)" }}>Volver a lo recomendado</button>
          </div>

          <div>
            <p className={lab} style={{ color: "var(--t-muted)" }}>Así sale</p>
            <div className="mt-1 grid grid-cols-2 gap-1.5 rounded-lg p-1.5" style={{ background: "#e2e8f0" }}>
              <Mini w={w} h={h} s={s} label={s.mode === "una" ? "SIGUE · MAQUINA PATILLERA WB 999" : "FIN · RELOJ EN COMBO K41"} />
              <Mini w={w} h={h} s={s} label="SIGUE · MAQUINA PATILLERA WB 999" />
            </div>
            <p className="mt-1 text-[10px]" style={{ color: "var(--t-muted)" }}>Se recuerda en este equipo. En la vista previa de abajo ves cómo quedan en el rollo.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
