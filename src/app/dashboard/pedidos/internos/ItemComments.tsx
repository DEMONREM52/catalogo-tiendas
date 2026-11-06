"use client";

// Comentarios por producto del pedido interno (20261283): un hilo corto por producto con etiquetas
// («necesito más», «otro color», «dañado»…) y «✓ Atendido» para que nada se quede sin resolver.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, MessageCircle, Send, Trash2, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

export type ItemComment = {
  id: string; item_id: string; by: string | null; mine: boolean; body: string; tag: CommentTag; qty: number | null;
  at: string; resolved_at: string | null; resolved_by: string | null;
};
export type CommentTag = "note" | "more" | "variant" | "damaged" | "swap" | "photo" | "ok";

export const TAGS: Record<CommentTag, { icon: string; label: string; color: string; preset: (n: number) => string }> = {
  more: { icon: "➕", label: "Necesito más", color: "#a855f7", preset: (n) => `Necesito ${n} más` },
  variant: { icon: "🎨", label: "Otro color / modelo", color: "#0ea5e9", preset: () => "¿Hay en otro color o modelo? " },
  damaged: { icon: "⚠️", label: "Dañado", color: "#ef4444", preset: () => "Viene dañado: " },
  swap: { icon: "🔁", label: "Cambiar por otro", color: "#f59e0b", preset: () => "Cámbialo por: " },
  photo: { icon: "📸", label: "Mándame foto", color: "#ec4899", preset: () => "¿Me mandas una foto de este?" },
  ok: { icon: "✅", label: "Listo", color: "#22c55e", preset: () => "Listo, confirmado" },
  note: { icon: "💬", label: "Comentario", color: "#64748b", preset: () => "" },
};
const ORDER: CommentTag[] = ["more", "variant", "damaged", "swap", "photo", "ok"];
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "var(--t-accent)" } as const;

/** Comentarios del pedido; se recargan cuando cambia el chat (cada comentario también va al chat). */
export function useItemComments(requestId: string | null, refreshKey: unknown) {
  const [list, setList] = useState<ItemComment[]>([]);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_sr_item_comments", { p_request: requestId }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setMissing(/Could not find the function|schema cache/i.test(error.message)); return; }
      setMissing(false);
      setList(Array.isArray(data) ? (data as ItemComment[]) : []);
    });
    return () => { alive = false; };
  }, [requestId, refreshKey, tick]);
  return { list, missing, reload: () => setTick((t) => t + 1), setList };
}

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Vista previa en la tarjeta del producto: el último comentario y cuántos faltan por atender. */
export function CommentPreview({ comments, onOpen }: { comments: ItemComment[]; onOpen: () => void }) {
  if (!comments.length) return null;
  const last = comments[comments.length - 1];
  const open = comments.filter((c) => !c.resolved_at && c.tag !== "ok" && c.tag !== "note").length;
  const t = TAGS[last.tag] ?? TAGS.note;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className="mt-1 flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[11px]"
      style={{ background: `color-mix(in oklab, ${t.color} 12%, transparent)`, color: "var(--t-text)" }}>
      <span className="shrink-0">{t.icon}</span>
      <span className="min-w-0 flex-1 truncate"><b>{(last.by ?? "").split(" ")[0]}:</b> {last.body}</span>
      {open ? <span className="shrink-0 rounded-full px-1.5 text-[10px] font-black text-white" style={{ background: "#f59e0b" }}>{open} por atender</span>
        : last.resolved_at ? <span className="shrink-0 text-[10px] font-bold" style={{ color: "#22c55e" }}>✓</span> : null}
    </button>
  );
}

/** Botón 💬 de la tarjeta, con el número de comentarios. */
export function CommentButton({ comments, onOpen, name }: { comments: ItemComment[]; onOpen: () => void; name: string }) {
  const open = comments.filter((c) => !c.resolved_at && c.tag !== "ok" && c.tag !== "note").length;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={`Comentarios de ${name}`} title="Comentar este producto"
      className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border transition hover:-translate-y-0.5"
      style={{ borderColor: open ? "#f59e0b" : comments.length ? "var(--t-accent)" : "var(--t-card-border)", color: open ? "#f59e0b" : "var(--t-accent)" }}>
      <MessageCircle size={14} />
      {comments.length ? (
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-black text-white" style={{ background: open ? "#f59e0b" : "var(--t-accent)" }}>{comments.length}</span>
      ) : null}
    </button>
  );
}

