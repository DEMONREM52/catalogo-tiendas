import { PRODUCTION_HOST } from "./origin";
import { cleanHost } from "./store-host";

/**
 * ¿La app instalable de esta tienda lleva SU logo? Solo en su dominio propio (catalogo.mitienda.com).
 * En remhub.co y en tienda.remhub.co se instala con el logo de RemHub.
 * El proxy marca x-store-host y x-store-slug en el dominio de cada tienda.
 */
export function storeBrandAllowed(headers: Headers, storeSlug: string) {
  const host = cleanHost(headers.get("x-store-host"));
  const slug = String(headers.get("x-store-slug") ?? "").toLowerCase();
  if (!host || !slug || slug !== storeSlug.toLowerCase()) return false;
  return host !== PRODUCTION_HOST && !host.endsWith(`.${PRODUCTION_HOST}`);
}

/** ¿Estamos en el dominio de la tienda (subdominio o propio)? Ahí las rutas van sin el nombre: /zamora. */
export function onStoreHost(headers: Headers, storeSlug: string) {
  return String(headers.get("x-store-slug") ?? "").toLowerCase() === storeSlug.toLowerCase() && Boolean(headers.get("x-store-host"));
}
