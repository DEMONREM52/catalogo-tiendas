"use client";

/**
 * Apariencia por usuario: qué tema se ve, vidrio, fondo animado y movimiento.
 *
 *   · Fuente de verdad: la base (user_appearance + user_themes, 20261284), por usuario con sesión.
 *   · Caché local por usuario para arrancar sin parpadeo (y sin internet): el último tema CONFIRMADO.
 *   · Vista previa del editor: solo en memoria de esta pestaña (nunca se guarda ni pasa a otros dispositivos).
 *   · Cerrar sesión borra el tema privado de la pantalla; cambiar de cuenta carga las preferencias de la otra.
 *   · El tema personal solo se aplica en el panel (/dashboard, /admin): catálogos y landings conservan su marca.
 */
import { supabaseBrowser } from "@/lib/supabase/client";
import { normalizeTheme, officialFor, themeCss, type BaseMode, type ThemeConfig } from "./theme";

export type AppearanceMode = "system" | "light" | "dark" | "custom";
export type Intensity = "subtle" | "elegant" | "premium";
export type AppearancePrefs = {
  mode: AppearanceMode;
  themeId: string | null;
  systemLight: string | null;
  systemDark: string | null;
  glass: boolean;
  animated: boolean;
  reducedMotion: boolean;
  intensity: Intensity;
  tipDismissed: boolean;
};
export type UserTheme = { id: string; name: string; description: string | null; base_mode: BaseMode; config: ThemeConfig; favorite: boolean; created_at: string; updated_at: string };

export const DEFAULT_PREFS: AppearancePrefs = {
  mode: "system", themeId: null, systemLight: null, systemDark: null, glass: true, animated: true, reducedMotion: false, intensity: "elegant", tipDismissed: false,
};

// Claves locales (las tres primeras son las de antes: se siguen escribiendo para no romper nada).
const LEGACY_MODE = "remhub-color-mode";
const LEGACY_GLASS = "remhub-glass";
const LEGACY_BG = "remhub-bg-anim";
/** Lo que lee el script de arranque (layout) antes de pintar. */
export const BOOT_KEY = "remhub-appearance-boot";
const cacheKey = (uid: string) => `remhub-appearance:${uid}`;
const STYLE_ID = "remhub-user-theme";
const EVENT = "remhub-appearance-change";

type Cache = { prefs: AppearancePrefs; version: number; themes: Record<string, { name: string; config: ThemeConfig }> };
type State = {
  userId: string | null;
  prefs: AppearancePrefs;
  version: number;
  /** Temas que hacen falta para pintar (el elegido y los de «sistema»); la lista completa se pide aparte. */
  needed: Record<string, { name: string; config: ThemeConfig }>;
  preview: ThemeConfig | null;
  ready: boolean;
  saving: boolean;
  error: string | null;
};

let state: State = { userId: null, prefs: readLegacy(), version: 0, needed: {}, preview: null, ready: false, saving: false, error: null };
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  apply();
  emit();
}
export function subscribeAppearance(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getAppearance() { return state; }

function safeGet(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key: string, value: string | null) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } }

/** Preferencias guardadas por la versión anterior (Sistema/Claro/Oscuro, Vidrio, Fondo animado). */
function readLegacy(): AppearancePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  const m = safeGet(LEGACY_MODE);
  return { ...DEFAULT_PREFS, mode: m === "light" || m === "dark" ? m : "system", glass: safeGet(LEGACY_GLASS) !== "off", animated: safeGet(LEGACY_BG) !== "off" };
}

function cleanPrefs(p: unknown): AppearancePrefs {
  const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  return {
    mode: ["system", "light", "dark", "custom"].includes(o.mode as string) ? (o.mode as AppearanceMode) : "system",
    themeId: id(o.themeId), systemLight: id(o.systemLight), systemDark: id(o.systemDark),
    glass: o.glass !== false, animated: o.animated !== false, reducedMotion: o.reducedMotion === true,
    intensity: ["subtle", "elegant", "premium"].includes(o.intensity as string) ? (o.intensity as Intensity) : "elegant",
    tipDismissed: o.tipDismissed === true,
  };
}
/** Lo que se guarda en la base: sin nulos (la base solo acepta las claves conocidas). */
function serverPrefs(p: AppearancePrefs) {
  const out: Record<string, unknown> = { mode: p.mode, glass: p.glass, animated: p.animated, reducedMotion: p.reducedMotion, intensity: p.intensity, tipDismissed: p.tipDismissed };
  if (p.themeId) out.themeId = p.themeId;
  if (p.systemLight) out.systemLight = p.systemLight;
  if (p.systemDark) out.systemDark = p.systemDark;
  return out;
}

