import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://remhub.store";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  applicationName: "RemHub",
  title: {
    default: "RemHub — Catálogos online",
    template: "%s — RemHub",
  },
  description:
    "Crea y comparte catálogos online de tu tienda. Pedidos por WhatsApp, catálogo detal y mayoristas, y factura PDF.",

  alternates: {
    canonical: SITE_URL,
  },

  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/remhub-icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/remhub-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/remhub-icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/remhub-icon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/remhub-icon-128.png", sizes: "128x128", type: "image/png" },
      { url: "/remhub-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/remhub-icon-256.png", sizes: "256x256", type: "image/png" },
      { url: "/remhub-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },

  openGraph: {
    title: "RemHub — Catálogos online",
    description:
      "Tu catálogo listo para compartir: el cliente arma el pedido y tú lo recibes por WhatsApp. Detal + Mayoristas + factura PDF.",
    url: SITE_URL,
    siteName: "RemHub",
    type: "website",
    locale: "es_CO",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "RemHub",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "RemHub — Catálogos online",
    description:
      "Catálogos premium para vender por WhatsApp. Detal + Mayoristas + pedidos + factura PDF.",
    images: ["/og-image.png"],
  },

  robots: {
    index: true,
    follow: true,
  },

  category: "technology",
  creator: "RemHub",
  publisher: "RemHub",

  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>

        {/* Vercel */}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
