"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Boxes, CreditCard, Eye, EyeOff, KeyRound, Lock, LogIn, Mail, ShieldCheck, Sparkles, Store, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { storeStaffAuthEmail, storeStaffAuthPassword, isValidStoreUsername } from "@/lib/store-user-auth";
import { forgetStaffAccess, resumeExistingSession } from "@/lib/session-resume";
import { getDashboardStore } from "@/lib/store-utils";
import { logSessionEvent } from "@/lib/audit-client";
import { currentStoreSubdomain } from "@/lib/store-space";

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

  // Ingreso del dueño: si ya hay una sesión guardada (ej. al abrir la app instalada), entra directo al panel.
  // En el espacio de la tienda (lavitrina.remhub.co/login): se muestra a qué tienda se entra.
  const [space, setSpace] = useState<{ name: string; logo_url: string | null } | null>(null);
  useEffect(() => {
    const sub = currentStoreSubdomain();
    if (!sub) return;
    void supabaseBrowser().rpc("store_public_home", { p_slug: sub }).then(({ data }) => {
      const home = data as { name?: string; logo_url?: string | null } | null;
      if (home?.name) setSpace({ name: home.name, logo_url: home.logo_url ?? null });
    });
  }, []);

  useEffect(() => {
    // Salir desde el espacio de una tienda: también se cierra la sesión de remhub.co en este equipo.
    if (new URLSearchParams(window.location.search).get("salir") === "1") {
      void supabaseBrowser().auth.signOut({ scope: "local" });
      document.cookie = "app_session=; path=/; max-age=0";
      window.history.replaceState(null, "", "/login");
      return;
    }
    if (storeSlug || new URLSearchParams(window.location.search).get("tienda")) return;
    let alive = true;
    void resumeExistingSession().then((ok) => {
      if (ok && alive) router.replace(nextDashboardPath(new URLSearchParams(window.location.search).get("next")));
    });
    return () => {
      alive = false;
    };
  }, [storeSlug, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = storeSlug?.trim().toLowerCase() ?? params.get("tienda")?.trim().toLowerCase();
    const id = params.get("sid")?.trim();
    const prefilledUsername = params.get("usuario") ?? "";
    if (params.get("reset") === "1") setMsg("✅ Contraseña cambiada. Inicia sesión con tu contraseña nueva.");

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
      // Ingreso del dueño (correo): la app del panel abre la tienda madre, no un enlace de trabajador.
      if (!storeLogin) forgetStaffAccess();
      router.push(nextDashboardPath(new URLSearchParams(window.location.search).get("next")));
    } catch (e: unknown) {
      setMsg("❌ " + String((e as Error)?.message ?? "Error iniciando sesión"));
    } finally {
      setLoading(false);
    }
  }

  const ok = Boolean(msg && msg.startsWith("✅"));
  const fieldStyle = {
    background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)",
    border: "1px solid var(--t-card-border)",
    color: "var(--t-text)",
  } as const;
  // Las casillas van «sin caja» dentro del recuadro (los estilos globales de input les ponen borde, fondo y relleno).
  const bare = { background: "transparent", border: "none", boxShadow: "none", padding: 0, minHeight: 0, borderRadius: 0, outline: "none" } as const;

  return (
    <main className="relative min-h-screen overflow-hidden text-[color:var(--t-text)]" style={{ background: "var(--t-bg-base)" }}>
      {/* Fondo: degradados suaves de la marca */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 starfield opacity-60" />
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in oklab, #d946ef 32%, transparent), transparent 65%)" }} />
        <div className="absolute -bottom-48 right-[-120px] h-[620px] w-[620px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in oklab, #6366f1 30%, transparent), transparent 65%)" }} />
      </div>

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 py-8 lg:grid-cols-[1.15fr_.85fr] lg:py-12">
        {/* Lado izquierdo: la marca y lo que hace RemHub */}
        <section className="order-2 min-w-0 lg:order-1">
          <Link href="/" className="inline-flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/remhub-icon-64.png" alt="" className="h-10 w-10 rounded-xl shadow-lg" />
            <span className="text-lg font-black tracking-tight">RemHub</span>
          </Link>

          <h1 className="mt-8 text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
            Tu negocio,{" "}
            <span style={{ background: "var(--t-cta)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              en un solo lugar
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-base md:text-lg" style={{ color: "var(--t-muted)" }}>
            Catálogos con tu enlace, pedidos por WhatsApp, POS, inventario por punto y tus números al día.
          </p>

          <ul className="mt-8 grid max-w-lg gap-3 sm:grid-cols-2">
            {[
              [Store, "Catálogos y pedidos", "Un enlace para cada público"],
              [CreditCard, "POS y caja", "Vende en cada punto"],
              [Boxes, "Inventario serio", "Bodegas, traslados y kardex"],
              [BarChart3, "Rentabilidad", "Cuánto ganas, en vivo"],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof Store;
              return (
                <li key={String(title)} className="flex items-start gap-3 rounded-2xl border p-3 backdrop-blur-xl" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 55%, transparent)" }}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-md" style={{ background: "var(--t-cta)" }}><I size={18} /></span>
                  <span>
                    <b className="block text-sm">{String(title)}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{String(text)}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-8 flex items-center gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
            <ShieldCheck size={15} className="text-emerald-500" /> Cada tienda solo ve su información y cada usuario solo lo que le permites.
          </p>
        </section>

        {/* Lado derecho: tarjeta de ingreso */}
        <section className="order-1 mx-auto w-full min-w-0 max-w-md lg:order-2">
          <div className="relative rounded-[28px] p-[1.5px] shadow-2xl" style={{ background: "linear-gradient(140deg, color-mix(in oklab, #d946ef 70%, transparent), color-mix(in oklab, var(--t-card-border) 80%, transparent) 40%, color-mix(in oklab, #6366f1 70%, transparent))" }}>
            <div className="rounded-[calc(28px-1.5px)] p-6 backdrop-blur-2xl sm:p-8" style={{ background: "color-mix(in oklab, var(--t-bg-base) 88%, transparent)" }}>
              <div className="flex items-center gap-3">
                {space?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={space.logo_url} alt="" className="h-12 w-12 rounded-2xl object-cover shadow" />
                ) : (
                  <span className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow" style={{ background: "var(--t-cta)" }}><LogIn size={20} /></span>
                )}
                <div className="min-w-0">
                  <h2 className="text-2xl font-black leading-tight">{storeLogin ? "Acceso del equipo" : "Bienvenido de nuevo"}</h2>
                  <p className="truncate text-sm" style={{ color: "var(--t-muted)" }}>
                    {space ? <>Panel de <b style={{ color: "var(--t-text)" }}>{space.name}</b></> : storeLogin ? <>Tienda <b style={{ color: "var(--t-text)" }}>{storeLogin.slug}</b></> : "Entra al panel de tu tienda"}
                  </p>
                </div>
              </div>

              <form onSubmit={handleLogin} className="mt-7 space-y-4">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{storeLogin ? "Usuario" : "Correo"}</span>
                  <span className="mt-1.5 flex items-center gap-2.5 rounded-2xl px-4 transition focus-within:ring-2" style={{ ...fieldStyle, ["--tw-ring-color" as string]: "color-mix(in oklab, var(--t-accent) 55%, transparent)" }}>
                    {storeLogin ? <User size={17} style={{ color: "var(--t-muted)" }} /> : <Mail size={17} style={{ color: "var(--t-muted)" }} />}
                    <input
                      className="h-12 min-w-0 flex-1 text-sm"
                      style={bare}
                      placeholder={storeLogin ? "Ej. USU01" : "tucorreo@ejemplo.com"}
                      type={storeLogin ? "text" : "email"}
                      value={storeLogin ? username : email}
                      onChange={(e) => storeLogin ? setUsername(e.target.value) : setEmail(e.target.value)}
                      required
                      autoComplete={storeLogin ? "username" : "email"}
                      autoCapitalize={storeLogin ? "none" : undefined}
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Contraseña</span>
                    {!storeLogin ? <Link className="text-xs font-semibold hover:underline" style={{ color: "var(--t-accent)" }} href="/forgot-password">¿La olvidaste?</Link> : null}
                  </span>
                  <span className="mt-1.5 flex items-center gap-2.5 rounded-2xl pl-4 pr-1.5 transition focus-within:ring-2" style={{ ...fieldStyle, ["--tw-ring-color" as string]: "color-mix(in oklab, var(--t-accent) 55%, transparent)" }}>
                    <Lock size={17} style={{ color: "var(--t-muted)" }} />
                    <input
                      className="h-12 min-w-0 flex-1 text-sm"
                      style={bare}
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
                      className="grid h-9 w-9 place-items-center rounded-xl transition hover:brightness-125"
                      style={{ color: "var(--t-muted)" }}
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      title={showPassword ? "Ocultar" : "Mostrar"}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                </label>

                {msg ? (
                  <div className="rounded-2xl border px-3.5 py-2.5 text-sm" style={ok
                    ? { borderColor: "color-mix(in oklab, #10b981 45%, transparent)", background: "color-mix(in oklab, #10b981 10%, transparent)" }
                    : { borderColor: "color-mix(in oklab, #ef4444 45%, transparent)", background: "color-mix(in oklab, #ef4444 9%, transparent)" }} role="alert">
                    {msg}
                  </div>
                ) : null}

                <button
                  disabled={loading || Boolean(storeLogin && !storeLogin.id)}
                  className="group flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:opacity-60"
                  style={{ background: "var(--t-cta)" }}
                  type="submit"
                >
                  {loading ? "Entrando…" : <>Entrar <ArrowRight size={17} className="transition group-hover:translate-x-0.5" /></>}
                </button>
              </form>

              {storeLogin ? (
                <p className="mt-5 text-center text-xs" style={{ color: "var(--t-muted)" }}>
                  ¿Olvidaste la clave? Pídele al administrador de la tienda que te asigne una nueva.
                </p>
              ) : (
                <>
                  <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-widest" style={{ color: "var(--t-muted)" }}>
                    <span className="h-px flex-1" style={{ background: "var(--t-card-border)" }} /> ¿Nuevo en RemHub? <span className="h-px flex-1" style={{ background: "var(--t-card-border)" }} />
                  </div>
                  <Link href="/registro" className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-bold transition hover:-translate-y-0.5"
                    style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }}>
                    <Sparkles size={16} style={{ color: "var(--t-accent)" }} /> Crear mi tienda gratis
                  </Link>
                  <p className="mt-5 flex items-start gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
                    <KeyRound size={14} className="mt-0.5 shrink-0" />
                    <span>¿Eres del equipo de una tienda y tienes usuario en vez de correo? Entra con el <b style={{ color: "var(--t-text)" }}>enlace de acceso</b> que te dio el administrador.</span>
                  </p>
                </>
              )}
            </div>
          </div>
          <p className="mt-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>
            <Link href="/" className="hover:underline">← Volver a remhub.co</Link>
          </p>
        </section>
      </div>
    </main>
  );
}

/** Página del panel a la que vuelve después de entrar (solo secciones del panel). */
function nextDashboardPath(next: string | null) {
  return next && /^\/dashboard(\/[a-z0-9_-]+){0,4}$/i.test(next) ? next : "/dashboard";
}
