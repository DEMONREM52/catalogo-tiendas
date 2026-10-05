"use client";

import type { CSSProperties, ReactNode } from "react";

type Tone = "neutral" | "amber" | "purple" | "danger" | "green";

const TONES: Record<Tone, string> = {
  neutral: "var(--t-text)",
  amber: "#f59e0b",
  purple: "#a855f7",
  danger: "#ef4444",
  green: "#10b981",
};

const PATHS: Record<string, ReactNode> = {
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  power: <><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
};

/** Botón cuadrado con icono y color suave, igual que los de la lista de productos. */
export function IconBtn({
  icon,
  tone = "neutral",
  title,
  onClick,
  disabled,
}: {
  icon: keyof typeof PATHS;
  tone?: Tone;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const color = TONES[tone];
  const style: CSSProperties = {
    color,
    background: `color-mix(in oklab, ${color} ${tone === "neutral" ? 10 : 14}%, transparent)`,
    borderColor: `color-mix(in oklab, ${color} ${tone === "neutral" ? 22 : 40}%, transparent)`,
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-xl border transition hover:-translate-y-0.5 hover:brightness-125 disabled:opacity-50"
      style={style}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[icon]}
      </svg>
    </button>
  );
}
