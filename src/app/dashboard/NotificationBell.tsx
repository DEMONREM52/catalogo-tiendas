"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, m as motion } from "framer-motion";
import {
  Bell,
  Box,
  Megaphone,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  X,
  FileX,
  Hash,
  Landmark,
  PlugZap,
  ShieldAlert,
  TriangleAlert,
  Users,
  Webhook,
  ReceiptText,
  ShoppingBag,
  Tag,
  TrendingDown,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { AlertSeverity, StoreAlert } from "@/lib/reports";

const ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  box: Box,
  "trending-down": TrendingDown,
  truck: Truck,
  receipt: ReceiptText,
  "shopping-bag": ShoppingBag,
  tag: Tag,
  calendar: CalendarClock,
  hash: Hash,
  "file-x": FileX,
  alert: TriangleAlert,
  plug: PlugZap,
  webhook: Webhook,
  shield: ShieldAlert,
  landmark: Landmark,
  users: Users,
  megaphone: Megaphone,
};

export const SEVERITY: Record<AlertSeverity, { label: string; color: string; order: number }> = {
  critical: { label: "Urgente", color: "#d03b3b", order: 0 },
  serious: { label: "Importante", color: "#ec835a", order: 1 },
  warning: { label: "Atención", color: "#c98500", order: 2 },
  info: { label: "Aviso", color: "#7c3aed", order: 3 },
  good: { label: "Buenas noticias", color: "#0ca30c", order: 4 },
};

