"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMsg("❌ " + error.message);
        setLoading(false);
        return;
      }

      // Cookie simple (opcional, solo para UX)
      if (data.session?.access_token) {
        document.cookie = `app_session=${data.session.access_token}; path=/; max-age=604800`;
      }

      router.push("/dashboard");
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "Error iniciando sesión"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-10 text-[color:var(--t-text)]">
      {/* Fondo con starfield + glow (usa tus tokens) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg)" }} />
        <div className="absolute inset-0 starfield opacity-[0.55]" />

        {/* glow suave extra (se siente igual que landing/dashboard) */}
        <div
          className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full blur-3xl opacity-[0.22]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--t-accent) 55%, transparent), transparent 60%)",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/25 to-transparent" />
      </div>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        {/* Lado izquierdo: copy */}
        <section className="px-1 lg:px-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur-xl">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: "var(--t-accent)",
                boxShadow:
                  "0 0 0 6px color-mix(in oklab, var(--t-accent) 18%, transparent)",
              }}
            />
            Accede al panel de tu tienda
          </div>

          <h1 className="mt-4 text-4xl font-bold leading-tight md:text-5xl">
            Inicia sesión y{" "}
            <span
              style={{
                background: "var(--t-cta)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              publica tu catálogo
            </span>
            .
          </h1>

          <p className="mt-4 max-w-xl text-sm opacity-80 md:text-base">
            Administra productos, categorías, pedidos y tu tema visual. Comparte tu link y recibe
            pedidos por WhatsApp.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs opacity-80 backdrop-blur-xl">
              ✅ Link para compartir
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs opacity-80 backdrop-blur-xl">
              ✅ Pedidos organizados
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs opacity-80 backdrop-blur-xl">
              ✅ Factura PDF
            </span>
          </div>
        </section>

        {/* Lado derecho: card login */}
        <section className="glass mx-auto w-full max-w-md p-6 md:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Iniciar sesión</h2>
              <p className="mt-1 text-sm opacity-80">Accede al panel de tu tienda</p>
            </div>

            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold opacity-80">
              Premium
            </span>
          </div>

          <form onSubmit={handleLogin} className="mt-6 space-y-3">
            <div>
              <label className="text-xs opacity-70">Correo</label>
              <input
                className="ring-focus mt-1 w-full px-4 py-3"
                placeholder="tucorreo@ejemplo.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs opacity-70">Contraseña</label>

              {/* ✅ wrapper para botón ojo */}
              <div className="relative mt-1">
                <input
                  className="ring-focus w-full px-4 py-3 pr-12"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold opacity-90 backdrop-blur-xl hover:bg-white/10"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>

              <p className="mt-1 text-[11px] opacity-60">
                {showPassword ? "Mostrando contraseña" : "Oculta por seguridad"}
              </p>
            </div>

            <button
              disabled={loading}
              className="btn-cta w-full px-4 py-3 text-sm font-semibold disabled:opacity-60"
              type="submit"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <div className="flex items-center justify-between gap-2">
              <a className="btn-soft px-4 py-2 text-xs font-semibold" href="/forgot-password">
                ¿Olvidaste tu contraseña?
              </a>

              <a className="text-xs opacity-70 underline" href="/">
                Volver al inicio
              </a>
            </div>
          </form>

          {msg ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
              {msg}
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs opacity-75">
            💡 Tip: si estás probando mayoristas, guarda tu <b>wholesale_key</b> en “Mi tienda” para
            abrir el catálogo con link directo.
          </div>
        </section>
      </div>
    </main>
  );
}
