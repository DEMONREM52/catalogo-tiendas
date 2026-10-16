/** Dominio público de producción (seguro para el navegador: no importa nada del servidor). */
export const PRODUCTION_HOST = "remhub.co";
export const PRODUCTION_ORIGIN = `https://${PRODUCTION_HOST}`;

/**
 * Dominios anteriores o alternos: todo lo que llegue ahí se redirige a remhub.co (ver next.config.ts).
 * remhub.store fue el dominio anterior; se conserva para proteger la marca y no romper enlaces viejos.
 */
export const LEGACY_HOSTS = ["remhub.store", "www.remhub.store", `www.${PRODUCTION_HOST}`] as const;
