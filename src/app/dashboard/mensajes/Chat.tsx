"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BellOff, Camera, Image as ImageIcon, Loader2, Lock, Megaphone, Mic, Music, Package, Paperclip, Phone, Search, Send, Trash2, Users, Video, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MAX_BYTES, clock, kindOf, mediaMeta, prepareImage, uploadChatFile, useRecorder, type Attachment, type Pending } from "../pedidos/internos/chat-media";
import { startChatCall } from "../pedidos/internos/CallManager";
import { CallPicker, type CallCandidate } from "../pedidos/internos/CallPicker";
import { ProductSearchModal } from "../inventario/LineEditor";
import { ChatBubble, ChatSearchBar, ComposerBanner, ForwardDialog, MentionSuggestions, PinnedBar, SystemLine, muteChat, showReaders, type ChatMsg } from "@/components/chat/ChatParts";
import { useChatKit } from "@/components/chat/useChatKit";

/**
 * Conversación de un chat del equipo (20261271 + 20261273): mensajes en vivo, fotos, videos, audios, notas de voz,
 * llamadas, responder, reacciones, visto ✓✓, editar/borrar, fijar, guardar, @menciones, productos, reenviar y buscar.
 */

export type Thread = { id: string; kind: "direct" | "group" | "announce"; title: string | null; last_at: string; members: Array<{ user_id: string; name: string }> | null;
  last: { body: string; user_name: string | null; mine: boolean; created_at: string; kind: string } | null; unread: number; muted?: boolean; mentioned?: boolean; created_by?: string | null };
type Msg = ChatMsg & { attachments: Attachment[] | null };

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
export const threadName = (t: Thread) => (t.kind !== "direct" ? t.title ?? "Grupo" : t.members?.[0]?.name ?? "Chat");
export const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const dayLabel = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === y.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
};

