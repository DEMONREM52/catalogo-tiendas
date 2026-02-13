import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "RemHub — Catálogos online",
    template: "%s — RemHub",
  },
  description: "Crea y comparte catálogos online de tu tienda. Pedidos por WhatsApp y más.",
  metadataBase: new URL("https://remhub.store"),
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "RemHub — Catálogos online",
    description: "Crea y comparte catálogos online de tu tienda.",
    url: "https://remhub.store",
    siteName: "RemHub",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 👇 AQUÍ es lo importante */}
        <Providers>
          {children}
        </Providers>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
