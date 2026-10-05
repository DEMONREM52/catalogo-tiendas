"use client";

import type { CSSProperties } from "react";

const fmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Campo de dinero: muestra «$ 30.000» y solo acepta dígitos. */
export function MoneyInput({
  value,
  onValueChange,
  allowEmpty,
  className,
  style,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: number | null;
  onValueChange: (value: number | null) => void;
  allowEmpty?: boolean;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const text = value === null ? "" : `$ ${fmt.format(value)}`;
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, letterSpacing: "0.01em", ...style }}
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
        if (!digits) return onValueChange(allowEmpty ? null : 0);
        onValueChange(Number(digits));
      }}
    />
  );
}