const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
const inPanel = () => typeof window !== "undefined" && /^\/(dashboard|admin)(\/|$)/.test(window.location.pathname);

/** Qué tema se ve ahora: base (claro/oscuro) y, si es personal, su configuración. */
export function resolveTheme(s: State = state): { base: BaseMode; custom: ThemeConfig | null; label: string } {
  if (s.preview) return { base: s.preview.base, custom: s.preview, label: "Vista previa" };
  const p = s.prefs;
  const pick = (id: string | null) => (id && s.needed[id] ? s.needed[id] : null);
  if (p.mode === "custom") {
    const t = pick(p.themeId);
    if (t) return { base: t.config.base, custom: t.config, label: t.name };
    return { base: systemDark() ? "dark" : "light", custom: null, label: systemDark() ? "Obsidian Amethyst" : "Pearl Amethyst" };
  }
  if (p.mode === "light") return { base: "light", custom: null, label: "Pearl Amethyst" };
  if (p.mode === "dark") return { base: "dark", custom: null, label: "Obsidian Amethyst" };
  const dark = systemDark();
  const t = pick(dark ? p.systemDark : p.systemLight);
  return t ? { base: t.config.base, custom: t.config, label: t.name } : { base: dark ? "dark" : "light", custom: null, label: dark ? "Obsidian Amethyst" : "Pearl Amethyst" };
}

/** Pinta: atributos en <html> y, si hay tema personal en el panel, su bloque CSS (generado, nunca escrito por nadie). */
export function apply() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const r = resolveTheme();
  const p = state.prefs;
  const official = !r.custom;
  // Claro/oscuro: igual que antes («system» sin data-theme deja que mande el sistema).
  if (official && p.mode === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = r.base;
  root.dataset.themeChoice = p.mode;
  root.classList.toggle("dark", r.base === "dark");
  root.dataset.glass = p.glass ? "on" : "off";
  root.dataset.glassLevel = p.intensity;
  if (p.reducedMotion) root.dataset.reduceMotion = "on"; else delete root.dataset.reduceMotion;

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const css = r.custom && inPanel() ? themeCss(r.custom) : "";
  if (css) {
    if (!style) { style = document.createElement("style"); style.id = STYLE_ID; document.head.appendChild(style); }
    if (style.textContent !== css) style.textContent = css;
    root.dataset.userTheme = "on";
  } else {
    delete root.dataset.userTheme;
    if (style) style.textContent = "";
  }

  // Compatibilidad con lo de antes (otras partes leen estas claves).
  safeSet(LEGACY_GLASS, p.glass ? "on" : "off");
  safeSet(LEGACY_BG, p.animated ? "on" : "off");
  if (!state.preview) {
    safeSet(LEGACY_MODE, p.mode === "light" || p.mode === "dark" ? p.mode : "system");
    // Arranque sin parpadeo: solo lo confirmado (la vista previa no se guarda).
    const custom = resolveTheme({ ...state, preview: null }).custom;
    safeSet(BOOT_KEY, JSON.stringify({
      theme: official && p.mode === "system" ? null : r.base,
      glass: p.glass, level: p.intensity, rm: p.reducedMotion,
      css: custom ? themeCss(custom) : null,
    }));
  }
}

function writeCache() {
  if (!state.userId) return;
  const cache: Cache = { prefs: state.prefs, version: state.version, themes: state.needed };
  safeSet(cacheKey(state.userId), JSON.stringify(cache));
}

/* ------------------------------------------------------------------ sesión y sincronización */

let started = false;
let loadingFor: string | null = null;

/** Arranca una vez: escucha la sesión, el cambio claro/oscuro del sistema y vuelve a mirar al volver a la pestaña. */
export function startAppearance() {
  if (started || typeof window === "undefined") return;
  started = true;
  apply();
  const sb = supabaseBrowser();
  void sb.auth.getSession().then(({ data }) => void onUser(data.session?.user?.id ?? null));
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") void onUser(null);
    else if (session?.user?.id && session.user.id !== state.userId) void onUser(session.user.id);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { apply(); emit(); });
  const refresh = () => { if (state.userId && document.visibilityState === "visible") void pull(state.userId, true); };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  // Otra pestaña del mismo navegador guardó algo.
  window.addEventListener("storage", (e) => { if (state.userId && e.key === cacheKey(state.userId)) loadFromCache(state.userId); });
}

