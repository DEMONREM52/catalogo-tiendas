"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { GalleryEditor } from "./GalleryEditor";
import { RichTextEditor } from "@/components/forms/RichTextEditor";
import { getYoutubeThumbnailUrl, isSafeHttpUrl, type ProductDetails } from "@/lib/product-details";

type Props = {
  details: ProductDetails;
  onChange: (details: ProductDetails) => void;
  userId: string | null;
  productId?: string;
};

const textStyle: React.CSSProperties = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
  color: "var(--t-text)",
};
const muted = { color: "var(--t-muted)" } as const;

/** Sugerencias de características: se tocan para agregar o quitar (varias a la vez). */
const HIGHLIGHT_GROUPS: Array<[string, string[]]> = [
  ["Calidad", ["✨ Producto original", "💎 Materiales de alta calidad", "💪 Resistente y duradero", "🧵 Excelentes acabados", "🌿 Materiales amigables"]],
  ["Uso", ["👌 Fácil de usar", "🧼 Fácil de limpiar", "🎒 Liviano y fácil de llevar", "🏠 Ideal para el día a día", "🎁 Ideal para regalar"]],
  ["Tecnología", ["🔋 Batería de larga duración", "⚡ Carga rápida", "📶 Conexión inalámbrica", "💧 Resistente al agua", "🔊 Sonido potente", "📱 Compatible con Android y iPhone"]],
  ["Moda", ["📏 Varias tallas", "🎨 Varios colores", "🧘 Cómodo todo el día", "👗 Se adapta a tu figura", "❄️ Tela fresca"]],
  ["Compra", ["🛡️ Garantía", "📦 Incluye estuche", "🔌 Incluye cable de carga", "🚚 Envío a toda Colombia", "💵 Paga al recibir"]],
];

/** Íconos para cada característica. */
const ICONS = ["✨", "✅", "🔥", "💎", "💪", "👌", "🎁", "🛡️", "📦", "🚚", "💵", "🔋", "⚡", "📶", "💧", "🔊", "📱", "🎧", "💻", "⌚", "📏", "🎨", "🧘", "👗", "👟", "👜", "💄", "🌿", "🧼", "🏠", "🍳", "🧸", "🐾", "🌟", "❤️", "🏅", "⏱️", "🔒", "🌍", "🆕"];

/** Nombres frecuentes de especificaciones (un toque agrega la fila). */
const SPEC_NAMES: Array<[string, string]> = [
  ["🎨", "Color"], ["📏", "Talla"], ["🧵", "Material"], ["🏷️", "Marca"], ["🔢", "Modelo"], ["⚖️", "Peso"], ["📐", "Medidas"],
  ["📦", "Contenido"], ["🛡️", "Garantía"], ["🔋", "Batería"], ["📶", "Conectividad"], ["📱", "Compatibilidad"], ["🌍", "Origen"], ["🧴", "Cuidados"],
];

const DESC_STARTERS = ["¿Por qué te va a encantar? ", "✅ Ideal para ", "Incluye: ", "Modo de uso: ", "Cuidados: "];

/** Separa el ícono del inicio del texto («🔋 Batería…» → ["🔋", "Batería…"]). */
function splitIcon(text: string): [string, string] {
  const m = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u.exec(text);
  return m ? [m[1], m[2]] : ["", text];
}

