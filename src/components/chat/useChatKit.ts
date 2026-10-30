"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import type { Attachment } from "@/app/dashboard/pedidos/internos/chat-media";
import { chatRpc, chatSend, collectMentions, forwardMessage, newRequestUrl, useChatExtras, useProductCards, type ChatPerson, type Scope } from "./chat-api";
import { isAutoLabel, jumpTo, showReaders, type ChatAction, type ChatMsg } from "./ChatParts";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const toast = (title: string, icon: "success" | "info" | "error" = "success") =>
  void Swal.fire({ ...swal, toast: true, position: "top-end", timer: 2200, showConfirmButton: false, icon, title });

/**
 * Todo lo que comparten los dos chats: lo extra en vivo, responder, editar, reaccionar, fijar, guardar,
 * reenviar, crear pedido, buscar y enviar (con respuesta, @menciones o producto).
 */
export function useChatKit({ scope, chatId, storeId, msgs, people, filesOf, setText, onChanged }: {
  scope: Scope; chatId: string | null; storeId: string | null; msgs: ChatMsg[]; people: ChatPerson[];
  filesOf: (id: string) => Attachment[]; setText: (v: string) => void; onChanged: () => void;
}) {
  const router = useRouter();
  const tick = msgs.length ? `${msgs.length}-${msgs[msgs.length - 1].id}` : "0";
  const { extras, reload } = useChatExtras(scope, chatId, tick);
  const productIds = useMemo(() => Object.values(extras?.msgs ?? {}).map((e) => (e.meta?.type === "product" ? e.meta.product_id : null)).filter((x): x is string => Boolean(x)), [extras]);
  const products = useProductCards(storeId, productIds);
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [edit, setEdit] = useState<ChatMsg | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [forward, setForward] = useState<ChatMsg | null>(null);

  const jump = useCallback((id: string) => {
    if (!jumpTo(id, setFlash)) toast("Ese mensaje es más viejo: toca «Ver mensajes anteriores».", "info");
  }, []);

  const after = useCallback(async (err: string | null, ok?: string) => {
    if (err) { void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: err }); return; }
    if (ok) toast(ok);
    await reload();
    onChanged();
  }, [reload, onChanged]);

  const onReact = useCallback(async (m: ChatMsg, emoji: string | null) => {
    if (!chatId) return;
    await after(await chatRpc("erp_chat_react", { p_scope: scope, p_msg: m.id, p_emoji: emoji }));
  }, [scope, chatId, after]);

  const onAction = useCallback(async (a: ChatAction, m: ChatMsg) => {
    const extra = extras?.msgs[m.id];
    switch (a) {
      case "reply": setEdit(null); setReply(m); document.getElementById(`composer-${scope}`)?.focus(); break;
      case "copy": try { await navigator.clipboard.writeText(m.body); toast("Copiado"); } catch { toast("No se pudo copiar", "error"); } break;
      case "forward": setForward(m); break;
      case "pin": case "unpin": await after(await chatRpc("erp_chat_pin", { p_scope: scope, p_msg: m.id, p_on: a === "pin" }), a === "pin" ? "📌 Fijado arriba del chat" : "Desfijado"); break;
      case "star": case "unstar": await after(await chatRpc("erp_chat_star", { p_scope: scope, p_msg: m.id, p_on: a === "star" }), a === "star" ? "⭐ Guardado (míralo en Mensajes → Guardados)" : "Quitado de guardados"); break;
      case "edit": setReply(null); setEdit(m); setText(m.body); document.getElementById(`composer-${scope}`)?.focus(); break;
      case "delete": {
        const r = await Swal.fire({ ...swal, icon: "warning", title: "¿Borrar para todos?", text: "Quedará «Se eliminó este mensaje». Lo que decía queda en la auditoría.", showCancelButton: true, confirmButtonText: "Borrar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" });
        if (r.isConfirmed) await after(await chatRpc("erp_chat_delete", { p_scope: scope, p_msg: m.id }), "Mensaje borrado");
        break;
      }
      case "request": router.push(newRequestUrl(isAutoLabel(m.body, filesOf(m.id)) ? "" : m.body, extra?.meta?.type === "product" ? extra.meta.product_id : null)); break;
      case "info": showReaders(extras?.reads ?? [], m.created_at); break;
    }
  }, [extras, scope, after, router, setText, filesOf]);

  /** Envía el texto del cuadro (o guarda la edición). Devuelve true si salió. */
  const submit = useCallback(async (body: string, attachments: Attachment[] = []) => {
    if (!chatId) return false;
    if (edit) {
      const err = await chatRpc("erp_chat_edit", { p_scope: scope, p_msg: edit.id, p_body: body });
      if (err) { void Swal.fire({ ...swal, icon: "error", title: "No se editó", text: err }); return false; }
      setEdit(null);
      await reload();
      onChanged();
      return true;
    }
    const id = await chatSend(scope, chatId, { body, attachments, replyTo: reply?.id ?? null, mentions: collectMentions(body, people) });
    setReply(null);
    onChanged();
    return id;
  }, [chatId, edit, reply, scope, people, reload, onChanged]);

  const sendProduct = useCallback(async (productId: string) => {
    if (!chatId) return null;
    try {
      const id = await chatSend(scope, chatId, { body: "", meta: { type: "product", product_id: productId }, replyTo: reply?.id ?? null });
      setReply(null);
      onChanged();
      return id;
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se envió", text: e instanceof Error ? e.message : "Intenta de nuevo." });
      return null;
    }
  }, [chatId, scope, reply, onChanged]);

  const sendForward = useCallback(async (threads: string[]) => {
    if (!forward || !storeId) return;
    const extra = extras?.msgs[forward.id];
    const n = await forwardMessage(storeId, threads, { body: forward.body, files: filesOf(forward.id), meta: extra?.meta ?? null });
    toast(`Reenviado a ${n} chat${n === 1 ? "" : "s"}`);
    setForward(null);
  }, [forward, storeId, extras, filesOf]);

  const cancelCompose = useCallback(() => { if (edit) setText(""); setEdit(null); setReply(null); }, [edit, setText]);

  return { extras, reload, products, reply, edit, cancelCompose, flash, jump, searching, setSearching, query, setQuery, forward, setForward, sendForward, onAction, onReact, submit, sendProduct };
}
