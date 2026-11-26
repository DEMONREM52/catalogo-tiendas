"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El cliente de Supabase SIN meterlo en el arranque de la página (~48 kB comprimidos).
 *
 * Úsalo en lo público (catálogo, landing, página de inicio, carrito) y en lo que va en el layout raíz (tema por cuenta):
 * ahí la primera vista llega armada del servidor y Supabase solo hace falta después (más vendidos, ofertas, buscar,
 * cargar más, pedir). El archivo llega aparte, en paralelo, sin frenar la primera vista.
 * Es el MISMO cliente de `supabaseBrowser()` (una sola instancia y una sola sesión): en el panel, que ya lo carga de
 * entrada, esto no descarga nada de más.
 */
let loading: Promise<SupabaseClient> | null = null;

export function supabaseLazy(): Promise<SupabaseClient> {
  if (!loading) {
    loading = import("./client").then((m) => m.supabaseBrowser()).catch((e: unknown) => {
      // Sin internet al pedir el archivo: el próximo intento lo vuelve a pedir.
      loading = null;
      throw e;
    });
  }
  return loading;
}
