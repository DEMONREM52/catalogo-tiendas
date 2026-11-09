"use client";
/* eslint-disable @next/next/no-img-element */

import { motion } from "framer-motion";
import { CalendarCheck, Check, Settings } from "lucide-react";
import { PublishButton } from "@/components/products/PublishButton";
import { publishStatusText, type PublishState, type RadarProduct } from "@/lib/products/radar";

/** Plan de hoy: los N productos que conviene publicar hoy y cuántos ya se hicieron. */
export function PlanToday<T extends RadarProduct>({
  done, todo, target, today, storeId, onPub, onOpen, onSettings,
}: {
  done: T[]; todo: T[]; target: number; today: string; storeId: string | null;
  onPub: (id: string, s: PublishState) => void; onOpen: (id: string) => void; onSettings: () => void;
}) {
  const count = Math.min(done.length, target);
  const pct = Math.round((count / Math.max(1, target)) * 100);
  const complete = done.length >= target;
  return (
    <section className="rounded-2xl border p-3" style={{ borderColor: complete ? "#10b981" : "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))", background: complete ? "color-mix(in oklab, #10b981 8%, var(--t-card-bg))" : "linear-gradient(135deg, color-mix(in oklab, #f59e0b 10%, var(--t-card-bg)), var(--t-card-bg))" }}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: complete ? "#10b981" : "linear-gradient(135deg,#f59e0b,#ec4899)" }}><CalendarCheck size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">{complete ? "🎉 ¡Plan de hoy cumplido!" : `🗓️ Plan de hoy: publica ${target}`}</p>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Primero lo atrasado, luego lo quieto con más unidades y lo nunca publicado.</p>
        </div>
        <span className="text-sm font-black tabular-nums">{count}/{target}</span>
        <button type="button" onClick={onSettings} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cuántos por día" title="Cuántos por día"><Settings size={14} /></button>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }}>
        <motion.div className="h-full rounded-full" initial={false} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} style={{ background: "linear-gradient(90deg,#f59e0b,#10b981)" }} />
      </div>
      {done.length + todo.length ? (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {[...done.slice(0, target), ...todo].map((r) => {
            const isDone = done.includes(r);
            const st = publishStatusText(r.pub, today);
            return (
              <motion.li key={r.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                className="w-40 shrink-0 rounded-xl border p-2" style={{ borderColor: isDone ? "#10b981" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <button type="button" onClick={() => onOpen(r.id)} className="relative block aspect-square w-full overflow-hidden rounded-lg" style={{ background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }}>
                  {r.image ? <img src={r.image} alt="" loading="lazy" className={`h-full w-full object-cover ${isDone ? "opacity-60" : ""}`} /> : <span className="grid h-full place-items-center text-2xl">📷</span>}
                  {isDone ? <span className="absolute inset-0 grid place-items-center"><motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white shadow-lg"><Check size={22} /></motion.span></span> : null}
                </button>
                <p className="mt-1 line-clamp-2 text-[11px] font-bold leading-tight">{r.name}</p>
                <p className="text-[10px]" style={{ color: isDone ? "#10b981" : st.tone === "late" ? "#e5484d" : "var(--t-muted)" }}>{isDone ? "Publicado hoy ✓" : st.text}</p>
                {!isDone ? <div className="mt-1"><PublishButton compact storeId={storeId} productId={r.id} productName={r.name} state={r.pub} onChanged={(s) => onPub(r.id, s)} /></div> : null}
              </motion.li>
            );
          })}
        </ul>
      ) : <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>No hay nada pendiente por publicar. 🎉</p>}
    </section>
  );
}
