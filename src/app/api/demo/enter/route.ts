import { NextResponse } from "next/server";
import { pushAdminClient } from "@/lib/push/server";
import { storeSpaceOrigin } from "@/lib/share/store-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Entrar a la demo» (20261314): crea un pase de un solo uso para el usuario de la tienda demo y devuelve el
 * enlace de /entrar (el pase va después de «#», así no queda en registros). Solo si el admin de RemHub dejó la
 * demo activa y con foto. Variables (solo servidor): SUPABASE_SERVICE_ROLE_KEY.
 */
export async function POST(request: Request) {
  const admin = pushAdminClient();
  if (!admin) return NextResponse.json({ error: "La demo no está disponible en este momento." }, { status: 503 });
  const { data, error } = await admin.rpc("demo_entry");
  const entry = data as { ok?: boolean; user_id?: string; slug?: string } | null;
  if (error || !entry?.ok || !entry.user_id || !entry.slug) return NextResponse.json({ error: "La demo no está disponible en este momento." }, { status: 404 });

  const { data: u } = await admin.auth.admin.getUserById(entry.user_id);
  const email = u?.user?.email;
  if (!email) return NextResponse.json({ error: "La demo no está disponible en este momento." }, { status: 404 });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) return NextResponse.json({ error: "No se pudo abrir la demo. Intenta de nuevo." }, { status: 502 });

  const origin = storeSpaceOrigin(entry.slug) ?? new URL(request.url).origin;
  const pass = new URLSearchParams({ t: hashed, n: "/dashboard" });
  return NextResponse.json({ url: `${origin}/entrar#${pass.toString()}` });
}
