"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Apple, Check, Download, Monitor, MoreVertical, PlusSquare, QrCode, Share, Smartphone } from "lucide-react";
import { InstallSheet, usePwa } from "@/components/pwa/InstallSheet";
import { REMHUB_INSTALL } from "@/components/pwa/InstallButton";
import { QrDialog } from "@/components/pwa/QrDialog";
import { getPlatformServerSnapshot, getPlatformSnapshot, subscribeNoop } from "@/lib/pwa/client";

type Feature = { icon: string; title: string; text: string };
type Tab = "android" | "ios" | "desktop";

const STEPS: Record<Tab, Array<{ text: React.ReactNode; icon?: React.ReactNode }>> = {
  android: [
    { text: <>Abre <b>remhub.store/instalar</b> en <b>Chrome</b> (o Edge / Samsung Internet).</> },
    { text: <>Toca <b>«Instalar RemHub»</b> y confirma en la ventana del teléfono.</> },
    { text: <>Si no aparece, abre el menú <b>⋮</b> y elige <b>«Instalar aplicación»</b> o «Agregar a la pantalla principal».</>, icon: <MoreVertical size={13} /> },
    { text: <>Abre RemHub desde el icono e ingresa con tu usuario de siempre.</> },
  ],
  ios: [
    { text: <>Abre <b>remhub.store/instalar</b> en <b>Safari</b>.</> },
    { text: <>Toca el botón <b>Compartir</b> (abajo en iPhone, arriba en iPad).</>, icon: <Share size={13} /> },
    { text: <>Elige <b>«Agregar a pantalla de inicio»</b> y toca <b>«Agregar»</b>.</>, icon: <PlusSquare size={13} /> },
    { text: <>Abre RemHub desde el icono e ingresa con tu usuario de siempre.</> },
  ],
  desktop: [
    { text: <>Abre <b>remhub.store/instalar</b> en <b>Chrome</b> o <b>Edge</b>.</> },
    { text: <>Haz clic en <b>«Instalar RemHub»</b> o en el icono de instalar de la barra de direcciones.</> },
    { text: <>En Safari para Mac: menú <b>Archivo → «Agregar al Dock»</b>.</> },
    { text: <>RemHub queda como una app en tu escritorio o Dock.</> },
  ],
};

export function InstallPageClient({ features }: { features: Feature[] }) {
  const pwa = usePwa();
  const platform = useSyncExternalStore(subscribeNoop, getPlatformSnapshot, getPlatformServerSnapshot);
  const [picked, setTab] = useState<Tab | null>(null);
  // Pestaña según el equipo, hasta que la persona elija otra.
  const tab: Tab = picked ?? (platform.os === "ios" ? "ios" : platform.os === "android" ? "android" : "desktop");
  const [sheet, setSheet] = useState(false);
  const [qr, setQr] = useState(false);
  const installed = pwa.standalone || pwa.installedNow;

  return (
    <>
      <section className="mt-10 grid items-center gap-10 lg:mt-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="text-center lg:text-left">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 16 }} className="mx-auto w-fit lg:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/remhub-512.png" alt="Logo de RemHub" width={128} height={128} className="h-28 w-28 drop-shadow-[0_20px_60px_rgba(168,85,247,.55)] sm:h-32 sm:w-32" />
          </motion.div>
          <motion.h1 initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.08 }} className="mt-6 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
            RemHub en tu celular
          </motion.h1>
          <motion.p initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.14 }} className="mx-auto mt-4 max-w-lg text-base leading-7 text-white/75 lg:mx-0">
            Ábrelo con un toque desde tu pantalla de inicio, a pantalla completa, con tu mismo usuario y tus mismos permisos. Sin descargar nada de una tienda de apps.
          </motion.p>

          <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            {installed ? (
              <span className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500/15 px-5 py-4 font-bold text-emerald-300">
                <Check size={18} /> Ya tienes RemHub instalada
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setSheet(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-7 py-4 text-base font-black shadow-[0_18px_50px_rgba(168,85,247,.45)] transition hover:-translate-y-0.5 sm:w-auto"
              >
                <Download size={19} /> Instalar RemHub
              </button>
            )}
            <Link href="/login" className="inline-flex w-full items-center justify-center rounded-2xl border border-white/20 px-6 py-4 text-sm font-bold text-white/90 transition hover:bg-white/10 sm:w-auto">
              Seguir en la web
            </Link>
          </motion.div>
          {platform.inApp ? (
            <p className="mx-auto mt-4 max-w-md rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200 lg:mx-0">
              Estás dentro de {platform.inApp}. Para instalar, ábrelo en {platform.os === "ios" ? "Safari" : "Chrome"} desde el menú «Abrir en el navegador».
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {features.map((f, i) => (
            <motion.div key={f.title} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 + i * 0.06 }} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
              <span className="text-2xl">{f.icon}</span>
              <p className="mt-3 font-bold">{f.title}</p>
              <p className="mt-1 text-sm leading-6 text-white/65">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mt-14 grid gap-5 lg:grid-cols-[1fr_auto]">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-7">
          <h2 className="text-xl font-black">Cómo instalarlo</h2>
          <div className="mt-4 inline-grid grid-cols-3 gap-1 rounded-2xl border border-white/10 p-1">
            {([["android", "Android", <Smartphone key="a" size={15} />], ["ios", "iPhone", <Apple key="i" size={15} />], ["desktop", "Computador", <Monitor key="d" size={15} />]] as const).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${tab === value ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white" : "text-white/70 hover:text-white"}`}
              >
                {icon} {label}
              </button>
            ))}
          </div>
          <ol className="mt-5 space-y-3">
            {STEPS[tab].map((s, i) => (
              <motion.li key={`${tab}-${i}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-black">{i + 1}</span>
                <span className="pt-0.5 text-sm leading-6 text-white/85">
                  {s.text}
                  {s.icon ? <span className="ml-1.5 inline-flex translate-y-0.5 items-center rounded-md border border-white/20 px-1 py-0.5">{s.icon}</span> : null}
                </span>
              </motion.li>
            ))}
          </ol>
          <p className="mt-5 text-xs leading-5 text-white/50">
            La app usa el mismo usuario, contraseña y permisos de la web. Necesita internet para mostrar tus datos actualizados.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.04] p-6 text-center backdrop-blur lg:w-72">
          <p className="text-sm font-bold">¿Estás en el computador?</p>
          <p className="mt-1 text-xs text-white/60">Escanea con tu celular para abrir esta página.</p>
          <div className="mt-4 rounded-3xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/api/qr?path=%2Finstalar&format=png&size=480" alt="QR de remhub.store/instalar" width={180} height={180} className="h-44 w-44" />
          </div>
          <button type="button" onClick={() => setQr(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-xs font-bold transition hover:bg-white/10">
            <QrCode size={14} /> Descargar o compartir QR
          </button>
        </div>
      </section>

      <InstallSheet open={sheet} onClose={() => setSheet(false)} identity={REMHUB_INSTALL} />
      <QrDialog open={qr} onClose={() => setQr(false)} path="/instalar" title="Instala RemHub" subtitle="remhub.store/instalar" />
    </>
  );
}
