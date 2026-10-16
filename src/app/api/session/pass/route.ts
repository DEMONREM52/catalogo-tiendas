import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { storeSpaceOrigin } from "@/lib/share/store-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pase de un solo uso hacia el espacio de la tienda (lavitrina.remhub.co).
 * Cada subdominio tiene su PROPIA sesión (nunca se comparte entre tiendas): aquí se crea un enlace de ingreso
 * de un solo uso para el mismo usuario y el subdominio lo canjea en /entrar. El enlace va después de «#»,
 * así nunca llega a los registros de ningún servidor.
 * El admin de RemHub no recibe pase: su sesión tiene poderes sobre todas las tiendas y se queda en remhub.co.
 * Variables (solo servidor): SUPABASE_SERVICE_ROLE_KEY.
 */

const NEXT = /^\/dashboard(\/[A-Za-z0-9/_-]*)?(\?[^#\s<>"']*)?$/;

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.", reason: "config" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Inicia sesión.", reason: "auth" }, { status: 401 });

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return NextResponse.json({ error: "La sesión venció. Vuelve a entrar.", reason: "auth" }, { status: 401 });

  const { data: profile } = await admin.from("user_profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (profile?.role === "admin") return NextResponse.json({ error: "El admin de RemHub trabaja en remhub.co.", reason: "platform_admin" }, { status: 403 });

  // La tienda del usuario: la suya (dueño) o donde trabaja (activo). Igual que el panel.
  let store: { id: string; slug: string; active: boolean | null } | null = null;
  const { data: owned } = await admin.from("stores").select("id,slug,active").eq("owner_id", user.id).limit(1).maybeSingle();
  if (owned) store = owned;
  else {
    const { data: member } = await admin.from("store_users").select("store_id").eq("user_id", user.id).eq("active", true).limit(1).maybeSingle();
    if (member?.store_id) {
      const { data: s } = await admin.from("stores").select("id,slug,active").eq("id", member.store_id).maybeSingle();
      store = s ?? null;
    }
  }
  if (!store) return NextResponse.json({ error: "Tu usuario no tiene una tienda activa.", reason: "no_store" }, { status: 404 });
  const origin = storeSpaceOrigin(String(store.slug ?? "").toLowerCase());
  if (!origin) return NextResponse.json({ error: "El nombre de la tienda no sirve de subdominio.", reason: "legacy_slug" }, { status: 409 });
  if (!user.email) return NextResponse.json({ error: "Tu usuario no tiene correo.", reason: "no_email" }, { status: 409 });

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) return NextResponse.json({ error: "No se pudo crear el pase. Intenta de nuevo.", reason: "link" }, { status: 502 });

  const body = (await request.json().catch(() => ({}))) as { next?: unknown };
  const next = typeof body.next === "string" && NEXT.test(body.next) ? body.next : "/dashboard";
  const pass = new URLSearchParams({ t: hashed, n: next });
  return NextResponse.json({ url: `${origin}/entrar#${pass.toString()}`, slug: store.slug, store_id: store.id });
}
