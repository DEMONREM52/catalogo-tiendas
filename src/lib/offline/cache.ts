"use client";

import { idbDelPrefix, idbGet, idbSet } from "./idb";

/**
 * Copia en el equipo (IndexedDB) de lo último que cargó bien, para seguir trabajando si se cae
 * el internet o la base de datos. Solo datos de trabajo (productos, clientes, permisos, existencias);
 * nunca contraseñas ni llaves. Se guarda por tienda/punto con la hora en que se cargó y se borra al
 * cerrar sesión (las ventas sin enviar NO se borran: están aparte).
 */
const PREFIX = "cache:";

export type Cached<T> = { at: number; data: T };

/** Guarda la copia. Devuelve false si el navegador no dejó guardarla en el equipo. */
export function cacheSave<T>(key: string, data: T): Promise<boolean> {
  return idbSet(PREFIX + key, { at: Date.now(), data } satisfies Cached<T>);
}

export async function cacheLoad<T>(key: string): Promise<Cached<T> | null> {
  const v = await idbGet<Cached<T>>(PREFIX + key);
  return v && typeof v.at === "number" ? v : null;
}

export async function cacheClear(prefix = "") {
  await idbDelPrefix(PREFIX + prefix);
  // Al cerrar sesión también se borra la copia de las páginas que guarda el service worker.
  if (!prefix && typeof caches !== "undefined") {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("remhub-pages-")).map((k) => caches.delete(k)));
    } catch {
      // nada
    }
  }
}

/** «hoy 10:42» o «12/10 10:42», para avisar de qué hora son los datos guardados. */
export function cacheAge(at: number) {
  const d = new Date(at);
  const hm = d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === d.toDateString();
  return today ? `hoy ${hm}` : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hm}`;
}

/** Corta una consulta que se queda colgada (la base lenta no siempre responde con error). */
export function withTimeout<T>(p: PromiseLike<T>, ms: number, label = "consulta"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`timeout: la ${label} tardó más de ${Math.round(ms / 1000)} s`)), ms);
    Promise.resolve(p).then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}
