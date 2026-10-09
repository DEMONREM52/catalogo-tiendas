import type { Metadata } from "next";
import { OfflineRetry } from "./OfflineRetry";

export const metadata: Metadata = { title: "Sin conexión", robots: { index: false, follow: false } };

/** Se muestra cuando la app está instalada y no hay internet. No contiene datos de ninguna tienda. */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#0b0b0b] px-6 text-center text-white">
      <div className="max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/remhub-192.png" alt="RemHub" width={88} height={88} className="mx-auto rounded-3xl" />
        <h1 className="mt-6 text-2xl font-black">Sin conexión a internet</h1>
        <p className="mt-2 text-sm leading-6 text-white/70">
          RemHub necesita internet para mostrar tus ventas, pedidos e inventario actualizados. Revisa tu conexión y vuelve a intentarlo.
        </p>
        <OfflineRetry />
      </div>
    </main>
  );
}
