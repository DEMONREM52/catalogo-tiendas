import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const { ids } = await req.json().catch(() => ({ ids: [] as string[] }));

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ ok: false, error: "ids requeridos" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { error } = await sb.from("admin_notifications").update({ is_read: true }).in("id", ids);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
