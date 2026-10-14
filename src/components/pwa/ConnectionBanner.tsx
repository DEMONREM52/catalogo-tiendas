"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { checkConnection, useNetStatus } from "@/lib/net/status";

/** Aviso de conexión: fijo mientras no hay internet y un «De nuevo en línea» breve al volver. */
export function ConnectionBanner() {
  const net = useNetStatus();
  const inPanel = usePathname()?.startsWith("/dashboard") ?? false;
  const [back, setBack] = useState<number | null>(null);
  const [wasOffline, setWasOffline] = useState(false);

  // Patrón de React para derivar estado del cambio de conexión sin efectos.
  if (!net.online && !wasOffline) setWasOffline(true);
  if (net.online && wasOffline) {
    setWasOffline(false);
    setBack(net.since);
  }

  useEffect(() => {
    if (back === null) return;
    const t = window.setTimeout(() => setBack(null), 3500);
    return () => window.clearTimeout(t);
  }, [back]);

  const show = !net.online || back !== null;
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key={net.online ? "on" : "off"}
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -30, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[175] flex justify-center px-3"
          role="status"
          aria-live="polite"
        >
          <div
            className="pointer-events-auto flex max-w-[min(32rem,100%)] items-center gap-2.5 rounded-full border px-3.5 py-2 text-xs font-semibold shadow-[0_12px_36px_rgba(0,0,0,.35)] backdrop-blur-xl sm:text-sm"
            style={
              net.online
                ? { borderColor: "rgba(34,197,94,.5)", background: "color-mix(in oklab, #22c55e 18%, var(--t-bg-base, #0b0b0b))", color: "var(--t-text, #fff)" }
                : { borderColor: "rgba(245,158,11,.55)", background: "color-mix(in oklab, #f59e0b 16%, var(--t-bg-base, #0b0b0b))", color: "var(--t-text, #fff)" }
            }
          >
            {net.online ? <Wifi size={16} className="shrink-0 text-emerald-400" /> : <WifiOff size={16} className="shrink-0 text-amber-400" />}
            <span className="min-w-0">
              {net.online ? (
                <b>De nuevo en línea ✓</b>
              ) : (
                <>
                  <b>Sin internet.</b>{" "}
                  <span className="opacity-80">{inPanel ? "Las ventas del POS se guardan como borrador y se envían al volver." : "Lo que ya cargó sigue visible; revisa tu conexión."}</span>
                </>
              )}
            </span>
            {!net.online ? (
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
