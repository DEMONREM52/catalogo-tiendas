"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { GTM_ID } from "@/lib/tracking";

/**
 * Google Tag Manager solo en páginas públicas (inicio, catálogos, productos, login).
 * No se carga en el panel ni en enlaces con tokens privados (pedidos, traslados,
 * comprobantes, accesos, cambio de contraseña) para no enviar datos internos a terceros.
 */
const PRIVATE_PREFIXES = ["/dashboard", "/admin", "/pedido", "/traslado", "/comprobante", "/acceso", "/reset-password", "/forgot-password", "/api"];

export function isTrackedPath(pathname: string | null) {
  return !PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname?.startsWith(`${prefix}/`));
}

export function GoogleTagManager() {
  const pathname = usePathname();
  if (!isTrackedPath(pathname)) return null;
  return (
    <Script id="gtm-base" strategy="afterInteractive">
      {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
    </Script>
  );
}

export function GoogleTagManagerNoScript() {
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
