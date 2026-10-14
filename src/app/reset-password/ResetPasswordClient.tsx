"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, KeyRound, Link2Off, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PasswordStrength } from "@/components/PasswordStrength";
import { authErrorText } from "@/lib/auth/recovery";
import { forgetStaffAccess } from "@/lib/session-resume";

type Status = "checking" | "ready" | "invalid" | "need-link" | "done";
const MIN = 6;

/**
 * Crear contraseña nueva desde el enlace del correo.
 * Acepta los tres formatos de Supabase: token_hash (recomendado), code (PKCE) y #access_token (implícito).
 * Solo deja cambiarla si la sesión viene del enlace de recuperación (nunca con una sesión que ya estaba abierta).
 */
export default function ResetPasswordClient() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [problem, setProblem] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Se leen los datos del enlace ANTES de crear el cliente (el cliente limpia el #hash al iniciar).
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const linkError = query.get("error_description") || hash.get("error_description") || query.get("error") || hash.get("error");
    const tokenHash = query.get("token_hash");
    const code = query.get("code");
    const implicitRecovery = hash.get("type") === "recovery" && Boolean(hash.get("access_token"));
    const clean = () => window.history.replaceState(null, "", "/reset-password");

    void (async () => {
      try {
        const sb = supabaseBrowser();
        if (linkError) {
          clean();
          setProblem(authErrorText(linkError));
          return setStatus("invalid");
        }
        let fromLink = false;
        if (tokenHash) {
          const { error: e } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
          clean();
          if (e) { setProblem(authErrorText(e.message)); return setStatus("invalid"); }
          fromLink = true;
        } else if (code) {
          const { error: e } = await sb.auth.exchangeCodeForSession(code);
          clean();
          if (e) { setProblem(authErrorText(e.message)); return setStatus("invalid"); }
          fromLink = true;
        } else if (implicitRecovery) {
          fromLink = true;
        }
        const { data } = await sb.auth.getSession();
        if (!fromLink || !data.session) {
          // Una sesión abierta normal NO sirve para cambiar la contraseña aquí.
          return setStatus(data.session ? "need-link" : "invalid");
        }
        setAccount(data.session.user.email ?? null);
        setStatus("ready");
      } catch (e) {
        setProblem(authErrorText(e instanceof Error ? e.message : String(e)));
        setStatus("invalid");
      }
    })();
  }, []);

  useEffect(() => {
    if (status !== "done") return;
    const t = window.setTimeout(() => router.push("/login?reset=1"), 3000);
    return () => window.clearTimeout(t);
  }, [status, router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN) return setError(`La contraseña debe tener al menos ${MIN} caracteres.`);
    if (password !== password2) return setError("Las contraseñas no coinciden.");
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error: err } = await sb.auth.updateUser({ password });
      if (err) {
        const text = authErrorText(err.message);
        setError(text);
        if (/venció|ya se usó/.test(text)) setStatus("invalid");
        return;
      }
      // Cierra la sesión en TODOS los dispositivos: quien tenía la clave vieja queda afuera.
      await sb.auth.signOut({ scope: "global" }).catch(() => sb.auth.signOut());
      document.cookie = "app_session=; path=/; max-age=0";
      forgetStaffAccess();
      setStatus("done");
    } catch (x) {
      setError(authErrorText(x instanceof Error ? x.message : String(x)));
    } finally {
      setSaving(false);
    }
  }

  const card = { borderColor: "var(--t-card-border, rgba(255,255,255,.12))", background: "color-mix(in oklab, var(--t-card-bg, #151515) 88%, transparent)" };
  const input = { borderColor: "var(--t-card-border, rgba(255,255,255,.12))", background: "color-mix(in oklab, var(--t-card-bg, #151515) 92%, transparent)", color: "var(--t-text, #fff)" };
  const muted = { color: "var(--t-muted, rgba(255,255,255,.7))" };
  const same = password2.length > 0 && password === password2;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4 sm:p-6" style={{ background: "var(--t-bg-base, #0b0b0b)", color: "var(--t-text, #fff)" }}>
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div className="absolute -top-24 left-1/2 h-120 w-120 -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--t-accent, #8b5cf6) 55%, transparent), transparent 62%)" }} />
      </div>
      <div className="w-full max-w-md rounded-3xl border p-6 shadow-2xl backdrop-blur-xl" style={card}>
        {status === "checking" ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Loader2 size={28} className="animate-spin" />
            <p className="mt-3 text-sm" style={muted}>Validando el enlace…</p>
          </div>
        ) : status === "done" ? (
          <div className="py-4 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}><CheckCircle2 size={26} /></span>
            <h1 className="mt-3 text-2xl font-black">¡Contraseña cambiada!</h1>
            <p className="mt-2 text-sm" style={muted}>Por seguridad cerramos la sesión en todos tus dispositivos. Entra con tu contraseña nueva.</p>
            <Link href="/login?reset=1" className="mt-5 inline-flex w-full justify-center rounded-xl p-3 font-bold text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>Iniciar sesión</Link>
          </div>
        ) : status === "invalid" || status === "need-link" ? (
          <div className="py-2 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}><Link2Off size={26} /></span>
            <h1 className="mt-3 text-2xl font-black">{status === "need-link" ? "Abre el enlace del correo" : "Este enlace no sirve"}</h1>
            <p className="mt-2 text-sm" style={muted}>
              {status === "need-link"
                ? "Para cambiar la contraseña tienes que entrar desde el enlace que te enviamos por correo."
                : problem ?? "El enlace venció, ya se usó o está incompleto. Pide un correo nuevo: los enlaces sirven una sola vez."}
            </p>
            <Link href="/forgot-password" className="mt-5 inline-flex w-full justify-center rounded-xl p-3 font-bold text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>Pedir un enlace nuevo</Link>
            <Link href="/login" className="mt-2 inline-block text-xs font-semibold underline opacity-80">Volver a iniciar sesión</Link>
          </div>
        ) : (
          <>
            <span className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}><KeyRound size={22} /></span>
            <h1 className="mt-3 text-2xl font-black">Crea tu contraseña nueva</h1>
            {account ? <p className="mt-1 text-sm" style={muted}>Para la cuenta <b style={{ color: "var(--t-text, #fff)" }}>{account}</b></p> : null}
            <form onSubmit={save} className="mt-5 space-y-3" noValidate>
              <label className="block">
                <span className="text-sm" style={muted}>Contraseña nueva</span>
                <div className="mt-1 flex gap-2">
                  <input className="w-full rounded-xl border p-3 text-base outline-none" style={input} type={show ? "text" : "password"} autoComplete="new-password" autoFocus value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} minLength={MIN} />
                  <button type="button" onClick={() => setShow((s) => !s)} className="grid w-12 shrink-0 place-items-center rounded-xl border" style={input} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <PasswordStrength password={password} hints={[account]} className="mt-2" />
              </label>
              <label className="block">
                <span className="text-sm" style={muted}>Repite la contraseña</span>
                <input className="mt-1 w-full rounded-xl border p-3 text-base outline-none" style={input} type={show ? "text" : "password"} autoComplete="new-password" value={password2} onChange={(e) => { setPassword2(e.target.value); setError(null); }} minLength={MIN} />
                {password2 ? <span className={`mt-1 block text-xs ${same ? "text-emerald-400" : "text-red-400"}`}>{same ? "✓ Coinciden" : "No coinciden"}</span> : null}
              </label>
              {error ? <p className="text-sm text-red-400" role="alert">{error}</p> : null}
              <button disabled={saving || password.length < MIN || !same} className="w-full rounded-xl p-3 font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
                {saving ? "Guardando…" : "Cambiar contraseña"}
              </button>
              <p className="text-center text-[11px]" style={muted}>Mínimo {MIN} caracteres. Al cambiarla se cierra la sesión en todos tus dispositivos.</p>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
