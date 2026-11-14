/**
 * Memoria de REM, separada por usuario y por tienda (en este equipo, en localStorage).
 *
 *   · Frases aprendidas («la plata de los muchachos» → Nómina), productos aprendidos, la conversación
 *     y las frases que no entendió. Nada más: ni contraseñas, ni tokens, ni datos de clientes.
 *   · Cada persona ve solo lo suyo: la llave lleva su usuario y su tienda. Si dos personas usan el mismo
 *     computador, no se mezclan.
 *   · La memoria NUNCA da permisos: una frase aprendida solo lleva a una página si esa página está en la
 *     lista que la persona puede abrir hoy (los permisos se revisan en cada uso y otra vez en la base).
 *   · Se puede ver, corregir y borrar desde la conversación de REM («Lo que REM sabe de ti»).
 */

export type MemoryName = "phrases" | "learned" | "log" | "misses" | "aliases";

let scope = "";
const listeners = new Set<() => void>();

/** Llave de cada cosa guardada, con el usuario y la tienda de quien está usando REM. */
export function remKey(name: MemoryName): string {
  return `remhub:rem-${name}${scope ? `:${scope}` : ""}`;
}

export function remScope(): string {
  return scope;
}

/**
 * Quién está usando REM. Lo pone el encabezado al entrar. Lo que había guardado en el equipo antes de separar
 * por usuario: las frases y productos aprendidos pasan a quien entre primero (no son privados: solo dicen
 * «esta frase es esta página»); la conversación vieja se borra (podía ser de otra persona).
 */
export function setRemScope(userId: string | null | undefined, storeId: string | null | undefined) {
  const next = userId && storeId ? `${userId}:${storeId}` : "";
  if (next === scope) return;
  scope = next;
  storePhrases = new Map();
  if (scope) adoptLegacy();
  listeners.forEach((l) => l());
}

export function onRemScopeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function adoptLegacy() {
  const ls = storage();
  if (!ls) return;
  try {
    for (const name of ["phrases", "learned"] as const) {
      const old = ls.getItem(`remhub:rem-${name}`);
      if (old === null) continue;
      if (ls.getItem(remKey(name)) === null) ls.setItem(remKey(name), old);
      ls.removeItem(`remhub:rem-${name}`);
    }
    ls.removeItem("remhub:rem-log");
  } catch { /* sin almacenamiento */ }
}

export function readJson<T>(name: MemoryName, fallback: T): T {
  const ls = storage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(remKey(name));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}

export function writeJson(name: MemoryName, value: unknown) {
  const ls = storage();
  if (!ls) return;
  try { ls.setItem(remKey(name), JSON.stringify(value)); } catch { /* lleno o bloqueado */ }
}

export function removeMemory(name: MemoryName) {
  const ls = storage();
  if (!ls) return;
  try { ls.removeItem(remKey(name)); } catch { /* sin almacenamiento */ }
}

// ---------------------------------------------------------------------------------------------
// Frases que no entendió: para revisarlas y enseñarle a dónde llevan (solo para esta persona).

export type Miss = { text: string; path: string; at: number; times: number };

const MAX_MISSES = 40;

/** Guarda una frase que no entendió y en qué página estaba. Las de una sola palabra suelen ser ruido: no se guardan. */
export function recordMiss(text: string, path: string) {
  const t = text.trim();
  if (!t || t.split(/\s+/).length < 2 || t.length > 160) return;
  const all = readJson<Miss[]>("misses", []);
  const same = all.find((m) => m.text.toLowerCase() === t.toLowerCase());
  if (same) { same.times += 1; same.at = Date.now(); same.path = path; }
  else all.push({ text: t, path, at: Date.now(), times: 1 });
  writeJson("misses", all.sort((a, b) => b.at - a.at).slice(0, MAX_MISSES));
}

export function readMisses(): Miss[] {
  const v = readJson<Miss[]>("misses", []);
  return Array.isArray(v) ? v : [];
}

/** Ya la entendió (o se le enseñó): sale de la lista. */
export function resolveMiss(text: string) {
  const t = text.trim().toLowerCase();
  writeJson("misses", readMisses().filter((m) => m.text.toLowerCase() !== t));
}

/** Borra todo lo que REM guardó de esta persona en esta tienda (en este equipo). */
export function forgetEverything() {
  for (const n of ["phrases", "learned", "log", "misses", "aliases"] as const) removeMemory(n);
}

// ---------------------------------------------------------------------------------------------
// Frases que el dueño o el administrador le enseñó a REM para toda la tienda (src/lib/rem/team.ts).
// Viven en memoria (se traen de la base al entrar); se cambian de tienda con el usuario.

export type StorePhrase = { key: string; href: string; label: string };
let storePhrases = new Map<string, StorePhrase>();

export function setStorePhrases(rows: StorePhrase[]) {
  storePhrases = new Map(rows.filter((r) => r && r.key && r.href?.startsWith("/dashboard")).map((r) => [r.key, r]));
}

export function storePhrase(key: string): StorePhrase | null {
  return storePhrases.get(key) ?? null;
}

export function listStorePhrases(): StorePhrase[] {
  return [...storePhrases.values()].sort((a, b) => a.key.localeCompare(b.key));
}
