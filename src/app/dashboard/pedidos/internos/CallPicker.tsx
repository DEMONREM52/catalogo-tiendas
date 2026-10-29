"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Phone, Video, X } from "lucide-react";

/**
 * Antes de llamar: a quién. Los involucrados (lo pidió, lo atiende, escribió) vienen marcados;
 * se puede quitar o agregar a otra persona que se pueda llamar. Nunca timbra a todo el mundo.
 */
export type CallCandidate = { user_id: string; name: string; point?: string | null; involved?: boolean };

export function CallPicker({ open, video, title, load, onCall, onClose }: {
  open: boolean; video: boolean; title: string;
  load: () => Promise<CallCandidate[] | null>;
  onCall: (to: string[] | undefined) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<CallCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void load().then((l) => {
      if (!alive) return;
      if (!l) { setFailed(true); setList([]); return; }
      setFailed(false);
      setList(l);
      // Marcados: los involucrados; si no hay ninguno y es una sola persona, esa.
      const inv = l.filter((c) => c.involved).map((c) => c.user_id);
      setPicked(new Set(inv.length ? inv : l.length === 1 ? [l[0].user_id] : []));
    });
    return () => { alive = false; setList(null); };
  }, [open, load]);

  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="pick" className="fixed inset-0 z-[350] grid place-items-end bg-black/55 p-3 backdrop-blur-[2px] sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="grid h-10 w-10 place-items-center rounded-full text-white" style={{ background: video ? "var(--t-accent)" : "#16a34a" }}>{video ? <Video size={18} /> : <Phone size={18} />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-black">{video ? "Videollamada" : "Llamada"}</p>
                <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{title}</p>
              </div>
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={15} /></button>
            </div>
            <div className="max-h-[50dvh] space-y-1 overflow-y-auto p-2">
              {list === null ? <p className="p-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>Buscando a quién llamar…</p> : null}
              {list && !list.length && !failed ? <p className="p-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>No hay nadie más para llamar aquí.</p> : null}
              {failed ? <p className="p-3 text-center text-sm" style={{ color: "var(--t-muted)" }}>No se pudo cargar la lista. Puedes llamar a los involucrados del pedido.</p> : null}
              {list?.map((c) => (
                <label key={c.user_id} className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-[color:var(--t-card-bg)]">
                  <input type="checkbox" checked={picked.has(c.user_id)} onChange={() => toggle(c.user_id)} className="h-5 w-5 accent-fuchsia-600" style={{ minHeight: 0, padding: 0 }} />
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>{(c.name.trim()[0] ?? "?").toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{c.name}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{[c.point, c.involved ? "en este pedido" : null].filter(Boolean).join(" · ") || "Equipo"}</span>
                  </span>
                  {c.involved ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">involucrado</span> : null}
                </label>
              ))}
            </div>
            <div className="border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" disabled={!failed && !picked.size}
                onClick={() => { onCall(failed ? undefined : [...picked]); onClose(); }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black text-white transition disabled:opacity-40" style={{ background: video ? "var(--t-accent)" : "#16a34a" }}>
                {video ? <Video size={17} /> : <Phone size={17} />}
                {failed ? "Llamar a los involucrados" : picked.size ? `Llamar a ${picked.size === 1 ? list?.find((c) => picked.has(c.user_id))?.name : `${picked.size} personas`}` : "Escoge a quién llamar"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
