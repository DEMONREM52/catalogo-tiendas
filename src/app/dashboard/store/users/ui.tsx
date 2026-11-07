"use client";

import { RISK_INFO, riskScore } from "@/lib/permissions";

const AVATAR_COLORS = [["#8b5cf6", "#ec4899"], ["#0ea5e9", "#6366f1"], ["#10b981", "#0ea5e9"], ["#f59e0b", "#ef4444"], ["#14b8a6", "#84cc16"], ["#f43f5e", "#a855f7"]];

/** Círculo con iniciales y color propio de cada persona. */
export function Avatar({ name, size = 44, dim = false }: { name: string; size?: number; dim?: boolean }) {
  const clean = name.trim() || "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
  let hash = 0;
  for (const ch of clean.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-2xl font-black text-white shadow-md"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${a}, ${b})`, filter: dim ? "grayscale(0.9)" : undefined, opacity: dim ? 0.6 : 1 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Nivel de acceso de un conjunto de permisos: barra y texto (bajo, medio, alto, total). */
export function riskLevel(perms: readonly string[], admin = false) {
  const score = admin ? 100 : riskScore(perms);
  const level = score >= 70 ? "critical" : score >= 40 ? "high" : score >= 15 ? "medium" : "low";
  const text = admin ? "Acceso total" : score === 0 ? "Sin permisos" : level === "critical" ? "Acceso muy amplio" : level === "high" ? "Acceso amplio" : level === "medium" ? "Acceso medio" : "Acceso básico";
  return { score, level: level as keyof typeof RISK_INFO, text, color: admin ? "#ef4444" : RISK_INFO[level as keyof typeof RISK_INFO].color };
}

export function RiskMeter({ perms, admin = false, compact = false }: { perms: readonly string[]; admin?: boolean; compact?: boolean }) {
  const r = riskLevel(perms, admin);
  return (
    <div className={compact ? "min-w-[110px]" : ""} title={`${r.text} · ${r.score}% del total de permisos (pesando los sensibles)`}>
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
        <span>{r.text}</span>
        {!compact ? <span style={{ color: r.color }}>{r.score}%</span> : null}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(r.score, perms.length ? 3 : 0)}%`, background: `linear-gradient(90deg, #10b981, ${r.color})` }} />
      </div>
    </div>
  );
}

export function RiskPill({ risk }: { risk: keyof typeof RISK_INFO }) {
  const r = RISK_INFO[risk];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide" style={{ color: r.color, background: `color-mix(in oklab, ${r.color} 14%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
      {r.label}
    </span>
  );
}

export const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

export const fieldCls = "w-full rounded-2xl border px-4 py-3 text-base outline-none transition focus:ring-2 focus:ring-[color:color-mix(in_oklab,var(--t-accent)_35%,transparent)] sm:text-sm";
export const fieldStyle = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, color-mix(in oklab, var(--t-card-bg) 92%, transparent))", color: "var(--t-text)" } as const;
