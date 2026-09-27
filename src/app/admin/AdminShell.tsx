"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import AdminBell from "./AdminBell";

/* =========================================================
   ✅ Context: evita doble AdminShell
========================================================= */
const AdminShellContext = createContext<boolean>(false);
export function useInsideAdminShell() {
  return useContext(AdminShellContext);
}

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

/* =========================================================
   Nav item
========================================================= */
function NavItem({
  href,
  label,
  emoji,
  onClick,
}: {
  href: string;
  label: string;
  emoji: string;
  onClick?: () => void;
}) {
  const path = usePathname();
  const active = path === href;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cx(
        "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
        "border backdrop-blur-xl"
      )}
      style={{
        borderColor: active
          ? "color-mix(in oklab, var(--t-cta) 40%, var(--t-card-border))"
          : "var(--t-card-border)",
        background: active
          ? "color-mix(in oklab, var(--t-cta) 20%, transparent)"
          : "color-mix(in oklab, var(--t-card-bg) 78%, transparent)",
        color: active ? "var(--t-text)" : "color-mix(in oklab, var(--t-text) 80%, transparent)",
        boxShadow: active ? "0 0 0 1px color-mix(in oklab, var(--t-cta) 18%, transparent)" : "none",
      }}
    >
      <span
        className={cx("grid h-9 w-9 place-items-center rounded-2xl border text-[16px] transition")}
        style={{
          borderColor: active
            ? "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))"
            : "var(--t-card-border)",
          background: active
            ? "color-mix(in oklab, var(--t-cta) 22%, transparent)"
            : "color-mix(in oklab, var(--t-card-bg) 78%, transparent)",
          boxShadow: active ? "0 0 18px color-mix(in oklab, var(--t-cta) 25%, transparent)" : "none",
        }}
      >
        {emoji}
      </span>

      <span className="font-medium">{label}</span>

      {active ? (
        <span
          className="ml-auto h-2.5 w-2.5 rounded-full"
          style={{
            background: "var(--t-cta)",
            boxShadow: "0 0 14px color-mix(in oklab, var(--t-cta) 70%, transparent)",
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

/* =========================================================
   Burger
========================================================= */
function BurgerButton({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Menú"
      className={cx(
        "fixed left-4 top-4 z-[60] md:hidden",
        "rounded-2xl border px-3 py-2",
        "shadow-lg backdrop-blur-xl",
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "active:scale-[0.98]",
        hidden && "pointer-events-none opacity-0 scale-90 -translate-y-1"
      )}
      style={{
        borderColor: "var(--t-card-border)",
        background: "color-mix(in oklab, var(--t-bg-base) 70%, transparent)",
        color: "color-mix(in oklab, var(--t-text) 88%, transparent)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      ☰
    </button>
  );
}

/* =========================================================
   Admin Menu (✅ NO repetir header en mobile)
========================================================= */
function AdminMenu({ onNav, showHeader = true }: { onNav?: () => void; showHeader?: boolean }) {
  return (
    <>
      {showHeader ? (
        <div className="mb-3 px-2">
          <p className="text-[11px] font-semibold tracking-[0.32em]" style={{ color: "var(--t-muted)" }}>
            MENÚ
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <NavItem href="/admin" emoji="🏠" label="Resumen" onClick={onNav} />
        <NavItem href="/admin/tiendas" emoji="🏪" label="Tiendas" onClick={onNav} />
        <NavItem href="/admin/pedidos" emoji="🧾" label="Pedidos" onClick={onNav} />
        <NavItem href="/admin/productos" emoji="📦" label="Productos" onClick={onNav} />
        <NavItem href="/admin/categorias" emoji="🗂️" label="Categorías" onClick={onNav} />
        <NavItem href="/admin/usuarios" emoji="👤" label="Usuarios / Roles" onClick={onNav} />
        <NavItem href="/admin/themes" emoji="🎨" label="Themes" onClick={onNav} />
      </div>

      <div className="my-4 h-px" style={{ background: "color-mix(in oklab, var(--t-text) 12%, transparent)" }} />

      <div
        className="rounded-2xl border p-4"
        style={{
          borderColor: "var(--t-card-border)",
          background: "color-mix(in oklab, var(--t-card-bg) 78%, transparent)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">💜 Demo para inversores</p>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
              Recorre: <b>Tienda</b> → <b>Catálogo</b> → <b>Pedido</b> → <b>Factura PDF</b>.
            </p>
          </div>

          <div
            className="mt-0.5 rounded-2xl border px-3 py-2 text-[11px]"
            style={{
              borderColor: "color-mix(in oklab, var(--t-cta) 25%, var(--t-card-border))",
              background: "color-mix(in oklab, var(--t-cta) 14%, transparent)",
              color: "var(--t-text)",
            }}
          >
            Tip
          </div>
        </div>

        <div
          className="mt-3 rounded-2xl border p-3 text-xs"
          style={{
            borderColor: "color-mix(in oklab, var(--t-cta) 25%, var(--t-card-border))",
            background: "color-mix(in oklab, var(--t-cta) 14%, transparent)",
            color: "color-mix(in oklab, var(--t-text) 92%, transparent)",
          }}
        >
          Confirma un pedido y genera la factura para mostrar el flujo completo.
        </div>
      </div>

      <div className="mt-4 text-[11px]" style={{ color: "color-mix(in oklab, var(--t-muted) 80%, transparent)" }}>
        Tip: también puedes presionar <b>ESC</b> para cerrar.
      </div>
    </>
  );
}

/* =========================================================
   AdminShell
========================================================= */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const alreadyInside = useInsideAdminShell();

  // ✅ Si ya hay un AdminShell arriba, NO lo vuelvas a renderizar.
  if (alreadyInside) return <>{children}</>;

  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string>("");

  // Drawer
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Swipe close SOLO desde el handle
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const panelWRef = useRef(360);
  const rafRef = useRef<number | null>(null);

  const router = useRouter();
  const pathname = usePathname();

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

      if (error || prof?.role !== "admin") {
        await Swal.fire({
          icon: "error",
          title: "Acceso denegado",
          text: "No tienes permisos de administrador.",
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
          confirmButtonColor: "#ef4444",
        });
        router.replace("/dashboard");
        return;
      }

      setReady(true);
    })();
  }, [router]);

  useEffect(() => {
    closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerMounted) return;
    const el = panelRef.current;
    if (!el) return;

    const measure = () => {
      panelWRef.current = el.getBoundingClientRect().width || 360;
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawerMounted]);

  function openDrawer() {
    setDrawerMounted(true);
    setDragX(0);
    setIsDragging(false);
    requestAnimationFrame(() => setDrawerOpen(true));
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setIsDragging(false);
    setDragX(0);
    window.setTimeout(() => setDrawerMounted(false), 320);
  }

  function toggleDrawer() {
    if (drawerMounted && drawerOpen) closeDrawer();
    else openDrawer();
  }

  function scheduleDrag(next: number) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setDragX(next));
  }

  function onHandlePointerDown(e: React.PointerEvent) {
    if (!drawerOpen) return;
    setIsDragging(true);
    startXRef.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHandlePointerMove(e: React.PointerEvent) {
    if (!isDragging) return;

    const dx = e.clientX - startXRef.current;
    const w = panelWRef.current || 360;

    const next = Math.max(0, Math.min(w, -dx));
    scheduleDrag(next);
  }

  function onHandlePointerUp() {
    if (!isDragging) return;
    setIsDragging(false);

    const w = panelWRef.current || 360;
    const progress = dragX / w;

    if (progress > 0.35) {
      closeDrawer();
      return;
    }
    setDragX(0);
  }

  async function logout() {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    router.replace("/login");
  }

  const w = panelWRef.current || 360;
  const dragProgress = w ? Math.max(0, Math.min(1, dragX / w)) : 0;
  const panelTranslateX = drawerOpen ? -dragX : -18;
  const overlayOpacity = drawerOpen ? 1 - dragProgress * 0.9 : 0;
  const burgerHidden = drawerMounted && drawerOpen;

  if (!ready) {
    return (
      <main className="min-h-screen px-6 py-10" style={{ color: "var(--t-text)" }}>
        <div className="mx-auto max-w-3xl">
          <div className="rounded-[28px] border p-6" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando panel admin...</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <AdminShellContext.Provider value={true}>
      <main className="min-h-screen" style={{ color: "var(--t-text)" }}>
        {/* ✅ Theme auto según sistema */}
        <style jsx global>{`
          :root {
            --t-text: rgba(255, 255, 255, 0.92);
            --t-muted: rgba(255, 255, 255, 0.7);

            --t-bg-base: #07060d;
            --t-card-bg: rgba(255, 255, 255, 0.06);
            --t-card-border: rgba(255, 255, 255, 0.1);

            --t-accent: #a855f7;
            --t-cta: #d946ef;

            --t-bg: radial-gradient(circle at 18% 12%, rgba(168, 85, 247, 0.45), transparent 48%),
                    radial-gradient(circle at 82% 18%, rgba(217, 70, 239, 0.28), transparent 52%),
                    radial-gradient(circle at 50% 92%, rgba(99, 102, 241, 0.2), transparent 58%),
                    var(--t-bg-base);
          }

          @media (prefers-color-scheme: light) {
            :root {
              --t-text: rgba(17, 24, 39, 0.92);
              --t-muted: rgba(17, 24, 39, 0.7);

              --t-bg-base: #f7f7fb;
              --t-card-bg: rgba(255, 255, 255, 0.78);
              --t-card-border: rgba(17, 24, 39, 0.12);

              --t-accent: #7c3aed;
              --t-cta: #db2777;

              --t-bg: radial-gradient(circle at 18% 12%, rgba(124, 58, 237, 0.18), transparent 48%),
                      radial-gradient(circle at 82% 18%, rgba(219, 39, 119, 0.14), transparent 52%),
                      radial-gradient(circle at 50% 92%, rgba(59, 130, 246, 0.12), transparent 58%),
                      var(--t-bg-base);
            }
          }

          /* Tus clases existentes, ahora theme-aware */
          .glass {
            border: 1px solid var(--t-card-border);
            background: var(--t-card-bg);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
          }
          .glass-soft {
            border: 1px solid var(--t-card-border);
            background: color-mix(in oklab, var(--t-card-bg) 80%, transparent);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
          }
        `}</style>

        {/* Fondo */}
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0" style={{ background: "var(--t-bg)" }} />
          <div className="absolute inset-x-0 top-0 h-40" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.18), transparent)" }} />
        </div>

        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
          {/* Top bar */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="glass rounded-[28px] p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">Panel Administrador</h1>
                <span
                  className="rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    borderColor: "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))",
                    background: "color-mix(in oklab, var(--t-cta) 18%, transparent)",
                  }}
                >
                  Admin
                </span>
              </div>

              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                Control total de tiendas, pedidos, productos y categorías.
              </p>

              {email ? (
                <p className="mt-2 text-xs" style={{ color: "color-mix(in oklab, var(--t-muted) 85%, transparent)" }}>
                  Sesión: <span style={{ color: "color-mix(in oklab, var(--t-text) 85%, transparent)" }}>{email}</span>
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <AdminBell />
              <button
                className="rounded-2xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition hover:brightness-110 active:scale-[0.99]"
                style={{
                  borderColor: "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))",
                  background: "color-mix(in oklab, var(--t-cta) 18%, transparent)",
                }}
                onClick={logout}
              >
                Cerrar sesión
              </button>
            </div>
          </div>

          {/* Layout */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
            <aside className="glass hidden rounded-[28px] p-4 md:block">
              <AdminMenu showHeader />
            </aside>

            <section className="glass rounded-[28px] p-4 md:p-6">
              {children}
            </section>
          </div>
        </div>

        {/* Burger */}
        <BurgerButton hidden={burgerHidden} onClick={toggleDrawer} />

        {/* Drawer */}
        {drawerMounted ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                opacity: overlayOpacity,
                background: "rgba(0,0,0,0.45)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
              onClick={closeDrawer}
            />

            <div
              ref={panelRef}
              className={cx(
                "absolute left-0 top-0 h-full w-[86%] max-w-[360px] p-4 border-r",
                isDragging ? "transition-none" : "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              )}
              style={{
                borderColor: "var(--t-card-border)",
                background: "color-mix(in oklab, var(--t-bg-base) 75%, transparent)",
                transform: drawerOpen ? `translateX(${panelTranslateX}px)` : "translateX(-18px)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: "18px 0 70px rgba(0,0,0,0.40)",
              }}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold tracking-[0.32em]" style={{ color: "var(--t-muted)" }}>
                  MENÚ
                </p>

                <div className="flex items-center gap-2">
                  <AdminBell />
                  <button
                    type="button"
                    onClick={closeDrawer}
                    aria-label="Cerrar menú"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border"
                    style={{
                      borderColor: "var(--t-card-border)",
                      background: "color-mix(in oklab, var(--t-card-bg) 68%, transparent)",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div
                className="mt-3 flex items-center justify-center"
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                style={{ touchAction: "none" }}
              >
                <div className="h-1.5 w-14 rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 18%, transparent)" }} />
              </div>

              {/* ✅ Menú SIN header para que NO se repita */}
              <div className="mt-4">
                <AdminMenu onNav={closeDrawer} showHeader={false} />
              </div>

              <div className="mt-4">
                <button
                  className="w-full rounded-2xl border px-4 py-3 text-sm font-semibold"
                  style={{
                    borderColor: "color-mix(in oklab, var(--t-cta) 35%, var(--t-card-border))",
                    background: "color-mix(in oklab, var(--t-cta) 18%, transparent)",
                  }}
                  onClick={logout}
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </AdminShellContext.Provider>
  );
}
