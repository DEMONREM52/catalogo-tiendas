"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

function classNames(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

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
      className={classNames(
        "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
        "border backdrop-blur-xl",
        active
          ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-white shadow-[0_0_0_1px_rgba(217,70,239,0.15)]"
          : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
      )}
    >
      <span
        className={classNames(
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

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string>("");

  // Drawer (montaje + animación)
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

  // -------- auth/role check ----------
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
          background: "#0b0b0b",
          color: "#fff",
          confirmButtonColor: "#ef4444",
        });
        router.replace("/dashboard");
        return;
      }

      setReady(true);
    })();
  }, [router]);

  // Cierra al cambiar ruta
  useEffect(() => {
    closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock scroll cuando abre
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

  // Medir ancho del panel
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

  // Swipe close SOLO desde el handle
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

    const dx = e.clientX - startXRef.current; // negativo si va a la izquierda
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

  if (!ready) {
    return (
      <main className="min-h-screen px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
            <p className="text-sm text-white/80">Cargando panel admin...</p>
          </div>
        </div>
      </main>
    );
  }

  const w = panelWRef.current || 360;
  const dragProgress = w ? Math.max(0, Math.min(1, dragX / w)) : 0;

  const panelTranslateX = drawerOpen ? -dragX : -18;
  const overlayOpacity = drawerOpen ? 1 - dragProgress * 0.9 : 0;

  // Oculta hamburguesa cuando está abierto
  const burgerHidden = drawerMounted && drawerOpen;

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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">Panel Administrador</h1>
              <span className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/15 px-3 py-1 text-xs font-semibold text-fuchsia-100 shadow-[0_0_16px_rgba(217,70,239,0.18)]">
                Admin
              </span>
            </div>

            <p className="mt-1 text-sm text-white/70">
              Control total de tiendas, pedidos, productos y categorías.
            </p>

            {email ? (
              <p className="mt-2 text-xs text-white/55">
                Sesión: <span className="text-white/75">{email}</span>
              </p>
            ) : null}
          </div>

          <button
            className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.16)] backdrop-blur-xl transition hover:bg-fuchsia-500/25 active:scale-[0.99]"
            onClick={logout}
          >
            Cerrar sesión
          </button>
        </div>

        {/* Layout */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
          {/* Sidebar Desktop */}
          <aside className="hidden rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl md:block">
            <div className="mb-3 px-2">
              <p className="text-[11px] font-semibold tracking-[0.32em] text-white/60">
                MENÚ
              </p>
            </div>

            <div className="space-y-2">
              <NavItem href="/admin" emoji="🏠" label="Resumen" />
              <NavItem href="/admin/tiendas" emoji="🏪" label="Tiendas" />
              <NavItem href="/admin/pedidos" emoji="🧾" label="Pedidos" />
              <NavItem href="/admin/productos" emoji="📦" label="Productos" />
              <NavItem href="/admin/categorias" emoji="🗂️" label="Categorías" />
              <NavItem href="/admin/usuarios" emoji="👤" label="Usuarios / Roles" />
              <NavItem href="/admin/themes" emoji="🎨" label="Themes" />
            </div>

            <div className="my-4 h-px bg-white/10" />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">💜 Demo para inversores</p>
              <p className="mt-1 text-xs text-white/70">
                Recorre: <b>Tienda</b> → <b>Catálogo</b> → <b>Pedido</b> →{" "}
                <b>Factura PDF</b>.
              </p>

              <div className="mt-3 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-3 text-xs text-fuchsia-100/90">
                Tip: confirma un pedido y genera la factura para mostrar el flujo completo.
              </div>
            </div>
          </aside>

          {/* Content */}
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-4 md:p-6 backdrop-blur-xl">
            {children}
          </section>
        </div>
      </div>

      {/* Botón hamburguesa flotante */}
      <button
        type="button"
        onClick={toggleDrawer}
        aria-label="Menú"
        className={classNames(
          "fixed left-4 top-4 z-[60] md:hidden",
          "rounded-2xl border border-white/10 bg-black/55 px-3 py-2",
          "text-white/85 shadow-lg shadow-black/40 backdrop-blur-xl",
          "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "active:scale-[0.98] hover:bg-black/60",
          burgerHidden && "pointer-events-none opacity-0 scale-90 -translate-y-1"
        )}
        style={{ WebkitBackdropFilter: "blur(14px)" }}
      >
        ☰
      </button>

      {/* Drawer iPhone */}
      {drawerMounted ? (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Overlay */}
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

          {/* Panel */}
          <div
            ref={panelRef}
            className={classNames(
              "absolute left-0 top-0 h-full w-[86%] max-w-[360px]",
              "border-r border-white/10 bg-black/70 p-4",
              isDragging
                ? "transition-none"
                : "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            )}
            style={{
              transform: drawerOpen
                ? `translateX(${panelTranslateX}px)`
                : "translateX(-18px)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "18px 0 70px rgba(0,0,0,0.55)",
            }}
          >
            {/* Header + X bonita */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold tracking-[0.32em] text-white/70">
                MENÚ
              </p>

              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Cerrar menú"
                className={classNames(
                  "inline-flex h-10 w-10 items-center justify-center rounded-full",
                  "border border-white/10 bg-white/5 text-white/85",
                  "shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl",
                  "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  "hover:bg-white/10 active:scale-[0.96]"
                )}
              >
                <span className="text-[18px] leading-none translate-y-[0.5px]">
                  ✕
                </span>
              </button>
            </div>

            {/* Handle para swipe (sin texto) */}
            <div
              className="mt-3 flex items-center justify-center"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
              style={{ touchAction: "none" }}
            >
              <div className="h-1.5 w-14 rounded-full bg-white/20" />
            </div>

            {/* Links */}
            <div className="mt-4 space-y-2">
              <NavItem href="/admin" emoji="🏠" label="Resumen" onClick={closeDrawer} />
              <NavItem href="/admin/tiendas" emoji="🏪" label="Tiendas" onClick={closeDrawer} />
              <NavItem href="/admin/pedidos" emoji="🧾" label="Pedidos" onClick={closeDrawer} />
              <NavItem href="/admin/productos" emoji="📦" label="Productos" onClick={closeDrawer} />
              <NavItem href="/admin/categorias" emoji="🗂️" label="Categorías" onClick={closeDrawer} />
              <NavItem href="/admin/usuarios" emoji="👤" label="Usuarios / Roles" onClick={closeDrawer} />
              <NavItem href="/admin/themes" emoji="🎨" label="Themes" onClick={closeDrawer} />
            </div>

            <div className="my-4 h-px bg-white/10" />

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">💜 Demo para inversores</p>
              <p className="mt-1 text-xs text-white/70">
                Recorre: <b>Tienda</b> → <b>Catálogo</b> → <b>Pedido</b> →{" "}
                <b>Factura PDF</b>.
              </p>

              <div className="mt-3 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-3 text-xs text-fuchsia-100/90">
                Tip: confirma un pedido y genera la factura para mostrar el flujo completo.
              </div>
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
