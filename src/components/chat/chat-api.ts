"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Attachment } from "@/app/dashboard/pedidos/internos/chat-media";

/**
 * Lo compartido de los dos chats (pedidos internos = "sr", mensajes del equipo = "dm"), migración 20261273:
 * enviar con respuesta/menciones/producto, lo extra de cada mensaje (reacciones, visto, fijados…),
 * tarjetas de producto con existencias en vivo y reenviar.
 */

export type Scope = "sr" | "dm";
export type Reaction = { emoji: string; count: number; mine: boolean; names: string[] };
export type MsgMeta = {
  type?: "product" | "call"; product_id?: string; forwarded?: boolean;
  call_id?: string; caller_id?: string; caller_name?: string; video?: boolean; status?: string; invited?: string[];
};
export type Extra = {
  reply?: { id: string; user_name: string; body: string; deleted: boolean };
  edited?: boolean; deleted?: boolean; pinned?: boolean; starred?: boolean;
  mentions?: string[]; meta?: MsgMeta; reactions?: Reaction[];
};
export type Reader = { user_id: string; name: string; at: string | null };
export type Extras = {
  msgs: Record<string, Extra>; reads: Reader[]; pinned: Array<{ id: string; user_name: string; body: string }>;
  muted_until: string | null; me: string; kind: string; can_post: boolean; can_pin: boolean;
};
export type ChatPerson = { user_id: string; name: string };
export type ProductCardData = { id: string; name: string; sku: string | null; image_url: string | null; price: number; active: boolean; stock: Array<{ id: string; name: string; qty: number }> };

export const EDIT_WINDOW_MS = 15 * 60_000;
const missingFn = (m: string) => /Could not find the function|schema cache|does not exist/i.test(m);

