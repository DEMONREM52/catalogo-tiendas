import { NextResponse } from "next/server";
import { adminErrorResponse, authorizePlatformAdmin } from "@/lib/server/admin-auth";

export async function GET(req: Request) {
  // Solo el administrador global: lista datos de todas las tiendas.
  let sb;
  try { sb = (await authorizePlatformAdmin(req)).admin; } catch (e) { return adminErrorResponse(e); }

  const { data, error } = await sb
    .from("admin_notifications")
    .select("id,store_id,kind,title,body,expires_at,is_read,created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ ok: false, error: "No se pudieron leer las notificaciones." }, { status: 500 });

  const unread = (data ?? []).filter((x) => !x.is_read).length;
  return NextResponse.json({ ok: true, unread, items: data ?? [] });
}
