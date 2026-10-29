import { NextResponse } from "next/server";
import { pushAdminClient } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Servidores para conectar las llamadas. STUN público siempre; TURN (relevo, para redes estrictas de celular o
 * empresas) si se configura TURN_URLS, TURN_USERNAME y TURN_CREDENTIAL. Solo con sesión.
 */
export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const admin = pushAdminClient();
  if (!admin || !token) return NextResponse.json({ ok: false }, { status: 401 });
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return NextResponse.json({ ok: false }, { status: 401 });
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const turn = (process.env.TURN_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (turn.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({ urls: turn, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return NextResponse.json({ ok: true, iceServers, turn: turn.length > 0 }, { headers: { "Cache-Control": "private, no-store" } });
}
