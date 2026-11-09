"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BellOff, Check, History, Loader2, Megaphone, Undo2, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  CHANNELS, EVERY_OPTIONS, agoDays, bogotaToday, daysSince, ddmmyyyy, everyLabel, publishStatusText, type PublishState,
} from "@/lib/products/radar";

/**
 * «¡Publícame!»: marca que el producto se publicó hoy (en redes, estados, marketplace…) y cada cuánto recordarlo.
 * Cuando ya toca, el megáfono se mueve y la campana avisa. Funciona con la migración 20261305.
 */

type LogRow = { id: string; at: string; by: string | null; channels: string[]; note: string | null; mine: boolean };
const EMPTY: PublishState = { every_days: null, every: 30, last: null, by: null, times: 0, next_due: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toState(s: any): PublishState {
  if (!s) return EMPTY;
  return { every_days: s.every_days ?? null, every: Number(s.every ?? 30), last: s.last_published_at ?? s.last ?? null, by: s.last_by ?? s.by ?? null, times: Number(s.times ?? 0), next_due: s.next_due ?? null };
}

const missing = (m: string) => /Could not find the function|schema cache|does not exist/i.test(m);
const toast = (title: string, icon: "success" | "info" | "error" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2600, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

export function PublishButton({
  storeId, productId, productName, state: given, compact, onChanged,
}: {
  storeId: string | null;
  productId: string;
  productName?: string;
  /** Si ya se tiene el estado (Radar), no se vuelve a pedir. */
  state?: PublishState;
  compact?: boolean;
  onChanged?: (s: PublishState) => void;
}) {
  const [own, setOwn] = useState<PublishState | null>(null);
  const [ready, setReady] = useState<boolean | null>(given ? true : null); // null = cargando; false = falta la migración
  const [open, setOpen] = useState(false);
  const state = own ?? given ?? EMPTY;
  const today = bogotaToday();
  const status = publishStatusText(state, today);
  const hot = status.tone === "due" || status.tone === "late" || status.tone === "never";
  const since = daysSince(state.last, today);

  useEffect(() => {
    if (given || !storeId) return;
    let alive = true;
    void supabaseBrowser().rpc("product_publish_info", { p_store: storeId, p_product: productId }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setReady(missing(error.message) ? false : true); return; }
      const d = data as { ok?: boolean; state?: unknown } | null;
      if (d?.ok) setOwn(toState(d.state));
      setReady(true);
    });
    return () => { alive = false; };
  }, [given, storeId, productId]);

  const changed = useCallback((s: PublishState) => { setOwn(s); onChanged?.(s); }, [onChanged]);

  if (ready === false) {
    return compact ? null : (
      <span className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold opacity-70" style={{ borderColor: "var(--t-card-border)" }} title="Corre la migración 20261305 en Supabase">
        <Megaphone size={14} /> Publícame (falta 20261305)
      </span>
    );
  }

  const tone = status.tone === "late" ? "#e5484d" : status.tone === "due" ? "#f59e0b" : status.tone === "never" ? "#8b5cf6" : "#10b981";
  const label = status.tone === "late" || status.tone === "due" ? "¡Publícame!" : status.tone === "never" ? "Publícame" : since === 0 ? "Publicado hoy" : `Publicado ${agoDays(since)}`;

  return (
    <>
      <motion.button type="button" onClick={() => setOpen(true)} whileTap={{ scale: 0.94 }} whileHover={{ y: -1 }} disabled={ready === null}
        title={`${status.text} · ${everyLabel(state.every)}`}
        className={`relative inline-flex items-center gap-1.5 overflow-visible rounded-xl border font-bold transition disabled:opacity-60 ${compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"}`}
        style={{
          borderColor: `color-mix(in oklab, ${tone} 55%, transparent)`,
          background: hot ? `linear-gradient(135deg, color-mix(in oklab, ${tone} 22%, transparent), color-mix(in oklab, ${tone} 8%, transparent))` : `color-mix(in oklab, ${tone} 10%, transparent)`,
          color: "var(--t-text)",
          boxShadow: hot ? `0 0 0 0 ${tone}` : undefined,
        }}>
        {hot ? <motion.span className="pointer-events-none absolute inset-0 rounded-xl" style={{ boxShadow: `0 0 0 2px ${tone}` }}
          animate={{ opacity: [0.7, 0, 0.7], scale: [1, 1.08, 1] }} transition={{ duration: 1.8, repeat: Infinity }} /> : null}
        <motion.span className="grid place-items-center" style={{ color: tone }}
          animate={hot ? { rotate: [0, -16, 12, -10, 6, 0], scale: [1, 1.15, 1] } : { rotate: 0 }}
          transition={hot ? { duration: 1.1, repeat: Infinity, repeatDelay: 1.4 } : undefined}>
          {ready === null ? <Loader2 size={compact ? 13 : 15} className="animate-spin" /> : <Megaphone size={compact ? 13 : 15} />}
        </motion.span>
        <span className="whitespace-nowrap">{label}</span>
        {hot && !compact ? <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: tone }} /><span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: tone }} /></span> : null}
      </motion.button>
      {open && typeof document !== "undefined"
        ? createPortal(<PublishPanel storeId={storeId} productId={productId} productName={productName} state={state} onClose={() => setOpen(false)} onChanged={changed} />, document.body)
        : null}
    </>
  );
}

