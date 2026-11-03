"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, ZoomIn, ZoomOut } from "lucide-react";

/**
 * Miniatura que se amplía al tocarla: la foto «vuela» desde su lugar hasta el centro (y vuelve al cerrar).
 * En grande: doble toque / doble clic o la rueda del mouse acercan; con zoom se arrastra para mover;
 * sin zoom, deslizar hacia abajo cierra. También cierra con la X, Escape o tocando el fondo.
 */
export function ZoomableThumb({ src, alt, className, imgClassName, onError }: {
  src: string; alt: string; className?: string; imgClassName?: string; onError?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={`cursor-zoom-in ${className ?? ""}`} aria-label={`Ampliar foto de ${alt}`} title="Ver foto en grande">
        {open ? <span className="block h-full w-full" /> : (
           
          <motion.img layoutId={id} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={onError}
            className={imgClassName} transition={{ type: "spring", stiffness: 320, damping: 32 }} />
        )}
      </button>
      <AnimatePresence>{open ? <ImageViewer layoutId={id} src={src} alt={alt} onClose={() => setOpen(false)} /> : null}</AnimatePresence>
    </>
  );
}

const MAX = 4;

function ImageViewer({ layoutId, src, alt, onClose }: { layoutId: string; src: string; alt: string; onClose: () => void }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [scale, setScale] = useState(1);
  const lastTap = useRef(0);
  const zoomed = scale > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(MAX, s + 0.5));
      if (e.key === "-") setScale((s) => Math.max(1, s - 0.5));
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  if (!mounted) return null;
  const toggleZoom = () => setScale((s) => (s > 1 ? 1 : 2.5));

  return createPortal(
    <motion.div className="fixed inset-0 z-160 flex items-center justify-center p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={alt}
      initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
      <motion.button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-zoom-out bg-black/80 backdrop-blur-md" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} />
      <div className="relative z-10 flex max-h-full max-w-full items-center justify-center"
        onWheel={(e) => setScale((s) => Math.min(MAX, Math.max(1, s - e.deltaY * 0.0025)))}>
        { }
        <motion.img
          layoutId={layoutId}
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          draggable={false}
          className={`max-h-[82dvh] max-w-[92vw] touch-none select-none rounded-3xl object-contain shadow-2xl sm:max-w-[80vw] ${zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
          style={{ background: "rgba(255,255,255,0.04)" }}
          animate={{ scale }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          drag={zoomed ? true : "y"}
          dragConstraints={zoomed ? { left: -400 * scale, right: 400 * scale, top: -400 * scale, bottom: 400 * scale } : { top: 0, bottom: 0 }}
          dragElastic={zoomed ? 0.15 : 0.6}
          dragMomentum={zoomed}
          onDragEnd={(_, info) => { if (!zoomed && Math.abs(info.offset.y) > 110) onClose(); }}
          onDoubleClick={toggleZoom}
          onPointerUp={(e) => {
            if (e.pointerType !== "touch") return;
            const now = Date.now();
            if (now - lastTap.current < 300) { toggleZoom(); lastTap.current = 0; } else lastTap.current = now;
          }}
        />
      </div>
      <motion.div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-2 p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
        <p className="line-clamp-1 max-w-[60vw] rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">{alt}</p>
        <button type="button" onClick={() => setScale((s) => Math.max(1, s - 0.75))} disabled={!zoomed} className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur disabled:opacity-40" aria-label="Alejar"><ZoomOut size={17} /></button>
        <button type="button" onClick={() => setScale((s) => Math.min(MAX, s + 0.75))} disabled={scale >= MAX} className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur disabled:opacity-40" aria-label="Acercar"><ZoomIn size={17} /></button>
      </motion.div>
      <motion.button type="button" onClick={onClose} aria-label="Cerrar foto" className="absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur"
        style={{ marginTop: "env(safe-area-inset-top)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <X size={20} />
      </motion.button>
      <p className="pointer-events-none absolute left-1/2 top-4 z-20 hidden -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[11px] text-white/80 sm:block">Doble clic o rueda para acercar · Esc para cerrar</p>
    </motion.div>,
    document.body,
  );
}
