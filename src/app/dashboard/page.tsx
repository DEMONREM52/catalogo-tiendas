"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  ClipboardList,
  CreditCard,
  FolderTree,
  LayoutGrid,
  Lock,
  Megaphone,
  PackagePlus,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import ReportsDashboard from "./reports/ReportsDashboard";
import { AlertRow, useStoreAlerts } from "./NotificationBell";
import { EditableNickname, useNicknameUpdates } from "./Nickname";

type Module = { permission: string; key: string; href: string; icon: LucideIcon; title: string; description: string };

const MODULES: Module[] = [
  { permission: "pos", key: "pos", href: "/dashboard/pos", icon: CreditCard, title: "POS / Facturación", description: "Registra ventas, crea documentos y abre comprobantes." },
  { permission: "orders", key: "orders", href: "/dashboard/pedidos", icon: Receipt, title: "Pedidos", description: "Revisa pedidos de clientes y actualiza su estado." },
  { permission: "stock_requests", key: "stock_requests", href: "/dashboard/pedidos?tab=internos", icon: Repeat, title: "Pedidos internos", description: "Pide mercancía a otros puntos o bodegas y coordina por chat hasta recibirla." },
  { permission: "products", key: "products", href: "/dashboard/products", icon: Boxes, title: "Productos", description: "Administra productos, precios, costos e imágenes." },
  { permission: "products", key: "social", href: "/dashboard/social", icon: LayoutGrid, title: "Catálogos y campañas", description: "Catálogos con su precio, diseño, contactos y campañas." },
  { permission: "clients", key: "clients", href: "/dashboard/clientes", icon: Users, title: "Terceros y cartera", description: "Clientes, proveedores, trabajadores y vendedores; créditos, cupos y cartera." },
  { permission: "receivables", key: "receivables", href: "/dashboard/clientes?tab=cartera", icon: Wallet, title: "Cartera", description: "Lo que te deben: vencidas, próximas a vencer, abonos y estados de cuenta." },
  { permission: "categories", key: "categories", href: "/dashboard/categories", icon: FolderTree, title: "Categorías", description: "Organiza los productos de la tienda." },
  { permission: "inventory", key: "inventory", href: "/dashboard/inventario", icon: Truck, title: "Inventario y compras", description: "Puntos, bodegas, traslados, ingresos y cuentas por pagar." },
  { permission: "billing", key: "billing", href: "/dashboard/store/billing", icon: ClipboardList, title: "Facturación y pagos", description: "Datos de facturación, resoluciones y medios de pago." },
  { permission: "store", key: "store", href: "/dashboard/store", icon: Store, title: "Mi tienda", description: "Datos, apariencia y enlaces de la tienda." },
  { permission: "users", key: "users", href: "/dashboard/store/users", icon: Lock, title: "Usuarios", description: "Crea accesos internos y administra permisos." },
];

const QUICK_ACTIONS: Array<{ permission: string; href: string; icon: LucideIcon; label: string }> = [
  { permission: "pos", href: "/dashboard/pos", icon: CreditCard, label: "Vender" },
  { permission: "products", href: "/dashboard/products/crear", icon: PackagePlus, label: "Nuevo producto" },
  { permission: "purchases", href: "/dashboard/inventario", icon: Truck, label: "Ingresar factura" },
  { permission: "products", href: "/dashboard/social", icon: Megaphone, label: "Catálogos" },
  { permission: "orders", href: "/dashboard/pedidos", icon: Receipt, label: "Pedidos" },
  { permission: "stock_requests", href: "/dashboard/pedidos?tab=internos", icon: Repeat, label: "Pedir mercancía" },
];

