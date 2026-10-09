"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Box,
  CalendarClock,
  CheckCheck,
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
    // Alertas del ERP + fiscales, de seguridad y de usuarios (si la migración fiscal no está, se ignoran).
    const [base, extra] = await Promise.all([sb.rpc("erp_alerts", { p_store: storeId }), sb.rpc("erp_extra_alerts", { p_store: storeId })]);
    const rows = [
      ...(!base.error && Array.isArray(base.data) ? (base.data as StoreAlert[]) : []),
      ...(!extra.error && Array.isArray(extra.data) ? (extra.data as StoreAlert[]) : []),
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

export function AlertRow({ alert, onNavigate }: { alert: StoreAlert; onNavigate?: () => void }) {
  const Icon = ICONS[alert.icon] ?? Bell;
  const severity = SEVERITY[alert.severity];
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
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  if (!storeId) return null;

  return (
    <div ref={boxRef} className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen((v) => !v)}
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
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 z-[70] mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border shadow-2xl"
            style={{ background: "var(--t-bg-base)", borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
          >
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-sm font-bold">Notificaciones</p>
              {alerts.length ? (
                <button type="button" onClick={markAllSeen} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--t-accent)" }}>
                  <CheckCheck size={14} /> Marcar como vistas
                </button>
              ) : null}
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {alerts.length ? (
                alerts.map((alert) => (
                  <div key={alert.key} className="relative">
                    {!seen.includes(alert.key) ? <span className="absolute right-3 top-3 h-2 w-2 rounded-full" style={{ background: "var(--t-accent)" }} /> : null}
                    <AlertRow alert={alert} onNavigate={() => setOpen(false)} />
                  </div>
                ))
              ) : (
                <p className="px-3 py-8 text-center text-sm" style={{ color: "var(--t-muted)" }}>Todo en orden. No hay avisos pendientes. ✨</p>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
