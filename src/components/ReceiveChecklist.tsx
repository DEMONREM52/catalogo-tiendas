"use client";

import { useEffect, useState } from "react";
import { Check, Minus, Plus, Search, X } from "lucide-react";
import { ZoomableThumb } from "@/components/ui/ZoomableImage";

export type ReceiveItem = { id: string; name: string; sku?: string | null; image_url?: string | null; sent: number };

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function readChecked(key?: string): string[] {
  if (!key) return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Recibir mercancía igual en todas partes (pedido interno, traslado en el panel y enlace del traslado):
 * tocar el producto lo marca como contado (verde, sube), − / + o escribir para lo que llegó distinto,
 * buscador (Enter con un solo resultado lo marca: sirve con lector de códigos), «Faltan» y barra de avance.
 * Lo contado se guarda en este equipo (storageKey) para no perderlo si se cierra la página.
 */
export function ReceiveChecklist({
  items, value, onChange, storageKey, max = "sent",
}: {
  items: ReceiveItem[];
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  storageKey?: string;
  /** "sent": no deja pasar de lo enviado (traslados). number: tope libre. */
  max?: "sent" | number;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(readChecked(storageKey)));
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...checked]));
    } catch {
      /* comodidad: si no se puede guardar, igual funciona */
    }
  }, [checked, storageKey]);

  const qty = (i: ReceiveItem) => value[i.id] ?? i.sent;
  const cap = (i: ReceiveItem) => (max === "sent" ? i.sent : max);
  const set = (i: ReceiveItem, n: number) => onChange({ ...value, [i.id]: Math.min(cap(i), Math.max(0, Math.floor(n) || 0)) });
  const toggle = (id: string) => {
    navigator.vibrate?.(14);
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const done = items.filter((i) => checked.has(i.id)).length;
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  // Lo que falta contar arriba; lo contado baja (en verde).
  const shown = [...items.filter((i) => !checked.has(i.id)), ...items.filter((i) => checked.has(i.id))]
    .filter((i) => !onlyPending || !checked.has(i.id))
    .filter((i) => !words.length || words.every((w) => fold(`${i.name} ${i.sku ?? ""}`).includes(w)));
  const missing = items.reduce((s, i) => s + Math.max(0, i.sent - qty(i)), 0);
  const extra = items.reduce((s, i) => s + Math.max(0, qty(i) - i.sent), 0);
  const all = items.length > 0 && done === items.length;

  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-10 rounded-2xl border p-2.5" style={{ borderColor: all ? "#22c55e" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base, #0b0b0b) 94%, transparent)" }}>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-bold">
            📥 Contado <span className="tabular-nums" style={{ color: "#22c55e" }}>{done}</span>/{items.length}
            {missing ? <span className="ml-1.5 text-xs font-bold" style={{ color: "#f59e0b" }}>· faltan {missing} und.</span> : null}
            {extra ? <span className="ml-1.5 text-xs font-bold" style={{ color: "#0ea5e9" }}>· {extra} de más</span> : null}
          </p>
          <button type="button" onClick={() => setOnlyPending((v) => !v)} className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold"
            style={onlyPending ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>
            {onlyPending ? "Ver todos" : `Sin contar (${items.length - done})`}
          </button>
          {done ? (
            <button type="button" onClick={() => setChecked(new Set())} className="shrink-0 text-[11px] font-semibold underline" style={{ color: "var(--t-muted)" }}>Reiniciar</button>
          ) : null}
        </div>
        {items.length > 5 ? (
          <label className="mt-2 flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: query ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <Search size={15} style={{ color: "var(--t-muted)" }} />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)} type="search" enterKeyHint="done"
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown.length === 1) { e.preventDefault(); if (!checked.has(shown[0].id)) toggle(shown[0].id); setQuery(""); }
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Buscar por nombre o código…" aria-label="Buscar producto"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ padding: 0, border: 0, minHeight: 0 }}
            />
            {query ? (
              <>
                <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: "var(--t-muted)" }}>{shown.length}</span>
                <button type="button" onClick={() => setQuery("")} className="grid h-6 w-6 shrink-0 place-items-center rounded-full" aria-label="Borrar búsqueda"><X size={14} /></button>
              </>
            ) : null}
          </label>
        ) : null}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%`, background: "linear-gradient(90deg,#22c55e,#4ade80)" }} />
        </div>
      </div>

      {words.length && !shown.length ? <p className="rounded-xl border p-3 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>🔎 Nada coincide con «{query.trim()}».</p> : null}
      {onlyPending && all ? <p className="rounded-xl border p-3 text-center text-sm" style={{ borderColor: "#22c55e" }}>🎉 Ya contaste todo.</p> : null}

      <ul className="space-y-1.5">
        {shown.map((i) => {
          const on = checked.has(i.id);
          const n = qty(i);
          const diff = n - i.sent;
          return (
            <li key={i.id} onClick={() => toggle(i.id)} role="button" aria-pressed={on}
              className="flex cursor-pointer touch-manipulation select-none items-center gap-2 rounded-2xl border p-2 transition-colors"
              style={on
                ? { borderColor: "color-mix(in oklab, #22c55e 65%, transparent)", background: "color-mix(in oklab, #22c55e 14%, transparent)" }
                : { borderColor: diff < 0 ? "color-mix(in oklab, #f59e0b 55%, transparent)" : "var(--t-card-border)" }}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2" style={on ? { background: "#22c55e", borderColor: "#22c55e", color: "#fff" } : { borderColor: "var(--t-accent)" }}>
                {on ? <Check size={18} strokeWidth={3} /> : null}
              </span>
              {i.image_url ? (
                <span onClick={(e) => e.stopPropagation()} className="block h-11 w-11 shrink-0 overflow-hidden rounded-lg">
                  <ZoomableThumb src={i.image_url} alt={i.name} className="block h-full w-full" imgClassName="h-full w-full object-cover" />
                </span>
              ) : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg" style={{ background: "var(--t-card-bg)" }} aria-hidden>📦</span>}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] font-bold leading-snug">{i.name}</span>
                <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {i.sku ? `${i.sku} · ` : ""}enviadas <b style={{ color: "var(--t-text)" }}>{i.sent}</b>
                  {diff < 0 ? <b style={{ color: "#f59e0b" }}> · faltan {-diff}</b> : diff > 0 ? <b style={{ color: "#0ea5e9" }}> · +{diff}</b> : null}
                </span>
              </span>
              <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => set(i, n - 1)} disabled={n <= 0} aria-label={`Una menos de ${i.name}`} className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-30" style={{ borderColor: "var(--t-card-border)" }}><Minus size={14} /></button>
                <input type="text" inputMode="numeric" value={n} onFocus={(e) => e.currentTarget.select()} aria-label={`Llegaron de ${i.name}`}
                  onChange={(e) => set(i, Number(e.target.value.replace(/\D/g, "")))}
                  className="h-8 w-11 rounded-lg border bg-transparent text-center text-sm font-black outline-none" style={{ borderColor: diff < 0 ? "#f59e0b" : diff > 0 ? "#0ea5e9" : "var(--t-card-border)", color: "var(--t-text)" }} />
                <button type="button" onClick={() => set(i, n + 1)} disabled={n >= cap(i)} aria-label={`Una más de ${i.name}`} className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-30" style={{ borderColor: "var(--t-card-border)" }}><Plus size={14} /></button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
