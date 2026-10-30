import type { Metadata } from "next";
import { signRequestPreview } from "@/lib/share/sign-request-preview";

// Vista previa (WhatsApp): «✍️ Firmas del pedido interno #7 · Bodega → Pioneros», con el logo del punto que despacha.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  return signRequestPreview((await params).token);
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