function isMissingQuickAccessColumn(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message.toLowerCase() : "";
  return message.includes("quick_access") && (["42703", "PGRST204"].includes(code) || message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function DashboardHome() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  // Nombre personal ("¿cómo quieres que te llamemos?") y respaldo si no lo ha elegido.
  const [name, setName] = useState("");
  const [fallbackName, setFallbackName] = useState("");
  useNicknameUpdates(setName);
  const [allowed, setAllowed] = useState<Module[]>([]);
  const [actions, setActions] = useState<typeof QUICK_ACTIONS>([]);
  const [quickAccess, setQuickAccess] = useState<string[] | null>(null);
  const [canReports, setCanReports] = useState(false);
  const [points, setPoints] = useState<Array<{ id: string; name: string; kind: string }>>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alerts = useStoreAlerts(store?.id);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = supabaseBrowser();
        const [access, userRes] = await Promise.all([getDashboardStore(), sb.auth.getUser()]);
        if (!mounted) return;
        const meta = userRes.data.user?.user_metadata ?? {};
        setName(String(meta.display_name || "").trim());
        setFallbackName(String(meta.internal_username || userRes.data.user?.email?.split("@")[0] || ""));
        setStore(access.store);
        setIsAdmin(access.profileRole === "admin");
        const can = (permission: string) => hasStorePermission(access, permission);
        // Cartera aparece aparte solo si no se ve ya el módulo de terceros.
        setAllowed(MODULES.filter((m) => can(m.permission) && !(m.key === "receivables" && can("clients"))));
        setActions(QUICK_ACTIONS.filter((a) => can(a.permission)));
        setCanReports(can("audit"));
        if (access.store) {
          const [profileRes, pointsRes] = await Promise.all([
            sb.from("store_profiles").select("quick_access").eq("store_id", access.store.id).maybeSingle(),
            sb.from("erp_warehouses").select("id,name,kind").eq("store_id", access.store.id).eq("active", true).order("name"),
          ]);
          if (!mounted) return;
          if (profileRes.error && !isMissingQuickAccessColumn(profileRes.error)) throw profileRes.error;
          setQuickAccess(!profileRes.error && Array.isArray(profileRes.data?.quick_access)
            ? profileRes.data.quick_access.filter((key: unknown): key is string => typeof key === "string")
            : null);
          setPoints((pointsRes.data ?? []) as Array<{ id: string; name: string; kind: string }>);
        }
      } catch (error: unknown) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String(error.message) : "No se pudieron cargar los datos del dashboard.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const shortcuts = useMemo(() => (quickAccess ? allowed.filter((m) => quickAccess.includes(m.key)) : allowed), [allowed, quickAccess]);
  const today = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  return (
    <main className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] first-letter:uppercase" style={{ color: "var(--t-muted)" }}>{today}</p>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">
              {loading ? "Cargando…" : (
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  {greeting()},
                  <EditableNickname value={name} fallback={fallbackName} onSaved={setName} inputClassName="text-xl font-black sm:text-2xl" />
                  <span aria-hidden>👋</span>
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              {store?.name ? `Esto es lo que pasa hoy en ${store.name}.` : "Tus herramientas de trabajo en un solo lugar."}
            </p>
          </motion.div>
          {actions.length ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((a, i) => (
                <motion.div key={a.href + a.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * i } }}>
                  <Link
                    href={a.href}
                    className="inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5"
                    style={i === 0 ? { background: "var(--t-cta)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
                  >
                    <a.icon size={16} /> {a.label}
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {loadError ? (
        <div className="rounded-[24px] border border-rose-400/25 p-5 text-sm text-rose-700 dark:text-rose-200">{loadError}</div>
      ) : null}

      {alerts.length ? (
        <section className="rounded-[28px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
          <h3 className="mb-2 text-sm font-bold">Lo que necesita tu atención</h3>
          <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {alerts.slice(0, 6).map((alert) => <AlertRow key={alert.key} alert={alert} />)}
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <Link href="/admin" className="flex items-center gap-4 rounded-[24px] border p-5 transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <span className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: "var(--t-cta)" }}><ShieldCheck size={22} /></span>
          <span>
            <span className="block font-semibold">Panel de administración</span>
            <span className="block text-sm" style={{ color: "var(--t-muted)" }}>Herramientas de la plataforma.</span>
          </span>
        </Link>
      ) : null}

      {store && canReports ? <ReportsDashboard storeId={store.id} points={points} /> : null}

      {!loading && !isAdmin ? (
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">Accesos rápidos</h3>
            {allowed.some((m) => m.permission === "store") ? (
              <Link href="/dashboard/store" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                <Settings size={13} /> Personalizar
              </Link>
            ) : null}
          </div>
          {allowed.length === 0 ? (
            <div className="rounded-[24px] border p-5 text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
              Tu cuenta todavía no tiene secciones habilitadas. Solicita al administrador de la tienda que te asigne permisos.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(shortcuts.length ? shortcuts : allowed).map((m, i) => (
                <motion.div key={m.href} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.03 } }} whileHover={{ y: -3 }}>
                  <Link
                    href={m.href}
                    className="group flex h-full flex-col rounded-[24px] border p-4 transition-shadow hover:shadow-xl"
                    style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}>
                      <m.icon size={20} />
                    </span>
                    <h4 className="mt-3 font-semibold">{m.title}</h4>
                    <p className="mt-1 flex-1 text-sm" style={{ color: "var(--t-muted)" }}>{m.description}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--t-accent)" }}>
                      Abrir <ArrowRight size={13} className="transition group-hover:translate-x-1" />
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
