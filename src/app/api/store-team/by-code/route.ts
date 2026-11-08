import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * Inicio de sesión del equipo: el CÓDIGO DE LA TIENDA (20261301) identifica la tienda y devuelve solo
 * lo necesario para mostrarla y armar el usuario interno (id, nombre, logo). Para entrar siguen haciendo
 * falta usuario y contraseña. Límite de intentos por minuto para que no se prueben códigos al azar.
 */
export async function GET(request: Request) {
  const limited = rateLimited(request, "team-code", 12, 60_000);
  if (limited) return limited;
  const code = (new URL(request.url).searchParams.get("code") ?? "").replace(/\s/g, "");
  if (!/^[0-9]{4,8}$/.test(code)) {
    return NextResponse.json({ ok: false, error: "El código de la tienda tiene de 4 a 8 números." }, { status: 400 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "El servidor no tiene configurada la llave de administración de Supabase." }, { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: store, error } = await admin.from("stores").select("id,slug,name,logo_url,active").eq("team_code", code).maybeSingle();
  if (error) {
    if (/team_code/.test(error.message)) {
      return NextResponse.json({ ok: false, error: "Falta activar el código de tienda (migración 20261301)." }, { status: 500 });
    }
    console.error("No se pudo buscar la tienda por código:", error.message);
    return NextResponse.json({ ok: false, error: "No pudimos revisar el código. Intenta de nuevo." }, { status: 500 });
  }
  if (!store) return NextResponse.json({ ok: false, error: "No encontramos una tienda con ese código. Pídeselo al administrador." }, { status: 404 });
  return NextResponse.json({ ok: true, store: { id: store.id, slug: store.slug, name: store.name, logo_url: store.logo_url, active: store.active !== false } });
}
