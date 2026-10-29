"use client";

import { useCallback, useEffect, useState } from "react";
import { inOneTab } from "@/lib/sounds/one-tab";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, ChevronDown, ChevronUp, Receipt, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { playTone, unlockAudioOnFirstTouch } from "@/lib/sounds/tones";

type Pending = { id: string; name: string; sku: string | null; image_url: string | null; created_at: string; hours: number };

const POLL_MS = 5 * 60_000;
const RING_MS = 30 * 60_000; // insiste cada 30 min…
const RING_CRITICAL_MS = 10 * 60_000; // …y cada 10 min si ya pasaron 4 horas
const CRITICAL_HOURS = 4;

const read = (k: string) => { try { return Number(window.localStorage.getItem(k) ?? 0) || 0; } catch { return 0; } };
const write = (k: string, v: number) => { try { window.localStorage.setItem(k, String(v)); } catch { /* sin almacenamiento */ } };
const waited = (h: number) => (h < 24 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} d ${Math.floor(h % 24)} h`);

/**
 * Aviso urgente (con sonido) de productos creados hace más de 1 hora sin ingreso de factura
 * (sin costo ni unidades). Solo lo ven quienes tienen el permiso «Alertas de inventario».
 * Insiste hasta que se haga el ingreso; «Después» lo calla por 30 minutos en este equipo.
 */
export function InventoryAlertWatcher({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Pending[]>([]);
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  const snoozeKey = `remhub:inv-alert-snooze:${storeId}`;
  const ringKey = `remhub:inv-alert-ring:${storeId}`;
  const critical = rows.some((r) => r.hours >= CRITICAL_HOURS);

  const check = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_products_pending_entry", { p_store: storeId });
    const res = data as { ok?: boolean; rows?: Pending[] } | null;
    if (error || !res?.ok) return setRows([]);
    const list = res.rows ?? [];
    setRows(list);
    const now = Date.now();
    const snoozed = read(snoozeKey) > now;
    setHidden(!list.length || snoozed);
    if (!list.length || snoozed) return;
    const isCritical = list.some((r) => r.hours >= CRITICAL_HOURS);
    if (now - read(ringKey) >= (isCritical ? RING_CRITICAL_MS : RING_MS)) {
      write(ringKey, now);
      // Una sola pestaña suena. Crítico: dos veces seguidas.
      void inOneTab("inv-alert", () => {
        playTone("intercomunicador", isCritical ? 1 : 0.8);
        if (isCritical) window.setTimeout(() => playTone("intercomunicador", 1), 1200);
      }, 10000);
    }
  }, [storeId, snoozeKey, ringKey]);

  useEffect(() => {
    unlockAudioOnFirstTouch();
    const first = window.setTimeout(() => void check(), 4000);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, POLL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [check]);

  const later = () => { write(snoozeKey, Date.now() + RING_MS); setHidden(true); };
  const goEntry = () => { setOpen(false); router.push("/dashboard/inventario?tab=purchases"); };
  const color = critical ? "#ef4444" : "#f59e0b";

  return (
    <AnimatePresence>
      {!hidden && rows.length ? (
        <motion.div
          key="inv-alert"
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
              transition={{ duration: 0.9, repeat: Infinity, repeatDelay: critical ? 1.2 : 3 }}
            >
              <BellRing size={21} />
            </motion.span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">
                {critical ? "🚨 ¡Urgente! " : "⏰ "}
                {rows.length === 1 ? "1 producto espera su ingreso" : `${rows.length} productos esperan su ingreso`}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                Se crearon hace más de 1 hora y siguen <b>sin costo, sin precio y sin unidades</b>. Haz el ingreso de factura 🧾 para venderlos.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={goEntry} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: color }}>
                  <Receipt size={13} /> Hacer ingreso de factura
                </button>
                <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                  {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Ver cuáles
                </button>
                <button type="button" onClick={later} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                  😴 Después
                </button>
              </div>
            </div>
            <button type="button" onClick={later} className="grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 transition hover:opacity-100" aria-label="Recordar en 30 minutos">
              <X size={14} />
            </button>
          </div>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.ul initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="max-h-60 overflow-y-auto border-t px-3.5" style={{ borderColor: "var(--t-card-border)" }}>
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-2.5 py-2">
                    {r.image_url
                      ? <img src={r.image_url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> // eslint-disable-line @next/next/no-img-element
                      : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg" style={{ background: "color-mix(in oklab, var(--t-card-border) 35%, transparent)" }}>📦</span>}
                    <button type="button" onClick={() => router.push(`/dashboard/products/${r.id}`)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-xs font-bold">{r.name}</span>
                      {r.sku ? <span className="block text-[10px]" style={{ color: "var(--t-muted)" }}>Código {r.sku}</span> : null}
                    </button>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${r.hours >= CRITICAL_HOURS ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"}`}>⏳ {waited(r.hours)}</span>
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
          <motion.div className="h-1" style={{ background: color }} initial={{ scaleX: 0, originX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8 }} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
