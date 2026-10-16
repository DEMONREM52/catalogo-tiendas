"use client";

import Script from "next/script";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { GTM_ID } from "@/lib/tracking";

/**
 * Google Tag Manager solo en páginas públicas (inicio, catálogos, productos).
 * No se carga en el panel, el ingreso ni en enlaces con tokens privados (pedidos, traslados,
 * comprobantes, accesos, cambio de contraseña) para no enviar datos internos a terceros.
 */
const PRIVATE_PREFIXES = ["/dashboard", "/admin", "/login", "/entrar", "/pedido", "/traslado", "/comprobante", "/acceso", "/reset-password",
  "/forgot-password", "/api", "/offline"];

export function isTrackedPath(pathname: string | null) {
  return !PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname?.startsWith(`${prefix}/`));
}

/** Solo en páginas públicas (Vercel Analytics y Speed Insights: no se cuentan visitas del panel). */
export function PublicOnly({ children }: { children: ReactNode }) {
  return isTrackedPath(usePathname()) ? <>{children}</> : null;
}

export function GoogleTagManager() {
  const pathname = usePathname();
  const tracked = isTrackedPath(pathname);
  // Si GTM ya cargó en una página pública y se pasa al panel o al ingreso sin recargar, se recarga
  // la página: así ningún script de terceros sigue vivo donde hay sesión o contraseñas.
  useEffect(() => {
    if (!tracked && typeof window !== "undefined" && "google_tag_manager" in window) window.location.reload();
  }, [tracked]);
  if (!tracked) return null;
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
