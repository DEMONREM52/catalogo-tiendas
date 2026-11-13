/**
 * REM aprende en la tienda (migración 20261322):
 *   · Lo que no entendió se anota en la base SIN el nombre de quien lo dijo, para que el dueño o un administrador
 *     le enseñe a dónde lleva. Se borra solo a los 90 días.
 *   · Lo que el dueño o el administrador le enseña vale para todos en la tienda. Igual que lo aprendido por cada
 *     persona, no da permisos: solo lleva a una página si la persona la puede abrir.
 * Si la migración no está, todo sigue funcionando como antes (solo en este equipo).
 */

import { supabaseBrowser } from "@/lib/supabase/client";
import { setStorePhrases, type StorePhrase } from "./memory";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await supabaseBrowser().rpc(fn, args);
    if (error) return { ok: false, error: /Could not find|does not exist/i.test(error.message) ? "Falta correr en Supabase la migración 20261322_rem_aprende_en_tienda.sql." : error.message };
    const v = data as { ok?: boolean; error?: string } | null;
    if (v && v.ok === false) return { ok: false, error: v.error ?? "No se pudo." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Sin conexión." };
  }
}

/** Anota lo que no entendió (sin esperar; si falla, no pasa nada). */
export function reportMiss(storeId: string, phrase: string, path: string) {
  void rpc("rem_report_miss", { p_store: storeId, p_phrase: phrase, p_path: path });
}

/** Trae las frases que la tienda le enseñó y las deja listas para entender. */
export async function loadStorePhrases(storeId: string): Promise<number> {
  const r = await rpc<{ rows: StorePhrase[] }>("rem_store_phrases", { p_store: storeId });
  if (!r.ok) return 0;
  setStorePhrases(r.data.rows ?? []);
  return r.data.rows?.length ?? 0;
}

export type TeamMiss = { phrase: string; times: number; people: number; last_at: string; path: string | null };

export async function reviewMisses(storeId: string): Promise<Result<TeamMiss[]>> {
  const r = await rpc<{ rows: TeamMiss[] }>("rem_misses_review", { p_store: storeId });
  return r.ok ? { ok: true, data: r.data.rows ?? [] } : r;
}

export async function teachStore(storeId: string, phrase: string, href: string, label: string): Promise<Result<unknown>> {
  const r = await rpc("rem_phrase_teach", { p_store: storeId, p_phrase: phrase, p_href: href, p_label: label });
  if (r.ok) await loadStorePhrases(storeId);
  return r;
}

export async function forgetStore(storeId: string, phrase: string): Promise<Result<unknown>> {
  const r = await rpc("rem_phrase_forget", { p_store: storeId, p_phrase: phrase });
  if (r.ok) await loadStorePhrases(storeId);
  return r;
}

export async function dismissTeamMiss(storeId: string, phrase: string): Promise<Result<unknown>> {
  return rpc("rem_miss_dismiss", { p_store: storeId, p_phrase: phrase });
}
