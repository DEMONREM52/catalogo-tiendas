import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Store = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  active_until: string | null;
};

function diffMs(iso: string | null) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return t - Date.now();
}

function daysLeftFromMs(ms: number) {
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function minutesLeftFromMs(ms: number) {
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60));
}

/**
 * ✅ Ahora genera:
 * - expired si ms <= 0
 * - d0 si faltan menos de 24h (ideal para pruebas de minutos)
 * - d3, d5, d10 igual que antes
 */
function pickKind(ms: number | null) {
  if (ms === null) return null;
  if (ms <= 0) return "expired" as const;

  const d = daysLeftFromMs(ms);
  if (d <= 1) return "d0" as const;  // ✅ nuevo (menos de 24h)
  if (d <= 3) return "d3" as const;
  if (d <= 5) return "d5" as const;
  if (d <= 10) return "d10" as const;
  return null;
}

function buildMessage(store: Store, kind: "d10" | "d5" | "d3" | "d0" | "expired", ms: number) {
  const exp = store.active_until ? new Date(store.active_until).toLocaleString("es-CO") : "—";

  if (kind === "expired") {
    return {
      title: `⛔ Tienda vencida: ${store.name}`,
      body: `La tienda /${store.slug} venció (${exp}). Al vencer, se inactiva tienda y catálogos.`,
    };
  }

  if (kind === "d0") {
    const mins = minutesLeftFromMs(ms);
    return {
      title: `⏳ Vence en minutos: ${store.name}`,
      body: `La tienda /${store.slug} vence en ~${mins} min (${exp}). Al vencer, se inactiva tienda y catálogos.`,
    };
  }

  const d = daysLeftFromMs(ms);
  const prefix = kind === "d3" ? "🔥" : kind === "d5" ? "🧯" : "⚠️";

  return {
    title: `${prefix} Vence en ${d} día(s): ${store.name}`,
    body: `La tienda /${store.slug} vence el ${exp}. Al vencer, se inactiva tienda y catálogos.`,
  };
}

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Faltan env vars de Supabase" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ✅ IMPORTANTE: aquí sí traemos active_until
  const { data: stores, error } = await sb
    .from("stores")
    .select("id,name,slug,active,active_until");

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let upserted = 0;

  for (const s of (stores ?? []) as Store[]) {
    const ms = diffMs(s.active_until);
    const kind = pickKind(ms);
    if (!kind) continue;

    const msg = buildMessage(s, kind, ms ?? 0);

    // ✅ Ahora soporta d0 también
    const { error: upErr } = await sb
      .from("admin_notifications")
      .upsert(
        {
          store_id: s.id,
          kind,
          title: msg.title,
          body: msg.body,
          expires_at: s.active_until,
          is_read: false,
        },
        { onConflict: "store_id,kind" }
      );

    if (!upErr) upserted++;
  }

  return NextResponse.json({ ok: true, upserted });
}
