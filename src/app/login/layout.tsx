import type { Metadata } from "next";
import { hostStore, previewImage, previewMetadata } from "@/lib/share/link-preview";

/** En el dominio de una tienda (lavitrina.remhub.co/login) la vista previa es de esa tienda. */
export async function generateMetadata(): Promise<Metadata> {
  const store = await hostStore();
  if (!store) return { title: "Iniciar sesión - RemHub" };
  return previewMetadata({
    title: `Iniciar sesión · ${store.name}`,
    description: `Entra al panel de ${store.name} con tu usuario y contraseña: ventas, inventario y pedidos según tus permisos.`,
    image: previewImage(store.slug, { label: "acceso" }),
    siteName: store.name,
  });
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
