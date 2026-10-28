import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { GoogleTagManager, GoogleTagManagerNoScript, PublicOnly } from "@/components/GoogleTagManager";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

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

const SITE_URL = PRODUCTION_ORIGIN;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  applicationName: "RemHub",
  title: {
    default: "RemHub — Software para vender y administrar tu negocio",
    template: "%s — RemHub",
  },
  description:
    "Catálogo con pedidos por WhatsApp, landing pages para tus anuncios con el píxel de Meta, POS, inventario por bodegas y puntos, traslados, caja y rentabilidad. Todo tu negocio en un solo lugar.",

  alternates: {
    canonical: SITE_URL,
  },

  // App instalable (PWA): siempre con la identidad de RemHub. Los catálogos usan su propio manifest.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "RemHub",
    // «default»: el contenido empieza debajo de la hora y la batería (no se esconde detrás).
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },

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
    title: "RemHub — Software para vender y administrar tu negocio",
    description:
      "Catálogo con pedidos por WhatsApp, landing pages para tus anuncios con el píxel de Meta, POS, inventario por bodegas y puntos, traslados, caja y rentabilidad. Todo tu negocio en un solo lugar.",
    url: SITE_URL,
    siteName: "RemHub",
    type: "website",
    locale: "es_CO",
    // Tarjeta con el logo de RemHub (archivo fijo, igual a /api/og). Los catálogos usan la de su tienda o punto.
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 1200,
        type: "image/jpeg",
        alt: "RemHub",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "RemHub — Software para vender y administrar tu negocio",
    description:
      "Catálogo con pedidos por WhatsApp, landing pages para tus anuncios con el píxel de Meta, POS, inventario por bodegas y puntos, traslados, caja y rentabilidad. Todo tu negocio en un solo lugar.",
    images: ["/og-image.jpg"],
  },

  robots: {
    index: true,
    follow: true,
  },

  category: "technology",
  creator: "RemHub",
  publisher: "RemHub",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Usa toda la pantalla en celulares con muesca; el contenido respeta las zonas seguras.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

// Guarda el aviso de «se puede instalar» aunque llegue antes de que cargue la app.
// Conexión abierta de antemano con Supabase (datos y fotos): ahorra el saludo inicial en cada página.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin; } catch { return null; }
})();

const EARLY_INSTALL_SCRIPT = "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__remhubBIP=e;});";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY_INSTALL_SCRIPT }} />
        {SUPABASE_ORIGIN ? (
          <>
            <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />
            <link rel="preconnect" href={SUPABASE_ORIGIN} />
          </>
        ) : null}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Google Tag Manager (noscript) */}
        <GoogleTagManagerNoScript />
        <Providers>{children}</Providers>

        {/* Google Tag Manager: solo en páginas públicas */}
        <GoogleTagManager />

        {/* Vercel: solo páginas públicas (las del panel no se cuentan ni se cobran como visitas) */}
        <PublicOnly>
          <SpeedInsights />
          <Analytics />
        </PublicOnly>
      </body>
    </html>
  );
}
