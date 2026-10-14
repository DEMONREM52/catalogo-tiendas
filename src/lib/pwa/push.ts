"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Notificaciones del celular / computador (Web Push), como las de cualquier app.
 *   · Android y computador: desde el navegador o la app instalada.
 *   · iPhone / iPad: solo con RemHub instalada en la pantalla de inicio (iOS 16.4 o superior).
 */

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !PUBLIC_KEY) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Pide permiso y suscribe este equipo para la tienda. Devuelve el estado final real. */
export async function enablePush(storeId: string): Promise<{ state: PushState; error?: string }> {
  const state = await getPushState();
  if (state === "unsupported" || state === "needs-install" || state === "denied") return { state };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { state: permission === "denied" ? "denied" : "off" };
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(PUBLIC_KEY) });
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const { data, error } = await supabaseBrowser().rpc("erp_push_subscribe", {
    p_store: storeId,
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent,
  });
  const res = data as { ok?: boolean; message?: string } | null;
  if (error || !res?.ok) return { state: "off", error: error?.message ?? res?.message ?? "No se pudo activar." };
  return { state: "on" };
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabaseBrowser().rpc("erp_push_unsubscribe", { p_endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => undefined);
  }
  return getPushState();
}

/** Envía una notificación de prueba a los equipos de este usuario. */
export async function sendTestPush(storeId: string): Promise<{ ok: boolean; sent?: number; message?: string }> {
  const { data } = await supabaseBrowser().auth.getSession();
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ store_id: storeId }),
  });
  return res.json().catch(() => ({ ok: false, message: "No se pudo enviar la prueba." }));
}
