"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Ban, Camera, Phone, Video, CheckCircle2, ExternalLink, Image as ImageIcon, Loader2, Lock, MessageCircle, Mic, Music, Package, Paperclip, Send, Trash2, Truck, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Thumb, useThumbs } from "../../inventario/LineEditor";
import { useRunOnChange } from "../../inventario/shared";
import { cop, useListPrices } from "@/lib/print/list-prices";
import { RequestSignatures } from "./RequestSignatures";
import { ProductName } from "@/components/ProductName";
import { startCall } from "./CallManager";
import { CallPicker, type CallCandidate } from "./CallPicker";
import { MAX_BYTES, MessageMedia, clock, kindOf, mediaMeta, prepareImage, uploadChatFile, useRecorder, type Attachment, type Pending } from "./chat-media";
import { markOwnAction, soundFor } from "@/lib/sounds/notify";
import { STOCK_REQUESTS_CHANGED_EVENT, SR_STATUS, SR_STEPS, isOpen, srError, timeAgo, type SrDetail, type SrSignStep } from "./types";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const QUICK = {
  attend: ["✅ Sí hay, lo preparo ya", "⚠️ Solo hay una parte", "⏳ Lo despacho en un rato", "📦 Ya salió"],
  request: ["🙏 ¡Gracias!", "¿Para cuándo llega?", "Me sirve lo que haya", "📥 Ya llegó, reviso"],
};

