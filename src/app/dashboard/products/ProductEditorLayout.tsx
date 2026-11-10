"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, CircleDot, Loader2, Save } from "lucide-react";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * Pantalla de crear / editar producto: una sección a la vez (con ícono y color), lo que ya está lleno
 * marcado con ✓, lo opcional señalado, vista previa en vivo y una barra arriba con foto, estado y Guardar.
 */
export type EditorSection = {
  key: string;
  label: string;
  icon: ReactNode;
  color: string;
  hint: string;
  done?: boolean;
  optional?: boolean;
  content: ReactNode;
};

export function ProductEditorLayout({
  mode, name, image, code, active, onToggleActive, dirty, saving, savedFlash, onSave, onBack, actions, sections, preview,
}: {
  mode: "create" | "edit";
  name: string;
  image: string | null;
  code?: string | null;
  active: boolean;
  onToggleActive: () => void;
  dirty: boolean;
  saving: boolean;
  /** Muestra «Guardado ✓» un momento después de guardar. */
  savedFlash?: boolean;
  onSave: () => void;
  onBack: () => void;
  actions?: ReactNode;
  sections: EditorSection[];
  preview: ReactNode;
}) {
  // ?section=media abre directo en esa sección (lo usa el Radar de productos para ir a lo que falta).
  const [current, setCurrent] = useState(() => {
    const wanted = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("section") : null;
    return wanted && sections.some((s) => s.key === wanted) ? wanted : sections[0]?.key ?? "";
  });
  const idx = Math.max(0, sections.findIndex((s) => s.key === current));
  const sec = sections[idx];
  const doneCount = sections.filter((s) => s.done).length;
  const pct = Math.round((doneCount / Math.max(1, sections.length)) * 100);

  // Al cambiar de sección se sube al inicio de la tarjeta (en el celular sobre todo).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    document.getElementById("product-editor-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  const saveLabel = mode === "create" ? (saving ? "Creando…" : "Crear producto") : saving ? "Guardando…" : "Guardar";
  return (
    <main className="space-y-3 px-3 py-3 sm:p-6" style={{ color: "var(--t-text)" }}>
      {/* ------------------------------------------------ barra superior */}
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="relative z-30 rounded-[22px] border p-3 shadow-lg backdrop-blur-xl sm:p-4 lg:sticky lg:top-2"
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)" }}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition hover:-translate-x-0.5" style={{ borderColor: "var(--t-card-border)" }} aria-label="Volver" title="Volver a productos">
            <ArrowLeft size={18} />
          </button>
          <motion.div layout className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}>
            <AnimatePresence mode="wait">
              {image ? (
                <motion.img key={image} src={image} alt="" className="h-full w-full object-cover" initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} />
              ) : (
                <motion.span key="ph" className="grid h-full w-full place-items-center text-2xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>📦</motion.span>
              )}
            </AnimatePresence>
          </motion.div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>{mode === "create" ? "✨ Nuevo producto" : "✏️ Editar producto"}</p>
            <h1 className="truncate text-lg font-black sm:text-xl">{name.trim() || (mode === "create" ? "Sin nombre todavía" : "Producto")}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              {code ? <span className="rounded-full border px-2 py-0.5 font-bold tabular-nums" style={{ borderColor: "var(--t-card-border)" }}>#{code}</span> : null}
              <AnimatePresence mode="wait">
                {saving ? (
                  <motion.span key="s" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 font-bold" style={{ color: "var(--t-muted)" }}><Loader2 size={11} className="animate-spin" /> Guardando…</motion.span>
                ) : savedFlash ? (
                  <motion.span key="ok" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 font-bold text-emerald-500"><Check size={12} /> Guardado</motion.span>
                ) : dirty ? (
                  <motion.span key="d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 font-bold text-amber-500"><CircleDot size={11} className="animate-pulse" /> Cambios sin guardar</motion.span>
                ) : mode === "edit" ? (
                  <motion.span key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1" style={{ color: "var(--t-muted)" }}><Check size={11} /> Todo guardado</motion.span>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          {/* Activo / inactivo como interruptor */}
          <button type="button" onClick={onToggleActive} role="switch" aria-checked={active} title={active ? "Se vende y aparece en los catálogos" : "Oculto: no se vende ni aparece"}
            className="hidden shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-bold sm:inline-flex" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="relative h-6 w-11 rounded-full transition-colors" style={{ background: active ? "#10b981" : "color-mix(in oklab, var(--t-text) 20%, transparent)" }}>
              <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{ left: active ? 22 : 2 }} />
            </span>
            {active ? "Activo" : "Inactivo"}
          </button>
          <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div>
          <motion.button type="button" onClick={onSave} disabled={saving || (mode === "edit" && !dirty)} whileTap={{ scale: 0.95 }}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white shadow-lg transition disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : mode === "create" ? <Check size={16} /> : <Save size={16} />}
            <span className="hidden sm:inline">{saveLabel}</span>
          </motion.button>
        </div>
        {/* Avance: qué tan completa está la ficha */}
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }}>
            <motion.div className="h-full rounded-full" initial={false} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }}
              style={{ background: "linear-gradient(90deg, #8b5cf6, #10b981)" }} />
          </div>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--t-muted)" }}>{doneCount}/{sections.length} listo</span>
        </div>
        {/* En el celular: interruptor y acciones debajo */}
        <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
          <button type="button" onClick={onToggleActive} role="switch" aria-checked={active} className="inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="relative h-6 w-11 rounded-full" style={{ background: active ? "#10b981" : "color-mix(in oklab, var(--t-text) 20%, transparent)" }}>
              <motion.span layout className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{ left: active ? 22 : 2 }} />
            </span>
            {active ? "Activo" : "Inactivo"}
          </button>
          {actions}
        </div>
        <div className="mt-2 hidden flex-wrap items-center gap-2 sm:flex md:hidden">{actions}</div>
      </motion.header>

      {/* ------------------------------------------------ secciones (celular: arriba deslizable) */}
      <div className="lg:hidden">
        <SectionTabs variant="pills" layoutId="product-sections-m" label="Secciones del producto" value={current} onChange={setCurrent}
          items={sections.map((s) => ({ key: s.key, label: s.label, icon: s.done ? "✓" : s.icon, color: s.done ? "#10b981" : s.color }))} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* Menú lateral (computador) */}
        <nav className="hidden lg:block" aria-label="Secciones del producto">
          <ul className="sticky top-36 space-y-1">
            {sections.map((s, i) => {
              const on = s.key === current;
              return (
                <li key={s.key}>
                  <motion.button type="button" onClick={() => setCurrent(s.key)} whileHover={{ x: 3 }} whileTap={{ scale: 0.98 }}
                    className="relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left" style={{ color: on ? "var(--t-text)" : "var(--t-muted)" }}>
                    {on ? <motion.span layoutId="product-section" className="absolute inset-0 rounded-2xl" transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      style={{ background: `color-mix(in oklab, ${s.color} 16%, var(--t-card-bg))`, boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${s.color} 60%, transparent)` }} /> : null}
                    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base [&>svg]:h-[18px] [&>svg]:w-[18px]"
                      style={on ? { background: s.color, color: "#fff" } : { background: `color-mix(in oklab, ${s.color} 15%, transparent)`, color: s.color }}>
                      {s.icon}
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{i + 1}. {s.label}</span>
                      <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{s.done ? "Listo" : s.optional ? "Opcional" : "Por completar"}</span>
                    </span>
                    <span className="relative">
                      {s.done ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white"><Check size={12} /></motion.span>
                        : <span className="block h-2 w-2 rounded-full" style={{ background: s.optional ? "color-mix(in oklab, var(--t-text) 25%, transparent)" : "#f59e0b" }} />}
                    </span>
                  </motion.button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sección actual */}
        <section id="product-editor-card" className="min-w-0 scroll-mt-40 rounded-[22px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", boxShadow: "var(--t-shadow)" }}>
          {sec ? (
            <div className="mb-4 flex items-start gap-3">
              <motion.span key={sec.key} initial={{ rotate: -12, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-xl text-white shadow-lg [&>svg]:h-6 [&>svg]:w-6" style={{ background: sec.color, boxShadow: `0 10px 24px -12px ${sec.color}` }}>
                {sec.icon}
              </motion.span>
              <div className="min-w-0 flex-1">
                <h2 className="flex flex-wrap items-center gap-2 text-lg font-black">
                  {sec.label}
                  {sec.optional ? <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Opcional</span> : null}
                  {sec.done ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-500">✓ Listo</span> : null}
                </h2>
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>{sec.hint}</p>
              </div>
            </div>
          ) : null}
          {/* Todas montadas (no se pierde lo escrito al cambiar); solo se ve la actual. */}
          {sections.map((s) => (
            <motion.div key={s.key} initial={false} animate={s.key === current ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ duration: 0.22 }}
              style={{ display: s.key === current ? "block" : "none" }} className="space-y-4">
              {s.content}
            </motion.div>
          ))}
          <div className="mt-5 flex items-center justify-between gap-2 border-t pt-4" style={{ borderColor: "var(--t-card-border)" }}>
            <button type="button" disabled={idx === 0} onClick={() => setCurrent(sections[idx - 1].key)} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold transition disabled:opacity-30" style={{ borderColor: "var(--t-card-border)" }}>
              <ArrowLeft size={15} /> <span className="hidden sm:inline">{sections[idx - 1]?.label ?? "Anterior"}</span>
            </button>
            {idx < sections.length - 1 ? (
              <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => setCurrent(sections[idx + 1].key)} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-black text-white" style={{ background: sections[idx + 1].color }}>
                Siguiente: {sections[idx + 1].label} <ArrowRight size={15} />
              </motion.button>
            ) : (
              <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={onSave} disabled={saving || (mode === "edit" && !dirty)} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#10b981,#0ea5e9)" }}>
                <Check size={15} /> {mode === "create" ? "Crear producto" : "Guardar cambios"}
              </motion.button>
            )}
          </div>
        </section>

        {/* Vista previa */}
        <aside className="hidden lg:block">
          <div className="sticky top-36 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>👀 Así se ve en el catálogo</p>
            {preview}
          </div>
        </aside>
      </div>
    </main>
  );
}

/** Tarjeta de vista previa (como en el catálogo). */
export function ProductPreviewCard({ name, image, price, active, highlights, category }: { name: string; image: string | null; price: number | null; active: boolean; highlights: string[]; category?: string | null }) {
  return (
    <motion.div layout className="overflow-hidden rounded-[22px] border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", boxShadow: "var(--t-shadow)" }}>
      <div className="relative aspect-square" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-6xl opacity-60">📦</div>}
        {!active ? <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">Oculto</span> : null}
        {category ? <span className="absolute bottom-2 left-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold text-slate-800">{category}</span> : null}
      </div>
      <div className="space-y-1.5 p-3">
        <p className="line-clamp-2 text-sm font-bold">{name.trim() || "Nombre del producto"}</p>
        <p className="text-lg font-black tabular-nums" style={{ color: "var(--t-accent)" }}>{price && price > 0 ? `$ ${Math.round(price).toLocaleString("es-CO")}` : "Precio al ingresar factura"}</p>
        {highlights.length ? (
          <ul className="space-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            {highlights.slice(0, 3).map((h) => <li key={h} className="truncate">{h}</li>)}
          </ul>
        ) : null}
      </div>
    </motion.div>
  );
}

/** Campo con etiqueta, ícono y una ayuda corta. */
export function Field({ label, icon, help, children }: { label: string; icon?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">{icon ? <span>{icon}</span> : null}{label}</p>
      {children}
      {help ? <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{help}</p> : null}
    </div>
  );
}

export const inputCls = "w-full rounded-2xl border px-3.5 py-3 text-sm outline-none transition focus:ring-2";
export const inputStyle = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" } as const;
