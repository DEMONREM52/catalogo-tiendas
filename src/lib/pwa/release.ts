/**
 * Lo mínimo de las novedades que necesita el navegador: tipos, en qué rutas se avisa y qué versión corre la pestaña.
 * La lista completa (lib/pwa/changelog.ts, ~40 KB de textos) NO va al navegador: se pide a /api/version cuando hace falta.
 * BUILD_RELEASE la pone next.config.ts al compilar (NEXT_PUBLIC_REMHUB_RELEASE = la novedad más reciente de changelog.ts).
 */
export type ReleaseStep = { icon: string; text: string };
export type Release = {
  id: number;
  date: string;
  title: string;
  summary: string;
  paths: string[];
  important?: boolean;
  demo?: ReleaseStep[];
};

/** La novedad más reciente que trae este código (la versión que corre en la pestaña). */
export const BUILD_RELEASE = Number(process.env.NEXT_PUBLIC_REMHUB_RELEASE) || 0;

/** Rutas del panel interno: solo ahí se avisa de novedades. Catálogos, landings y páginas públicas nunca ven el aviso. */
const PANEL_PATHS = ["/dashboard", "/admin", "/traslado"];
export function isPanelPath(pathname: string) {
  return PANEL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** ¿La novedad toca esta ruta? (Una «importante» se muestra en todo el panel, pero nunca fuera de él.) */
export function releaseTouches(r: Release, pathname: string) {
  if (!isPanelPath(pathname)) return false;
  if (r.important) return true;
  return r.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