async function notifyOthers(messageId: string) {
  const { data } = await supabaseBrowser().auth.getSession();
  void fetch("/api/push/dm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ message_id: messageId }) });
}

export function Chat({ storeId, thread, me, onBack, onActivity, focusMessage }: { storeId: string; thread: Thread; me: string | null; onBack: () => void; onActivity: () => void; focusMessage?: string | null }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [more, setMore] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [attachMenu, setAttachMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [pick, setPick] = useState<{ video: boolean } | null>(null);
  const [productPick, setProductPick] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const audioIn = useRef<HTMLInputElement>(null);
  const recorder = useRecorder();
  const name = threadName(thread);
  const announce = thread.kind === "announce";

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_dm_messages", { p_thread: thread.id });
    if (error) return;
    const list = (data ?? []) as Msg[];
    // Si ya se cargaron mensajes viejos, se conservan.
    setMsgs((cur) => {
      if (!cur || !list.length) return list;
      const older = cur.filter((m) => m.created_at < list[0].created_at);
      return [...older, ...list];
    });
    setMore((cur) => cur && list.length >= 60);
    void supabaseBrowser().rpc("erp_dm_read", { p_thread: thread.id }).then(() => onActivity());
  }, [thread.id, onActivity]);

  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  // En vivo: mensajes nuevos o editados/borrados de este chat (y respaldo cada 15 s si la pestaña está a la vista).
  useEffect(() => {
    (window as Window & { __remhubOpenChat?: string | null }).__remhubOpenChat = thread.id;
    const ch = supabaseBrowser()
      .channel(`dm-${thread.id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_dm_messages", filter: `thread_id=eq.${thread.id}` }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "erp_dm_messages", filter: `thread_id=eq.${thread.id}` }, () => void load())
      .subscribe();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000);
    return () => { (window as Window & { __remhubOpenChat?: string | null }).__remhubOpenChat = null; window.clearInterval(t); void supabaseBrowser().removeChannel(ch); };
  }, [thread.id, load]);

  const all = useMemo(() => msgs ?? [], [msgs]);
  const filesOf = useCallback((id: string) => all.find((m) => m.id === id)?.attachments ?? [], [all]);
  const people = useMemo(() => thread.members ?? [], [thread.members]);
  const kit = useChatKit({ scope: "dm", chatId: thread.id, storeId, msgs: all, people, filesOf, setText, onChanged: () => { void load(); onActivity(); } });
  const ex = kit.extras;
  const canPost = ex ? ex.can_post : !announce;

  const lastId = all.length ? all[all.length - 1].id : "";
  useEffect(() => { if (!kit.searching) end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); setTyping(null); }, [lastId, kit.searching]);

  async function older() {
    const first = msgs?.[0];
    if (!first) return 0;
    const { data } = await supabaseBrowser().rpc("erp_dm_messages", { p_thread: thread.id, p_before: first.created_at });
    const list = (data ?? []) as Msg[];
    setMsgs((cur) => [...list, ...(cur ?? [])]);
    setMore(list.length >= 60);
    return list.length;
  }

  // Desde la búsqueda de todos los chats: ir al mensaje (cargando los anteriores si hace falta).
  const sought = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMessage || !msgs || sought.current === focusMessage) return;
    if (msgs.some((m) => m.id === focusMessage)) {
      sought.current = focusMessage;
      window.setTimeout(() => kit.jump(focusMessage), 150);
    } else if (more && msgs.length < 600) {
      void older();
    } else {
      sought.current = focusMessage;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessage, msgs, more]);

  // Desde la notificación («↩️ Responder»): el cuadro de texto queda listo.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("responder") === "1") window.setTimeout(() => document.getElementById("composer-dm")?.focus(), 300);
  }, []);

  // «Está escribiendo…» (aviso efímero, no se guarda).
  const typingCh = useRef<ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null>(null);
  const lastTyping = useRef(0);
  const myName = useMemo(() => msgs?.find((m) => m.mine && m.user_name)?.user_name ?? null, [msgs]);
  useEffect(() => {
    let clear = 0;
    const ch = supabaseBrowser().channel(`dm-typing-${thread.id}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { by?: string; name?: string };
      if (p.by === me) return;
      setTyping(p.name || "Alguien");
      window.clearTimeout(clear);
      clear = window.setTimeout(() => setTyping(null), 3500);
    }).subscribe();
    typingCh.current = ch;
    return () => { window.clearTimeout(clear); typingCh.current = null; void supabaseBrowser().removeChannel(ch); };
  }, [thread.id, me]);
  function announceTyping() {
    if (!typingCh.current || Date.now() - lastTyping.current < 2000) return;
    lastTyping.current = Date.now();
    void typingCh.current.send({ type: "broadcast", event: "typing", payload: { by: me, name: myName } });
  }

  async function send(body?: string, files: Pending[] = body !== undefined ? [] : pending) {
    const msg = (body ?? text).trim();
    if ((!msg && !files.length) || sending) return;
    setSending(true);
    try {
      const attachments: Attachment[] = [];
      for (const p of files) {
        const path = await uploadChatFile(storeId, `dm/${thread.id}`, p.file, (v) => setPending((cur) => cur.map((x) => (x.id === p.id ? { ...x, progress: v } : x))));
        attachments.push({ type: p.type, path, mime: p.file.type, size: p.file.size, duration: p.duration, width: p.width, height: p.height });
      }
      const id = await kit.submit(msg, attachments);
      if (id === false) return;
      if (typeof id === "string") void notifyOthers(id);
      files.forEach((p) => URL.revokeObjectURL(p.preview));
      setPending((cur) => cur.filter((x) => !files.some((p) => p.id === x.id)));
      if (body === undefined) setText("");
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se envió", text: e instanceof Error ? e.message : "Intenta de nuevo." });
    } finally {
      setSending(false);
    }
  }

  async function addFiles(list: FileList | File[] | null) {
    const files = [...(list ?? [])];
    const out: Pending[] = [];
    const skipped: string[] = [];
    for (const raw of files.slice(0, Math.max(0, 10 - pending.length))) {
      const type = kindOf(raw);
      if (!type) { skipped.push(`${raw.name}: solo fotos, videos o audios`); continue; }
      const prepared = type === "image" ? await prepareImage(raw) : { file: raw };
      if (prepared.file.size > MAX_BYTES) { skipped.push(`${raw.name}: pesa más de 50 MB`); continue; }
      const meta = type === "image" ? {} : await mediaMeta(prepared.file, type);
      out.push({ id: crypto.randomUUID(), file: prepared.file, type, preview: URL.createObjectURL(prepared.file), progress: 0, ...("width" in prepared ? { width: prepared.width, height: prepared.height } : {}), ...meta });
    }
    if (out.length) setPending((cur) => [...cur, ...out]);
    if (skipped.length) void Swal.fire({ ...swal, icon: "info", title: "Algunos archivos no se agregaron", html: skipped.map((x) => `• ${x}`).join("<br/>") });
  }

  async function startVoice() {
    try { await recorder.start(); } catch { void Swal.fire({ ...swal, icon: "info", title: "Sin micrófono", text: "Permite el micrófono para este sitio (candado junto a la dirección) y vuelve a intentar." }); }
  }
  async function sendVoice() {
    const { file, duration } = await recorder.stop();
    if (!file || duration < 1) return;
    const p: Pending = { id: crypto.randomUUID(), file, type: "audio", preview: URL.createObjectURL(file), progress: 0, duration };
    setPending((cur) => [...cur, p]);
    await send("", [p]);
  }

  async function sendProduct(productId: string) {
    setProductPick(false);
    const id = await kit.sendProduct(productId);
    if (id) void notifyOthers(id);
  }

  // Llamar: en un chat de dos, directo; en un grupo, se escoge a quién (todos marcados).
  function call(video: boolean) {
    if (thread.kind === "direct") startChatCall(thread.id, video);
    else setPick({ video });
  }
  const loadMembers = useCallback(async (): Promise<CallCandidate[] | null> => (thread.members ?? []).map((m) => ({ user_id: m.user_id, name: m.name, involved: true })), [thread.members]);
  const total = thread.kind === "direct" ? 1 : (thread.members?.length ?? 0);
  const muted = Boolean(ex?.muted_until);
  const firstMsg = all.find((m) => m.kind === "message");
  const readCount = ex && firstMsg ? ex.reads.filter((r) => r.at && r.at >= firstMsg.created_at).length : 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (canPost && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (canPost) void addFiles(e.dataTransfer.files); }}>
      <header className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--t-card-border)" }}>
        <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full md:hidden" aria-label="Volver"><ArrowLeft size={18} /></button>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: announce ? "linear-gradient(135deg,#f59e0b,#ef4444)" : thread.kind === "group" ? "linear-gradient(135deg,#0ea5e9,#8b5cf6)" : "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
          {announce ? <Megaphone size={18} /> : thread.kind === "group" ? <Users size={18} /> : initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-black">{name}{muted ? <BellOff size={13} style={{ color: "var(--t-muted)" }} aria-label="Silenciado" /> : null}</p>
          {announce && ex && firstMsg?.mine ? (
            <button type="button" onClick={() => showReaders(ex.reads, firstMsg.created_at)} className="truncate text-xs font-semibold underline-offset-2 hover:underline" style={{ color: "#10b981" }}>📢 Anuncio · leído por {readCount} de {ex.reads.length}</button>
          ) : (
            <p className="truncate text-xs" style={{ color: typing ? "#10b981" : "var(--t-muted)" }}>
              {typing ? `${typing} está escribiendo…` : announce ? "📢 Anuncio de la tienda" : thread.kind === "group" ? (thread.members ?? []).map((m) => m.name).join(", ") : "Chat del equipo"}
            </p>
          )}
        </div>
        <button type="button" onClick={() => kit.setSearching(!kit.searching)} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Buscar en el chat" title="Buscar en el chat"><Search size={16} /></button>
        <button type="button" onClick={async () => { if (await muteChat("dm", thread.id, ex?.muted_until ?? null)) { void kit.reload(); onActivity(); } }} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)", color: muted ? "#f59e0b" : undefined }} aria-label="Silenciar" title={muted ? "Silenciado: toca para cambiar" : "Silenciar este chat"}><BellOff size={16} /></button>
        {!announce ? (
          <>
            <button type="button" onClick={() => call(false)} className="grid h-10 w-10 place-items-center rounded-full text-white shadow transition hover:-translate-y-0.5" style={{ background: "#16a34a" }} aria-label="Llamar"><Phone size={17} /></button>
            <button type="button" onClick={() => call(true)} className="grid h-10 w-10 place-items-center rounded-full text-white shadow transition hover:-translate-y-0.5" style={{ background: "var(--t-accent)" }} aria-label="Videollamada"><Video size={17} /></button>
          </>
        ) : null}
      </header>
      {kit.searching ? <ChatSearchBar q={kit.query} setQ={kit.setQuery} msgs={all.filter((m) => m.kind === "message")} onJump={kit.jump} onClose={() => { kit.setSearching(false); kit.setQuery(""); }} /> : null}
      {ex?.pinned.length ? <PinnedBar pinned={ex.pinned} onJump={kit.jump} /> : null}

      {dragging ? <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center border-2 border-dashed text-sm font-bold" style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-bg-base) 85%, transparent)", color: "var(--t-accent)" }}>Suelta aquí fotos, videos o audios</div> : null}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 md:px-9" style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--t-text) 6%, transparent) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
        {more && msgs?.length ? <button type="button" onClick={() => void older()} className="mx-auto mb-2 block rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Ver mensajes anteriores</button> : null}
        {msgs === null ? <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
        {msgs && !msgs.length ? <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>👋 Escribe el primer mensaje, manda una foto, una nota de voz o un producto.</p> : null}
        {all.map((m, i) => {
          const prev = all[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const sameAuthor = Boolean(prev && prev.user_id === m.user_id && !newDay && prev.kind === "message");
          return (
            <div key={m.id}>
              {newDay ? <p className="my-3 text-center"><span className="rounded-full px-3 py-1 text-[11px] font-bold capitalize" style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>{dayLabel(m.created_at)}</span></p> : null}
              {m.kind === "system" ? (
                <SystemLine m={m} extra={ex?.msgs[m.id]} me={me} onCallBack={(video, to) => startChatCall(thread.id, video, to)} />
              ) : (
                <ChatBubble m={m} showName={thread.kind !== "direct" && !sameAuthor} files={m.attachments ?? []} extra={ex?.msgs[m.id]} readers={ex?.reads ?? null} total={total}
                  products={kit.products} query={kit.searching ? kit.query : ""} flash={kit.flash === m.id} compact={sameAuthor} canPin={ex?.can_pin ?? false} canPost={canPost}
                  onAction={(a, x) => void kit.onAction(a, x)} onReact={(x, e) => void kit.onReact(x, e)} onJump={kit.jump} />
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {!canPost ? (
        <p className="flex items-center justify-center gap-2 border-t px-3 py-3 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          <Lock size={13} /> Anuncio de la tienda: solo lectura. Reacciona con un toque largo sobre el mensaje.
        </p>
      ) : (
        <div className="border-t p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
          {kit.edit ? <ComposerBanner mode="edit" m={kit.edit} onCancel={kit.cancelCompose} /> : kit.reply ? <ComposerBanner mode="reply" m={kit.reply} onCancel={kit.cancelCompose} /> : null}
          {thread.kind !== "direct" ? <MentionSuggestions text={text} people={people} onPick={(v) => { setText(v); document.getElementById("composer-dm")?.focus(); }} /> : null}
          {pending.length ? (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {pending.map((p) => (
                <div key={p.id} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  {p.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.preview} alt="" className="h-full w-full object-cover" />
                  ) : p.type === "video" ? <video src={p.preview} muted playsInline className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center text-2xl">🎤</span>}
                  {p.duration ? <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{clock(p.duration)}</span> : null}
                  {sending ? <span className="absolute inset-x-0 bottom-0 h-1 bg-black/30"><span className="block h-full bg-emerald-400 transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} /></span>
                    : <button type="button" onClick={() => { URL.revokeObjectURL(p.preview); setPending((cur) => cur.filter((x) => x.id !== p.id)); }} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white" aria-label="Quitar"><X size={13} /></button>}
                </div>
              ))}
            </div>
          ) : null}
          {recorder.state === "recording" ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void recorder.stop(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border text-red-400" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cancelar audio"><Trash2 size={17} /></button>
              <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3" style={{ borderColor: "color-mix(in oklab, #ef4444 50%, transparent)", background: "var(--t-card-bg)" }}>
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                <span className="w-10 shrink-0 font-mono text-xs tabular-nums">{clock(recorder.elapsed)}</span>
                <span className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">{recorder.levels.map((v, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-red-400" style={{ height: `${Math.max(12, v * 100)}%` }} />)}</span>
              </div>
              <button type="button" onClick={() => void sendVoice()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white" style={{ background: "var(--t-accent)" }} aria-label="Enviar audio"><Send size={17} /></button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="relative">
                <button type="button" disabled={sending || Boolean(kit.edit)} onClick={() => setAttachMenu((v) => !v)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Adjuntar"><Paperclip size={17} /></button>
                <AnimatePresence>
                  {attachMenu ? (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-12 left-0 z-30 w-52 overflow-hidden rounded-2xl border p-1 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                      <button type="button" onClick={() => { setAttachMenu(false); gallery.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><ImageIcon size={17} className="text-violet-400" /> Fotos o videos</button>
                      <button type="button" onClick={() => { setAttachMenu(false); camera.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Camera size={17} className="text-pink-400" /> Cámara</button>
                      <button type="button" onClick={() => { setAttachMenu(false); audioIn.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Music size={17} className="text-amber-400" /> Archivo de audio</button>
                      <button type="button" onClick={() => { setAttachMenu(false); setProductPick(true); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Package size={17} className="text-emerald-400" /> Producto (con existencias)</button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <input ref={gallery} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                <input ref={camera} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                <input ref={audioIn} type="file" accept="audio/*" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              </div>
              <textarea id="composer-dm" value={text} rows={1}
                onChange={(e) => { setText(e.target.value); announceTyping(); }}
                onPaste={(e) => { const f = [...e.clipboardData.files].filter((x) => kindOf(x)); if (f.length) { e.preventDefault(); void addFiles(f); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } if (e.key === "Escape") kit.cancelCompose(); }}
                placeholder={kit.edit ? "Corrige el mensaje…" : pending.length ? "Agrega un texto (opcional)…" : thread.kind !== "direct" ? "Escribe un mensaje… (@ para mencionar)" : "Escribe un mensaje…"}
                className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-500/25"
                style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
              {text.trim() || pending.length ? (
                <button type="button" onClick={() => void send()} disabled={sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white disabled:opacity-40" style={{ background: "var(--t-accent)" }} aria-label="Enviar">{sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}</button>
              ) : (
                <button type="button" onClick={() => void startVoice()} disabled={sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition hover:scale-105 disabled:opacity-40" style={{ background: "var(--t-accent)" }} aria-label="Grabar audio"><Mic size={18} /></button>
              )}
            </div>
          )}
        </div>
      )}
      <CallPicker open={Boolean(pick)} video={Boolean(pick?.video)} title={`Grupo «${name}»`} load={loadMembers} onCall={(to) => { if (pick) startChatCall(thread.id, pick.video, to); }} onClose={() => setPick(null)} />
      <ProductSearchModal open={productPick} onClose={() => setProductPick(false)} storeId={storeId} title="Enviar un producto al chat" onPick={(p) => void sendProduct(p.id)} />
      <ForwardDialog open={Boolean(kit.forward)} storeId={storeId} onClose={() => kit.setForward(null)} onSend={kit.sendForward} />
    </div>
  );
}
