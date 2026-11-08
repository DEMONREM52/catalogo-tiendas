"use client";

import { motion } from "framer-motion";

/**
 * Línea fina debajo de un buscador que se llena mientras espera para buscar (el temporizador de
 * src/lib/search-timing.ts). Si sigues escribiendo vuelve a empezar; al llenarse, busca.
 * Va dentro de un contenedor con `relative`.
 */
export function SearchTimer({ pending, delay, term }: { pending: boolean; delay: number; term: string }) {
  if (!pending || delay <= 0) return null;
  return (
    <span className="pointer-events-none absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full" aria-hidden="true">
      <motion.span
        key={term}
        className="block h-full rounded-full"
        style={{ background: "linear-gradient(90deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}
        initial={{ width: "0%" }}
        animate={{ width: "100%" }}
        transition={{ duration: delay / 1000, ease: "linear" }}
      />
    </span>
  );
}
