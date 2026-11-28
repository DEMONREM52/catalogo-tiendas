"use client";

import { useState } from "react";
import type { ScanMatch } from "@/lib/scan/parse";

const KEY = "remhub:scan:match";

/** «Coincidencia exacta» (nombre, referencia o código de barras) o «Por código» (solo referencia o código). Se recuerda en este equipo. */
export function useScanMatch(): [ScanMatch, (m: ScanMatch) => void] {
  const [match, setMatch] = useState<ScanMatch>(() => {
    try { return window.localStorage.getItem(KEY) === "code" ? "code" : "exact"; } catch { return "exact"; }
  });
  const set = (m: ScanMatch) => {
    setMatch(m);
    try { window.localStorage.setItem(KEY, m); } catch { /* sin almacenamiento */ }
  };
  return [match, set];
}

const HINT: Record<ScanMatch, string> = {
  exact: "Lo leído debe ser igual al nombre, la referencia o el código de barras (sirve para QR con el nombre).",
  code: "Lo leído debe ser igual a la referencia o al código de barras.",
};

export function MatchToggle({ value, onChange }: { value: ScanMatch; onChange: (m: ScanMatch) => void }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Cómo reconocer lo escaneado">
      {(["exact", "code"] as const).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} title={HINT[m]} onClick={() => onChange(m)}
          className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
          style={value === m ? { borderColor: "var(--t-accent)", background: "var(--t-accent)", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
          {m === "exact" ? "Coincidencia exacta" : "Por código"}
        </button>
      ))}
    </span>
  );
}

export const matchHint = (m: ScanMatch) => HINT[m];
export const notFoundText = (code: string, m: ScanMatch) =>
  m === "exact" ? `Ningún producto se llama ni tiene el código «${code}».` : `No hay ningún producto con el código «${code}».`;
