"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Ban, Bell, BellOff, Check, ListChecks, PackagePlus, Trash, Camera, Phone, Search, Video, CheckCircle2, ExternalLink, Image as ImageIcon, Loader2, Lock, MessageCircle, Mic, Music, Package, Paperclip, Send, Trash2, Truck, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ProductSearchModal, Thumb, useThumbs } from "../../inventario/LineEditor";
import { useRunOnChange } from "../../inventario/shared";
import { cop, useListPrices } from "@/lib/print/list-prices";
import { RequestSignatures } from "./RequestSignatures";
import { ProductName } from "@/components/ProductName";
import { startCall } from "./CallManager";
import { CallPicker, type CallCandidate } from "./CallPicker";
import { PeoplePicker, type Person } from "./PeoplePicker";
import { useRouter } from "next/navigation";
import { ChatBubble, ChatSearchBar, ComposerBanner, ForwardDialog, MentionSuggestions, PinnedBar, SystemLine, muteChat, type ChatMsg } from "@/components/chat/ChatParts";
import { useChatKit } from "@/components/chat/useChatKit";
import { MAX_BYTES, clock, kindOf, mediaMeta, prepareImage, uploadChatFile, useRecorder, type Attachment, type Pending } from "./chat-media";
import { markOwnAction, soundFor } from "@/lib/sounds/notify";
import { STOCK_REQUESTS_CHANGED_EVENT, SR_STATUS, SR_STEPS, isOpen, srError, timeAgo, type SrDetail, type SrSignStep } from "./types";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const QUICK = {
  attend: ["✅ Sí hay, lo preparo ya", "⚠️ Solo hay una parte", "⏳ Lo despacho en un rato", "📦 Ya salió"],
  request: ["🙏 ¡Gracias!", "¿Para cuándo llega?", "Me sirve lo que haya", "📥 Ya llegó, reviso"],
};

