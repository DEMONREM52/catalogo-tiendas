import { NextResponse } from "next/server";
import { pushAdminClient, pushConfigured, sendToUsers } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Notificación de prueba: solo a los equipos del propio usuario que la pide. */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = (await request.json().catch(() => null)) as { store_id?: string } | null;
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, message: "Las notificaciones aún no están configuradas en el servidor (faltan las llaves VAPID)." });
  if (!token || !body?.store_id) return NextResponse.json({ ok: false, message: "Inicia sesión de nuevo." }, { status: 401 });
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ ok: false, message: "Inicia sesión de nuevo." }, { status: 401 });
  const res = await sendToUsers(
    admin,
    body.store_id,
    new Map([[userId, { title: "🔔 ¡Así te llegarán los avisos!", body: "Pedidos nuevos, mensajes y cambios de estado de los pedidos internos.", url: "/dashboard/pedidos?tab=internos", tag: "remhub-test" }]]),
  );
  if (!res.sent) return NextResponse.json({ ok: false, message: res.failed ? "El equipo rechazó la notificación. Desactívalas y actívalas de nuevo." : "Este equipo aún no tiene las notificaciones activadas." });
  return NextResponse.json({ ok: true, sent: res.sent });
}
