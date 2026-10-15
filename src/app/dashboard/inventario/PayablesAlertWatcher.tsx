"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, ChevronDown, ChevronUp, Wallet, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { playTone, unlockAudioOnFirstTouch } from "@/lib/sounds/tones";
import { dueColor, dueText, type PayablesBoard, type PayableRow } from "./payables-shared";

const POLL_MS = 10 * 60_000;
const RING_MS = 60 * 60_000; // suena como máximo una vez por hora en este equipo

const read = (k: string) => { try { return Number(window.localStorage.getItem(k) ?? 0) || 0; } catch { return 0; } };
const write = (k: string, v: number) => { try { window.localStorage.setItem(k, String(v)); } catch { /* sin almacenamiento */ } };
const money = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

/**
 * Aviso de cuentas por pagar que según las reglas tocan hoy (por vencer, vencidas o con
 * recordatorio). Cada persona puede marcar «Ya lo vi» (no vuelve hoy) o «En 1 hora».
 */
export function PayablesAlertWatcher({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<PayableRow[]>([]);
  const [sound, setSound] = useState(true);
  const [open, setOpen] = useState(false);
  const ringKey = `remhub:cxp-ring:${storeId}`;
  const overdue = rows.some((r) => (r.days_left ?? 1) < 0);

  const check = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_payables_board", { p_store: storeId, p_only_alerts: true });
    const res = data as PayablesBoard | null;
    if (error || !res?.ok) return setRows([]);
    setRows(res.rows);
    setSound(res.settings.sound);
    const now = Date.now();
    if (res.rows.length && res.settings.sound && now - read(ringKey) >= RING_MS) {
      write(ringKey, now);
      playTone(res.rows.some((r) => (r.days_left ?? 1) < 0) ? "intercomunicador" : "campana-dorada", 0.8);
    }
  }, [storeId, ringKey]);

  useEffect(() => {
    unlockAudioOnFirstTouch();
    const first = window.setTimeout(() => void check(), 6000);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, POLL_MS);
    const onFocus = () => void check();
    const onChanged = () => void check();
    window.addEventListener("focus", onFocus);
    window.addEventListener("remhub:payables-changed", onChanged);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("remhub:payables-changed", onChanged); };
  }, [check]);

  async function ack(ids: string[], minutes: number | null) {
    setRows((cur) => cur.filter((r) => !ids.includes(r.id)));
    await Promise.all(ids.map((id) => supabaseBrowser().rpc("erp_payable_alert_ack", { p_payable: id, p_minutes: minutes })));
    window.dispatchEvent(new Event("remhub:payables-changed"));
  }

  const go = () => { setOpen(false); router.push("/dashboard/inventario?tab=payables"); };
  const color = overdue ? "#ef4444" : "#f59e0b";
  const total = rows.reduce((s, r) => s + Number(r.balance), 0);
  const ids = rows.map((r) => r.id);

  return (
    <AnimatePresence>
      {rows.length ? (
        <motion.div
          key="cxp-alert"
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="pointer-events-auto relative w-full overflow-hidden rounded-2xl border shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          style={{ borderColor: `color-mix(in oklab, ${color} 55%, var(--t-card-border))`, background: "color-mix(in oklab, var(--t-bg-base) 93%, transparent)", color: "var(--t-text)" }}
          role="alert"
        >
          <div className="flex gap-3 p-3.5">
            <motion.span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
              style={{ background: `color-mix(in oklab, ${color} 20%, transparent)`, color }}
              animate={{ rotate: [0, -14, 12, -8, 6, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, repeatDelay: overdue ? 1.5 : 4 }}
            >
              {sound ? <BellRing size={21} /> : <Wallet size={21} />}
            </motion.span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">
                {overdue ? "🔴 " : "💸 "}
                {rows.length === 1 ? `${rows[0].supplier_name ?? "Proveedor"}: ${dueText(rows[0]).toLowerCase()}` : `${rows.length} cuentas por pagar requieren atención`}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                Saldo {money(total)}{rows.length === 1 && rows[0].reminder?.note ? ` · 📝 ${rows[0].reminder.note}` : ""}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={go} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: color }}>
                  <Wallet size={13} /> Ver cuentas
                </button>
                {rows.length > 1 ? (
                  <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                    {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Cuáles
                  </button>
                ) : null}
                <button type="button" onClick={() => void ack(ids, 60)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⏰ En 1 hora</button>
                <button type="button" onClick={() => void ack(ids, null)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>✅ Ya lo vi</button>
              </div>
            </div>
            <button type="button" onClick={() => void ack(ids, 60)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 transition hover:opacity-100" aria-label="Recordar en 1 hora">
              <X size={14} />
            </button>
          </div>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.ul initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="max-h-60 overflow-y-auto border-t px-3.5" style={{ borderColor: "var(--t-card-border)" }}>
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-2.5 py-2 text-xs">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dueColor(r) }} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{r.supplier_name ?? "Proveedor"}</b>
                      <span style={{ color: "var(--t-muted)" }}>{dueText(r)} · {money(r.balance)}</span>
                    </span>
                    <button type="button" onClick={() => void ack([r.id], null)} className="rounded-md border px-2 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Visto</button>
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
