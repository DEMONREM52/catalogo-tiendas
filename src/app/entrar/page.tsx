"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { logSessionEvent } from "@/lib/audit-client";

const NEXT = /^\/dashboard(\/[A-Za-z0-9/_-]*)?(\?[^#\s<>"']*)?$/;

/**
 * Canjea el pase de un solo uso (viene después de «#» desde remhub.co) y abre el panel en el espacio de la tienda.
 * Esta sesión es solo de este subdominio.
 */
export default function EnterPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("t");
    const rawNext = params.get("n") ?? "/dashboard";
    const next = NEXT.test(rawNext) ? rawNext : "/dashboard";
    // El pase no queda en el historial ni en la barra de direcciones.
    window.history.replaceState(null, "", "/entrar");
    if (!token) {
      void supabaseBrowser().auth.getSession().then(({ data }) => {
        if (data.session) window.location.replace(next);
        else setError("Este enlace de ingreso no es válido.");
      });
      return;
    }
    void (async () => {
      const sb = supabaseBrowser();
      const { data, error: verifyError } = await sb.auth.verifyOtp({ token_hash: token, type: "magiclink" });
      if (verifyError || !data.session) {
        setError("El pase venció o ya se usó. Entra de nuevo con tu usuario.");
        return;
      }
      document.cookie = `app_session=${data.session.access_token}; path=/; max-age=604800; samesite=lax; secure`;
      await logSessionEvent("auth.login", null);
      window.location.replace(next);
    })();
  }, []);

  return (
    <main className="grid min-h-screen place-items-center px-4" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="w-full max-w-sm rounded-3xl border p-6 text-center" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        {error ? (
          <>
            <p className="text-lg font-black">No pudimos abrir tu espacio</p>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>{error}</p>
            <Link href="/login" className="mt-5 inline-flex rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: "var(--t-accent)" }}>
              Entrar con mi usuario
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto animate-spin" size={28} />
            <p className="mt-3 text-sm font-bold">Abriendo tu espacio…</p>
          </>
        )}
      </div>
    </main>
  );
}
