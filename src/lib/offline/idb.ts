"use client";

/**
 * Almacén grande del equipo (IndexedDB) para trabajar sin conexión: copias de productos, clientes,
 * existencias y el respaldo de las ventas guardadas. localStorage solo admite unos 5 MB por sitio y se
 * llena con catálogos grandes (y entonces una venta podría no guardarse); IndexedDB admite cientos de MB.
 * Si el navegador no lo permite, se usa memoria (dura mientras la página siga abierta) y se avisa.
 */
const DB_NAME = "remhub-offline";
const STORE = "kv";
let opening: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Otra pestaña con una versión nueva: se cierra esta conexión y se vuelve a abrir al necesitarla.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    if (!db) opening = null;
    return db;
  });
  return opening;
}

async function tx<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  if (!db) throw new Error("IndexedDB no disponible");
  return new Promise<T | undefined>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(STORE, mode);
    } catch (error) {
      opening = null;
      reject(error);
      return;
    }
    const req = work(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("Transacción cancelada"));
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const v = await tx<T>("readonly", (s) => s.get(key) as IDBRequest<T>);
    return v === undefined ? (memory.get(key) as T | undefined) : v;
  } catch {
    return memory.get(key) as T | undefined;
  }
}

/** Guarda un valor. Devuelve false si solo quedó en memoria (el navegador no dejó guardarlo en el equipo). */
export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    await tx("readwrite", (s) => {
      s.put(value, key);
    });
    memory.delete(key);
    return true;
  } catch {
    memory.set(key, value);
    return false;
  }
}

export async function idbDel(key: string): Promise<void> {
  memory.delete(key);
  try {
    await tx("readwrite", (s) => {
      s.delete(key);
    });
  } catch {
    // nada que borrar
  }
}

export async function idbKeys(prefix: string): Promise<string[]> {
  const fromMemory = [...memory.keys()].filter((k) => k.startsWith(prefix));
  try {
    const keys = (await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>)) ?? [];
    return [...new Set([...keys.map(String).filter((k) => k.startsWith(prefix)), ...fromMemory])];
  } catch {
    return fromMemory;
  }
}

export async function idbDelPrefix(prefix: string): Promise<void> {
  for (const key of await idbKeys(prefix)) await idbDel(key);
}
