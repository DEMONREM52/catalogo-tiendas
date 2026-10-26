"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Database, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { checkConnection, setSimulatedOffline, useNetStatus } from "@/lib/net/status";

type Mode = "offline" | "db_down" | "db_slow" | "back" | "practice";

/**
 * Aviso de conexión: fijo mientras no hay internet o la base no responde, y un «De nuevo en línea» breve al volver.
 * «Sin internet» y «La base de datos no responde» se avisan distinto: en el segundo el problema no es del cliente.
 */
export function ConnectionBanner() {
  const net = useNetStatus();
  const inPanel = usePathname()?.startsWith("/dashboard") ?? false;
  const [back, setBack] = useState<number | null>(null);
  const [wasBad, setWasBad] = useState(false);

  const bad = !net.online || net.db === "down";
  // Patrón de React para derivar estado del cambio de conexión sin efectos.
  if (bad && !wasBad) setWasBad(true);
  if (!bad && wasBad) {
    setWasBad(false);
    setBack(Math.max(net.since, net.dbSince));
  }

  useEffect(() => {
    if (back === null) return;
    const t = window.setTimeout(() => setBack(null), 3500);
    return () => window.clearTimeout(t);
  }, [back]);

  // «Lenta» solo se muestra dentro del panel y si ya lleva un rato así (evita parpadeos por un pico).
  const [slowKey, setSlowKey] = useState<number | null>(null);
  useEffect(() => {
    if (net.db !== "slow") return;
    const since = net.dbSince;
    const t = window.setTimeout(() => setSlowKey(since), 4000);
    return () => window.clearTimeout(t);
  }, [net.db, net.dbSince]);
  const slowLong = net.db === "slow" && slowKey === net.dbSince;

  const mode: Mode | null = net.simulated ? "practice" : !net.online ? "offline" : net.db === "down" ? "db_down" : back !== null ? "back" : net.db === "slow" && slowLong && inPanel ? "db_slow" : null;

  const tone = mode === "back" ? "#22c55e" : mode === "db_down" ? "#ef4444" : mode === "practice" ? "#8b5cf6" : "#f59e0b";
  return (
    <AnimatePresence>
      {mode ? (
        <motion.div
          key={mode}
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -30, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[175] flex justify-center px-3"
          role="status"
          aria-live="polite"
        >
          <div
            className="pointer-events-auto flex max-w-[min(34rem,100%)] items-center gap-2.5 rounded-2xl border px-3.5 py-2 text-xs font-semibold shadow-[0_12px_36px_rgba(0,0,0,.35)] backdrop-blur-xl sm:rounded-full sm:text-sm"
            style={{ borderColor: `color-mix(in oklab, ${tone} 55%, transparent)`, background: `color-mix(in oklab, ${tone} 16%, var(--t-bg-base, #0b0b0b))`, color: "var(--t-text, #fff)" }}
          >
            {mode === "back" ? <Wifi size={16} className="shrink-0" style={{ color: tone }} /> : mode === "offline" ? <WifiOff size={16} className="shrink-0" style={{ color: tone }} /> : <Database size={16} className="shrink-0" style={{ color: tone }} />}
            <span className="min-w-0">
              {mode === "practice" ? (
                <>
                  <b>🎓 Práctica: sin internet simulado.</b> <span className="opacity-80">Las ventas de práctica no se registran.</span>{" "}
                  <button type="button" onClick={() => setSimulatedOffline(false)} className="font-bold underline">Terminar</button>
                </>
              ) : mode === "back" ? (
                <b>De nuevo en línea ✓</b>
              ) : mode === "offline" ? (
                <>
                  <b>Sin internet.</b>{" "}
                  <span className="opacity-80">{inPanel ? "Puedes seguir vendiendo en el POS: las ventas quedan como borrador y se envían al volver." : "Lo que ya cargó sigue visible; revisa tu conexión."}</span>
                </>
              ) : mode === "db_down" ? (
                <>
                  <b>La base de datos no responde.</b>{" "}
                  <span className="opacity-80">{inPanel ? "Tu internet está bien; es un problema del servidor. Sigue vendiendo en el POS: se guarda como borrador y se envía solo cuando vuelva." : "Tu internet está bien; es un problema del servidor. Intenta de nuevo en unos minutos."}</span>
                </>
              ) : (
                <>
                  <b>La base de datos está lenta.</b> <span className="opacity-80">Puede tardar en cargar o guardar; no cierres la página.</span>
                </>
              )}
            </span>
            {mode !== "back" && mode !== "practice" ? (
              <button type="button" onClick={() => void checkConnection()} className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15" aria-label="Revisar conexión" title="Revisar conexión">
                <RefreshCw size={13} className={net.checking ? "animate-spin" : ""} />
              </button>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
