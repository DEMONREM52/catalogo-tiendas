"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  BellOff, Check, CheckCheck, ChevronDown, ChevronUp, Copy, CornerUpLeft, Forward, Info, Loader2, PackagePlus, Pencil, Phone, Pin, PinOff,
  Search, Star, StarOff, Trash2, Video, X,
} from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MessageMedia, type Attachment } from "@/app/dashboard/pedidos/internos/chat-media";
import { EDIT_WINDOW_MS, chatRpc, mentionTag, newRequestUrl, type ChatPerson, type Extra, type Extras, type ProductCardData, type Reader, type Scope } from "./chat-api";

/** Piezas de los chats (burbuja, menú, visto, fijados, búsqueda, reenviar, silenciar…), iguales en pedidos y en mensajes. */

export type ChatMsg = { id: string; user_id: string | null; user_name: string | null; body: string; kind: "message" | "system"; created_at: string; mine: boolean };
export type ChatAction = "reply" | "copy" | "forward" | "pin" | "unpin" | "star" | "unstar" | "edit" | "delete" | "request" | "info";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "🙏", "✅"];
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-CO");
const money = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
export const isAutoLabel = (body: string, files: Attachment[]) => files.length > 0 && /^(📷|🎥|🎤)/u.test(body) && body.length < 48;

/** Texto del mensaje con las @menciones resaltadas y lo buscado marcado. */
export function MessageText({ text, query, mine }: { text: string; query?: string; mine: boolean }) {
  const parts = text.split(/(@[\p{L}\p{N}_]+)/gu);
  const q = query ? fold(query.trim()) : "";
  const mark = (s: string, k: string): ReactNode => {
    if (!q || q.length < 2) return s;
    const f = fold(s);
    const out: ReactNode[] = [];
    let i = 0;
    for (let at = f.indexOf(q); at !== -1; at = f.indexOf(q, at + q.length)) {
      out.push(s.slice(i, at), <mark key={`${k}-${at}`} className="rounded bg-yellow-300 px-0.5 text-stone-900">{s.slice(at, at + q.length)}</mark>);
      i = at + q.length;
    }
    out.push(s.slice(i));
    return out;
  };
  return (
    <>
      {parts.map((p, i) => (p.startsWith("@") && p.length > 1
        ? <b key={i} className="rounded px-0.5" style={{ background: mine ? "rgba(255,255,255,.22)" : "color-mix(in oklab, var(--t-accent) 18%, transparent)" }}>{mark(p, String(i))}</b>
        : <Fragment key={i}>{mark(p, String(i))}</Fragment>))}
    </>
  );
}

/** Tarjeta de producto: foto, precio y existencias de cada punto (en vivo), con «Pedir». */
export function ProductCard({ card, mine }: { card: ProductCardData | undefined; mine: boolean }) {
  if (!card) return <div className="m-1 h-24 animate-pulse rounded-xl" style={{ background: "rgba(127,127,127,.15)" }} />;
  const total = card.stock.reduce((s, x) => s + Math.max(0, x.qty), 0);
  return (
    <div className="m-1 w-64 max-w-full overflow-hidden rounded-xl" style={{ background: mine ? "rgba(255,255,255,.14)" : "var(--t-bg-base)", border: mine ? "1px solid rgba(255,255,255,.2)" : "1px solid var(--t-card-border)" }}>
      <div className="flex gap-2.5 p-2">
        {card.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.image_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        ) : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg text-2xl" style={{ background: "rgba(127,127,127,.15)" }}>📦</span>}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-black leading-tight">{card.name}</p>
          {card.sku ? <p className="text-[10px] opacity-70">{card.sku}</p> : null}
          <p className="mt-0.5 text-sm font-black">{money(card.price)}</p>
          <p className="text-[10px] font-bold" style={{ color: total > 0 ? (mine ? "#bbf7d0" : "#16a34a") : "#f87171" }}>{total > 0 ? `${total} disponibles` : "Agotado"}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 px-2 pb-2">
        {card.stock.map((s) => (
          <span key={s.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: s.qty > 0 ? "rgba(22,163,74,.18)" : "rgba(127,127,127,.15)", opacity: s.qty > 0 ? 1 : 0.7 }}>
            {s.name}: <b>{s.qty}</b>
          </span>
        ))}
      </div>
      <Link href={newRequestUrl(`Pedido desde el chat: ${card.name}`, card.id)} className="flex items-center justify-center gap-1.5 border-t py-1.5 text-xs font-bold" style={{ borderColor: mine ? "rgba(255,255,255,.2)" : "var(--t-card-border)" }}>
        <PackagePlus size={13} /> Pedir a otro punto
      </Link>
    </div>
  );
}

