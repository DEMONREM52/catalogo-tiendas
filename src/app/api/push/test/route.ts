import { NextResponse, after } from "next/server";
import { pushAdminClient, pushConfigured, sendToUsers } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// La prueba «con la app cerrada» espera unos segundos antes de enviar.
export const maxDuration = 30;

/**
 * Notificación de prueba: solo a los equipos del propio usuario que la pide.
 * Con `delay_seconds` (hasta 15) se envía después: así se alcanza a cerrar el navegador o bloquear el celular.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = (await request.json().catch(() => null)) as { store_id?: string; delay_seconds?: number } | null;
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, message: "Las notificaciones aún no están configuradas en el servidor (faltan las llaves VAPID)." });
  if (!token || !body?.store_id) return NextResponse.json({ ok: false, message: "Inicia sesión de nuevo." }, { status: 401 });
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ ok: false, message: "Inicia sesión de nuevo." }, { status: 401 });
  const storeId = body.store_id;
  const delay = Math.max(0, Math.min(15, Math.round(Number(body.delay_seconds) || 0)));

  if (delay) {
    const { count } = await admin.from("erp_push_subscriptions").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("user_id", userId);
    if (!count) return NextResponse.json({ ok: false, message: "Este equipo aún no tiene las notificaciones activadas." });
    after(async () => {
      await new Promise((r) => setTimeout(r, delay * 1000));
      await sendToUsers(admin, storeId, new Map([[userId, {
        title: "✅ ¡Funciona con la app cerrada!",
        body: "Así te llegarán los pedidos, mensajes y llamadas aunque no tengas RemHub abierta.",
        url: "/dashboard/pedidos?tab=internos", tag: "remhub-test", urgent: true, ttl: 120,
      }]]));
    });
    return NextResponse.json({ ok: true, scheduled: delay, devices: count });
  }

  const res = await sendToUsers(
    admin,
    storeId,
    new Map([[userId, { title: "🔔 ¡Así te llegarán los avisos!", body: "Pedidos nuevos, mensajes y cambios de estado de los pedidos internos.", url: "/dashboard/pedidos?tab=internos", tag: "remhub-test" }]]),
  );
  if (!res.sent) return NextResponse.json({ ok: false, message: res.failed ? "El equipo rechazó la notificación. Desactívalas y actívalas de nuevo." : "Este equipo aún no tiene las notificaciones activadas." });
  return NextResponse.json({ ok: true, sent: res.sent });
}
