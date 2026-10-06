import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const storeId = url.searchParams.get("store_id");
  const slug = url.searchParams.get("slug")?.trim().toLowerCase();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!storeId || !slug) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { ok: false, error: "El servidor no tiene configurada la llave de administración de Supabase." },
      { status: 500 },
    );
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: store, error } = await admin
    .from("stores")
    .select("id,slug,name,logo_url,active")
    .eq("id", storeId)
    .maybeSingle();

  if (error) {
    console.error("No se pudo validar el enlace de acceso de tienda:", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (!store || String(store.slug).toLowerCase() !== slug) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // Solo datos públicos de la tienda para mostrar su marca en la pantalla de acceso del equipo.
  return NextResponse.json({ ok: true, store: { name: store.name, logo_url: store.logo_url, active: store.active !== false } });
}
