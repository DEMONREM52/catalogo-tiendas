"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { srError } from "./types";

export type QtyLine = { item_id: string; qty: number };
export type SaveState = "idle" | "saving" | "saved" | "error" | "missing";

/** ¿Falta correr la migración 20261346 (la función no existe)? */
export const qtyFnMissing = (msg: string) => /Could not find the function|schema cache|does not exist/i.test(msg) && /erp_sr_qty_set/.test(msg);

/** Guarda en la base lo que se va a enviar (uno o varios productos, de uno o varios pedidos; todo o nada). */
export async function saveQtys(lines: QtyLine[]): Promise<{ ok: true } | { ok: false; error: string; missing: boolean }> {
  if (!lines.length) return { ok: true };
  const { error } = await supabaseBrowser().rpc("erp_sr_qty_set", { p_items: lines });
  if (!error) return { ok: true };
  return { ok: false, error: srError(error), missing: qtyFnMissing(error.message ?? "") };
}

/**
 * Cantidades que se guardan solas mientras se escriben (700 ms después de la última tecla, o al salir del cuadro).
 * Así no se pierden al recargar, al salir del pedido ni al «Preparar», y los demás las ven en vivo.
 * `onSaved` recibe lo que quedó guardado (para soltar lo que ya está en la base).
 */
export function useQtyAutosave(onSaved: (saved: Record<string, number>) => void | Promise<void>) {
  const pending = useRef(new Map<string, number>());
  const timer = useRef<number | undefined>(undefined);
  const running = useRef<Promise<boolean> | null>(null);
  const savedCb = useRef(onSaved);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { savedCb.current = onSaved; }, [onSaved]);

  /** Guarda ya lo que esté pendiente. Devuelve false si no se pudo. */
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (running.current) await running.current;
    if (!pending.current.size) return true;
    const batch = Object.fromEntries(pending.current);
    pending.current.clear();
    setState("saving");
    const job = (async () => {
      const res = await saveQtys(Object.entries(batch).map(([item_id, qty]) => ({ item_id, qty })));
      if (!res.ok) {
        // Lo que no se guardó vuelve a quedar pendiente (salvo que se haya escrito algo más nuevo).
        for (const [k, v] of Object.entries(batch)) if (!pending.current.has(k)) pending.current.set(k, v);
        setState(res.missing ? "missing" : "error");
        setError(res.error);
        return false;
      }
      setState("saved");
      setError(null);
      await savedCb.current(batch);
      return true;
    })();
    running.current = job;
    try { return await job; } finally { running.current = null; }
  }, []);

  const queue = useCallback((itemId: string, qty: number) => {
    pending.current.set(itemId, qty);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  }, [flush]);

  // Al cerrar el pedido se guarda lo que quedó escrito.
  useEffect(() => () => { window.clearTimeout(timer.current); if (pending.current.size) void flush(); }, [flush]);

  return { queue, flush, state, error, hasPending: () => pending.current.size > 0 };
}
