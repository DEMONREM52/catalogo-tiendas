"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Barra de acciones abajo en el celular (la acción principal a la mano del pulgar).
 *   · Solo en pantallas pequeñas: en el computador no aparece (la botonera normal sigue donde está).
 *   · Respeta la zona segura del iPhone/Android y deja un espacio al final para no tapar contenido.
 *   · Se esconde mientras el teclado está abierto, para no tapar el campo que se escribe.
 */
export function MobileActionBar({ show = true, hint, children }: { show?: boolean; hint?: ReactNode; children: ReactNode }) {
  const [keyboard, setKeyboard] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 0);
    const vv = window.visualViewport;
    if (!vv) return () => window.clearTimeout(t);
    // El teclado abierto encoge la parte visible de la pantalla.
    const onResize = () => setKeyboard(vv.height < window.innerHeight * 0.75);
    vv.addEventListener("resize", onResize);
    return () => { window.clearTimeout(t); vv.removeEventListener("resize", onResize); };
  }, []);
  if (!show) return null;
  return (
    <>
      {/* Espacio para que la barra no tape lo último de la página. */}
      <div aria-hidden className="sm:hidden" style={{ height: "calc(var(--action-bar-h) + env(safe-area-inset-bottom))" }} />
      {mounted && !keyboard ? createPortal(
        <div role="region" aria-label="Acciones" className="mobile-action-bar fixed inset-x-0 bottom-0 z-[90] border-t px-4 pt-3 backdrop-blur-md sm:hidden"
          style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 90%, transparent)" }}>
          {hint ? <p className="mb-2 text-center text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
          <div className="flex gap-2 [&>*]:min-h-12 [&>*]:flex-1">{children}</div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
