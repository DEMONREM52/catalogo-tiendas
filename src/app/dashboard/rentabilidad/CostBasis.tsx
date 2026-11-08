"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Scale, Wand2 } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, Field } from "@/components/forms/Fields";
import { Sheet as FormSheet } from "@/components/forms/Sheet";
import { cardStyle, cop, rpcError, swalTheme } from "./shared";

type Cfg = { basis: "average" | "last"; from: string | null; can_edit: boolean; open_settlement: { id: string; number: number } | null };
type Preview = {
  ok: boolean; applied: boolean; lines: number; profit_change: number; skipped_approved: number; unchanged: number;
  rows: Array<{ name: string; sold_at: string; qty: number; revenue: number; old_unit: number; new_unit: number; old_profit: number; new_profit: number }>;
};
const n = (v: unknown) => Number(v ?? 0);
const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const fail = (e: unknown) => void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(e) });

/**
 * Con qué costo se calcula la ganancia de las ventas de un punto (20261287):
 * promedio de la empresa o el último costo (el mismo con que se calcula el precio).
 */
export function CostBasisPanel({ storeId, point, onChanged }: { storeId: string; point: string; onChanged: () => void }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [missing, setMissing] = useState(false);
  const [fixing, setFixing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_pool_cost_basis_get", { p_store: storeId, p_point: point });
    if (error) { setMissing(/erp_pool_cost_basis_get|schema cache|does not exist/i.test(error.message)); setCfg(null); return; }
    setCfg(data as Cfg);
  }, [storeId, point]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function setBasis(basis: "average" | "last") {
    if (!cfg || cfg.basis === basis) return;
    const ok = await Swal.fire({ ...swalTheme, icon: "question",
      title: basis === "last" ? "¿Calcular la ganancia con el último costo?" : "¿Volver al costo promedio?",
      text: basis === "last" ? "Desde ya, cada venta de este punto guarda como costo el de la factura más reciente (el mismo con que se calcula el precio). Lo vendido antes no cambia solo." : "Desde ya, las ventas nuevas usan el costo promedio de la empresa.",
      showCancelButton: true, confirmButtonText: "Sí, cambiar", cancelButtonText: "Cancelar" });
    if (!ok.isConfirmed) return;
    const { error } = await supabaseBrowser().rpc("erp_pool_cost_basis_save", { p_store: storeId, p_point: point, p_basis: basis });
    if (error) return fail(error);
    await load();
    onChanged();
    if (basis === "last") {
      const r = await Swal.fire({ ...swalTheme, icon: "success", title: "Listo", text: "¿Quieres corregir también las ventas que ya se hicieron (las que no están en una liquidación aprobada)?", showCancelButton: true, confirmButtonText: "Sí, revisar", cancelButtonText: "Ahora no" });
      if (r.isConfirmed) setFixing(true);
    }
  }

  if (missing) return <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">Para escoger con qué costo se calcula la ganancia ejecuta en Supabase la migración 20261287_costo_ultimo_en_liquidacion.sql.</p>;
  if (!cfg) return null;
  const opt = (k: "average" | "last", title: string, text: string) => (
    <button type="button" disabled={!cfg.can_edit} onClick={() => void setBasis(k)} className="flex-1 rounded-xl border px-3 py-2 text-left text-sm transition disabled:cursor-default"
      style={cfg.basis === k ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: "var(--t-card-border)", opacity: cfg.can_edit ? 1 : 0.6 }}>
      <b className="block">{cfg.basis === k ? "✓ " : ""}{title}</b>
      <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{text}</span>
    </button>
  );

  return (
    <section className="rounded-2xl border p-4" style={cardStyle}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#3987e5,#8b5cf6)" }}><Scale size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-black">Costo para calcular la ganancia</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {cfg.basis === "last" ? `Último costo desde el ${day(cfg.from)}: el mismo con que se calcula el precio.` : "Costo promedio de la empresa (mezcla compras viejas y nuevas)."}
          </p>
        </div>
        {cfg.can_edit ? (
          <button type="button" onClick={() => setFixing(true)} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <Wand2 size={13} /> Corregir ventas ya hechas
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {opt("last", "Último costo (recomendado)", "Si el precio baja porque compraste más barato, la ganancia también usa ese costo. Sin pérdidas falsas.")}
        {opt("average", "Costo promedio", "Mezcla lo comprado caro antes con lo nuevo; puede mostrar pérdidas que no existen.")}
      </div>
      <AnimatePresence>{fixing ? <RecostSheet key="fix" storeId={storeId} point={point} open={cfg.open_settlement} onClose={() => setFixing(false)} onDone={() => { setFixing(false); onChanged(); }} /> : null}</AnimatePresence>
    </section>
  );
}

function RecostSheet({ storeId, point, open, onClose, onDone }: { storeId: string; point: string; open: Cfg["open_settlement"]; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(() => { const d = new Date(Date.now() - 30 * 86400_000 - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); });
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(apply: boolean) {
    if (!from) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_sale_finance_recost_last", { p_store: storeId, p_point: point, p_from: `${from}T00:00:00-05:00`, p_apply: apply });
    setBusy(false);
    if (error) return fail(error);
    const r = data as Preview;
    if (apply) {
      await Swal.fire({ ...swalTheme, icon: "success", title: `${r.lines} línea(s) corregida(s)`, text: `La ganancia cambió ${cop(r.profit_change)}. Ya puedes preparar la liquidación.` });
      onDone();
      return;
    }
    setPv(r);
  }

  return (
    <FormSheet title="Corregir ventas con el último costo" subtitle="Solo ventas que no están en una liquidación aprobada" icon={<Wand2 size={18} />} onClose={onClose} wide footer={
      <>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>Lo aprobado y pagado nunca se toca. Queda en la auditoría.</span>
        <button type="button" disabled={busy || !from} onClick={() => void run(false)} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>{busy && !pv ? "Revisando…" : "Ver qué cambia"}</button>
        <button type="button" disabled={busy || !pv || !pv.lines || Boolean(open)} onClick={() => void run(true)} className="rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#8b5cf6)" }}>Corregir {pv?.lines ? `(${pv.lines})` : ""}</button>
      </>
    }>
      {open ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Hay una liquidación abierta (#{open.number}) que ya tomó los costos viejos. Descártala con «Descartar y recalcular después», corrige aquí y vuelve a prepararla.
        </p>
      ) : null}
      <Field label="Corregir las ventas desde" hint="A cada venta se le pone el último costo que tenía el producto ese día."><DateField value={from} onChange={(v) => { setFrom(v); setPv(null); }} /></Field>
      {pv ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Líneas a corregir", String(pv.lines)], ["La ganancia cambia", cop(pv.profit_change)], ["En liquidaciones aprobadas (no se tocan)", String(pv.skipped_approved)]].map(([l, v]) => (
              <div key={l} className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{l}</p>
                <p className="font-black tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          {pv.rows.length ? (
            <div className="max-h-80 overflow-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
              <table className="w-full text-xs">
                <thead><tr style={{ color: "var(--t-muted)" }}><th className="p-2 text-left">Producto</th><th className="p-2 text-right">Venta</th><th className="p-2 text-right">Costo antes → ahora</th><th className="p-2 text-right">Ganancia antes → ahora</th></tr></thead>
                <tbody>
                  {pv.rows.map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="p-2"><b>{r.name}</b><span className="block" style={{ color: "var(--t-muted)" }}>{day(r.sold_at)} · {n(r.qty)} und.</span></td>
                      <td className="p-2 text-right tabular-nums">{cop(r.revenue)}</td>
                      <td className="p-2 text-right tabular-nums">{cop(n(r.old_unit))} → <b>{cop(n(r.new_unit))}</b></td>
                      <td className="p-2 text-right tabular-nums"><span style={{ color: n(r.old_profit) < 0 ? "#e66767" : undefined }}>{cop(r.old_profit)}</span> → <b style={{ color: n(r.new_profit) < 0 ? "#e66767" : "#22c55e" }}>{cop(r.new_profit)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm" style={{ color: "var(--t-muted)" }}>No hay ventas que cambien desde esa fecha.</p>}
        </div>
      ) : null}
    </FormSheet>
  );
}
