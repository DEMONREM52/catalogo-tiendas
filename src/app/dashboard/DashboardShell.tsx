"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type Role = "admin" | "store";

type StoreRow = {
  id: string;
  slug: string;
  name: string;
  whatsapp: string;

  // ✅ Temporizador / estado
  active: boolean;
  active_until: string | null;

  catalog_retail: boolean;
  catalog_wholesale: boolean;
  wholesale_key: string | null;
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function isHapticsSupported() {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}
function haptic(ms = 8) {
  try {
    if (isHapticsSupported()) navigator.vibrate(ms);
  } catch {}
}

/* =========================================================
   ✅ Helpers: tienda activa + bloqueo + aviso expiración
========================================================= */
function isStoreActiveNow(s: { active: boolean; active_until?: string | null }) {
  if (!s.active) return false;
  if (!s.active_until) return true; // sin expiración
  return new Date(s.active_until).getTime() > Date.now();
}

function daysLeft(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** ✅ Aviso persuasivo debajo del menú */
function StoreExpiryNotice({ store }: { store: StoreRow }) {
  const d = daysLeft(store.active_until);
  const liveActive = isStoreActiveNow(store);

  // Sin expiración
  if (d === null) {
    return (
      <div
        className="mt-3 rounded-2xl border p-3"
        style={{
          borderColor: "rgba(16,185,129,0.25)",
          background: "rgba(16,185,129,0.10)",
          color: "rgba(236,253,245,0.95)",
        }}
      >
        <p className="text-xs font-semibold">✅ Tu tienda está activa sin fecha de expiración.</p>
        <p className="mt-1 text-[11px]" style={{ opacity: 0.85 }}>
          Tus catálogos seguirán disponibles mientras la tienda esté activa.
        </p>
      </div>
    );
  }

  // Vencida
if (d <= 0 || !liveActive) {
  return (
    <div
      className="mt-3 rounded-2xl border p-3"
      style={{
        borderColor: "color-mix(in oklab, #ef4444 40%, var(--t-card-border))",
        background: "color-mix(in oklab, #ef4444 14%, transparent)",
        color: "var(--t-text)",
      }}
    >
      <p className="text-xs font-semibold">⛔ Tu tienda está vencida o inactiva.</p>
      <p className="mt-1 text-[11px]" style={{ opacity: 0.85 }}>
        Los catálogos han sido desactivados automáticamente. Para reactivar, renueva el tiempo con el administrador.
      </p>
    </div>
  );
}

  // Colores por días restantes
  let style: React.CSSProperties = {
    borderColor: "var(--t-card-border)",
    background: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)",
    color: "var(--t-text)",
  };
  let icon = "🕒";

  if (d <= 10) {
    style = {
      borderColor: "rgba(245,158,11,0.35)",
      background: "rgba(245,158,11,0.12)",
      color: "rgba(254,243,199,0.95)",
    };
    icon = "⚠️";
  }
  if (d <= 5) {
    style = {
      borderColor: "rgba(244,63,94,0.30)",
      background: "rgba(244,63,94,0.12)",
      color: "rgba(255,228,230,0.95)",
    };
    icon = "🧯";
  }
  if (d <= 3) {
    style = {
      borderColor: "rgba(239,68,68,0.40)",
      background: "rgba(239,68,68,0.14)",
      color: "rgba(254,226,226,0.95)",
    };
    icon = "🔥";
  }

  return (
    <div className="mt-3 rounded-2xl border p-3" style={style}>
      <p className="text-xs font-semibold">
        {icon} Tu tienda se desactivará automáticamente en {d} día{d !== 1 ? "s" : ""}.
      </p>
      <p className="mt-1 text-[11px]" style={{ opacity: 0.85 }}>
        Al vencer el tiempo, la tienda y los catálogos quedarán inactivos hasta renovar.
      </p>
      <p className="mt-1 text-[11px]" style={{ opacity: 0.85 }}>
        Expira:{" "}
        <span className="font-semibold">
          {new Date(store.active_until as string).toLocaleString("es-CO")}
        </span>
      </p>
    </div>
  );
}

function NavItem({
  href,
  label,
  emoji,
  show = true,
  onClick,
}: {
  href: string;
  label: string;
  emoji: string;
  show?: boolean;
  onClick?: () => void;
}) {
  const path = usePathname();
  const active = path === href;

  if (!show) return null;

  const base = {
    borderColor: "var(--t-card-border)",
    background: "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
    color: "color-mix(in oklab, var(--t-text) 78%, transparent)",
  } as React.CSSProperties;

  const activeStyle = {
    borderColor: "color-mix(in oklab, var(--t-accent) 55%, transparent)",
    background: "color-mix(in oklab, var(--t-accent) 18%, transparent)",
    color: "var(--t-text)",
    boxShadow: "0 0 0 1px color-mix(in oklab, var(--t-accent) 18%, transparent)",
  } as React.CSSProperties;

  const iconBase = {
    borderColor: "var(--t-card-border)",
    background: "color-mix(in oklab, var(--t-card-bg) 78%, transparent)",
    color: "var(--t-text)",
  } as React.CSSProperties;

  const iconActive = {
    borderColor: "color-mix(in oklab, var(--t-accent) 45%, transparent)",
    background: "color-mix(in oklab, var(--t-accent) 22%, transparent)",
    boxShadow: "0 0 18px color-mix(in oklab, var(--t-accent) 18%, transparent)",
  } as React.CSSProperties;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cx(
        "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
        "border backdrop-blur-xl"
      )}
      style={active ? activeStyle : base}
    >
      <span
        className={cx(
          "grid h-9 w-9 place-items-center rounded-2xl border text-[16px] transition"
        )}
        style={active ? iconActive : iconBase}
      >
        {emoji}
      </span>

      <span className="font-medium">{label}</span>

      {active ? (
        <span
          className="ml-auto h-2.5 w-2.5 rounded-full"
          style={{
            background: "var(--t-accent)",
            boxShadow: "0 0 14px color-mix(in oklab, var(--t-accent) 55%, transparent)",
          }}
        />
      ) : (
        <span
          className="ml-auto h-2.5 w-2.5 rounded-full opacity-0 transition group-hover:opacity-100"
          style={{ background: "color-mix(in oklab, var(--t-text) 12%, transparent)" }}
        />
      )}
    </Link>
  );
}

