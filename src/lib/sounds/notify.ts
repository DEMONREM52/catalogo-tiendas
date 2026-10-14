"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { playTone } from "./tones";
import { getDevicePrefs, getStoreConfigCache, normalizeConfig, resolveEvent, setStoreConfigCache, type NotifEvent, type StoreNotifConfig } from "./prefs";

const loading = new Map<string, Promise<void>>();

/** Carga (una vez) la configuración de sonidos de la tienda. */
export function loadStoreSoundConfig(storeId: string, force = false): Promise<void> {
  if (!force && getStoreConfigCache(storeId)) return Promise.resolve();
  const running = loading.get(storeId);
  if (running && !force) return running;
  const p = (async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_notification_prefs_get", { p_store: storeId });
    const res = (data ?? {}) as { ok?: boolean; config?: unknown; my_point?: string | null; can_edit?: boolean };
    // Sin la migración todavía: se usan los tonos por defecto.
    const cfg: StoreNotifConfig = normalizeConfig(error || !res.ok ? null : res.config);
    setStoreConfigCache(storeId, { cfg, myPoint: res.my_point ?? null, canEdit: Boolean(res.can_edit) });
  })().finally(() => loading.delete(storeId));
  loading.set(storeId, p);
  return p;
}

/**
 * Hace sonar el tono de un evento según: configuración de la tienda → del punto → de este equipo.
 * Devuelve el tono que sonó (o null si está silenciado).
 */
export async function soundFor(storeId: string, event: NotifEvent, pointId?: string | null): Promise<string | null> {
  await loadStoreSoundConfig(storeId);
  const cached = getStoreConfigCache(storeId);
  if (!cached) return null;
  const device = getDevicePrefs(storeId);
  if (!cached.cfg.enabled || device.muted) return null;
  // Quien no tiene punto (dueño, administradores) escucha todo solo si la tienda lo quiere.
  if (!pointId && !cached.myPoint && !cached.cfg.admins_all) return null;
  const pref = resolveEvent(cached.cfg, event, pointId ?? cached.myPoint);
  if (!pref.on) return null;
  playTone(pref.tone, device.volume ?? cached.cfg.volume);
  if (device.vibrate) {
    try {
      navigator.vibrate?.(event === "urgent_request" ? [120, 60, 120, 60, 220] : [90, 50, 90]);
    } catch {
      /* sin vibración */
    }
  }
  return pref.tone;
}

// Lo que hago yo no me suena a mí (ej.: yo despacho → el sonido es para el otro punto).
const own = new Map<string, number>();
export function markOwnAction(requestId: string) {
  own.set(requestId, Date.now());
}
export function isOwnRecent(requestId: string, ms = 15000) {
  const t = own.get(requestId);
  return t !== undefined && Date.now() - t < ms;
}
