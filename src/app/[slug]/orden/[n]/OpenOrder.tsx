"use client";

import { useEffect } from "react";

/** Lleva al panel de Pedidos buscando ese número (si no hay sesión, el panel pide entrar). */
export function OpenOrder({ receipt }: { receipt: string }) {
  const href = `/dashboard/pedidos${receipt ? `?pedido=${receipt}` : ""}`;
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>
      <div>
        <p className="text-4xl">🛍️</p>
        <p className="mt-2 font-semibold">Abriendo el pedido{receipt ? ` #${receipt}` : ""}…</p>
        <a href={href} className="mt-3 inline-block underline">Si no se abre, toca aquí</a>
      </div>
    </main>
  );
}
