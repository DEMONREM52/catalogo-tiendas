"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Municipio } from "@/lib/colombia/municipios";
import { deptCode, placeKey, searchCities, searchDepts, uniqueCity } from "@/lib/colombia/place-search";
import { NO_AUTOFILL } from "./BankSelect";

type Data = { list: Municipio[]; depts: Record<string, string> };
let cache: Data | null = null;
let loading: Promise<Data> | null = null;

/** La lista de municipios (≈19 KB) se trae la primera vez que se toca un campo de ciudad o departamento. */
function loadPlaces(): Promise<Data> {
  if (cache) return Promise.resolve(cache);
  loading ??= import("@/lib/colombia/municipios").then((m) => (cache = { list: m.MUNICIPIOS, depts: m.CO_DEPTS }));
  return loading;
}

function usePlaces() {
  const [data, setData] = useState<Data | null>(cache);
  const load = () => {
    if (!data) void loadPlaces().then(setData);
  };
  return { data, load };
}

type Option = { key: string; label: string; hint?: string };

function Suggest({ value, onChange, options, onPick, onFocus, onBlur, className, style, placeholder, ariaLabel, required, empty }: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  onPick: (o: Option) => void;
  onFocus: () => void;
  onBlur?: () => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const exact = options.length === 1 && placeKey(options[0].label) === placeKey(value);
  const show = open && (options.length > 0 || Boolean(empty && value.trim())) && !exact;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (o: Option) => {
    onPick(o);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!show) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && options[active]) { e.preventDefault(); pick(options[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="relative">
      <input
        className={className}
        style={style}
        {...NO_AUTOFILL}
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => { onFocus(); setActive(0); setOpen(true); }}
        onBlur={() => { setOpen(false); onBlur?.(); }}
        onKeyDown={onKey}
      />
      {show ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-xl border p-1 shadow-xl"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs" style={{ color: "var(--t-muted)" }}>{empty}</li>
          ) : options.map((o, i) => (
            <li
              key={o.key}
              data-i={i}
              role="option"
              aria-selected={i === active}
              className="flex cursor-pointer items-baseline justify-between gap-2 rounded-lg px-3 py-2 text-sm"
              style={i === active ? { background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : undefined}
              onMouseEnter={() => setActive(i)}
              // mousedown (no click): elige antes de que el campo pierda el foco y cierre la lista.
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              <span className="min-w-0 truncate font-semibold">{o.label}</span>
              {o.hint ? <span className="shrink-0 text-[11px]" style={{ color: "var(--t-muted)" }}>{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Campo «Ciudad / municipio» con las opciones del DANE. Si se pasa onPick, al elegir uno recibe el municipio
 * (nombre, departamento y código) y debe guardar los dos campos. Se puede escribir una ciudad que no esté en la lista.
 */
export function CityInput({ value, onChange, department, onPick, className, style, placeholder = "Escribe y elige", ariaLabel = "Ciudad o municipio", required }: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  department?: string | null;
  onPick?: (m: Municipio) => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
}) {
  const { data, load } = usePlaces();
  const v = value ?? "";
  const dc = data ? deptCode(data.depts, department) : null;
  const hits = data ? searchCities(data.list, v, department, data.depts) : [];
  const options = hits.map((m) => ({ key: m.code, label: m.name, hint: dc && m.code.startsWith(dc) ? undefined : m.dept }));
  // Con onPick, quien usa el campo guarda ciudad y departamento juntos (un solo cambio de estado).
  const choose = (m: Municipio) => (onPick ? onPick(m) : onChange(m.name));
  return (
    <Suggest
      value={v}
      onChange={onChange}
      options={options}
      onPick={(o) => { const m = hits.find((x) => x.code === o.key); if (m) choose(m); }}
      onFocus={load}
      onBlur={() => {
        // Escribió el nombre completo sin elegir: si ese municipio es único, llena el departamento igual.
        if (!data || !onPick || deptCode(data.depts, department)) return;
        const m = uniqueCity(data.list, v);
        if (m) choose(m);
      }}
      className={className}
      style={style}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      required={required}
      empty="No está en la lista del DANE; puedes dejarlo así."
    />
  );
}

/** Campo «Departamento» con los 33 de Colombia. */
export function DepartmentInput({ value, onChange, className, style, placeholder = "Escribe y elige", ariaLabel = "Departamento", required }: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
}) {
  const { data, load } = usePlaces();
  const v = value ?? "";
  const options = data ? searchDepts(data.depts, v).map((n) => ({ key: n, label: n })) : [];
  return (
    <Suggest
      value={v}
      onChange={onChange}
      options={options}
      onPick={(o) => onChange(o.label)}
      onFocus={load}
      onBlur={() => {
        // «meta» o «bogota» → el nombre oficial.
        if (!data) return;
        const code = deptCode(data.depts, v);
        if (code && data.depts[code] !== v) onChange(data.depts[code]);
      }}
      className={className}
      style={style}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      required={required}
      empty="No es un departamento de Colombia."
    />
  );
}
