"use client";

import type { CSSProperties, KeyboardEvent, Ref } from "react";

/**
 * Casilla de porcentaje: el número y el «%» van lado a lado dentro del mismo recuadro (el «%» no se monta sobre el número).
 */
export function PctInput({ value, onChange, placeholder, ariaLabel, title, inputRef, onKeyDown, onBlur, highlight, size = "md", className = "" }: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  ariaLabel: string;
  title?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  highlight?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const box: CSSProperties = {
    borderColor: highlight ? "color-mix(in oklab, var(--t-accent) 60%, transparent)" : "var(--t-card-border)",
    background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
    color: "var(--t-text)",
  };
  return (
    <label className={`flex items-center overflow-hidden rounded-xl border focus-within:ring-2 ${size === "sm" ? "h-9" : "h-[42px]"} ${className}`} style={{ ...box, ["--tw-ring-color" as string]: "color-mix(in oklab, var(--t-accent) 45%, transparent)" }} title={title}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className="h-full w-full min-w-0 flex-1 border-0 bg-transparent pl-3 text-right text-sm font-bold tabular-nums outline-none"
        style={{ color: "var(--t-text)", padding: "0 4px 0 12px" }}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ""))}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      <span className="shrink-0 select-none pr-3 text-sm font-bold" style={{ color: "var(--t-muted)" }} aria-hidden>%</span>
    </label>
  );
}
