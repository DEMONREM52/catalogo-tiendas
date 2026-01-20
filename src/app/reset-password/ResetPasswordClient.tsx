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
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/20 p-6">
        <h1 className="text-2xl font-bold">Crear nueva contraseña</h1>
        <p className="mt-2 text-sm opacity-80">
          Abre esta página desde el enlace que llegó a tu correo.
        </p>

        {!ready ? (
          <div className="mt-6 rounded-xl border border-white/10 p-4 text-sm">
            {msg ?? "Validando enlace..."}
          </div>
        ) : (
          <form onSubmit={updatePass} className="mt-6 space-y-3">
            <div>
              <label className="text-sm opacity-80">Nueva contraseña</label>

              <div className="mt-1 flex gap-2">
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                  placeholder="Nueva contraseña"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  className="rounded-xl border border-white/10 px-3"
                  onClick={() => setShow((s) => !s)}
                >
                  {show ? "🙈" : "👁️"}
                </button>
              </div>

              <div className="mt-2">
                <div className="h-2 w-full rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-white/60"
                    style={{ width: `${(strength / 6) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-xs opacity-80">
                  Seguridad: <b>{strengthLabel(strength)}</b> (usa mayúsculas, números y símbolos)
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm opacity-80">Repite la contraseña</label>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                placeholder="Repite la contraseña"
                type={show ? "text" : "password"}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={6}
              />

              {password2.length > 0 && (
                <p className="mt-1 text-xs">{same ? "✅ Coinciden" : "❌ No coinciden"}</p>
              )}
            </div>

            <button
              disabled={loading}
              className="w-full rounded-xl bg-white text-black p-3 font-semibold disabled:opacity-60"
            >
              {loading ? "Guardando..." : "Cambiar contraseña"}
            </button>

            {msg && <p className="text-sm">{msg}</p>}
          </form>
        )}
      </div>
    </main>
  );
}