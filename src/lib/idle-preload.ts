"use client";

/**
 * Descarga una parte de la página cuando el navegador queda libre (después de que ya se puede usar).
 * Sirve para ventanas que se cargan aparte (next/dynamic): así no pesan al abrir, pero quedan guardadas
 * por la app antes de que se vaya el internet (el service worker guarda /_next/static) y abren al instante.
 */
export function preloadWhenIdle(...loaders: Array<() => Promise<unknown>>) {
  if (typeof window === "undefined") return;
  const go = () => { for (const load of loaders) void load().catch(() => undefined); };
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(go, { timeout: 5000 });
  else window.setTimeout(go, 2000);
}
