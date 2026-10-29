import type { Metadata } from "next";
import { transferPreview } from "@/lib/share/transfer-preview";

// Vista previa (WhatsApp): «Guía de traslado #18 · Bodega → San Roque», para imprimir y enviar con la mercancía.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  return transferPreview((await params).token, "guia");
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
