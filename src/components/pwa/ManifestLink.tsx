"use client";

import { useEffect } from "react";
import { setManifestHref } from "@/lib/pwa/client";

/**
 * Ajusta el manifest de la página con datos que solo están en el enlace (no en el servidor):
 *   · «key» de un catálogo privado/mayorista → la app instalada abre el catálogo ya desbloqueado.
 *   · enlace de acceso del equipo (/acceso/…?sid=…) → la app instalada abre esa pantalla de ingreso.
 */
export function ManifestLink({ base, param }: { base: string; param: "key" | "start" }) {
  useEffect(() => {
    const apply = () => {
      const params = new URLSearchParams(window.location.search);
      if (param === "key") {
        const key = params.get("key");
        setManifestHref(key ? `${base}?key=${encodeURIComponent(key)}` : base);
      } else {
        setManifestHref(`${base}?start=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      }
    };
    apply();
    // Los metadatos pueden terminar de llegar un poco después: se repite una vez.
    const t = window.setTimeout(apply, 1500);
    // Al salir de la página se quitan las etiquetas propias (la siguiente página pone las suyas).
    return () => {
      window.clearTimeout(t);
      document.head.querySelectorAll("[data-remhub-pwa]").forEach((el) => el.remove());
    };
  }, [base, param]);
  return null;
}
