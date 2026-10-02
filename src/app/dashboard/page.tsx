"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import { supabaseBrowser } from "@/lib/supabase/client";

const MODULES = [
  { permission: "pos", href: "/dashboard/pos", icon: "💳", title: "POS / Facturación", description: "Registra ventas, crea documentos y abre comprobantes." },
  { permission: "orders", href: "/dashboard/pedidos", icon: "🧾", title: "Pedidos", description: "Revisa pedidos de clientes y actualiza su estado." },
  { permission: "products", href: "/dashboard/products", icon: "📦", title: "Productos", description: "Administra productos, precios, imágenes e inventario." },
  { permission: "products", href: "/dashboard/social", icon: "📣", title: "RemHub Social", description: "Crea campañas y controla su visibilidad en tu catálogo." },
  { permission: "clients", href: "/dashboard/clientes", icon: "👥", title: "Clientes", description: "Consulta y administra la información de tus clientes." },
  { permission: "categories", href: "/dashboard/categories", icon: "🗂️", title: "Categorías", description: "Organiza el catálogo de la tienda." },
  { permission: "billing", href: "/dashboard/store/billing", icon: "⚙️", title: "Facturación y pagos", description: "Configura datos de facturación y métodos de pago." },
  { permission: "store", href: "/dashboard/store", icon: "🏪", title: "Mi tienda", description: "Consulta el espacio de trabajo y los enlaces de catálogo." },
  { permission: "users", href: "/dashboard/store/users", icon: "🔐", title: "Usuarios", description: "Crea accesos internos y administra permisos." },
];

function defaultQuickAccess() {
  return [...new Set(MODULES.map((module) => module.href === "/dashboard/social" ? "social" : module.permission))];
}

function isMissingQuickAccessColumn(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message.toLowerCase()
    : "";
  return message.includes("quick_access") &&
    (["42703", "PGRST204"].includes(code) || message.includes("does not exist") ||
      message.includes("schema cache") || message.includes("could not find"));
}

export default function DashboardHome() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [allowedModules, setAllowedModules] = useState<typeof MODULES>([]);
  const [quickAccess, setQuickAccess] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getDashboardStore()
      .then(async (access) => {
        if (!mounted) return;
        setStore(access.store);
        setIsAdmin(access.profileRole === "admin");
        setAllowedModules(MODULES.filter((module) => hasStorePermission(access, module.permission)));
        if (access.store) {
          const { data: profile, error } = await supabaseBrowser()
            .from("store_profiles")
            .select("quick_access")
            .eq("store_id", access.store.id)
            .maybeSingle();
          if (error && !isMissingQuickAccessColumn(error)) throw error;
          if (!mounted) return;
          setQuickAccess(!error && Array.isArray(profile?.quick_access)
            ? profile.quick_access.filter((key: unknown): key is string => typeof key === "string")
            : defaultQuickAccess());
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          const message = error instanceof Error ? error.message :
            error && typeof error === "object" && "message" in error && typeof error.message === "string"
              ? error.message
              : "No se pudieron cargar los datos del dashboard.";
          setLoadError(message);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="space-y-6">
      <section className="glass rounded-[28px] p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--t-muted)" }}>
          Acceso rápido
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          {loading ? "Cargando..." : store?.name ? `Bienvenido a ${store.name}` : "Bienvenido"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
          Tus accesos de trabajo, organizados para llegar más rápido a lo que necesitas.
        </p>
      </section>

      {loading ? (
        <div className="glass-soft rounded-[24px] p-5 text-sm" style={{ color: "var(--t-muted)" }}>
          Cargando tus permisos...
        </div>
      ) : loadError ? (
        <div className="glass-soft rounded-[24px] border border-rose-400/25 p-5 text-sm text-rose-700 dark:text-rose-200">{loadError}</div>
      ) : isAdmin ? (
        <Link href="/admin" className="glass-soft block rounded-[24px] p-5">
          <span className="text-2xl">🛡️</span>
          <h3 className="mt-3 font-semibold">Panel de administración</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Abrir herramientas administrativas.</p>
        </Link>
      ) : allowedModules.length === 0 ? (
        <div className="glass-soft rounded-[24px] p-5 text-sm" style={{ color: "var(--t-muted)" }}>
          Tu cuenta todavía no tiene secciones habilitadas. Solicita al administrador de la tienda que te asigne permisos.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {allowedModules.filter((module) => (quickAccess ?? []).includes(module.title === "RemHub Social" ? "social" : module.permission)).map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="glass-soft rounded-[24px] border p-5 transition hover:-translate-y-0.5 hover:brightness-110"
              style={{ borderColor: "var(--t-card-border)" }}
            >
              <span className="text-2xl">{module.icon}</span>
              <h3 className="mt-3 font-semibold">{module.title}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                {module.description}
              </p>
              <span className="mt-4 inline-block text-xs font-semibold" style={{ color: "var(--t-accent)" }}>
                Abrir sección →
              </span>
            </Link>
          ))}
          {allowedModules.filter((module) => (quickAccess ?? []).includes(module.title === "RemHub Social" ? "social" : module.permission)).length === 0 ? (
            <div className="glass-soft rounded-[24px] p-5 text-sm sm:col-span-2 xl:col-span-3" style={{ color: "var(--t-muted)" }}>
              No tienes accesos rápidos seleccionados. Puedes elegirlos en <Link className="font-semibold underline" href="/dashboard/store">Mi tienda</Link>.
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
