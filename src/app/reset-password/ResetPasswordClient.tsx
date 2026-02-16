"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

function scorePassword(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 6);
}

function strengthLabel(score: number) {
  if (score <= 2) return "Débil";
  if (score <= 4) return "Media";
  return "Fuerte";
}

export default function ResetPasswordClient() {
  const router = useRouter();
  const search = useSearchParams();

  const [ready, setReady] = useState(false);
  const [show, setShow] = useState(false);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const strength = useMemo(() => scorePassword(password), [password]);
  const same = password.length > 0 && password === password2;

  useEffect(() => {
    (async () => {
      try {
        const sb = supabaseBrowser();

        const code = search.get("code");
        if (code) {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg("❌ Link inválido o expirado. Pide otro correo de recuperación.");
            setReady(false);
            return;
          }
        }

        const { data } = await sb.auth.getSession();
        if (!data.session) {
          setMsg("❌ No hay sesión de recuperación. Abre esta página desde el link del correo.");
          setReady(false);
          return;
        }

        setReady(true);
      } catch (e: any) {
        setMsg("❌ Error: " + (e?.message ?? "desconocido"));
        setReady(false);
      }
    })();
  }, [search]);

  async function updatePass(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (password.length < 6) return setMsg("❌ La contraseña debe tener al menos 6 caracteres.");
    if (!same) return setMsg("❌ Las contraseñas no coinciden.");

    setLoading(true);

    try {
      const sb = supabaseBrowser();

      const { error } = await sb.auth.updateUser({ password });
      if (error) {
        setMsg("❌ " + error.message);
        return;
      }

      setMsg("✅ Contraseña cambiada. Ahora inicia sesión.");

      await sb.auth.signOut();
      document.cookie = "app_session=; path=/; max-age=0";

      setTimeout(() => router.push("/login"), 900);
    } catch (e: any) {
      setMsg("❌ Error: " + (e?.message ?? "desconocido"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6 text-[color:var(--t-text)]"
      style={{
        background: "var(--t-bg-base)",
      }}
    >
      {/* Fondo (auto claro/oscuro con tokens) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div className="absolute inset-0 starfield opacity-[0.55]" />
        <div
          className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full blur-3xl opacity-[0.18]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--t-accent) 55%, transparent), transparent 62%)",
          }}
        />
        <div
          className="absolute inset-x-0 top-0 h-44"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in oklab, var(--t-bg-base) 0%, black 22%), transparent)",
          }}
        />
      </div>

      <div
        className="w-full max-w-md rounded-2xl border p-6 backdrop-blur-xl"
        style={{
          borderColor: "var(--t-card-border)",
          background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
          boxShadow: "0 24px 70px color-mix(in oklab, black 42%, transparent)",
        }}
      >
        <h1 className="text-2xl font-bold">Crear nueva contraseña</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
          Abre esta página desde el enlace que llegó a tu correo.
        </p>

        {!ready ? (
          <div
            className="mt-6 rounded-xl border p-4 text-sm"
            style={{
              borderColor: "var(--t-card-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
              color: "var(--t-text)",
            }}
          >
            {msg ?? "Validando enlace..."}
          </div>
        ) : (
          <form onSubmit={updatePass} className="mt-6 space-y-3">
            <div>
              <label className="text-sm" style={{ color: "var(--t-muted)" }}>
                Nueva contraseña
              </label>

              <div className="mt-1 flex gap-2">
                <input
                  className="w-full rounded-xl border p-3 outline-none"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                    color: "var(--t-text)",
                  }}
                  placeholder="Nueva contraseña"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />

                <button
                  type="button"
                  className="rounded-xl border px-3 backdrop-blur-xl"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
                    color: "var(--t-text)",
                  }}
                  onClick={() => setShow((s) => !s)}
                >
                  {show ? "🙈" : "👁️"}
                </button>
              </div>

              <div className="mt-2">
                <div
                  className="h-2 w-full rounded-full"
                  style={{
                    background: "color-mix(in oklab, var(--t-card-border) 40%, transparent)",
                  }}
                >
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${(strength / 6) * 100}%`,
                      background: "var(--t-cta)",
                      boxShadow: "0 0 0 6px color-mix(in oklab, var(--t-cta) 14%, transparent)",
                    }}
                  />
                </div>

                <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                  Seguridad:{" "}
                  <b style={{ color: "var(--t-text)" }}>{strengthLabel(strength)}</b> (usa mayúsculas, números y
                  símbolos)
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm" style={{ color: "var(--t-muted)" }}>
                Repite la contraseña
              </label>

              <input
                className="mt-1 w-full rounded-xl border p-3 outline-none"
                style={{
                  borderColor: "var(--t-card-border)",
                  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                  color: "var(--t-text)",
                }}
                placeholder="Repite la contraseña"
                type={show ? "text" : "password"}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={6}
              />

              {password2.length > 0 && (
                <p
                  className="mt-1 text-xs"
                  style={{
                    color: same
                      ? "color-mix(in oklab, var(--t-success, #22c55e) 70%, var(--t-text))"
                      : "color-mix(in oklab, var(--t-danger, #ef4444) 70%, var(--t-text))",
                  }}
                >
                  {same ? "✅ Coinciden" : "❌ No coinciden"}
                </p>
              )}
            </div>

            <button
              disabled={loading}
              className="w-full rounded-xl border p-3 font-semibold disabled:opacity-60"
              style={{
                borderColor: "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))",
                background: "color-mix(in oklab, var(--t-cta) 22%, transparent)",
                color: "color-mix(in oklab, var(--t-text) 95%, transparent)",
                boxShadow: "0 18px 45px color-mix(in oklab, var(--t-cta) 18%, transparent)",
              }}
            >
              {loading ? "Guardando..." : "Cambiar contraseña"}
            </button>

            {msg && (
              <p className="text-sm" style={{ color: "var(--t-text)" }}>
                {msg}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
