"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m as motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronsUp } from "lucide-react";

/**
 * Botones flotantes para moverse rápido por una lista larga:
 *  ⤒ al inicio · ↑ subir una pantalla · ↓ bajar una pantalla.
 * Van fuera del contenedor de la página (portal) para que queden fijos a la pantalla.
 * `bottomOffset` sube los botones si hay otra barra abajo (p. ej. «para pedir»).
 */
export function ScrollButtons({ bottomOffset = 20 }: { bottomOffset?: number }) {
  const [pos, setPos] = useState({ top: true, bottom: false, long: false });
  useEffect(() => {
    const read = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setPos({ top: window.scrollY < 150, bottom: window.scrollY > max - 150, long: max > window.innerHeight * 0.8 });
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    const t = window.setInterval(read, 1500); // la lista crece al cargar más
    return () => { window.removeEventListener("scroll", read); window.removeEventListener("resize", read); window.clearInterval(t); };
  }, []);

  if (typeof document === "undefined") return null;
  const page = () => Math.round(window.innerHeight * 0.85);
  const btn = "grid h-11 w-11 place-items-center rounded-full text-white shadow-xl transition active:scale-90";
  const bg = { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" };
  return createPortal(
    <AnimatePresence>
      {pos.long ? (
        <motion.div key="scroll-btns" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
          className="fixed right-3 z-[59] flex flex-col gap-2" style={{ bottom: bottomOffset }}>
          <AnimatePresence>
            {!pos.top ? (
              <motion.button key="home" type="button" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className={btn} style={{ ...bg, opacity: 0.9 }} aria-label="Ir al inicio" title="Ir al inicio">
                <ChevronsUp size={20} />
              </motion.button>
            ) : null}
            {!pos.top ? (
              <motion.button key="up" type="button" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} onClick={() => window.scrollBy({ top: -page(), behavior: "smooth" })}
                className={btn} style={bg} aria-label="Subir" title="Subir una pantalla">
                <ArrowUp size={20} />
              </motion.button>
            ) : null}
            {!pos.bottom ? (
              <motion.button key="down" type="button" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} onClick={() => window.scrollBy({ top: page(), behavior: "smooth" })}
                className={btn} style={bg} aria-label="Bajar" title="Bajar una pantalla">
                <ArrowDown size={20} />
              </motion.button>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
