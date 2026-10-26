"use client";

/**
 * Identidad del equipo y estado de su almacenamiento.
 * El identificador sirve para separar números de contingencia por equipo (dos cajas nunca usan el
 * mismo) y NO se borra al cerrar sesión: el mismo computador sigue teniendo sus números.
 */
const KEY = "remhub:device-id";
let memoryId: string | null = null;

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved.length >= 8) return saved;
    const created = `eq-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    memoryId ??= `eq-${crypto.randomUUID()}`;
    return memoryId;
  }
}

/** Pide al navegador que no borre lo guardado en este equipo cuando le falte espacio (una vez basta). */
export async function askPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export type StorageInfo = { persisted: boolean | null; usageMb: number | null; quotaMb: number | null };

export async function storageInfo(): Promise<StorageInfo> {
  try {
    const [persisted, est] = await Promise.all([
      navigator.storage?.persisted ? navigator.storage.persisted() : Promise.resolve(null),
      navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve(null),
    ]);
    const mb = (n?: number) => (typeof n === "number" ? Math.round((n / 1048576) * 10) / 10 : null);
    return { persisted, usageMb: mb(est?.usage), quotaMb: mb(est?.quota) };
  } catch {
    return { persisted: null, usageMb: null, quotaMb: null };
  }
}
