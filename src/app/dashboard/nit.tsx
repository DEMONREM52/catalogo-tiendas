"use client";

import type { ReactNode } from "react";

const PRIMES = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Parte numérica del documento (ignora un «-DV» ya escrito). */
export function docDigits(doc: string | null | undefined) {
  const base = String(doc ?? "").split("-")[0];
  return base.replace(/\D/g, "");
}

/** Dígito de verificación (DIAN, módulo 11). Devuelve null si el documento no es válido. */
export function calcDv(doc: string | null | undefined): string | null {
  const digits = docDigits(doc);
  if (digits.length < 5 || digits.length > 15) return null;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * PRIMES[i];
  const r = sum % 11;
  return String(r > 1 ? 11 - r : r);
}

/** «901147931-5» para listas y documentos. */
export function docWithDv(doc: string | null | undefined) {
  const dv = calcDv(doc);
  const digits = docDigits(doc);
  if (!dv) return doc ?? "";
  return `${digits}-${dv}`;
}

/** Envuelve un input de documento y muestra a su lado el DV calculado automáticamente. */
export function WithDv({ value, children }: { value: string | null | undefined; children: ReactNode }) {
  const dv = calcDv(value);
  return (
    <div className="flex items-stretch gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <div
        className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl border px-1 text-center"
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}
        title="Dígito de verificación (se calcula solo)"
      >
        <span className="text-[10px] font-semibold uppercase leading-none" style={{ color: "var(--t-muted)" }}>DV</span>
        <span className="text-lg font-extrabold leading-tight" style={{ color: "var(--t-text)" }}>{dv ?? "–"}</span>
      </div>
    </div>
  );
}