function loadFromCache(uid: string) {
  try {
    const c = JSON.parse(safeGet(cacheKey(uid)) ?? "null") as Cache | null;
    if (c) set({ prefs: cleanPrefs(c.prefs), version: c.version ?? 0, needed: c.themes ?? {} });
  } catch { /* caché dañada: se ignora */ }
}

async function onUser(uid: string | null) {
  if (uid === state.userId && state.ready) return;
  if (!uid) {
    // Cerró sesión: nada privado en pantalla; queda lo oficial que había en este navegador.
    set({ userId: null, needed: {}, preview: null, version: 0, ready: true, prefs: { ...readLegacy(), themeId: null, systemLight: null, systemDark: null } });
    safeSet(BOOT_KEY, null);
    apply();
    return;
  }
  // Otra cuenta: se olvida la anterior antes de cargar.
  if (state.userId && state.userId !== uid) set({ needed: {}, preview: null, version: 0, prefs: { ...DEFAULT_PREFS, glass: state.prefs.glass, animated: state.prefs.animated } });
  state = { ...state, userId: uid };
  loadFromCache(uid);
  await pull(uid, false);
}

/** Trae las preferencias de la base. La primera vez, pasa a la cuenta lo que este navegador ya tenía. */
async function pull(uid: string, quiet: boolean) {
  if (loadingFor === uid) return;
  loadingFor = uid;
  try {
    const sb = supabaseBrowser();
    const { data, error } = await sb.from("user_appearance").select("prefs, version").eq("user_id", uid).maybeSingle();
    if (error) {
      // Sin la migración o sin internet: se sigue con la caché (o lo local).
      if (!quiet) set({ ready: true, error: /relation|does not exist|schema cache/i.test(error.message) ? "missing" : null });
      return;
    }
    if (!data) {
      const local = { ...readLegacy(), ...(state.prefs.mode === "custom" ? {} : { mode: state.prefs.mode }) };
      const ins = await sb.from("user_appearance").insert({ prefs: serverPrefs(local) }).select("prefs, version").maybeSingle();
      if (!ins.error && ins.data) set({ prefs: cleanPrefs(ins.data.prefs), version: ins.data.version, ready: true, error: null });
      else set({ ready: true });
      writeCache();
      return;
    }
    if (data.version === state.version && state.ready && quiet) return;
    const prefs = cleanPrefs(data.prefs);
    const needed = await fetchNeeded(prefs);
    set({ prefs, version: data.version, needed, ready: true, error: null });
    writeCache();
  } finally {
    loadingFor = null;
  }
}

/** Solo los temas que hacen falta para pintar (no toda la colección). */
async function fetchNeeded(p: AppearancePrefs) {
  const ids = [...new Set([p.themeId, p.systemLight, p.systemDark].filter(Boolean) as string[])];
  const needed: State["needed"] = {};
  if (!ids.length) return needed;
  const { data } = await supabaseBrowser().from("user_themes").select("id, name, config").in("id", ids);
  for (const t of (data ?? []) as Array<{ id: string; name: string; config: unknown }>) needed[t.id] = { name: t.name, config: normalizeTheme(t.config) };
  return needed;
}

/** Cambia preferencias: se ve al instante y se guarda en la cuenta (si otro dispositivo guardó algo más nuevo, gana ese). */
export async function updatePrefs(patch: Partial<AppearancePrefs>, extraTheme?: { id: string; name: string; config: ThemeConfig }) {
  const prev = state;
  const prefs = { ...state.prefs, ...patch };
  const needed = extraTheme ? { ...state.needed, [extraTheme.id]: { name: extraTheme.name, config: extraTheme.config } } : state.needed;
  set({ prefs, needed });
  if (!state.userId || state.error === "missing") return true;
  set({ saving: true });
  const sb = supabaseBrowser();
  const { data, error } = await sb.from("user_appearance").update({ prefs: serverPrefs(prefs) }).eq("user_id", state.userId).eq("version", prev.version).select("prefs, version");
  if (error) { set({ saving: false, error: error.message }); return false; }
  if (!data?.length) {
    // Conflicto: hay una versión más nueva (otro dispositivo). Se trae y se vuelve a aplicar este cambio encima.
    const fresh = await sb.from("user_appearance").select("prefs, version").eq("user_id", state.userId).maybeSingle();
    if (fresh.data) {
      const merged = { ...cleanPrefs(fresh.data.prefs), ...patch };
      const again = await sb.from("user_appearance").update({ prefs: serverPrefs(merged) }).eq("user_id", state.userId).eq("version", fresh.data.version).select("prefs, version");
      if (again.data?.length) set({ prefs: cleanPrefs(again.data[0].prefs), version: again.data[0].version, saving: false });
      else set({ prefs: cleanPrefs(fresh.data.prefs), version: fresh.data.version, saving: false });
    } else set({ saving: false });
    writeCache();
    return true;
  }
  set({ prefs: cleanPrefs(data[0].prefs), version: data[0].version, saving: false, error: null });
  writeCache();
  return true;
}

