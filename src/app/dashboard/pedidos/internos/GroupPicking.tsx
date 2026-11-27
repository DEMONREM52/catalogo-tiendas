"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m as motion } from "framer-motion";
import { Check, ListChecks, Search, Undo2, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { startPoll } from "@/lib/net/poll";
import { Thumb, useThumbs } from "../../inventario/LineEditor";
import { ZoomableThumb } from "@/components/ui/ZoomableImage";
import { ProductName } from "@/components/ProductName";
import { saveQtys } from "./qty-save";
import { splitEven } from "./split";
import { STOCK_REQUESTS_CHANGED_EVENT, SR_STATUS, srError, type SrDetail } from "./types";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Check = { item_id: string; side: "pack" | "receive"; by: string | null; at: string };
type Part = { requestId: string; number: number; point: string; itemId: string; qty: number; requested: number };
type Row = { product_id: string; name: string; sku: string | null; image_url: string | null; total: number; requested: number; source_now: number; parts: Part[] };
export type Batch = { id: string; number: number };

/**
 * Sacar varios pedidos a la vez: una sola lista con el total de cada producto y cuánto va para cada punto.
 * Con lote (20261346) queda guardado para todos, en vivo, y se puede deshacer; cada pedido sigue siendo suyo.
 * Al chulear un producto aquí se chulea «empacado» en cada pedido que lo lleva. Tocar la cantidad de un punto
 * cambia lo que se le envía (se guarda al instante); «Repartir lo que hay» divide lo disponible si no alcanza.
 * Las firmas y el envío se siguen haciendo en cada pedido.
 */
export function GroupPicking({ ids: idsIn, batch, onClose, onOpen, onChanged }: {
  ids: string[]; batch?: Batch | null; onClose: () => void; onOpen: (id: string) => void; onChanged: () => void;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const idsKey = idsIn.join(",");
  const ids = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);
  const [details, setDetails] = useState<SrDetail[] | null>(null);
  const [checks, setChecks] = useState<Record<string, Check[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadChecks = useCallback(async () => {
    const res = await Promise.all(ids.map((id) => supabaseBrowser().rpc("erp_sr_item_checks", { p_request: id })));
    setChecks(Object.fromEntries(res.map((c, i) => [ids[i], !c.error && Array.isArray(c.data) ? (c.data as Check[]) : []])));
  }, [ids]);
  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const res = await Promise.all(ids.map((id) => sb.rpc("erp_stock_request_detail", { p_request: id })));
    const bad = res.find((d) => d.error);
    if (bad) return setError(srError(bad.error));
    setError(null);
    setDetails(res.map((d) => d.data as SrDetail));
    await loadChecks();
  }, [ids, loadChecks]);

  // En vivo: lo que cambia otra persona (cantidades, productos, estado) llega por la conexión única del panel;
  // lo chuleado, por la tabla de la lista de chequeo. Respaldo cada 30 s con la pestaña a la vista.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    const poll = startPoll(() => loadRef.current(), { every: 30_000, minGap: 10_000, firstDelay: 0 });
    let t = 0;
    const onChange = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      if (id && !ids.includes(id)) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => poll.run(), 350);
    };
    window.addEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange);
    let c = 0;
    const ch = supabaseBrowser()
      .channel(`sr-group-checks-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_sr_item_checks", filter: `request_id=in.(${ids.join(",")})` }, () => {
        window.clearTimeout(c);
        c = window.setTimeout(() => void loadChecks(), 250);
      })
      .subscribe();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      poll.stop();
      window.clearTimeout(t);
      window.clearTimeout(c);
      window.removeEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange);
      void supabaseBrowser().removeChannel(ch);
      document.body.style.overflow = prev;
    };
  }, [ids, loadChecks]);

  // Solo los pedidos que se pueden empacar ahora (por si alguien más ya los envió).
  const open = useMemo(() => (details ?? []).filter((d) => d.access.attend && (d.request.status === "pending" || d.request.status === "preparing")), [details]);
  const packed = useCallback((reqId: string, itemId: string) => (checks[reqId] ?? []).some((c) => c.side === "pack" && c.item_id === itemId), [checks]);

  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const d of open) {
      for (const i of d.items) {
        const qty = i.qty_approved ?? i.qty_requested;
        // Lo que se puso en 0 se sigue viendo (para poder repartirle), si era algo pedido.
        if (qty <= 0 && i.qty_requested <= 0) continue;
        const row = m.get(i.product_id) ?? { product_id: i.product_id, name: i.name, sku: i.sku, image_url: i.image_url, total: 0, requested: 0, source_now: i.source_now, parts: [] };
        row.total += qty;
        row.requested += i.qty_requested;
        row.parts.push({ requestId: d.request.id, number: d.request.number, point: d.request.from_name, itemId: i.id, qty, requested: i.qty_requested });
        m.set(i.product_id, row);
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [open]);
  const isDone = useCallback((r: Row) => r.parts.every((p) => p.qty <= 0 || packed(p.requestId, p.itemId)), [packed]);
  const doneRows = rows.filter(isDone).length;
  const units = rows.reduce((s, r) => s + r.total, 0);
  const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(q.trim()).split(/\s+/).filter(Boolean);
  const shown = rows
    .filter((r) => !onlyPending || !isDone(r))
    .filter((r) => !words.length || words.every((w) => fold(`${r.name} ${r.sku ?? ""}`).includes(w)));
  // Lo chuleado baja al final: lo que falta queda arriba, a la mano.
  const ordered = [...shown.filter((r) => !isDone(r)), ...shown.filter(isDone)];
  const thumbs = useThumbs(rows.map((r) => r.product_id));
  const origins = [...new Set(open.map((d) => d.request.to_name))];

  async function toggle(r: Row) {
    if (busy) return;
    const on = !isDone(r);
    const targets = r.parts.filter((p) => p.qty > 0 && packed(p.requestId, p.itemId) !== on);
    navigator.vibrate?.(on ? 18 : 8);
    setBusy(r.product_id);
    // Al instante en pantalla; si la base no acepta alguno, se vuelve a cargar lo real.
    setChecks((cur) => {
      const next = { ...cur };
      for (const p of targets) {
        const list = next[p.requestId] ?? [];
        next[p.requestId] = on ? [...list, { item_id: p.itemId, side: "pack", by: "Tú", at: new Date().toISOString() }] : list.filter((c) => !(c.side === "pack" && c.item_id === p.itemId));
      }
      return next;
    });
    const res = await Promise.all(targets.map((p) => supabaseBrowser().rpc("erp_sr_item_check", { p_request: p.requestId, p_item: p.itemId, p_side: "pack", p_on: on })));
    setBusy(null);
    const bad = res.find((x) => x.error);
    if (bad) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo chulear", text: srError(bad.error) });
      void load();
    }
    onChanged();
  }

  async function saveParts(lines: Array<{ item_id: string; qty: number }>, key: string) {
    setBusy(key);
    const res = await saveQtys(lines);
    setBusy(null);
    if (!res.ok) {
      void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: res.missing ? "Falta correr en Supabase la migración 20261346_lotes_pedidos.sql." : res.error });
      return;
    }
    await load();
    onChanged();
  }

  /** Cambiar cuánto va para un punto (queda guardado en ese pedido y lo ven todos). */
  async function editPart(r: Row, p: Part) {
    if (busy) return;
    const res = await Swal.fire({
      ...swal, title: `${p.point} · #${p.number}`,
      html: `<p style="font-size:13px;opacity:.85"><b>${esc(r.name)}</b><br/>Pidió <b>${p.requested}</b> · hay <b>${r.source_now}</b> en total para ${r.parts.length} punto${r.parts.length === 1 ? "" : "s"}.</p>`,
      input: "number", inputValue: String(p.qty), inputAttributes: { min: "0", step: "1", inputmode: "numeric" },
      showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      inputValidator: (v) => (/^\d{1,6}$/.test(String(v ?? "").trim()) && Number(v) <= 100000 ? null : "Escribe una cantidad (0 o más)."),
    });
    if (!res.isConfirmed) return;
    const qty = Number(String(res.value).trim());
    if (qty === p.qty) return;
    await saveParts([{ item_id: p.itemId, qty }], r.product_id);
  }

  /** No alcanza: lo que hay se reparte en proporción a lo que pidió cada punto (con vista previa). */
  async function splitRow(r: Row) {
    if (busy) return;
    const plan = splitEven(r.source_now, r.parts.map((p) => p.requested));
    const res = await Swal.fire({
      ...swal, icon: "question", title: "Repartir lo que hay",
      html: `<div style="text-align:left;font-size:13px;display:grid;gap:6px">
        <p><b>${esc(r.name)}</b>: piden <b>${r.requested}</b> y hay <b>${Math.max(0, r.source_now)}</b>. Se reparte según lo que pidió cada uno:</p>
        ${r.parts.map((p, i) => `<p>• ${esc(p.point)} (#${p.number}): pidió ${p.requested} → <b>${plan[i]}</b></p>`).join("")}
        <p style="opacity:.7">Puedes cambiar cualquiera después tocando su cantidad.</p></div>`,
      showCancelButton: true, confirmButtonText: "Repartir", cancelButtonText: "Cancelar",
    });
    if (!res.isConfirmed) return;
    await saveParts(r.parts.map((p, i) => ({ item_id: p.itemId, qty: plan[i] })), r.product_id);
  }

  /** Deshacer el lote (o sacar un pedido). Cada pedido queda como está. */
  async function undo(requestId?: string) {
    if (!batch || busy) return;
    const d = requestId ? open.find((x) => x.request.id === requestId) : null;
    const res = await Swal.fire({
      ...swal, icon: "question",
      title: d ? `¿Sacar #${d.request.number} del lote?` : `¿Deshacer el lote #${batch.number}?`,
      text: (d && open.length > 2 ? "Los demás siguen en el lote. " : "Los pedidos vuelven a estar sueltos. ")
        + "Nada se pierde: lo que repartiste y lo empacado se quedan en cada pedido.",
      showCancelButton: true, confirmButtonText: d ? "Sacar del lote" : "Deshacer lote", cancelButtonText: "Cancelar",
    });
    if (!res.isConfirmed) return;
    setBusy("undo");
    const { data, error: e } = await supabaseBrowser().rpc("erp_sr_batch_undo", { p_batch: batch.id, p_request: requestId ?? null });
    setBusy(null);
    if (e) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: srError(e) });
    onChanged();
    if ((data as { undone?: boolean } | null)?.undone) {
      void Swal.fire({ ...swal, icon: "success", title: `Lote #${batch.number} deshecho`, timer: 1600, showConfirmButton: false });
      onClose();
    }
  }

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      <motion.div key="group-pick" className="fixed inset-0 z-120 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
        <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
          className="relative flex h-dvh w-full max-w-2xl flex-col border-l shadow-[0_0_80px_rgba(0,0,0,0.45)]"
          style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
          <header className="border-b px-3 py-2.5 sm:px-5 sm:py-4" style={{ borderColor: "var(--t-card-border)" }}>
            <div className="flex items-center gap-2">
              <ListChecks size={18} style={{ color: "var(--t-accent)" }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black sm:text-base">🧺 {batch ? `Lote #${batch.number} · ` : ""}Sacar {ids.length} pedidos a la vez</p>
                <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {open.map((d) => `#${d.request.number} ${d.request.from_name}`).join(" · ") || "Cargando…"}
                </p>
              </div>
              {batch ? (
                <button type="button" onClick={() => void undo()} disabled={busy === "undo"}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}
                  title="Los pedidos vuelven a estar sueltos; nada se pierde">
                  <Undo2 size={14} /> <span className="hidden sm:inline">Deshacer lote</span>
                </button>
              ) : null}
              <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
            </div>
            {!batch ? (
              <p className="mt-1.5 rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: "#f59e0b", color: "#f59e0b" }}>
                Esta lista no quedó guardada como lote (falta correr la migración 20261346): solo la ves tú.
              </p>
            ) : null}
            {details ? (
              <>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="font-bold">
                    <span style={{ color: "#22c55e" }}>{doneRows}</span>/{rows.length} productos · {units} und.
                    {origins.length === 1 ? <span style={{ color: "var(--t-muted)" }}> · salen de {origins[0]}</span> : null}
                  </span>
                  <button type="button" onClick={() => setOnlyPending((v) => !v)} className="ml-auto shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                    style={onlyPending ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>
                    {onlyPending ? "Ver todos" : `Faltan ${rows.length - doneRows}`}
                  </button>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
                  <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#22c55e,#4ade80)" }} animate={{ width: `${rows.length ? (doneRows / rows.length) * 100 : 0}%` }} />
                </div>
                <label className="mt-2 flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: q ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  <Search size={15} style={{ color: "var(--t-muted)" }} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} type="search" enterKeyHint="done" placeholder="Buscar en la lista (nombre o referencia)…"
                    onKeyDown={(e) => {
                      // Enter no chulea nada (2026-11-27): escribir o pistolear solo filtra; se marca tocando el producto.
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ padding: 0, border: 0, minHeight: 0 }} />
                </label>
                <p className="mt-1.5 hidden text-[11px] sm:block" style={{ color: "var(--t-muted)" }}>
                  Toca el producto para chulearlo en todos los pedidos. Toca la cantidad de un punto para cambiar lo que se le envía.
                </p>
              </>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 sm:p-4">
            {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}
            {!details && !error ? <div className="h-64 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg)" }} /> : null}
            {details && open.length < details.length ? (
              <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "#f59e0b", color: "#f59e0b" }}>
                {details.length - open.length === 1 ? "Un pedido ya no está" : `${details.length - open.length} pedidos ya no están`} por preparar (otra persona lo envió o se cerró): no sale en la lista.
              </p>
            ) : null}
            {details && doneRows === rows.length && rows.length ? (
              <p className="rounded-2xl border p-3 text-center text-sm font-bold" style={{ borderColor: "#22c55e", color: "#22c55e" }}>✅ ¡Todo empacado! Ahora firma y envía cada pedido abajo.</p>
            ) : null}
            {ordered.map((r) => {
              const done = isDone(r);
              const some = !done && r.parts.some((p) => packed(p.requestId, p.itemId));
              const short = r.source_now < r.total;
              // Hay algo, pero no alcanza para lo que pidieron: se ofrece repartir.
              const canSplit = r.parts.length > 1 && r.source_now > 0 && r.source_now < r.requested;
              const img = thumbs[r.product_id] ?? r.image_url;
              return (
                <motion.div key={r.product_id} layout transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  role="button" aria-pressed={done} onClick={() => void toggle(r)}
                  className="flex cursor-pointer touch-manipulation select-none items-center gap-2.5 rounded-2xl border p-2 transition-colors active:scale-[0.99] sm:p-2.5"
                  style={done
                    ? { borderColor: "color-mix(in oklab, #22c55e 65%, transparent)", background: "color-mix(in oklab, #22c55e 14%, transparent)" }
                    : { borderColor: short ? "color-mix(in oklab, #f59e0b 50%, transparent)" : "var(--t-card-border)" }}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2"
                    style={done ? { background: "#22c55e", borderColor: "#22c55e", color: "#fff" } : { borderColor: some ? "#22c55e" : "var(--t-accent)" }}>
                    {done ? <Check size={20} strokeWidth={3} /> : busy === r.product_id ? "…" : null}
                  </span>
                  {img ? <ZoomableThumb src={img} alt={r.name} className="block h-12 w-12 shrink-0 overflow-hidden rounded-xl" imgClassName="h-full w-full object-cover" /> : <Thumb src={null} size={48} />}
                  <div className="min-w-0 flex-1">
                    <ProductName name={r.name} className="text-[13px] font-bold leading-snug sm:text-sm" />
                    {r.sku ? <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{r.sku}</p> : null}
                    {/* Cuánto va para cada punto: se toca para cambiarlo. */}
                    <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {r.parts.map((p) => (
                        <button key={p.itemId} type="button" disabled={!!busy}
                          onClick={(e) => { e.stopPropagation(); void editPart(r, p); }}
                          title={`Pidió ${p.requested}. Toca para cambiar cuánto se envía a ${p.point}`}
                          className="rounded-md border border-transparent px-1.5 py-px font-semibold transition hover:border-current disabled:opacity-60"
                          style={packed(p.requestId, p.itemId) ? { background: "color-mix(in oklab, #22c55e 18%, transparent)", color: "#22c55e" }
                            : p.qty !== p.requested ? { background: "color-mix(in oklab, #0ea5e9 16%, transparent)", color: "#38bdf8" }
                            : { background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}>
                          {p.point} <b>{p.qty}</b>{p.qty !== p.requested ? <span className="opacity-70"> de {p.requested}</span> : null} ✎
                        </button>
                      ))}
                      {canSplit ? (
                        <button type="button" disabled={!!busy} onClick={(e) => { e.stopPropagation(); void splitRow(r); }}
                          className="rounded-md px-1.5 py-px font-bold disabled:opacity-60" style={{ background: "color-mix(in oklab, #f59e0b 18%, transparent)", color: "#f59e0b" }}>
                          ⚖️ Repartir lo que hay
                        </button>
                      ) : null}
                    </p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block text-xl font-black tabular-nums leading-none">{r.total}</span>
                    <span className="block text-[10px]" style={{ color: short ? "#f59e0b" : "var(--t-muted)" }}>hay {r.source_now}</span>
                  </span>
                </motion.div>
              );
            })}
          </div>

          {/* Cada pedido se firma y se envía por aparte (las firmas son de cada traslado). */}
          {open.length ? (
            <footer className="border-t p-2.5 sm:p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Firmar y enviar cada pedido</p>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
                {open.map((d) => {
                  const live = d.items.filter((i) => (i.qty_approved ?? i.qty_requested) > 0);
                  const total = live.length;
                  const done = live.filter((i) => packed(d.request.id, i.id)).length;
                  const st = SR_STATUS[d.request.status];
                  return (
                    <span key={d.request.id} className="relative shrink-0">
                      <button type="button" onClick={() => onOpen(d.request.id)}
                        className="rounded-xl border px-3 py-2 pr-8 text-left text-xs"
                        style={{ borderColor: done === total ? "#22c55e" : `color-mix(in oklab, ${st.color} 45%, var(--t-card-border))` }}>
                        <span className="block font-black">#{d.request.number} → {d.request.from_name}</span>
                        <span className="block" style={{ color: done === total ? "#22c55e" : "var(--t-muted)" }}>{done}/{total} empacados · abrir →</span>
                      </button>
                      {batch ? (
                        <button type="button" onClick={() => void undo(d.request.id)} disabled={!!busy} aria-label={`Sacar #${d.request.number} del lote`} title="Sacar del lote"
                          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-[11px] disabled:opacity-50" style={{ color: "var(--t-muted)" }}>
                          <X size={13} />
                        </button>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </footer>
          ) : null}
        </motion.aside>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
