import type { Metadata } from "next";

// Enlace de un conteo en grupo con contraseña: no se indexa y la vista previa no dice nada de la tienda.
export const metadata: Metadata = {
  title: "Conteo en grupo - RemHub",
  description: "Entra con tu nombre y la contraseña que te dieron para anotar lo que cuentes.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
