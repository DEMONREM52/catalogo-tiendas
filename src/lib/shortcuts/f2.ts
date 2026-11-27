"use client";

/**
 * F2 en todo el panel (Logística, fase 9): busca producto.
 *
 * Una sola escucha para todo el panel (en DashboardShell). Las pantallas que ya tienen su propio F2 (POS, ingresos,
 * traslados, productos) lo siguen manejando: si una lo atendió (preventDefault), esta no hace nada.
 * Si nadie lo atendió, enfoca el buscador de productos marcado con `data-product-search`:
 *   1. el de la ventana abierta encima (role=dialog / aria-modal), nunca uno tapado detrás;
 *   2. si no, el primero visible en la pantalla.
 * No se activa con otras teclas ni dentro de campos de contraseña.
 */

const VISIBLE = (el: HTMLElement) => {
  if (el.hasAttribute("disabled")) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
};

/** El buscador al que debe ir F2 (o null si no hay ninguno a la vista). */
export function productSearchTarget(doc: Document = document): HTMLElement | null {
  const dialogs = Array.from(doc.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"]')).filter(VISIBLE);
  const top = dialogs.at(-1);
  if (top) {
    // Hay una ventana abierta: solo dentro de ella (si no tiene buscador, F2 no hace nada).
    return Array.from(top.querySelectorAll<HTMLElement>("[data-product-search]")).find(VISIBLE) ?? null;
  }
  return Array.from(doc.querySelectorAll<HTMLElement>("[data-product-search]")).find(VISIBLE) ?? null;
}

export function installF2(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "F2" || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement as HTMLInputElement | null;
    if (active?.type === "password") return;
    // Después de que la pantalla tuvo su oportunidad de manejarlo.
    window.setTimeout(() => {
      if (e.defaultPrevented) return;
      const el = productSearchTarget();
      if (!el) return;
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
      el.scrollIntoView({ block: "nearest" });
    }, 0);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
