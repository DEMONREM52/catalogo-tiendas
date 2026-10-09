"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { InstallSheet, usePwa, type InstallIdentity } from "./InstallSheet";

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
  if (pwa.standalone) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} style={style} title={title ?? `Instalar ${identity.name}`}>
        {children}
      </button>
      <InstallSheet open={open} onClose={() => setOpen(false)} identity={identity} />
    </>
  );
}
