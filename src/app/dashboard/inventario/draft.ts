"use client";

import type { Staged } from "./AttachmentsUI";

/**
 * Borradores locales: el formulario vive en localStorage y los archivos
 * (fotos/PDF de la factura) en IndexedDB, así sobreviven a recargas,
 * cierres de pestaña y caídas de internet en este equipo.
 */

export function readDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* sin almacenamiento disponible */
  }
  void clearDraftFiles(key);
}

const DB_NAME = "remhub-drafts";
const STORE = "files";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

type StoredFile = Omit<Staged, "preview">;

export async function saveDraftFiles(key: string, staged: Staged[]) {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const value: StoredFile[] = staged.map((file) => ({
      id: file.id, kind: file.kind, name: file.name, blob: file.blob, mime: file.mime, original: file.original,
      product_id: file.product_id, product_name: file.product_name,
    }));
    if (value.length) tx.objectStore(STORE).put(value, key);
    else tx.objectStore(STORE).delete(key);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* sin espacio o navegador privado: el resto del borrador sigue guardado */
  } finally {
    db.close();
  }
}

export async function loadDraftFiles(key: string): Promise<Staged[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    const value = await new Promise<StoredFile[] | undefined>((resolve) => {
      req.onsuccess = () => resolve(req.result as StoredFile[] | undefined);
      req.onerror = () => resolve(undefined);
    });
    return (value ?? []).map((file) => ({ ...file, preview: URL.createObjectURL(file.blob) }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function clearDraftFiles(key: string) {
  await saveDraftFiles(key, []);
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 20) return "hace un momento";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}
