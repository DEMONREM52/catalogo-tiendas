"use client";

import type { ReactNode } from "react";
import { useCan } from "@/lib/permission-runtime";

/** Muestra un botón de exportar (Excel/CSV) solo a quien tiene el permiso «Exportar». */
export function ExportGate({ children }: { children: ReactNode }) {
  return useCan("exports") ? <>{children}</> : null;
}
