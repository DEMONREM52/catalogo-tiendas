"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Handshake, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

const POLL_MS = 30 * 60_000;
type Late = { point_id: string; name: string; overdue: number; days: number };

const read = (k: string) => { try { return window.localStorage.getItem(k) ?? ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const money = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

/**
 * Aviso de deudas VENCIDAS de los puntos con la bodega: la madre ve todos los puntos en mora;
 * un punto ve lo suyo. «Ya lo vi» lo calla hasta mañana en este equipo; ✕ lo calla 2 horas.
 */
export function InternalCreditAlertWatcher({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Late[]>([]);
  const [manage, setManage] = useState(false);
  const seenKey = `remhub:internal-seen:${storeId}`;
  const snoozeKey = `remhub:internal-snooze:${storeId}`;

  const check = useCallback(async () => {
    if (read(seenKey) === today() || Number(read(snoozeKey) || 0) > Date.now()) return setRows([]);
    const { data, error } = await supabaseBrowser().rpc("erp_internal_board", { p_store: storeId });
    const b = data as { ok?: boolean; can_manage?: boolean; points?: Array<{ point_id: string; name: string; configured: boolean; overdue?: number; oldest_overdue_days?: number | null }> } | null;
    if (error || !b?.ok) return setRows([]);
    setManage(Boolean(b.can_manage));
    setRows((b.points ?? []).filter((p) => p.configured && Number(p.overdue ?? 0) > 0)
      .map((p) => ({ point_id: p.point_id, name: p.name, overdue: Number(p.overdue), days: Number(p.oldest_overdue_days ?? 0) }))
      .sort((x, y) => y.overdue - x.overdue));
  }, [storeId, seenKey, snoozeKey]);

  useEffect(() => {
    const first = window.setTimeout(() => void check(), 9000);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, POLL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [check]);

  const total = rows.reduce((s, r) => s + r.overdue, 0);
  const maxDays = Math.max(0, ...rows.map((r) => r.days));
  const color = maxDays >= 7 ? "#ef4444" : "#f59e0b";

  return (
    <AnimatePresence>
      {rows.length ? (
        <motion.div
          key="internal-alert"
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.96 }}
          className="pointer-events-auto relative w-full overflow-hidden rounded-2xl border shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          style={{ borderColor: `color-mix(in oklab, ${color} 55%, var(--t-card-border))`, background: "color-mix(in oklab, var(--t-bg-base) 93%, transparent)", color: "var(--t-text)" }}
          role="alert"
        >
          <div className="flex gap-3 p-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${color} 20%, transparent)`, color }}>
              <Handshake size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">
                {manage
                  ? rows.length === 1 ? `🤝 ${rows[0].name} tiene deuda vencida con la bodega` : `🤝 ${rows.length} puntos tienen deuda vencida`
                  : "🤝 Tu punto tiene deuda vencida con la bodega"}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                Vencido {money(total)}{maxDays ? ` · el más antiguo hace ${maxDays} día${maxDays === 1 ? "" : "s"}` : ""}
                {manage && rows.length > 1 ? ` · ${rows.slice(0, 3).map((r) => `${r.name} ${money(r.overdue)}`).join(", ")}` : ""}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => router.push("/dashboard/inventario?tab=internal")} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: color }}>
                  Ver cuenta
                </button>
                <button type="button" onClick={() => { write(seenKey, today()); setRows([]); }} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                  ✅ Ya lo vi (hasta mañana)
                </button>
              </div>
            </div>
            <button type="button" onClick={() => { write(snoozeKey, String(Date.now() + 2 * 3_600_000)); setRows([]); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100" aria-label="Recordar en 2 horas">
              <X size={14} />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
