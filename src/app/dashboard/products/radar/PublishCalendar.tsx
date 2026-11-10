"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ddmmyyyy } from "@/lib/products/radar";

type Item = { id: string; name: string; image: string | null; by?: string | null };
type Day = { day: string; n: number; items: Item[] };
type Cal = { month: string; today: string; published: Day[]; due: Day[]; by_user: Array<{ name: string; n: number }> };

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const shift = (iso: string, m: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m, 1); return d.toISOString().slice(0, 10); };

/** Calendario del mes: lo publicado cada día (verde) y lo que toca (ámbar), y quién publicó cuánto. */
export function PublishCalendar({ storeId, onOpen }: { storeId: string; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState<string | null>(null);
  const [cal, setCal] = useState<Cal | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string | null>(null);

  const load = useCallback(async (m: string | null) => {
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("product_publish_calendar", { p_store: storeId, p_month: m });
    setBusy(false);
    const d = data as (Cal & { ok?: boolean }) | null;
    if (d?.ok) { setCal(d); setMonth(d.month); }
  }, [storeId]);
  useEffect(() => {
     
    void load(null);
  }, [load]);

  const cells = useMemo(() => {
    if (!cal) return [];
    const first = new Date(`${cal.month}T12:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7; // lunes primero
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const pub = new Map(cal.published.map((d) => [d.day, d]));
    const due = new Map(cal.due.map((d) => [d.day, d]));
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => {
        const iso = `${cal.month.slice(0, 8)}${String(i + 1).padStart(2, "0")}`;
        return { iso, n: i + 1, pub: pub.get(iso) ?? null, due: due.get(iso) ?? null };
      }),
    ];
  }, [cal]);

  if (!cal) return <p className="p-4 text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="mr-1 inline animate-spin" /> Cargando calendario…</p>;
  const m = new Date(`${cal.month}T12:00:00Z`);
  const sel = pick ? cells.find((c) => c && c.iso === pick) ?? null : null;
  const total = cal.published.reduce((s, d) => s + d.n, 0);
  const maxUser = Math.max(1, ...cal.by_user.map((u) => u.n));
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <div className="mb-2 flex items-center gap-2">
          <button type="button" onClick={() => month && void load(shift(month, -1))} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Mes anterior"><ChevronLeft size={15} /></button>
          <p className="flex-1 text-center text-sm font-black">{MONTHS[m.getUTCMonth()]} {m.getUTCFullYear()} {busy ? <Loader2 size={12} className="inline animate-spin" /> : null}</p>
          <button type="button" onClick={() => month && void load(shift(month, 1))} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Mes siguiente"><ChevronRight size={15} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold" style={{ color: "var(--t-muted)" }}>{["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((c, i) => c ? (
            <motion.button key={c.iso} type="button" whileTap={{ scale: 0.92 }} onClick={() => setPick(pick === c.iso ? null : c.iso)}
              className="relative flex aspect-square flex-col items-center justify-start rounded-xl border p-1 text-[11px]"
              style={{ borderColor: c.iso === cal.today ? "var(--t-accent)" : pick === c.iso ? "var(--t-text)" : "var(--t-card-border)", background: c.pub ? "color-mix(in oklab, #10b981 12%, transparent)" : "transparent" }}>
              <span className="font-bold">{c.n}</span>
              <span className="mt-auto flex flex-wrap justify-center gap-0.5">
                {c.pub ? <span className="rounded-full bg-emerald-500 px-1 text-[9px] font-black text-white" title={`${c.pub.n} publicados`}>{c.pub.n}</span> : null}
                {c.due ? <span className="rounded-full bg-amber-500 px-1 text-[9px] font-black text-white" title={`${c.due.n} por publicar`}>{c.due.n}</span> : null}
              </span>
            </motion.button>
          ) : <span key={`x${i}`} />)}
        </div>
        <p className="mt-2 flex flex-wrap gap-3 text-[11px]" style={{ color: "var(--t-muted)" }}>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Publicados</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Por publicar</span>
          <span>Toca un día para ver cuáles.</span>
        </p>
        <AnimatePresence>
          {sel ? (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden">
              <p className="text-xs font-black">{ddmmyyyy(sel.iso)}</p>
              {[["✅ Publicados", sel.pub], ["📣 Por publicar", sel.due]].map(([label, d]) => d && typeof d !== "string" ? (
                <div key={String(label)} className="mt-1.5">
                  <p className="text-[11px] font-bold">{String(label)} ({d.n})</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {d.items.slice(0, 40).map((it, k) => (
                      <li key={`${it.id}-${k}`}>
                        <button type="button" onClick={() => onOpen(it.id)} className="flex max-w-[14rem] items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>
                          {it.image ? <img src={it.image} alt="" className="h-5 w-5 rounded-full object-cover" /> : <span className="grid h-5 w-5 place-items-center">📦</span>}
                          <span className="truncate">{it.name}</span>{it.by ? <span style={{ color: "var(--t-muted)" }}>· {it.by}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null)}
              {!sel.pub && !sel.due ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Nada este día.</p> : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <aside className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <p className="text-xs font-black">🏆 Quién publicó este mes</p>
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{total} publicación{total === 1 ? "" : "es"} marcadas</p>
        <ul className="mt-2 space-y-2">
          {cal.by_user.map((u, i) => (
            <li key={u.name} className="text-xs">
              <div className="flex justify-between"><span className="font-bold">{i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}{u.name}</span><b className="tabular-nums">{u.n}</b></div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 8%, transparent)" }}>
                <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${(u.n / maxUser) * 100}%` }} style={{ background: "var(--t-accent)" }} />
              </div>
            </li>
          ))}
          {cal.by_user.length === 0 ? <li className="text-[11px]" style={{ color: "var(--t-muted)" }}>Nadie ha marcado publicaciones este mes.</li> : null}
        </ul>
      </aside>
    </section>
  );
}