function Box({ icon, title, hint, children, right }: { icon: string; title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-2xl border p-4" style={textStyle}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }}>{icon}</span>
          <div className="min-w-0"><p className="text-sm font-bold">{title}</p>{hint ? <p className="text-xs" style={muted}>{hint}</p> : null}</div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function IconButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="grid h-10 w-10 place-items-center rounded-xl border text-xl transition hover:scale-105" style={{ ...textStyle, borderColor: open ? "var(--t-accent)" : "var(--t-card-border)" }} title="Cambiar ícono">{value || "➕"}</button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 grid w-64 grid-cols-8 gap-1 rounded-2xl border p-2 shadow-2xl" style={{ ...textStyle, background: "var(--t-bg-base)" }}>
          <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="col-span-8 mb-1 rounded-lg border py-1 text-[11px] font-semibold" style={textStyle}>Sin ícono</button>
          {ICONS.map((ic) => (
            <button key={ic} type="button" onClick={() => { onChange(ic); setOpen(false); }} className="grid aspect-square place-items-center rounded-lg text-lg hover:scale-110" style={{ background: value === ic ? "color-mix(in oklab, var(--t-accent) 25%, transparent)" : undefined }}>{ic}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VideoField({ label, icon, value, onChange, hint }: { label: string; icon: string; value: string; onChange: (v: string) => void; hint: string }) {
  const thumb = value ? getYoutubeThumbnailUrl(value) : null;
  const bad = Boolean(value.trim()) && !isSafeHttpUrl(value.trim());
  return (
    <div className="rounded-2xl border p-3" style={textStyle}>
      <p className="flex items-center gap-2 text-sm font-bold"><span className="text-lg">{icon}</span>{label}</p>
      <p className="mb-2 text-xs" style={muted}>{hint}</p>
      <div className="flex items-center gap-2">
        <input className="w-full rounded-xl border p-2.5 text-sm outline-none" style={{ ...textStyle, borderColor: bad ? "rgba(239,68,68,.7)" : "var(--t-card-border)" }} type="url" inputMode="url" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="https://youtube.com/…" />
        {value ? <button type="button" onClick={() => onChange("")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border" style={textStyle} title="Quitar"><X size={15} /></button> : null}
      </div>
      {bad ? <p className="mt-1 text-xs font-semibold text-red-500">Ese enlace no se ve bien: debe empezar por https://</p> : null}
      {thumb ? (
        <a href={value} target="_blank" rel="noopener noreferrer" className="relative mt-2 block overflow-hidden rounded-xl" style={{ aspectRatio: "16 / 9" }}>
          <img src={thumb} alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/25 text-4xl text-white">▶️</span>
        </a>
      ) : value && !bad ? <p className="mt-1 text-xs font-semibold" style={{ color: "#16a34a" }}>✅ Enlace listo</p> : null}
    </div>
  );
}

export default function ProductDetailsFields({ details, onChange, userId, productId }: Props) {
  const [uploadId] = useState(() => Math.random().toString(36).slice(2));
  // Filas mientras se escriben (las vacías no se guardan).
  const [highlights, setHighlights] = useState<string[]>(() => details.highlights);
  const [specs, setSpecs] = useState<Array<{ name: string; value: string }>>(() => details.specifications);
  const [newHighlight, setNewHighlight] = useState("");
  const [openGroup, setOpenGroup] = useState(HIGHLIGHT_GROUPS[0][0]);
  const lastSpec = useRef<HTMLInputElement>(null);
  const focusSpec = useRef(false);

  useEffect(() => {
    if (focusSpec.current) { focusSpec.current = false; lastSpec.current?.focus(); }
  }, [specs.length]);

  function update<K extends keyof ProductDetails>(key: K, value: ProductDetails[K]) {
    onChange({ ...details, [key]: value });
  }
  const saveHighlights = (list: string[]) => { setHighlights(list); update("highlights", list.map((x) => x.trim()).filter(Boolean)); };
  const saveSpecs = (list: Array<{ name: string; value: string }>) => {
    setSpecs(list);
    update("specifications", list.map((s) => ({ name: s.name.trim(), value: s.value.trim() })).filter((s) => s.name && s.value));
  };
  const has = (text: string) => highlights.some((h) => h.trim() === text);
  const toggle = (text: string) => saveHighlights(has(text) ? highlights.filter((h) => h.trim() !== text) : [...highlights, text]);
  const addCustom = () => {
    const t = newHighlight.trim();
    if (!t) return;
    saveHighlights([...highlights, splitIcon(t)[0] ? t : `✅ ${t}`]);
    setNewHighlight("");
  };
  const moveH = (i: number, d: number) => { const n = [...highlights]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); saveHighlights(n); };
  const moveS = (i: number, d: number) => { const n = [...specs]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); saveSpecs(n); };
  const desc = details.long_description;

  return (
    <section className="space-y-4 rounded-[22px] border p-4 sm:p-5" style={textStyle}>
      <div>
        <h2 className="text-lg font-bold">✨ Página de producto</h2>
        <p className="mt-1 text-sm opacity-75">Agrega información comprobable para que tus clientes conozcan mejor el producto. Todo esto sale en la ficha, el catálogo y las landing pages.</p>
      </div>

      <Box icon="📝" title="Descripción completa" hint="Cuenta para qué sirve, cómo se usa y por qué vale la pena" right={<span className="text-[11px] font-semibold" style={muted}>{desc.length.toLocaleString("es-CO")} / 10.000</span>}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {DESC_STARTERS.map((s) => (
            <button key={s} type="button" onClick={() => update("long_description", `${desc}${desc && !desc.endsWith("\n") ? "\n" : ""}${s}`)} className="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:-translate-y-0.5" style={textStyle}>+ {s.trim()}</button>
          ))}
        </div>
        <RichTextEditor value={desc} onChange={(v) => update("long_description", v)} placeholder="Detalles, usos y contexto que conozcas del producto…" maxLength={10000} />
      </Box>

      <Box icon="⭐" title="Características" hint="Toca las sugerencias para agregarlas o quitarlas (puedes elegir varias). Cada una lleva su ícono." right={highlights.length ? <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" }}>{highlights.length} elegidas</span> : null}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {HIGHLIGHT_GROUPS.map(([g]) => (
            <button key={g} type="button" onClick={() => setOpenGroup(g)} className="rounded-full px-3 py-1 text-xs font-bold transition" style={openGroup === g ? { background: "var(--t-cta)", color: "#fff" } : { ...textStyle, border: "1px solid var(--t-card-border)" }}>{g}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {HIGHLIGHT_GROUPS.find(([g]) => g === openGroup)?.[1].map((t) => {
            const on = has(t);
            return (
              <button key={t} type="button" onClick={() => toggle(t)} aria-pressed={on}
                className="rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5"
                style={{ ...textStyle, borderColor: on ? "var(--t-accent)" : "var(--t-card-border)", background: on ? "color-mix(in oklab, var(--t-accent) 18%, transparent)" : textStyle.background }}>
                {on ? "✓ " : ""}{t}
              </button>
            );
          })}
        </div>

        {highlights.length ? (
          <div className="mt-3 space-y-1.5">
            {highlights.map((h, i) => {
              const [icon, text] = splitIcon(h);
              return (
                <div key={i} className="flex items-center gap-2">
                  <IconButton value={icon} onChange={(ic) => saveHighlights(highlights.map((x, k) => (k === i ? (ic ? `${ic} ${text}` : text) : x)))} />
                  <input value={text} onChange={(e) => saveHighlights(highlights.map((x, k) => (k === i ? (icon ? `${icon} ${e.target.value}` : e.target.value) : x)))} className="w-full rounded-xl border p-2.5 text-sm outline-none" style={textStyle} maxLength={160} />
                  <button type="button" disabled={!i} onClick={() => moveH(i, -1)} className="p-1 disabled:opacity-30" title="Subir"><ArrowUp size={14} /></button>
                  <button type="button" disabled={i === highlights.length - 1} onClick={() => moveH(i, 1)} className="p-1 disabled:opacity-30" title="Bajar"><ArrowDown size={14} /></button>
                  <button type="button" onClick={() => saveHighlights(highlights.filter((_, k) => k !== i))} className="p-1 text-red-500" title="Quitar"><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="mt-3 flex gap-2">
          <input value={newHighlight} onChange={(e) => setNewHighlight(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} placeholder="Escribe una propia (ej. Cancelación de ruido) y presiona Enter" className="w-full rounded-xl border p-2.5 text-sm outline-none" style={textStyle} maxLength={160} />
          <button type="button" onClick={addCustom} disabled={!newHighlight.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}><Plus size={15} /> Agregar</button>
        </div>
      </Box>

      <Box icon="📋" title="Especificaciones" hint="Datos técnicos en filas: toca un nombre para agregarlo y escribe su valor">
        <div className="flex flex-wrap gap-1.5">
          {SPEC_NAMES.map(([ic, name]) => {
            const used = specs.some((s) => s.name.trim().toLowerCase() === name.toLowerCase());
            return (
              <button key={name} type="button" disabled={used} onClick={() => { focusSpec.current = true; saveSpecs([...specs, { name, value: "" }]); }}
                className="rounded-full border px-2.5 py-1 text-xs font-semibold transition hover:-translate-y-0.5 disabled:opacity-40" style={textStyle}>
                {ic} {name}
              </button>
            );
          })}
        </div>
        {specs.length ? (
          <div className="mt-3 space-y-1.5">
            {specs.map((s, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)_auto] items-center gap-2">
                <input value={s.name} onChange={(e) => saveSpecs(specs.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="Nombre (ej. Color)" className="rounded-xl border p-2.5 text-sm font-semibold outline-none" style={textStyle} maxLength={60} />
                <input ref={i === specs.length - 1 ? lastSpec : undefined} value={s.value} onChange={(e) => saveSpecs(specs.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} placeholder="Valor (ej. Negro)" className="rounded-xl border p-2.5 text-sm outline-none" style={{ ...textStyle, borderColor: s.name && !s.value ? "rgba(245,158,11,.7)" : "var(--t-card-border)" }} maxLength={160} />
                <div className="flex">
                  <button type="button" disabled={!i} onClick={() => moveS(i, -1)} className="p-1 disabled:opacity-30" title="Subir"><ArrowUp size={14} /></button>
                  <button type="button" disabled={i === specs.length - 1} onClick={() => moveS(i, 1)} className="p-1 disabled:opacity-30" title="Bajar"><ArrowDown size={14} /></button>
                  <button type="button" onClick={() => saveSpecs(specs.filter((_, k) => k !== i))} className="p-1 text-red-500" title="Quitar"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <button type="button" onClick={() => { focusSpec.current = true; saveSpecs([...specs, { name: "", value: "" }]); }} className="mt-3 inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm font-semibold" style={textStyle}><Plus size={14} /> Otra especificación</button>
        {specs.some((s) => s.name.trim() && !s.value.trim()) ? <p className="mt-2 text-xs font-semibold" style={{ color: "#d97706" }}>Las filas sin valor no se guardan.</p> : null}
      </Box>

      <div className="grid gap-3 sm:grid-cols-2">
        <VideoField icon="🎬" label="Video del producto" hint="YouTube (también «shorts») o un enlace .mp4" value={details.video_url} onChange={(v) => update("video_url", v)} />
        <VideoField icon="📘" label="Tutorial o guía de uso" hint="Un video o página que explique cómo usarlo" value={details.tutorial_url} onChange={(v) => update("tutorial_url", v)} />
      </div>

      <GalleryEditor
        urls={details.gallery_urls}
        onChange={(urls) => update("gallery_urls", urls)}
        userId={userId}
        productId={productId}
        uploadId={uploadId}
      />
    </section>
  );
}
