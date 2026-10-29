"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";

/**
 * Escoger personas del pedido (a quién avisar, con quién abrir un chat). Los involucrados vienen marcados.
 */
export type Person = { user_id: string; name: string; point?: string | null; me?: boolean; involved?: boolean; selected?: boolean };

export function PeoplePicker({ open, icon, color, heading, title, note, load, initial, confirmLabel, emptyLabel, onConfirm, onClose }: {
  open: boolean; icon: ReactNode; color: string; heading: string; title: string; note?: string;
  load: () => Promise<Person[] | null>;
  initial: (list: Person[]) => string[];
  confirmLabel: (picked: Person[]) => string;
  /** Si se da, se puede confirmar sin nadie marcado (por ejemplo «volver al automático»). */
  emptyLabel?: string;
  onConfirm: (ids: string[]) => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  const [list, setList] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void load().then((l) => {
      if (!alive) return;
      setFailed(!l);
      setList(l ?? []);
      setPicked(new Set(l ? initial(l) : []));
    });
    return () => { alive = false; setList(null); };
  }, [open, load, initial]);

  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = (list ?? []).filter((p) => picked.has(p.user_id));
  const confirm = async () => {
    setBusy(true);
    const ok = await onConfirm([...picked]);
    setBusy(false);
    if (ok) onClose();
  };
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="people" className="fixed inset-0 z-[350] grid place-items-end bg-black/55 p-3 backdrop-blur-[2px] sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="grid h-10 w-10 place-items-center rounded-full text-white" style={{ background: color }}>{icon}</span>
              <div className="min-w-0 flex-1">
                <p className="font-black">{heading}</p>
                <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{title}</p>
              </div>
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={15} /></button>
            </div>
            {note ? <p className="border-b px-4 py-2 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>{note}</p> : null}
            <div className="max-h-[50dvh] space-y-1 overflow-y-auto p-2">
              {list === null ? <p className="p-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
              {list && !list.length && !failed ? <p className="p-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>No hay nadie más en este pedido.</p> : null}
              {failed ? <p className="p-3 text-center text-sm" style={{ color: "var(--t-muted)" }}>No se pudo cargar la lista. Falta correr la migración 20261272.</p> : null}
              {list?.map((c) => (
                <label key={c.user_id} className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-[color:var(--t-card-bg)]">
                  <input type="checkbox" checked={picked.has(c.user_id)} onChange={() => toggle(c.user_id)} className="h-5 w-5 accent-fuchsia-600" style={{ minHeight: 0, padding: 0 }} />
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>{(c.name.trim()[0] ?? "?").toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{c.name}{c.me ? " (tú)" : ""}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{[c.point, c.involved ? "en este pedido" : null].filter(Boolean).join(" · ") || "Equipo"}</span>
                  </span>
                  {c.involved ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">involucrado</span> : null}
                </label>
              ))}
            </div>
            <div className="border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" disabled={busy || failed || (!picked.size && !emptyLabel)} onClick={() => void confirm()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black text-white transition disabled:opacity-40" style={{ background: color }}>
                {busy ? <Loader2 size={17} className="animate-spin" /> : icon}
                {picked.size ? confirmLabel(chosen) : emptyLabel ?? "Escoge a alguien"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
