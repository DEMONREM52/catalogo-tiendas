"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ERP_PERMISSIONS } from "@/lib/store-user-auth";
import NotificationBell from "./NotificationBell";
import {
  getDashboardStore,
} from "@/lib/store-utils";
import { useNicknameUpdates } from "./Nickname";
import { StockRequestWatcher } from "./pedidos/internos/StockRequestWatcher";

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
function isStoreActiveNow(s: {
  active: boolean;
  active_until?: string | null;
}) {
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
          color: "color-mix(in oklab, #047857 70%, var(--t-text))",
        }}
      >
        <p className="text-xs font-semibold">
          ✅ Tu tienda está activa sin fecha de expiración.
        </p>
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
        <p className="text-xs font-semibold">
          ⛔ Tu tienda está vencida o inactiva.
        </p>
        <p className="mt-1 text-[11px]" style={{ opacity: 0.85 }}>
          Los catálogos han sido desactivados automáticamente. Para reactivar,
          renueva el tiempo con el administrador.
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
      color: "color-mix(in oklab, #b45309 65%, var(--t-text))",
    };
    icon = "⚠️";
  }
  if (d <= 5) {
    style = {
      borderColor: "rgba(244,63,94,0.30)",
      background: "rgba(244,63,94,0.12)",
      color: "color-mix(in oklab, #be123c 65%, var(--t-text))",
    };
    icon = "🧯";
  }
  if (d <= 3) {
    style = {
      borderColor: "rgba(239,68,68,0.40)",
      background: "rgba(239,68,68,0.14)",
      color: "color-mix(in oklab, #b91c1c 65%, var(--t-text))",
    };
    icon = "🔥";
  }

  return (
    <div className="mt-3 rounded-2xl border p-3" style={style}>
      <p className="text-xs font-semibold">
        {icon} Tu tienda se desactivará automáticamente en {d} día
        {d !== 1 ? "s" : ""}.
      </p>
      <p className="mt-1 text-[11px]" style={{ opacity: 0.85 }}>
        Al vencer el tiempo, la tienda y los catálogos quedarán inactivos hasta
        renovar.
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

type ModuleKey = "inventory" | "billing" | "settings";

const MODULE_TABS: Record<ModuleKey, Array<{ href: string; label: string; permissions: string[]; adminOnly?: boolean }>> = {
  inventory: [
    { href: "/dashboard/products", label: "📦 Productos", permissions: ["products"] },
    { href: "/dashboard/categories", label: "🗂️ Categorías del catálogo", permissions: ["categories"] },
    { href: "/dashboard/inventario", label: "🏭 Stock, puntos, traslados y compras", permissions: ERP_PERMISSIONS },
  ],
  billing: [
    { href: "/dashboard/pos", label: "💳 POS / Facturar", permissions: ["pos"] },
    { href: "/dashboard/store/billing", label: "🧾 Datos de facturación", permissions: ["billing"], adminOnly: true },
  ],
  settings: [
    { href: "/dashboard/store", label: "🏪 Mi tienda", permissions: ["store"] },
    { href: "/dashboard/store/users", label: "👤 Usuarios y vendedores", permissions: ["users"] },
  ],
};

function moduleOf(path: string): ModuleKey | null {
  if (path.startsWith("/dashboard/store/billing") || path.startsWith("/dashboard/pos")) return "billing";
  if (path.startsWith("/dashboard/store")) return "settings";
  if (path.startsWith("/dashboard/products") || path.startsWith("/dashboard/categories") || path.startsWith("/dashboard/inventario")) return "inventory";
  return null;
}

function ModuleNav({ canOpen, isAdmin }: { canOpen: (permission: string) => boolean; isAdmin: boolean }) {
  const path = usePathname();
  const key = moduleOf(path);
  if (!key) return null;
  const tabs = MODULE_TABS[key].filter((t) => t.permissions.some((p) => canOpen(p)) && (!t.adminOnly || isAdmin));
  if (tabs.length < 2) return null;
  return (
    <nav className="mb-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Secciones del módulo">
      {tabs.map((t) => {
        const on = key === "billing" || key === "settings" ? path === t.href : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition hover:-translate-y-0.5"
            style={
              on
                ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))", color: "var(--t-cta-text, #fff)", borderColor: "transparent" }
                : { background: "var(--t-card-bg)", color: "var(--t-text)", borderColor: "var(--t-card-border)" }
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function NavItem({
  href,
  label,
  emoji,
  show = true,
  module,
  onClick,
}: {
  href: string;
  label: string;
  emoji: string;
  show?: boolean;
  module?: ModuleKey;
  onClick?: () => void;
}) {
  const path = usePathname();
  const active = module ? moduleOf(path) === module : path === href;

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
    boxShadow:
      "0 0 0 1px color-mix(in oklab, var(--t-accent) 18%, transparent)",
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
        "border backdrop-blur-xl",
      )}
      style={active ? activeStyle : base}
    >
      <span
        className={cx(
          "grid h-9 w-9 place-items-center rounded-2xl border text-[16px] transition",
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
            boxShadow:
              "0 0 14px color-mix(in oklab, var(--t-accent) 55%, transparent)",
          }}
        />
      ) : (
        <span
          className="ml-auto h-2.5 w-2.5 rounded-full opacity-0 transition group-hover:opacity-100"
          style={{
            background: "color-mix(in oklab, var(--t-text) 12%, transparent)",
          }}
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
        className,
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
            open && "top-[9px] rotate-45",
          )}
          style={{
            background: "color-mix(in oklab, var(--t-text) 92%, transparent)",
          }}
        />
        <span
          className={cx(
            "absolute left-0 top-[9px] h-[2px] w-5 rounded-full",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "opacity-0 scale-x-75",
          )}
          style={{
            background: "color-mix(in oklab, var(--t-text) 92%, transparent)",
          }}
        />
        <span
          className={cx(
            "absolute left-0 top-[16px] h-[2px] w-5 rounded-full",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "top-[9px] -rotate-45",
          )}
          style={{
            background: "color-mix(in oklab, var(--t-text) 92%, transparent)",
          }}
        />
      </span>
    </button>
  );
}

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);

  const [store, setStore] = useState<StoreRow | null>(null);
  const [storePermissions, setStorePermissions] = useState<string[]>([]);
  const [storeIsOwner, setStoreIsOwner] = useState(false);
  const [storeMemberRole, setStoreMemberRole] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  useNicknameUpdates(setDisplayName);
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

      const internalUsername = String(data.user.user_metadata?.internal_username ?? "");
      setEmail(internalUsername ? `Usuario: ${internalUsername}` : data.user.email ?? "");
      setDisplayName(String(data.user.user_metadata?.display_name ?? internalUsername));

      try {
        const access = await getDashboardStore();
        setStore(access.store);
        setStorePermissions(access.membership?.permissions ?? []);
        setStoreIsOwner(access.isOwner);
        setStoreMemberRole(access.membership?.role ?? null);

        if (access.profileRole === "admin") {
          setRole("admin");
        } else if (access.store) {
          setRole("store");
        } else {
          await sb.auth.signOut();
          router.replace("/login");
          return;
        }
      } catch (err: unknown) {
        await sb.auth.signOut();
        await Swal.fire({
          icon: "error",
          title: "No se pudo validar el acceso",
          text: String((err as Error)?.message ?? err),
          background: "#0b0b0b",
          color: "#fff",
          confirmButtonColor: "#ef4444",
        });
        router.replace("/login");
        return;
      }

      setReady(true);
    })();
  }, [router]);

  useEffect(() => {
    const refreshStoreSettings = () => {
      void getDashboardStore()
        .then((access) => setStore(access.store))
        .catch((error: unknown) => {
          void Swal.fire({
            icon: "error",
            title: "No se pudo actualizar la tienda",
            text: error instanceof Error ? error.message : String(error),
            background: "var(--t-bg-base)",
            color: "var(--t-text)",
          });
        });
    };
    window.addEventListener("remhub-store-settings-updated", refreshStoreSettings);
    return () => window.removeEventListener("remhub-store-settings-updated", refreshStoreSettings);
  }, []);

  const isStoreAdmin = storeMemberRole === "store_admin";
  const canOpen = useMemo(
    () => (permission: string) =>
      role === "admin" ||
      storeIsOwner ||
      isStoreAdmin ||
      storePermissions.includes(permission),
    [isStoreAdmin, role, storeIsOwner, storePermissions],
  );

  useEffect(() => {
    if (!ready || role === "admin" || !pathname.startsWith("/dashboard/")) return;
    const permission =
      pathname === "/dashboard/store/users" ? "users" :
      pathname.startsWith("/dashboard/store/billing") ? "billing" :
      pathname.startsWith("/dashboard/store") ? "store" :
      pathname.startsWith("/dashboard/pos") ? "pos" :
      pathname.startsWith("/dashboard/clientes") ? "clients" :
      pathname.startsWith("/dashboard/products") ? "products" :
      pathname.startsWith("/dashboard/social") ? "products" :
      pathname.startsWith("/dashboard/categories") ? "categories" :
      pathname.startsWith("/dashboard/pedidos") ? "orders" :
      pathname.startsWith("/dashboard/inventario") ? "inventory" :
      null;

    if (!permission) return;
    const allowed =
      permission === "inventory" ? ERP_PERMISSIONS.some((p) => canOpen(p)) :
      permission === "clients" ? ["clients", "receivables", "credit"].some((p) => canOpen(p)) :
      permission === "orders" ? ["orders", "stock_requests", "stock_requests_manage", "transfers"].some((p) => canOpen(p)) :
      canOpen(permission);
    if (allowed) return;
    void Swal.fire({
      icon: "warning",
      title: "Acceso no habilitado",
      text: "El administrador de tu tienda no te dio permiso para abrir esta sección.",
      background: "#0b0b0b",
      color: "#fff",
      confirmButtonColor: "#8b5cf6",
    }).then(() => router.replace("/dashboard"));
  }, [pathname, ready, role, router, canOpen]);

  // Cierra al cambiar ruta
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDrawerOpen(false));
    const timeout = window.setTimeout(() => setDrawerMounted(false), 320);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
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
      if (e.key === "Escape") {
        setDrawerOpen(false);
        window.setTimeout(() => setDrawerMounted(false), 320);
      }
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

  const canAccessStorePages = Boolean(store) && role === "store";

  const menu = useMemo(() => {
    const store = canAccessStorePages;
    const firstOf = (key: ModuleKey) => MODULE_TABS[key].find((t) => t.permissions.some((p) => canOpen(p)))?.href ?? "/dashboard";
    const anyOf = (key: ModuleKey) => MODULE_TABS[key].some((t) => t.permissions.some((p) => canOpen(p)));
    return [
      { href: "/dashboard", emoji: "📊", label: "Inicio e informes", show: true, module: undefined as ModuleKey | undefined },
      { href: firstOf("inventory"), emoji: "🏭", label: "Inventario", show: store && anyOf("inventory"), module: "inventory" as ModuleKey | undefined },
      { href: firstOf("billing"), emoji: "💳", label: "Facturación", show: store && anyOf("billing"), module: "billing" as ModuleKey | undefined },
      { href: "/dashboard/clientes", emoji: "👥", label: "Terceros y cartera", show: store && ["clients", "receivables", "credit"].some((p) => canOpen(p)), module: undefined as ModuleKey | undefined },
      { href: "/dashboard/pedidos", emoji: "🧾", label: "Pedidos", show: store && ["orders", "stock_requests", "stock_requests_manage", "transfers"].some((p) => canOpen(p)), module: undefined as ModuleKey | undefined },
      { href: "/dashboard/social", emoji: "🛍️", label: "Catálogos y campañas", show: store && canOpen("products"), module: undefined as ModuleKey | undefined },
      { href: firstOf("settings"), emoji: "⚙️", label: "Ajustes", show: store && anyOf("settings"), module: "settings" as ModuleKey | undefined },
      { href: "/admin", emoji: "🛡️", label: "Panel Admin", show: role === "admin", module: undefined as ModuleKey | undefined },
    ];
  }, [canAccessStorePages, role, canOpen]);

  const detalUrl = useMemo(() => {
    if (!store?.slug) return "#";
    return `/${store.slug}/detal`;
  }, [store]);

  const mayorUrl = useMemo(() => {
    if (!store?.slug) return "#";
    const base = `/${store.slug}/mayor`;
    return store.wholesale_key
      ? `${base}?key=${encodeURIComponent(store.wholesale_key)}`
      : base;
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
      <main
        className="min-h-screen px-6 py-10"
        style={{ color: "var(--t-text)" }}
      >
        <div className="mx-auto max-w-3xl">
          <div
            className="rounded-[28px] border p-6 backdrop-blur-xl"
            style={{
              borderColor: "var(--t-card-border)",
              background: "var(--t-card-bg)",
            }}
          >
            <p
              className="text-sm"
              style={{
                color: "color-mix(in oklab, var(--t-text) 78%, transparent)",
              }}
            >
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

  return (
    <main className="min-h-screen" style={{ color: "var(--t-text)" }}>
      {/* ✅ Fondo premium: ahora usa tus tokens (auto claro/oscuro) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="absolute inset-0"
          style={{ background: "var(--t-bg-base)" }}
        />
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "var(--t-bg)" }}
        />
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
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)",
          }}
        />
      </div>

      <div className="mx-auto w-full max-w-[1800px] px-2 py-2 sm:px-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2">
          <BurgerButton open={burgerOpen} onClick={toggleDrawer} />
          <div
            className="rounded-2xl border px-3 py-2 backdrop-blur-xl"
            style={{
              borderColor: "var(--t-card-border)",
              background: "var(--t-card-bg)",
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold">Dashboard</h1>

              {role ? (
                <span
                  className="rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--t-accent) 45%, transparent)",
                    background:
                      "color-mix(in oklab, var(--t-accent) 18%, transparent)",
                    color: "var(--t-text)",
                    boxShadow:
                      "0 0 16px color-mix(in oklab, var(--t-accent) 14%, transparent)",
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
                          color: "color-mix(in oklab, #047857 70%, var(--t-text))",
                        }
                      : {
                          borderColor: "rgba(239,68,68,0.28)",
                          background: "rgba(239,68,68,0.10)",
                          color: "color-mix(in oklab, #b91c1c 65%, var(--t-text))",
                        }
                  }
                  title="Estado de la tienda (manual + temporizador)"
                >
                  {storeLiveActive ? "Activa" : "Inactiva"}
                </span>
              ) : null}
            </div>

            {email ? (
              <p
                className="mt-2 text-xs"
                style={{
                  color: "color-mix(in oklab, var(--t-text) 65%, transparent)",
                }}
              >
                {displayName ? `${displayName} · ` : "Sesión: "}
                <span
                  style={{
                    color:
                      "color-mix(in oklab, var(--t-text) 82%, transparent)",
                  }}
                >
                  {email}
                </span>
              </p>
            ) : null}

            {copyMsg ? <p className="mt-2 text-xs">{copyMsg}</p> : null}

            {role === "store" &&
            store?.catalog_wholesale &&
            !store.wholesale_key ? (
              <p
                className="mt-2 text-[11px]"
                style={{
                  color: "color-mix(in oklab, var(--t-text) 62%, transparent)",
                }}
              >
                ⚠️ Mayoristas activo pero sin <b>wholesale_key</b> (el link
                abrirá privado).
              </p>
            ) : null}
          </div>

          {/* Acciones derecha */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {role === "store" && canOpen("store") ? (
              <>
                <Link
                  href={detalUrl}
                  target="_blank"
                  className={cx(
                    "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                  )}
                  style={
                    canDetal
                      ? {
                          background:
                            "color-mix(in oklab, var(--t-accent) 70%, white 8%)",
                          color: "#0b0b0b",
                        }
                      : {
                          opacity: 0.5,
                          pointerEvents: "none",
                          border: "1px solid var(--t-card-border)",
                          background:
                            "color-mix(in oklab, var(--t-card-bg) 75%, transparent)",
                          color:
                            "color-mix(in oklab, var(--t-text) 70%, transparent)",
                        }
                  }
                >
                  Detal
                </Link>

                <button
                  type="button"
                  onClick={() => copyLink(detalUrl)}
                  disabled={!canDetal}
                  className="rounded-xl border px-2.5 py-1.5 text-xs transition disabled:opacity-40"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background:
                      "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
                    color: "var(--t-text)",
                  }}
                >
                  Copiar
                </button>

                <Link
                  href={mayorUrl}
                  target="_blank"
                  className={cx(
                    "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                  )}
                  style={
                    canMayor
                      ? {
                          background: "rgba(16,185,129,0.85)",
                          color: "#07120d",
                        }
                      : {
                          opacity: 0.5,
                          pointerEvents: "none",
                          border: "1px solid var(--t-card-border)",
                          background:
                            "color-mix(in oklab, var(--t-card-bg) 75%, transparent)",
                          color:
                            "color-mix(in oklab, var(--t-text) 70%, transparent)",
                        }
                  }
                >
                  Mayoristas
                </Link>

                <button
                  type="button"
                  onClick={() => copyLink(mayorUrl)}
                  disabled={!canMayor}
                  className="rounded-xl border px-2.5 py-1.5 text-xs transition disabled:opacity-40"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background:
                      "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
                    color: "var(--t-text)",
                  }}
                >
                  Copiar
                </button>
              </>
            ) : null}

            {role === "store" && canOpen("products") ? (
              <Link
                href="/dashboard/social"
                className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition"
                style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 82%, transparent)", color: "var(--t-text)" }}
              >
                🛍️ Mis catálogos
              </Link>
            ) : null}

            {role === "store" ? <NotificationBell storeId={store?.id} /> : null}
            {role === "store" && store?.id && ["stock_requests", "stock_requests_manage", "transfers"].some((p) => canOpen(p)) ? <StockRequestWatcher storeId={store.id} /> : null}

            <button
              onClick={logout}
              className="rounded-xl border px-3 py-1.5 text-xs font-semibold backdrop-blur-xl transition active:scale-[0.99]"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--t-accent) 45%, transparent)",
                background:
                  "color-mix(in oklab, var(--t-accent) 18%, transparent)",
                color: "var(--t-text)",
                boxShadow:
                  "0 0 22px color-mix(in oklab, var(--t-accent) 14%, transparent)",
              }}
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        {/* Layout */}
        <div className="mt-2">
          {/* Content */}
          <section
            className="min-w-0 rounded-2xl border p-2.5 sm:p-3 md:p-4 backdrop-blur-xl"
            style={{
              borderColor: "var(--t-card-border)",
              background: "var(--t-card-bg)",
            }}
          >
            {role === "store" ? <ModuleNav canOpen={canOpen} isAdmin={storeIsOwner || storeMemberRole === "store_admin"} /> : null}
            {children}
          </section>
        </div>
      </div>

      {/* Drawer mobile premium */}
      {drawerMounted ? (
        <div className="fixed inset-0 z-50">
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
            className="absolute left-0 top-0 h-full w-[86%] max-w-[360px] overflow-y-auto border-r p-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              transform: drawerOpen ? "translateX(0px)" : "translateX(-18px)",
              borderColor: "var(--t-card-border)",
              background:
                "color-mix(in oklab, var(--t-card-bg) 88%, black 10%)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "18px 0 70px rgba(0,0,0,0.35)",
            }}
          >
            {/* Header limpio + X simple */}
            <div className="flex items-center justify-between">
              <p
                className="text-sm font-semibold tracking-[0.32em]"
                style={{
                  color: "color-mix(in oklab, var(--t-text) 65%, transparent)",
                }}
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
                  "active:scale-[0.96]",
                )}
                style={{
                  borderColor: "var(--t-card-border)",
                  background:
                    "color-mix(in oklab, var(--t-card-bg) 82%, transparent)",
                  color: "color-mix(in oklab, var(--t-text) 86%, transparent)",
                }}
              >
                <span className="text-[18px] leading-none translate-y-[0.5px]">
                  ✕
                </span>
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
                  module={m.module}
                  onClick={() => {
                    haptic(6);
                    closeDrawer();
                  }}
                />
              ))}
            </div>

            {role === "store" && store ? (
              <StoreExpiryNotice store={store} />
            ) : null}

            <div
              className="mt-4 text-[11px]"
              style={{
                color: "color-mix(in oklab, var(--t-text) 55%, transparent)",
              }}
            >
              Tip: también puedes presionar <b>ESC</b> para cerrar.
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
