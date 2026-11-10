"use client";

import { preloadWhenIdle } from "./idle-preload";
import type { SweetAlertIcon, SweetAlertOptions, SweetAlertResult } from "sweetalert2";

/**
 * Ventanas de aviso (SweetAlert2) que se cargan al usarlas, no al abrir la página.
 *
 *   · Misma forma que `import Swal from "sweetalert2"`: Swal.fire(...), showValidationMessage, getInput, isVisible, DismissReason.
 *   · El paquete (~75 KB) se pide cuando el navegador queda libre después de cargar la página, así la primera ventana sale
 *     al instante y queda guardado por la app para trabajar sin conexión (el service worker guarda /_next/static).
 *   · Lo que se llama dentro de una ventana abierta (showValidationMessage, getInput) ya tiene el paquete cargado.
 */
type Real = typeof import("sweetalert2").default;

let real: Real | null = null;
let loading: Promise<Real> | null = null;

function load(): Promise<Real> {
  if (real) return Promise.resolve(real);
  loading ??= import("sweetalert2").then((m) => (real = m.default)).catch((e) => {
    loading = null; // sin conexión o falló la descarga: se reintenta en la siguiente ventana
    throw e;
  });
  return loading;
}

/** Pide el paquete cuando el navegador está libre (se llama solo al cargar este archivo). */
export function preloadSwal() {
  if (!real) preloadWhenIdle(load);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- igual que sweetalert2 (T = any)
function fire<T = any>(options: SweetAlertOptions): Promise<SweetAlertResult<Awaited<T>>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- igual que sweetalert2 (T = any)
function fire<T = any>(title?: string, html?: string, icon?: SweetAlertIcon): Promise<SweetAlertResult<Awaited<T>>>;
function fire(...args: unknown[]) {
  return load().then((s) => (s.fire as (...a: unknown[]) => Promise<SweetAlertResult>)(...args));
}

const Swal = {
  fire,
  showValidationMessage(message: string) {
    real?.showValidationMessage(message);
  },
  getInput(): HTMLInputElement | null {
    return real ? real.getInput() : null;
  },
  isVisible(): boolean {
    return real ? real.isVisible() : false;
  },
  DismissReason: { cancel: "cancel", backdrop: "backdrop", close: "close", esc: "esc", timer: "timer" } as const,
};

if (typeof window !== "undefined") preloadSwal();

export default Swal;
