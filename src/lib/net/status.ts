"use client";

import { useSyncExternalStore } from "react";

/**
 * Estado real de la conexión. `navigator.onLine` solo dice si hay red (wifi conectado sin internet
 * también cuenta como «en línea»), así que se confirma con una petición pequeña a RemHub.
 */
export type NetState = { online: boolean; since: number; checking: boolean };

let state: NetState = { online: true, since: 0, checking: false };
const listeners = new Set<() => void>();
let started = false;
let timer: number | undefined;

function set(next: Partial<NetState>) {
  const online = next.online ?? state.online;
  state = { ...state, ...next, since: online !== state.online ? Date.now() : state.since };
  listeners.forEach((fn) => fn());
}

async function probe(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`/manifest.webmanifest?ping=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: ctrl.signal });
    window.clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export async function checkConnection() {
  set({ checking: true });
  const ok = await probe();
  set({ online: ok, checking: false });
  schedule();
  return ok;
}

function schedule() {
  window.clearTimeout(timer);
  // Sin conexión se revisa seguido; en línea, de vez en cuando.
  timer = window.setTimeout(() => void checkConnection(), state.online ? 60_000 : 8_000);
}

/** Avisa que una petición falló por red (así el aviso aparece al instante). */
export function reportNetworkError() {
  void checkConnection();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  state = { online: navigator.onLine !== false, since: Date.now(), checking: false };
  window.addEventListener("online", () => void checkConnection());
  window.addEventListener("offline", () => {
    set({ online: false });
    schedule();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkConnection();
  });
  schedule();
}

function subscribe(fn: () => void) {
  start();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const SERVER: NetState = { online: true, since: 0, checking: false };

export function useNetStatus(): NetState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

export function isOnline() {
  return state.online;
}

/** ¿Este error es por falta de conexión (no un error de la base o de permisos)? */
export function isNetworkError(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  return !isOnline() || /Failed to fetch|NetworkError|Load failed|network|ERR_INTERNET|fetch failed|timeout/i.test(msg);
}
