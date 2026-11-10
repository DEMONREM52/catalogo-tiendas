"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import nextDynamic from "next/dynamic";
import { usePwa, type InstallIdentity } from "./usePwa";

// La ventana con las instrucciones se descarga al tocar «Instalar», no al abrir cada página.
const InstallSheet = nextDynamic(() => import("./InstallSheet").then((m) => m.InstallSheet), { ssr: false });

export const REMHUB_INSTALL: InstallIdentity = { name: "RemHub", iconUrl: "/icons/remhub-192.png", kind: "remhub" };

/** Botón «Instalar» (se oculta solo si ya está abierta como app instalada). */
export function InstallButton({
  identity = REMHUB_INSTALL,
  className = "",
  style,
  children,
  title,
}: {
  identity?: InstallIdentity;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  title?: string;
}) {
  const pwa = usePwa();
  const [open, setOpen] = useState(false);
  // Una vez abierta se queda montada: así la animación de cerrar se ve completa.
  const [used, setUsed] = useState(false);
  if (pwa.standalone) return null;
  return (
    <>
      <button type="button" onClick={() => { setUsed(true); setOpen(true); }} className={className} style={style} title={title ?? `Instalar ${identity.name}`}>
        {children}
      </button>
      {used ? <InstallSheet open={open} onClose={() => setOpen(false)} identity={identity} /> : null}
    </>
  );
}
