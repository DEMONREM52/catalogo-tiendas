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

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cx(
        "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
        "border backdrop-blur-xl",
        active
          ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-white shadow-[0_0_0_1px_rgba(217,70,239,0.15)]"
          : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
      )}
    >
      <span
        className={cx(
          "grid h-9 w-9 place-items-center rounded-2xl border text-[16px] transition",
          active
            ? "border-fuchsia-300/40 bg-fuchsia-500/20 shadow-[0_0_18px_rgba(217,70,239,0.18)]"
            : "border-white/10 bg-white/5 group-hover:bg-white/10"
        )}
      >
        {emoji}
      </span>

      <span className="font-medium">{label}</span>

      {active ? (
        <span className="ml-auto h-2.5 w-2.5 rounded-full bg-fuchsia-400 shadow-[0_0_14px_rgba(217,70,239,0.75)]" />
      ) : (
        <span className="ml-auto h-2.5 w-2.5 rounded-full bg-white/10 opacity-0 transition group-hover:opacity-100" />
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
        "h-11 w-11 rounded-2xl border border-white/10 bg-black/55",
        "shadow-lg shadow-black/40 backdrop-blur-xl",
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:bg-black/60 active:scale-[0.98]",
        "focus:outline-none focus:ring-4 focus:ring-fuchsia-500/20",
        className
      )}
      style={{ WebkitBackdropFilter: "blur(14px)" }}
    >
      <span className="relative h-5 w-5">
        <span
          className={cx(
            "absolute left-0 top-[2px] h-[2px] w-5 rounded-full bg-white/90",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "top-[9px] rotate-45"
          )}
        />
        <span
          className={cx(
            "absolute left-0 top-[9px] h-[2px] w-5 rounded-full bg-white/90",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "opacity-0 scale-x-75"
          )}
        />
        <span
          className={cx(
            "absolute left-0 top-[16px] h-[2px] w-5 rounded-full bg-white/90",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "top-[9px] -rotate-45"
          )}
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
          .select("id,slug,name,whatsapp,catalog_retail,catalog_wholesale,wholesale_key")
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
      <main className="min-h-screen px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
            <p className="text-sm text-white/80">Cargando dashboard...</p>
          </div>
        </div>
      </main>
    );
  }

  const canDetal = !!store && store.catalog_retail;
  const canMayor = !!store && store.catalog_wholesale;

  const burgerOpen = drawerMounted && drawerOpen;

  // Botón siempre visible en mobile:
  // cerrado: esquina superior izquierda
  // abierto: se mueve al borde del panel (sigue accesible)
  const burgerStyle = burgerOpen
    ? { left: "min(86vw - 56px, 304px)", top: "16px" }
    : { left: "16px", top: "16px" };

  return (
    <main className="min-h-screen text-white">
      {/* Fondo premium */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[#07060d]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(168,85,247,0.45),transparent_48%),radial-gradient(circle_at_82%_18%,rgba(217,70,239,0.28),transparent_52%),radial-gradient(circle_at_50%_92%,rgba(99,102,241,0.20),transparent_58%)]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:radial-gradient(#ffffff_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/35 to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        {/* Top bar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">Dashboard</h1>

              {role ? (
                <span className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/15 px-3 py-1 text-xs font-semibold text-fuchsia-100 shadow-[0_0_16px_rgba(217,70,239,0.18)]">
                  {role === "admin" ? "Admin" : "Tienda"}
                </span>
              ) : null}
            </div>

            {email ? (
              <p className="mt-2 text-xs text-white/55">
                Sesión: <span className="text-white/75">{email}</span>
              </p>
            ) : null}

            {copyMsg ? <p className="mt-2 text-xs text-white/80">{copyMsg}</p> : null}

            {role === "store" && store?.catalog_wholesale && !store.wholesale_key ? (
              <p className="mt-2 text-[11px] text-white/60">
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
                  className={cx(
                    "rounded-2xl px-4 py-2 text-sm font-semibold transition",
                    canDetal
                      ? "bg-fuchsia-500 text-black hover:bg-fuchsia-400"
                      : "pointer-events-none opacity-50 bg-white/10 border border-white/10"
                  )}
                >
                  Detal
                </Link>

                <button
                  type="button"
                  onClick={() => copyLink(detalUrl)}
                  disabled={!canDetal}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10 disabled:opacity-40"
                >
                  Copiar
                </button>

                <Link
                  href={mayorUrl}
                  target="_blank"
                  className={cx(
                    "rounded-2xl px-4 py-2 text-sm font-semibold transition",
                    canMayor
                      ? "bg-emerald-400 text-black hover:bg-emerald-300"
                      : "pointer-events-none opacity-50 bg-white/10 border border-white/10"
                  )}
                >
                  Mayoristas
                </Link>

                <button
                  type="button"
                  onClick={() => copyLink(mayorUrl)}
                  disabled={!canMayor}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10 disabled:opacity-40"
                >
                  Copiar
                </button>
              </>
            ) : null}

            <button
              className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.16)] backdrop-blur-xl transition hover:bg-fuchsia-500/25 active:scale-[0.99]"
              onClick={logout}
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        {/* Layout */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
          {/* Sidebar desktop */}
          <aside className="hidden rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl md:block">
            <div className="mb-3 px-2">
              <p className="text-[11px] font-semibold tracking-[0.32em] text-white/60">
                MENÚ
              </p>
            </div>

            <div className="space-y-2">
              {menu.map((m) => (
                <NavItem key={m.href} href={m.href} emoji={m.emoji} label={m.label} show={m.show} />
              ))}
            </div>

            <div className="my-4 h-px bg-white/10" />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">💜 Tip rápido</p>
              <p className="mt-1 text-xs text-white/70">
                Mantén productos con imágenes y categorías para vender más.
              </p>
            </div>
          </aside>

          {/* Content */}
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-4 md:p-6 backdrop-blur-xl">
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
            className="absolute left-0 top-0 h-full w-[86%] max-w-[360px] border-r border-white/10 bg-black/70 p-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              transform: drawerOpen ? "translateX(0px)" : "translateX(-18px)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "18px 0 70px rgba(0,0,0,0.55)",
            }}
          >
            {/* Header limpio + X simple */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold tracking-[0.32em] text-white/70">MENÚ</p>

              <button
                type="button"
                onClick={() => {
                  haptic(6);
                  closeDrawer();
                }}
                aria-label="Cerrar menú"
                className={cx(
                  "inline-flex h-10 w-10 items-center justify-center rounded-full",
                  "border border-white/10 bg-white/5 text-white/85",
                  "shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl",
                  "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  "hover:bg-white/10 active:scale-[0.96]"
                )}
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

            <div className="my-4 h-px bg-white/10" />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">💜 Tip rápido</p>
              <p className="mt-1 text-xs text-white/70">
                Mantén productos con imágenes y categorías para vender más.
              </p>
            </div>

            <div className="mt-4 text-[11px] text-white/45">
              Tip: también puedes presionar <b>ESC</b> para cerrar.
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
