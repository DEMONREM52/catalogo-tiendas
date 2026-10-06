"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

export const inputCls =
  "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[color:var(--t-accent)]";
export const inputStyle = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
  color: "var(--t-text)",
} as const;
export const softBox = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
  color: "var(--t-text)",
} as const;
export const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)" } as const;

export function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Ocurrió un error inesperado.";
}

export function money(value: number | null | undefined) {
  return `$${Math.round(Number(value ?? 0)).toLocaleString("es-CO")}`;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50"
      style={{ background: checked ? "var(--t-accent)" : "color-mix(in oklab, var(--t-text) 18%, transparent)" }}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className="inline-block h-5 w-5 rounded-full bg-white shadow"
        style={{ marginLeft: checked ? 22 : 2 }}
      />
    </button>
  );
}

export function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  icon,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border p-3.5" style={softBox}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}>
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {hint ? <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
        </div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
    </label>
  );
}

export function Section({ title, hint, icon, actions, children }: { title: string; hint?: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl border p-4 sm:p-5" style={softBox}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--t-cta)" }}>
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-base font-bold">{title}</h3>
            {hint ? <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Pill({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "danger"; title?: string }) {
  const tones = {
    neutral: { background: "color-mix(in oklab, var(--t-text) 8%, transparent)", color: "var(--t-text)" },
    accent: { background: "color-mix(in oklab, var(--t-accent) 16%, transparent)", color: "var(--t-text)" },
    good: { background: "color-mix(in oklab, #16a34a 16%, transparent)", color: "var(--t-text)" },
    warn: { background: "color-mix(in oklab, #f59e0b 18%, transparent)", color: "var(--t-text)" },
    danger: { background: "color-mix(in oklab, #ef4444 16%, transparent)", color: "var(--t-text)" },
  } as const;
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={tones[tone]}>
      {children}
    </span>
  );
}