/** Pedido interno abierto: estado, productos, acciones y chat en vivo. */
export function RequestRoom({ requestId, onClose, onChanged }: { requestId: string | null; onClose: () => void; onChanged: () => void }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [loaded, setLoaded] = useState<{ id: string; data: SrDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState<Record<string, number>>({});
  const [receiving, setReceiving] = useState<Record<string, number> | null>(null);
  const [mobileTab, setMobileTab] = useState<"items" | "chat">("chat");
  // Después de despachar o recibir se abre la firma de ese paso.
  const [autoSign, setAutoSign] = useState<SrSignStep | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  // Archivos del chat (20261267): los que se van a enviar y los de cada mensaje.
  const [pending, setPending] = useState<Pending[]>([]);
  const [media, setMedia] = useState<Record<string, Attachment[]>>({});
  const [attachMenu, setAttachMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const recorder = useRecorder();
  // Llamar: primero se escoge a quién (solo los del pedido), nunca a todo el mundo.
  const [callPick, setCallPick] = useState<{ video: boolean } | null>(null);
  const loadCandidates = useCallback(async (): Promise<CallCandidate[] | null> => {
    if (!requestId) return null;
    const { data: c, error: e } = await supabaseBrowser().rpc("erp_call_candidates", { p_request: requestId });
    return e ? null : (c as CallCandidate[]);
  }, [requestId]);
  const data = loaded && loaded.id === requestId ? loaded.data : null;
  const thumbs = useThumbs(data ? data.items.map((i) => i.product_id) : []);
  // Precio por mayor (precio 2) de cada producto, para ver cuánto vale el pedido.
  const prices = useListPrices(data ? data.items.map((i) => i.product_id) : []);

  const load = useCallback(async () => {
    if (!requestId) return;
    const { data: res, error: err } = await supabaseBrowser().rpc("erp_stock_request_detail", { p_request: requestId });
    if (err) return setError(srError(err));
    setError(null);
    setLoaded({ id: requestId, data: res as SrDetail });
    void supabaseBrowser().rpc("erp_stock_request_read", { p_request: requestId });
    // Sin la migración 20261267 no hay archivos: el chat sigue igual.
    void supabaseBrowser().rpc("erp_stock_request_media", { p_request: requestId }).then(({ data: m, error: e }) => { if (!e && m) setMedia(m as Record<string, Attachment[]>); });
  }, [requestId]);
  useRunOnChange(load);

  // En vivo: aviso de la conexión única del panel (StockRequestWatcher) y respaldo cada 15 s mientras esté abierto.
  useEffect(() => {
    if (!requestId) return;
    const onChange = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      if (!id || id === requestId) void load();
    };
    window.addEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000);
    (window as Window & { __remhubOpenRequest?: string | null }).__remhubOpenRequest = requestId;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange);
      window.clearInterval(timer);
      (window as Window & { __remhubOpenRequest?: string | null }).__remhubOpenRequest = null;
      document.body.style.overflow = prev;
    };
  }, [requestId, load]);

  const messageCount = data?.messages.length ?? 0;
  // Suena cuando otra persona escribe mientras el pedido está abierto (no al abrirlo ni con mis mensajes).
  const heard = useRef<{ id: string; last: string | null } | null>(null);
  useEffect(() => {
    if (!data) return;
    const last = [...data.messages].reverse().find((m) => m.kind === "message") ?? null;
    const prev = heard.current;
    heard.current = { id: data.request.id, last: last?.id ?? null };
    if (!prev || prev.id !== data.request.id || !last || last.id === prev.last || last.mine) return;
    void soundFor(data.request.store_id, "message");
  }, [data]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageCount, mobileTab]);

  /** Envía texto, o archivos con texto opcional (se suben primero, con progreso). Respuesta rápida = solo texto. */
  async function send(body?: string, files: Pending[] = body ? [] : pending) {
    const msg = (body ?? text).trim();
    if ((!msg && !files.length) || !requestId || sending || !data) return;
    setSending(true);
    try {
      if (files.length) {
        const attachments: Attachment[] = [];
        for (const p of files) {
          const path = await uploadChatFile(data.request.store_id, requestId, p.file, (v) => setPending((cur) => cur.map((x) => (x.id === p.id ? { ...x, progress: v } : x))));
          attachments.push({ type: p.type, path, mime: p.file.type, size: p.file.size, duration: p.duration, width: p.width, height: p.height });
        }
        const { error: err } = await supabaseBrowser().rpc("erp_stock_request_message_media", { p_request: requestId, p_body: msg, p_attachments: attachments });
        if (err) throw new Error(/Could not find the function|schema cache/i.test(err.message) ? "Falta ejecutar en Supabase la migración 20261267_chat_multimedia.sql." : srError(err));
        files.forEach((p) => URL.revokeObjectURL(p.preview));
        setPending((cur) => cur.filter((x) => !files.some((p) => p.id === x.id)));
      } else {
        const { error: err } = await supabaseBrowser().rpc("erp_stock_request_message", { p_request: requestId, p_body: msg });
        if (err) throw new Error(srError(err));
      }
      if (!body) setText("");
      void load();
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se envió", text: e instanceof Error ? e.message : "Intenta de nuevo." });
    } finally {
      setSending(false);
    }
  }

  /** Fotos (más livianas), videos y audios a la bandeja de envío. Máximo 10 y 50 MB cada uno. */
  async function addFiles(list: FileList | File[] | null) {
    const files = [...(list ?? [])];
    const room = 10 - pending.length;
    const out: Pending[] = [];
    const skipped: string[] = [];
    for (const raw of files.slice(0, Math.max(0, room))) {
      const type = kindOf(raw);
      if (!type) { skipped.push(`${raw.name}: solo fotos, videos o audios`); continue; }
      const prepared = type === "image" ? await prepareImage(raw) : { file: raw };
      if (prepared.file.size > MAX_BYTES) { skipped.push(`${raw.name}: pesa más de 50 MB`); continue; }
      const meta = type === "image" ? {} : await mediaMeta(prepared.file, type);
      out.push({ id: crypto.randomUUID(), file: prepared.file, type, preview: URL.createObjectURL(prepared.file), progress: 0, ...("width" in prepared ? { width: prepared.width, height: prepared.height } : {}), ...meta });
    }
    if (files.length > room) skipped.push("Máximo 10 archivos por mensaje");
    if (out.length) setPending((cur) => [...cur, ...out]);
    if (skipped.length) void Swal.fire({ ...swal, icon: "info", title: "Algunos archivos no se agregaron", html: skipped.map((x) => `• ${x}`).join("<br/>") });
  }

  function removePending(id: string) {
    setPending((cur) => {
      const p = cur.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.preview);
      return cur.filter((x) => x.id !== id);
    });
  }

  async function startVoice() {
    try {
      await recorder.start();
    } catch {
      void Swal.fire({ ...swal, icon: "info", title: "Sin micrófono", text: "Permite el micrófono para este sitio (candado junto a la dirección) y vuelve a intentar." });
    }
  }

  /** Termina la nota de voz y la envía de una vez. */
  async function sendVoice() {
    const { file, duration } = await recorder.stop();
    if (!file || duration < 1) return;
    const p: Pending = { id: crypto.randomUUID(), file, type: "audio", preview: URL.createObjectURL(file), progress: 0, duration };
    setPending((cur) => [...cur, p]);
    await send("", [p]);
  }

  // «Está escribiendo…»: aviso efímero entre quienes tienen el pedido abierto (no se guarda).
  const typingChannel = useRef<ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null>(null);
  const lastTyping = useRef(0);
  const myName = data?.messages.find((m) => m.mine && m.user_name)?.user_name ?? null;
  useEffect(() => {
    if (!requestId) return;
    const me = crypto.randomUUID();
    let clear = 0;
    const ch = supabaseBrowser().channel(`sr-typing-${requestId}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { by?: string; name?: string };
      if (p.by === me) return;
      setTyping(p.name || "Alguien");
      window.clearTimeout(clear);
      clear = window.setTimeout(() => setTyping(null), 3500);
    }).subscribe();
    typingChannel.current = ch;
    (ch as unknown as { __me: string }).__me = me;
    return () => { window.clearTimeout(clear); typingChannel.current = null; void supabaseBrowser().removeChannel(ch); };
  }, [requestId]);
  function announceTyping() {
    const ch = typingChannel.current;
    if (!ch || Date.now() - lastTyping.current < 2000) return;
    lastTyping.current = Date.now();
    void ch.send({ type: "broadcast", event: "typing", payload: { by: (ch as unknown as { __me: string }).__me, name: myName } });
  }
  // Un mensaje nuevo del otro borra el «escribiendo…».
  useEffect(() => { setTyping(null); }, [messageCount]);

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    if (requestId) markOwnAction(requestId);
    const { data: res, error: err } = await supabaseBrowser().rpc(fn, args);
    setBusy(false);
    if (err) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo completar", text: srError(err) });
      return null;
    }
    void Swal.fire({ ...swal, icon: "success", title: ok, timer: 1400, showConfirmButton: false });
    await load();
    onChanged();
    return res ?? true;
  }

  async function saveQuantities(andTake = false) {
    if (!data) return;
    const items = Object.entries(approved).map(([item_id, qty_approved]) => ({ item_id, qty_approved }));
    const res = await run("erp_stock_request_prepare", { p_request: data.request.id, p_items: items.length ? items : null }, andTake ? "Pedido en preparación" : "Cantidades confirmadas");
    if (res) setApproved({});
  }

  async function dispatch() {
    if (!data) return;
    // Se permite despachar sin existencias: el origen puede quedar en 0 o en negativo.
    const negatives = data.items
      .map((i) => ({ name: i.name, after: i.source_now - (approved[i.id] ?? i.qty_approved ?? i.qty_requested) }))
      .filter((x) => x.after < 0);
    if (Object.keys(approved).length) await saveQuantities();
    const res = await Swal.fire({
      ...swal,
      title: "🚚 Enviar: va en camino",
      html: `<div style="text-align:left;display:grid;gap:10px;font-size:13px">
        <p style="opacity:.8">Se crea el traslado y la mercancía sale del inventario de <b>${data.request.to_name}</b>. Luego quien la lleva firma <b>“En camino”</b>.</p>
        ${negatives.length ? `<div style="border:1px solid rgba(245,158,11,.5);background:rgba(245,158,11,.1);border-radius:12px;padding:8px 10px">⚠️ Sin existencias suficientes; el inventario de origen quedará así:<br/>${negatives.map((n) => `• ${n.name}: <b>${n.after}</b>`).join("<br/>")}</div>` : ""}
      </div>`,
      showCancelButton: true,
      confirmButtonText: "Enviar",
      cancelButtonText: "Cancelar",
    });
    if (!res.isConfirmed) return;
    // Los nombres del traslado salen de las firmas: "Revisó" ahora y "En camino" al firmar.
    const checked = data.signatures?.find((s) => s.step === "sent")?.signer_name ?? null;
    const done = await run("erp_stock_request_dispatch", { p_request: data.request.id, p_carrier: null, p_checked_by: checked, p_note: null }, "¡Enviado! Ahora firma quien lo lleva");
    if (done) setAutoSign("delivered");
  }

  async function close(action: "reject" | "cancel") {
    if (!data) return;
    const res = await Swal.fire({ ...swal, icon: "warning", title: action === "reject" ? "Rechazar pedido" : "Cancelar pedido", input: "text", inputPlaceholder: "Motivo (se verá en el chat)", showCancelButton: true, confirmButtonText: action === "reject" ? "Rechazar" : "Cancelar pedido", cancelButtonText: "Volver", confirmButtonColor: "#ef4444", inputValidator: (v) => (v.trim() ? null : "Escribe el motivo.") });
    if (!res.isConfirmed) return;
    await run("erp_stock_request_close", { p_request: data.request.id, p_action: action, p_reason: res.value }, action === "reject" ? "Pedido rechazado" : "Pedido cancelado");
  }

  // "Recibió" se firma antes de recibir: sin firma no se confirma.
  const pendingReceive = useRef(false);
  async function receive(signedNow = false) {
    if (!data || !receiving) return;
    if (!signedNow && !data.signatures?.some((s) => s.step === "received")) {
      pendingReceive.current = true;
      setAutoSign("received");
      void Swal.fire({ ...swal, icon: "info", title: "Primero firma “Recibió”", text: "Escribe tu nombre y firma; al terminar se confirma lo recibido.", timer: 1800, showConfirmButton: false });
      return;
    }
    const items = data.items.filter((i) => (i.qty_approved ?? 0) > 0).map((i) => ({ product_id: i.product_id, received_qty: receiving[i.id] ?? i.qty_approved ?? 0 }));
    const missing = data.items.reduce((s, i) => s + Math.max(0, (i.qty_approved ?? 0) - (receiving[i.id] ?? i.qty_approved ?? 0)), 0);
    const extra = data.items.reduce((s, i) => s + Math.max(0, (receiving[i.id] ?? i.qty_approved ?? 0) - (i.qty_approved ?? 0)), 0);
    let notes: string | null = null;
    if (missing > 0 || extra > 0) {
      const res = await Swal.fire({
        ...swal,
        icon: "warning",
        title: missing && extra ? "Llegó distinto a lo enviado" : missing ? `Faltan ${missing} unidades` : `Llegaron ${extra} unidades de más`,
        html: [
          missing ? `Lo que no llegó (<b>${missing}</b>) vuelve al inventario de <b>${data.request.to_name}</b>.` : "",
          extra ? `Lo que llegó de más (<b>${extra}</b>) se suma a tu punto y se descuenta de <b>${data.request.to_name}</b>.` : "",
          "¿Qué pasó?",
        ].filter(Boolean).join("<br/>"),
        input: "text",
        inputPlaceholder: missing ? "Ej: una caja llegó dañada" : "Ej: el encargado decidió mandar más",
        showCancelButton: true,
        confirmButtonText: "Confirmar recibido",
        cancelButtonText: "Revisar",
      });
      if (!res.isConfirmed) return;
      notes = String(res.value ?? "");
    }
    const ok = await run("erp_stock_request_receive", { p_request: data.request.id, p_items: items, p_notes: notes }, "¡Recibido! El inventario de tu punto quedó actualizado");
    if (ok) setReceiving(null);
  }

  if (!mounted) return null;
  const r = data?.request;
  const st = r ? SR_STATUS[r.status] : null;
  const canAttend = Boolean(data?.access.attend && r && (r.status === "pending" || r.status === "preparing"));
  const canCancel = Boolean(data?.access.request && r && (r.status === "pending" || r.status === "preparing"));
  const canReceive = Boolean(data?.access.request && r?.status === "dispatched");
  const edited = Object.keys(approved).length > 0;
  // Para enviar deben estar firmados "Preparó" y "Revisó".
  const readyToSend = Boolean(data?.signatures?.some((s) => s.step === "packed") && data?.signatures?.some((s) => s.step === "sent"));

  const itemsPanel = data && r ? (
    <div className="space-y-3">
      <div className="space-y-2">
        {data.items.map((i) => {
          const toSend = approved[i.id] ?? i.qty_approved ?? i.qty_requested;
          const short = i.source_now < toSend && isOpen(r.status) && r.status !== "dispatched";
          return (
            <div key={i.id} className="flex items-center gap-3 rounded-2xl border p-2.5" style={{ borderColor: short ? "color-mix(in oklab, #f59e0b 50%, transparent)" : "var(--t-card-border)" }}>
              <Thumb src={thumbs[i.product_id] ?? i.image_url} size={44} />
              <div className="min-w-0 flex-1">
                <ProductName name={i.name} className="text-sm font-semibold" />
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Pidió <b style={{ color: "var(--t-text)" }}>{i.qty_requested}</b>
                  {r.status !== "dispatched" && r.status !== "received" ? <> · En {r.to_name}: <b style={{ color: i.source_now > 0 ? "#22c55e" : "#ef4444" }}>{i.source_now}</b></> : null}
                  {" "}· En {r.from_name}: {i.dest_now}
                </p>
                {i.qty_received !== null ? <p className="text-xs font-semibold" style={{ color: i.qty_received < (i.qty_approved ?? 0) ? "#f59e0b" : "#22c55e" }}>Recibido {i.qty_received} de {i.qty_approved}</p> : null}
                {prices?.get(i.product_id) ? (
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                    P. mayor {cop(prices.get(i.product_id)!.price2)} · <b style={{ color: "var(--t-text)" }}>{cop(toSend * prices.get(i.product_id)!.price2)}</b>
                  </p>
                ) : null}
              </div>
              {canAttend ? (
                <label className="text-center text-[10px] font-semibold uppercase" style={{ color: "var(--t-muted)" }}>
                  Enviar
                  <input
                    type="text"
                    inputMode="numeric"
                    value={toSend}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setApproved((cur) => ({ ...cur, [i.id]: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0) }))}
                    className="mt-0.5 block h-9 w-16 rounded-lg border text-center text-sm font-black outline-none"
                    style={{ borderColor: short ? "#f59e0b" : "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
                  />
                </label>
              ) : canReceive && receiving ? (
                <label className="text-center text-[10px] font-semibold uppercase" style={{ color: "var(--t-muted)" }}>
                  Llegó
                  <input
                    type="text"
                    inputMode="numeric"
                    value={receiving[i.id] ?? i.qty_approved ?? 0}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setReceiving((cur) => ({ ...(cur ?? {}), [i.id]: Math.min(1000000, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)) }))}
                    className="mt-0.5 block h-9 w-16 rounded-lg border text-center text-sm font-black outline-none"
                    style={{
                      borderColor: (receiving[i.id] ?? i.qty_approved ?? 0) > (i.qty_approved ?? 0) ? "#0ea5e9" : (receiving[i.id] ?? i.qty_approved ?? 0) < (i.qty_approved ?? 0) ? "#f59e0b" : "var(--t-card-border)",
                      background: "var(--t-card-bg)", color: "var(--t-text)",
                    }}
                  />
                  <span className="text-[10px] normal-case">
                    {(receiving[i.id] ?? i.qty_approved ?? 0) > (i.qty_approved ?? 0)
                      ? `+${(receiving[i.id] ?? 0) - (i.qty_approved ?? 0)} de más`
                      : (receiving[i.id] ?? i.qty_approved ?? 0) < (i.qty_approved ?? 0)
                        ? `faltan ${(i.qty_approved ?? 0) - (receiving[i.id] ?? 0)}`
                        : `de ${i.qty_approved ?? 0} enviadas`}
                  </span>
                </label>
              ) : (
                <span className="text-right text-sm font-black tabular-nums">{i.qty_approved ?? i.qty_requested}<span className="block text-[10px] font-normal" style={{ color: "var(--t-muted)" }}>{i.qty_approved !== null ? "enviar" : "pedido"}</span></span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
        <span>
          {data.items.reduce((s, i) => s + (approved[i.id] ?? i.qty_approved ?? i.qty_requested), 0)} und. · {data.items.length} referencias
          {prices ? <> · Valor por mayor <b>{cop(data.items.reduce((s, i) => s + (approved[i.id] ?? i.qty_approved ?? i.qty_requested) * (prices.get(i.product_id)?.price2 ?? 0), 0))}</b></> : null}
        </span>
        <a href={`/documento/pedido-interno/${r.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
          🖨️ Imprimir pedido
        </a>
      </div>

      <RequestSignatures
        data={data}
        onSigned={(step) => {
          if (step === "received" && pendingReceive.current) {
            pendingReceive.current = false;
            void receive(true);
            return;
          }
          void load();
          onChanged();
        }}
        onCancel={() => { pendingReceive.current = false; }}
        autoOpen={autoSign}
        onAutoOpenDone={() => setAutoSign(null)}
      />

      {data.transfer ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <Truck size={15} /> Traslado #{data.transfer.number} · {data.transfer.status === "in_transit" ? "en tránsito" : data.transfer.status === "received" ? "recibido" : "anulado"}
            {data.transfer.carrier_name ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>· Lleva: <b className="uppercase">{data.transfer.carrier_name}</b></span> : null}
            {data.transfer.checked_by_name ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>· Revisó: <b className="uppercase">{data.transfer.checked_by_name}</b></span> : null}
          </span>
          {data.transfer.track_token ? (
            <a href={`/traslado/${data.transfer.track_token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold underline" style={{ color: "var(--t-accent)" }}>
              Seguimiento y firmas <ExternalLink size={12} />
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canAttend && r.status === "pending" ? (
          <button type="button" disabled={busy} onClick={() => void saveQuantities(true)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: "#f59e0b" }}>
            🧑‍🔧 Tomar y preparar
          </button>
        ) : null}
        {canAttend && r.status === "preparing" && edited ? (
          <button type="button" disabled={busy} onClick={() => void saveQuantities()} className="rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
            💾 Confirmar cantidades
          </button>
        ) : null}
        {canAttend ? (
          <button type="button" disabled={busy || !readyToSend} onClick={() => void dispatch()} title={readyToSend ? "Enviar" : "Primero firma Preparó y Revisó"} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#0ea5e9" }}>
            <Truck size={15} /> Enviar (va en camino)
          </button>
        ) : null}
        {canReceive && !receiving ? (
          <button type="button" onClick={() => setReceiving({})} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: "#16a34a" }}>
            <Package size={15} /> Confirmar lo que llegó
          </button>
        ) : null}
        {canReceive && receiving ? (
          <>
            <button type="button" disabled={busy} onClick={() => void receive()} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: "#16a34a" }}>
              <CheckCircle2 size={15} /> {data.signatures?.some((x) => x.step === "received") ? "Confirmar recibido" : "Firmar y confirmar recibido"}
            </button>
            <button type="button" onClick={() => setReceiving(null)} className="rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
          </>
        ) : null}
        {canAttend ? (
          <button type="button" disabled={busy} onClick={() => void close("reject")} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold text-red-400" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }}>
            <Ban size={14} /> Rechazar
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" disabled={busy} onClick={() => void close("cancel")} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold text-red-400" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }}>
            <Ban size={14} /> Cancelar pedido
          </button>
        ) : null}
      </div>
      {canReceive && receiving ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Escribe lo que realmente llegó (puede ser menos o más de lo enviado). Si falta, vuelve a {r.to_name}; si llegó de más, se descuenta de {r.to_name}. Todo queda en el chat y el kardex.</p> : null}
      {canAttend ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Pasos: ajusta “Enviar” según lo que vas a mandar → firma “Preparó” → firma “Revisó” → toca “Enviar” y quien lo lleva firma “En camino”. Se descuenta de {r.to_name} aunque quede en 0 o en negativo.</p> : null}
    </div>
  ) : null;

  const chatPanel = data && r ? (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (data.access.chat && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { if (!data.access.chat) return; e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files); }}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed text-sm font-bold" style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-bg-base) 80%, transparent)", color: "var(--t-accent)" }}>
          Suelta aquí fotos, videos o audios
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1 py-2">
        {data.messages.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="mx-auto max-w-[92%] whitespace-pre-line rounded-2xl border px-3 py-2 text-center text-xs" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)", color: "var(--t-muted)" }}>
                {m.body}
                <span className="mt-0.5 block text-[10px] opacity-70">{new Date(m.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
            );
          }
          const files = media[m.id] ?? [];
          // Si el mensaje solo trae archivos, su texto es la etiqueta automática («📷 Foto»): no se repite.
          const autoLabel = files.length > 0 && /^(📷|🎥|🎤)/u.test(m.body) && m.body.length < 48;
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[82%] rounded-2xl text-sm shadow-sm ${files.length ? "p-1.5" : "px-3.5 py-2"}`}
                style={m.mine
                  ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))", color: "#fff", borderBottomRightRadius: 6 }
                  : { background: "var(--t-card-bg)", border: "1px solid var(--t-card-border)", borderBottomLeftRadius: 6 }}
              >
                {!m.mine ? <p className={`text-[11px] font-bold ${files.length ? "px-2 pt-1" : ""}`} style={{ color: "var(--t-accent)" }}>{m.user_name}{m.point_name ? ` · ${m.point_name}` : ""}</p> : null}
                {files.length ? <MessageMedia items={files} mine={m.mine} /> : null}
                {!autoLabel ? <p className={`whitespace-pre-line break-words ${files.length ? "px-2 pt-1.5" : ""}`}>{m.body}</p> : null}
                <p className={`mt-0.5 text-right text-[10px] opacity-70 ${files.length ? "px-2 pb-0.5" : ""}`}>{new Date(m.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </motion.div>
          );
        })}
        <AnimatePresence>
          {typing ? (
            <motion.p key="typing" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-2 text-xs italic" style={{ color: "var(--t-muted)" }}>
              {typing} está escribiendo<span className="animate-pulse">…</span>
            </motion.p>
          ) : null}
        </AnimatePresence>
        <div ref={chatEnd} />
      </div>
      {data.access.chat ? (
        <div className="border-t pt-2" style={{ borderColor: "var(--t-card-border)" }}>
          {pending.length ? (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {pending.map((p) => (
                <div key={p.id} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  {p.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.preview} alt="" className="h-full w-full object-cover" />
                  ) : p.type === "video" ? (
                    <video src={p.preview} muted playsInline className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-2xl">🎤</span>
                  )}
                  {p.duration ? <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{clock(p.duration)}</span> : null}
                  {sending ? (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-black/30"><span className="block h-full bg-emerald-400 transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} /></span>
                  ) : (
                    <button type="button" onClick={() => removePending(p.id)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white" aria-label="Quitar"><X size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {(data.access.attend && !data.access.request ? QUICK.attend : data.access.request && !data.access.attend ? QUICK.request : [...QUICK.attend.slice(0, 2), ...QUICK.request.slice(0, 2)]).map((qr) => (
                <button key={qr} type="button" disabled={sending} onClick={() => void send(qr)} className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                  {qr}
                </button>
              ))}
            </div>
          )}
          {recorder.state === "recording" ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void recorder.stop(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border text-red-400" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cancelar audio"><Trash2 size={17} /></button>
              <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3" style={{ borderColor: "color-mix(in oklab, #ef4444 50%, transparent)", background: "var(--t-card-bg)" }}>
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                <span className="w-10 shrink-0 font-mono text-xs tabular-nums">{clock(recorder.elapsed)}</span>
                <span className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
                  {recorder.levels.map((v, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-red-400" style={{ height: `${Math.max(12, v * 100)}%` }} />)}
                </span>
              </div>
              <button type="button" onClick={() => void sendVoice()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white" style={{ background: "var(--t-accent)" }} aria-label="Enviar audio"><Send size={17} /></button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="relative">
                <button type="button" disabled={sending} onClick={() => setAttachMenu((v) => !v)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border transition hover:-translate-y-0.5 disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Adjuntar">
                  <Paperclip size={17} />
                </button>
                <AnimatePresence>
                  {attachMenu ? (
                    <motion.div initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-12 left-0 z-30 w-52 overflow-hidden rounded-2xl border p-1 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                      <button type="button" onClick={() => { setAttachMenu(false); galleryInput.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><ImageIcon size={17} className="text-violet-400" /> Fotos o videos</button>
                      <button type="button" onClick={() => { setAttachMenu(false); cameraInput.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Camera size={17} className="text-pink-400" /> Cámara</button>
                      <button type="button" onClick={() => { setAttachMenu(false); audioInput.current?.click(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Music size={17} className="text-amber-400" /> Archivo de audio</button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <input ref={galleryInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                <input ref={cameraInput} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              </div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); announceTyping(); }}
                onPaste={(e) => {
                  const files = [...e.clipboardData.files].filter((f) => kindOf(f));
                  if (files.length) { e.preventDefault(); void addFiles(files); }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder={pending.length ? "Agrega un texto (opcional)…" : "Escribe un mensaje… (Enter envía)"}
                className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-500/25"
                style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
              />
              {text.trim() || pending.length ? (
                <button type="button" onClick={() => void send()} disabled={sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition disabled:opacity-40" style={{ background: "var(--t-accent)" }} aria-label="Enviar">
                  {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                </button>
              ) : (
                <button type="button" onClick={() => void startVoice()} disabled={sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition hover:scale-105 disabled:opacity-40" style={{ background: "var(--t-accent)" }} aria-label="Grabar audio">
                  <Mic size={18} />
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          <Lock size={13} /> {isOpen(r.status) ? "Solo lectura para tu usuario." : "Conversación cerrada: el pedido terminó."}
        </p>
      )}
    </div>
  ) : null;

  return createPortal(
    <AnimatePresence>
      {requestId ? (
        <motion.div key="sr-room" className="fixed inset-0 z-120 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Pedido interno"
            className="relative flex h-dvh w-full max-w-5xl flex-col border-l shadow-[0_0_80px_rgba(0,0,0,0.45)]"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <header className="border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>
                    Pedido interno {r ? `#${r.number}` : ""}
                    {r?.priority === "urgent" ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] text-white">⚡ Urgente</span> : null}
                  </p>
                  {r ? (
                    <h3 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-black">
                      {r.to_name} <ArrowRight size={17} style={{ color: "var(--t-muted)" }} /> {r.from_name}
                    </h3>
                  ) : <div className="mt-1 h-6 w-56 animate-pulse rounded" style={{ background: "var(--t-card-bg)" }} />}
                  {r ? (
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                      Pidió {r.requested_by_name ?? "—"} · {timeAgo(r.created_at)}{r.handled_by_name ? ` · Atiende ${r.handled_by_name}` : ""}{r.needed_by ? ` · Para el ${new Date(`${r.needed_by}T12:00:00`).toLocaleDateString("es-CO")}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {data && r && data.access.chat && isOpen(r.status) ? (
                    <>
                      <button type="button" onClick={() => setCallPick({ video: false })} className="grid h-9 w-9 place-items-center rounded-full text-white shadow transition hover:-translate-y-0.5" style={{ background: "#16a34a" }} aria-label="Llamar" title="Llamar al otro punto"><Phone size={16} /></button>
                      <button type="button" onClick={() => setCallPick({ video: true })} className="grid h-9 w-9 place-items-center rounded-full text-white shadow transition hover:-translate-y-0.5" style={{ background: "var(--t-accent)" }} aria-label="Videollamada" title="Videollamada con el otro punto"><Video size={16} /></button>
                    </>
                  ) : null}
                  <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
                    <X size={16} />
                  </button>
                </div>
              </div>
              {r && st ? (
                st.step >= 0 ? (
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {SR_STEPS.map((s, idx) => {
                      const meta = SR_STATUS[s];
                      const done = idx <= st.step;
                      return (
                        <div key={s} className="min-w-0">
                          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
                            <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: done ? "100%" : "0%" }} transition={{ duration: 0.5, delay: idx * 0.08 }} style={{ background: meta.color }} />
                          </div>
                          <p className="mt-1 truncate text-[11px] font-semibold" style={{ color: done ? meta.color : "var(--t-muted)" }}>{meta.icon} {meta.short}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: `color-mix(in oklab, ${st.color} 14%, transparent)`, color: st.color }}>
                    {st.icon} {st.label}{r.close_reason ? `: ${r.close_reason}` : ""}
                  </p>
                )
              ) : null}
            </header>

            {error ? <p className="m-5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}

            {data ? (
              <>
                <div className="flex gap-1 border-b p-2 md:hidden" style={{ borderColor: "var(--t-card-border)" }}>
                  {([["chat", `💬 Chat (${data.messages.filter((m) => m.kind === "message").length})`], ["items", `📦 Productos (${data.items.length})`]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setMobileTab(k)} className="flex-1 rounded-full px-3 py-1.5 text-xs font-bold" style={mobileTab === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
                      {l}
                    </button>
                  ))}
                </div>
                <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                  <div className={`min-h-0 overflow-y-auto overscroll-contain p-4 md:block md:border-r ${mobileTab === "items" ? "block" : "hidden"}`} style={{ borderColor: "var(--t-card-border)" }}>
                    {itemsPanel}
                  </div>
                  <div className={`min-h-0 flex-col p-3 md:flex ${mobileTab === "chat" ? "flex" : "hidden"}`}>
                    <p className="mb-1 hidden items-center gap-2 px-1 text-xs font-bold uppercase tracking-wide md:flex" style={{ color: "var(--t-muted)" }}>
                      <MessageCircle size={13} /> Conversación del pedido
                    </p>
                    {chatPanel}
                  </div>
                </div>
              </>
            ) : !error ? (
              <div className="m-5 h-64 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg)" }} />
            ) : null}
            <CallPicker open={Boolean(callPick)} video={Boolean(callPick?.video)} title={r ? `Pedido interno #${r.number} · ${r.to_name} ↔ ${r.from_name}` : "Pedido interno"}
              load={loadCandidates} onCall={(to) => { if (requestId && callPick) startCall(requestId, callPick.video, to); }} onClose={() => setCallPick(null)} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
