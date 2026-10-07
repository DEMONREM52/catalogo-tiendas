"use client";

import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { money } from "./terceros";

/** Barra de cupo: usado vs. disponible, con avisos de mora, bloqueo o sobrecupo. */
export function CreditMeter({
  enabled,
  blocked,
  limit,
  used,
  overdue,
  overdueCount,
  size = "md",
}: {
  enabled: boolean;
  blocked?: boolean;
  limit: number;
  used: number;
  overdue?: number;
  overdueCount?: number;
  size?: "sm" | "md" | "lg";
}) {
  const available = Math.max(limit - used, 0);
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : used > 0 ? 100 : 0;
  const over = used > limit && limit >= 0 && enabled;
  const color = blocked ? "#ef4444" : over || (overdue ?? 0) > 0 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#22c55e";
  const big = size === "lg";

  if (!enabled && used <= 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--t-muted)" }}>
        <Lock size={12} /> Sin crédito
      </p>
    );
  }

  return (
    <div className="w-full">
      <div className={`flex flex-wrap items-end justify-between gap-x-3 gap-y-0.5 ${big ? "text-sm" : "text-xs"}`}>
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color }}>
          {blocked ? <Lock size={big ? 15 : 12} /> : over || (overdue ?? 0) > 0 ? <AlertTriangle size={big ? 15 : 12} /> : <ShieldCheck size={big ? 15 : 12} />}
          {blocked ? "Crédito bloqueado" : !enabled ? "Crédito inactivo" : over ? "Sobre el cupo" : (overdue ?? 0) > 0 ? "Con mora" : "Crédito al día"}
        </span>
        <span style={{ color: "var(--t-muted)" }}>
          Disponible <b className={big ? "text-base" : ""} style={{ color: "var(--t-text)" }}>{money(available)}</b> de {money(limit)}
        </span>
      </div>
      <div className={`mt-1.5 overflow-hidden rounded-full ${big ? "h-3" : size === "sm" ? "h-1.5" : "h-2"}`} style={{ background: "color-mix(in oklab, var(--t-card-border) 70%, transparent)" }}>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 70%, #fff))` }} />
      </div>
      <div className={`mt-1 flex flex-wrap justify-between gap-x-3 ${big ? "text-xs" : "text-[11px]"}`} style={{ color: "var(--t-muted)" }}>
        <span>Usado {money(used)}</span>
        {(overdue ?? 0) > 0 ? (
          <span className="font-semibold" style={{ color: "#ef4444" }}>
            Vencido {money(overdue)}{overdueCount ? ` · ${overdueCount} doc.` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function KindBadge({ label, icon, color }: { label: string; icon: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, background: `color-mix(in oklab, ${color} 13%, transparent)`, color: `color-mix(in oklab, ${color} 70%, var(--t-text))` }}
    >
      {icon} {label}
    </span>
  );
}
