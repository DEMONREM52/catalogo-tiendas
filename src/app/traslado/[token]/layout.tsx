import type { Metadata } from "next";
import { transferPreview } from "@/lib/share/transfer-preview";

// Vista previa (WhatsApp): «Traslado #18 · Bodega → San Roque», con el logo del punto que despacha.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  return transferPreview((await params).token, "traslado");
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
