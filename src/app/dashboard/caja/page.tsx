"use client";

import { useEffect, useState } from "react";
import { getDashboardStore } from "@/lib/store-utils";
import { CashRegister } from "./CashRegister";

/** Caja por punto: apertura, entradas y salidas, cierre con conteo y revisión de diferencias. */
export default function CajaPage() {
  const [storeId, setStoreId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void getDashboardStore().then((a) => setStoreId(a.store?.id ?? null)).catch(() => setStoreId(null));
  }, []);
  if (storeId === undefined) return <main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</main>;
  if (!storeId) return <main className="p-6 text-sm">No tienes acceso a ninguna tienda.</main>;
  return (
    <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6">
      <CashRegister storeId={storeId} />
    </main>
  );
}
