"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CalendarDays, Clock } from "lucide-react";

/**
 * Campos de formulario para dinero, números y fechas que se ven y se escriben igual en todos los
 * dispositivos y navegadores (el campo de fecha nativo muestra mm/dd/yyyy en inglés; este siempre DD/MM/AAAA).
 */

const box: CSSProperties = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" };
const money = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
/** Campo «desnudo» dentro de una caja propia (anula el estilo global de inputs de globals.css). */
const bare: CSSProperties = { border: "none", background: "transparent", boxShadow: "none", minHeight: 0, padding: "9px 0", borderRadius: 0, outline: "none" };

export function Field({ label, hint, error, children, className = "" }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-bold" style={{ color: "var(--t-text)" }}>{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11px] font-semibold text-red-400">{error}</span> : hint ? <span className="mt-1 block text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
    </label>
  );
}

/** Dinero: «$ 1.000.000», solo dígitos, sin decimales (pesos). */
export function MoneyField({ value, onChange, placeholder = "$ 0", disabled, big, ariaLabel, allowEmpty = true, autoFocus }: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string; disabled?: boolean; big?: boolean; ariaLabel?: string; allowEmpty?: boolean; autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      disabled={disabled}
      placeholder={placeholder}
      value={value === null || value === undefined || (Number.isNaN(value)) ? "" : `$ ${money.format(value)}`}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
        onChange(digits ? Number(digits) : allowEmpty ? null : 0);
      }}
      className={`w-full rounded-xl border px-3 outline-none transition focus:ring-4 disabled:opacity-60 ${big ? "py-3 text-2xl font-black" : "py-2 text-sm font-bold"}`}
      style={{ ...box, fontVariantNumeric: "tabular-nums", fontSize: big ? 26 : 15, fontWeight: big ? 900 : 700, minHeight: big ? 56 : 42, ["--tw-ring-color" as string]: "color-mix(in oklab, var(--t-accent) 30%, transparent)" }}
    />
  );
}

