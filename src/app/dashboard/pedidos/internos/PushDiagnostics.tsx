"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, RefreshCw, Wrench } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { enablePush } from "@/lib/pwa/push";

/**
 * Verificador de notificaciones: revisa uno por uno los requisitos para que el aviso llegue con el navegador
 * cerrado (este equipo y el servidor), dice cuál falla y cómo arreglarlo, y prueba con la app cerrada.
 */

type Level = "ok" | "fail" | "warn";
type Check = { key: string; label: string; level: Level; detail: string; fix?: "enable" | null };
type Server = { ok?: boolean; keys?: boolean; subscribed?: boolean; lastDelivered?: string | null; devices?: number; audience?: boolean | null; storePush?: boolean | null; webhook?: "ok" | "missing" | "old-domain" | "unknown" };

const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Dónde se abre el permiso, según el equipo. */
function permissionHelp() {
  if (isIos()) return "iPhone: Ajustes → Notificaciones → RemHub → Permitir notificaciones.";
  if (isAndroid()) return "Android: toca el candado junto a la dirección → Permisos → Notificaciones → Permitir. Y en Ajustes del celular → Apps → Chrome → Notificaciones: activadas.";
  return "Computador: toca el candado junto a la dirección → Notificaciones → Permitir. En Windows, revisa también Configuración → Sistema → Notificaciones → Chrome activado.";
}

async function serverStatus(storeId: string, endpoint: string | null): Promise<Server | null> {
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    const res = await fetch("/api/push/status", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ store_id: storeId, endpoint }) });
    return (await res.json()) as Server;
  } catch {
    return null;
  }
}

