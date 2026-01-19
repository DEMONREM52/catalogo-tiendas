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

    const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) setMsg("❌ " + error.message);
    else setMsg("✅ Te enviamos un correo para cambiar tu contraseña.");

    setLoading(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/20 p-6">
        <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
        <p className="mt-2 text-sm opacity-80">
          Te enviaremos un correo con el enlace para cambiarla.
        </p>

        <form onSubmit={sendReset} className="mt-6 space-y-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
            placeholder="Correo"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button
            disabled={loading}
            className="w-full rounded-xl bg-white text-black p-3 font-semibold disabled:opacity-60"
          >
            {loading ? "Enviando..." : "Enviar correo"}
          </button>
        </form>

        {msg && <p className="mt-4 text-sm">{msg}</p>}
      </div>
    </main>
  );
}
