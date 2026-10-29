"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Camera, Image as ImageIcon, Loader2, Mic, Music, Paperclip, Phone, Send, Trash2, Users, Video, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MAX_BYTES, MessageMedia, clock, kindOf, mediaMeta, prepareImage, uploadChatFile, useRecorder, type Attachment, type Pending } from "../pedidos/internos/chat-media";
import { startChatCall } from "../pedidos/internos/CallManager";
import { CallPicker, type CallCandidate } from "../pedidos/internos/CallPicker";

/** Conversación de un chat del equipo (20261271): mensajes en vivo, fotos, videos, audios, notas de voz y llamadas. */

export type Thread = { id: string; kind: "direct" | "group"; title: string | null; last_at: string; members: Array<{ user_id: string; name: string }> | null;
  last: { body: string; user_name: string | null; mine: boolean; created_at: string; kind: string } | null; unread: number };
type Msg = { id: string; user_id: string | null; user_name: string | null; body: string; kind: "message" | "system"; attachments: Attachment[] | null; created_at: string; mine: boolean };

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
export const threadName = (t: Thread) => (t.kind === "group" ? t.title ?? "Grupo" : t.members?.[0]?.name ?? "Chat");
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

export function Chat({ storeId, thread, me, onBack, onActivity }: { storeId: string; thread: Thread; me: string | null; onBack: () => void; onActivity: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [more, setMore] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [attachMenu, setAttachMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [pick, setPick] = useState<{ video: boolean } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const audioIn = useRef<HTMLInputElement>(null);
  const recorder = useRecorder();
  const name = threadName(thread);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_dm_messages", { p_thread: thread.id });
    if (error) return;
    const list = (data ?? []) as Msg[];
    setMsgs(list);
    setMore(list.length >= 60);
    void supabaseBrowser().rpc("erp_dm_read", { p_thread: thread.id }).then(() => onActivity());
  }, [thread.id, onActivity]);

  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  // En vivo: mensajes nuevos de este chat (y respaldo cada 15 s si la pestaña está a la vista).
  useEffect(() => {
    (window as Window & { __remhubOpenChat?: string | null }).__remhubOpenChat = thread.id;
    const ch = supabaseBrowser()
      .channel(`dm-${thread.id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_dm_messages", filter: `thread_id=eq.${thread.id}` }, () => void load())
      .subscribe();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000);
    return () => { (window as Window & { __remhubOpenChat?: string | null }).__remhubOpenChat = null; window.clearInterval(t); void supabaseBrowser().removeChannel(ch); };
  }, [thread.id, load]);

  const count = msgs?.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); setTyping(null); }, [count]);

  async function older() {
    const first = msgs?.[0];
    if (!first) return;
    const { data } = await supabaseBrowser().rpc("erp_dm_messages", { p_thread: thread.id, p_before: first.created_at });
    const list = (data ?? []) as Msg[];
    setMsgs((cur) => [...list, ...(cur ?? [])]);
    setMore(list.length >= 60);
  }

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
      const { data, error } = await supabaseBrowser().rpc("erp_dm_send", { p_thread: thread.id, p_body: msg, p_attachments: attachments });
      if (error) throw new Error(/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261271_mensajes_directos.sql." : error.message);
      const id = (data as { id?: string } | null)?.id;
      if (id) void notifyOthers(id);
      files.forEach((p) => URL.revokeObjectURL(p.preview));
      setPending((cur) => cur.filter((x) => !files.some((p) => p.id === x.id)));
      if (body === undefined) setText("");
      await load();
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

  // Llamar: en un chat de dos, directo; en un grupo, se escoge a quién (todos marcados).
  function call(video: boolean) {
    if (thread.kind === "direct") startChatCall(thread.id, video);
    else setPick({ video });
  }
  const loadMembers = useCallback(async (): Promise<CallCandidate[] | null> => (thread.members ?? []).map((m) => ({ user_id: m.user_id, name: m.name, involved: true })), [thread.members]);

  return (
    <div className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files); }}>
      <header className="flex items-center gap-3 border-b px-3 py-2.5" style={{ borderColor: "var(--t-card-border)" }}>
        <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full md:hidden" aria-label="Volver"><ArrowLeft size={18} /></button>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: thread.kind === "group" ? "linear-gradient(135deg,#0ea5e9,#8b5cf6)" : "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
          {thread.kind === "group" ? <Users size={18} /> : initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-black">{name}</p>
          <p className="truncate text-xs" style={{ color: typing ? "#10b981" : "var(--t-muted)" }}>
            {typing ? `${typing} está escribiendo…` : thread.kind === "group" ? (thread.members ?? []).map((m) => m.name).join(", ") : "Chat del equipo"}
          </p>
        </div>
        <button type="button" onClick={() => call(false)} className="grid h-10 w-10 place-items-center rounded-full text-white shadow transition hover:-translate-y-0.5" style={{ background: "#16a34a" }} aria-label="Llamar"><Phone size={17} /></button>
        <button type="button" onClick={() => call(true)} className="grid h-10 w-10 place-items-center rounded-full text-white shadow transition hover:-translate-y-0.5" style={{ background: "var(--t-accent)" }} aria-label="Videollamada"><Video size={17} /></button>
      </header>

      {dragging ? <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center border-2 border-dashed text-sm font-bold" style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-bg-base) 85%, transparent)", color: "var(--t-accent)" }}>Suelta aquí fotos, videos o audios</div> : null}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-3" style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--t-text) 6%, transparent) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
        {more && msgs?.length ? <button type="button" onClick={() => void older()} className="mx-auto mb-2 block rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Ver mensajes anteriores</button> : null}
        {msgs === null ? <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
        {msgs && !msgs.length ? <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>👋 Escribe el primer mensaje, manda una foto o una nota de voz.</p> : null}
        {msgs?.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const sameAuthor = prev && prev.user_id === m.user_id && !newDay && prev.kind === "message";
          const files = m.attachments ?? [];
          const autoLabel = files.length > 0 && /^(📷|🎥|🎤)/u.test(m.body) && m.body.length < 48;
          return (
            <div key={m.id}>
              {newDay ? <p className="my-3 text-center"><span className="rounded-full px-3 py-1 text-[11px] font-bold capitalize" style={{ background: "var(--t-card-bg)", color: "var(--t-muted)" }}>{dayLabel(m.created_at)}</span></p> : null}
              {m.kind === "system" ? (
                <p className="mx-auto my-1.5 max-w-[90%] rounded-xl px-3 py-1.5 text-center text-xs" style={{ background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)", color: "var(--t-muted)" }}>{m.body}</p>
              ) : (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex ${m.mine ? "justify-end" : "justify-start"} ${sameAuthor ? "" : "pt-1"}`}>
                  <div className={`max-w-[80%] rounded-2xl text-sm shadow-sm ${files.length ? "p-1.5" : "px-3.5 py-2"}`}
                    style={m.mine ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))", color: "#fff", borderBottomRightRadius: 6 } : { background: "var(--t-card-bg)", border: "1px solid var(--t-card-border)", borderBottomLeftRadius: 6 }}>
                    {!m.mine && thread.kind === "group" && !sameAuthor ? <p className={`text-[11px] font-bold ${files.length ? "px-2 pt-1" : ""}`} style={{ color: "var(--t-accent)" }}>{m.user_name}</p> : null}
                    {files.length ? <MessageMedia items={files} mine={m.mine} /> : null}
                    {!autoLabel ? <p className={`whitespace-pre-line break-words ${files.length ? "px-2 pt-1.5" : ""}`}>{m.body}</p> : null}
                    <p className={`mt-0.5 text-right text-[10px] opacity-70 ${files.length ? "px-2 pb-0.5" : ""}`}>{new Date(m.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                </motion.div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <div className="border-t p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
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
              <button type="button" disabled={sending} onClick={() => setAttachMenu((v) => !v)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Adjuntar"><Paperclip size={17} /></button>
              <AnimatePresence>
                {attachMenu ? (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-12 left-0 z-30 w-52 overflow-hidden rounded-2xl border p-1 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                    <button type="button" onClick={() => { setAttachMenu(false); gallery.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><ImageIcon size={17} className="text-violet-400" /> Fotos o videos</button>
                    <button type="button" onClick={() => { setAttachMenu(false); camera.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Camera size={17} className="text-pink-400" /> Cámara</button>
                    <button type="button" onClick={() => { setAttachMenu(false); audioIn.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Music size={17} className="text-amber-400" /> Archivo de audio</button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <input ref={gallery} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              <input ref={camera} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              <input ref={audioIn} type="file" accept="audio/*" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            <textarea value={text} rows={1}
              onChange={(e) => { setText(e.target.value); announceTyping(); }}
              onPaste={(e) => { const f = [...e.clipboardData.files].filter((x) => kindOf(x)); if (f.length) { e.preventDefault(); void addFiles(f); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={pending.length ? "Agrega un texto (opcional)…" : "Escribe un mensaje…"}
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
      <CallPicker open={Boolean(pick)} video={Boolean(pick?.video)} title={`Grupo «${name}»`} load={loadMembers} onCall={(to) => { if (pick) startChatCall(thread.id, pick.video, to); }} onClose={() => setPick(null)} />
    </div>
  );
}
