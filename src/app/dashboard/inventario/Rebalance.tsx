"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Sug = {
  product_id: string; name: string; sku: string | null; image_url: string | null; qty: number;
  from_id: string; from_name: string; from_kind: string; from_qty: number; from_sold: number;
  to_id: string; to_name: string; to_qty: number; to_sold: number; to_days_left: number | null;
};
export type RebalancePlan = {
  from: string;
  targets: string[];
  lines: Array<{ product_id: string; name: string; sku: string | null; available: number }>;
  matrix: Record<string, Record<string, number>>;
};

/**
 * Traslados sugeridos entre puntos (función opcional, 20261313): dónde sobra y dónde falta.
 * Solo sugiere: «Armar traslado» llena el formulario de traslado y la persona revisa y envía.
 */
export function RebalancePanel({ storeId, pointId, onUse, onClose }: { storeId: string; pointId: string | null; onUse: (p: RebalancePlan) => void; onClose: () => void }) {
  const [days, setDays] = useState(30);
  const [cover, setCover] = useState(30);
  const [items, setItems] = useState<Sug[] | null>(null);
  const [error, setError] = useState("");
  const [skip, setSkip] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setItems(null);
    const { data, error: e } = await supabaseBrowser().rpc("erp_rebalance_suggestions", { p_store: storeId, p_days: days, p_cover: cover });
    const r = data as { ok: boolean; message?: string; items?: Sug[] } | null;
    if (e || !r?.ok) return setError(e && /Could not find|schema cache/i.test(e.message) ? "Falta correr en Supabase la migración 20261313_clientes_y_operacion_opcional.sql." : e?.message ?? r?.message ?? "No se pudo.");
    setError("");
    setItems((r.items ?? []).filter((x) => !pointId || x.from_id === pointId));
  }, [storeId, days, cover, pointId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  // Un traslado por origen (puede ir a varios destinos a la vez).
  const groups = useMemo(() => {
    const m = new Map<string, { from: string; name: string; kind: string; rows: Sug[] }>();
    for (const s of items ?? []) {
      if (!m.has(s.from_id)) m.set(s.from_id, { from: s.from_id, name: s.from_name, kind: s.from_kind, rows: [] });
      m.get(s.from_id)!.rows.push(s);
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [items]);
  const k = (s: Sug) => `${s.product_id}:${s.from_id}:${s.to_id}`;

  function use(g: { from: string; rows: Sug[] }) {
    const rows = g.rows.filter((s) => !skip.has(k(s)));
    if (!rows.length) return;
    const lines = new Map<string, RebalancePlan["lines"][number]>();
    const matrix: RebalancePlan["matrix"] = {};
    for (const s of rows) {
      if (!lines.has(s.product_id)) lines.set(s.product_id, { product_id: s.product_id, name: s.name, sku: s.sku, available: s.from_qty });
      matrix[s.product_id] = { ...(matrix[s.product_id] ?? {}), [s.to_id]: s.qty };
    }
    onUse({ from: g.from, targets: [...new Set(rows.map((s) => s.to_id))], lines: [...lines.values()], matrix });
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-end bg-black/50 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Desbalances entre puntos">
      <div className="vm-sheet flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] border sm:rounded-[28px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }} onClick={(e) => e.stopPropagation()}>
        <div className="border-b p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-black">🔀 Desbalances entre puntos</h3>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>Dónde sobra (no se vende o hay de más) y dónde se está acabando. Escoge y arma el traslado: tú lo revisas antes de enviarlo.</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">✕</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <label className="flex items-center gap-1.5 font-bold">Ventas de los últimos
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
                {[15, 30, 60, 90].map((d) => <option key={d} value={d}>{d} días</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 font-bold">Que alcance para
              <select value={cover} onChange={(e) => setCover(Number(e.target.value))} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
                {[15, 30, 45, 60].map((d) => <option key={d} value={d}>{d} días</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error ? <p className="text-sm" style={{ color: "#ef4444" }}>⚠️ {error}</p> : null}
          {!items && !error ? <p className="text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="mr-1 inline animate-spin" /> Revisando existencias y ventas de cada punto…</p> : null}
          {items && !items.length ? (
            <div className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
              ✅ Todo está bien repartido: ningún punto se está quedando sin lo que vende mientras otro lo tiene quieto.
            </div>
          ) : null}
          {groups.map((g) => {
            const chosen = g.rows.filter((s) => !skip.has(k(s)));
            return (
              <section key={g.from} className="rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3" style={{ borderColor: "var(--t-card-border)" }}>
                  <p className="font-black">{g.kind === "point" ? "📍" : "🏬"} Desde {g.name} <span className="text-xs font-bold opacity-60">· {g.rows.length} sugerencia(s)</span></p>
                  <button type="button" disabled={!chosen.length} onClick={() => use(g)} className="rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)" }}>
                    🚚 Armar traslado ({chosen.reduce((a, s) => a + s.qty, 0)} und.)
                  </button>
                </div>
                <ul className="divide-y" style={{ borderColor: "var(--t-card-border)" }}>
                  {g.rows.map((s) => {
                    const off = skip.has(k(s));
                    return (
                      <li key={k(s)} className="flex items-center gap-3 p-3" style={{ opacity: off ? 0.45 : 1 }}>
                        <input type="checkbox" checked={!off} onChange={() => setSkip((p) => { const n = new Set(p); if (n.has(k(s))) n.delete(k(s)); else n.add(k(s)); return n; })} aria-label={`Incluir ${s.name}`} />
                        {s.image_url ? <img src={s.image_url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-xl object-cover" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl">📦</span>}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-extrabold">{s.name}</p>
                          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                            <b>{s.from_name}</b> tiene {s.from_qty}{s.from_sold ? ` y vendió ${s.from_sold}` : " y no vende"} · <b>{s.to_name}</b> tiene {s.to_qty} y vendió {s.to_sold}
                            {s.to_days_left !== null ? ` (le alcanza ~${s.to_days_left} días)` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 text-right text-sm font-black" style={{ color: "#0ea5e9" }}>→ {s.qty}<span className="block text-[10px] font-bold opacity-70">a {s.to_name}</span></p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
