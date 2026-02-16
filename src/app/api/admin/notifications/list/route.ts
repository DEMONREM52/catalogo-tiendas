import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("admin_notifications")
    .select("id,store_id,kind,title,body,expires_at,is_read,created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const unread = (data ?? []).filter((x) => !x.is_read).length;
  return NextResponse.json({ ok: true, unread, items: data ?? [] });
}
