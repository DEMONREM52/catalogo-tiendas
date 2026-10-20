"use client";

/**
 * «Invita y gana»: recuerda en este navegador qué tienda trajo a la persona (?ref=su-tienda) durante 30 días,
 * para enlazarla al crear su tienda (saas_set_referrer). Solo guarda el nombre corto de la tienda.
 */

const KEY = "remhub:ref";
const DAYS = 30;

export function captureReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref")?.toLowerCase().trim();
    if (ref && /^[a-z0-9][a-z0-9-]{0,62}$/.test(ref)) window.localStorage.setItem(KEY, JSON.stringify({ ref, at: Date.now() }));
  } catch {
    /* sin almacenamiento */
  }
}

export function readReferral(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { ref?: string; at?: number };
    if (!v.ref || !v.at || Date.now() - v.at > DAYS * 86_400_000) return null;
    return v.ref;
  } catch {
    return null;
  }
}

export function clearReferral() {
  try { window.localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}