export function useStoreAlerts(storeId: string | null | undefined) {
  const [alerts, setAlerts] = useState<StoreAlert[]>([]);
  const load = useCallback(async () => {
    if (!storeId) return;
    const sb = supabaseBrowser();
    // Alertas del ERP + fiscales, de seguridad y de usuarios (si la migración fiscal no está, se ignoran)
    // + trabajo sin conexión: contingencias por transmitir y ventas por revisar (20261243).
    // + pedidos sin confirmar y sin completar (20261303).
    // + productos a los que ya les toca publicarse (20261305).
    // + tareas de productos asignadas a la persona (20261306).
    // + carritos abandonados y «avísame» que ya llegó (20261312, solo si están encendidos).
    const [base, extra, offline, orders, publish, tasks, sell, ops] = await Promise.all([
      sb.rpc("erp_alerts", { p_store: storeId }),
      sb.rpc("erp_extra_alerts", { p_store: storeId }),
      sb.rpc("erp_offline_alerts", { p_store: storeId }),
      sb.rpc("erp_order_alerts", { p_store: storeId }),
      sb.rpc("erp_publish_alerts", { p_store: storeId }),
      sb.rpc("erp_product_task_alerts", { p_store: storeId }),
      sb.rpc("vm_alerts", { p_store: storeId }),
      sb.rpc("vm_ops_alerts", { p_store: storeId }),
    ]);
    const opsData = !ops.error && ops.data ? (ops.data as { ok?: boolean; counts_pending?: number }) : null;
    const vm = !sell.error && sell.data ? (sell.data as { ok?: boolean; carts?: number; waitlist_ready?: number }) : null;
    const sellAlerts: StoreAlert[] = [];
    if (vm?.ok && Number(vm.carts) > 0) sellAlerts.push({
      key: `vm-carts-${vm.carts}`, severity: "info", icon: "shopping-bag", count: Number(vm.carts),
      title: `🛒 ${vm.carts} carrito${Number(vm.carts) === 1 ? "" : "s"} sin terminar`,
      body: "Clientes que dejaron su WhatsApp y no enviaron el pedido. Escríbeles con un toque.",
      href: "/dashboard/vender-mas?ver=carritos",
    });
    if (opsData?.ok && Number(opsData.counts_pending) > 0) sellAlerts.push({
      key: `vm-counts-${opsData.counts_pending}`, severity: "warning", icon: "box", count: Number(opsData.counts_pending),
      title: `📷 ${opsData.counts_pending} conteo${Number(opsData.counts_pending) === 1 ? "" : "s"} por aprobar`,
      body: "Revisa las diferencias y aprueba para que se ajusten las existencias.",
      href: "/dashboard/inventario?tab=conteos",
    });
    if (vm?.ok && Number(vm.waitlist_ready) > 0) sellAlerts.push({
      key: `vm-waitlist-${vm.waitlist_ready}`, severity: "good", icon: "megaphone", count: Number(vm.waitlist_ready),
      title: `🔔 Ya llegó lo que ${vm.waitlist_ready} cliente${Number(vm.waitlist_ready) === 1 ? "" : "s"} esperaba${Number(vm.waitlist_ready) === 1 ? "" : "n"}`,
      body: "Entró mercancía de productos que pidieron con «Avísame». Avísales por WhatsApp.",
      href: "/dashboard/vender-mas?ver=avisame",
    });
    const ordersOk = !orders.error && Array.isArray(orders.data);
    const rows = [
      // Con los avisos nuevos de pedidos, el viejo («sin confirmar hace más de un día») sobra.
      ...(!base.error && Array.isArray(base.data) ? (base.data as StoreAlert[]).filter((a) => !(ordersOk && a.key.startsWith("orders-pending-"))) : []),
      ...(ordersOk ? (orders.data as StoreAlert[]) : []),
      ...(!extra.error && Array.isArray(extra.data) ? (extra.data as StoreAlert[]) : []),
      ...(!offline.error && Array.isArray(offline.data) ? (offline.data as StoreAlert[]) : []),
      ...(!publish.error && Array.isArray(publish.data) ? (publish.data as StoreAlert[]) : []),
      ...(!tasks.error && Array.isArray(tasks.data) ? (tasks.data as StoreAlert[]) : []),
      ...sellAlerts,
    ].filter((a) => SEVERITY[a.severity]);
    if (!base.error || !extra.error) {
      setAlerts(rows.sort((a, b) => SEVERITY[a.severity].order - SEVERITY[b.severity].order));
    }
  }, [storeId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);
  return alerts;
}

export function AlertRow({ alert, onNavigate, unseen, compact }: { alert: StoreAlert; onNavigate?: () => void; unseen?: boolean; compact?: boolean }) {
  const Icon = ICONS[alert.icon] ?? Bell;
  const severity = SEVERITY[alert.severity];
  if (compact) {
    return (
      <Link
        href={alert.href}
        onClick={onNavigate}
        className="group relative flex items-start gap-3 overflow-hidden rounded-2xl border p-3 pl-3.5 transition active:scale-[0.99] hover:-translate-y-px"
        style={{ borderColor: unseen ? `color-mix(in oklab, ${severity.color} 45%, var(--t-card-border))` : "var(--t-card-border)", background: unseen ? `color-mix(in oklab, ${severity.color} 7%, var(--t-card-bg))` : "var(--t-card-bg)" }}
      >
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: severity.color, opacity: unseen ? 1 : 0.4 }} />
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${severity.color} 16%, transparent)`, color: severity.color }}>
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: severity.color }}>
            {severity.label}
            {unseen ? <span className="rounded-full px-1.5 py-px text-[9px] text-white" style={{ background: "var(--t-accent)" }}>Nueva</span> : null}
          </span>
          <span className="mt-0.5 block text-sm font-bold leading-snug" style={{ color: "var(--t-text)" }}>{alert.title}</span>
          <span className="mt-0.5 block text-xs leading-snug" style={{ color: "var(--t-muted)" }}>{alert.body}</span>
        </span>
        <ChevronRight size={16} className="mt-3 shrink-0 opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-80" />
      </Link>
    );
  }
  return (
    <Link
      href={alert.href}
      onClick={onNavigate}
      className="flex items-start gap-3 rounded-2xl p-2.5 transition hover:bg-[color:var(--t-card-bg-soft)]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${severity.color} 16%, transparent)`, color: severity.color }}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: severity.color }}>{severity.label}</span>
        <span className="block text-sm font-semibold leading-snug" style={{ color: "var(--t-text)" }}>{alert.title}</span>
        <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{alert.body}</span>
      </span>
    </Link>
  );
}

