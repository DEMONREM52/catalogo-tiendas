"use client";

import { useState, type CSSProperties } from "react";

/** Bancos, billeteras y cooperativas más usados en Colombia (para pagos a empleados, proveedores y clientes). */
export const COLOMBIAN_BANKS = [
  "Bancolombia", "Banco de Bogotá", "Davivienda", "BBVA Colombia", "Banco de Occidente", "Banco Popular", "Banco AV Villas",
  "Banco Caja Social", "Scotiabank Colpatria", "Banco Agrario de Colombia", "Banco GNB Sudameris", "Itaú", "Banco Falabella",
  "Banco Pichincha", "Bancoomeva", "Banco Finandina", "Banco Serfinanza", "Banco W", "Bancamía", "Banco Mundo Mujer",
  "Banco Cooperativo Coopcentral", "Banco Unión", "Citibank", "Lulo Bank", "Nu Colombia", "Ualá", "Banco Santander de Negocios",
  "Nequi", "Daviplata", "Movii", "Dale!", "Rappipay", "Confiar Cooperativa", "Cotrafa", "JFK Cooperativa",
] as const;

const OTHER = "__otro__";

/**
 * Para campos con datos de OTRA persona (documento, cuenta, celular de un empleado o tercero): el navegador no debe
 * ofrecer las tarjetas ni los datos guardados del usuario (Chrome confunde «Número» con el número de una tarjeta).
 */
export const NO_AUTOFILL = { autoComplete: "off", "data-1p-ignore": true, "data-lpignore": "true", "data-form-type": "other" } as const;

/**
 * Lista de bancos con opción «Otro» para escribirlo. Si el valor guardado no está en la lista, se muestra como «Otro».
 * Devuelve el nombre del banco como texto (igual que antes), así no cambia nada en la base.
 */
export function BankSelect({ value, onChange, className, style, ariaLabel = "Banco" }: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const v = (value ?? "").trim();
  const known = COLOMBIAN_BANKS.find((b) => b.toLowerCase() === v.toLowerCase());
  const [typing, setTyping] = useState(Boolean(v) && !known);
  const showText = typing || (Boolean(v) && !known);
  return (
    <div className="space-y-1.5">
      <select
        className={className}
        style={style}
        aria-label={ariaLabel}
        value={showText ? OTHER : known ?? ""}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setTyping(true);
            if (known) onChange("");
            return;
          }
          setTyping(false);
          onChange(e.target.value);
        }}
      >
        <option value="">Elige el banco…</option>
        {COLOMBIAN_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
        <option value={OTHER}>Otro (escribirlo)</option>
      </select>
      {showText ? (
        <input className={className} style={style} name="banco-otro" {...NO_AUTOFILL} autoFocus={typing && !v} value={v} placeholder="Nombre del banco o cooperativa" aria-label={`${ariaLabel} (otro)`} onChange={(e) => onChange(e.target.value)} />
      ) : null}
    </div>
  );
}