/** ✓ enviado · ✓✓ gris: lo vio alguien · ✓✓ azul: lo vieron todos. */
function Ticks({ createdAt, readers, total, mine }: { createdAt: string; readers: Reader[] | null; total: number | null; mine: boolean }) {
  if (!readers) return null;
  const seen = readers.filter((r) => r.at && r.at >= createdAt).length;
  const all = total !== null ? total > 0 && seen >= total : seen > 0;
  const color = all ? (mine ? "#7dd3fc" : "#0ea5e9") : undefined;
  return seen > 0 ? <CheckCheck size={14} style={{ color }} aria-label={all ? "Visto" : "Visto por algunos"} /> : <Check size={14} aria-label="Enviado" />;
}

/** «Visto por»: quién leyó el mensaje y quién no. */
export function showReaders(readers: Reader[], createdAt: string) {
  const seen = readers.filter((r) => r.at && r.at >= createdAt);
  const not = readers.filter((r) => !r.at || r.at < createdAt);
  const row = (r: Reader, ok: boolean) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid rgba(127,127,127,.15)"><span>${ok ? "✓✓" : "✓"} ${r.name.replace(/</g, "&lt;")}</span><span style="opacity:.6">${ok && r.at ? new Date(r.at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "sin leer"}</span></div>`;
  void Swal.fire({ ...swal, title: "Información del mensaje", html: `<div style="text-align:left;font-size:13px"><p style="font-weight:800;margin:4px 0">👀 Lo vieron (${seen.length})</p>${seen.map((r) => row(r, true)).join("") || "<p style='opacity:.6'>Nadie todavía</p>"}${not.length ? `<p style="font-weight:800;margin:12px 0 4px">⏳ Sin leer (${not.length})</p>${not.map((r) => row(r, false)).join("")}` : ""}</div>`, confirmButtonText: "Listo" });
}

