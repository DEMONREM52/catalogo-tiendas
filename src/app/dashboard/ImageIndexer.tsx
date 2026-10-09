"use client";

import { useEffect } from "react";
import { INDEX_EVENT, runImageIndex } from "@/lib/image-search/indexer";

/**
 * Prepara la búsqueda por foto sin que nadie tenga que hacer nada: en computadores analiza solas las
 * fotos nuevas de los productos (unos segundos después de abrir el panel y cada 20 minutos). En celulares
 * solo cuando se pide (botón «Analizar fotos» o al guardar un producto), para no gastar datos ni batería.
 */
export function ImageIndexer({ storeId }: { storeId: string }) {
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const auto = window.matchMedia("(pointer: fine)").matches && !conn?.saveData;
    const run = () => void runImageIndex(storeId);
    const first = auto ? window.setTimeout(run, 8000) : 0;
    const every = auto ? window.setInterval(run, 20 * 60 * 1000) : 0;
    window.addEventListener(INDEX_EVENT, run);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener(INDEX_EVENT, run);
    };
  }, [storeId]);
  return null;
}
