"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { m as motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Zap,
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
import { getDashboardStore, hasStorePermission, type DashboardAccess, type DashboardStore } from "@/lib/store-utils";
import { isNetworkError } from "@/lib/net/status";
import { storedSessionUser } from "@/lib/supabase/offline-session";
import { OnboardingCard } from "./OnboardingCard";
import { GoalsCard, MyTasks, PointToday } from "./HomePanels";
import { CostAlertsCard, DailyCloseButton } from "./MoneyPanels";
import { supabaseBrowser } from "@/lib/supabase/client";
import ReportsDashboard from "./reports/ReportsDashboard";
import { AlertRow, useStoreAlerts } from "./NotificationBell";
import { EditableNickname, useNicknameUpdates } from "./Nickname";
import { Skeleton } from "@/components/ui/Skeleton";
import { SectionTabs } from "@/components/ui/SectionTabs";

type Module = { permission: string; key: string; href: string; icon: LucideIcon; title: string; description: string };

/** Color de cada acceso (para reconocerlo de un vistazo). */
const MODULE_COLOR: Record<string, string> = {
  pos: "#8b5cf6", orders: "#0ea5e9", stock_requests: "#f97316", products: "#10b981", social: "#ec4899", clients: "#6366f1",
  receivables: "#f59e0b", categories: "#14b8a6", inventory: "#f97316", billing: "#64748b", store: "#a855f7", users: "#ef4444",
};
const ACTION_COLOR = ["#8b5cf6", "#10b981", "#f97316", "#ec4899", "#0ea5e9", "#f59e0b"];

/** Reloj en vivo para el saludo. */
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const t0 = window.setTimeout(() => setNow(new Date()), 0);
    const t = window.setInterval(() => setNow(new Date()), 20_000);
    return () => { window.clearTimeout(t0); window.clearInterval(t); };
  }, []);
  if (!now) return null;
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{now.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })}</span>;
}

