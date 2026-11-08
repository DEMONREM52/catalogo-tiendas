"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { SectionTabs } from "@/components/ui/SectionTabs";

/**
 * Configuración por secciones (Mi tienda): menú con ícono y color a la izquierda (computador) o
 * arriba deslizable (celular), una sección a la vez. Todas quedan montadas: no se pierde lo escrito.
 */
export type SettingsSection = { key: string; label: string; icon: ReactNode; color: string; hint: string; content: ReactNode; badge?: string | number | null };

const KEY = "remhub:store-settings-section";

export function SettingsSections({ sections }: { sections: SettingsSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.key ?? "");
  // Recuerda la última sección abierta (y respeta ?seccion= en la dirección).
  useEffect(() => {
    try {
      const want = new URLSearchParams(window.location.search).get("seccion") ?? window.localStorage.getItem(KEY);
      if (want && sections.some((s) => s.key === want)) { const t = window.setTimeout(() => setCurrent(want), 0); return () => window.clearTimeout(t); }
    } catch { /* sin almacenamiento */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const first = useRef(true);
  useEffect(() => {
    try { window.localStorage.setItem(KEY, current); } catch { /* sin almacenamiento */ }
    if (first.current) { first.current = false; return; }
    document.getElementById("settings-section-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  const idx = Math.max(0, sections.findIndex((s) => s.key === current));
  const sec = sections[idx];
  return (
    <div className="space-y-3">
      <div className="lg:hidden">
        <SectionTabs variant="pills" layoutId="store-sections-m" label="Secciones de la tienda" value={current} onChange={setCurrent}
          items={sections.map((s) => ({ key: s.key, label: s.label, icon: s.icon, color: s.color, badge: s.badge }))} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Secciones de la tienda">
          <ul className="sticky top-4 space-y-1">
            {sections.map((s) => {
              const on = s.key === current;
              return (
                <li key={s.key}>
                  <motion.button type="button" onClick={() => setCurrent(s.key)} whileHover={{ x: 3 }} whileTap={{ scale: 0.98 }}
                    className="relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left" style={{ color: on ? "var(--t-text)" : "var(--t-muted)" }}>
                    {on ? <motion.span layoutId="store-section" className="absolute inset-0 rounded-2xl" transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      style={{ background: `color-mix(in oklab, ${s.color} 16%, var(--t-card-bg))`, boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${s.color} 60%, transparent)` }} /> : null}
                    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]"
                      style={on ? { background: s.color, color: "#fff" } : { background: `color-mix(in oklab, ${s.color} 15%, transparent)`, color: s.color }}>
                      {s.icon}
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{s.label}</span>
                      <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{s.hint}</span>
                    </span>
                    {s.badge ? <span className="relative rounded-full px-1.5 text-[10px] font-black" style={{ background: `color-mix(in oklab, ${s.color} 25%, transparent)` }}>{s.badge}</span> : null}
                  </motion.button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section id="settings-section-card" className="min-w-0 scroll-mt-4 rounded-[24px] border p-4 sm:p-6" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", boxShadow: "var(--t-shadow)" }}>
          {sec ? (
            <div className="mb-5 flex items-start gap-3">
              <motion.span key={sec.key} initial={{ rotate: -12, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg [&>svg]:h-6 [&>svg]:w-6" style={{ background: sec.color, boxShadow: `0 10px 24px -12px ${sec.color}` }}>
                {sec.icon}
              </motion.span>
              <div className="min-w-0">
                <h2 className="text-xl font-black">{sec.label}</h2>
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>{sec.hint}</p>
              </div>
            </div>
          ) : null}
          {sections.map((s) => (
            <motion.div key={s.key} initial={false} animate={s.key === current ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ duration: 0.22 }}
              style={{ display: s.key === current ? "block" : "none" }} className="space-y-5">
              {s.content}
            </motion.div>
          ))}
          {idx < sections.length - 1 ? (
            <div className="mt-6 flex justify-end border-t pt-4" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" onClick={() => setCurrent(sections[idx + 1].key)} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-black text-white transition hover:-translate-y-0.5" style={{ background: sections[idx + 1].color }}>
                Siguiente: {sections[idx + 1].label} →
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/** Sub-bloque dentro de una sección (título pequeño con su ayuda). */
export function SubCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft, color-mix(in oklab, var(--t-card-bg) 80%, transparent))" }}>
      <p className="text-sm font-black">{title}</p>
      {hint ? <p className="mb-3 mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{hint}</p> : <div className="mb-3" />}
      <div className="space-y-4">{children}</div>
    </div>
  );
}
