import type { Metadata } from "next";
// Páginas de cuenta: no van en Google.
export const metadata: Metadata = { title: "Restablecer contraseña - RemHub", robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
