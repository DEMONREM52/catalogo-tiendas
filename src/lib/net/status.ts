"use client";

import { useSyncExternalStore } from "react";

/**
 * Estado real de la conexión. `navigator.onLine` solo dice si hay red (wifi conectado sin internet
 * también cuenta como «en línea»), así que se confirma con una petición pequeña a RemHub.
 *
 * Además se mide la BASE DE DATOS (20261242, remhub_ping): puede haber internet y que Supabase no conteste.
 *   db "ok"    · responde normal
 *   db "slow"  · tardó más de 3 s o falló una vez (se vuelve a revisar enseguida)
 *   db "down"  · no contestó dos veces seguidas: se trabaja como sin conexión (borradores)
 */
export type DbState = "unknown" | "ok" | "slow" | "down";
export type NetState = { online: boolean; since: number; checking: boolean; db: DbState; dbSince: number; dbMs: number | null; simulated: boolean };

const SERVER: NetState = { online: true, since: 0, checking: false, db: "unknown", dbSince: 0, dbMs: null, simulated: false };
// Modo práctica: se simula «sin internet» en esta pestaña para aprender a vender sin conexión (no toca nada real).
const SIMULATE_KEY = "remhub:simulate-offline";
const simulatedNow = () => {
  try {
    return sessionStorage.getItem(SIMULATE_KEY) === "1";
  } catch {
    return false;
  }
};
let state: NetState = SERVER;
const listeners = new Set<() => void>();
let started = false;
let timer: number | undefined;
let dbFails = 0;

function set(next: Partial<NetState>) {
  const online = next.online ?? state.online;
  const db = next.db ?? state.db;
  state = {
    ...state, ...next,
    since: online !== state.online ? Date.now() : state.since,
    dbSince: db !== state.db ? Date.now() : state.dbSince,
  };
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

/** ¿Responde la base? Devuelve los milisegundos, o null si no contestó. */
async function probeDb(): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return 0;
  const started = performance.now();
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${url}/rest/v1/rpc/remhub_ping`, {
      method: "POST", cache: "no-store", signal: ctrl.signal,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
    });
    window.clearTimeout(t);
    // 404 = falta la migración, pero la base contestó. 5xx = la base no responde.
    if (res.status >= 500) return null;
    return Math.round(performance.now() - started);
  } catch {
    return null;
  }
}

export async function checkConnection() {
  if (simulatedNow()) {
    set({ online: false, checking: false, simulated: true });
    schedule();
    return false;
  }
  set({ checking: true, simulated: false });
  const ok = await probe();
  if (!ok) {
    set({ online: false, checking: false });
    schedule();
    return false;
  }
  const ms = await probeDb();
  if (ms === null) {
    dbFails++;
    set({ online: true, checking: false, db: dbFails >= 2 ? "down" : "slow", dbMs: null });
  } else {
    dbFails = 0;
    set({ online: true, checking: false, db: ms > 3000 ? "slow" : "ok", dbMs: ms });
  }
  schedule();
  return true;
}

function schedule() {
  window.clearTimeout(timer);
  // Sin conexión o con la base fallando se revisa seguido; con todo bien, cada minuto.
  const soon = !state.online ? 8_000 : state.db === "slow" || state.db === "down" ? (dbFails === 1 ? 3_000 : 10_000) : 60_000;
  timer = window.setTimeout(() => void checkConnection(), soon);
}

/** Enciende o apaga el modo práctica «sin internet» (solo en esta pestaña). */
export function setSimulatedOffline(on: boolean) {
  try {
    if (on) sessionStorage.setItem(SIMULATE_KEY, "1");
    else sessionStorage.removeItem(SIMULATE_KEY);
  } catch {
    // sin almacenamiento de sesión: no hay modo práctica
  }
  void checkConnection();
}

/** Avisa que una petición falló por red o porque la base no contestó (así el aviso aparece al instante). */
export function reportNetworkError() {
  void checkConnection();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  state = { ...SERVER, online: navigator.onLine !== false && !simulatedNow(), since: Date.now(), dbSince: Date.now(), simulated: simulatedNow() };
  window.addEventListener("online", () => void checkConnection());
  window.addEventListener("offline", () => {
    set({ online: false });
    schedule();
  });
  // Otra pestaña registró ventas o cambió algo: se revisa al volver el foco (sin esperar al minuto).
  window.addEventListener("focus", () => {
    if (!state.online || state.db !== "ok") void checkConnection();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkConnection();
  });
  // Primera revisión de la base apenas abre la app.
  window.setTimeout(() => void checkConnection(), 1500);
}

function subscribe(fn: () => void) {
  start();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useNetStatus(): NetState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

export function isOnline() {
  return state.online;
}

/** ¿Se puede guardar en la base ahora? (hay internet y la base no está caída) */
export function canReachData() {
  return state.online && state.db !== "down";
}

/** ¿Este error es por falta de conexión o porque la base no contestó (no un error de permisos o datos)? */
export function isNetworkError(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code ?? "") : "";
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name ?? "") : "";
  const status = e && typeof e === "object" && "status" in e ? Number((e as { status: unknown }).status) : 0;
  return !canReachData()
    || name === "AuthRetryableFetchError" || name === "AbortError" || status >= 500
    || /Failed to fetch|NetworkError|Load failed|network|ERR_INTERNET|fetch failed|timeout|timed out|aborted|AbortError|upstream|Bad Gateway|Service Unavailable|Gateway Time-?out/i.test(msg)
    || /^(PGRST000|PGRST001|PGRST002|57014|503|504|502)$/.test(code);
}
