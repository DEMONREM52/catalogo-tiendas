"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, LogIn, User, UserRound } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { storeStaffAuthEmail, isValidStoreUsername } from "@/lib/store-user-auth";
import { getDashboardStore } from "@/lib/store-utils";
import { logSessionEvent } from "@/lib/audit-client";

type Status = "checking" | "ready" | "invalid";

const rememberKey = (storeId: string) => `remhub_staff_user_${storeId}`;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** Inicio de sesión con usuario y contraseña para una tienda (enlace /acceso/<tienda>?sid=...). */
export default function StaffLogin({ storeSlug }: { storeSlug: string }) {
  const router = useRouter();
  const slug = storeSlug.trim().toLowerCase();

  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState<Status>("checking");
  const [username, setUsername] = useState("");
  const [lockedUser, setLockedUser] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sid")?.trim() ?? "";
    const prefilled = (params.get("usuario") ?? "").trim();
    let saved = "";
    try {
      saved = sid ? localStorage.getItem(rememberKey(sid)) ?? "" : "";
    } catch {
      saved = "";
    }

    void (async () => {
      if (!sid) {
        setStatus("invalid");
        return;
      }
      try {
        const res = await fetch(`/api/store-team/login-context?slug=${encodeURIComponent(slug)}&store_id=${encodeURIComponent(sid)}`);
        if (!res.ok) throw new Error();
        setStoreId(sid);
        setUsername(prefilled || saved);
        setLockedUser(Boolean(prefilled));
        setStatus("ready");
      } catch {
        setStatus("invalid");
      }
    })();
  }, [slug]);

  function fail(message: string) {
    setError(message);
    setShake((n) => n + 1);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");

    const normalized = username.trim().toLowerCase();
    if (!isValidStoreUsername(normalized)) return fail("Escribe tu usuario (ej. usu01).");
    if (!password) return fail("Escribe tu contraseña.");

    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const { data, error: authError } = await sb.auth.signInWithPassword({
        email: storeStaffAuthEmail(storeId, normalized),
        password,
      });
      if (authError) return fail("Usuario o contraseña incorrectos.");

      const access = await getDashboardStore();
      if (access.store?.id !== storeId || !access.membership?.active) {
        await sb.auth.signOut();
        return fail("Este usuario está desactivado. Solicita que lo reactiven.");
      }

      try {
        if (remember) localStorage.setItem(rememberKey(storeId), normalized);
        else localStorage.removeItem(rememberKey(storeId));
      } catch {
        /* recordar el usuario es solo una comodidad */
      }
      if (data.session?.access_token) {
        document.cookie = `app_session=${data.session.access_token}; path=/; max-age=604800`;
      }
      await logSessionEvent("auth.login", storeId);
      router.push("/dashboard");
    } catch (err: unknown) {
      fail(String((err as Error)?.message ?? "No se pudo iniciar sesión."));
    } finally {
      setLoading(false);
    }
  }

  const field =
    "w-full rounded-2xl border bg-transparent py-3.5 pr-4 text-[15px] outline-none transition focus:border-[color:var(--t-accent)] focus:ring-4 focus:ring-[color:color-mix(in_oklab,var(--t-accent)_20%,transparent)]";
  const fieldStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)", color: "var(--t-text)", paddingLeft: 44 } as const;

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden px-4 py-8 sm:py-12" style={{ color: "var(--t-text)", background: "var(--t-bg-base)" }}>
      {/* Fondo: auroras suaves */}
      <div className="pointer-events-none absolute inset-0 -z-0">
        <motion.div
          className="absolute -left-32 top-[-10%] h-[480px] w-[480px] rounded-full blur-3xl"
          style={{ background: "color-mix(in oklab, var(--t-accent) 30%, transparent)" }}
          animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-32 bottom-[-15%] h-[520px] w-[520px] rounded-full blur-3xl"
          style={{ background: "color-mix(in oklab, var(--t-accent2, #ec4899) 22%, transparent)" }}
          animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 24 }}
        className="relative z-10 w-full max-w-[420px]"
      >
        <div
          className="rounded-[28px] border p-5 sm:p-8"
          style={{
            borderColor: "var(--t-card-border)",
            background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
            backdropFilter: "blur(18px)",
            boxShadow: "0 30px 90px rgba(0,0,0,.35)",
          }}
        >
          {status === "checking" ? (
            <div className="flex flex-col items-center gap-3 py-10" aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--t-accent)" }} />
              <p className="text-sm" style={{ color: "var(--t-muted)" }}>Preparando el acceso…</p>
            </div>
          ) : status === "invalid" ? (
            <div className="py-6 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl" style={{ background: "color-mix(in oklab, #f59e0b 18%, transparent)" }}>
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              </div>
              <h1 className="mt-4 text-xl font-bold">Enlace no válido</h1>
              <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
                Este enlace de acceso está incompleto o ya no es válido. Solicita el enlace de acceso actualizado.
              </p>
            </div>
          ) : (
            <>
              {/* Encabezado neutro: no muestra datos de ninguna tienda */}
              <div className="flex flex-col items-center text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 16 }}
                  className="relative grid h-20 w-20 place-items-center rounded-[26px] text-white shadow-lg"
                  style={{ background: "var(--t-cta)", boxShadow: "0 18px 40px color-mix(in oklab, var(--t-accent) 35%, transparent)" }}
                >
                  <UserRound className="h-9 w-9" strokeWidth={2.2} />
                  <motion.span
                    className="absolute inset-0 rounded-[26px] border-2"
                    style={{ borderColor: "color-mix(in oklab, white 55%, transparent)" }}
                    animate={{ scale: [1, 1.18, 1], opacity: [0.7, 0, 0.7] }}
                    transition={{ duration: 2.8, repeat: Infinity, ease: "easeOut" }}
                  />
                </motion.div>
                <h1 className="mt-6 text-[26px] font-extrabold leading-tight">Iniciar sesión</h1>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                  {greeting()} 👋 Ingresa con tu usuario y contraseña.
                </p>
              </div>

              <motion.form
                key={shake}
                onSubmit={handleLogin}
                animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : undefined}
                transition={{ duration: 0.4 }}
                className="mt-7 space-y-3.5"
              >
                {lockedUser ? (
                  <div className="flex items-center justify-between gap-2 rounded-2xl border px-4 py-3" style={{ ...fieldStyle, paddingLeft: 16 }}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <User className="h-4 w-4 shrink-0" style={{ color: "var(--t-muted)" }} />
                      <span className="truncate text-[15px] font-semibold">{username}</span>
                    </span>
                    <button type="button" onClick={() => setLockedUser(false)} className="text-xs font-semibold underline" style={{ color: "var(--t-accent)" }}>
                      No soy yo
                    </button>
                  </div>
                ) : (
                  <label className="relative block">
                    <span className="sr-only">Usuario</span>
                    <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--t-muted)" }} />
                    <input
                      className={field}
                      style={fieldStyle}
                      placeholder="Tu usuario (ej. usu01)"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus={!username}
                    />
                  </label>
                )}

                <label className="relative block">
                  <span className="sr-only">Contraseña</span>
                  <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--t-muted)" }} />
                  <input
                    className={`${field} pr-12`}
                    style={fieldStyle}
                    placeholder="Contraseña"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                    autoComplete="current-password"
                    autoFocus={Boolean(username)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl transition hover:bg-[color:var(--t-card-bg-soft)]"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </label>
                {capsLock ? <p className="-mt-1 text-xs font-semibold text-amber-500">⇪ Tienes activadas las mayúsculas</p> : null}

                <label className="flex cursor-pointer select-none items-center gap-2 text-sm" style={{ color: "var(--t-muted)" }}>
                  <input type="checkbox" className="h-4 w-4 accent-[color:var(--t-accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Recordar mi usuario en este equipo
                </label>

                <AnimatePresence>
                  {error ? (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      role="alert"
                      className="overflow-hidden rounded-2xl border px-3 py-2.5 text-sm"
                      style={{ borderColor: "color-mix(in oklab, #ef4444 45%, transparent)", background: "color-mix(in oklab, #ef4444 10%, transparent)" }}
                    >
                      {error}
                    </motion.p>
                  ) : null}
                </AnimatePresence>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={loading}
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-bold text-white shadow-lg transition hover:brightness-110 disabled:opacity-70"
                  style={{ background: "var(--t-cta)" }}
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                  {loading ? "Entrando…" : "Entrar"}
                </motion.button>
              </motion.form>

              <p className="mt-5 text-center text-xs" style={{ color: "var(--t-muted)" }}>
                ¿Olvidaste tu contraseña? Solicita una nueva al administrador de tu cuenta.
              </p>
            </>
          )}
        </div>

        <p className="mt-5 text-center text-xs" style={{ color: "var(--t-muted)" }}>
          ¿Tu cuenta usa correo electrónico?{" "}
          <Link href="/login" className="font-semibold underline" style={{ color: "var(--t-text)" }}>
            Iniciar sesión con correo
          </Link>
        </p>
      </motion.section>
    </main>
  );
}
