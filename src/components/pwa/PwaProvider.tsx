"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, X } from "lucide-react";
import { applyUpdate, startPwa } from "@/lib/pwa/client";
import { usePwa } from "./InstallSheet";

/** Registra el Service Worker y avisa (sin interrumpir) cuando hay una versión nueva de RemHub. */
export function PwaProvider() {
  const pwa = usePwa();
  const [hidden, setHidden] = useState(false);
  useEffect(() => startPwa(), []);

  return (
    <AnimatePresence>
      {pwa.updateReady && !hidden ? (
        <motion.div
          key="sw-update"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[170] mx-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_50px_rgba(0,0,0,.4)]"
          style={{ borderColor: "rgba(168,85,247,.45)", background: "var(--t-bg-base, #0b0b0b)", color: "var(--t-text, #fff)" }}
          role="status"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
            <RefreshCw size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block">Nueva versión de RemHub</b>
            <span className="text-xs opacity-75">Actualiza cuando termines lo que estás haciendo.</span>
          </span>
          <button type="button" onClick={() => applyUpdate()} className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
            Actualizar
          </button>
          <button type="button" onClick={() => setHidden(true)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100" aria-label="Más tarde">
            <X size={14} />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