/** Cómo se menciona a alguien: @ y su primer nombre sin tildes raras (ej. @Laura). */
export function mentionTag(name: string) {
  return (name.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}\p{N}_]/gu, "");
}
/** Las personas mencionadas en un texto (por su @PrimerNombre). */
export function collectMentions(text: string, people: ChatPerson[]) {
  const tags = new Set([...text.matchAll(/@([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLocaleLowerCase("es-CO")));
  return people.filter((p) => tags.has(mentionTag(p.name).toLocaleLowerCase("es-CO"))).map((p) => p.user_id);
}

/** Envía un mensaje. Sin la migración 20261273 usa las funciones de antes (sin respuesta ni menciones). */
export async function chatSend(scope: Scope, chatId: string, opts: { body: string; attachments?: Attachment[]; replyTo?: string | null; meta?: MsgMeta | null; mentions?: string[] }) {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("erp_chat_send", {
    p_scope: scope, p_chat: chatId, p_body: opts.body, p_attachments: opts.attachments ?? [],
    p_reply_to: opts.replyTo ?? null, p_meta: opts.meta ?? null, p_mentions: opts.mentions?.length ? opts.mentions : null,
  });
  if (!error) return (data as { id?: string } | null)?.id ?? null;
  if (!missingFn(error.message)) throw new Error(error.message);
  if (scope === "dm") {
    const r = await sb.rpc("erp_dm_send", { p_thread: chatId, p_body: opts.body, p_attachments: opts.attachments ?? [] });
    if (r.error) throw new Error(missingFn(r.error.message) ? "Falta ejecutar en Supabase la migración 20261271_mensajes_directos.sql." : r.error.message);
    return (r.data as { id?: string } | null)?.id ?? null;
  }
  const r = opts.attachments?.length
    ? await sb.rpc("erp_stock_request_message_media", { p_request: chatId, p_body: opts.body, p_attachments: opts.attachments })
    : await sb.rpc("erp_stock_request_message", { p_request: chatId, p_body: opts.body });
  if (r.error) throw new Error(r.error.message);
  return (r.data as { id?: string } | null)?.id ?? null;
}

/** Ejecuta una acción del chat y devuelve el error en palabras (o null). */
export async function chatRpc(fn: string, args: Record<string, unknown>) {
  const { error } = await supabaseBrowser().rpc(fn, args);
  if (!error) return null;
  return missingFn(error.message) ? "Falta ejecutar en Supabase la migración 20261273_mensajeria_pro.sql." : error.message;
}

/**
 * Lo extra de un chat, en vivo: reacciones y visto (Realtime), ediciones y borrados (cambios del mensaje).
 * `tick` cambia cuando llegan mensajes nuevos: se recarga y se marca como visto.
 */
export function useChatExtras(scope: Scope, chatId: string | null, tick: number | string) {
  const [extras, setExtras] = useState<Extras | null>(null);
  const timer = useRef(0);
  const load = useCallback(async () => {
    if (!chatId) return;
    const { data, error } = await supabaseBrowser().rpc("erp_chat_extras", { p_scope: scope, p_chat: chatId });
    if (error) { setExtras(null); return; }
    setExtras(data as Extras);
  }, [scope, chatId]);
  const soon = useCallback(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void load(), 250); }, [load]);

  useEffect(() => {
    if (!chatId) return;
    if (document.visibilityState === "visible") void supabaseBrowser().rpc("erp_chat_seen", { p_scope: scope, p_chat: chatId }).then(() => undefined);
    soon();
  }, [scope, chatId, tick, soon]);

  useEffect(() => {
    if (!chatId) return;
    const table = scope === "sr" ? "erp_stock_request_messages" : "erp_dm_messages";
    const col = scope === "sr" ? "request_id" : "thread_id";
    const ch = supabaseBrowser()
      .channel(`chat-extras-${scope}-${chatId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_chat_reactions", filter: `chat_id=eq.${chatId}` }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_chat_reads", filter: `chat_id=eq.${chatId}` }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: `${col}=eq.${chatId}` }, soon)
      .subscribe();
    const onVis = () => { if (document.visibilityState === "visible") { void supabaseBrowser().rpc("erp_chat_seen", { p_scope: scope, p_chat: chatId }).then(() => undefined); soon(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVis); void supabaseBrowser().removeChannel(ch); };
  }, [scope, chatId, soon]);

  return { extras, reload: load };
}

/** Tarjetas de producto del chat: se refrescan cada 30 s mientras se ven (existencias en vivo). */
export function useProductCards(storeId: string | null, ids: string[]) {
  const [cards, setCards] = useState<Record<string, ProductCardData>>({});
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    if (!storeId || !key) return;
    let alive = true;
    const load = async () => {
      const { data } = await supabaseBrowser().rpc("erp_chat_products", { p_store: storeId, p_ids: key.split(",") });
      if (alive && Array.isArray(data)) setCards(Object.fromEntries((data as ProductCardData[]).map((p) => [p.id, p])));
    };
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [storeId, key]);
  return cards;
}

/** Reenvía un mensaje (texto, archivos y producto) a chats del equipo. Los archivos se copian a cada chat. */
export async function forwardMessage(storeId: string, targets: string[], msg: { body: string; files: Attachment[]; meta?: MsgMeta | null }) {
  const sb = supabaseBrowser();
  let ok = 0;
  for (const thread of targets) {
    const attachments: Attachment[] = [];
    for (const f of msg.files) {
      const ext = f.path.split(".").pop() ?? "bin";
      const to = `${storeId}/dm/${thread}/${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from("chat-media").copy(f.path, to);
      if (!error) attachments.push({ ...f, path: to });
    }
    const auto = msg.files.length > 0 && /^(📷|🎥|🎤)/u.test(msg.body) && msg.body.length < 48;
    const id = await chatSend("dm", thread, {
      body: auto ? "" : msg.body, attachments,
      meta: msg.meta?.type === "product" ? { type: "product", product_id: msg.meta.product_id } : { forwarded: true },
    });
    if (id) void notifyDm(id);
    ok++;
  }
  return ok;
}

/** Aviso al celular de un mensaje del equipo (lo pide quien lo escribió). */
export async function notifyDm(messageId: string) {
  const { data } = await supabaseBrowser().auth.getSession();
  void fetch("/api/push/dm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ message_id: messageId }) });
}

/** Abre un pedido interno nuevo con una nota (y un producto) desde un mensaje. */
export function newRequestUrl(note: string, productId?: string | null) {
  const u = new URLSearchParams({ tab: "internos", nuevo: "1", nota: note.slice(0, 400) });
  if (productId) u.set("producto", productId);
  return `/dashboard/pedidos?${u.toString()}`;
}