export function PushDiagnostics({ storeId, onChanged }: { storeId: string; onChanged?: () => void }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setTest(null);
    const out: Check[] = [];
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    out.push({ key: "browser", label: "Navegador compatible", level: supported ? "ok" : "fail", detail: supported ? "Este navegador puede recibir notificaciones." : "Usa Chrome, Edge, Samsung Internet o Safari actualizados." });
    if (isIos()) {
      out.push({ key: "ios", label: "Instalada en la pantalla de inicio", level: standalone() ? "ok" : "fail", detail: standalone() ? "Abriste RemHub como app." : "En iPhone solo llegan con RemHub instalada: Compartir → «Agregar a pantalla de inicio», y ábrela desde ese ícono." });
    }
    const perm = supported ? Notification.permission : "denied";
    out.push({
      key: "permission", label: "Permiso del navegador",
      level: perm === "granted" ? "ok" : "fail",
      detail: perm === "granted" ? "Permitido." : perm === "denied" ? `Bloqueado. ${permissionHelp()}` : "Aún no se ha pedido. Toca «Reparar» y acepta.",
      fix: perm === "default" ? "enable" : null,
    });
    let endpoint: string | null = null;
    if (supported) {
      const reg = await navigator.serviceWorker.getRegistration();
      out.push({ key: "sw", label: "Servicio en segundo plano", level: reg?.active ? "ok" : "fail", detail: reg?.active ? "Activo: es el que muestra los avisos con la app cerrada." : "No está activo. Recarga la página; si sigue, toca «Reparar»." , fix: reg?.active ? null : "enable" });
      const sub = await reg?.pushManager.getSubscription();
      endpoint = sub?.endpoint ?? null;
      out.push({ key: "sub", label: "Este equipo suscrito", level: sub ? "ok" : "fail", detail: sub ? "El navegador tiene la suscripción." : "Este equipo no está suscrito. Toca «Reparar».", fix: sub || perm === "denied" ? null : "enable" });
    }
    const srv = await serverStatus(storeId, endpoint);
    if (!srv?.ok) {
      out.push({ key: "server", label: "Servidor", level: "warn", detail: srv?.keys === false ? "Faltan las llaves de notificaciones (VAPID) en el servidor." : "No se pudo revisar el servidor. Revisa tu internet." });
    } else {
      out.push({ key: "keys", label: "Llaves del servidor", level: srv.keys ? "ok" : "fail", detail: srv.keys ? "Configuradas." : "Faltan las llaves VAPID en Vercel (las agrega el administrador)." });
      out.push({
        key: "saved", label: "Registrado en RemHub", level: srv.subscribed ? "ok" : "fail",
        detail: srv.subscribed ? `Sí${srv.lastDelivered ? ` · último aviso entregado: ${new Date(srv.lastDelivered).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}` : ""}${srv.devices && srv.devices > 1 ? ` · tienes ${srv.devices} equipos registrados` : ""}.` : "RemHub no tiene registrado este equipo (o lo perdió). Toca «Reparar».",
        fix: srv.subscribed || perm === "denied" ? null : "enable",
      });
      out.push({ key: "aud", label: "Tu usuario recibe avisos de pedidos internos", level: srv.audience === false ? "fail" : "ok", detail: srv.audience === false ? "Tu usuario no tiene permiso de pedidos internos o traslados: pídeselo al administrador." : "Sí: pedidos, mensajes, cambios de estado y llamadas de tus puntos." });
      out.push({ key: "store", label: "Avisos al celular activados en la tienda", level: srv.storePush === false ? "fail" : "ok", detail: srv.storePush === false ? "Están apagados en «Tonos de la tienda» → Notificaciones del celular. Actívalos." : "Activados." });
      out.push({
        key: "hook", label: "La base avisa al servidor", level: srv.webhook === "ok" ? "ok" : srv.webhook === "unknown" ? "warn" : "fail",
        detail: srv.webhook === "ok" ? "Sí: cuando pasa algo en un pedido, el servidor envía el aviso." : srv.webhook === "old-domain" ? "Apunta al dominio viejo (remhub.store). Falta ejecutar en Supabase la migración 20261270_avisos_dominio_nuevo.sql." : srv.webhook === "missing" ? "Falta la dirección del aviso. Ejecuta en Supabase la migración 20261270_avisos_dominio_nuevo.sql." : "No se pudo revisar.",
      });
    }
    setChecks(out);
    setBusy(false);
  }, [storeId]);

  async function repair() {
    setBusy(true);
    const r = await enablePush(storeId).catch(() => ({ state: "off" as const, error: "No se pudo." }));
    setBusy(false);
    onChanged?.();
    if (r.error) setTest(`⚠️ ${r.error}`);
    await run();
  }

  async function testClosed(delay: number) {
    setBusy(true);
    setTest(null);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      const res = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ store_id: storeId, delay_seconds: delay }) });
      const j = (await res.json()) as { ok?: boolean; message?: string; scheduled?: number };
      setTest(!j.ok ? `⚠️ ${j.message ?? "No se pudo enviar."}` : delay
        ? `⏳ Listo. Ahora CIERRA el navegador (o sal de la app y bloquea el celular). En ${delay} segundos debe llegar «✅ ¡Funciona con la app cerrada!». Si no llega, revisa la batería y el permiso de notificaciones de Chrome en el celular.`
        : "📨 Enviada: debe aparecer en unos segundos.");
    } catch {
      setTest("⚠️ Sin conexión.");
    }
    setBusy(false);
  }

  const failing = checks?.filter((c) => c.level === "fail") ?? [];
  const canFix = failing.some((c) => c.fix === "enable");
  const allOk = checks && !failing.length;

  return (
    <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 60%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void run()} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : checks ? <RefreshCw size={15} /> : "🔍"} {checks ? "Verificar otra vez" : "Verificar todo"}
        </button>
        {canFix ? (
          <button type="button" disabled={busy} onClick={() => void repair()} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Wrench size={15} /> Reparar</button>
        ) : null}
        {allOk ? (
          <>
            <button type="button" disabled={busy} onClick={() => void testClosed(10)} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">📴 Probar con la app cerrada</button>
            <button type="button" disabled={busy} onClick={() => void testClosed(0)} className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>Probar ahora</button>
          </>
        ) : null}
      </div>
      {checks ? (
        <ul className="mt-3 space-y-1.5">
          {checks.map((c, i) => (
            <motion.li key={c.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex gap-2.5 rounded-xl px-2.5 py-2 text-sm" style={{ background: c.level === "fail" ? "rgba(239,68,68,.08)" : "transparent" }}>
              <span className="shrink-0">{c.level === "ok" ? "✅" : c.level === "warn" ? "⚠️" : "❌"}</span>
              <span className="min-w-0"><b className="block">{c.label}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{c.detail}</span></span>
            </motion.li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Revisa este equipo y el servidor para que los avisos lleguen aunque RemHub o el navegador estén cerrados.</p>
      )}
      {allOk ? <p className="mt-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-500">Todo listo en este equipo. Haz la prueba con la app cerrada para confirmarlo.</p> : null}
      {test ? <p className="mt-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--t-card-bg)" }}>{test}</p> : null}
      {checks && isAndroid() ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>💡 Android: si no llegan con el celular bloqueado, en Ajustes → Apps → Chrome → Batería escoge «Sin restricciones».</p> : null}
      {checks && !isAndroid() && !isIos() ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>💡 Computador: para recibirlas con Chrome cerrado, activa en Chrome → Configuración → Sistema «Seguir ejecutando aplicaciones en segundo plano al cerrar Google Chrome».</p> : null}
    </div>
  );
}