/** Una burbuja de mensaje con todo: cita, archivos, producto, reacciones, editado, visto y menú (mantener presionado o clic derecho). */
export function ChatBubble({ m, subtitle, showName, files, extra, readers, total, products, query, flash, compact, canPin, canPost, onAction, onReact, onJump }: {
  m: ChatMsg; subtitle?: string | null; showName: boolean; files: Attachment[]; extra?: Extra; readers: Reader[] | null; total: number | null;
  products: Record<string, ProductCardData>; query?: string; flash?: boolean; compact?: boolean; canPin: boolean; canPost: boolean;
  onAction: (a: ChatAction, m: ChatMsg) => void; onReact: (m: ChatMsg, emoji: string | null) => void; onJump: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const press = useRef(0);
  const deleted = Boolean(extra?.deleted);
  const product = extra?.meta?.type === "product" && extra.meta.product_id ? extra.meta.product_id : null;
  const auto = isAutoLabel(m.body, files) || (product !== null && m.body.startsWith("📦 "));
  const startPress = () => { window.clearTimeout(press.current); press.current = window.setTimeout(() => { setMenu(true); navigator.vibrate?.(20); }, 450); };
  const endPress = () => window.clearTimeout(press.current);
  const mine = m.mine;

  return (
    <div id={`msg-${m.id}`} className={`group flex ${mine ? "justify-end" : "justify-start"} ${compact ? "" : "pt-1"}`}>
      <div className={`relative max-w-[82%] ${flash ? "animate-pulse" : ""}`}>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
          onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerMove={(e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) endPress(); }}
          className={`select-text rounded-2xl text-sm shadow-sm ${files.length || product ? "p-1.5" : "px-3.5 py-2"}`}
          style={{
            ...(mine ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))", color: "#fff", borderBottomRightRadius: 6 } : { background: "var(--t-card-bg)", border: "1px solid var(--t-card-border)", borderBottomLeftRadius: 6 }),
            ...(flash ? { outline: "3px solid #facc15", outlineOffset: 2 } : {}),
          }}>
          {showName && !mine ? <p className={`text-[11px] font-bold ${files.length || product ? "px-2 pt-1" : ""}`} style={{ color: "var(--t-accent)" }}>{m.user_name}{subtitle ? ` · ${subtitle}` : ""}</p> : null}
          {extra?.meta?.forwarded ? <p className={`flex items-center gap-1 text-[10px] italic opacity-75 ${files.length ? "px-2" : ""}`}><Forward size={11} /> Reenviado</p> : null}
          {extra?.reply ? (
            <button type="button" onClick={() => onJump(extra.reply!.id)} className={`mb-1 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-xs ${files.length || product ? "mx-0.5" : ""}`}
              style={{ borderColor: mine ? "#fff" : "var(--t-accent)", background: mine ? "rgba(255,255,255,.16)" : "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
              <b className="block text-[11px]" style={{ color: mine ? "#fff" : "var(--t-accent)" }}>{extra.reply.user_name}</b>
              <span className="line-clamp-2 opacity-85">{extra.reply.deleted ? "🚫 Mensaje eliminado" : extra.reply.body}</span>
            </button>
          ) : null}
          {files.length && !deleted ? <MessageMedia items={files} mine={mine} /> : null}
          {product && !deleted ? <ProductCard card={products[product]} mine={mine} /> : null}
          {deleted ? <p className="italic opacity-70">🚫 Se eliminó este mensaje</p>
            : !auto ? <p className={`whitespace-pre-line break-words ${files.length || product ? "px-2 pt-1.5" : ""}`}><MessageText text={m.body} query={query} mine={mine} /></p> : null}
          <p className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-75 ${files.length || product ? "px-2 pb-0.5" : ""}`}>
            {extra?.pinned ? <Pin size={10} aria-label="Fijado" /> : null}
            {extra?.starred ? <Star size={10} className="fill-current" aria-label="Guardado" /> : null}
            {extra?.edited && !deleted ? <span>editado</span> : null}
            {hhmm(m.created_at)}
            {mine && !deleted ? <button type="button" onClick={() => onAction("info", m)} aria-label="Quién lo vio"><Ticks createdAt={m.created_at} readers={readers} total={total} mine={mine} /></button> : null}
          </p>
        </motion.div>
        {!deleted ? (
          <button type="button" onClick={() => setMenu(true)} aria-label="Opciones del mensaje"
            className={`absolute top-1 grid h-6 w-6 place-items-center rounded-full opacity-0 shadow transition group-hover:opacity-100 ${mine ? "-left-7" : "-right-7"}`}
            style={{ background: "var(--t-bg-base)", border: "1px solid var(--t-card-border)", color: "var(--t-text)" }}>
            <ChevronDown size={14} />
          </button>
        ) : null}
        {extra?.reactions?.length ? (
          <div className={`-mt-1.5 flex flex-wrap gap-1 ${mine ? "justify-end pr-2" : "pl-2"}`}>
            {extra.reactions.map((r) => (
              <button key={r.emoji} type="button" title={r.names.join(", ")} onClick={() => onReact(m, r.mine ? null : r.emoji)}
                className="relative z-[1] rounded-full border px-1.5 py-0.5 text-xs shadow-sm transition hover:scale-110"
                style={{ background: r.mine ? "color-mix(in oklab, var(--t-accent) 25%, var(--t-bg-base))" : "var(--t-bg-base)", borderColor: r.mine ? "var(--t-accent)" : "var(--t-card-border)", color: "var(--t-text)" }}>
                {r.emoji}{r.count > 1 ? <span className="ml-0.5 text-[10px] font-bold">{r.count}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <MessageMenu open={menu} onClose={() => setMenu(false)} m={m} extra={extra} canPin={canPin} canPost={canPost} hasFiles={files.length > 0}
        onAction={(a) => { setMenu(false); onAction(a, m); }} onReact={(e) => { setMenu(false); onReact(m, e); }} />
    </div>
  );
}

/** Menú de un mensaje (como WhatsApp): reacciones arriba y las acciones. */
function MessageMenu({ open, onClose, m, extra, canPin, canPost, hasFiles, onAction, onReact }: {
  open: boolean; onClose: () => void; m: ChatMsg; extra?: Extra; canPin: boolean; canPost: boolean; hasFiles: boolean;
  onAction: (a: ChatAction) => void; onReact: (emoji: string | null) => void;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => { if (open) { const t = window.setTimeout(() => setNow(Date.now()), 0); return () => window.clearTimeout(t); } }, [open]);
  if (typeof document === "undefined") return null;
  const fresh = now > 0 && now - new Date(m.created_at).getTime() < EDIT_WINDOW_MS;
  const mineReaction = extra?.reactions?.find((r) => r.mine)?.emoji ?? null;
  const product = extra?.meta?.type === "product";
  const items: Array<[ChatAction, ReactNode, string, boolean?]> = [
    ["reply", <CornerUpLeft key="r" size={17} />, "Responder"],
    ["copy", <Copy key="c" size={17} />, "Copiar texto"],
    ["forward", <Forward key="f" size={17} />, "Reenviar"],
    extra?.pinned ? ["unpin", <PinOff key="p" size={17} />, "Desfijar"] : ["pin", <Pin key="p" size={17} />, "Fijar arriba"],
    extra?.starred ? ["unstar", <StarOff key="s" size={17} />, "Quitar de guardados"] : ["star", <Star key="s" size={17} />, "Guardar ⭐"],
    ["request", <PackagePlus key="q" size={17} />, "Crear pedido interno con esto"],
  ];
  const visible = items.filter(([a]) => (a !== "pin" && a !== "unpin") || canPin).filter(([a]) => a !== "reply" || canPost);
  if (m.mine) {
    visible.push(["info", <Info key="i" size={17} />, "Quién lo vio"]);
    if (fresh && !product && !hasFiles) visible.push(["edit", <Pencil key="e" size={17} />, "Editar"]);
    if (fresh) visible.push(["delete", <Trash2 key="d" size={17} />, "Borrar para todos", true]);
  }
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="menu" className="fixed inset-0 z-[400] grid place-items-end bg-black/45 p-3 sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div initial={{ y: 30, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <p className="line-clamp-2 border-b px-4 py-2.5 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}><b style={{ color: "var(--t-text)" }}>{m.mine ? "Tú" : m.user_name}:</b> {m.body}</p>
            <div className="flex justify-around border-b px-2 py-2" style={{ borderColor: "var(--t-card-border)" }}>
              {REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => onReact(mineReaction === e ? null : e)} className="grid h-10 w-10 place-items-center rounded-full text-2xl transition hover:scale-125"
                  style={mineReaction === e ? { background: "color-mix(in oklab, var(--t-accent) 25%, transparent)" } : undefined}>{e}</button>
              ))}
            </div>
            <div className="p-1.5">
              {visible.map(([a, icon, label, danger]) => (
                <button key={a} type="button" onClick={() => onAction(a)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-[color:var(--t-card-bg)]" style={danger ? { color: "#ef4444" } : undefined}>
                  {icon} {label}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Constancia del sistema; si es de una llamada, con «Devolver la llamada». */
export function SystemLine({ m, extra, me, onCallBack }: { m: ChatMsg; extra?: Extra; me: string | null; onCallBack?: (video: boolean, to: string[]) => void }) {
  const call = extra?.meta?.type === "call" ? extra.meta : null;
  const target = call ? (call.caller_id && call.caller_id !== me ? [call.caller_id] : (call.invited ?? []).filter((u) => u !== me)) : [];
  return (
    <div id={`msg-${m.id}`} className="mx-auto my-1.5 max-w-[92%] whitespace-pre-line rounded-xl px-3 py-1.5 text-center text-xs" style={{ background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)", color: "var(--t-muted)" }}>
      {m.body}
      <span className="ml-1 opacity-70">· {hhmm(m.created_at)}</span>
      {call && onCallBack && target.length ? (
        <button type="button" onClick={() => onCallBack(Boolean(call.video), target)} className="mx-auto mt-1 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-white" style={{ background: call.video ? "var(--t-accent)" : "#16a34a" }}>
          {call.video ? <Video size={12} /> : <Phone size={12} />} {call.status === "missed" && call.caller_id !== me ? "Devolver la llamada" : "Volver a llamar"}
        </button>
      ) : null}
    </div>
  );
}

/** Mensajes fijados arriba del chat: toca para ir; si hay varios, va pasando. */
export function PinnedBar({ pinned, onJump }: { pinned: Extras["pinned"]; onJump: (id: string) => void }) {
  const [i, setI] = useState(0);
  if (!pinned.length) return null;
  const p = pinned[i % pinned.length];
  return (
    <button type="button" onClick={() => { onJump(p.id); setI((x) => x + 1); }} className="flex w-full items-center gap-2 border-b px-3 py-1.5 text-left text-xs" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 8%, var(--t-bg-base))" }}>
      <Pin size={14} className="shrink-0" style={{ color: "var(--t-accent)" }} />
      <span className="min-w-0 flex-1">
        <b className="block text-[11px]" style={{ color: "var(--t-accent)" }}>Fijado{pinned.length > 1 ? ` (${(i % pinned.length) + 1} de ${pinned.length})` : ""}</b>
        <span className="block truncate">{p.user_name}: {p.body}</span>
      </span>
    </button>
  );
}

/** Arriba del cuadro de texto: a qué mensaje respondes o cuál estás editando. */
export function ComposerBanner({ mode, m, onCancel }: { mode: "reply" | "edit"; m: ChatMsg; onCancel: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border-l-4 px-3 py-1.5 text-xs" style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
      {mode === "reply" ? <CornerUpLeft size={14} /> : <Pencil size={14} />}
      <span className="min-w-0 flex-1">
        <b className="block" style={{ color: "var(--t-accent)" }}>{mode === "reply" ? `Respondiendo a ${m.mine ? "ti" : m.user_name ?? "alguien"}` : "Editando mensaje"}</b>
        <span className="block truncate" style={{ color: "var(--t-muted)" }}>{m.body}</span>
      </span>
      <button type="button" onClick={onCancel} className="grid h-7 w-7 place-items-center rounded-full" aria-label="Cancelar"><X size={14} /></button>
    </div>
  );
}

/** Sugerencias al escribir @: toca a alguien y queda mencionado. */
export function MentionSuggestions({ text, people, onPick }: { text: string; people: ChatPerson[]; onPick: (text: string) => void }) {
  const m = /(^|\s)@([\p{L}\p{N}_]*)$/u.exec(text);
  if (!m || !people.length) return null;
  const q = fold(m[2]);
  const list = people.filter((p) => fold(p.name).split(/\s+/).some((w) => w.startsWith(q))).slice(0, 6);
  if (!list.length) return null;
  return (
    <div className="mb-2 overflow-hidden rounded-2xl border shadow-lg" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
      <p className="px-3 pt-2 text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Mencionar (le llega aviso aunque tenga el chat silenciado)</p>
      {list.map((p) => (
        <button key={p.user_id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(`${text.slice(0, text.length - m[2].length - 1)}@${mentionTag(p.name)} `)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[color:var(--t-card-bg)]">
          <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>{(p.name.trim()[0] ?? "?").toUpperCase()}</span>
          <b>{p.name}</b> <span className="text-xs" style={{ color: "var(--t-muted)" }}>@{mentionTag(p.name)}</span>
        </button>
      ))}
    </div>
  );
}

/** Buscar dentro del chat: resalta y salta entre los resultados. */
export function ChatSearchBar({ q, setQ, msgs, onJump, onClose }: { q: string; setQ: (v: string) => void; msgs: ChatMsg[]; onJump: (id: string) => void; onClose: () => void }) {
  const [pos, setPos] = useState(0);
  const hits = useMemo(() => {
    const f = fold(q.trim());
    return f.length < 2 ? [] : msgs.filter((m) => fold(m.body).includes(f)).map((m) => m.id).reverse();
  }, [q, msgs]);
  const go = (d: number) => {
    if (!hits.length) return;
    const n = (pos + d + hits.length) % hits.length;
    setPos(n);
    onJump(hits[n]);
  };
  return (
    <div className="flex items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
      <Search size={15} style={{ color: "var(--t-muted)" }} />
      <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setPos(0); }} onKeyDown={(e) => { if (e.key === "Enter") go(e.shiftKey ? -1 : 1); if (e.key === "Escape") onClose(); }}
        placeholder="Buscar en este chat" className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ padding: 0, border: 0 }} />
      <span className="text-[11px] tabular-nums" style={{ color: "var(--t-muted)" }}>{q.trim().length >= 2 ? (hits.length ? `${pos + 1} de ${hits.length}` : "0") : ""}</span>
      <button type="button" onClick={() => go(-1)} disabled={!hits.length} className="grid h-7 w-7 place-items-center rounded-full disabled:opacity-30" aria-label="Más nuevo"><ChevronDown size={15} /></button>
      <button type="button" onClick={() => go(1)} disabled={!hits.length} className="grid h-7 w-7 place-items-center rounded-full disabled:opacity-30" aria-label="Más viejo"><ChevronUp size={15} /></button>
      <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full" aria-label="Cerrar búsqueda"><X size={15} /></button>
    </div>
  );
}

/** Lleva la vista a un mensaje y lo resalta un momento. */
export function jumpTo(id: string, setFlash: (id: string | null) => void) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  setFlash(id);
  window.setTimeout(() => setFlash(null), 1600);
  return true;
}

/** Silenciar el chat: 8 horas, una semana, siempre o volver a activar. */
export async function muteChat(scope: Scope, chatId: string, mutedUntil: string | null) {
  const res = await Swal.fire({
    ...swal, title: mutedUntil ? "🔕 Chat silenciado" : "🔕 Silenciar este chat",
    text: mutedUntil ? `Silenciado ${new Date(mutedUntil).getFullYear() > 9000 ? "siempre" : `hasta ${new Date(mutedUntil).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}`}. Las llamadas y las @menciones sí te avisan.`
      : "No suena ni te llega aviso de los mensajes. Las llamadas y cuando te mencionen con @ sí te avisan.",
    input: "radio", inputOptions: mutedUntil ? { "0": "Volver a activar los avisos", "8": "8 horas", "168": "1 semana", always: "Siempre" } : { "8": "8 horas", "168": "1 semana", always: "Siempre" },
    inputValue: mutedUntil ? "0" : "8", showCancelButton: true, confirmButtonText: "Listo", cancelButtonText: "Cancelar",
  });
  if (!res.isConfirmed) return false;
  const err = await chatRpc("erp_chat_mute", { p_scope: scope, p_chat: chatId, p_hours: res.value === "always" ? null : Number(res.value) });
  if (err) { void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: err }); return false; }
  void Swal.fire({ ...swal, toast: true, position: "top-end", timer: 2200, showConfirmButton: false, icon: "success", title: res.value === "0" ? "Avisos activados" : "Chat silenciado" });
  return true;
}

export function MuteIcon({ on }: { on: boolean }) {
  return on ? <BellOff size={13} className="inline" aria-label="Silenciado" /> : null;
}

/** Reenviar: escoge a qué chats del equipo. */
export function ForwardDialog({ open, storeId, onClose, onSend }: { open: boolean; storeId: string; onClose: () => void; onSend: (threads: string[]) => Promise<void> }) {
  const [list, setList] = useState<Array<{ id: string; kind: string; title: string | null; members: ChatPerson[] | null }> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_dm_list", { p_store: storeId }).then(({ data }) => { if (alive) setList(((data ?? []) as Array<{ id: string; kind: string; title: string | null; members: ChatPerson[] | null }>).filter((t) => t.kind !== "announce")); });
    return () => { alive = false; setPicked(new Set()); setList(null); };
  }, [open, storeId]);
  if (typeof document === "undefined") return null;
  const name = (t: { kind: string; title: string | null; members: ChatPerson[] | null }) => (t.kind === "group" ? t.title ?? "Grupo" : t.members?.[0]?.name ?? "Chat");
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="fw" className="fixed inset-0 z-[400] grid place-items-end bg-black/55 p-3 sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div initial={{ y: 30 }} animate={{ y: 0 }} exit={{ y: 30 }} onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80dvh] w-full max-w-sm flex-col overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <Forward size={18} /><p className="flex-1 font-black">Reenviar a…</p>
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={15} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {list === null ? <p className="p-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>Cargando chats…</p> : null}
              {list && !list.length ? <p className="p-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>No tienes chats todavía. Abre uno en «Mensajes».</p> : null}
              {list?.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-[color:var(--t-card-bg)]">
                  <input type="checkbox" checked={picked.has(t.id)} onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} className="h-5 w-5 accent-fuchsia-600" style={{ minHeight: 0, padding: 0 }} />
                  <b className="min-w-0 flex-1 truncate text-sm">{t.kind === "group" ? "👥 " : ""}{name(t)}</b>
                </label>
              ))}
            </div>
            <div className="border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" disabled={!picked.size || busy} onClick={async () => { setBusy(true); try { await onSend([...picked]); onClose(); } finally { setBusy(false); } }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black text-white disabled:opacity-40" style={{ background: "var(--t-accent)" }}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Forward size={16} />} {picked.size ? `Reenviar a ${picked.size} chat${picked.size === 1 ? "" : "s"}` : "Escoge a dónde"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
