import type { NextConfig } from "next";
import { LEGACY_HOSTS, PRODUCTION_ORIGIN } from "./src/lib/share/origin";

/**
 * Encabezados de seguridad para todas las páginas y rutas.
 * - Nadie puede meter RemHub dentro de otra página (clickjacking).
 * - El navegador siempre usa https (HSTS) y no adivina tipos de archivo.
 * - Al salir hacia otros sitios solo se comparte el dominio, nunca la ruta (que puede llevar enlaces de comprobantes).
 * - Cámara y ubicación solo para RemHub (búsqueda por foto, «cómo llegar»); micrófono, USB y demás, apagados fuera del panel.
 * - Dentro del panel (/dashboard) USB, puerto serie, Bluetooth y micrófono quedan permitidos SOLO para RemHub: la impresión
 *   directa en impresoras térmicas, y las notas de voz y llamadas del chat de pedidos internos (el navegador igual pide permiso).
 * La política de contenido completa (CSP) queda pendiente: hay que inventariar GTM, píxeles, Wompi, Addi y jsdelivr.
 */
const permissions = (hardware: "()" | "(self)") =>
  `camera=(self), geolocation=(self), microphone=${hardware}, usb=${hardware}, serial=${hardware}, bluetooth=${hardware}, payment=(self), browsing-topics=()`;
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: permissions("()") },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Los metadatos (manifest, icono de iPhone, vista previa) van completos en el <head> para todos los
  // navegadores, no al final de la página: Safari los toma de ahí al «Agregar a pantalla de inicio».
  htmlLimitedBots: /.*/,
  // No anunciar la tecnología del servidor.
  poweredByHeader: false,
  // Un solo dominio: remhub.store, www.remhub.store y www.remhub.co llevan a https://remhub.co con la misma ruta
  // (308 = permanente; Google pasa el posicionamiento al dominio nuevo). /api NO se redirige: las pasarelas de
  // pago y otros servicios que llaman al dominio viejo siguen funcionando mientras se actualizan.
  async redirects() {
    return LEGACY_HOSTS.map((host) => ({
      source: "/:path((?!api/).*)",
      has: [{ type: "host" as const, value: host }],
      destination: `${PRODUCTION_ORIGIN}/:path`,
      permanent: true,
    }));
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Impresión directa (impresora térmica USB, puerto serie o Bluetooth) solo en el panel. Va después: manda sobre la de arriba.
      { source: "/dashboard/:path*", headers: [{ key: "Permissions-Policy", value: permissions("(self)") }] },
      { source: "/dashboard", headers: [{ key: "Permissions-Policy", value: permissions("(self)") }] },
      // Las respuestas privadas de la API nunca se guardan en cachés compartidas (datos de cada tienda).
      // (QR, íconos y vistas previas son públicos y sí se pueden guardar.)
      ...["admin", "fiscal", "payments", "store-team", "store-domains", "push", "siigo", "session", "notify"].map((p) => ({
        source: `/api/${p}/:path*`,
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
    ];
  },
};

export default nextConfig;
