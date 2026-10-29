import { NextResponse } from "next/server";
import { pushConfigured } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Llave pública de las notificaciones (es pública por diseño) y si el servidor puede enviarlas.
 * Se lee al momento: no depende de que la llave estuviera al compilar la página.
 */
export async function GET() {
  const ready = pushConfigured();
  return NextResponse.json({ key: ready ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null : null, ready }, { headers: { "Cache-Control": "no-store" } });
}
