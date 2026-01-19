"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    const { data, error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMsg("❌ " + error.message);
      setLoading(false);
      return;
    }

    // Creamos cookie simple para proteger dashboard
    document.cookie = `app_session=${data.session?.access_token}; path=/; max-age=604800`;

    router.push("/dashboard");
    setLoading(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/20 p-6">
        <h1 className="text-2xl font-bold">Iniciar sesión</h1>
        <p className="mt-2 text-sm opacity-80">Accede al panel de tu tienda</p>

        <form onSubmit={handleLogin} className="mt-6 space-y-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
            placeholder="Correo"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button
            disabled={loading}
            className="w-full rounded-xl bg-white text-black p-3 font-semibold disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
          <a className="text-sm underline opacity-80" href="/forgot-password">
            ¿Olvidaste tu contraseña?
          </a>
        </form>

        {msg && <p className="mt-4 text-sm">{msg}</p>}
      </div>
    </main>
  );
}
