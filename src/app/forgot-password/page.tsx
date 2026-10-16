"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck, MailQuestion, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { RECOVERY_URL, RESEND_SECONDS, authErrorText, isEmail, isProductionOrigin } from "@/lib/auth/recovery";

/** Pide el correo de recuperación. El enlace siempre abre https://remhub.co/reset-password. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(0);
  const notProd = useSyncExternalStore(() => () => {}, () => !isProductionOrigin(window.location.origin), () => false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!isEmail(clean)) return setError("Escribe un correo válido.");
    if (wait > 0) return;
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabaseBrowser().auth.resetPasswordForEmail(clean, { redirectTo: RECOVERY_URL });
      if (err) {
        setError(authErrorText(err.message));
        const secs = err.message.match(/after (\d+)/i)?.[1];
        if (secs) setWait(Number(secs));
        return;
      }
      // Mismo mensaje exista o no la cuenta (no se revela qué correos están registrados).
      setSentTo(clean);
      setWait(RESEND_SECONDS);
    } catch (x) {
      setError(authErrorText(x instanceof Error ? x.message : String(x)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4 sm:p-6" style={{ background: "var(--t-bg-base, #0b0b0b)", color: "var(--t-text, #fff)" }}>
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div className="absolute -top-24 left-1/2 h-120 w-120 -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--t-accent, #8b5cf6) 55%, transparent), transparent 62%)" }} />
      </div>
      <div className="w-full max-w-md rounded-3xl border p-6 shadow-2xl backdrop-blur-xl" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.12))", background: "color-mix(in oklab, var(--t-card-bg, #151515) 88%, transparent)" }}>
        <Link href="/login" className="inline-flex items-center gap-1 text-xs font-semibold opacity-80 hover:opacity-100"><ArrowLeft size={14} /> Volver a iniciar sesión</Link>

        {sentTo ? (
          <div className="mt-4 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}><MailCheck size={26} /></span>
            <h1 className="mt-3 text-2xl font-black">Revisa tu correo</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted, rgba(255,255,255,.7))" }}>
              Si <b style={{ color: "var(--t-text, #fff)" }}>{sentTo}</b> tiene una cuenta en RemHub, te llegará un enlace para crear una contraseña nueva.
            </p>
            <ul className="mt-4 space-y-1.5 rounded-2xl border p-3 text-left text-xs" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.12))", color: "var(--t-muted, rgba(255,255,255,.7))" }}>
              <li>📥 Puede tardar unos minutos. Revisa también <b>Spam</b> o <b>Promociones</b>.</li>
              <li>🔒 El enlace sirve <b>una sola vez</b> y vence en poco tiempo.</li>
              <li>📱 Puedes abrirlo desde cualquier dispositivo.</li>
              <li>👥 ¿Entras con usuario de una tienda (sin correo)? Pídele la clave nueva al administrador.</li>
            </ul>
            {error ? <p className="mt-3 text-sm text-amber-400">{error}</p> : null}
            <button type="button" disabled={wait > 0 || loading} onClick={() => void send()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.12))" }}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {wait > 0 ? `Reenviar en ${wait} s` : "Reenviar el correo"}
            </button>
            <button type="button" onClick={() => { setSentTo(null); setError(null); }} className="mt-2 text-xs font-semibold underline opacity-80">Usar otro correo</button>
          </div>
        ) : (
          <>
            <span className="mt-4 grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}><MailQuestion size={22} /></span>
            <h1 className="mt-3 text-2xl font-black">Recuperar contraseña</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted, rgba(255,255,255,.7))" }}>Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva.</p>
            <form onSubmit={send} className="mt-5 space-y-3" noValidate>
              <input
                className="w-full rounded-xl border p-3 text-base outline-none focus:ring-4"
                style={{ borderColor: error ? "rgba(239,68,68,.6)" : "var(--t-card-border, rgba(255,255,255,.12))", background: "color-mix(in oklab, var(--t-card-bg, #151515) 92%, transparent)", color: "var(--t-text, #fff)" }}
                placeholder="tucorreo@ejemplo.com"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoFocus
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                aria-invalid={Boolean(error)}
              />
              {error ? <p className="text-sm text-red-400" role="alert">{error}</p> : null}
              <button disabled={loading || wait > 0} className="w-full rounded-xl p-3 font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-60" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
                {loading ? "Enviando…" : wait > 0 ? `Espera ${wait} s` : "Enviar enlace"}
              </button>
            </form>
            {notProd ? (
              <p className="mt-4 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-xs">
                ℹ️ Estás en una versión de prueba. El enlace del correo abrirá la versión publicada (<b>remhub.co</b>).
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
