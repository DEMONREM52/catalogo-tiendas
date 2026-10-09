import type { Metadata } from "next";
import Link from "next/link";
import { InstallPageClient } from "./InstallPageClient";

export const metadata: Metadata = {
  title: "Instala RemHub en tu celular",
  description: "Instala RemHub en Android, iPhone o tu computador y ábrelo con un toque, a pantalla completa, con tu mismo usuario.",
  alternates: { canonical: "https://remhub.store/instalar" },
  openGraph: {
    title: "Instala RemHub en tu celular",
    description: "Ventas, pedidos, inventario y catálogos de tu tienda a un toque.",
    url: "https://remhub.store/instalar",
    images: [{ url: "/og-image.png", width: 1200, height: 1200, type: "image/png", alt: "RemHub" }],
  },
};

const FEATURES = [
  { icon: "💳", title: "Vende desde el celular", text: "POS, facturas y remisiones con los mismos permisos de tu usuario." },
  { icon: "🧾", title: "Pedidos al instante", text: "Pedidos de catálogo e internos entre puntos, con avisos." },
  { icon: "📦", title: "Inventario a mano", text: "Existencias por punto, búsqueda por código o con foto." },
  { icon: "🛍️", title: "Tus catálogos", text: "Compártelos con enlace o QR y tus clientes también pueden instalarlos." },
];

export default function InstallPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0b0716] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-white sm:px-6">
      <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-violet-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -left-40 h-[520px] w-[520px] rounded-full bg-fuchsia-600/20 blur-3xl" />

      <div className="relative mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/remhub-192.png" alt="RemHub" width={40} height={40} className="h-10 w-10 rounded-xl" />
            <span className="text-lg font-black tracking-tight">RemHub</span>
          </Link>
          <Link href="/login" className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10">
            Ir a la web
          </Link>
        </header>

        <InstallPageClient features={FEATURES} />
      </div>
    </main>
  );
}
