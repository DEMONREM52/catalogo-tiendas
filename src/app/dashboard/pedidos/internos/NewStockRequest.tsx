"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, PackageSearch, Search, Sparkles, X, Zap } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Thumb, useProductSearch, useThumbs } from "../../inventario/LineEditor";
import { srError } from "./types";

export type PointOption = { id: string; name: string; kind: string; is_default?: boolean };
type Line = { product_id: string; name: string; sku: string | null; qty: number; there: number; here: number | null };
type Suggestion = { product_id: string; name: string; sku: string | null; image_url: string | null; here: number; there: number };

const field = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-fuchsia-500/25";
const fieldStyle = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" };

/** Nuevo pedido interno: de qué punto, a quién, qué productos (viendo lo que hay allá). */
export function NewStockRequest({
  open,
  onClose,
  storeId,
  points,
  myPoint,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  storeId: string;
  points: PointOption[];
  myPoint: string | null;
  onCreated: (id: string) => void;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const firstPoint = myPoint ?? points.find((p) => p.kind === "point")?.id ?? points[0]?.id ?? "";
  const [from, setFrom] = useState(firstPoint);
  const [to, setTo] = useState(() => points.find((p) => p.id !== firstPoint && p.is_default)?.id ?? points.find((p) => p.id !== firstPoint && p.kind !== "point")?.id ?? points.find((p) => p.id !== firstPoint)?.id ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [neededBy, setNeededBy] = useState("");
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [saving, setSaving] = useState(false);
  const { hits, loading } = useProductSearch({ storeId, warehouseId: to || null, query: q, enabled: open && focus && Boolean(to), limit: 12 });
  const thumbs = useThumbs([...lines.map((l) => l.product_id), ...hits.map((h) => h.id)]);
  const toName = points.find((p) => p.id === to)?.name ?? "allá";

  useEffect(() => {
    if (!open || !from || !to || from === to) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_stock_request_suggestions", { p_store: storeId, p_from: from, p_to: to, p_low: 0 }).then(({ data }) => {
      if (alive) setSuggestions((data ?? []) as Suggestion[]);
    });
    return () => { alive = false; };
  }, [open, storeId, from, to]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const added = useMemo(() => new Set(lines.map((l) => l.product_id)), [lines]);
  const pendingSuggestions = (suggestions ?? []).filter((s) => !added.has(s.product_id));

  function add(line: Line) {
    setLines((cur) => (cur.some((l) => l.product_id === line.product_id) ? cur.map((l) => (l.product_id === line.product_id ? { ...l, qty: l.qty + 1 } : l)) : [...cur, line]));
  }

  async function submit() {
    if (!from || !to) return void Swal.fire({ icon: "warning", title: "Elige los puntos", background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!lines.length) return void Swal.fire({ icon: "warning", title: "Agrega productos", background: "var(--t-bg-base)", color: "var(--t-text)" });
    setSaving(true);
    const { data, error } = await supabaseBrowser().rpc("erp_stock_request_create", {
      p_store: storeId, p_from: from, p_to: to,
      p_items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
      p_note: note.trim() || null, p_priority: urgent ? "urgent" : "normal", p_needed_by: neededBy || null,
    });
    setSaving(false);
    if (error) return void Swal.fire({ icon: "error", title: "No se pudo enviar", text: srError(error), background: "var(--t-bg-base)", color: "var(--t-text)" });
    void Swal.fire({ icon: "success", title: "¡Pedido enviado!", text: `${toName} ya recibió la notificación. Se abrió el chat del pedido.`, timer: 1800, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
    onCreated(String(data));
  }

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="new-sr" className="fixed inset-0 z-120 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Nuevo pedido interno"
            className="relative flex h-dvh w-full max-w-2xl flex-col border-l shadow-[0_0_80px_rgba(0,0,0,0.45)]"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>Nuevo pedido interno</p>
                <h3 className="mt-0.5 text-lg font-black">Pide mercancía a otro punto o bodega</h3>
              </div>
              <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
                <X size={16} />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
                <label className="block text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                  Pide (llega a)
                  <select className={`${field} mt-1`} style={fieldStyle} value={from} disabled={Boolean(myPoint)} onChange={(e) => { setFrom(e.target.value); setLines([]); if (e.target.value === to) setTo(""); }}>
                    {points.map((p) => <option key={p.id} value={p.id}>{p.kind === "point" ? "📍" : "🏬"} {p.name}</option>)}
                  </select>
                </label>
                <span className="hidden pb-3 sm:block"><ArrowRight size={18} style={{ color: "var(--t-muted)" }} className="rotate-180" /></span>
                <label className="block text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                  Le pide a (sale de)
                  <select className={`${field} mt-1`} style={fieldStyle} value={to} onChange={(e) => { setTo(e.target.value); setLines([]); }}>
                    <option value="">Elegir…</option>
                    {points.filter((p) => p.id !== from).map((p) => <option key={p.id} value={p.id}>{p.kind === "point" ? "📍" : "🏬"} {p.name}</option>)}
                  </select>
                </label>
              </div>

              {to && pendingSuggestions.length ? (
                <section className="rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, transparent)", background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-bold"><Sparkles size={15} /> Agotados en tu punto que sí hay en {toName}</p>
                    <button type="button" onClick={() => pendingSuggestions.forEach((s) => add({ product_id: s.product_id, name: s.name, sku: s.sku, qty: 1, there: s.there, here: s.here }))} className="rounded-full px-3 py-1 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}>
                      Agregar todos ({pendingSuggestions.length})
                    </button>
                  </div>
                  <div className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                    {pendingSuggestions.slice(0, 60).map((s) => (
                      <button key={s.product_id} type="button" onClick={() => add({ product_id: s.product_id, name: s.name, sku: s.sku, qty: 1, there: s.there, here: s.here })} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                        <span className="font-semibold">{s.name}</span>
                        <span style={{ color: "#22c55e" }}>allá {s.there}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {to ? (
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3.5 top-3.5 opacity-60" />
                  <input
                    className={field}
                    style={{ ...fieldStyle, paddingLeft: "2.4rem" }}
                    placeholder={`Buscar producto para pedir a ${toName}…`}
                    value={q}
                    onFocus={() => setFocus(true)}
                    onBlur={() => window.setTimeout(() => setFocus(false), 150)}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && hits[0]) {
                        e.preventDefault();
                        add({ product_id: hits[0].id, name: hits[0].name, sku: hits[0].sku, qty: 1, there: hits[0].wh_qty, here: null });
                        setQ("");
                      }
                    }}
                  />
                  {focus ? (
                    <div className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-2xl border p-1 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                      {loading && !hits.length ? <p className="p-3 text-sm" style={{ color: "var(--t-muted)" }}>Buscando…</p> : null}
                      {!loading && !hits.length ? <p className="p-3 text-sm" style={{ color: "var(--t-muted)" }}>Sin resultados.</p> : null}
                      {hits.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { add({ product_id: h.id, name: h.name, sku: h.sku, qty: 1, there: h.wh_qty, here: null }); setQ(""); }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-[color:var(--t-card-bg)]"
                        >
                          <Thumb src={thumbs[h.id]} size={38} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{h.name}</span>
                            <span className="text-xs" style={{ color: "var(--t-muted)" }}>{h.sku ?? "Sin código"}</span>
                          </span>
                          <span className="text-right text-xs font-bold" style={{ color: h.wh_qty > 0 ? "#22c55e" : "#ef4444" }}>
                            {h.wh_qty > 0 ? `Hay ${h.wh_qty} allá` : "Agotado allá"}
                            {added.has(h.id) ? <span className="block" style={{ color: "var(--t-accent)" }}>En el pedido ✓</span> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {lines.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                  <PackageSearch className="mx-auto mb-2 opacity-60" />
                  Busca productos o toca los agotados sugeridos para armar el pedido.
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {lines.map((l) => (
                      <motion.div key={l.product_id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }} className="flex items-center gap-3 rounded-2xl border p-2.5" style={{ borderColor: l.qty > l.there ? "color-mix(in oklab, #f59e0b 50%, transparent)" : "var(--t-card-border)" }}>
                        <Thumb src={thumbs[l.product_id]} size={42} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{l.name}</p>
                          <p className="text-xs" style={{ color: l.there > 0 ? "var(--t-muted)" : "#ef4444" }}>
                            {l.there > 0 ? `Allá hay ${l.there}` : "Allá está agotado"}{l.here !== null ? ` · Aquí ${l.here}` : ""}
                            {l.qty > l.there && l.there > 0 ? <span className="text-amber-500"> · pides más de lo que hay</span> : null}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setLines((cur) => cur.map((x) => (x.product_id === l.product_id ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} className="grid h-8 w-8 place-items-center rounded-lg border text-lg leading-none" style={{ borderColor: "var(--t-card-border)" }} aria-label="Menos">−</button>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={l.qty}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setLines((cur) => cur.map((x) => (x.product_id === l.product_id ? { ...x, qty: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) } : x)))}
                            className="h-8 w-14 rounded-lg border text-center text-sm font-bold outline-none"
                            style={fieldStyle}
                            aria-label={`Cantidad de ${l.name}`}
                          />
                          <button type="button" onClick={() => setLines((cur) => cur.map((x) => (x.product_id === l.product_id ? { ...x, qty: x.qty + 1 } : x)))} className="grid h-8 w-8 place-items-center rounded-lg border text-lg leading-none" style={{ borderColor: "var(--t-card-border)" }} aria-label="Más">+</button>
                        </div>
                        <button type="button" onClick={() => setLines((cur) => cur.filter((x) => x.product_id !== l.product_id))} className="grid h-8 w-8 place-items-center rounded-full border text-xs text-red-400" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }} aria-label={`Quitar ${l.name}`}>
                          ✕
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <textarea className={`${field} min-h-20`} style={fieldStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mensaje para quien prepara (opcional): para cuándo, para qué cliente…" />
                <div className="space-y-2">
                  <button type="button" onClick={() => setUrgent((u) => !u)} className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition" style={urgent ? { background: "#ef4444", borderColor: "transparent", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
                    <Zap size={15} /> {urgent ? "Urgente" : "Marcar urgente"}
                  </button>
                  <label className="block text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                    Lo necesito para
                    <input type="date" className={`${field} mt-1`} style={fieldStyle} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
                  </label>
                </div>
              </div>
            </div>

            <footer className="flex items-center justify-between gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{lines.length} producto{lines.length === 1 ? "" : "s"} · {lines.reduce((s, l) => s + l.qty, 0)} und.</p>
              <button type="button" onClick={() => void submit()} disabled={saving || !lines.length || !to} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
                {saving ? "Enviando…" : "📨 Enviar pedido y abrir chat"}
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