function PublishPanel({
  storeId, productId, productName, state, onClose, onChanged,
}: { storeId: string | null; productId: string; productName?: string; state: PublishState; onClose: () => void; onChanged: (s: PublishState) => void }) {
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [custom, setCustom] = useState("");
  const today = bogotaToday();
  const status = publishStatusText(state, today);
  const since = daysSince(state.last, today);

  const loadLog = useCallback(async () => {
    if (!storeId) return;
    const { data } = await supabaseBrowser().rpc("product_publish_info", { p_store: storeId, p_product: productId });
    const d = data as { ok?: boolean; log?: LogRow[]; state?: unknown } | null;
    if (d?.ok) setLog(d.log ?? []);
  }, [storeId, productId]);

  useEffect(() => {
     
    void loadLog();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadLog, onClose]);

  async function run(kind: string, fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, okText: string) {
    setBusy(kind);
    try {
      const { data, error } = await fn();
      if (error) throw new Error(missing(error.message) ? "Falta correr la migración 20261305 en Supabase." : error.message);
      const d = data as { ok?: boolean; message?: string; state?: unknown };
      if (!d?.ok) throw new Error(d?.message ?? "No se pudo.");
      onChanged(toState(d.state));
      void loadLog();
      if (kind === "mark") setBurst((b) => b + 1);
      toast(okText);
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo", "error");
    } finally {
      setBusy(null);
    }
  }

  const sb = supabaseBrowser();
  const mark = () => run("mark", () => sb.rpc("product_publish_mark", { p_store: storeId, p_products: [productId], p_channels: channels }), "📣 ¡Listo! Quedó publicado hoy");
  const setEvery = (days: number) => run(`every-${days}`, () => sb.rpc("product_publish_set_every", { p_store: storeId, p_products: [productId], p_every: days }), days > 0 ? `⏰ Te recuerdo ${everyLabel(days).toLowerCase()}` : "🔕 Sin recordatorio");
  const undo = () => run("undo", () => sb.rpc("product_publish_undo", { p_store: storeId, p_product: productId }), "↩️ Se deshizo la última");

  const canUndo = log?.[0] && Date.now() - Date.parse(log[0].at) < 24 * 3600_000;
  const customDays = Math.floor(Number(custom));
  const tone = status.tone === "late" ? "#e5484d" : status.tone === "due" ? "#f59e0b" : status.tone === "never" ? "#8b5cf6" : status.tone === "off" ? "#64748b" : "#10b981";

  return (
    <motion.div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ background: "rgba(8,6,20,.55)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-modal="true" aria-label="Publicar producto" initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[26px] border p-4 shadow-2xl sm:max-w-md sm:rounded-[26px] sm:p-5"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>

        {/* Encabezado con el megáfono */}
        <div className="flex items-center gap-3 pr-10">
          <div className="relative">
            <motion.span key={burst} className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-lg"
              style={{ background: `linear-gradient(135deg, ${tone}, color-mix(in oklab, ${tone} 60%, #ec4899))` }}
              initial={burst ? { scale: 0.6, rotate: -20 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 14 }}>
              <Megaphone size={26} />
            </motion.span>
            <AnimatePresence>
              {burst ? Array.from({ length: 10 }, (_, i) => (
                <motion.span key={`${burst}-${i}`} className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 rounded-full"
                  style={{ background: ["#f59e0b", "#ec4899", "#10b981", "#8b5cf6", "#0ea5e9"][i % 5] }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: Math.cos((i / 10) * Math.PI * 2) * 46, y: Math.sin((i / 10) * Math.PI * 2) * 46, opacity: 0, scale: 0.4 }}
                  transition={{ duration: 0.8, ease: "easeOut" }} />
              )) : null}
            </AnimatePresence>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>Publícame</p>
            <h2 className="truncate text-lg font-black">{productName || "Este producto"}</h2>
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black" style={{ background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: tone }}>{status.text}</span>
          </div>
        </div>

        {/* Estado */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Última vez</p>
            <p className="font-black">{state.last ? ddmmyyyy(state.last) : "Nunca"}</p>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{state.last ? `${agoDays(since)}${state.by ? ` · ${state.by}` : ""}` : "Aún no lo has marcado"}</p>
          </div>
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Próximo recordatorio</p>
            <p className="font-black">{state.next_due ? ddmmyyyy(state.next_due) : "—"}</p>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{everyLabel(state.every)}{state.times ? ` · ${state.times} vez${state.times === 1 ? "" : "es"}` : ""}</p>
          </div>
        </div>

        {/* Dónde (opcional) */}
        <p className="mt-4 text-xs font-bold">¿Dónde lo publicaste? <span className="font-normal" style={{ color: "var(--t-muted)" }}>(opcional)</span></p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CHANNELS.map((c) => {
            const on = channels.includes(c.key);
            return (
              <motion.button key={c.key} type="button" whileTap={{ scale: 0.92 }} onClick={() => setChannels((x) => on ? x.filter((k) => k !== c.key) : [...x, c.key])}
                className="rounded-full border px-2.5 py-1 text-[11px] font-bold transition"
                style={on ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                {c.emoji} {c.label}{on ? " ✓" : ""}
              </motion.button>
            );
          })}
        </div>

        <motion.button type="button" onClick={() => void mark()} disabled={!!busy} whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-black text-white shadow-lg disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #f59e0b, #ec4899 55%, #8b5cf6)" }}>
          {busy === "mark" ? <Loader2 size={18} className="animate-spin" /> : <Megaphone size={18} />} Lo acabo de publicar
        </motion.button>
        <p className="mt-1 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Empieza a contar desde hoy ({ddmmyyyy(today)}).</p>

        {/* Cada cuánto */}
        <p className="mt-4 text-xs font-bold">⏰ ¿Cada cuánto te lo recuerdo?</p>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {EVERY_OPTIONS.map((o) => {
            const on = state.every === o.days;
            return (
              <motion.button key={o.days} type="button" whileTap={{ scale: 0.94 }} disabled={!!busy} onClick={() => void setEvery(o.days)}
                className="flex items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-[11px] font-bold transition disabled:opacity-60"
                style={on ? { borderColor: "#10b981", background: "color-mix(in oklab, #10b981 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                {busy === `every-${o.days}` ? <Loader2 size={11} className="animate-spin" /> : on ? <Check size={11} /> : o.days === 0 ? <BellOff size={11} /> : null}
                {o.short}
              </motion.button>
            );
          })}
          <form className="col-span-4 mt-1 flex items-center gap-1.5 sm:col-span-4" onSubmit={(e) => { e.preventDefault(); if (customDays >= 1 && customDays <= 365) void setEvery(customDays); }}>
            <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Otro: cada</span>
            <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" placeholder={String(state.every || 10)}
              className="w-16 rounded-lg border px-2 py-1.5 text-center text-sm font-bold outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, transparent)", color: "var(--t-text)" }} aria-label="Días" />
            <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>días</span>
            <button type="submit" disabled={!(customDays >= 1 && customDays <= 365) || !!busy} className="ml-auto rounded-lg border px-3 py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }}>Usar</button>
          </form>
        </div>

        {/* Historial */}
        <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold"><History size={13} /> Historial</p>
            {canUndo ? (
              <button type="button" onClick={() => void undo()} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
                {busy === "undo" ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />} Deshacer la última
              </button>
            ) : null}
          </div>
          {log === null ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Cargando…</p>
            : log.length === 0 ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Todavía no hay publicaciones marcadas.</p>
            : (
              <ul className="mt-2 space-y-1.5">
                <AnimatePresence initial={false}>
                  {log.slice(0, 6).map((l) => (
                    <motion.li key={l.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-[11px]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#10b981" }} />
                      <span className="font-bold tabular-nums">{ddmmyyyy(l.at)}</span>
                      <span style={{ color: "var(--t-muted)" }}>{new Date(l.at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" })}</span>
                      <span className="truncate">{l.by ?? ""}</span>
                      <span className="ml-auto shrink-0">{l.channels.map((c) => CHANNELS.find((x) => x.key === c)?.emoji ?? "•").join(" ")}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
        </div>
      </motion.div>
    </motion.div>
  );
}
