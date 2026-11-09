import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient, sendToUsers, type PushPayload } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Digest = { store_id: string; user_id: string; due: number; names: string[] | null; tasks: number; target: number };

/**
 * Aviso diario al celular de «¡Publícame!» (cron de Vercel cada hora): cada tienda escoge la hora (20261306,
 * por defecto 9:00 a. m.). Lo reciben quienes trabajan productos: cuántos toca publicar hoy y sus tareas.
 * Una sola vez por persona y día (erp_push_log).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = pushAdminClient();
  if (!admin) return NextResponse.json({ ok: false, skipped: "not-configured" });

  const now = new Date();
  const hour = Number(now.toLocaleString("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false })) % 24;
  const day = now.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const { data, error } = await admin.rpc("erp_publish_push_digest", { p_hour: hour });
  if (error) return NextResponse.json({ ok: false, skipped: /Could not find|does not exist/i.test(error.message) ? "migration" : "digest" });

  const byStore = new Map<string, Map<string, PushPayload>>();
  for (const d of (data ?? []) as Digest[]) {
    const { error: dup } = await admin.from("erp_push_log").insert({ key: `publish:${d.store_id}:${d.user_id}:${day}` });
    if (dup) continue;
    const names = (d.names ?? []).filter(Boolean);
    const today = Math.min(d.due, d.target);
    const payload: PushPayload = d.due > 0
      ? {
          title: `📣 ¡Hey! Hoy toca publicar ${today} producto${today === 1 ? "" : "s"}`,
          body: `${names.join(", ")}${d.due > names.length ? ` y ${d.due - names.length} más` : ""}.${d.tasks ? ` Además tienes ${d.tasks} tarea${d.tasks === 1 ? "" : "s"} de productos.` : ""} Toca para ver tu plan de hoy.`,
          url: "/dashboard/products/radar?ver=publicar",
          tag: `publish-${day}`,
        }
      : {
          title: `📋 Tienes ${d.tasks} tarea${d.tasks === 1 ? "" : "s"} de productos`,
          body: "Toca para verlas en el Radar de productos.",
          url: "/dashboard/products/radar?ver=tareas",
          tag: `product-tasks-${day}`,
        };
    if (!byStore.has(d.store_id)) byStore.set(d.store_id, new Map());
    byStore.get(d.store_id)!.set(d.user_id, payload);
  }
  let sent = 0;
  for (const [storeId, payloads] of byStore) sent += (await sendToUsers(admin, storeId, payloads)).sent;
  return NextResponse.json({ ok: true, hour, people: [...byStore.values()].reduce((s, m) => s + m.size, 0), sent });
}
