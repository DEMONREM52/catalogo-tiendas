"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { m as motion } from "framer-motion";

/**
 * Pestañas de las secciones del panel, iguales en todas partes.
 *  · «tiles»: cada pestaña con su ícono en un recuadro de color propio (se reconoce de un vistazo), nombre
 *    y, en computador, una ayuda corta. En el celular se deslizan de lado y la activa siempre queda a la vista.
 *  · «pills»: versión compacta para sub-pestañas (dentro de una sección o de una ventana).
 * La activa se marca con una animación que se desliza; flechas ← → del teclado para moverse.
 */
export type SectionTab<T extends string> = {
  key: T;
  label: string;
  /** Ícono (lucide de 18 px o un emoji). */
  icon?: ReactNode;
  /** Color del ícono y de la pestaña activa. Si no se da, se toma uno de la paleta por posición. */
  color?: string;
  /** Ayuda corta (solo «tiles», en pantallas medianas en adelante). */
  hint?: string;
  /** Número o texto en un globito (pendientes, alertas…). */
  badge?: number | string | null;
  /** Globito en rojo (alerta) en vez de neutro. */
  alert?: boolean;
  hidden?: boolean;
};

export const TAB_COLORS = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#6366f1", "#14b8a6", "#f97316", "#ec4899", "#84cc16"];

export function SectionTabs<T extends string>({
  items, value, onChange, variant = "tiles", layoutId = "section-tabs", label = "Secciones", className = "",
}: {
  items: SectionTab<T>[];
  value: T;
  onChange: (key: T) => void;
  variant?: "tiles" | "pills";
  layoutId?: string;
  label?: string;
  className?: string;
}) {
  const shown = items.filter((i) => !i.hidden);
  const refs = useRef(new Map<string, HTMLButtonElement>());

  // La pestaña activa siempre a la vista (en el celular las pestañas se deslizan de lado).
  useEffect(() => {
    refs.current.get(value)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);

  function onKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = shown.findIndex((t) => t.key === value);
    const next = shown[(i + (e.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length];
    if (next) { e.preventDefault(); onChange(next.key); refs.current.get(next.key)?.focus(); }
  }

  const colorOf = (t: SectionTab<T>) => t.color ?? TAB_COLORS[items.indexOf(t) % TAB_COLORS.length];
  const badge = (t: SectionTab<T>, on: boolean, small = false) =>
    t.badge !== undefined && t.badge !== null && t.badge !== 0 && t.badge !== "" ? (
      <span
        className={`grid place-items-center rounded-full font-black tabular-nums ${small ? "h-4 min-w-4 px-1 text-[9px]" : "h-5 min-w-5 px-1.5 text-[10px]"}`}
        style={t.alert ? { background: "#ef4444", color: "#fff" } : { background: on ? colorOf(t) : "color-mix(in oklab, var(--t-text) 12%, transparent)", color: on ? "#fff" : "var(--t-text)" }}
      >
        {t.badge}
      </span>
    ) : null;

  if (variant === "pills") {
    return (
      <nav role="tablist" aria-label={label} onKeyDown={onKey}
        className={`flex max-w-full gap-1 overflow-x-auto rounded-2xl border p-1 [scrollbar-width:none] ${className}`}
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
        {shown.map((t) => {
          const on = t.key === value;
          const c = colorOf(t);
          return (
            <motion.button
              key={t.key}
              ref={(el) => { if (el) refs.current.set(t.key, el); else refs.current.delete(t.key); }}
              type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.key)}
              whileTap={{ scale: 0.95 }}
              className="relative inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus-visible:ring-2 sm:text-[13px]"
              style={{ color: on ? "var(--t-text)" : "var(--t-muted)" }}
            >
              {on ? (
                <motion.span layoutId={layoutId} className="absolute inset-0 rounded-xl"
                  style={{ background: `color-mix(in oklab, ${c} 20%, var(--t-card-bg))`, boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${c} 70%, transparent)` }}
                  transition={{ type: "spring", stiffness: 460, damping: 36 }} />
              ) : null}
              {t.icon ? <span className="relative grid h-5 w-5 place-items-center text-[13px] leading-none [&>svg]:h-[15px] [&>svg]:w-[15px]" style={{ color: c }}>{t.icon}</span> : null}
              <span className="relative whitespace-nowrap">{t.label}</span>
              <span className="relative">{badge(t, on, true)}</span>
            </motion.button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav role="tablist" aria-label={label} onKeyDown={onKey}
      className={`-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 ${className}`}>
      {shown.map((t) => {
        const on = t.key === value;
        const c = colorOf(t);
        return (
          <motion.button
            key={t.key}
            ref={(el) => { if (el) refs.current.set(t.key, el); else refs.current.delete(t.key); }}
            type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.key)}
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -2 }}
            title={t.hint}
            className="relative flex min-w-[5.5rem] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl border px-2.5 py-2.5 text-center outline-none focus-visible:ring-2 sm:min-w-0 sm:flex-row sm:gap-2.5 sm:py-2 sm:pl-2 sm:pr-3.5 sm:text-left"
            style={{ borderColor: on ? "transparent" : "var(--t-card-border)", background: on ? "transparent" : "var(--t-card-bg)", color: "var(--t-text)" }}
          >
            {on ? (
              <motion.span layoutId={layoutId} className="absolute inset-0 rounded-2xl"
                style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${c} 26%, var(--t-card-bg)), color-mix(in oklab, ${c} 10%, var(--t-card-bg)))`, boxShadow: `inset 0 0 0 1.5px ${c}, 0 8px 24px -12px ${c}` }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            ) : null}
            <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg leading-none transition-colors [&>svg]:h-[18px] [&>svg]:w-[18px]"
              style={on ? { background: c, color: "#fff", boxShadow: `0 6px 16px -8px ${c}` } : { background: `color-mix(in oklab, ${c} 15%, transparent)`, color: c }}>
              {t.icon ?? t.label.slice(0, 1)}
            </span>
            <span className="relative min-w-0">
              <span className="block whitespace-nowrap text-[11px] font-bold leading-tight sm:text-sm">{t.label}</span>
              {t.hint ? <span className="hidden max-w-[13rem] truncate text-[11px] leading-tight sm:block" style={{ color: "var(--t-muted)" }}>{t.hint}</span> : null}
            </span>
            {t.badge !== undefined && t.badge !== null && t.badge !== 0 && t.badge !== "" ? (
              <span className="absolute -right-1 -top-1 sm:static">{badge(t, on)}</span>
            ) : null}
          </motion.button>
        );
      })}
    </nav>
  );
}
