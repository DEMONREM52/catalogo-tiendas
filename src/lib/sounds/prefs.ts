import { SILENT, TONE_BY_ID } from "./tones";

/** Cada cosa que puede pasar en un pedido interno y que puede sonar. */
export type NotifEvent = "new_request" | "urgent_request" | "message" | "preparing" | "dispatched" | "received" | "rejected" | "cancelled";

export const NOTIF_EVENTS: Array<{ key: NotifEvent; label: string; hint: string; emoji: string; tone: string }> = [
  { key: "new_request", label: "Pedido nuevo", hint: "Otro punto les pide mercancía", emoji: "📦", tone: "campana-dorada" },
  { key: "urgent_request", label: "Pedido urgente", hint: "Un pedido marcado como urgente", emoji: "⚡", tone: "intercomunicador" },
  { key: "message", label: "Mensaje en el chat", hint: "Alguien escribe en un pedido", emoji: "💬", tone: "burbujas" },
  { key: "preparing", label: "En preparación", hint: "El otro punto empezó a prepararlo", emoji: "🧑‍🔧", tone: "marimba-pregunta" },
  { key: "dispatched", label: "En camino", hint: "La mercancía ya salió", emoji: "🚚", tone: "marimba-subida" },
  { key: "received", label: "Recibido", hint: "Confirmaron que llegó", emoji: "✅", tone: "marimba-listo" },
  { key: "rejected", label: "Rechazado", hint: "El pedido no se pudo atender", emoji: "⛔", tone: "buho" },
  { key: "cancelled", label: "Cancelado", hint: "Quien pidió lo canceló", emoji: "🚫", tone: "gota" },
];

export type EventPref = { on: boolean; tone: string };
export type StoreNotifConfig = {
  /** Sonidos dentro de la app. */
  enabled: boolean;
  /** Notificaciones del celular / computador (Web Push). */
  push: boolean;
  /** Volumen sugerido para todos (cada equipo puede cambiar el suyo). */
  volume: number;
  /** El dueño y quienes no tienen punto escuchan los pedidos de todos los puntos. */
  admins_all: boolean;
  events: Record<NotifEvent, EventPref>;
  /** Tonos distintos para un punto (lo que no se cambie usa el de la tienda). */
  points: Record<string, { events: Partial<Record<NotifEvent, Partial<EventPref>>> }>;
};

export function defaultConfig(): StoreNotifConfig {
  return {
    enabled: true,
    push: true,
    volume: 0.8,
    admins_all: true,
    events: Object.fromEntries(NOTIF_EVENTS.map((e) => [e.key, { on: true, tone: e.tone }])) as Record<NotifEvent, EventPref>,
    points: {},
  };
}

const okTone = (t: unknown) => typeof t === "string" && (t === SILENT || TONE_BY_ID.has(t));

/** Mezcla lo guardado con los valores por defecto (tolera configuraciones viejas o incompletas). */
export function normalizeConfig(raw: unknown): StoreNotifConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<StoreNotifConfig>;
  const out: StoreNotifConfig = {
    enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled,
    push: typeof r.push === "boolean" ? r.push : base.push,
    volume: typeof r.volume === "number" ? Math.min(1, Math.max(0, r.volume)) : base.volume,
    admins_all: typeof r.admins_all === "boolean" ? r.admins_all : base.admins_all,
    events: { ...base.events },
    points: {},
  };
  for (const e of NOTIF_EVENTS) {
    const v = r.events?.[e.key];
    if (v) out.events[e.key] = { on: typeof v.on === "boolean" ? v.on : true, tone: okTone(v.tone) ? v.tone : e.tone };
  }
  for (const [pid, p] of Object.entries(r.points ?? {})) {
    const events: Partial<Record<NotifEvent, Partial<EventPref>>> = {};
    for (const e of NOTIF_EVENTS) {
      const v = p?.events?.[e.key];
      if (!v) continue;
      const clean: Partial<EventPref> = {};
      if (typeof v.on === "boolean") clean.on = v.on;
      if (okTone(v.tone)) clean.tone = v.tone;
      if (Object.keys(clean).length) events[e.key] = clean;
    }
    if (Object.keys(events).length) out.points[pid] = { events };
  }
  return out;
}

/** Qué suena para un evento en un punto (el punto puede cambiar el tono de la tienda). */
export function resolveEvent(cfg: StoreNotifConfig, event: NotifEvent, pointId: string | null | undefined): EventPref {
  const base = cfg.events[event];
  const o = pointId ? cfg.points[pointId]?.events?.[event] : undefined;
  return { on: o?.on ?? base.on, tone: o?.tone ?? base.tone };
}

/** Estado de un pedido → evento de sonido. */
export function statusEvent(status: string | null | undefined): NotifEvent | null {
  return status === "preparing" || status === "dispatched" || status === "received" || status === "rejected" || status === "cancelled" ? status : null;
}

// ------- Preferencias de ESTE equipo (no cambian las de los demás) -------

export type DevicePrefs = { muted: boolean; volume: number | null; vibrate: boolean };
const DEVICE_DEFAULT: DevicePrefs = { muted: false, volume: null, vibrate: true };
const deviceKey = (storeId: string) => `remhub:sound-device:${storeId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, DevicePrefs>();

export function getDevicePrefs(storeId: string): DevicePrefs {
  const hit = cache.get(storeId);
  if (hit) return hit;
  let value = DEVICE_DEFAULT;
  try {
    const raw = window.localStorage.getItem(deviceKey(storeId));
    if (raw) value = { ...DEVICE_DEFAULT, ...(JSON.parse(raw) as Partial<DevicePrefs>) };
  } catch {
    /* sin almacenamiento */
  }
  cache.set(storeId, value);
  return value;
}

export function setDevicePrefs(storeId: string, patch: Partial<DevicePrefs>) {
  const next = { ...getDevicePrefs(storeId), ...patch };
  cache.set(storeId, next);
  try {
    window.localStorage.setItem(deviceKey(storeId), JSON.stringify(next));
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeDevicePrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ------- Configuración de la tienda en memoria (para el vigilante de avisos) -------

const storeCfg = new Map<string, { cfg: StoreNotifConfig; myPoint: string | null; canEdit: boolean }>();
const cfgListeners = new Set<() => void>();

export function setStoreConfigCache(storeId: string, value: { cfg: StoreNotifConfig; myPoint: string | null; canEdit: boolean }) {
  storeCfg.set(storeId, value);
  cfgListeners.forEach((fn) => fn());
}
export function getStoreConfigCache(storeId: string) {
  return storeCfg.get(storeId) ?? null;
}
export function subscribeStoreConfig(fn: () => void) {
  cfgListeners.add(fn);
  return () => {
    cfgListeners.delete(fn);
  };
}