export default function NotificationBell({ storeId }: { storeId: string | null | undefined }) {
  const alerts = useStoreAlerts(storeId);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<"all" | "new" | "urgent" | "attention">("all");
  const [top, setTop] = useState(64);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const storageKey = `remhub_seen_alerts_${storeId ?? ""}`;

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
    } catch {
      setSeen([]);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    // En computador el panel sale justo debajo de la campana.
    const rect = boxRef.current?.getBoundingClientRect();
    if (rect) setTop(Math.round(rect.bottom + 10));
    setOpen((v) => !v);
  }

  function markSeen(key: string) {
    if (seen.includes(key)) return;
    const next = [...seen, key];
    setSeen(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  }

  const unseen = useMemo(() => alerts.filter((a) => !seen.includes(a.key)), [alerts, seen]);
  const urgent = unseen.some((a) => a.severity === "critical" || a.severity === "serious");

  function markAllSeen() {
    const keys = alerts.map((a) => a.key);
    setSeen(keys);
    try {
      localStorage.setItem(storageKey, JSON.stringify(keys));
    } catch {
      /* si el navegador no guarda, el contador vuelve a aparecer al recargar */
    }
  }

  const counts = {
    all: alerts.length,
    new: unseen.length,
    urgent: alerts.filter((a) => a.severity === "critical" || a.severity === "serious").length,
    attention: alerts.filter((a) => a.severity === "warning" || a.severity === "info").length,
  };
  const shown = alerts.filter((a) =>
    filter === "all" ? true
      : filter === "new" ? !seen.includes(a.key)
        : filter === "urgent" ? a.severity === "critical" || a.severity === "serious"
          : a.severity === "warning" || a.severity === "info");
  // Las nuevas primero dentro de cada gravedad.
  const ordered = [...shown].sort((a, b) => SEVERITY[a.severity].order - SEVERITY[b.severity].order || Number(seen.includes(a.key)) - Number(seen.includes(b.key)));

  if (!storeId) return null;

  return (
    <div ref={boxRef} className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={toggle}
        className="relative grid h-9 w-9 place-items-center rounded-xl border backdrop-blur-xl"
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 82%, transparent)", color: "var(--t-text)" }}
        aria-label={`Notificaciones${unseen.length ? `: ${unseen.length} nuevas` : ""}`}
        aria-expanded={open}
      >
        <motion.span animate={urgent ? { rotate: [0, -14, 12, -8, 6, 0] } : { rotate: 0 }} transition={{ duration: 0.9, repeat: urgent ? Infinity : 0, repeatDelay: 4 }}>
          <Bell size={17} />
        </motion.span>
        <AnimatePresence>
          {unseen.length ? (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-black text-white"
              style={{ background: urgent ? "#d03b3b" : "var(--t-accent)" }}
            >
              {unseen.length > 9 ? "9+" : unseen.length}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.button>
      {mounted ? createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div key="bell" className="fixed inset-0 z-[140]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <button type="button" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px] sm:bg-black/10 sm:backdrop-blur-0" />
              <motion.section
                role="dialog"
                aria-label="Notificaciones"
                initial={{ y: 40, opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[28px] border shadow-2xl sm:bottom-auto sm:left-auto sm:right-4 sm:top-[var(--bell-top)] sm:max-h-[min(75dvh,42rem)] sm:w-[26rem] sm:rounded-3xl"
                style={{ background: "var(--t-bg-base)", borderColor: "var(--t-card-border)", color: "var(--t-text)", ["--bell-top" as string]: `${top}px` }}
              >
                <span className="mx-auto mt-2 h-1.5 w-11 shrink-0 rounded-full sm:hidden" style={{ background: "color-mix(in oklab, var(--t-text) 18%, transparent)" }} aria-hidden />
                <header className="shrink-0 px-4 pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 15%, transparent)", color: "var(--t-accent)" }}><Bell size={17} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-black leading-tight">Notificaciones</p>
                      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                        {alerts.length ? <>{counts.urgent ? <b style={{ color: SEVERITY.critical.color }}>{counts.urgent} urgentes</b> : "Nada urgente"} · {unseen.length ? `${unseen.length} nuevas` : "todo visto"}</> : "Todo en orden"}
                      </p>
                    </div>
                    <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={15} /></button>
                  </div>
                  {alerts.length ? (
                    <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                      {([["all", "Todas"], ["new", "Nuevas"], ["urgent", "Urgentes"], ["attention", "Atención"]] as const).map(([k, label]) => (
                        counts[k] || k === "all" ? (
                          <button key={k} type="button" onClick={() => setFilter(k)}
                            className="shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition"
                            style={filter === k
                              ? { background: k === "urgent" ? SEVERITY.critical.color : "var(--t-accent)", borderColor: "transparent", color: "#fff" }
                              : { borderColor: "var(--t-card-border)", color: "var(--t-text)" }}>
                            {label} <span className="opacity-75">{counts[k]}</span>
                          </button>
                        ) : null
                      ))}
                      {unseen.length ? (
                        <button type="button" onClick={markAllSeen} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold" style={{ color: "var(--t-accent)" }}>
                          <CheckCheck size={14} /> Marcar vistas
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </header>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-1">
                  {!alerts.length ? (
                    <div className="px-3 py-10 text-center">
                      <p className="text-4xl">✨</p>
                      <p className="mt-2 text-sm font-bold">Todo en orden</p>
                      <p className="text-xs" style={{ color: "var(--t-muted)" }}>No hay avisos pendientes.</p>
                    </div>
                  ) : !ordered.length ? (
                    <p className="px-3 py-8 text-center text-sm" style={{ color: "var(--t-muted)" }}>Nada en este filtro. 👌</p>
                  ) : (
                    ordered.map((alert, i) => (
                      <motion.div key={alert.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.025 }}>
                        <AlertRow compact alert={alert} unseen={!seen.includes(alert.key)} onNavigate={() => { markSeen(alert.key); setOpen(false); }} />
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.section>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      ) : null}
    </div>
  );
}
