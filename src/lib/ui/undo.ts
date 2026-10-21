"use client";

import Swal from "sweetalert2";

/**
 * «Hecho · Deshacer»: en acciones pequeñas (quitar un producto de una lista) no se pregunta «¿Seguro?».
 * Se hace de una vez y se ofrece deshacer durante unos segundos.
 */
export function undoToast(text: string, onUndo: () => void, ms = 5000) {
  void Swal.fire({
    toast: true,
    position: "bottom",
    icon: "info",
    title: text,
    showConfirmButton: true,
    confirmButtonText: "↩️ Deshacer",
    confirmButtonColor: "#8b5cf6",
    timer: ms,
    timerProgressBar: true,
    background: "var(--t-bg-base)",
    color: "var(--t-text)",
  }).then((r) => { if (r.isConfirmed) onUndo(); });
}

/** Vuelve a poner un elemento en su posición (o al final si la lista cambió de tamaño). */
export function reinsert<T>(list: T[], item: T, index: number) {
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}
