import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/** robots.txt según el dominio: en remhub.co y en el dominio de cada tienda (su propio sitemap). */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const storeHost = h.get("x-store-host");
  const origin = storeHost ? `https://${storeHost}` : PRODUCTION_ORIGIN;
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/api/", "/login", "/acceso/", "/pedido/", "/traslado/", "/firma-pedido/", "/firma-vale/", "/comprobante/", "/documento/"] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
