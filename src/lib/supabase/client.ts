"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  // Evita SSR/build (en Vercel el build intenta evaluar imports)
  if (typeof window === "undefined") {
    throw new Error("supabaseBrowser() solo se puede usar en el navegador.");
  }

  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel."
    );
  }

  _client = createClient(url, key);
  return _client;
}
