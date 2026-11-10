"use client";

import Link from "next/link";
import {
  ArrowLeft, ArrowRight, BarChart3, Bell, Boxes, CheckCircle2, CloudOff, CreditCard, Crown, Eye, EyeOff, KeyRound, Lock, LogIn, Mail,
  MessageCircle, ShieldCheck, Smartphone, Sparkles, Store, Truck, User, Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { storeStaffAuthEmail, storeStaffAuthPassword, isValidStoreUsername } from "@/lib/store-user-auth";
import { forgetStaffAccess, rememberStaffAccess, resumeExistingSession } from "@/lib/session-resume";
import { getDashboardStore } from "@/lib/store-utils";
import { logSessionEvent } from "@/lib/audit-client";
import { currentStoreSubdomain } from "@/lib/store-space";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { RemhubMark, SmartLogo } from "@/components/ui/SmartLogo";
import { SalesMock } from "@/components/landing/SalesMock";

type TeamStore = { id: string; slug: string; name: string; logo_url: string | null };
type Mode = "owner" | "team";
const TEAM_KEY = "remhub:team-store";
/** Último usuario del equipo en esta tienda (solo el usuario, nunca la contraseña). */
const userKey = (storeId: string) => `remhub_staff_user_${storeId}`;
const savedUser = (storeId: string) => { try { return window.localStorage.getItem(userKey(storeId)) ?? ""; } catch { return ""; } };

const ROTATING = ["ventas", "inventario", "catálogos", "pedidos", "ganancias"];
const FEATURES: Array<[typeof Store, string, string, string]> = [
  [Store, "Catálogos y pedidos", "Un enlace para cada público", "#8b5cf6"],
  [CreditCard, "POS y caja", "Vende en cada punto", "#10b981"],
  [Boxes, "Inventario serio", "Bodegas, traslados y kardex", "#f97316"],
  [BarChart3, "Rentabilidad", "Cuánto ganas, en vivo", "#0ea5e9"],
  [Truck, "Traslados con firma", "De la bodega a cada punto", "#ec4899"],
  [MessageCircle, "Chat del equipo", "Mensajes y llamadas", "#14b8a6"],
];

export default function StoreLogin({ storeSlug }: { storeSlug?: string }) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(storeSlug ? "team" : "owner");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  // Tienda del equipo: por enlace de acceso (slug + id) o por el código de la tienda.
  const [storeLogin, setStoreLogin] = useState<{ slug: string; id: string } | null>(() =>
    storeSlug ? { slug: storeSlug.trim().toLowerCase(), id: "" } : null,
  );
  const [teamStore, setTeamStore] = useState<TeamStore | null>(null);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [word, setWord] = useState(0);

  // Palabra que cambia y avisos «en vivo» del panel de muestra.
  useEffect(() => {
    const a = window.setInterval(() => setWord((w) => (w + 1) % ROTATING.length), 2200);
    return () => window.clearInterval(a);
  }, []);

  // En el espacio de la tienda (lavitrina.remhub.co/login): se muestra a qué tienda se entra.
  const [space, setSpace] = useState<{ name: string; logo_url: string | null } | null>(null);
  // «Volver a remhub.co»: en el espacio de una tienda, «/» es su catálogo; por eso va a la página de RemHub.
  const [home, setHome] = useState("/");
  useEffect(() => {
    const sub = currentStoreSubdomain();
    if (!sub) return;
    const t = window.setTimeout(() => setHome(`${PRODUCTION_ORIGIN}/`), 0);
    void supabaseBrowser().rpc("store_public_home", { p_slug: sub }).then(({ data }) => {
      const home = data as { name?: string; logo_url?: string | null } | null;
      if (home?.name) setSpace({ name: home.name, logo_url: home.logo_url ?? null });
    });
    return () => window.clearTimeout(t);
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
    return () => { alive = false; };
  }, [storeSlug, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = storeSlug?.trim().toLowerCase() ?? params.get("tienda")?.trim().toLowerCase();
    const id = params.get("sid")?.trim();
    const prefilledUsername = params.get("usuario") ?? "";
    if (params.get("reset") === "1") setMsg("✅ Contraseña cambiada. Inicia sesión con tu contraseña nueva.");
    if (params.get("equipo") === "1") setMode("team");
    if (slug) {
      // Enlace de acceso del equipo (como antes).
      setMode("team");
      if (!id) {
        setMsg("El enlace de acceso está incompleto. Escribe el código de la tienda o pide el enlace actualizado.");
        return;
      }
      setStoreLogin({ slug, id });
      setUsername(prefilledUsername || savedUser(id));
      void fetch(`/api/store-team/login-context?slug=${encodeURIComponent(slug)}&store_id=${encodeURIComponent(id)}`)
        .then((r) => r.json()).then((c) => {
          if (!c?.store) return;
          const st = { id, slug, name: c.store.name, logo_url: c.store.logo_url ?? null };
          setTeamStore(st);
          try { window.localStorage.setItem(TEAM_KEY, JSON.stringify(st)); } catch { /* sin almacenamiento */ }
        }).catch(() => undefined);
      // Sesión ya guardada de alguien de esta tienda (ej. la app instalada del trabajador): entra directo.
      void resumeExistingSession(id).then((resumed) => {
        if (!resumed) return;
        rememberStaffAccess(`/acceso/${slug}?${new URLSearchParams({ sid: id, ...(prefilledUsername ? { usuario: prefilledUsername } : {}) }).toString()}`);
        router.replace(nextDashboardPath(params.get("next")));
      });
      return;
    }
    // La última tienda del equipo en este equipo (para no escribir el código cada vez).
    try {
      const saved = JSON.parse(window.localStorage.getItem(TEAM_KEY) ?? "null") as TeamStore | null;
      if (saved?.id) { setTeamStore(saved); setUsername(savedUser(saved.id)); }
    } catch { /* sin almacenamiento */ }
  }, [storeSlug, router]);

  async function checkCode(e?: React.FormEvent) {
    e?.preventDefault();
    const c = code.replace(/\D/g, "");
    if (c.length < 4) return setMsg("❌ El código de la tienda tiene mínimo 4 números.");
    setChecking(true); setMsg(null);
    try {
      const r = await fetch(`/api/store-team/by-code?code=${encodeURIComponent(c)}`);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "No encontramos esa tienda.");
      const st = j.store as TeamStore & { active: boolean };
      setTeamStore({ id: st.id, slug: st.slug, name: st.name, logo_url: st.logo_url });
      setStoreLogin({ slug: st.slug, id: st.id });
      setUsername((u) => u || savedUser(st.id));
      try { window.localStorage.setItem(TEAM_KEY, JSON.stringify({ id: st.id, slug: st.slug, name: st.name, logo_url: st.logo_url })); } catch { /* sin almacenamiento */ }
      if (!st.active) setMsg("⚠️ Esta tienda está pausada en este momento.");
    } catch (err) {
      setMsg("❌ " + String((err as Error).message));
    } finally {
      setChecking(false);
    }
  }

  function changeStore() {
    setTeamStore(null); setStoreLogin(null); setCode(""); setMsg(null);
    try { window.localStorage.removeItem(TEAM_KEY); } catch { /* sin almacenamiento */ }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const team = mode === "team";
    const target = team ? (storeLogin?.id ? storeLogin : teamStore ? { slug: teamStore.slug, id: teamStore.id } : null) : null;

    try {
      const sb = supabaseBrowser();
      let loginEmail = email.trim();

      if (team) {
        if (!target?.id) throw new Error("Primero escribe el código de la tienda.");
        const normalizedUsername = username.trim().toLowerCase();
        if (!isValidStoreUsername(normalizedUsername)) throw new Error("Escribe el usuario interno que te entregó el administrador de la tienda.");
        const contextResponse = await fetch(`/api/store-team/login-context?slug=${encodeURIComponent(target.slug)}&store_id=${encodeURIComponent(target.id)}`);
        const context = await contextResponse.json();
        if (!contextResponse.ok) throw new Error(context.error ?? "No pudimos confirmar la tienda. Escribe de nuevo el código.");
        loginEmail = storeStaffAuthEmail(target.id, normalizedUsername);
      }

      const { data, error } = await sb.auth.signInWithPassword({
        email: loginEmail,
        // Los trabajadores pueden tener contraseñas cortas (desde 4); se completan igual que al crearlas.
        password: team ? storeStaffAuthPassword(password) : password,
      });

      if (error) {
        setMsg(team ? "❌ Usuario o contraseña incorrectos. Verifica también que tu acceso siga activo." : "❌ " + error.message);
        setLoading(false);
        return;
      }

      if (team && target) {
        const access = await getDashboardStore();
        if (access.store?.id !== target.id || !access.membership?.active) {
          await sb.auth.signOut();
          throw new Error("Este usuario no tiene un acceso activo en esta tienda.");
        }
      }

      if (data.session?.access_token) document.cookie = `app_session=${data.session.access_token}; path=/; max-age=604800`;
      if (team && target) {
        // Recordar el usuario y dejar la app instalada con el ingreso de esta tienda.
        try { window.localStorage.setItem(userKey(target.id), username.trim().toLowerCase()); } catch { /* sin almacenamiento */ }
        rememberStaffAccess(`/acceso/${target.slug}?${new URLSearchParams({ sid: target.id, usuario: username.trim() }).toString()}`);
      }
      await logSessionEvent("auth.login", target?.id ?? null);
      // Ingreso del dueño (correo): la app del panel abre la tienda madre, no un enlace de trabajador.
      if (!team) forgetStaffAccess();
      router.push(nextDashboardPath(new URLSearchParams(window.location.search).get("next")));
    } catch (err: unknown) {
      setMsg("❌ " + String((err as Error)?.message ?? "Error iniciando sesión"));
    } finally {
      setLoading(false);
    }
  }

  const ok = Boolean(msg && msg.startsWith("✅"));
  const warn = Boolean(msg && msg.startsWith("⚠️"));
  const fieldStyle = { background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)", border: "1px solid var(--t-card-border)", color: "var(--t-text)" } as const;
  const ring = { ["--tw-ring-color" as string]: "color-mix(in oklab, var(--t-accent) 55%, transparent)" };
  // Las casillas van «sin caja» dentro del recuadro (los estilos globales de input les ponen borde, fondo y relleno).
  const bare = { background: "transparent", border: "none", boxShadow: "none", padding: 0, minHeight: 0, borderRadius: 0, outline: "none" } as const;
  const needCode = mode === "team" && !teamStore && !storeLogin?.id;
  const shownStore = mode === "team" ? teamStore : null;

  return (
    <main className="relative min-h-screen overflow-hidden text-[color:var(--t-text)]" style={{ background: "var(--t-bg-base)" }}>
      {/* Fondo: luces de la marca que se mueven despacio */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 starfield opacity-60" />
        <motion.div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in oklab, #d946ef 34%, transparent), transparent 65%)" }}
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }} transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute -bottom-48 right-[-120px] h-[620px] w-[620px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in oklab, #6366f1 32%, transparent), transparent 65%)" }}
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }} transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute left-1/2 top-1/3 h-[340px] w-[340px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in oklab, #0ea5e9 18%, transparent), transparent 65%)" }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }} />
      </div>

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 py-8 lg:grid-cols-[1.1fr_.9fr] lg:py-12">
        {/* ------------------------------------------------ Lado izquierdo: la marca */}
        <section className="order-2 min-w-0 lg:order-1">
          <a href={home} className="inline-flex items-center gap-2.5">
            {/* El logo de RemHub es blanco y transparente: va sobre su círculo oscuro (se ve en tema claro). */}
            <RemhubMark size={44} />
            <span className="text-lg font-black tracking-tight">RemHub</span>
          </a>

          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-8 text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
            Tu negocio,{" "}
            <span style={{ background: "var(--t-cta)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>en un solo lugar</span>
          </motion.h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 text-lg font-bold md:text-xl">
            Controla tus
            <motion.span key={ROTATING[word]} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.35 }}
              className="inline-block" style={{ color: "var(--t-accent)" }}>{ROTATING[word]}</motion.span>
          </p>
          <p className="mt-2 max-w-lg text-sm md:text-base" style={{ color: "var(--t-muted)" }}>
            Catálogos con tu enlace, pedidos por WhatsApp, POS, inventario por punto y tus números al día.
          </p>

          {/* El mismo panel animado de la página principal (ventas en vivo, rentabilidad y movimientos). */}
          <div className="mt-7 hidden max-w-lg sm:block">
            <SalesMock />
          </div>

          <ul className="mt-6 grid max-w-lg grid-cols-2 sm:mt-12 gap-2.5 sm:grid-cols-3">
            {FEATURES.map(([I, title, text, color], i) => (
              <motion.li key={title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.06 }} whileHover={{ y: -3 }}
                className="flex flex-col gap-1.5 rounded-2xl border p-3 backdrop-blur-xl" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 55%, transparent)" }}>
                <span className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-md" style={{ background: color, boxShadow: `0 8px 18px -10px ${color}` }}><I size={17} /></span>
                <b className="text-xs leading-tight">{title}</b>
                <span className="text-[11px] leading-tight" style={{ color: "var(--t-muted)" }}>{text}</span>
              </motion.li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: "var(--t-muted)" }}>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-emerald-500" /> Cada usuario ve solo lo que le permites</span>
            <span className="inline-flex items-center gap-1.5"><CloudOff size={15} className="text-sky-500" /> Sigue vendiendo sin internet</span>
            <span className="inline-flex items-center gap-1.5"><Smartphone size={15} className="text-fuchsia-500" /> App para celular y computador</span>
          </div>
        </section>

        {/* ------------------------------------------------ Lado derecho: tarjeta de ingreso */}
        <section className="order-1 mx-auto w-full min-w-0 max-w-md lg:order-2">
          <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 160, damping: 20 }}
            className="relative rounded-[28px] p-[1.5px] shadow-2xl" style={{ background: "linear-gradient(140deg, color-mix(in oklab, #d946ef 70%, transparent), color-mix(in oklab, var(--t-card-border) 80%, transparent) 40%, color-mix(in oklab, #6366f1 70%, transparent))" }}>
            <div className="rounded-[calc(28px-1.5px)] p-6 backdrop-blur-2xl sm:p-8" style={{ background: "color-mix(in oklab, var(--t-bg-base) 90%, transparent)" }}>
              {/* Dueño o equipo */}
                <div className="mb-6 grid grid-cols-2 gap-1 rounded-2xl border p-1" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 60%, transparent)" }} role="tablist" aria-label="Cómo entras">
                  {([["owner", "Dueño", Crown, "Con tu correo"], ["team", "Equipo", Users, "Con el código de la tienda"]] as const).map(([key, label, I, hint]) => {
                    const on = mode === key;
                    return (
                      <button key={key} type="button" role="tab" aria-selected={on} onClick={() => { setMode(key); setMsg(null); }}
                        className="relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-2.5 text-sm font-black transition" style={{ color: on ? "#fff" : "var(--t-text)" }}>
                        {on ? <motion.span layoutId="login-mode" className="absolute inset-0 rounded-xl shadow-lg" style={{ background: "var(--t-cta)" }} transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
                        <span className="relative inline-flex items-center gap-1.5"><I size={16} /> {label}</span>
                        <span className="relative text-[10px] font-semibold" style={{ opacity: on ? 0.85 : 0.6 }}>{hint}</span>
                      </button>
                    );
                  })}
                </div>
              

              <div className="flex items-center gap-3">
                {shownStore ? (
                  <SmartLogo src={shownStore.logo_url} size={52} rounded="rounded-2xl" className="shadow" fallback={<span className="text-2xl">🏪</span>} />
                ) : space?.logo_url ? (
                  <SmartLogo src={space.logo_url} size={52} rounded="rounded-2xl" className="shadow" />
                ) : (
                  <motion.span key={mode} initial={{ rotate: -15, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} className="grid h-[52px] w-[52px] place-items-center rounded-2xl text-white shadow" style={{ background: "var(--t-cta)" }}>
                    {mode === "team" ? <KeyRound size={22} /> : <LogIn size={22} />}
                  </motion.span>
                )}
                <div className="min-w-0">
                  <h2 className="text-2xl font-black leading-tight">{mode === "team" ? (shownStore ? "Hola, equipo 👋" : "Acceso del equipo") : "Bienvenido de nuevo"}</h2>
                  <p className="truncate text-sm" style={{ color: "var(--t-muted)" }}>
                    {shownStore ? <>Entras a <b style={{ color: "var(--t-text)" }}>{shownStore.name}</b></>
                      : mode === "team" ? (storeLogin?.slug ? <>Tienda <b style={{ color: "var(--t-text)" }}>{storeLogin.slug}</b></> : "Escribe el código que te dio tu tienda")
                      : space ? <>Panel de <b style={{ color: "var(--t-text)" }}>{space.name}</b></> : "Entra al panel de tu tienda"}
                  </p>
                </div>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {needCode ? (
                  /* ---------------- Paso 1 del equipo: código de la tienda */
                  <motion.form key="code" onSubmit={(e) => void checkCode(e)} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="mt-7 space-y-4">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Código de la tienda</span>
                      <span className="mt-1.5 flex items-center gap-2.5 rounded-2xl px-4 transition focus-within:ring-2" style={{ ...fieldStyle, ...ring }}>
                        <KeyRound size={18} style={{ color: "var(--t-muted)" }} />
                        <input className="h-14 min-w-0 flex-1 text-center font-mono text-2xl font-black tracking-[0.4em]" style={bare} inputMode="numeric" autoComplete="off"
                          placeholder="••••" value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setMsg(null); }} autoFocus aria-label="Código de la tienda" />
                      </span>
                      <span className="mt-1.5 block text-[11px]" style={{ color: "var(--t-muted)" }}>Lo encuentra el dueño en Mi tienda → Identidad. Son de 4 a 8 números.</span>
                    </label>
                    {msg ? <Alert msg={msg} ok={ok} warn={warn} /> : null}
                    <button disabled={checking || code.length < 4} type="submit" className="group flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:opacity-60" style={{ background: "var(--t-cta)" }}>
                      {checking ? "Buscando tienda…" : <>Continuar <ArrowRight size={17} className="transition group-hover:translate-x-0.5" /></>}
                    </button>
                  </motion.form>
                ) : (
                  /* ---------------- Usuario/correo y contraseña */
                  <motion.form key={`creds-${mode}`} onSubmit={handleLogin} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="mt-7 space-y-4">
                    {mode === "team" && shownStore ? (
                      <div className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, #10b981 40%, var(--t-card-border))", background: "color-mix(in oklab, #10b981 8%, transparent)" }}>
                        <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                        <span className="min-w-0 flex-1 truncate">Tienda: <b>{shownStore.name}</b></span>
                        <button type="button" onClick={changeStore} className="inline-flex shrink-0 items-center gap-1 font-bold hover:underline" style={{ color: "var(--t-accent)" }}><ArrowLeft size={12} /> Cambiar</button>
                      </div>
                    ) : null}
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{mode === "team" ? "Usuario" : "Correo"}</span>
                      <span className="mt-1.5 flex items-center gap-2.5 rounded-2xl px-4 transition focus-within:ring-2" style={{ ...fieldStyle, ...ring }}>
                        {mode === "team" ? <User size={17} style={{ color: "var(--t-muted)" }} /> : <Mail size={17} style={{ color: "var(--t-muted)" }} />}
                        <input className="h-12 min-w-0 flex-1 text-sm" style={bare} placeholder={mode === "team" ? "Ej. USU01" : "tucorreo@ejemplo.com"} type={mode === "team" ? "text" : "email"}
                          value={mode === "team" ? username : email} onChange={(e) => (mode === "team" ? setUsername(e.target.value) : setEmail(e.target.value))}
                          required autoComplete={mode === "team" ? "username" : "email"} autoCapitalize={mode === "team" ? "none" : undefined} />
                      </span>
                    </label>
                    <label className="block">
                      <span className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Contraseña</span>
                        {mode === "owner" ? <Link className="text-xs font-semibold hover:underline" style={{ color: "var(--t-accent)" }} href="/forgot-password">¿La olvidaste?</Link> : null}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2.5 rounded-2xl pl-4 pr-1.5 transition focus-within:ring-2" style={{ ...fieldStyle, ...ring }}>
                        <Lock size={17} style={{ color: "var(--t-muted)" }} />
                        <input className="h-12 min-w-0 flex-1 text-sm" style={bare} placeholder="••••••••" type={showPassword ? "text" : "password"} value={password}
                          onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                        <button type="button" onClick={() => setShowPassword((v) => !v)} className="grid h-9 w-9 place-items-center rounded-xl transition hover:brightness-125" style={{ color: "var(--t-muted)" }}
                          aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} title={showPassword ? "Ocultar" : "Mostrar"}>
                          {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                      </span>
                    </label>
                    {msg ? <Alert msg={msg} ok={ok} warn={warn} /> : null}
                    <motion.button whileTap={{ scale: 0.98 }} disabled={loading || (mode === "team" && !storeLogin?.id && !teamStore)} type="submit"
                      className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:opacity-60" style={{ background: "var(--t-cta)" }}>
                      <span aria-hidden className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/25 transition-all duration-700 group-hover:left-[110%]" />
                      {loading ? "Entrando…" : <>Entrar <ArrowRight size={17} className="transition group-hover:translate-x-0.5" /></>}
                    </motion.button>
                  </motion.form>
                )}
              </AnimatePresence>

              {mode === "team" ? (
                <p className="mt-5 flex items-start gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
                  <Bell size={14} className="mt-0.5 shrink-0" />
                  <span>¿Olvidaste tu clave o no tienes el código? Pídeselo al administrador de tu tienda.</span>
                </p>
              ) : (
                <>
                  <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-widest" style={{ color: "var(--t-muted)" }}>
                    <span className="h-px flex-1" style={{ background: "var(--t-card-border)" }} /> ¿Nuevo en RemHub? <span className="h-px flex-1" style={{ background: "var(--t-card-border)" }} />
                  </div>
                  <Link href="/registro" className="group flex h-12 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-bold transition hover:-translate-y-0.5"
                    style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }}>
                    <Sparkles size={16} className="transition group-hover:rotate-12" style={{ color: "var(--t-accent)" }} /> Crear mi tienda gratis
                  </Link>
                </>
              )}
            </div>
          </motion.div>
          <p className="mt-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>
            <a href={home} className="hover:underline">← Volver a remhub.co</a>
          </p>
        </section>
      </div>
    </main>
  );
}

function Alert({ msg, ok, warn }: { msg: string; ok: boolean; warn: boolean }) {
  const c = ok ? "#10b981" : warn ? "#f59e0b" : "#ef4444";
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border px-3.5 py-2.5 text-sm" role="alert"
      style={{ borderColor: `color-mix(in oklab, ${c} 45%, transparent)`, background: `color-mix(in oklab, ${c} 9%, transparent)` }}>
      {msg}
    </motion.div>
  );
}

/** Página del panel a la que vuelve después de entrar (solo secciones del panel). */
function nextDashboardPath(next: string | null) {
  return next && /^\/dashboard(\/[a-z0-9_-]+){0,4}$/i.test(next) ? next : "/dashboard";
}
