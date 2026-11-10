"use client";

import { useSyncExternalStore } from "react";
import { getPwaServerState, getPwaState, subscribePwa } from "@/lib/pwa/client";

/** Qué se ve en la ventana de instalar: RemHub o un catálogo. (Aparte de InstallSheet para no cargar la ventana en cada página.) */
export type InstallIdentity = {
  /** «RemHub» o el nombre del catálogo. */
  name: string;
  /** Icono que verá el usuario (el de RemHub o el del catálogo). */
  iconUrl: string;
  kind: "remhub" | "catalog";
};

export function usePwa() {
  return useSyncExternalStore(subscribePwa, getPwaState, getPwaServerState);
}
