"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, ExternalLink, Loader2, MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { detectPlatform, getPwaServerState, getPwaState, promptInstall, subscribePwa, type PlatformInfo } from "@/lib/pwa/client";

export type InstallIdentity = {
  /** «RemHub» o el nombre del catálogo. */
  name: string;
  /** Icono que verá el usuario (el de RemHub o el del catálogo). */
  iconUrl: string;
  kind: "remhub" | "catalog";
};

export function usePwa() {
  return useSyncExternalStore(subscribePwa, getPwaState, getPwaServerState);
}

function Step({ n, children, icon }: { n: number; children: ReactNode; icon?: ReactNode }) {
  return (
    <motion.li initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 * n }} className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>{n}</span>
      <span className="pt-0.5 text-sm leading-6">
        {children}
        {icon ? <span className="ml-1.5 inline-flex translate-y-0.5 items-center rounded-md border px-1 py-0.5" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.2))" }}>{icon}</span> : null}
      </span>
    </motion.li>
  );
}

function Instructions({ p, kind }: { p: PlatformInfo; kind: InstallIdentity["kind"] }) {
  const what = kind === "remhub" ? "RemHub" : "el catálogo";
  if (p.inApp) {
    return (
      <ol className="space-y-3">
        <Step n={1}>Estás dentro de <b>{p.inApp}</b>, que no permite instalar aplicaciones.</Step>
        <Step n={2} icon={<MoreVertical size={13} />}>Toca el menú de {p.inApp} y elige <b>«Abrir en el navegador»</b> {p.os === "ios" ? "(Safari)" : "(Chrome)"}.</Step>
        <Step n={3}>Ahí vuelve a tocar <b>«Instalar»</b>. También puedes copiar el enlace y pegarlo en el navegador.</Step>
      </ol>
    );
  }
  if (p.os === "ios") {
    return (
      <ol className="space-y-3">
        {p.browser !== "safari" ? (
          <Step n={0 + 1}>
            En iPhone funciona mejor desde <b>Safari</b>. En {p.browser === "chrome" ? "Chrome" : p.browser === "edge" ? "Edge" : "este navegador"} (iOS 16.4 o superior) también puedes usar su botón Compartir.
          </Step>
        ) : null}
        <Step n={p.browser !== "safari" ? 2 : 1} icon={<Share size={13} />}>Toca el botón <b>Compartir</b> (abajo en iPhone, arriba en iPad).</Step>
        <Step n={p.browser !== "safari" ? 3 : 2} icon={<PlusSquare size={13} />}>Desliza y toca <b>«Agregar a pantalla de inicio»</b> (o «Añadir a pantalla de inicio»).</Step>
        <Step n={p.browser !== "safari" ? 4 : 3}>Toca <b>«Agregar»</b> y abre {what} desde el nuevo icono.</Step>
      </ol>
    );
  }
  if (p.os === "android") {
    return (
      <ol className="space-y-3">
        {p.browser === "samsung" ? (
          <>
            <Step n={1}>Toca el menú <b>≡</b> de Samsung Internet.</Step>
            <Step n={2}>Elige <b>«Agregar página a»</b> → <b>«Pantalla de inicio»</b>.</Step>
          </>
        ) : p.browser === "firefox" ? (
          <>
            <Step n={1} icon={<MoreVertical size={13} />}>Toca el menú de Firefox.</Step>
            <Step n={2}>Elige <b>«Instalar»</b> o «Agregar a pantalla de inicio».</Step>
          </>
        ) : (
          <>
            <Step n={1} icon={<MoreVertical size={13} />}>Toca el menú <b>⋮</b> del navegador (arriba a la derecha).</Step>
            <Step n={2}>Elige <b>«Instalar aplicación»</b> o <b>«Agregar a la pantalla principal»</b>.</Step>
          </>
        )}
        <Step n={3}>Confirma y abre {what} desde el nuevo icono.</Step>
      </ol>
    );
  }
  // Computador
  if (p.browser === "safari") {
    return (
      <ol className="space-y-3">
        <Step n={1}>En Safari (macOS 14 o superior) abre el menú <b>Archivo</b>.</Step>
        <Step n={2}>Elige <b>«Agregar al Dock»</b> y confirma.</Step>
      </ol>
    );
  }
  if (p.browser === "firefox" || p.browser === "other") {
    return (
      <ol className="space-y-3">
        <Step n={1}>Este navegador no permite instalar aplicaciones web.</Step>
        <Step n={2}>Ábrelo en <b>Chrome</b> o <b>Edge</b> para instalarlo, o guárdalo en tus marcadores.</Step>
      </ol>
    );
  }
  return (
    <ol className="space-y-3">
      <Step n={1}>Busca el icono de <b>instalar</b> en la barra de direcciones (a la derecha).</Step>
      <Step n={2} icon={<MoreVertical size={13} />}>O abre el menú <b>⋮</b> → <b>«Transmitir, guardar y compartir»</b> → <b>«Instalar página como aplicación»</b>.</Step>
    </ol>
  );
}

