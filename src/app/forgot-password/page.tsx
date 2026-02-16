"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const sb = supabaseBrowser();

      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) setMsg("❌ " + error.message);
      else setMsg("✅ Te enviamos un correo para cambiar tu contraseña.");
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "Error enviando el correo"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[var(--ap-page-bg)] text-[color:var(--ap-text)]">
      {/* Tokens (auto light/dark) */}
      <style jsx global>{`
        :root {
          --ap-page-bg: #0b0b0b;
          --ap-text: rgba(255, 255, 255, 0.92);
          --ap-muted: rgba(255, 255, 255, 0.72);
          --ap-border: rgba(255, 255, 255, 0.12);
          --ap-card: rgba(255, 255, 255, 0.08);
          --ap-input: rgba(0, 0, 0, 0.28);
          --ap-input2: rgba(0, 0, 0, 0.4);
          --ap-btn-bg: rgba(255, 255, 255, 0.92);
          --ap-btn-text: rgba(0, 0, 0, 0.92);
          --ap-ring: rgba(168, 85, 247, 0.45);
        }

        @media (prefers-color-scheme: light) {
          :root {
            --ap-page-bg: #f7f7fb;
            --ap-text: rgba(17, 24, 39, 0.92);
            --ap-muted: rgba(17, 24, 39, 0.65);
            --ap-border: rgba(17, 24, 39, 0.14);
            --ap-card: rgba(255, 255, 255, 0.9);
            --ap-input: rgba(255, 255, 255, 0.9);
            --ap-input2: rgba(255, 255, 255, 0.95);
            --ap-btn-bg: rgba(17, 24, 39, 0.92);
            --ap-btn-text: rgba(255, 255, 255, 0.95);
            --ap-ring: rgba(124, 58, 237, 0.35);
          }
        }
      `}</style>

      <div
        className="w-full max-w-md rounded-2xl border p-6"
        style={{
          borderColor: "var(--ap-border)",
          background: "var(--ap-card)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ap-muted)" }}>
          Te enviaremos un correo con el enlace para cambiarla.
        </p>

        <form onSubmit={sendReset} className="mt-6 space-y-3">
          <input
            className="w-full rounded-xl border p-3 outline-none"
            style={{
              borderColor: "var(--ap-border)",
              background: "var(--ap-input2)",
              color: "var(--ap-text)",
              boxShadow: "0 0 0 0 rgba(0,0,0,0)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow = `0 0 0 4px var(--ap-ring)`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = "0 0 0 0 rgba(0,0,0,0)";
            }}
            placeholder="Correo"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <button
            disabled={loading}
            className="w-full rounded-xl p-3 font-semibold disabled:opacity-60"
            style={{
              background: "var(--ap-btn-bg)",
              color: "var(--ap-btn-text)",
            }}
          >
            {loading ? "Enviando..." : "Enviar correo"}
          </button>
        </form>

        {msg && (
          <p className="mt-4 text-sm" style={{ color: "var(--ap-text)" }}>
            {msg}
          </p>
        )}
      </div>
    </main>
  );
}