/* ------------------------------------------------------------------ vista previa (solo esta pestaña) */
export function setPreview(t: ThemeConfig | null) { set({ preview: t ? normalizeTheme(t) : null }); }

/* ------------------------------------------------------------------ temas del usuario */

export type ThemeSort = "updated" | "created" | "name";
export async function listThemes(opts: { q?: string; sort?: ThemeSort; favorites?: boolean; offset?: number; limit?: number } = {}) {
  const limit = opts.limit ?? 24;
  let query = supabaseBrowser().from("user_themes").select("id, name, description, base_mode, config, favorite, created_at, updated_at", { count: "exact" });
  if (opts.q?.trim()) query = query.ilike("name", `%${opts.q.trim().replace(/[%_]/g, "")}%`);
  if (opts.favorites) query = query.eq("favorite", true);
  query = opts.sort === "name" ? query.order("name") : query.order(opts.sort === "created" ? "created_at" : "updated_at", { ascending: false });
  const { data, error, count } = await query.order("id").range(opts.offset ?? 0, (opts.offset ?? 0) + limit - 1);
  if (error) throw new Error(/relation|does not exist|schema cache/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261284_temas_por_usuario.sql." : error.message);
  return { items: ((data ?? []) as UserTheme[]).map((t) => ({ ...t, config: normalizeTheme(t.config) })), total: count ?? 0 };
}

export async function countThemes() {
  const { count } = await supabaseBrowser().from("user_themes").select("id", { count: "exact", head: true });
  return count ?? 0;
}

export async function saveTheme(input: { id?: string; name: string; description?: string | null; config: ThemeConfig; favorite?: boolean }) {
  const config = normalizeTheme(input.config);
  const row = { name: input.name.trim().slice(0, 60) || "Mi tema", description: input.description?.trim().slice(0, 200) || null, base_mode: config.base, config, ...(input.favorite === undefined ? {} : { favorite: input.favorite }) };
  const sb = supabaseBrowser();
  const res = input.id
    ? await sb.from("user_themes").update(row).eq("id", input.id).select("id, name, description, base_mode, config, favorite, created_at, updated_at").single()
    : await sb.from("user_themes").insert(row).select("id, name, description, base_mode, config, favorite, created_at, updated_at").single();
  if (res.error) throw new Error(/relation|does not exist|schema cache/i.test(res.error.message) ? "Falta ejecutar en Supabase la migración 20261284_temas_por_usuario.sql." : res.error.message);
  const saved = { ...(res.data as UserTheme), config: normalizeTheme((res.data as UserTheme).config) };
  // Si es uno de los que se están usando, se repinta y se guarda en la caché.
  if (state.needed[saved.id]) { set({ needed: { ...state.needed, [saved.id]: { name: saved.name, config: saved.config } } }); writeCache(); }
  return saved;
}

export async function setFavorite(id: string, favorite: boolean) {
  const { error } = await supabaseBrowser().from("user_themes").update({ favorite }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Borra un tema propio. Si estaba en uso, antes pasa al oficial de su mismo tipo (la base también lo hace). */
export async function deleteTheme(t: Pick<UserTheme, "id" | "base_mode">) {
  const p = state.prefs;
  const patch: Partial<AppearancePrefs> = {};
  if (p.themeId === t.id) { patch.themeId = null; if (p.mode === "custom") patch.mode = t.base_mode; }
  if (p.systemLight === t.id) patch.systemLight = null;
  if (p.systemDark === t.id) patch.systemDark = null;
  if (Object.keys(patch).length) await updatePrefs(patch);
  const { error } = await supabaseBrowser().from("user_themes").delete().eq("id", t.id);
  if (error) throw new Error(error.message);
  const needed = { ...state.needed };
  delete needed[t.id];
  set({ needed });
  writeCache();
}

/** Usar un tema propio ahora (modo manual). */
export async function activateTheme(t: Pick<UserTheme, "id" | "name" | "config">) {
  return updatePrefs({ mode: "custom", themeId: t.id }, { id: t.id, name: t.name, config: t.config });
}

/** Vuelve todo a como viene RemHub (no borra temas). */
export async function restoreDefaults() {
  return updatePrefs({ ...DEFAULT_PREFS, tipDismissed: state.prefs.tipDismissed });
}

export { officialFor };
