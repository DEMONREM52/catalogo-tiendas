import { cleanHost, isPlatformHost, subdomainSlug } from "./store-host";

/**
 * Ruta de una página de la tienda vista desde el navegador.
 * En el espacio de la tienda (lavitrina.remhub.co o su dominio propio) va sin el nombre: «/producto/123».
 * En remhub.co va con el nombre: «/lavitrina/producto/123».
 * Así no hay una redirección de más en cada clic (cada redirección es una solicitud que se paga).
 */
export function storeHref(slug: string, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return `/${slug}${p}`;
  const host = cleanHost(window.location.host);
  const sub = subdomainSlug(host);
  const onStoreHost = sub ? sub === slug.toLowerCase() : !isPlatformHost(host);
  return onStoreHost ? p : `/${slug}${p}`;
}
