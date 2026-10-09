import type { Metadata } from "next";
import { cookies } from "next/headers";
import DashboardShell from "./DashboardShell";

/**
 * Manifest del panel desde el servidor (iPhone lo toma de la página al «Agregar a pantalla de inicio»):
 *   · Trabajador que entró por su enlace → la app abre su enlace de acceso (con su sesión guardada).
 *   · Dueño / administrador → la app abre el panel principal.
 */
export async function generateMetadata(): Promise<Metadata> {
  const raw = (await cookies()).get("remhub_staff_access")?.value;
  let access: string | null = null;
  try {
    const path = raw ? decodeURIComponent(raw) : "";
    if (/^\/acceso\/[^/?#]+\?sid=[0-9a-f-]{36}/i.test(path)) access = path;
  } catch {
    access = null;
  }
  return {
    title: {
      default: "Dashboard · RemHub",
      template: "%s · Dashboard · RemHub",
    },
    ...(access ? { manifest: `/manifest.webmanifest?start=${encodeURIComponent(access)}` } : {}),
  };
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