/** Número con decimales (coma o punto) y sufijo opcional («%», «días»). Nunca deja ceros a la izquierda. */
export function NumberField({ value, onChange, suffix, decimals = 2, min, max, disabled, placeholder, ariaLabel, align = "right" }: {
  value: number | null; onChange: (v: number | null) => void; suffix?: string; decimals?: number; min?: number; max?: number; disabled?: boolean; placeholder?: string; ariaLabel?: string; align?: "left" | "right";
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (value === null || value === undefined || Number.isNaN(value) ? "" : value.toLocaleString("es-CO", { maximumFractionDigits: decimals, useGrouping: false }));
  return (
    <div className="flex items-center rounded-xl border px-3 transition focus-within:ring-4" style={{ ...box, ["--tw-ring-color" as string]: "color-mix(in oklab, var(--t-accent) 30%, transparent)", opacity: disabled ? 0.6 : 1 }}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={shown}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          let t = e.target.value.replace(/[^\d.,-]/g, "").replace(".", ",");
          const neg = (min ?? 0) < 0 && t.startsWith("-");
          t = t.replace(/-/g, "");
          const [int = "", ...rest] = t.split(",");
          const dec = decimals > 0 && rest.length ? "," + rest.join("").slice(0, decimals) : "";
          t = (neg ? "-" : "") + int.replace(/^0+(?=\d)/, "") + dec;
          setTyped(t);
          const n = Number(t.replace(",", "."));
          if (t === "" || t === "-" ) return onChange(null);
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => {
          setTyped(null);
          if (value === null) return;
          if (min !== undefined && value < min) onChange(min);
          else if (max !== undefined && value > max) onChange(max);
        }}
        className={`w-full min-w-0 bg-transparent text-sm font-bold tabular-nums outline-none ${align === "right" ? "text-right" : ""}`}
        style={bare}
      />
      {suffix ? <span className="ml-1.5 shrink-0 text-xs font-bold" style={{ color: "var(--t-muted)" }}>{suffix}</span> : null}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoToText = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
function textToIso(t: string): string | null {
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || y < 1900 || y > 2200) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * Fecha en formato DD/MM/AAAA (se escribe o se elige en el calendario).
 * Valor: «AAAA-MM-DD» o «» si está vacío. Con `withTime` el valor es «AAAA-MM-DDTHH:MM».
 */
export function DateField({ value, onChange, min, max, disabled, withTime, placeholder = "DD/MM/AAAA", ariaLabel, className = "", compact }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; disabled?: boolean; withTime?: boolean; placeholder?: string; ariaLabel?: string;
  /** Clases del contenedor (ancho, margen). */
  className?: string;
  /** Versión pequeña para filtros en línea. */
  compact?: boolean;
}) {
  const datePart = value ? value.slice(0, 10) : "";
  const timePart = withTime && value && value.length >= 16 ? value.slice(11, 16) : "";
  const [typed, setTyped] = useState<string | null>(null);
  const [typedTime, setTypedTime] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const emit = (d: string, t: string) => onChange(!d ? "" : withTime ? `${d}T${t || "00:00"}` : d);
  const outOfRange = (iso: string) => (min && iso < min.slice(0, 10)) || (max && iso > max.slice(0, 10));

  return (
    <div className={className}>
    <div className="flex gap-2">
      <div className={`flex min-w-0 flex-1 items-center rounded-xl border transition focus-within:ring-4 ${compact ? "pl-2" : "pl-3"}`} style={{ ...box, borderColor: bad ? "rgba(239,68,68,.6)" : box.borderColor, ["--tw-ring-color" as string]: "color-mix(in oklab, var(--t-accent) 30%, transparent)", opacity: disabled ? 0.6 : 1, minHeight: compact ? 30 : 42 }}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          disabled={disabled}
          placeholder={placeholder}
          value={typed ?? isoToText(datePart)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
            const t = digits.length > 4 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
            setTyped(t);
            if (!t) { setBad(false); return emit("", ""); }
            const iso = textToIso(t);
            if (iso && !outOfRange(iso)) { setBad(false); emit(iso, timePart); }
            else setBad(digits.length === 8);
          }}
          onBlur={() => { setTyped(null); setBad(false); }}
          className={`w-full min-w-0 bg-transparent font-semibold tabular-nums outline-none ${compact ? "text-xs" : "text-sm"}`}
          style={{ ...bare, padding: compact ? "4px 0" : bare.padding, fontSize: compact ? 12 : 14, width: compact ? "11ch" : undefined }}
        />
        <button type="button" disabled={disabled} onClick={() => { const p = picker.current; if (!p) return; try { p.showPicker(); } catch { p.focus(); p.click(); } }}
          className={`relative grid shrink-0 place-items-center rounded-r-xl ${compact ? "h-7 w-8" : "h-9 w-10"}`} aria-label="Abrir calendario" title="Elegir en el calendario">
          <CalendarDays size={16} style={{ color: "var(--t-muted)" }} />
          <input ref={picker} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" value={datePart} min={min?.slice(0, 10)} max={max?.slice(0, 10)}
            onChange={(e) => { setTyped(null); setBad(false); emit(e.target.value, timePart); }} />
        </button>
      </div>
      {withTime ? (
        <div className="flex w-28 shrink-0 items-center gap-1.5 rounded-xl border px-2.5" style={{ ...box, opacity: disabled || !datePart ? 0.6 : 1 }}>
          <Clock size={14} style={{ color: "var(--t-muted)" }} />
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            disabled={disabled || !datePart}
            aria-label="Hora (24 horas)"
            value={typedTime ?? timePart}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
              const t = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
              setTypedTime(t);
              const m = t.match(/^(\d{2}):(\d{2})$/);
              if (m && Number(m[1]) < 24 && Number(m[2]) < 60) emit(datePart, t);
            }}
            onBlur={() => setTypedTime(null)}
            className="w-full min-w-0 bg-transparent text-sm font-semibold tabular-nums outline-none"
          style={bare}
          />
        </div>
      ) : null}
    </div>
      {bad ? <span className="mt-1 block text-[11px] font-semibold text-red-400">Esa fecha no existe o está fuera del rango permitido.</span> : null}
    </div>
  );
}

/** Botones de opciones (más cómodos que una lista desplegable). */
export function ChoiceChips<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; icon?: ReactNode }>; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-50"
          style={value === o.value ? { background: "var(--t-accent)", color: "#fff", boxShadow: "0 6px 18px color-mix(in oklab, var(--t-accent) 35%, transparent)" } : { border: "1px solid var(--t-card-border)", color: "var(--t-text)" }}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** «06/11/2026» (día/mes/año) → «2026-11-06»; null si la fecha no existe. */
export const parseDdMmYyyy = (text: string) => textToIso(text.trim().replace(/[-.]/g, "/"));

/** Fecha «AAAA-MM-DD» → «14/10/2026». */
export const ddmmyyyy = (iso: string | null | undefined) => (iso ? isoToText(iso.slice(0, 10)) : "—");
