import { ManifestLink } from "@/components/pwa/ManifestLink";

/** El trabajador que instala RemHub desde su enlace de acceso vuelve a abrir esa misma pantalla de ingreso. */
export default function AccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ManifestLink base="/manifest.webmanifest" param="start" />
      {children}
    </>
  );
}