/** Hamburguesa → X (3 líneas) */
function BurgerButton({
  open,
  onClick,
  className,
}: {
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={open ? "Cerrar menú" : "Abrir menú"}
      onClick={() => {
        haptic(8);
        onClick();
      }}
      className={cx(
        "group inline-flex items-center justify-center",
        "h-11 w-11 rounded-2xl border",
        "shadow-lg backdrop-blur-xl",
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "active:scale-[0.98]",
        "focus:outline-none focus:ring-4",
        className
      )}
      style={{
        borderColor: "var(--t-card-border)",
        background: "color-mix(in oklab, var(--t-card-bg) 65%, black 10%)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.25)",
        WebkitBackdropFilter: "blur(14px)",
        outline: "none",
      }}
    >
      <span className="relative h-5 w-5">
        <span
          className={cx(
            "absolute left-0 top-[2px] h-[2px] w-5 rounded-full",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "top-[9px] rotate-45"
          )}
          style={{ background: "color-mix(in oklab, var(--t-text) 92%, transparent)" }}
        />
        <span
          className={cx(
            "absolute left-0 top-[9px] h-[2px] w-5 rounded-full",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "opacity-0 scale-x-75"
          )}
          style={{ background: "color-mix(in oklab, var(--t-text) 92%, transparent)" }}
        />
        <span
          className={cx(
            "absolute left-0 top-[16px] h-[2px] w-5 rounded-full",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "top-[9px] -rotate-45"
          )}
          style={{ background: "color-mix(in oklab, var(--t-text) 92%, transparent)" }}
        />
      </span>
    </button>
  );
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);

  const [store, setStore] = useState<StoreRow | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  // Drawer (montaje + animación)
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();

      const { data } = await sb.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }

      setEmail(data.user.email ?? "");

      const { data: prof, error } = await sb
        .from("user_profiles")
        .select("role")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (error || !prof?.role) {
        await Swal.fire({
          icon: "error",
          title: "Perfil no configurado",
          text: "No se encontró tu rol. Contacta al administrador.",
          background: "#0b0b0b",
          color: "#fff",
          confirmButtonColor: "#ef4444",
        });
        router.replace("/login");
        return;
      }

      const r = prof.role as Role;
      setRole(r);

      if (r === "store") {
        const { data: st, error: stErr } = await sb
          .from("stores")
          .select("id,slug,name,whatsapp,active,active_until,catalog_retail,catalog_wholesale,wholesale_key")
          .eq("owner_id", data.user.id)
          .maybeSingle();

        if (!stErr) setStore((st as StoreRow) ?? null);
      } else {
        setStore(null);
      }

      setReady(true);
    })();
  }, [router]);

  // Cierra al cambiar ruta
  useEffect(() => {
    closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock scroll al abrir
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // ESC para cerrar
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function openDrawer() {
    setDrawerMounted(true);
    requestAnimationFrame(() => setDrawerOpen(true));
  }

  function closeDrawer() {
    setDrawerOpen(false);
    window.setTimeout(() => setDrawerMounted(false), 320);
  }

  function toggleDrawer() {
    if (drawerMounted && drawerOpen) closeDrawer();
    else openDrawer();
  }

  async function logout() {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    router.replace("/login");
  }

  const menu = useMemo(() => {
    return [
      { href: "/dashboard", emoji: "🏠", label: "Resumen", show: true },
      { href: "/dashboard/store", emoji: "🏪", label: "Mi tienda", show: role === "store" },
      { href: "/dashboard/products", emoji: "📦", label: "Productos", show: role === "store" },
      { href: "/dashboard/categories", emoji: "🗂️", label: "Categorías", show: role === "store" },
      { href: "/dashboard/pedidos", emoji: "🧾", label: "Pedidos", show: role === "store" },
      { href: "/admin", emoji: "🛡️", label: "Panel Admin", show: role === "admin" },
    ];
  }, [role]);

  const detalUrl = useMemo(() => {
    if (!store?.slug) return "#";
    return `/${store.slug}/detal`;
  }, [store]);

  const mayorUrl = useMemo(() => {
    if (!store?.slug) return "#";
    const base = `/${store.slug}/mayor`;
    return store.wholesale_key ? `${base}?key=${encodeURIComponent(store.wholesale_key)}` : base;
  }, [store]);

  async function copyLink(url: string) {
    if (!url || url === "#") return;
    try {
      const absolute = window.location.origin + url;
      await navigator.clipboard.writeText(absolute);
      setCopyMsg("✅ Link copiado");
      window.setTimeout(() => setCopyMsg(null), 1200);
      haptic(10);
    } catch {
      setCopyMsg("❌ No se pudo copiar");
      window.setTimeout(() => setCopyMsg(null), 1400);
      haptic(16);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen px-6 py-10" style={{ color: "var(--t-text)" }}>
        <div className="mx-auto max-w-3xl">
          <div
            className="rounded-[28px] border p-6 backdrop-blur-xl"
            style={{
              borderColor: "var(--t-card-border)",
              background: "var(--t-card-bg)",
            }}
          >
            <p className="text-sm" style={{ color: "color-mix(in oklab, var(--t-text) 78%, transparent)" }}>
              Cargando dashboard...
            </p>
          </div>
        </div>
      </main>
    );
  }

  // ✅ Ahora Detal/Mayor dependen de tienda activa EN VIVO + catálogos
  const storeLiveActive = store ? isStoreActiveNow(store) : false;
  const canDetal = !!store && storeLiveActive && store.catalog_retail;
  const canMayor = !!store && storeLiveActive && store.catalog_wholesale;

  const burgerOpen = drawerMounted && drawerOpen;

  // Botón siempre visible en mobile:
  const burgerStyle = burgerOpen
    ? { left: "min(86vw - 56px, 304px)", top: "16px" }
    : { left: "16px", top: "16px" };

  return (
    <main className="min-h-screen" style={{ color: "var(--t-text)" }}>
      {/* ✅ Fondo premium: ahora usa tus tokens (auto claro/oscuro) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              "radial-gradient(color-mix(in oklab, var(--t-text) 55%, transparent) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div
          className="absolute inset-x-0 top-0 h-40"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)" }}
        />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        {/* Top bar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div
            className="rounded-[28px] border p-5 backdrop-blur-xl"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">Dashboard</h1>

              {role ? (
                <span
                  className="rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    borderColor: "color-mix(in oklab, var(--t-accent) 45%, transparent)",
                    background: "color-mix(in oklab, var(--t-accent) 18%, transparent)",
                    color: "var(--t-text)",
                    boxShadow: "0 0 16px color-mix(in oklab, var(--t-accent) 14%, transparent)",
                  }}
                >
                  {role === "admin" ? "Admin" : "Tienda"}
                </span>
              ) : null}

              {role === "store" && store ? (
                <span
                  className="rounded-full border px-3 py-1 text-xs font-semibold"
                  style={
                    storeLiveActive
                      ? {
                          borderColor: "rgba(16,185,129,0.28)",
                          background: "rgba(16,185,129,0.10)",
                          color: "rgba(236,253,245,0.95)",
                        }
                      : {
                          borderColor: "rgba(239,68,68,0.28)",
                          background: "rgba(239,68,68,0.10)",
                          color: "rgba(254,226,226,0.95)",
                        }
                  }
                  title="Estado de la tienda (manual + temporizador)"
                >
                  {storeLiveActive ? "Activa" : "Inactiva"}
                </span>
              ) : null}
            </div>

            {email ? (
              <p className="mt-2 text-xs" style={{ color: "color-mix(in oklab, var(--t-text) 65%, transparent)" }}>
                Sesión: <span style={{ color: "color-mix(in oklab, var(--t-text) 82%, transparent)" }}>{email}</span>
              </p>
            ) : null}

            {copyMsg ? <p className="mt-2 text-xs">{copyMsg}</p> : null}

            {role === "store" && store?.catalog_wholesale && !store.wholesale_key ? (
              <p className="mt-2 text-[11px]" style={{ color: "color-mix(in oklab, var(--t-text) 62%, transparent)" }}>
                ⚠️ Mayoristas activo pero sin <b>wholesale_key</b> (el link abrirá privado).
              </p>
            ) : null}
          </div>

          {/* Acciones derecha */}
          <div className="flex flex-wrap items-center gap-2">
            {role === "store" ? (
              <>
                <Link
                  href={detalUrl}
                  target="_blank"
                  className={cx("rounded-2xl px-4 py-2 text-sm font-semibold transition")}
                  style={
                    canDetal
                      ? {
                          background: "color-mix(in oklab, var(--t-accent) 70%, white 8%)",
                          color: "#0b0b0b",
                        }
                      : {
                          opacity: 0.5,
                          pointerEvents: "none",
                          border: "1px solid var(--t-card-border)",
                          background: "color-mix(in oklab, var(--t-card-bg) 75%, transparent)",
                          color: "color-mix(in oklab, var(--t-text) 70%, transparent)",
                        }
                  }
                >
                  Detal
                </Link>

                <button
                  type="button"
                  onClick={() => copyLink(detalUrl)}
                  disabled={!canDetal}
                  className="rounded-2xl border px-3 py-2 text-sm transition disabled:opacity-40"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
                    color: "var(--t-text)",
                  }}
                >
                  Copiar
                </button>

                <Link
                  href={mayorUrl}
                  target="_blank"
                  className={cx("rounded-2xl px-4 py-2 text-sm font-semibold transition")}
                  style={
                    canMayor
                      ? { background: "rgba(16,185,129,0.85)", color: "#07120d" }
                      : {
                          opacity: 0.5,
                          pointerEvents: "none",
                          border: "1px solid var(--t-card-border)",
                          background: "color-mix(in oklab, var(--t-card-bg) 75%, transparent)",
                          color: "color-mix(in oklab, var(--t-text) 70%, transparent)",
                        }
                  }
                >
                  Mayoristas
                </Link>

                <button
                  type="button"
                  onClick={() => copyLink(mayorUrl)}
                  disabled={!canMayor}
                  className="rounded-2xl border px-3 py-2 text-sm transition disabled:opacity-40"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
                    color: "var(--t-text)",
                  }}
                >
                  Copiar
                </button>
              </>
            ) : null}

            <button
              onClick={logout}
              className="rounded-2xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition active:scale-[0.99]"
              style={{
                borderColor: "color-mix(in oklab, var(--t-accent) 45%, transparent)",
                background: "color-mix(in oklab, var(--t-accent) 18%, transparent)",
                color: "var(--t-text)",
                boxShadow: "0 0 22px color-mix(in oklab, var(--t-accent) 14%, transparent)",
              }}
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        {/* Layout */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
          {/* Sidebar desktop */}
          <aside
            className="hidden rounded-[28px] border p-4 backdrop-blur-xl md:block"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
          >
            <div className="mb-3 px-2">
              <p
                className="text-[11px] font-semibold tracking-[0.32em]"
                style={{ color: "color-mix(in oklab, var(--t-text) 55%, transparent)" }}
              >
                MENÚ
              </p>
            </div>

            <div className="space-y-2">
              {menu.map((m) => (
                <NavItem key={m.href} href={m.href} emoji={m.emoji} label={m.label} show={m.show} />
              ))}
            </div>

            {role === "store" && store ? <StoreExpiryNotice store={store} /> : null}

            <div className="my-4 h-px" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }} />

            <div
              className="rounded-2xl border p-4"
              style={{
                borderColor: "var(--t-card-border)",
                background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
              }}
            >
              <p className="text-sm font-semibold">💜 Tip rápido</p>
              <p className="mt-1 text-xs" style={{ color: "color-mix(in oklab, var(--t-text) 70%, transparent)" }}>
                Mantén productos con imágenes y categorías para vender más.
              </p>
            </div>
          </aside>

          {/* Content */}
          <section
            className="rounded-[28px] border p-4 md:p-6 backdrop-blur-xl"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
          >
            {children}
          </section>
        </div>
      </div>

      {/* Botón premium flotante ALWAYS visible en mobile */}
      <div className="fixed z-[70] md:hidden" style={burgerStyle as any}>
        <BurgerButton open={burgerOpen} onClick={toggleDrawer} />
      </div>

      {/* Drawer mobile premium */}
      {drawerMounted ? (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Overlay */}
          <div
            className="absolute inset-0 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              opacity: drawerOpen ? 1 : 0,
              background: "rgba(0,0,0,0.45)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
            onClick={closeDrawer}
          />

          {/* Panel */}
          <div
            className="absolute left-0 top-0 h-full w-[86%] max-w-[360px] border-r p-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              transform: drawerOpen ? "translateX(0px)" : "translateX(-18px)",
              borderColor: "var(--t-card-border)",
              background: "color-mix(in oklab, var(--t-card-bg) 88%, black 10%)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "18px 0 70px rgba(0,0,0,0.35)",
            }}
          >
            {/* Header limpio + X simple */}
            <div className="flex items-center justify-between">
              <p
                className="text-sm font-semibold tracking-[0.32em]"
                style={{ color: "color-mix(in oklab, var(--t-text) 65%, transparent)" }}
              >
                MENÚ
              </p>

              <button
                type="button"
                onClick={() => {
                  haptic(6);
                  closeDrawer();
                }}
                aria-label="Cerrar menú"
                className={cx(
                  "inline-flex h-10 w-10 items-center justify-center rounded-full border",
                  "shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl",
                  "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  "active:scale-[0.96]"
                )}
                style={{
                  borderColor: "var(--t-card-border)",
                  background: "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
                  color: "color-mix(in oklab, var(--t-text) 86%, transparent)",
                }}
              >
                <span className="text-[18px] leading-none translate-y-[0.5px]">✕</span>
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {menu.map((m) => (
                <NavItem
                  key={m.href}
                  href={m.href}
                  emoji={m.emoji}
                  label={m.label}
                  show={m.show}
                  onClick={() => {
                    haptic(6);
                    closeDrawer();
                  }}
                />
              ))}
            </div>

            {role === "store" && store ? <StoreExpiryNotice store={store} /> : null}

            <div className="my-4 h-px" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }} />

            <div
              className="rounded-2xl border p-4"
              style={{
                borderColor: "var(--t-card-border)",
                background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
              }}
            >
              <p className="text-sm font-semibold">💜 Tip rápido</p>
              <p className="mt-1 text-xs" style={{ color: "color-mix(in oklab, var(--t-text) 70%, transparent)" }}>
                Mantén productos con imágenes y categorías para vender más.
              </p>
            </div>

            <div className="mt-4 text-[11px]" style={{ color: "color-mix(in oklab, var(--t-text) 55%, transparent)" }}>
              Tip: también puedes presionar <b>ESC</b> para cerrar.
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