const pickSelected = (l: Person[]) => l.filter((p) => p.selected).map((p) => p.user_id);
const pickInvolved = (l: Person[]) => l.filter((p) => p.involved).map((p) => p.user_id);

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
  const [productPick, setProductPick] = useState(false);
  const [itemPick, setItemPick] = useState(false);
  // Lista de chequeo (20261277): lo empacado (quien despacha) y lo contado al recibir (quien recibe).
  const [checks, setChecks] = useState<Array<{ item_id: string; side: "pack" | "receive"; by: string | null; at: string }>>([]);
  const [onlyPending, setOnlyPending] = useState(false);
  const [srPeople, setSrPeople] = useState<Array<{ user_id: string; name: string }>>([]);
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
  // «🔔 Avisos»: a quién le llegan los mensajes de este pedido. «💬 Chat aparte»: chat o grupo con quien se escoja.
  const [peoplePick, setPeoplePick] = useState<"notify" | "chat" | null>(null);
  const router = useRouter();
  const loadPeople = useCallback(async (): Promise<Person[] | null> => {
    if (!requestId) return null;
    const { data: p, error: e } = await supabaseBrowser().rpc("erp_sr_notify_get", { p_request: requestId });
    return e ? null : ((p as { people: Person[] }).people ?? []);
  }, [requestId]);
  const loadOthers = useCallback(async () => (await loadPeople())?.filter((p) => !p.me) ?? null, [loadPeople]);
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

  // Lo compartido con «Mensajes» (20261273): responder, reacciones, visto, editar, fijar, guardar, @, producto, reenviar y buscar.
  const chatMsgs = (data?.messages ?? []) as ChatMsg[];
  const filesOf = useCallback((id: string) => media[id] ?? [], [media]);
  const kit = useChatKit({ scope: "sr", chatId: requestId, storeId: data?.request.store_id ?? null, msgs: chatMsgs, people: srPeople, filesOf, setText, onChanged: () => void load() });
  const ex = kit.extras;
  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_sr_notify_get", { p_request: requestId }).then(({ data: p, error: e }) => {
      if (alive && !e) setSrPeople(((p as { people: Array<{ user_id: string; name: string; me?: boolean }> }).people ?? []).filter((x) => !x.me));
    });
    // Ediciones y borrados de otros: se vuelve a cargar el chat.
    const ch = supabaseBrowser()
      .channel(`sr-edits-${requestId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "erp_stock_request_messages", filter: `request_id=eq.${requestId}` }, () => void load())
      .subscribe();
    const loadChecks = () => void supabaseBrowser().rpc("erp_sr_item_checks", { p_request: requestId }).then(({ data: c, error: e }) => { if (alive && !e && Array.isArray(c)) setChecks(c as typeof checks); });
    loadChecks();
    const chk = supabaseBrowser()
      .channel(`sr-checks-${requestId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_sr_item_checks", filter: `request_id=eq.${requestId}` }, loadChecks)
      .subscribe();
    // Desde la notificación («↩️ Responder»): el cuadro de texto queda listo.
    if (new URLSearchParams(window.location.search).get("responder") === "1") window.setTimeout(() => document.getElementById("composer-sr")?.focus(), 600);
    return () => { alive = false; void supabaseBrowser().removeChannel(ch); void supabaseBrowser().removeChannel(chk); };
  }, [requestId, load]);

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
        if ((await kit.submit(msg, attachments)) === false) return;
        files.forEach((p) => URL.revokeObjectURL(p.preview));
        setPending((cur) => cur.filter((x) => !files.some((p) => p.id === x.id)));
      } else if ((await kit.submit(msg)) === false) return;
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

  /** Agregar un producto (o más unidades): queda en el chat. */
  async function addItem(p: { id: string; name: string; wh_qty?: number }) {
    if (!data) return;
    setItemPick(false);
    const res = await Swal.fire({
      ...swal, title: `➕ ${p.name}`,
      html: `<p style="font-size:13px;opacity:.8">${canAttend ? `Se agrega a lo que se envía desde <b>${data.request.to_name}</b>` : "Se agrega a lo que pides"}${typeof p.wh_qty === "number" ? ` · hay <b>${p.wh_qty}</b> en ${data.request.to_name}` : ""}.</p>`,
      input: "number", inputValue: "1", inputAttributes: { min: "1", step: "1" }, inputLabel: "¿Cuántas unidades?",
      showCancelButton: true, confirmButtonText: "Agregar", cancelButtonText: "Cancelar",
      inputValidator: (v) => (Number(v) >= 1 ? null : "Escribe al menos 1."),
    });
    if (!res.isConfirmed) return;
    const note = canAttend ? await Swal.fire({ ...swal, title: "¿Por qué se agrega? (opcional)", input: "text", inputPlaceholder: "Ej: van de regalo, pidieron por chat…", showCancelButton: true, confirmButtonText: "Listo", cancelButtonText: "Sin motivo" }) : null;
    await run("erp_sr_item_add", { p_request: data.request.id, p_product: p.id, p_qty: Math.floor(Number(res.value)), p_note: note?.isConfirmed ? String(note.value ?? "") : null }, "Producto agregado (quedó en el chat)");
  }

  /** Quitar un producto del pedido: queda en el chat. */
  async function removeItem(item: { id: string; name: string }) {
    if (!data) return;
    const res = await Swal.fire({
      ...swal, icon: "warning", title: `¿Quitar ${item.name}?`, text: "Sale del pedido y queda la constancia en el chat.",
      input: "text", inputPlaceholder: "Motivo (opcional): no hay, se pidió por error…",
      showCancelButton: true, confirmButtonText: "Quitar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444",
    });
    if (!res.isConfirmed) return;
    setApproved((cur) => { const n = { ...cur }; delete n[item.id]; return n; });
    await run("erp_sr_item_remove", { p_request: data.request.id, p_item: item.id, p_reason: String(res.value ?? "") || null }, "Producto quitado (quedó en el chat)");
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
  // Lista de chequeo: quien despacha chulea lo empacado; quien recibe, lo que llegó. Lo chuleado sube en el orden en que se chuleó.
  const checkSide: "pack" | "receive" = r && (r.status === "dispatched" || r.status === "received") ? "receive" : "pack";
  const canCheck = Boolean(r && (checkSide === "pack" ? canAttend : canReceive));
  const showChecklist = Boolean(r && r.status !== "rejected" && r.status !== "cancelled");
  const checkWho = r ? (checkSide === "pack" ? `Chulea quien despacha en ${r.to_name}` : r.status === "dispatched" ? `Chulea quien recibe en ${r.from_name}` : "") : "";
  const checked = new Map(checks.filter((c) => c.side === checkSide).map((c) => [c.item_id, c]));
  const doneCount = data ? data.items.filter((i) => checked.has(i.id)).length : 0;
  const sortedItems = data ? [
    ...data.items.filter((i) => checked.has(i.id)).sort((a, b) => checked.get(a.id)!.at.localeCompare(checked.get(b.id)!.at)),
    ...data.items.filter((i) => !checked.has(i.id)),
  ].filter((i) => !onlyPending || !checked.has(i.id)) : [];
  async function toggleCheck(itemId: string) {
    if (!canCheck || !data) return;
    const on = !checked.has(itemId);
    navigator.vibrate?.(on ? 18 : 8);
    // Al instante en pantalla; si la base no lo acepta, se devuelve.
    setChecks((cur) => (on ? [...cur, { item_id: itemId, side: checkSide, by: data.me ?? "Tú", at: new Date().toISOString() }] : cur.filter((c) => !(c.item_id === itemId && c.side === checkSide))));
    const { error: e } = await supabaseBrowser().rpc("erp_sr_item_check", { p_request: data.request.id, p_item: itemId, p_side: checkSide, p_on: on });
    if (e) {
      setChecks((cur) => (on ? cur.filter((c) => !(c.item_id === itemId && c.side === checkSide)) : cur));
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo chulear", text: /Could not find the function|schema cache/i.test(e.message) ? "Ejecuta en Supabase la migración 20261277_pedido_checklist.sql." : srError(e) });
    }
  }

  // Agregar o quitar: quien atiende, o quien pidió mientras nadie lo toma; nunca después de «Revisó».
  const canEditItems = Boolean(data && r && (r.status === "pending" || r.status === "preparing") && (canAttend || (data.access.request && r.status === "pending"))
    && !data.signatures?.some((x) => x.step === "sent" || x.step === "delivered" || x.step === "received"));
  const readyToSend = Boolean(data?.signatures?.some((s) => s.step === "packed") && data?.signatures?.some((s) => s.step === "sent"));

  const itemsPanel = data && r ? (
    <div className="space-y-3">
      {showChecklist ? (
        <div className="sticky top-0 z-10 rounded-2xl border p-3 backdrop-blur" style={{ borderColor: doneCount === data.items.length ? "#22c55e" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 88%, transparent)" }}>
          <div className="flex items-center gap-2">
            <ListChecks size={18} style={{ color: doneCount === data.items.length ? "#22c55e" : "var(--t-accent)" }} />
            <p className="min-w-0 flex-1 text-sm font-bold">
              {checkSide === "pack" ? "📦 Lista de empaque" : "📥 Lista de lo que llegó"} · <span className="tabular-nums" style={{ color: "#22c55e" }}>{doneCount}</span> de {data.items.length}
            </p>
            <button type="button" onClick={() => setOnlyPending((v) => !v)} className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={onlyPending ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>
              {onlyPending ? `Ver todos` : `Solo faltantes (${data.items.length - doneCount})`}
            </button>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
            <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#22c55e,#4ade80)" }} animate={{ width: `${data.items.length ? (doneCount / data.items.length) * 100 : 0}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            {doneCount === data.items.length ? "✅ ¡Todo chuleado! Revisa arriba lo que quedó listo." : canCheck ? (checkSide === "pack" ? "Toca el círculo (o el producto) cuando lo tengas empacado: se pone verde y sube." : "Toca el círculo (o el producto) cuando lo cuentes: se pone verde y sube.") : `👀 Solo ver: ${checkWho || "lo chuleado se ve en verde y en orden"}.`}
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        {onlyPending && doneCount === data.items.length ? <p className="rounded-2xl border p-4 text-center text-sm" style={{ borderColor: "#22c55e" }}>🎉 No falta nada por chulear.</p> : null}
        {sortedItems.map((i) => {
          const chk = checked.get(i.id);
          const toSend = approved[i.id] ?? i.qty_approved ?? i.qty_requested;
          const short = i.source_now < toSend && isOpen(r.status) && r.status !== "dispatched";
          return (
            <motion.div key={i.id} layout transition={{ type: "spring", stiffness: 380, damping: 32 }}
              onClick={canCheck ? () => void toggleCheck(i.id) : undefined}
              role={canCheck ? "button" : undefined} aria-pressed={canCheck ? Boolean(chk) : undefined}
              className={`flex touch-manipulation items-center gap-3 rounded-2xl border p-2.5 transition-colors ${canCheck ? "cursor-pointer select-none active:scale-[0.99]" : ""}`}
              style={chk
                ? { borderColor: "color-mix(in oklab, #22c55e 65%, transparent)", background: "color-mix(in oklab, #22c55e 14%, transparent)" }
                : { borderColor: short ? "color-mix(in oklab, #f59e0b 50%, transparent)" : "var(--t-card-border)" }}>
              {showChecklist ? (
                <button type="button" disabled={!canCheck} onClick={(e) => { e.stopPropagation(); void toggleCheck(i.id); }}
                  aria-label={chk ? `Quitar chulo de ${i.name}` : `Chulear ${i.name}`}
                  className="-m-1.5 grid h-12 w-12 shrink-0 touch-manipulation place-items-center rounded-full p-1.5 disabled:cursor-default">
                  <span className="grid h-9 w-9 place-items-center rounded-full border-2 transition"
                    style={chk ? { background: "#22c55e", borderColor: "#22c55e", color: "#fff" } : { borderColor: canCheck ? "var(--t-accent)" : "var(--t-card-border)", opacity: canCheck ? 1 : 0.5 }}>
                    {chk ? <Check size={20} strokeWidth={3} /> : null}
                  </span>
                </button>
              ) : null}
              <Thumb src={thumbs[i.product_id] ?? i.image_url} size={44} />
              <div className="min-w-0 flex-1">
                <ProductName name={i.name} className="text-sm font-semibold" />
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Pidió <b style={{ color: "var(--t-text)" }}>{i.qty_requested}</b>
                  {r.status !== "dispatched" && r.status !== "received" ? <> · En {r.to_name}: <b style={{ color: i.source_now > 0 ? "#22c55e" : "#ef4444" }}>{i.source_now}</b></> : null}
                  {" "}· En {r.from_name}: {i.dest_now}
                </p>
                {i.note ? <p className="text-[11px] font-semibold" style={{ color: "#a78bfa" }}>{i.note}</p> : null}
                {chk ? <p className="text-[11px] font-bold" style={{ color: "#22c55e" }}>✓ {checkSide === "pack" ? "Empacado" : "Contado"} por {chk.by ?? "—"} · {new Date(chk.at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</p> : null}
                {i.qty_received !== null ? <p className="text-xs font-semibold" style={{ color: i.qty_received < (i.qty_approved ?? 0) ? "#f59e0b" : "#22c55e" }}>Recibido {i.qty_received} de {i.qty_approved}</p> : null}
                {prices?.get(i.product_id) ? (
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                    P. mayor {cop(prices.get(i.product_id)!.price2)} · <b style={{ color: "var(--t-text)" }}>{cop(toSend * prices.get(i.product_id)!.price2)}</b>
                  </p>
                ) : null}
              </div>
              {canAttend ? (
                <label onClick={(e) => e.stopPropagation()} className="text-center text-[10px] font-semibold uppercase" style={{ color: "var(--t-muted)" }}>
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
                <label onClick={(e) => e.stopPropagation()} className="text-center text-[10px] font-semibold uppercase" style={{ color: "var(--t-muted)" }}>
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
              {canEditItems && data.items.length > 1 ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); void removeItem(i); }} disabled={busy} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border text-red-400 transition hover:bg-red-500/10 disabled:opacity-40" style={{ borderColor: "color-mix(in oklab, #ef4444 35%, transparent)" }} aria-label={`Quitar ${i.name}`} title="Quitar del pedido">
                  <Trash size={14} />
                </button>
              ) : null}
            </motion.div>
          );
        })}
      </div>

      {canEditItems ? (
        <button type="button" onClick={() => setItemPick(true)} disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-3 text-sm font-bold transition hover:-translate-y-0.5 disabled:opacity-50"
          style={{ borderColor: "color-mix(in oklab, var(--t-accent) 55%, transparent)", color: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 6%, transparent)" }}>
          <PackagePlus size={17} /> {canAttend ? "Agregar producto al envío" : "Agregar producto al pedido"}
          <span className="hidden text-xs font-semibold opacity-75 sm:inline">· queda en el chat</span>
        </button>
      ) : null}

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
      <div className="flex items-center gap-1.5 pb-1">
        <button type="button" onClick={() => kit.setSearching(!kit.searching)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--t-card-border)" }}><Search size={12} /> Buscar</button>
        <button type="button" onClick={async () => { if (requestId && (await muteChat("sr", requestId, ex?.muted_until ?? null))) void kit.reload(); }} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--t-card-border)", color: ex?.muted_until ? "#f59e0b" : undefined }}>
          <BellOff size={12} /> {ex?.muted_until ? "Silenciado" : "Silenciar"}
        </button>
        <span className="ml-auto truncate text-[10px]" style={{ color: "var(--t-muted)" }}>Mantén presionado un mensaje para más opciones</span>
      </div>
      {kit.searching ? <div className="-mx-1 overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}><ChatSearchBar q={kit.query} setQ={kit.setQuery} msgs={chatMsgs.filter((m) => m.kind === "message")} onJump={kit.jump} onClose={() => { kit.setSearching(false); kit.setQuery(""); }} /></div> : null}
      {ex?.pinned.length ? <div className="-mx-1 mt-1 overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}><PinnedBar pinned={ex.pinned} onJump={kit.jump} /></div> : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden overscroll-contain px-1 py-2 md:px-8">
        {data.messages.map((m) => (m.kind === "system"
          ? <SystemLine key={m.id} m={m} extra={ex?.msgs[m.id]} me={ex?.me ?? null} onCallBack={(video, to) => { if (requestId) startCall(requestId, video, to); }} />
          : <ChatBubble key={m.id} m={m} subtitle={m.point_name} showName files={media[m.id] ?? []} extra={ex?.msgs[m.id]} readers={ex?.reads ?? null} total={null}
              products={kit.products} query={kit.searching ? kit.query : ""} flash={kit.flash === m.id} canPin={Boolean(ex?.can_pin) && Boolean(data.access.chat)} canPost={Boolean(data.access.chat)}
              onAction={(a, x) => void kit.onAction(a, x)} onReact={(x, e) => void kit.onReact(x, e)} onJump={kit.jump} />))}
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
          {kit.edit ? <ComposerBanner mode="edit" m={kit.edit} onCancel={kit.cancelCompose} /> : kit.reply ? <ComposerBanner mode="reply" m={kit.reply} onCancel={kit.cancelCompose} /> : null}
          <MentionSuggestions text={text} people={srPeople} onPick={(v) => { setText(v); document.getElementById("composer-sr")?.focus(); }} />
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
                      <button type="button" onClick={() => { setAttachMenu(false); setProductPick(true); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[color:var(--t-card-bg)]"><Package size={17} className="text-emerald-400" /> Producto (con existencias)</button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <input ref={galleryInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                <input ref={cameraInput} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              </div>
              <textarea
                id="composer-sr"
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
                  if (e.key === "Escape") kit.cancelCompose();
                }}
                rows={1}
                placeholder={kit.edit ? "Corrige el mensaje…" : pending.length ? "Agrega un texto (opcional)…" : "Escribe un mensaje… (@ para mencionar)"}
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
                      <button type="button" onClick={() => setPeoplePick("notify")} className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }} aria-label="Avisos" title="A quién le llegan los avisos de este chat"><Bell size={16} /><span className="hidden sm:inline">Avisos</span></button>
                      <button type="button" onClick={() => setPeoplePick("chat")} className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }} aria-label="Chat aparte" title="Abrir un chat o grupo aparte"><MessageCircle size={16} /><span className="hidden sm:inline">Chat aparte</span></button>
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
            {data ? <ProductSearchModal open={itemPick} onClose={() => setItemPick(false)} storeId={data.request.store_id} warehouseId={data.request.to_point_id}
              title={canAttend ? `Agregar al envío desde ${data.request.to_name}` : "Agregar al pedido"} stockLabel={(h) => `En ${data.request.to_name}: ${h.wh_qty}`}
              onPick={(p) => void addItem(p)} /> : null}
            {data ? <ProductSearchModal open={productPick} onClose={() => setProductPick(false)} storeId={data.request.store_id} title="Enviar un producto al chat" onPick={(p) => { setProductPick(false); void kit.sendProduct(p.id); }} /> : null}
            {data ? <ForwardDialog open={Boolean(kit.forward)} storeId={data.request.store_id} onClose={() => kit.setForward(null)} onSend={kit.sendForward} /> : null}
            <CallPicker open={Boolean(callPick)} video={Boolean(callPick?.video)} title={r ? `Pedido interno #${r.number} · ${r.to_name} ↔ ${r.from_name}` : "Pedido interno"}
              load={loadCandidates} onCall={(to) => { if (requestId && callPick) startCall(requestId, callPick.video, to); }} onClose={() => setCallPick(null)} />
            <PeoplePicker open={peoplePick === "notify"} icon={<Bell size={17} />} color="#f59e0b" heading="Avisos de este chat" title={r ? `Pedido #${r.number} · ${r.to_name} ↔ ${r.from_name}` : "Pedido interno"}
              note="Los mensajes solo suenan y llegan al celular de las personas marcadas. Sin marcar a nadie vuelve al automático: los involucrados."
              load={loadPeople} initial={pickSelected} emptyLabel="Volver al automático (involucrados)"
              confirmLabel={(p) => `Avisar solo a ${p.length === 1 ? p[0].name : `${p.length} personas`}`}
              onConfirm={async (ids) => {
                if (!requestId) return false;
                const { error: e } = await supabaseBrowser().rpc("erp_sr_notify_set", { p_request: requestId, p_users: ids });
                if (e) { void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: e.message }); return false; }
                void Swal.fire({ ...swal, toast: true, position: "top-end", timer: 2500, showConfirmButton: false, icon: "success", title: ids.length ? "Listo, solo a los escogidos" : "Avisos automáticos" });
                return true;
              }} onClose={() => setPeoplePick(null)} />
            <PeoplePicker open={peoplePick === "chat"} icon={<MessageCircle size={17} />} color="var(--t-accent)" heading="Chat aparte" title={r ? `Pedido #${r.number} · ${r.to_name} ↔ ${r.from_name}` : "Pedido interno"}
              note="Una persona abre un chat directo; varias, un grupo. Queda en «Mensajes»."
              load={loadOthers} initial={pickInvolved}
              confirmLabel={(p) => (p.length === 1 ? `Chatear con ${p[0].name}` : `Crear grupo con ${p.length} personas`)}
              onConfirm={async (ids) => {
                if (!data) return false;
                const store = data.request.store_id;
                const res = ids.length === 1
                  ? await supabaseBrowser().rpc("erp_dm_open", { p_store: store, p_user: ids[0] })
                  : await supabaseBrowser().rpc("erp_dm_group_create", { p_store: store, p_title: `Pedido #${data.request.number} · ${r?.to_name ?? ""} ↔ ${r?.from_name ?? ""}`, p_users: ids });
                if (res.error) { void Swal.fire({ ...swal, icon: "error", title: "No se abrió el chat", text: res.error.message }); return false; }
                onClose();
                router.push(`/dashboard/mensajes?chat=${(res.data as { id: string }).id}`);
                return true;
              }} onClose={() => setPeoplePick(null)} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
