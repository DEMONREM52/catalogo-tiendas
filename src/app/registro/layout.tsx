import type { Metadata } from "next";

// Página propia en Google (sin esto heredaba la canónica del inicio y Google la tomaba como copia).
export const metadata: Metadata = {
  title: "Crea tu tienda gratis — RemHub",
  description: "Crea gratis tu tienda en RemHub: catálogo con 5 listas de precios, pedidos por WhatsApp, POS, inventario por punto y factura electrónica.",
  alternates: { canonical: "https://remhub.co/registro" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
