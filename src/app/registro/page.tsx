"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCTION_HOST } from "@/lib/share/origin";
import { captureReferral, clearReferral, readReferral } from "@/lib/saas/referral";

/**
 * Registro público de RemHub en 2 pasos:
 *   1) Crear la cuenta: correo y contraseña, o Google (si está activado en Supabase).
 *   2) Crear la tienda: nombre, subdominio y WhatsApp; empieza gratis o probando el plan superior.
 * La tienda la crea la base (saas_signup_create_store) con quien inició sesión como dueño. Necesita 20261211 y 20261212.
 *
 * Proveedores: NEXT_PUBLIC_AUTH_GOOGLE=1 / NEXT_PUBLIC_AUTH_FACEBOOK=1 muestran el botón cuando ya están configurados en
 * Supabase → Authentication → Providers (no son secretos: solo encienden el botón).
 */

const GOOGLE = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1";
const FACEBOOK = process.env.NEXT_PUBLIC_AUTH_FACEBOOK === "1";
const slugify = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const card = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" };
const input = "w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2";
const inputStyle = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" };

export default function RegisterPage() {
  return <Suspense fallback={null}><Register /></Suspense>;
}

function Register() {
  const router = useRouter();
  const params = useSearchParams();
  const wantsFree = params.get("plan") === "gratis";
  const [step, setStep] = useState<"loading" | "account" | "check_email" | "store">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<{ ok: boolean | null; reason?: string }>({ ok: null });
  const [wa, setWa] = useState("");
  const [trial, setTrial] = useState(!wantsFree);
  const slugReq = useRef(0);

  // ¿Ya tiene sesión? ¿Ya tiene tienda? (también al volver de Google o del correo de confirmación)
  useEffect(() => {
    const sb = supabaseBrowser();
    const decide = async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) return setStep("account");
      const { data: st } = await sb.rpc("saas_my_store_status");
      const s = st as { owned?: unknown; member?: unknown; is_platform_admin?: boolean } | null;
      document.cookie = `app_session=${data.session.access_token}; path=/; max-age=604800`;
      if (s?.owned || s?.member || s?.is_platform_admin) return router.replace(s?.is_platform_admin ? "/admin" : "/dashboard");
      setEmail(data.session.user.email ?? "");
      setStep("store");
    };
    void decide();
    const { data: sub } = sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN") void decide(); });
    captureReferral();
    void sb.rpc("saas_track", { p_kind: "signup_start", p_store: null, p_detail: { plan: params.get("plan"), ref: readReferral() } });
    return () => sub.subscription.unsubscribe();
  }, [router, params]);

  // Subdominio revisado en vivo (se sugiere desde el nombre mientras no lo cambien a mano).
  useEffect(() => {
    if (step !== "store" || !slug) return;
    const my = ++slugReq.current;
    const t = window.setTimeout(async () => {
      const { data } = await supabaseBrowser().rpc("store_slug_available", { p_slug: slug });
      if (my !== slugReq.current) return;
      const r = data as { ok?: boolean; reason?: string } | null;
      setSlugState({ ok: r ? Boolean(r.ok) : null, reason: r?.reason });
    }, 350);
    return () => window.clearTimeout(t);
  }, [slug, step]);

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password.length < 8) return setMsg("La contraseña debe tener al menos 8 caracteres.");
    setBusy(true);
    const { data, error } = await supabaseBrowser().auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/registro${wantsFree ? "?plan=gratis" : ""}` },
    });
    setBusy(false);
    if (error) return setMsg(/registered|already/i.test(error.message) ? "Ese correo ya tiene cuenta. Inicia sesión." : error.message);
    // Sin confirmación de correo la sesión llega de una vez; con confirmación, hay que revisar el correo.
    if (!data.session) setStep("check_email");
  }

  async function oauth(provider: "google" | "facebook") {
    setMsg(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/registro${wantsFree ? "?plan=gratis" : ""}` },
    });
    if (error) setMsg(`No se pudo entrar con ${provider === "google" ? "Google" : "Facebook"}: ${error.message}`);
  }

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (slugState.ok === false) return setMsg(slugState.reason ?? "Ese subdominio no está disponible.");
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("saas_signup_create_store", { p_name: name, p_slug: slug, p_whatsapp: wa, p_start_trial: trial });
    setBusy(false);
    if (error) return setMsg(/saas_signup_create_store|Could not find/i.test(error.message) ? "El registro todavía no está activo. Escríbenos por WhatsApp." : error.message);
    const r = data as { ok: boolean; error?: string; store_id?: string } | null;
    if (!r?.ok) return setMsg(r?.error ?? "No se pudo crear la tienda.");
    // «Invita y gana»: si llegó por el enlace de otra tienda, queda referida por ella.
    const ref = readReferral();
    if (ref && r.store_id) {
      await supabaseBrowser().rpc("saas_set_referrer", { p_store: r.store_id, p_ref: ref });
      clearReferral();
    }
    router.replace("/dashboard?bienvenida=1");
  }

  return (
    <main className="min-h-screen px-4 py-10" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-2">
        <section>
          <Link href="/" className="text-sm font-black tracking-wide">RemHub</Link>
          <h1 className="mt-4 text-4xl font-black leading-tight">
            Crea tu tienda en <span style={{ background: "var(--t-cta)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>2 minutos</span>
          </h1>
          <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>
            Catálogo con tu enlace, pedidos por WhatsApp, POS e inventario. Empiezas gratis; si quieres, pruebas el plan Negocio 7 días sin tarjeta.
          </p>
          <ol className="mt-6 space-y-2 text-sm">
            {[["1", "Tu cuenta", step === "account" || step === "check_email" || step === "loading"], ["2", "Tu tienda", step === "store"], ["3", "¡A vender!", false]].map(([n, l, on]) => (
              <li key={String(n)} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full text-xs font-black" style={on ? { background: "var(--t-cta)", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>{n}</span>
                <span style={{ opacity: on ? 1 : 0.7 }}>{l}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-[2rem] border p-6 shadow-2xl" style={card}>
          {step === "loading" ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}

          {step === "account" ? (
            <>
              <h2 className="text-2xl font-black">Crea tu cuenta</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Gratis. Sin tarjeta.</p>
              {GOOGLE || FACEBOOK ? (
                <div className="mt-5 space-y-2">
                  {GOOGLE ? <button type="button" onClick={() => void oauth("google")} className="flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "#fff", color: "#111827" }}><span aria-hidden>G</span> Continuar con Google</button> : null}
                  {FACEBOOK ? <button type="button" onClick={() => void oauth("facebook")} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5" style={{ background: "#1877f2" }}>f Continuar con Facebook</button> : null}
                  <p className="py-1 text-center text-xs" style={{ color: "var(--t-muted)" }}>o con tu correo</p>
                </div>
              ) : null}
              <form onSubmit={signUp} className="mt-4 space-y-3">
                <input className={input} style={inputStyle} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tu correo" />
                <input className={input} style={inputStyle} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (mínimo 8)" />
                <button type="submit" disabled={busy} className="btn-cta w-full px-4 py-3 text-sm font-bold disabled:opacity-60">{busy ? "Creando…" : "Crear cuenta"}</button>
              </form>
              <p className="mt-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>¿Ya tienes cuenta? <Link href="/login" className="font-bold underline">Inicia sesión</Link></p>
            </>
          ) : null}

          {step === "check_email" ? (
            <div className="text-center">
              <p className="text-4xl">📬</p>
              <h2 className="mt-2 text-2xl font-black">Revisa tu correo</h2>
              <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>Te enviamos un enlace a <b>{email}</b>. Ábrelo para confirmar tu cuenta y seguir con tu tienda (revisa también spam).</p>
            </div>
          ) : null}

          {step === "store" ? (
            <form onSubmit={createStore} className="space-y-3">
              <h2 className="text-2xl font-black">Tu tienda</h2>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cuenta: {email}</p>
              <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Nombre del negocio
                <input className={`${input} mt-1 font-bold uppercase`} style={inputStyle} required value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} placeholder="EJ: LA VITRINA" maxLength={80} />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Tu dirección
                <div className="mt-1 flex items-center overflow-hidden rounded-2xl border" style={inputStyle}>
                  <input className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm lowercase outline-none" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} placeholder="mi-tienda" aria-label="Subdominio" />
                  <span className="shrink-0 pr-4 text-sm" style={{ color: "var(--t-muted)" }}>.{PRODUCTION_HOST}</span>
                </div>
                <span className="mt-1 block min-h-4 normal-case tracking-normal" style={{ color: slugState.ok ? "#10b981" : slugState.ok === false ? "#ef4444" : "var(--t-muted)" }}>
                  {!slug ? "" : slugState.ok ? `✅ ${slug}.${PRODUCTION_HOST} está libre` : slugState.ok === false ? `❌ ${slugState.reason ?? "No disponible"}` : "Revisando…"}
                </span>
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>WhatsApp de pedidos
                <input className={`${input} mt-1`} style={inputStyle} inputMode="tel" required value={wa} onChange={(e) => setWa(e.target.value)} placeholder="300 123 4567" />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {[[true, "✨ Probar Negocio 7 días", "Todo para varios puntos, gratis por 7 días"], [false, "Empezar gratis", "Hasta 10 productos, sin vencimiento"]].map(([v, t, d]) => (
                  <button key={String(v)} type="button" onClick={() => setTrial(Boolean(v))} className="rounded-2xl border p-3 text-left text-sm transition" style={trial === v ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                    <b className="block">{String(t)}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{String(d)}</span>
                  </button>
                ))}
              </div>
              <button type="submit" disabled={busy || !name.trim() || !slug || slugState.ok === false} className="btn-cta w-full px-4 py-3 text-sm font-bold disabled:opacity-60">{busy ? "Creando tu tienda…" : "Crear mi tienda"}</button>
              <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Al terminar la prueba sigues en el plan Gratis sin perder nada. No te cobramos sin que tú lo pidas.</p>
            </form>
          ) : null}

          {msg ? <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "color-mix(in oklab, #ef4444 45%, transparent)", color: "#ef4444" }}>{msg}</p> : null}
        </section>
      </div>
    </main>
  );
}
