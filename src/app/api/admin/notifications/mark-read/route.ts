import { NextResponse } from "next/server";
import { adminErrorResponse, authorizePlatformAdmin } from "@/lib/server/admin-auth";

export async function POST(req: Request) {
  const { ids } = await req.json().catch(() => ({ ids: [] as string[] }));

  let sb;
  try { sb = (await authorizePlatformAdmin(req)).admin; } catch (e) { return adminErrorResponse(e); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((x) => typeof x === "string" && uuid.test(x))) {
    return NextResponse.json({ ok: false, error: "ids requeridos" }, { status: 400 });
  }

  const { error } = await sb.from("admin_notifications").update({ is_read: true }).in("id", ids);
  if (error) return NextResponse.json({ ok: false, error: "No se pudo actualizar." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
