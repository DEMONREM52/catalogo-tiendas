"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Check, ChevronDown, Dices, Play, RotateCcw, Smartphone, Store, Undo2, Volume2, VolumeX, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from "@/lib/pwa/push";
import { NOTIF_EVENTS, defaultConfig, getDevicePrefs, normalizeConfig, resolveEvent, setDevicePrefs, setStoreConfigCache, subscribeDevicePrefs, type EventPref, type NotifEvent, type StoreNotifConfig } from "@/lib/sounds/prefs";
import { SILENT, TONES, TONE_BY_ID, TONE_CATEGORIES, playTone, type ToneCategory } from "@/lib/sounds/tones";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
type Point = { id: string; name: string };

const PUSH_TEXT: Record<PushState, { title: string; text: string; color: string }> = {
  on: { title: "Activadas en este equipo", text: "Te llegan como cualquier notificación del celular, aunque RemHub esté cerrada.", color: "#22c55e" },
  off: { title: "Desactivadas en este equipo", text: "Actívalas para enterarte de pedidos y mensajes aunque no tengas RemHub abierta.", color: "#f59e0b" },
  denied: { title: "Bloqueadas por el navegador", text: "Ábrelas en la configuración del navegador (candado junto a la dirección → Notificaciones → Permitir) y vuelve aquí.", color: "#ef4444" },
  "needs-install": { title: "En iPhone, primero instala la app", text: "Apple solo permite notificaciones con RemHub en la pantalla de inicio (iOS 16.4 o superior). Instálala y actívalas desde la app.", color: "#0ea5e9" },
  unsupported: { title: "Este navegador no las permite", text: "Prueba con Chrome, Edge, Safari o Samsung Internet actualizados. Los sonidos dentro de la app sí funcionan.", color: "#94a3b8" },
};

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40"
      style={{ background: on ? "var(--t-accent)" : "color-mix(in oklab, var(--t-card-border) 90%, transparent)" }}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className="absolute top-1 h-5 w-5 rounded-full bg-white shadow" style={{ left: on ? "1.5rem" : "0.25rem" }} />
    </button>
  );
}

function toneLabel(id: string) {
  if (id === SILENT) return { emoji: "🔇", name: "Silencio" };
  const t = TONE_BY_ID.get(id);
  return t ? { emoji: t.emoji, name: t.name } : { emoji: "🔔", name: id };
}

