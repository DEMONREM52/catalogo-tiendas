"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Temporizador de los buscadores: no se consulta en cada letra, sino cuando paras de escribir.
 * Mientras más corto lo escrito, más espera (una sola letra casi nunca es lo que buscas):
 *   · vacío            → al instante (vuelve a la lista completa)
 *   · 1 letra          → 1.500 ms (solo si te detienes; si sigues escribiendo no consulta)
 *   · 2 letras         → 1.000 ms
 *   · 3 o más          → 700 ms
 *   · número de 6+ cifras (lector de código de barras) → 150 ms
 * Así, escribir «tendedero» rápido hace UNA consulta en vez de nueve.
 * (2026-11-08: el usuario pidió que espere un poco más que 900/550/400.)
 */
export function searchDelay(term: string | null | undefined): number {
  const t = String(term ?? "").trim();
  if (!t) return 0;
  if (/^\d{6,}$/.test(t)) return 150;
  if (t.length === 1) return 1500;
  if (t.length === 2) return 1000;
  return 700;
}

/**
 * Valor con espera: devuelve lo escrito cuando se deja de escribir (con searchDelay),
 * si hay una búsqueda pendiente, y `flush` para buscar ya (Enter).
 */
export function useSearchValue(value: string) {
  const [settled, setSettled] = useState(value);
  const latest = useRef(value);
  useEffect(() => { latest.current = value; });
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), searchDelay(value));
    return () => window.clearTimeout(t);
  }, [value]);
  const flush = useCallback(() => setSettled(latest.current), []);
  return { value: settled, pending: settled !== value, delay: searchDelay(value), flush };
}

/** Respuestas recientes en memoria (1 minuto): borrar y volver a escribir lo mismo no consulta otra vez. */
const cache = new Map<string, { at: number; value: unknown }>();
export async function cachedSearch<T>(key: string, run: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await run();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}
/** Lo guardado para esa búsqueda (si todavía sirve), sin consultar. */
export function peekSearch<T>(key: string, ttlMs = 60_000): T | undefined {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < ttlMs ? (hit.value as T) : undefined;
}
export function storeSearch(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
}
/** Para cuando se crea o cambia algo (los resultados guardados ya no sirven). */
export const clearSearchCache = (prefix = "") => { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); };
