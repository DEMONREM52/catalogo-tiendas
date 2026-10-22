"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Inicio por persona (20261221):
 *  · «Tus pendientes»: lo que espera una acción tuya (traslados, pedidos internos, precios, productos sin costo).
 *  · «Hoy en tu punto»: ventas de hoy contra ayer, las tuyas y lo más vendido de la semana.
 * Si falta la migración, no se muestra nada (el inicio sigue igual).
 */

type Task = { key: string; icon: string; severity: "info" | "warning"; count: number; title: string; body: string; href: string; action: string };

const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" };
const money = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");

function useRpc<T>(fn: string, storeId: string, every: number) {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(async () => {
    const { data: res, error } = await supabaseBrowser().rpc(fn, { p_store: storeId });
    const r = res as (T & { ok?: boolean }) | null;
    setData(!error && r?.ok ? r : null);
  }, [fn, storeId]);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), every);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load, every]);
  return data;
}

export function MyTasks({ storeId }: { storeId: string }) {
  const data = useRpc<{ tasks: Task[] }>("erp_my_tasks", storeId, 2 * 60 * 1000);
  if (!data) return null;
  const tasks = data.tasks ?? [];
  return (
    <section className="rounded-[28px] border p-4 sm:p-5" style={card}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">✅ Tus pendientes</h3>
        {tasks.length ? <span className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>{tasks.reduce((s, t) => s + t.count, 0)}</span> : null}
      </div>
      {tasks.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl px-3 py-3 text-sm" style={{ background: "color-mix(in oklab, #10b981 10%, transparent)" }}>
          <CheckCircle2 size={18} className="text-emerald-500" /> Todo al día: no tienes nada pendiente.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((t, i) => (
            <motion.div key={t.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}>
              <Link href={t.href} className="group flex h-full items-start gap-3 rounded-2xl border p-3 transition hover:-translate-y-0.5"
                style={{ borderColor: t.severity === "warning" ? "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: t.severity === "warning" ? "color-mix(in oklab, #f59e0b 16%, transparent)" : "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>{t.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold leading-snug">{t.title}</span>
                  <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{t.body}</span>
                  <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold" style={{ color: "var(--t-accent)" }}>{t.action} <ArrowRight size={12} className="transition group-hover:translate-x-0.5" /></span>
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

type Today = { points: string[]; today: { count: number; total: number }; yesterday: { count: number; total: number }; mine: { count: number; total: number }; top: Array<{ name: string; qty: number }> };

export function PointToday({ storeId, hideWhenAllPoints }: { storeId: string; hideWhenAllPoints: boolean }) {
  const data = useRpc<Today>("erp_home_today", storeId, 60 * 1000);
  if (!data) return null;
  // El dueño ya tiene los informes completos; esto es para quien trabaja en un punto.
  if (hideWhenAllPoints && !data.points.length) return null;
  const diff = data.yesterday.total ? Math.round(((data.today.total - data.yesterday.total) / data.yesterday.total) * 100) : null;
  return (
    <section className="rounded-[28px] border p-4 sm:p-5" style={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">📍 Hoy {data.points.length ? `en ${data.points.join(", ")}` : "en la tienda"}</h3>
        <Link href="/dashboard/pos" className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>💳 Vender</Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Ventas de hoy</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{money(data.today.total)}</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {data.today.count} venta(s){diff !== null ? <> · <b style={{ color: diff >= 0 ? "#10b981" : "#ef4444" }}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff)} %</b> vs. ayer</> : null}
          </p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Tus ventas de hoy</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{money(data.mine.total)}</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>{data.mine.count} venta(s) a tu nombre</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Lo más vendido (7 días)</p>
          {data.top.length ? (
            <ol className="mt-1 space-y-0.5 text-xs">
              {data.top.map((t, i) => <li key={t.name} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {t.name}</span><b className="tabular-nums">{t.qty}</b></li>)}
            </ol>
          ) : <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Aún no hay ventas esta semana.</p>}
        </div>
      </div>
    </section>
  );
}

type GoalRow = { id: string; point: string | null; seller: string | null; amount: number; done: number; pct: number; projection: number };

/** Metas del mes y comisión propia (20261229): cómo va el punto o el vendedor. */
export function GoalsCard({ storeId }: { storeId: string }) {
  const [data, setData] = useState<{ goals: GoalRow[]; commission: number | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    void Promise.all([
      supabaseBrowser().rpc("erp_goals_progress", { p_store: storeId, p_month: null }),
      supabaseBrowser().rpc("erp_commissions", { p_store: storeId, p_from: from.toISOString(), p_to: to.toISOString() }),
    ]).then(([g, c]) => {
      if (!alive) return;
      const gv = g.data as { ok?: boolean; goals?: GoalRow[]; manage?: boolean } | null;
      const cv = c.data as { ok?: boolean; all?: boolean; sellers?: Array<{ commission: number }> } | null;
      const mine = cv?.ok && !cv.all ? Number(cv.sellers?.[0]?.commission ?? 0) : null;
      if (gv?.ok && (gv.goals?.length || mine)) setData({ goals: (gv.goals ?? []).slice(0, 4), commission: mine });
    });
    return () => { alive = false; };
  }, [storeId]);
  if (!data) return null;
  return (
    <section className="rounded-[28px] border p-4 sm:p-5" style={card}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">🎯 Metas del mes</h3>
        <Link href="/dashboard/equipo" className="text-xs font-semibold" style={{ color: "var(--t-accent)" }}>Ver todo →</Link>
      </div>
      {data.commission !== null ? <p className="mb-2 text-sm">💰 Tu comisión del mes: <b style={{ color: "#10b981" }}>{money(data.commission)}</b></p> : null}
      <div className="space-y-2.5">
        {data.goals.map((g) => (
          <div key={g.id}>
            <p className="flex justify-between text-xs"><b>{g.seller ? `👤 ${g.seller}` : `📍 ${g.point ?? "Tienda"}`}</b><span>{money(g.done)} / {money(g.amount)} · <b>{g.pct} %</b></span></p>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-bg-soft)" }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, g.pct)}%`, background: g.pct >= 100 ? "#10b981" : "linear-gradient(90deg,#8b5cf6,#0ea5e9)" }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
