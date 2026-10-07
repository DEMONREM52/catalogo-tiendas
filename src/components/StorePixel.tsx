"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { setStorePixel, track, type StorePixelConfig, type TrackItem } from "@/lib/tracking";

/** Píxel de Meta (Facebook) de la tienda. Se monta en todas las páginas públicas de la tienda. */
export function StorePixel({ config }: { config: StorePixelConfig | null }) {
  const pathname = usePathname();
  const first = useRef(true);
  const id = config?.meta_pixel_id ?? "";

  useEffect(() => {
    setStorePixel(config);
    return () => setStorePixel(null);
  }, [config]);

  // Navegación interna (sin recargar): cuenta como una nueva vista de página.
  useEffect(() => {
    if (!id) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
    try {
      fbq?.("trackSingle", id, "PageView");
    } catch {
      /* bloqueado */
    }
  }, [pathname, id]);

  if (!/^\d{6,20}$/.test(id)) return null;
  return (
    <>
      <Script id={`meta-pixel-${id}`} strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${id}');fbq('trackSingle','${id}','PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img height="1" width="1" style={{ display: "none" }} alt="" src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`} />
      </noscript>
    </>
  );
}

/** Registra la vista de un producto (página de detalle). */
export function TrackProductView({ item, store }: { item: TrackItem; store?: string }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === item.id) return;
    // Pequeña espera para que el píxel y GTM alcancen a cargar.
    const timer = window.setTimeout(() => {
      sent.current = item.id;
      track.viewItem(item, store);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [item, store]);
  return null;
}
