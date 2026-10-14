"use client";

import { Info } from "lucide-react";

export type Point = { id: string; name: string };

/** Texto seguro para meter en HTML de ventanas (SweetAlert muestra títulos y html como HTML). */
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Pesos (como llegan de la base) → texto COP. */
export const cop = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
export const pctText = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : n.toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " %");
export const markup = (revenue: number, cost: number) => (cost > 0 ? ((revenue - cost) / cost) * 100 : null);
export const margin = (revenue: number, cost: number) => (revenue > 0 ? ((revenue - cost) / revenue) * 100 : null);

export const cardStyle = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };
export const inputStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" };
export const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

export function Stat({ label, value, sub, info, bad }: { label: string; value: string; sub?: string; info: string; bad?: boolean }) {
  return (
    <div className="rounded-2xl border p-3" style={cardStyle} title={info}>
      <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
        {label} <Info size={11} aria-hidden />
      </p>
      <p className="mt-1 text-xl font-black tabular-nums" style={bad ? { color: "#e66767" } : undefined}>{value}</p>
      {sub ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{sub}</p> : null}
      <span className="sr-only">{info}</span>
    </div>
  );
}

export function rpcError(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/Could not find the function|schema cache|does not exist/i.test(msg)) return "Falta ejecutar en Supabase la migración 20261106_rentabilidad_precios_punto.sql.";
  return msg;
}

/** Descarga un CSV (con BOM para que Excel respete las tildes). */
export function downloadCsv(name: string, header: string[], rows: Array<Array<string | number>>, notes: string[]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [...notes.map((n) => esc(n)), "", header.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
