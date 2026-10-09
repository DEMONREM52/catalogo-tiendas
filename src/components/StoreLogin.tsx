"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { storeStaffAuthEmail, storeStaffAuthPassword, isValidStoreUsername } from "@/lib/store-user-auth";
import { getDashboardStore } from "@/lib/store-utils";
import { logSessionEvent } from "@/lib/audit-client";

export default function StoreLogin({ storeSlug }: { storeSlug?: string }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [storeLogin, setStoreLogin] = useState<{ slug: string; id: string } | null>(() =>
    storeSlug ? { slug: storeSlug.trim().toLowerCase(), id: "" } : null,
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = storeSlug?.trim().toLowerCase() ?? params.get("tienda")?.trim().toLowerCase();
    const id = params.get("sid")?.trim();
    const prefilledUsername = params.get("usuario") ?? "";

    const resolvedSlug = storeSlug?.trim().toLowerCase() ?? slug;
    if (resolvedSlug) {
      setStoreLogin({ slug: resolvedSlug, id: id ?? "" });
      setUsername(prefilledUsername);
      if (!id) setMsg("El enlace de acceso está incompleto. Solicita el enlace actualizado al administrador de la tienda.");
    }
  }, [storeSlug]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const sb = supabaseBrowser();
      let loginEmail = email.trim();

      if (storeLogin) {
        if (!storeLogin.id) {
          throw new Error("Este enlace no identifica la tienda. Solicita el enlace actualizado al administrador.");
        }
        const normalizedUsername = username.trim().toLowerCase();
        if (!isValidStoreUsername(normalizedUsername)) {
          throw new Error("Escribe el usuario interno que te entregó el administrador de la tienda.");
        }

        const contextResponse = await fetch(
          `/api/store-team/login-context?slug=${encodeURIComponent(storeLogin.slug)}&store_id=${encodeURIComponent(storeLogin.id)}`,
        );
        const context = await contextResponse.json();
        if (!contextResponse.ok) {
          throw new Error(
            context.error ??
              "Este enlace de acceso no corresponde a la tienda. Solicita el enlace actualizado al administrador.",
          );
        }
        loginEmail = storeStaffAuthEmail(storeLogin.id, normalizedUsername);
      }

      const { data, error } = await sb.auth.signInWithPassword({
        email: loginEmail,
        // Los trabajadores pueden tener contraseñas cortas (desde 4); se completan igual que al crearlas.
        password: storeLogin ? storeStaffAuthPassword(password) : password,
      });

      if (error) {
        setMsg(storeLogin
          ? "❌ Usuario o contraseña incorrectos. Verifica también que tu acceso siga activo."
          : "❌ " + error.message);
        setLoading(false);
        return;
      }

      if (storeLogin) {
        const access = await getDashboardStore();
        if (access.store?.id !== storeLogin.id || !access.membership?.active) {
          await sb.auth.signOut();
          throw new Error("Este usuario no tiene un acceso activo para la tienda del enlace.");
        }
      }

      // Cookie simple (opcional, solo para UX)
      if (data.session?.access_token) {
        document.cookie = `app_session=${data.session.access_token}; path=/; max-age=604800`;
      }

      await logSessionEvent("auth.login", storeLogin?.id ?? null);
      router.push("/dashboard");
    } catch (e: unknown) {
      setMsg("❌ " + String((e as Error)?.message ?? "Error iniciando sesión"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-10 text-[color:var(--t-text)]">
      {/* Fondo con starfield + glow (usa tus tokens, auto claro/oscuro) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div className="absolute inset-0 starfield" />

        {/* glow suave extra (auto por tokens) */}
        <div
          className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full blur-3xl opacity-[0.22]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--t-accent) 55%, transparent), transparent 60%)",
          }}
        />

        {/* top fade (auto: en light casi imperceptible, en dark sí se nota) */}
        <div
          className="absolute inset-x-0 top-0 h-44"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--t-bg-base) 0%, black 25%), transparent)",
          }}
        />
      </div>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        {/* Lado izquierdo: copy */}
        <section className="px-1 lg:px-0">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur-xl"
            style={{
              borderColor: "var(--t-card-border)",
              background: "var(--t-card-bg)",
              color: "color-mix(in oklab, var(--t-text) 85%, transparent)",
            }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: "var(--t-accent)",
                boxShadow: "0 0 0 6px color-mix(in oklab, var(--t-accent) 18%, transparent)",
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

          <p className="mt-4 max-w-xl text-sm md:text-base" style={{ color: "var(--t-muted)" }}>
            Administra productos, categorías, pedidos y tu tema visual. Comparte tu link y recibe
            pedidos por WhatsApp.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {["✅ Link para compartir", "✅ Pedidos organizados", "✅ Factura PDF"].map((t) => (
              <span
                key={t}
                className="rounded-full border px-3 py-1 text-xs backdrop-blur-xl"
                style={{
                  borderColor: "var(--t-card-border)",
                  background: "var(--t-card-bg)",
                  color: "color-mix(in oklab, var(--t-text) 80%, transparent)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* Lado derecho: card login */}
        <section className="glass mx-auto w-full max-w-md p-6 md:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Iniciar sesión</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                Accede al panel de tu tienda
              </p>
            </div>

            <span
              className="rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur-xl"
              style={{
                borderColor: "var(--t-card-border)",
                background: "var(--t-card-bg)",
                color: "color-mix(in oklab, var(--t-text) 80%, transparent)",
              }}
            >
              Premium
            </span>
          </div>

          <form onSubmit={handleLogin} className="mt-6 space-y-3">
            <div>
              <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                {storeLogin ? "Usuario de la tienda" : "Correo"}
              </label>
              <input
                className="ring-focus mt-1 w-full px-4 py-3"
                style={{
                  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                  border: "1px solid var(--t-card-border)",
                  borderRadius: "16px",
                  color: "var(--t-text)",
                }}
                placeholder={storeLogin ? "Ej. USU01" : "tucorreo@ejemplo.com"}
                type={storeLogin ? "text" : "email"}
                value={storeLogin ? username : email}
                onChange={(e) => storeLogin ? setUsername(e.target.value) : setEmail(e.target.value)}
                required
                autoComplete={storeLogin ? "username" : "email"}
                autoCapitalize={storeLogin ? "none" : undefined}
              />
              {storeLogin ? (
                <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                  Acceso privado para {storeLogin.slug}.
                </p>
              ) : null}
            </div>

            <div>
              <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                Contraseña
              </label>

              {/* ✅ wrapper para botón ojo */}
              <div className="relative mt-1">
                <input
                  className="ring-focus w-full px-4 py-3 pr-12"
                  style={{
                    background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                    border: "1px solid var(--t-card-border)",
                    borderRadius: "16px",
                    color: "var(--t-text)",
                  }}
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur-xl transition"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "var(--t-card-bg)",
                    color: "color-mix(in oklab, var(--t-text) 88%, transparent)",
                  }}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>

              <p className="mt-1 text-[11px]" style={{ color: "color-mix(in oklab, var(--t-muted) 90%, transparent)" }}>
                {showPassword ? "Mostrando contraseña" : "Oculta por seguridad"}
              </p>
            </div>

            <button
              disabled={loading || Boolean(storeLogin && !storeLogin.id)}
              className="btn-cta w-full px-4 py-3 text-sm font-semibold disabled:opacity-60"
              type="submit"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <div className="flex items-center justify-between gap-2">
              {storeLogin ? (
                <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                  ¿Olvidaste la clave? Pídele al administrador que te asigne una nueva.
                </span>
              ) : (
                <Link className="btn-soft px-4 py-2 text-xs font-semibold" href="/forgot-password">
                  ¿Olvidaste tu contraseña?
                </Link>
              )}

              <Link className="text-xs underline" style={{ color: "var(--t-muted)" }} href="/">
                Volver al inicio
              </Link>
            </div>
          </form>

          {!storeLogin ? (
            <p className="mt-4 text-xs" style={{ color: "var(--t-muted)" }}>
              🔑 ¿Tienes usuario en lugar de correo? Entra con el <b>enlace de acceso</b> de tu tienda.
            </p>
          ) : null}

          {msg ? (
            <div
              className="mt-4 rounded-2xl border p-3 text-sm"
              style={{
                borderColor: "var(--t-card-border)",
                background: "var(--t-card-bg)",
                color: "var(--t-text)",
              }}
            >
              {msg}
            </div>
          ) : null}

          <div
            className="mt-5 rounded-2xl border p-4 text-xs"
            style={{
              borderColor: "var(--t-card-border)",
              background: "var(--t-card-bg)",
              color: "color-mix(in oklab, var(--t-text) 80%, transparent)",
            }}
          >
            💡 Tip: si estás probando mayoristas, guarda tu <b>wholesale_key</b> en “Mi tienda” para
            abrir el catálogo con link directo.
          </div>
        </section>
      </div>
    </main>
  );
}