/** Sonidos y notificaciones de pedidos internos: este equipo y (con permiso) toda la tienda. */
export function NotificationSettings({ open, onClose, storeId, points }: { open: boolean; onClose: () => void; storeId: string; points: Point[] }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const device = useSyncExternalStore(subscribeDevicePrefs, () => getDevicePrefs(storeId), () => getDevicePrefs(storeId));
  const [tab, setTab] = useState<"device" | "store">("device");
  const [draft, setDraft] = useState<StoreNotifConfig | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [meta, setMeta] = useState<{ canEdit: boolean; myPoint: string | null; by: string | null; at: string | null; missing: boolean }>({ canEdit: false, myPoint: null, by: null, at: null, missing: false });
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [scope, setScope] = useState<string>("store");
  const [picking, setPicking] = useState<NotifEvent | null>(null);
  const [cat, setCat] = useState<ToneCategory | "all">("all");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_notification_prefs_get", { p_store: storeId }).then(({ data, error }) => {
      if (!alive) return;
      const res = (data ?? {}) as { ok?: boolean; config?: unknown; can_edit?: boolean; my_point?: string | null; updated_by_name?: string | null; updated_at?: string | null };
      const cfg = normalizeConfig(error || !res.ok ? null : res.config);
      setDraft(cfg);
      setSaved(JSON.stringify(cfg));
      setMeta({ canEdit: Boolean(res.can_edit) && !error, myPoint: res.my_point ?? null, by: res.updated_by_name ?? null, at: res.updated_at ?? null, missing: Boolean(error) });
      setStoreConfigCache(storeId, { cfg, myPoint: res.my_point ?? null, canEdit: Boolean(res.can_edit) });
    });
    void getPushState().then((s) => alive && setPush(s));
    return () => {
      alive = false;
    };
  }, [open, storeId]);

  const dirty = draft ? JSON.stringify(draft) !== saved : false;
  const editable = meta.canEdit;
  const vol = device.volume ?? draft?.volume ?? 0.8;
  const tones = useMemo(() => (cat === "all" ? TONES : TONES.filter((t) => t.cat === cat)), [cat]);

  function prefFor(ev: NotifEvent): EventPref & { inherited: boolean } {
    if (!draft) return { on: true, tone: SILENT, inherited: true };
    const base = draft.events[ev];
    if (scope === "store") return { ...base, inherited: false };
    const o = draft.points[scope]?.events?.[ev];
    const r = resolveEvent(draft, ev, scope);
    return { ...r, inherited: !o };
  }

  function setPref(ev: NotifEvent, patch: Partial<EventPref> | null) {
    setDraft((cur) => {
      if (!cur) return cur;
      const next: StoreNotifConfig = structuredClone(cur);
      if (scope === "store") {
        if (patch) next.events[ev] = { ...next.events[ev], ...patch };
        return next;
      }
      const p = next.points[scope] ?? { events: {} };
      if (patch) p.events[ev] = { ...p.events[ev], ...patch };
      else delete p.events[ev];
      if (Object.keys(p.events).length) next.points[scope] = p;
      else delete next.points[scope];
      return next;
    });
  }

  function choose(ev: NotifEvent, tone: string) {
    playTone(tone, vol);
    setPref(ev, { tone, on: true });
  }

  function randomize() {
    const used = new Set<string>();
    for (const e of NOTIF_EVENTS) {
      const pool = TONES.filter((t) => !used.has(t.id));
      const t = pool[Math.floor(Math.random() * pool.length)];
      used.add(t.id);
      setPref(e.key, { tone: t.id, on: true });
    }
    const pick = TONES[Math.floor(Math.random() * TONES.length)];
    playTone(pick.id, vol);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    const { data, error } = await supabaseBrowser().rpc("erp_notification_prefs_save", { p_store: storeId, p_config: draft });
    setSaving(false);
    const res = data as { ok?: boolean; message?: string } | null;
    if (error || !res?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: error?.message ?? res?.message ?? "Intenta de nuevo." });
    setSaved(JSON.stringify(draft));
    setStoreConfigCache(storeId, { cfg: draft, myPoint: meta.myPoint, canEdit: meta.canEdit });
    void Swal.fire({ ...swal, icon: "success", title: "¡Sonidos guardados!", text: "Ya suenan así en todos los equipos de la tienda.", timer: 1800, showConfirmButton: false });
  }

  async function togglePush() {
    if (!push) return;
    setPushBusy(true);
    try {
      if (push === "on") setPush(await disablePush());
      else {
        const r = await enablePush(storeId);
        setPush(r.state);
        if (r.error) void Swal.fire({ ...swal, icon: "error", title: "No se pudo activar", text: r.error });
        else if (r.state === "on") void sendTestPush(storeId);
      }
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo activar", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    setPushBusy(true);
    const r = await sendTestPush(storeId).catch(() => ({ ok: false, message: "Sin conexión." }));
    setPushBusy(false);
    if (!r.ok) void Swal.fire({ ...swal, icon: "info", title: "Prueba", text: r.message ?? "No se pudo enviar." });
  }

  if (!mounted) return null;
  const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };
  const pushInfo = push ? PUSH_TEXT[push] : null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-140 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Sonidos y avisos"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:rounded-3xl"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
              <motion.span animate={{ rotate: [0, -14, 12, -8, 0] }} transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 3 }} className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>
                <BellRing size={20} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black">Sonidos y avisos</h2>
                <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>Pedidos nuevos, mensajes y cambios de estado</p>
              </div>
              <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
                <X size={16} />
              </button>
            </header>

            <div className="flex gap-1 px-5 pt-4 text-sm font-bold">
              {([["device", <Smartphone key="d" size={15} />, "Mi equipo"], ["store", <Store key="s" size={15} />, "Tonos de la tienda"]] as const).map(([k, icon, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 transition" style={tab === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)", border: "1px solid var(--t-card-border)" }}>
                  {icon} {label}
                </button>
              ))}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {tab === "device" ? (
                <>
                  <section className="rounded-2xl border p-4" style={card}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ background: pushInfo?.color ?? "#94a3b8", boxShadow: `0 0 0 4px color-mix(in oklab, ${pushInfo?.color ?? "#94a3b8"} 25%, transparent)` }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>📲 Notificaciones del celular</p>
                        <p className="mt-1 font-bold">{pushInfo?.title ?? "Revisando…"}</p>
                        <p className="mt-0.5 text-sm" style={{ color: "var(--t-muted)" }}>{pushInfo?.text}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {push === "on" || push === "off" ? (
                        <button type="button" disabled={pushBusy} onClick={() => void togglePush()} className="rounded-full px-4 py-2 text-sm font-bold disabled:opacity-50" style={push === "on" ? { border: "1px solid var(--t-card-border)" } : { background: "linear-gradient(135deg, #8b5cf6, #ec4899)", color: "#fff" }}>
                          {pushBusy ? "Un momento…" : push === "on" ? "Desactivar en este equipo" : "🔔 Activar notificaciones"}
                        </button>
                      ) : null}
                      {push === "on" ? (
                        <button type="button" disabled={pushBusy} onClick={() => void testPush()} className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
                          Enviar una prueba
                        </button>
                      ) : null}
                      {push === "needs-install" ? (
                        <Link href="/instalar" className="rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "#0ea5e9" }}>Cómo instalar RemHub</Link>
                      ) : null}
                    </div>
                  </section>

                  <section className="space-y-4 rounded-2xl border p-4" style={card}>
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>🔊 Sonidos en este equipo</p>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{device.muted ? "🔕" : "🔔"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">{device.muted ? "Silenciado" : "Sonidos activos"}</p>
                        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Solo cambia este equipo, no el de tus compañeros.</p>
                      </div>
                      <Toggle on={!device.muted} onChange={(v) => setDevicePrefs(storeId, { muted: !v })} label="Sonidos en este equipo" />
                    </div>
                    <div className={device.muted ? "pointer-events-none opacity-40" : ""}>
                      <div className="flex items-center gap-3">
                        <VolumeX size={16} style={{ color: "var(--t-muted)" }} />
                        <input type="range" min={0.05} max={1} step={0.05} value={vol} onChange={(e) => setDevicePrefs(storeId, { volume: Number(e.target.value) })} className="h-2 flex-1 cursor-pointer accent-violet-500" aria-label="Volumen" />
                        <Volume2 size={16} style={{ color: "var(--t-muted)" }} />
                        <span className="w-10 text-right text-xs font-bold tabular-nums">{Math.round(vol * 100)}%</span>
                      </div>
                      {device.volume !== null ? (
                        <button type="button" onClick={() => setDevicePrefs(storeId, { volume: null })} className="mt-1 text-xs font-semibold underline" style={{ color: "var(--t-muted)" }}>Usar el volumen de la tienda</button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📳</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">Vibrar</p>
                        <p className="text-xs" style={{ color: "var(--t-muted)" }}>En celulares Android (iPhone no lo permite en la web).</p>
                      </div>
                      <Toggle on={device.vibrate} onChange={(v) => setDevicePrefs(storeId, { vibrate: v })} label="Vibrar" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {NOTIF_EVENTS.slice(0, 4).map((e) => (
                        <button key={e.key} type="button" disabled={device.muted} onClick={() => draft && playTone(resolveEvent(draft, e.key, meta.myPoint).tone, vol)} className="flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold transition hover:-translate-y-0.5 disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }}>
                          <Play size={12} /> {e.emoji} {e.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              ) : !draft ? (
                <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)" }} />)}</div>
              ) : (
                <>
                  {meta.missing ? (
                    <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Falta ejecutar en Supabase la migración <b>20261105_notificaciones_pedidos.sql</b>. Mientras tanto suenan los tonos por defecto.</p>
                  ) : !editable ? (
                    <p className="rounded-2xl border p-3 text-sm" style={card}>👀 Puedes escuchar los tonos. Para cambiarlos se necesita el permiso <b>«Sonidos y avisos de pedidos internos»</b> (lo tienen el dueño y los administradores).</p>
                  ) : null}

                  <section className="space-y-3 rounded-2xl border p-4" style={card}>
                    {([
                      ["enabled", "🔔", "Sonidos dentro de la app", "Suenan en todos los equipos con RemHub abierta"],
                      ["push", "📲", "Notificaciones del celular", "Llegan aunque la app esté cerrada (a quien las active)"],
                      ["admins_all", "👑", "Dueño y administradores escuchan todo", "Quien no tiene punto asignado recibe los avisos de todos los puntos"],
                    ] as const).map(([k, emoji, title, hint]) => (
                      <div key={k} className="flex items-center gap-3">
                        <span className="text-2xl">{emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold">{title}</p>
                          <p className="text-xs" style={{ color: "var(--t-muted)" }}>{hint}</p>
                        </div>
                        <Toggle on={draft[k]} disabled={!editable} onChange={(v) => setDraft({ ...draft, [k]: v })} label={title} />
                      </div>
                    ))}
                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-sm font-bold">Volumen sugerido</span>
                      <input type="range" min={0.05} max={1} step={0.05} disabled={!editable} value={draft.volume} onChange={(e) => setDraft({ ...draft, volume: Number(e.target.value) })} className="h-2 flex-1 cursor-pointer accent-violet-500 disabled:opacity-40" aria-label="Volumen sugerido" />
                      <span className="w-10 text-right text-xs font-bold tabular-nums">{Math.round(draft.volume * 100)}%</span>
                    </div>
                  </section>

                  {points.length > 1 ? (
                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>¿Para quién son estos tonos?</p>
                      <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs font-bold [scrollbar-width:none]">
                        {[{ id: "store", name: "🏬 Toda la tienda" }, ...points.map((p) => ({ id: p.id, name: `📍 ${p.name}${draft.points[p.id] ? " ✱" : ""}` }))].map((p) => (
                          <button key={p.id} type="button" onClick={() => { setScope(p.id); setPicking(null); }} className="shrink-0 rounded-full px-3 py-1.5 transition" style={scope === p.id ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)", color: "var(--t-muted)" }}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                      {scope !== "store" ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Lo que no cambies en este punto usa el tono de toda la tienda.</p> : null}
                    </div>
                  ) : null}

                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>🎵 Un tono para cada cosa · {TONES.length} tonos</p>
                      {editable ? (
                        <button type="button" onClick={randomize} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                          <Dices size={14} /> Al azar
                        </button>
                      ) : null}
                    </div>
                    {NOTIF_EVENTS.map((e) => {
                      const p = prefFor(e.key);
                      const t = toneLabel(p.tone);
                      const isOpen = picking === e.key;
                      return (
                        <div key={e.key} className="overflow-hidden rounded-2xl border" style={{ ...card, borderColor: isOpen ? "var(--t-accent)" : "var(--t-card-border)" }}>
                          <div className="flex items-center gap-3 p-3">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}>{e.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold">{e.label}</p>
                              <button type="button" onClick={() => setPicking(isOpen ? null : e.key)} disabled={!p.on} className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs font-semibold disabled:opacity-40" style={{ color: "var(--t-accent)" }}>
                                {t.emoji} {t.name}{p.inherited && scope !== "store" ? " (de la tienda)" : ""} <ChevronDown size={12} className={isOpen ? "rotate-180 transition" : "transition"} />
                              </button>
                            </div>
                            <button type="button" onClick={() => playTone(p.tone, vol)} disabled={!p.on || p.tone === SILENT} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border disabled:opacity-30" style={{ borderColor: "var(--t-card-border)" }} aria-label={`Escuchar ${e.label}`}>
                              <Play size={14} />
                            </button>
                            <Toggle on={p.on} disabled={!editable} onChange={(v) => setPref(e.key, { on: v })} label={e.label} />
                          </div>
                          <AnimatePresence initial={false}>
                            {isOpen ? (
                              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                                <div className="space-y-2 border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
                                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{e.hint}. Toca un tono para escucharlo{editable ? " y elegirlo" : ""}.</p>
                                  <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs font-bold [scrollbar-width:none]">
                                    {[{ cat: "all" as const, emoji: "✨" }, ...TONE_CATEGORIES].map((c) => (
                                      <button key={c.cat} type="button" onClick={() => setCat(c.cat)} className="shrink-0 rounded-full px-3 py-1 transition" style={cat === c.cat ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)", color: "var(--t-muted)" }}>
                                        {c.emoji} {c.cat === "all" ? "Todos" : c.cat}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
                                    {tones.map((tn) => {
                                      const sel = p.tone === tn.id;
                                      return (
                                        <motion.button
                                          key={tn.id}
                                          type="button"
                                          whileTap={{ scale: 0.94 }}
                                          onClick={() => (editable ? choose(e.key, tn.id) : playTone(tn.id, vol))}
                                          className="flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-semibold transition"
                                          style={sel ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}
                                        >
                                          <span className="text-base">{tn.emoji}</span>
                                          <span className="min-w-0 flex-1 truncate">{tn.name}</span>
                                          {sel ? <Check size={14} style={{ color: "var(--t-accent)" }} /> : null}
                                        </motion.button>
                                      );
                                    })}
                                  </div>
                                  {editable ? (
                                    <div className="flex flex-wrap gap-2 pt-1">
                                      <button type="button" onClick={() => setPref(e.key, { tone: SILENT })} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>🔇 Sin sonido (solo aviso)</button>
                                      {scope !== "store" && !p.inherited ? (
                                        <button type="button" onClick={() => setPref(e.key, null)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                                          <Undo2 size={12} /> Usar el de la tienda
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </section>
                  {meta.by && meta.at ? <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Último cambio: {meta.by} · {new Date(meta.at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
                </>
              )}
            </div>

            {tab === "store" && draft && editable ? (
              <footer className="flex items-center gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(defaultConfig());
                    setScope("store");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-bold"
                  style={{ borderColor: "var(--t-card-border)" }}
                >
                  <RotateCcw size={13} /> Por defecto
                </button>
                <span className="flex-1 text-right text-xs" style={{ color: "var(--t-muted)" }}>{dirty ? "Cambios sin guardar" : "Todo guardado ✓"}</span>
                <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded-full px-5 py-2 text-sm font-bold text-white shadow-lg transition disabled:opacity-40" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>
                  {saving ? "Guardando…" : "Guardar"}
                </button>
              </footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