export function ItemCommentsSheet({
  item, comments, requestId, onClose, onChanged, onAddMore,
}: {
  item: { id: string; name: string; image_url: string | null; qty: number } | null;
  comments: ItemComment[];
  requestId: string;
  onClose: () => void;
  onChanged: () => void;
  /** Si se puede, agrega al pedido las unidades de un «necesito más» (y lo deja atendido). */
  onAddMore?: (qty: number) => Promise<boolean>;
}) {
  const [tag, setTag] = useState<CommentTag>("note");
  const [text, setText] = useState("");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const itemId = item?.id ?? null;

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [comments.length, itemId]);
  useEffect(() => {
    if (!itemId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemId, onClose]);

  function pick(t: CommentTag) {
    const next = tag === t ? "note" : t;
    setTag(next);
    const preset = TAGS[next].preset(qty);
    // Solo se cambia el texto si estaba vacío o era otro texto de etiqueta.
    if (!text.trim() || ORDER.some((k) => TAGS[k].preset(qty) === text)) setText(preset);
    setTimeout(() => { inputRef.current?.focus(); const v = inputRef.current?.value.length ?? 0; inputRef.current?.setSelectionRange(v, v); }, 30);
  }

  async function send() {
    if (!item) return;
    const body = text.trim();
    if (!body) { inputRef.current?.focus(); return; }
    setBusy("send");
    const sb = supabaseBrowser();
    const { error } = await sb.rpc("erp_sr_item_comment_add", { p_request: requestId, p_item: item.id, p_body: body, p_tag: tag, p_qty: tag === "more" ? qty : null });
    if (error) {
      setBusy(null);
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo comentar", text: /Could not find the function|schema cache/i.test(error.message) ? "Ejecuta en Supabase la migración 20261283_comentarios_por_producto.sql." : error.message });
      return;
    }
    // También al chat del pedido (así llega el aviso al celular de los demás).
    await sb.rpc("erp_stock_request_message", { p_request: requestId, p_body: `${TAGS[tag].icon} ${item.name}: ${body}` }).then(() => undefined, () => undefined);
    setBusy(null);
    setText("");
    setTag("note");
    setQty(1);
    navigator.vibrate?.(12);
    onChanged();
  }

  async function resolve(c: ItemComment) {
    setBusy(c.id);
    const { error } = await supabaseBrowser().rpc("erp_sr_item_comment_resolve", { p_comment: c.id, p_on: !c.resolved_at });
    setBusy(null);
    if (error) void Swal.fire({ ...swal, icon: "error", title: "No se pudo marcar", text: error.message });
    else onChanged();
  }

  async function remove(c: ItemComment) {
    setBusy(c.id);
    const { error } = await supabaseBrowser().rpc("erp_sr_item_comment_delete", { p_comment: c.id });
    setBusy(null);
    if (error) void Swal.fire({ ...swal, icon: "error", title: "No se pudo borrar", text: error.message });
    else onChanged();
  }

  async function addMore(c: ItemComment) {
    if (!onAddMore || !c.qty) return;
    setBusy(c.id);
    const done = await onAddMore(c.qty);
    if (done && !c.resolved_at) await supabaseBrowser().rpc("erp_sr_item_comment_resolve", { p_comment: c.id, p_on: true });
    setBusy(null);
    onChanged();
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {item ? (
        <motion.div key="sheet" className="fixed inset-0 z-[160] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
          <motion.section role="dialog" aria-modal="true" aria-label={`Comentarios de ${item.name}`}
            className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[26px] border shadow-2xl sm:max-w-lg sm:rounded-[26px]"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            initial={{ y: 50, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.98 }} transition={{ type: "spring", stiffness: 400, damping: 34 }}>
            <header className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              {item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image_url} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
              ) : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg" style={{ background: "var(--t-card-bg)" }}>📦</span>}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--t-accent)" }}>💬 Comentarios del producto</p>
                <p className="truncate text-sm font-black">{item.name}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>En el pedido: {item.qty} und.</p>
              </div>
              <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={15} /></button>
            </header>

            <div ref={listRef} className="min-h-24 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3">
              {!comments.length ? (
                <div className="py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>
                  <p className="text-3xl">💬</p>
                  <p className="mt-1 font-semibold">Aún no hay comentarios de este producto.</p>
                  <p className="text-xs">Pide más, otro color, avisa si viene dañado… Queda pegado al producto y también en el chat.</p>
                </div>
              ) : comments.map((c) => {
                const t = TAGS[c.tag] ?? TAGS.note;
                return (
                  <motion.div key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl border p-2.5 ${c.mine ? "ml-6" : "mr-6"}`}
                    style={{ borderColor: c.resolved_at ? "color-mix(in oklab, #22c55e 45%, transparent)" : `color-mix(in oklab, ${t.color} 40%, transparent)`, background: c.resolved_at ? "color-mix(in oklab, #22c55e 8%, transparent)" : `color-mix(in oklab, ${t.color} 9%, transparent)`, opacity: c.resolved_at ? 0.85 : 1 }}>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="rounded-full px-1.5 py-px font-bold text-white" style={{ background: t.color }}>{t.icon} {t.label}{c.tag === "more" && c.qty ? ` · ${c.qty}` : ""}</span>
                      <b className="min-w-0 truncate">{c.mine ? "Tú" : c.by ?? "—"}</b>
                      <span className="ml-auto shrink-0" style={{ color: "var(--t-muted)" }}>{ago(c.at)}</span>
                    </div>
                    <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${c.resolved_at ? "line-through decoration-1 opacity-70" : ""}`}>{c.body}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {c.tag !== "note" && c.tag !== "ok" ? (
                        <button type="button" disabled={busy === c.id} onClick={() => void resolve(c)}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold disabled:opacity-50"
                          style={c.resolved_at ? { borderColor: "#22c55e", color: "#22c55e" } : { borderColor: "var(--t-card-border)" }}>
                          {busy === c.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          {c.resolved_at ? `Atendido${c.resolved_by ? ` · ${c.resolved_by.split(" ")[0]}` : ""}` : "Marcar atendido"}
                        </button>
                      ) : null}
                      {c.tag === "more" && c.qty && !c.resolved_at && onAddMore ? (
                        <button type="button" disabled={busy === c.id} onClick={() => void addMore(c)}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white disabled:opacity-50" style={{ background: "#a855f7" }}>
                          ➕ Agregar {c.qty} al pedido
                        </button>
                      ) : null}
                      {c.mine && !c.resolved_at ? (
                        <button type="button" disabled={busy === c.id} onClick={() => void remove(c)} className="ml-auto grid h-6 w-6 place-items-center rounded-full text-red-400 disabled:opacity-50" aria-label="Borrar comentario"><Trash2 size={12} /></button>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <footer className="space-y-2 border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                {ORDER.map((k) => (
                  <button key={k} type="button" onClick={() => pick(k)}
                    className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold transition"
                    style={tag === k ? { background: TAGS[k].color, borderColor: TAGS[k].color, color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
                    {TAGS[k].icon} {TAGS[k].label}
                  </button>
                ))}
              </div>
              {tag === "more" ? (
                <div className="flex items-center gap-2 text-xs font-semibold">
                  ¿Cuántas más?
                  <button type="button" onClick={() => { const n = Math.max(1, qty - 1); setQty(n); setText(TAGS.more.preset(n)); }} className="grid h-8 w-8 place-items-center rounded-lg border text-lg" style={{ borderColor: "var(--t-card-border)" }} aria-label="Menos">−</button>
                  <input inputMode="numeric" value={qty} onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => { const n = Math.min(100000, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)); setQty(n); setText(TAGS.more.preset(n)); }}
                    className="h-8 w-16 rounded-lg border text-center text-sm font-black outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Cuántas más" />
                  <button type="button" onClick={() => { const n = qty + 1; setQty(n); setText(TAGS.more.preset(n)); }} className="grid h-8 w-8 place-items-center rounded-lg border text-lg" style={{ borderColor: "var(--t-card-border)" }} aria-label="Más">+</button>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value.slice(0, 600))} rows={1}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder="Escribe sobre este producto…"
                  className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
                <button type="button" onClick={() => void send()} disabled={busy === "send" || !text.trim()}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white shadow disabled:opacity-40" style={{ background: "var(--t-accent)" }} aria-label="Enviar comentario">
                  {busy === "send" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