/** Ventana para instalar RemHub o un catálogo: usa el diálogo nativo si existe; si no, explica los pasos. */
export function InstallSheet({ open, onClose, identity }: { open: boolean; onClose: () => void; identity: InstallIdentity }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return createPortal(<AnimatePresence>{open ? <Sheet key="install" onClose={onClose} identity={identity} /> : null}</AnimatePresence>, document.body);
}

function Sheet({ onClose, identity }: { onClose: () => void; identity: InstallIdentity }) {
  const pwa = usePwa();
  const platform = useMemo(() => detectPlatform(), []);
  const [phase, setPhase] = useState<"idle" | "prompting" | "accepted" | "dismissed">("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function install() {
    setPhase("prompting");
    const r = await promptInstall();
    setPhase(r === "accepted" ? "accepted" : r === "dismissed" ? "dismissed" : "idle");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copia el enlace:", window.location.href);
    }
  }

  const done = pwa.standalone || pwa.installedNow;
  const accent = "linear-gradient(135deg,#8b5cf6,#ec4899)";

  return (
    <motion.div className="fixed inset-0 z-[160] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]" onClick={onClose} />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={`Instalar ${identity.name}`}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border shadow-[0_30px_90px_rgba(0,0,0,0.5)] sm:max-w-md sm:rounded-[28px]"
        style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.14))", background: "var(--t-bg-base, #0b0b0b)", color: "var(--t-text, #fff)" }}
        initial={{ y: 60, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl" style={{ background: "rgba(168,85,247,.28)" }} />
        <span className="mx-auto mt-2 h-1.5 w-11 shrink-0 rounded-full sm:hidden" style={{ background: "rgba(128,128,128,.35)" }} aria-hidden />
        <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.2))" }} aria-label="Cerrar">
          <X size={16} />
        </button>

        <div className="relative overflow-y-auto px-6 pb-6 pt-5 sm:pt-7">
          <div className="flex flex-col items-center text-center">
            <motion.div initial={{ scale: 0.85, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={identity.iconUrl} alt="" width={92} height={92} className="h-[92px] w-[92px] rounded-[26px] bg-white object-cover shadow-[0_18px_50px_rgba(139,92,246,.45)]" />
              {done ? (
                <span className="absolute -bottom-1.5 -right-1.5 grid h-8 w-8 place-items-center rounded-full border-4 text-white" style={{ background: "#16a34a", borderColor: "var(--t-bg-base, #0b0b0b)" }}><Check size={15} /></span>
              ) : null}
            </motion.div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "#a78bfa" }}>{identity.kind === "remhub" ? "Aplicación" : "Catálogo"}</p>
            <h2 className="mt-1 text-2xl font-black">{done ? `${identity.name} ya está instalada` : `Instala ${identity.name}`}</h2>
            <p className="mt-1.5 max-w-xs text-sm leading-6" style={{ color: "var(--t-muted, rgba(255,255,255,.7))" }}>
              {done
                ? "Ábrela desde el icono de tu pantalla de inicio cuando quieras."
                : identity.kind === "remhub"
                  ? "Ábrela con un toque desde tu pantalla de inicio, a pantalla completa, como una app."
                  : "Ten el catálogo a un toque en tu pantalla de inicio, sin buscar el enlace."}
            </p>
          </div>

          {!done ? (
            <div className="mt-6">
              {pwa.canPrompt && !platform.inApp ? (
                <button
                  type="button"
                  onClick={() => void install()}
                  disabled={phase === "prompting"}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-base font-black text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-60"
                  style={{ background: accent }}
                >
                  {phase === "prompting" ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  Instalar {identity.kind === "remhub" ? "RemHub" : "catálogo"}
                </button>
              ) : (
                <div className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.14))", background: "rgba(128,128,128,.06)" }}>
                  <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted, rgba(255,255,255,.7))" }}>
                    <Smartphone size={14} /> Así se instala en tu {platform.os === "desktop" ? "computador" : platform.os === "ios" ? "iPhone / iPad" : "Android"}
                  </p>
                  <Instructions p={platform} kind={identity.kind} />
                </div>
              )}

              <AnimatePresence>
                {phase === "accepted" ? (
                  <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-xl px-3 py-2 text-center text-sm font-semibold" style={{ background: "rgba(22,163,74,.12)", color: "#22c55e" }}>
                    Instalación aceptada: el icono aparecerá en tu pantalla de inicio en unos segundos.
                  </motion.p>
                ) : phase === "dismissed" ? (
                  <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 text-center text-xs" style={{ color: "var(--t-muted, rgba(255,255,255,.7))" }}>
                    No se instaló. Puedes hacerlo cuando quieras desde el menú del navegador.
                  </motion.p>
                ) : null}
              </AnimatePresence>

              {platform.inApp || platform.os === "ios" ? (
                <button type="button" onClick={() => void copyLink()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.2))" }}>
                  {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Enlace copiado" : "Copiar enlace"}
                </button>
              ) : null}
            </div>
          ) : null}

          <button type="button" onClick={onClose} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl px-4 py-3 text-sm font-semibold opacity-75 transition hover:opacity-100">
            {done ? "Listo" : <>Seguir en la web <ExternalLink size={14} /></>}
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