const MODULES: Module[] = [
  { permission: "pos", key: "pos", href: "/dashboard/pos", icon: CreditCard, title: "POS / Facturación", description: "Registra ventas, crea documentos y abre comprobantes." },
  { permission: "orders", key: "orders", href: "/dashboard/pedidos", icon: Receipt, title: "Pedidos", description: "Revisa pedidos de clientes y actualiza su estado." },
  { permission: "stock_requests", key: "stock_requests", href: "/dashboard/pedidos?tab=internos", icon: Repeat, title: "Pedidos internos", description: "Pide mercancía a otros puntos o bodegas y coordina por chat hasta recibirla." },
  { permission: "products", key: "products", href: "/dashboard/products", icon: Boxes, title: "Productos", description: "Administra productos, precios, costos e imágenes." },
  { permission: "catalogs", key: "social", href: "/dashboard/social", icon: LayoutGrid, title: "Catálogos y campañas", description: "Catálogos con su precio, diseño, contactos y campañas." },
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
  { permission: "products_create", href: "/dashboard/products/crear", icon: PackagePlus, label: "Nuevo producto" },
  { permission: "purchases", href: "/dashboard/inventario", icon: Truck, label: "Ingresar factura" },
  { permission: "catalogs", href: "/dashboard/social", icon: Megaphone, label: "Catálogos" },
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
  const [canPos, setCanPos] = useState(false);
  const [canMoney, setCanMoney] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [points, setPoints] = useState<Array<{ id: string; name: string; kind: string }>>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [isStoreAdmin, setIsStoreAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // No se pudieron leer los permisos (no es lo mismo que no tener secciones).
  const [accessFailed, setAccessFailed] = useState<"network" | "other" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const alerts = useStoreAlerts(store?.id);
  // Pestañas del inicio: primero los informes; pendientes y accesos en sus pestañas. Se recuerda la última.
  const [homeTabRaw, setHomeTab] = useState<"reports" | "pending" | "shortcuts">("reports");
  useEffect(() => {
    try { const t = window.localStorage.getItem("remhub:home-tab"); if (t === "pending" || t === "shortcuts" || t === "reports") { const id = window.setTimeout(() => setHomeTab(t), 0); return () => window.clearTimeout(id); } } catch { /* sin almacenamiento */ }
  }, []);
  const chooseHomeTab = (t: "reports" | "pending" | "shortcuts") => { setHomeTab(t); try { window.localStorage.setItem("remhub:home-tab", t); } catch { /* sin almacenamiento */ } };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = supabaseBrowser();
        let access: DashboardAccess;
        try {
          access = await getDashboardStore();
        } catch (error: unknown) {
          // Sin permisos cargados no se puede decir «no tienes secciones»: se avisa que la base no respondió.
          if (mounted) {
            setAccessFailed(isNetworkError(error) ? "network" : "other");
            setLoadError(error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error));
          }
          return;
        }
        // La sesión guardada en el equipo trae el nombre; no hace falta otra consulta al servidor
        // (sin conexión y con el token vencido, se lee directo del equipo).
        const sessionUser = (await sb.auth.getSession().catch(() => null))?.data.session?.user ?? storedSessionUser();
        if (!mounted) return;
        const meta = sessionUser?.user_metadata ?? {};
        setName(String(meta.display_name || "").trim());
        setFallbackName(String(meta.internal_username || sessionUser?.email?.split("@")[0] || ""));
        setStore(access.store);
        setIsAdmin(access.profileRole === "admin");
        setMyId(sessionUser?.id ?? null);
        setIsStoreAdmin(Boolean(access.isOwner) || access.membership?.role === "store_admin");
        const can = (permission: string) => hasStorePermission(access, permission);
        // Cartera aparece aparte solo si no se ve ya el módulo de terceros.
        setAllowed(MODULES.filter((m) => can(m.permission) && !(m.key === "receivables" && can("clients"))));
        setActions(QUICK_ACTIONS.filter((a) => can(a.permission)));
        setCanReports(can("reports"));
        setCanPos(can("pos"));
        setCanMoney(can("costs_view") || can("profit_view") || can("price_approve"));
        setCanClose(can("reports") || can("cash_manage") || can("profit_view"));
        if (access.store && !access.cachedAt) {
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
        // Los accesos ya se pintaron; si solo falló lo secundario por la base, el aviso de arriba basta.
        if (mounted && !isNetworkError(error)) {
          setLoadError(error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String(error.message) : "No se pudieron cargar los datos del dashboard.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [reloadKey]);

  function retry() {
    setLoading(true);
    setAccessFailed(null);
    setLoadError(null);
    setReloadKey((n) => n + 1);
  }

  const homeTab = homeTabRaw === "reports" && !(store && canReports) && !loading ? "pending" : homeTabRaw;
  const shortcuts = useMemo(() => (quickAccess ? allowed.filter((m) => quickAccess.includes(m.key)) : allowed), [allowed, quickAccess]);
  const today = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  return (
    <main className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "linear-gradient(135deg, color-mix(in oklab, var(--t-accent) 20%, var(--t-card-bg)) 0%, var(--t-card-bg) 60%)" }}>
        <motion.div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 26%, transparent)" }}
          animate={{ x: [0, 30, 0], y: [0, 20, 0] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div aria-hidden className="pointer-events-none absolute -bottom-28 right-0 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, #0ea5e9 18%, transparent)" }}
          animate={{ x: [0, -30, 0], y: [0, -15, 0] }} transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} />
        <div className="relative">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--t-muted)" }}>
              <span className="first-letter:uppercase">{today}</span>
              <span className="rounded-full border px-2 py-0.5 tracking-normal" style={{ borderColor: "var(--t-card-border)" }}>🕐 <LiveClock /></span>
            </p>
            <h2 className="mt-2 text-2xl font-black sm:text-4xl">
              {loading ? <Skeleton className="h-9 w-64 max-w-full" /> : (
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  {greeting()},
                  <EditableNickname value={name} fallback={fallbackName} onSaved={setName} inputClassName="text-xl font-black sm:text-3xl" />
                  <motion.span aria-hidden className="inline-block origin-[70%_70%]" animate={{ rotate: [0, 18, -8, 18, 0] }} transition={{ duration: 1.6, delay: 0.4 }}>👋</motion.span>
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
              {store?.name ? <>Esto es lo que pasa hoy en <b style={{ color: "var(--t-text)" }}>{store.name}</b>.</> : "Tus herramientas de trabajo en un solo lugar."}
            </p>
          </motion.div>
          {actions.length || (store && canClose) ? (
            <div className="mt-5 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
              {actions.map((a, i) => {
                const c = ACTION_COLOR[i % ACTION_COLOR.length];
                return (
                  <motion.div key={a.href + a.label} initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: 0.08 + 0.05 * i } }} whileHover={{ y: -3 }} whileTap={{ scale: 0.95 }}>
                    <Link href={a.href} className="flex h-full flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center text-xs font-bold transition sm:flex-row sm:px-3.5 sm:py-2.5 sm:text-sm"
                      style={i === 0 ? { background: `linear-gradient(135deg, ${c}, color-mix(in oklab, ${c} 70%, #000))`, color: "#fff", borderColor: "transparent", boxShadow: `0 10px 24px -12px ${c}` } : { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }}>
                      <span className="grid h-9 w-9 place-items-center rounded-xl sm:h-7 sm:w-7" style={i === 0 ? { background: "rgba(255,255,255,.2)" } : { background: `color-mix(in oklab, ${c} 16%, transparent)`, color: c }}><a.icon size={16} /></span>
                      {a.label}
                    </Link>
                  </motion.div>
                );
              })}
              {store && canClose ? <div className="col-span-3 sm:col-span-1"><DailyCloseButton storeId={store.id} storeName={store.name} /></div> : null}
            </div>
          ) : null}
        </div>
      </section>

      {accessFailed ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[24px] border border-amber-400/40 p-5 text-sm" style={{ background: "color-mix(in oklab, #f59e0b 8%, transparent)" }}>
          <span className="min-w-0 flex-1">
            <b className="block">No pudimos cargar tus permisos.</b>
            <span style={{ color: "var(--t-muted)" }}>
              {accessFailed === "network"
                ? "La base de datos no respondió a tiempo. Tus secciones siguen igual; no es un problema de tu cuenta."
                : `Ocurrió un error al leerlos: ${loadError ?? "sin detalle"}.`}
            </span>
          </span>
          <button type="button" onClick={retry} className="shrink-0 rounded-full px-4 py-2 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}>
            Reintentar
          </button>
        </div>
      ) : loadError ? (
        <div className="rounded-[24px] border border-danger/25 p-5 text-sm text-danger ">{loadError}</div>
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

      {!isAdmin && !accessFailed ? (
        <SectionTabs layoutId="home-tabs" label="Inicio" value={homeTab} onChange={chooseHomeTab}
          items={[
            { key: "reports" as const, label: "Informes", hint: "Ventas, productos y gráficas", icon: <BarChart3 />, color: "#8b5cf6", hidden: !(store && canReports) },
            { key: "pending" as const, label: "Pendientes y alertas", hint: "Lo que necesita tu atención", icon: <Bell />, color: "#ef4444", badge: alerts.length || null, alert: alerts.length > 0 },
            { key: "shortcuts" as const, label: "Accesos rápidos", hint: "Tus módulos", icon: <Zap />, color: "#0ea5e9" },
          ]} />
      ) : null}

      {homeTab === "reports" && store && canReports ? <ReportsDashboard storeId={store.id} points={points} /> : null}

      {homeTab === "pending" || isAdmin ? (
        <div className="space-y-5">
        {store && !isAdmin && (store.owner_id === myId || isStoreAdmin) ? <OnboardingCard storeId={store.id} slug={store.slug} /> : null}
  
        {store && !isAdmin ? <MyTasks storeId={store.id} /> : null}
        {store && !isAdmin && canMoney ? <CostAlertsCard storeId={store.id} /> : null}
        {store && !isAdmin && canPos ? <PointToday storeId={store.id} hideWhenAllPoints={canReports} /> : null}
        {store && !isAdmin ? <GoalsCard storeId={store.id} /> : null}
  
          {alerts.length ? (
          <section className="rounded-[28px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><span className="grid h-8 w-8 place-items-center rounded-xl text-white" style={{ background: "#ef4444" }}>🔔</span> Lo que necesita tu atención <span className="rounded-full px-2 text-[11px]" style={{ background: "color-mix(in oklab, #ef4444 18%, transparent)" }}>{alerts.length}</span></h3>
            <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {alerts.slice(0, 6).map((alert) => <AlertRow key={alert.key} alert={alert} />)}
            </div>
          </section>
        ) : null}
  
            {!isAdmin && store && !alerts.length ? <p className="rounded-[24px] border p-5 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>🎉 Nada urgente por ahora.</p> : null}
        </div>
      ) : null}

      {homeTab === "shortcuts" ? (
        <>
        {!loading && !isAdmin && !accessFailed ? (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold"><span className="grid h-8 w-8 place-items-center rounded-xl text-white" style={{ background: "var(--t-accent)" }}>⚡</span> Accesos rápidos</h3>
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
                      <span className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-lg transition group-hover:scale-110 group-hover:rotate-3" style={{ background: MODULE_COLOR[m.key] ?? "var(--t-accent)", boxShadow: `0 10px 22px -12px ${MODULE_COLOR[m.key] ?? "var(--t-accent)"}` }}>
                        <m.icon size={21} />
                      </span>
                      <h4 className="mt-3 font-semibold">{m.title}</h4>
                      <p className="mt-1 flex-1 text-sm" style={{ color: "var(--t-muted)" }}>{m.description}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: MODULE_COLOR[m.key] ?? "var(--t-accent)" }}>
                        Abrir <ArrowRight size={13} className="transition group-hover:translate-x-1" />
                      </span>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        ) : null}
          </>
      ) : null}
    </main>
  );
}
