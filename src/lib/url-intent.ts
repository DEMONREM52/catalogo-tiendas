"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lo que pide la dirección de la página (para que el buscador Ctrl+K lleve directo):
 *  · ?tab=…   → qué pestaña abrir.
 *  · ?nuevo=… → qué formulario abrir (nuevo vale, nuevo gasto, nueva nómina…). Se usa una sola vez y se borra.
 * Como el buscador navega dentro de la misma página sin recargarla, también se escucha el aviso «remhub-url-change».
 */
export const URL_CHANGE_EVENT = "remhub-url-change";
export const announceUrlChange = () => window.dispatchEvent(new Event(URL_CHANGE_EVENT));

const param = (name: string) => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name));

function onUrlChange(cb: () => void) {
  window.addEventListener(URL_CHANGE_EVENT, cb);
  window.addEventListener("popstate", cb);
  return () => { window.removeEventListener(URL_CHANGE_EVENT, cb); window.removeEventListener("popstate", cb); };
}

/** Pestaña que pide la dirección (si es válida), y la deja escrita al cambiarla. */
export function useUrlTab<T extends string>(valid: readonly T[], fallback: T): [T, (t: T) => void] {
  const [tab, setTabState] = useState<T>(fallback);
  const validRef = useRef(valid);
  useEffect(() => { validRef.current = valid; });
  useEffect(() => {
    const read = () => {
      const want = param("tab") as T | null;
      if (want && validRef.current.includes(want)) setTabState(want);
    };
    read();
    return onUrlChange(read);
  }, []);
  const setTab = (t: T) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
    window.dispatchEvent(new Event("remhub-tab-change"));
  };
  return [tab, setTab];
}

/** Abre un formulario cuando la dirección trae ?nuevo=<nombre> (y quita el parámetro para no repetirlo). */
export function useUrlAction(names: string | string[], run: (name: string) => void) {
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; });
  const key = Array.isArray(names) ? names.join("|") : names;
  useEffect(() => {
    const list = key.split("|");
    const check = () => {
      const want = param("nuevo");
      if (!want || !list.includes(want)) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("nuevo");
      window.history.replaceState(null, "", url.toString());
      // Después de pintar la pestaña (el formulario vive dentro de ella).
      window.setTimeout(() => runRef.current(want), 0);
    };
    check();
    return onUrlChange(check);
  }, [key]);
}
