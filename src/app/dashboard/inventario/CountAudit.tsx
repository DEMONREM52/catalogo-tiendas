"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Sheet } from "@/components/forms/Sheet";
import { downloadXlsx } from "@/lib/data/xlsx";
import type { Line } from "./LineEditor";
import { Btn, Panel, dateTime, money, toast } from "./shared";
import { debtAfterText } from "./PointDebtAdjust";

/** Lo que el sistema dice que hay en la bodega (20261340). */
export type StockItem = {
  product_id: string; name: string; sku: string | null; barcode: string | null; image_url: string | null; qty: number;
  pending_since: string | null; last_counted_at: string | null; recent: boolean;
};

/** «count» = conteo normal (lo no contado no se toca) · «start» = inventario inicial (lo que no está en la lista queda en 0). */
export type CountMode = "count" | "start";

export type AuditRow = {
  id: string; warehouse_id: string; warehouse: string; adjustment_id: string | null; adjustment_number: number | null;
  created_at: string; created_by_name: string | null; notes: string | null; mode?: CountMode;
  counted: number; matched: number; over: number; over_units: number; short: number; short_units: number;
  uncounted: number; uncounted_units: number; recent: number;
  over_value: number | null; short_value: number | null; uncounted_value: number | null;
  // 20261344
  removed?: number; removed_units?: number; removed_value?: number | null; net_value?: number | null;
  reverted_at?: string | null; reverted_by_name?: string | null; revert_note?: string | null;
  revert_adjustment_number?: number | null; revert_short?: Array<{ product_id: string; name: string; sku: string | null; short_by: number }>;
};
type AuditDetail = {
  audit: AuditRow;
  diffs: Array<{ product_id: string; name: string; sku: string | null; before: number; after: number; diff: number; unit_cost: number | null }>;
  uncounted: Array<{ product_id: string; name: string; sku: string | null; qty: number; unit_cost: number | null; still_pending: boolean }>;
  removed?: Array<{ product_id: string; name: string; sku: string | null; qty: number; unit_cost: number | null }>;
  can_cost: boolean;
  can_revert?: boolean; revert_block?: string | null;
};

/** Informe antes de aplicar (erp_count_preview, 20261344). Los valores en plata vienen en null sin «Ver costos». */
export type CountPreview = {
  ok: boolean; message?: string; mode: CountMode; can_cost: boolean;
  counted: number; matched: number;
  over: number; over_units: number; over_value: number | null;
  short: number; short_units: number; short_value: number | null;
  uncounted: number; uncounted_units: number; uncounted_value: number | null; recent: number;
  removed: number; removed_units: number; removed_value: number | null; negatives: number;
  net_units: number; net_value: number | null;
  top_diffs: Array<{ product_id: string; name: string; sku: string | null; before: number; after: number; diff: number; unit_cost: number | null }>;
  removed_items: Array<{ product_id: string; name: string; sku: string | null; qty: number; unit_cost: number | null }>;
};
type RevertPreview = {
  ok: boolean; message?: string; mode: CountMode; can_cost: boolean;
  changes: number; units_in: number; units_out: number; value: number | null; short: number;
  items: Array<{ product_id: string; name: string; sku: string | null; now: number; target: number; short_by: number; unit_cost: number | null }>;
};

const MISSING_FN = /Could not find the function|schema cache|does not exist/i;
export const AUDIT_MIGRATION = "Falta correr en Supabase la migración 20261340_auditoria_conteo.sql.";
export const START_MIGRATION = "Falta correr en Supabase la migración 20261344_inventario_inicial.sql.";
const pad = (n: number) => String(n).padStart(2, "0");
const dmy = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const n0 = (n: number) => n.toLocaleString("es-CO");
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Plata con signo: +$ 12.000 / −$ 80.000. */
export const signedMoney = (n: number | null | undefined) => { const v = Math.round(Number(n ?? 0)); return v > 0 ? `+${money(v)}` : v < 0 ? `−${money(-v)}` : money(0); };
const signedUnits = (n: number) => (n > 0 ? `+${n0(n)}` : n < 0 ? `−${n0(-n)}` : "0");
const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)" } as const;

/** Pide el informe antes de aplicar. `missing` = falta la migración 20261344. */
export async function loadCountPreview(storeId: string, warehouse: string, counted: Array<{ product_id: string; qty: number }>, mode: CountMode) {
  const { data, error } = await supabaseBrowser().rpc("erp_count_preview", { p_store: storeId, p_warehouse: warehouse, p_counted: counted, p_mode: mode });
  if (error) return { pv: null, missing: MISSING_FN.test(error.message), error: error.message };
  const pv = data as CountPreview | null;
  if (!pv?.ok) return { pv: null, missing: false, error: pv?.message ?? "No se pudo preparar el informe." };
  return { pv, missing: false, error: null };
}

/** El informe de diferencias en unidades y en plata (HTML para la confirmación o para verlo antes). */
export function countPreviewHtml(pv: CountPreview, warehouseName: string) {
  const cost = pv.can_cost;
  const start = pv.mode === "start";
  const cell = "padding:5px 6px;text-align:right;white-space:nowrap";
  const row = (icon: string, label: string, n: string, units: string, value: string, color = "inherit", strong = false) =>
    `<tr style="border-top:1px solid color-mix(in oklab,currentColor 12%,transparent)${strong ? ";font-weight:800" : ""}"><td style="padding:5px 6px">${icon}</td><td style="padding:5px 6px;text-align:left">${label}</td>`
    + `<td style="${cell}">${n}</td><td style="${cell};color:${color};font-weight:700">${units}</td>${cost ? `<td style="${cell};color:${color};font-weight:800">${value}</td>` : ""}</tr>`;
  const netColor = pv.net_units < 0 || Number(pv.net_value ?? 0) < 0 ? "#ef4444" : pv.net_units > 0 || Number(pv.net_value ?? 0) > 0 ? "#10b981" : "inherit";
  const table = `<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:8px">
    <thead><tr style="font-size:11px;opacity:.7"><th></th><th style="text-align:left;padding:3px 6px">Qué</th><th style="text-align:right;padding:3px 6px">Productos</th><th style="text-align:right;padding:3px 6px">Unidades</th>${cost ? `<th style="text-align:right;padding:3px 6px">Al costo</th>` : ""}</tr></thead>
    <tbody>
    ${row("✅", "Cuadran", n0(pv.matched), "0", money(0))}
    ${row("➕", "Sobran", n0(pv.over), signedUnits(pv.over_units), signedMoney(pv.over_value), "#10b981")}
    ${row("➖", "Faltan", n0(pv.short), signedUnits(-pv.short_units), signedMoney(-Number(pv.short_value ?? 0)), "#ef4444")}
    ${start
      ? row("🧹", "<b>Se sacan</b> (no están en la lista)", n0(pv.removed), signedUnits(-pv.removed_units), signedMoney(-Number(pv.removed_value ?? 0)), "#ef4444", true)
      : row("❓", "Sin contar <small style=\"opacity:.7\">(no se tocan)</small>", n0(pv.uncounted), n0(pv.uncounted_units), money(pv.uncounted_value ?? 0), "#f59e0b")}
    ${row("💰", "Diferencia neta", "", signedUnits(pv.net_units), signedMoney(pv.net_value), netColor, true)}
    </tbody></table>`;
  const top = pv.top_diffs.slice(0, 6).map((x) => `• <b>${esc(x.name)}</b>: sistema ${x.before} → contado ${x.after} (<b style="color:${x.diff < 0 ? "#ef4444" : "#10b981"}">${signedUnits(x.diff)}</b>${cost && x.unit_cost !== null ? ` · ${signedMoney(x.diff * x.unit_cost)}` : ""})`).join("<br>");
  const removed = start && pv.removed
    ? `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in oklab,#ef4444 55%,transparent);background:color-mix(in oklab,#ef4444 9%,transparent);text-align:left;font-size:12.5px;line-height:1.55">
        <b style="color:#ef4444">🚩 Estos ${n0(pv.removed)} productos NO están en tu lista y quedan en 0 en ${esc(warehouseName)}</b> (${n0(pv.removed_units)} und.${cost ? ` · ${money(pv.removed_value ?? 0)} al costo` : ""}):<br>
        ${pv.removed_items.slice(0, 10).map((r) => `• ${esc(r.name)}: tenía <b>${r.qty}</b> → 0${cost && r.unit_cost !== null && r.qty > 0 ? ` · ${money(r.qty * r.unit_cost)}` : ""}${r.qty < 0 ? " <small>(estaba en negativo)</small>" : ""}`).join("<br>")}
        ${pv.removed_items.length > 10 ? `<br>… y ${n0(pv.removed_items.length - 10)} más (la lista completa queda en el informe).` : ""}
        <br><small>Si algo de esto sí está, vuelve («Seguir contando») y cuéntalo. Si te arrepientes después, en el informe está «↩️ Revertir».</small>
      </div>`
    : "";
  return `${table}
    ${top ? `<div style="text-align:left;font-size:12.5px;line-height:1.55"><b>Las diferencias más grandes</b><br>${top}</div>` : ""}
    ${removed}
    <p style="font-size:12px;opacity:.85;margin:8px 0 0;text-align:left">${start
      ? `🚩 <b>Inventario inicial:</b> ${esc(warehouseName)} queda exactamente como tu lista.`
      : `Se ajustan solo los que sobran o faltan. Lo que no contaste <b>no se toca</b> y queda en «Pendientes por contar».${pv.recent ? ` ${n0(pv.recent)} productos ya se contaron en los últimos 30 días y no se piden otra vez.` : ""}`}
      ${cost ? "" : " Los valores en plata los ve quien tiene «Ver costos y márgenes»."}</p>`;
}

/** Explica qué hace el «Inventario inicial» antes de elegirlo. true = lo eligió. */
export async function confirmStartMode(warehouseName: string, items: StockItem[] | null, lines: Line[]) {
  const inList = new Set(lines.map((l) => l.product_id));
  const out = (items ?? []).filter((i) => !inList.has(i.product_id));
  const units = out.reduce((s, i) => s + i.qty, 0);
  const wh = esc(warehouseName);
  const r = await Swal.fire({
    icon: "warning", title: "🚩 Inventario inicial", width: "40rem",
    html: `<div style="text-align:left;font-size:14px;line-height:1.6">
      <p>Es para cuando <b>${wh}</b> va a <b>empezar con lo que contaron</b> (partida inicial): la lista que armes es <b>todo</b> lo que hay ahí.</p>
      <p style="margin-top:8px"><b>Al aplicar:</b></p>
      <ul style="margin:4px 0 0 18px;list-style:disc">
        <li>Lo que esté en la lista queda con la cantidad que escribiste.</li>
        <li style="color:#ef4444"><b>Todo lo demás que el sistema dice que hay en ${wh} queda en 0.</b>${items ? ` Hoy serían ${n0(out.length)} productos (${n0(units)} und.).` : ""}</li>
        <li>Antes de aplicar ves el informe: qué sobra, qué falta y qué se saca, en unidades y en plata, y lo tienes que confirmar.</li>
        <li>Si ${wh} tiene crédito con la bodega, su deuda baja por lo que se saca (y sube por lo que sobra).</li>
        <li>Si te arrepientes, en el informe está <b>«↩️ Revertir»</b>: todo vuelve como estaba, respetando lo que se venda después.</li>
      </ul>
      <p style="margin-top:8px;font-size:12px;opacity:.8">¿Solo quieres contar una parte? Usa el conteo normal: lo que no cuentes no se toca.</p></div>`,
    showCancelButton: true, confirmButtonText: "🚩 Sí, es inventario inicial", cancelButtonText: "Mejor conteo normal",
    confirmButtonColor: "#ef4444", ...swalTheme,
  });
  return r.isConfirmed;
}

/** Lo que hay en la bodega según el sistema. `ready` = la migración está y se pudo leer. */
export function useStockForCount(storeId: string, warehouse: string, enabled: boolean) {
  // Se guarda con la bodega: al cambiar de bodega no se muestra la lista de la anterior.
  const [data, setData] = useState<{ key: string; items: StockItem[] } | null>(null);
  const items = data && data.key === warehouse ? data.items : null;
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const reload = useCallback(async () => {
    if (!enabled || !warehouse) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_count_progress", { p_store: storeId, p_warehouse: warehouse });
    const r = data as { ok: boolean; message?: string; items?: StockItem[] } | null;
    if (e && MISSING_FN.test(e.message)) { setMissing(true); return; }
    if (e || !r?.ok) { setError(e?.message ?? r?.message ?? "No se pudo leer la bodega."); return; }
    setError("");
    setMissing(false);
    setData({ key: warehouse, items: r.items ?? [] });
  }, [storeId, warehouse, enabled]);
  useEffect(() => {
    const t = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(t);
  }, [reload]);
  return { items, error, missing, reload, ready: Boolean(items) };
}

/** Lo que falta contar: lo que hay según el sistema y no está en la lista (lo contado hace poco va aparte). */
export function splitMissing(items: StockItem[] | null, lines: Line[]) {
  const inList = new Set(lines.map((l) => l.product_id));
  const out = (items ?? []).filter((i) => !inList.has(i.product_id));
  const missing = out.filter((i) => !i.recent);
  const recent = out.filter((i) => i.recent);
  return { missing, recent, units: missing.reduce((s, i) => s + i.qty, 0), pending: missing.filter((i) => i.pending_since).length };
}

/** Avance del conteo y la lista de lo que falta contar. */
export function AuditProgress({ items, lines, warehouseName, error, onAdd, onReload, mode = "count" }: {
  items: StockItem[] | null; lines: Line[]; warehouseName: string; error: string;
  onAdd: (item: StockItem, qty: number) => void; onReload: () => void;
  /** «start» = inventario inicial: lo que falta en la lista se va a sacar (en rojo). */
  mode?: CountMode;
}) {
  const [open, setOpen] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const { missing, recent, units, pending } = useMemo(() => splitMissing(items, lines), [items, lines]);
  // Inventario inicial: TODO lo que no está en la lista se saca (también lo contado hace poco).
  const removeAll = useMemo(() => [...missing, ...recent].sort((x, y) => y.qty - x.qty || x.name.localeCompare(y.name, "es")), [missing, recent]);

  if (error) return <p className="mt-3 text-xs text-amber-500">⚠️ {error} <button type="button" className="underline" onClick={onReload}>Reintentar</button></p>;
  if (!items) return <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>Revisando lo que hay en {warehouseName}…</p>;
  if (mode === "start") return <StartProgress lines={lines} out={removeAll} warehouseName={warehouseName} onAdd={onAdd} onReload={onReload} />;

  const total = lines.length + missing.length;
  const pct = total ? Math.round((lines.length / total) * 100) : 100;
  const source = showRecent ? [...missing, ...recent] : missing;
  const term = q.trim().toLowerCase();
  const shown = term ? source.filter((i) => `${i.name} ${i.sku ?? ""} ${i.barcode ?? ""}`.toLowerCase().includes(term)) : source;

  async function count(item: StockItem) {
    const qty = await askCounted(item);
    if (qty !== null) onAdd(item, qty);
  }

  return (
    <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: missing.length ? "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))" : "color-mix(in oklab, #10b981 45%, var(--t-card-border))" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">
            🔎 Auditoría de {warehouseName}: llevas <span className="tabular-nums">{n0(lines.length)}</span> contados
            {missing.length ? <> · faltan <span className="tabular-nums text-amber-500">{n0(missing.length)}</span> productos ({n0(units)} und.)</> : <span className="text-emerald-500"> · ✅ contaste todo lo que el sistema dice que hay</span>}
          </p>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
            {pending ? `⏳ ${n0(pending)} pendientes de una auditoría anterior · ` : ""}
            {recent.length ? `${n0(recent.length)} ya se contaron en los últimos 30 días · ` : ""}
            Lo que no cuentes no se toca: queda en «Pendientes por contar».
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-card-border) 70%, transparent)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: missing.length ? "linear-gradient(90deg,#8b5cf6,#f59e0b)" : "#10b981" }} />
          </div>
        </div>
        {missing.length || recent.length ? (
          <Btn variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Ocultar" : `🔎 Ver lo que falta contar (${n0(missing.length)})`}</Btn>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(40); }} placeholder="Buscar en lo que falta: nombre o código"
              className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
            {recent.length ? (
              <label className="inline-flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={showRecent} onChange={(e) => setShowRecent(e.target.checked)} /> Ver también lo contado hace poco ({n0(recent.length)})
              </label>
            ) : null}
            <button type="button" className="text-xs underline" style={{ color: "var(--t-muted)" }} onClick={onReload}>Actualizar</button>
          </div>
          {shown.length === 0 ? <p className="py-3 text-center text-xs" style={{ color: "var(--t-muted)" }}>Nada con ese nombre en lo que falta contar.</p> : null}
          <div className="space-y-1.5">
            {shown.slice(0, limit).map((i) => (
              <div key={i.product_id} className="flex items-center gap-2.5 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border" style={{ borderColor: "var(--t-card-border)" }}>
                  {i.image_url ? <img src={i.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span>📦</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{i.name}</span>
                  <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {i.sku ? `${i.sku} · ` : ""}el sistema dice <b>{i.qty}</b>
                    {i.pending_since ? ` · ⏳ pendiente desde ${dmy(i.pending_since)}` : i.recent && i.last_counted_at ? ` · contado el ${dmy(i.last_counted_at)}` : ""}
                  </span>
                </span>
                <button type="button" onClick={() => void count(i)} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}>Contar</button>
                <button type="button" onClick={() => onAdd(i, 0)} title="No se encontró: entra al conteo en 0 (faltante)" className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>No está</button>
              </div>
            ))}
          </div>
          {shown.length > limit ? (
            <button type="button" onClick={() => setLimit((n) => n + 40)} className="w-full rounded-xl border py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              Ver más ({n0(shown.length - limit)} restantes)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** «¿Cuántos contaste?» de un producto de la lista de la bodega (null = canceló). */
async function askCounted(item: StockItem): Promise<number | null> {
  const r = await Swal.fire({
    title: "¿Cuántos contaste?", html: `<b>${esc(item.name)}</b><br><small>El sistema dice ${item.qty}.</small>`,
    input: "number", inputAttributes: { min: "0", step: "1", inputmode: "numeric" }, inputPlaceholder: "Lo que contaste",
    showCancelButton: true, confirmButtonText: "Agregar al conteo", cancelButtonText: "Cancelar",
    ...swalTheme, confirmButtonColor: "#8b5cf6",
    inputValidator: (v) => (v === "" || !Number.isInteger(Number(v)) || Number(v) < 0 ? "Escribe un número entero (0 o más)" : null),
  });
  return r.isConfirmed ? Number(r.value) : null;
}

/** Inventario inicial: lo que el sistema dice que hay y no está en la lista, en rojo (se va a sacar). */
function StartProgress({ lines, out, warehouseName, onAdd, onReload }: {
  lines: Line[]; out: StockItem[]; warehouseName: string;
  onAdd: (item: StockItem, qty: number) => void; onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const units = out.reduce((s, i) => s + i.qty, 0);
  const term = q.trim().toLowerCase();
  const shown = term ? out.filter((i) => `${i.name} ${i.sku ?? ""} ${i.barcode ?? ""}`.toLowerCase().includes(term)) : out;
  const red = "#ef4444";
  return (
    <div className="mt-3 rounded-2xl border-2 p-3" style={{ borderColor: out.length ? `color-mix(in oklab, ${red} 60%, transparent)` : "color-mix(in oklab, #10b981 45%, var(--t-card-border))", background: out.length ? `color-mix(in oklab, ${red} 6%, transparent)` : undefined }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">
            🚩 Inventario inicial de {warehouseName}: <span className="tabular-nums">{n0(lines.length)}</span> en la lista
            {out.length
              ? <> · <span className="tabular-nums" style={{ color: red }}>se sacan {n0(out.length)} productos ({n0(units)} und.)</span> que no están en la lista</>
              : <span className="text-emerald-500"> · ✅ todo lo que el sistema dice que hay está en tu lista</span>}
          </p>
          <p className="text-[11px]" style={{ color: out.length ? red : "var(--t-muted)" }}>
            Al aplicar, {warehouseName} queda exactamente como tu lista. Si algo de lo que se saca sí está, tócalo y cuéntalo.
          </p>
        </div>
        {out.length ? <Btn variant="danger" onClick={() => setOpen((v) => !v)}>{open ? "Ocultar" : `🧹 Ver lo que se va a sacar (${n0(out.length)})`}</Btn> : null}
      </div>
      {open ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(40); }} placeholder="Buscar en lo que se saca: nombre o código"
              className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
            <button type="button" className="text-xs underline" style={{ color: "var(--t-muted)" }} onClick={onReload}>Actualizar</button>
          </div>
          {shown.length === 0 ? <p className="py-3 text-center text-xs" style={{ color: "var(--t-muted)" }}>Nada con ese nombre en lo que se saca.</p> : null}
          <div className="space-y-1.5">
            {shown.slice(0, limit).map((i) => (
              <div key={i.product_id} className="flex items-center gap-2.5 rounded-xl border p-2" style={{ borderColor: `color-mix(in oklab, ${red} 40%, transparent)` }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border" style={{ borderColor: "var(--t-card-border)" }}>
                  {i.image_url ? <img src={i.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span>📦</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold" style={{ color: red }}>{i.name}</span>
                  <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {i.sku ? `${i.sku} · ` : ""}el sistema dice <b>{i.qty}</b> → <b style={{ color: red }}>queda en 0</b>
                  </span>
                </span>
                <button type="button" onClick={() => void askCounted(i).then((qty) => { if (qty !== null) onAdd(i, qty); })}
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }} title="Sí está: agrégalo a la lista con lo que contaste">Sí está: contar</button>
              </div>
            ))}
          </div>
          {shown.length > limit ? (
            <button type="button" onClick={() => setLimit((n) => n + 40)} className="w-full rounded-xl border py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              Ver más ({n0(shown.length - limit)} restantes)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Resumen antes de aplicar (HTML para la confirmación). */
export function auditSummaryHtml(all: Array<{ qty: number; current: number }>, missing: number, missingUnits: number, recent: number) {
  const over = all.filter((l) => l.qty > l.current);
  const short = all.filter((l) => l.qty < l.current);
  const matched = all.length - over.length - short.length;
  const row = (icon: string, label: string, value: string, extra = "", color = "inherit") =>
    `<tr><td style="padding:4px 6px">${icon}</td><td style="padding:4px 6px;text-align:left">${label}</td><td style="padding:4px 6px;text-align:right;font-weight:800;color:${color}">${value}</td><td style="padding:4px 6px;text-align:right;opacity:.75">${extra}</td></tr>`;
  return `<table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:8px">
    ${row("✅", "Cuadran", n0(matched))}
    ${row("➕", "Sobran", n0(over.length), `+${n0(over.reduce((s, l) => s + l.qty - l.current, 0))} und.`, "#10b981")}
    ${row("➖", "Faltan", n0(short.length), `−${n0(short.reduce((s, l) => s + l.current - l.qty, 0))} und.`, "#ef4444")}
    ${row("❓", "Sin contar", n0(missing), `${n0(missingUnits)} und.`, missing ? "#f59e0b" : "inherit")}
  </table>
  <p style="font-size:12px;opacity:.85;margin:0">Se ajustan solo los que sobran o faltan. Lo que no contaste <b>no se toca</b> y queda en «Pendientes por contar».${recent ? ` ${n0(recent)} productos ya se contaron en los últimos 30 días y no se piden otra vez.` : ""}</p>`;
}

/** El informe guardado de una auditoría. */
export function AuditReport({ auditId, onClose, onChanged }: { auditId: string | null; onClose: () => void; onChanged?: () => void }) {
  return <AnimatePresence>{auditId ? <AuditReportSheet key={auditId} auditId={auditId} onClose={onClose} onChanged={onChanged} /> : null}</AnimatePresence>;
}

function AuditReportSheet({ auditId, onClose, onChanged }: { auditId: string; onClose: () => void; onChanged?: () => void }) {
  const [d, setD] = useState<AuditDetail | null>(null);
  const [tab, setTab] = useState<"short" | "over" | "uncounted" | "removed">("short");
  const [q, setQ] = useState("");
  const [version, setVersion] = useState(0);
  const [reverting, setReverting] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_count_audit_get", { p_audit: auditId }).then(({ data, error }) => {
      if (!alive) return;
      const r = data as ({ ok: boolean; message?: string } & AuditDetail) | null;
      if (error || !r?.ok) { void toast("No se pudo abrir la auditoría", "error", error && MISSING_FN.test(error.message) ? AUDIT_MIGRATION : error?.message ?? r?.message); onClose(); return; }
      setD(r);
      setTab((cur) => (version ? cur : r.audit.short ? "short" : r.audit.over ? "over" : r.audit.mode === "start" ? "removed" : "uncounted"));
    });
    return () => { alive = false; };
  }, [auditId, onClose, version]);

  const a = d?.audit;
  const start = a?.mode === "start";
  const shortRows = d?.diffs.filter((x) => x.diff < 0) ?? [];
  const overRows = d?.diffs.filter((x) => x.diff > 0) ?? [];
  const removedRows = d?.removed ?? [];
  const term = q.trim().toLowerCase();
  const unc = (d?.uncounted ?? []).filter((u) => !term || `${u.name} ${u.sku ?? ""}`.toLowerCase().includes(term));
  const rem = removedRows.filter((u) => !term || `${u.name} ${u.sku ?? ""}`.toLowerCase().includes(term));
  const stillPending = d?.uncounted.filter((u) => u.still_pending).length ?? 0;
  const title = a ? `${start ? "Inventario inicial" : "Auditoría"} · ${a.warehouse}` : "Auditoría";
  const netUnits = a ? a.over_units - a.short_units - (a.removed_units ?? 0) : 0;
  const hasNet = Boolean(d?.can_cost && a && a.net_value !== undefined && a.net_value !== null);

  async function revert() {
    if (!d || !a) return;
    const { data, error } = await supabaseBrowser().rpc("erp_count_revert_preview", { p_audit: a.id });
    const p = data as RevertPreview | null;
    if (error || !p?.ok) return void toast("No se puede revertir", "error", error ? (MISSING_FN.test(error.message) ? START_MIGRATION : error.message) : p?.message);
    const what = start ? "el inventario inicial" : "este conteo";
    const list = p.items.slice(0, 10).map((i) => `• <b>${esc(i.name)}</b>: hoy ${i.now} → queda <b>${i.target}</b>${i.short_by ? ` <span style="color:#f59e0b">(faltan ${i.short_by} para devolverlo completo)</span>` : ""}`).join("<br>");
    const r = await Swal.fire({
      icon: "warning", title: `↩️ Revertir ${what}`, width: "40rem",
      html: `<div style="text-align:left;font-size:13px;line-height:1.6">
        <p>Se hace un ajuste nuevo («Corrección de registro») que deja <b>${esc(a.warehouse)}</b> como estaba antes de ${what} del ${dmy(a.created_at)}.</p>
        <p style="margin-top:6px">Cada producto vuelve <b>restando lo que cambió el conteo</b>: si después se vendió o se trasladó algo, eso se respeta.</p>
        <p style="margin-top:6px"><b>${n0(p.changes)}</b> productos cambian: entran ${n0(p.units_in)} und. y salen ${n0(p.units_out)} und.${p.can_cost && p.value !== null ? ` · ${signedMoney(p.value)} al costo` : ""}</p>
        ${list ? `<p style="margin-top:6px">${list}${p.items.length > 10 ? `<br>… y ${n0(p.items.length - 10)} más` : ""}</p>` : ""}
        ${p.short ? `<p style="margin-top:6px;color:#f59e0b">⚠️ ${n0(p.short)} producto(s) no se pueden devolver completos porque ya no están esas unidades: quedan en 0 y se anota en el informe.</p>` : ""}
        <p style="margin-top:6px;opacity:.85">Si el punto tiene crédito con la bodega, su deuda también vuelve. El informe queda marcado como revertido y no se puede revertir dos veces.</p></div>`,
      input: "text", inputPlaceholder: "¿Por qué lo reviertes? (opcional, queda en el ajuste)",
      showCancelButton: true, confirmButtonText: "↩️ Sí, revertir", cancelButtonText: "No, dejarlo", confirmButtonColor: "#ef4444", ...swalTheme,
    });
    if (!r.isConfirmed) return;
    setReverting(true);
    const res = await supabaseBrowser().rpc("erp_count_audit_revert", { p_audit: a.id, p_note: String(r.value ?? "").trim() || null });
    setReverting(false);
    const out = res.data as { ok: boolean; message?: string; adjustment_id?: string | null; adjustment_number?: number | null; short?: number } | null;
    if (res.error || !out?.ok) return void toast("No se pudo revertir", "error", res.error?.message ?? out?.message);
    void toast(`↩️ Revertido${out.adjustment_number ? ` con el ajuste #${out.adjustment_number}` : ""}`, "success",
      out.short ? `${n0(out.short)} producto(s) no se pudieron devolver completos (quedan en 0).` : `${a.warehouse} quedó como estaba.`);
    if (out.adjustment_id) void debtAfterText(out.adjustment_id).then((t) => { if (t) void toast("🤝 Cuenta con la bodega", "success", t); });
    setVersion((v) => v + 1);
    onChanged?.();
  }

  function exportXlsx() {
    if (!d || !a) return;
    const cost = d.can_cost;
    downloadXlsx(`${start ? "inventario-inicial" : "auditoria"}-${a.warehouse}-${dmy(a.created_at).replace(/\//g, "-")}.xlsx`, [
      { name: "Resumen", head: ["Dato", "Valor"], rows: [
        ["Bodega", a.warehouse], ["Tipo", start ? "Inventario inicial (lo que no estaba en la lista quedó en 0)" : "Conteo normal"],
        ["Fecha", dateTime(a.created_at)], ["Hecha por", a.created_by_name ?? ""], ["Ajuste", a.adjustment_number ? `#${a.adjustment_number}` : "Sin ajuste (todo cuadró)"],
        ["Contados", a.counted], ["Cuadran", a.matched], ["Sobran (productos)", a.over], ["Sobran (unidades)", a.over_units],
        ["Faltan (productos)", a.short], ["Faltan (unidades)", a.short_units],
        ...(start
          ? [["Se sacaron (productos)", a.removed ?? 0], ["Se sacaron (unidades)", a.removed_units ?? 0]] as Array<[string, number]>
          : [["Sin contar (productos)", a.uncounted], ["Sin contar (unidades)", a.uncounted_units]] as Array<[string, number]>),
        ["Diferencia neta (unidades)", netUnits],
        ...(cost ? [["Valor sobrante", a.over_value], ["Valor faltante", a.short_value],
          start ? ["Valor de lo que se sacó", a.removed_value ?? 0] : ["Valor sin contar", a.uncounted_value],
          ["Diferencia neta (plata)", a.net_value ?? null]] as Array<[string, number | null]> : []),
        ...(a.reverted_at ? [["Revertido", `${dateTime(a.reverted_at)} · ${a.reverted_by_name ?? ""}${a.revert_adjustment_number ? ` · ajuste #${a.revert_adjustment_number}` : ""}${a.revert_note ? ` · ${a.revert_note}` : ""}`]] as Array<[string, string]> : []),
      ] },
      { name: "Diferencias", head: ["Producto", "Código", "Sistema", "Contado", "Diferencia", ...(cost ? ["Costo unitario", "Valor"] : [])],
        rows: d.diffs.map((x) => [x.name, x.sku, x.before, x.after, x.diff, ...(cost ? [x.unit_cost, (x.unit_cost ?? 0) * x.diff] : [])]) },
      start
        ? { name: "Se sacaron", head: ["Producto", "Código", "Tenía", "Quedó", ...(cost ? ["Costo unitario", "Valor"] : [])],
            rows: removedRows.map((u) => [u.name, u.sku, u.qty, 0, ...(cost ? [u.unit_cost, (u.unit_cost ?? 0) * u.qty] : [])]) }
        : { name: "Sin contar", head: ["Producto", "Código", "El sistema decía", "¿Sigue pendiente?", ...(cost ? ["Costo unitario", "Valor"] : [])],
            rows: d.uncounted.map((u) => [u.name, u.sku, u.qty, u.still_pending ? "Sí" : "Ya se contó", ...(cost ? [u.unit_cost, (u.unit_cost ?? 0) * u.qty] : [])]) },
    ]);
  }

  function print() {
    if (!d || !a) return;
    const w = window.open("", "_blank");
    if (!w) return void toast("El navegador bloqueó la ventana", "warning", "Permite ventanas emergentes para imprimir.");
    const cost = d.can_cost;
    const table = (head: string[], rows: string[][]) => `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${head.length}">Ninguno</td></tr>`}</tbody></table>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:12px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:14px;margin:18px 0 6px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f3f3f3}
      .k{display:inline-block;margin:6px 14px 0 0}</style></head><body>
      <h1>${esc(title)}</h1><div>${esc(dateTime(a.created_at))} · ${esc(a.created_by_name ?? "")}${a.adjustment_number ? ` · Ajuste #${a.adjustment_number}` : " · Todo cuadró (sin ajuste)"}</div>
      <div><span class="k">Contados: <b>${n0(a.counted)}</b></span><span class="k">Cuadran: <b>${n0(a.matched)}</b></span>
      <span class="k">Sobran: <b>${n0(a.over)}</b> (+${n0(a.over_units)} und.${cost ? ` · ${money(a.over_value ?? 0)}` : ""})</span>
      <span class="k">Faltan: <b>${n0(a.short)}</b> (−${n0(a.short_units)} und.${cost ? ` · ${money(a.short_value ?? 0)}` : ""})</span>
      ${start
        ? `<span class="k">Se sacaron (no estaban en la lista): <b>${n0(a.removed ?? 0)}</b> (−${n0(a.removed_units ?? 0)} und.${cost ? ` · ${money(a.removed_value ?? 0)}` : ""})</span>`
        : `<span class="k">Sin contar: <b>${n0(a.uncounted)}</b> (${n0(a.uncounted_units)} und.${cost ? ` · ${money(a.uncounted_value ?? 0)}` : ""})</span>`}
      <span class="k">Diferencia neta: <b>${signedUnits(netUnits)} und.${hasNet ? ` · ${signedMoney(a.net_value)}` : ""}</b></span></div>
      ${start ? `<p><b>Inventario inicial:</b> lo que no estaba en la lista quedó en 0.</p>` : ""}
      ${a.reverted_at ? `<p><b>Revertido</b> el ${esc(dateTime(a.reverted_at))} por ${esc(a.reverted_by_name ?? "")}${a.revert_adjustment_number ? ` · ajuste #${a.revert_adjustment_number}` : ""}${a.revert_note ? ` · ${esc(a.revert_note)}` : ""}</p>` : ""}
      <h2>Faltan</h2>${table(["Producto", "Código", "Sistema", "Contado", "Diferencia", ...(cost ? ["Valor"] : [])], shortRows.map((x) => [esc(x.name), esc(x.sku ?? ""), String(x.before), String(x.after), String(x.diff), ...(cost ? [signedMoney((x.unit_cost ?? 0) * x.diff)] : [])]))}
      <h2>Sobran</h2>${table(["Producto", "Código", "Sistema", "Contado", "Diferencia", ...(cost ? ["Valor"] : [])], overRows.map((x) => [esc(x.name), esc(x.sku ?? ""), String(x.before), String(x.after), `+${x.diff}`, ...(cost ? [signedMoney((x.unit_cost ?? 0) * x.diff)] : [])]))}
      ${start
        ? `<h2>Se sacaron (quedaron en 0)</h2>${table(["Producto", "Código", "Tenía", ...(cost ? ["Valor"] : [])], removedRows.map((u) => [esc(u.name), esc(u.sku ?? ""), String(u.qty), ...(cost ? [money((u.unit_cost ?? 0) * u.qty)] : [])]))}`
        : `<h2>Sin contar</h2>${table(["Producto", "Código", "El sistema decía", "Estado hoy"], d.uncounted.map((u) => [esc(u.name), esc(u.sku ?? ""), String(u.qty), u.still_pending ? "Pendiente" : "Ya se contó"]))}`}
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  const tile = (icon: string, label: string, value: string, sub: string, color: string) => (
    <div className="rounded-2xl border p-3" style={{ borderColor: `color-mix(in oklab, ${color} 35%, var(--t-card-border))` }}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{icon} {label}</p>
      <p className="text-xl font-black tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[11px] tabular-nums" style={{ color: "var(--t-muted)" }}>{sub}</p>
    </div>
  );

  return (
        <Sheet wide icon={start ? "🚩" : "🔎"} title={title} onClose={onClose}
          subtitle={a ? `${dateTime(a.created_at)} · ${a.created_by_name ?? "—"}${a.adjustment_number ? ` · Ajuste #${a.adjustment_number}` : " · Todo cuadró (sin ajuste)"}${a.notes ? ` · ${a.notes}` : ""}` : "Cargando…"}
          footer={d ? (<>
            <Btn variant="ghost" onClick={exportXlsx}>📊 Excel</Btn><Btn variant="ghost" onClick={print}>🖨️ Imprimir</Btn>
            {d.can_revert ? <Btn variant="danger" onClick={() => void revert()} disabled={reverting}>{reverting ? "Revirtiendo…" : "↩️ Revertir"}</Btn> : null}
            <span className="flex-1" /><Btn onClick={onClose}>Listo</Btn>
          </>) : null}>
          {!d || !a ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando el informe…</p> : (
            <>
              {a.reverted_at ? (
                <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))", background: "color-mix(in oklab, #f59e0b 8%, transparent)" }}>
                  <b>↩️ Revertido</b> el {dateTime(a.reverted_at)} por {a.reverted_by_name ?? "—"}
                  {a.revert_adjustment_number ? ` · ajuste #${a.revert_adjustment_number}` : ""}{a.revert_note ? ` · ${a.revert_note}` : ""}.
                  <span className="block text-xs" style={{ color: "var(--t-muted)" }}>
                    {a.warehouse} volvió a como estaba antes{a.revert_short?.length ? `, menos ${n0(a.revert_short.length)} producto(s) que ya no estaban completos: ${a.revert_short.slice(0, 5).map((s) => `${s.name} (faltaron ${s.short_by})`).join(", ")}${a.revert_short.length > 5 ? "…" : ""}` : ""}.
                  </span>
                </div>
              ) : null}
              {start ? (
                <p className="rounded-2xl border p-3 text-xs" style={{ borderColor: "color-mix(in oklab, #ef4444 45%, var(--t-card-border))", background: "color-mix(in oklab, #ef4444 6%, transparent)" }}>
                  🚩 <b>Inventario inicial:</b> la lista fue todo lo que había en {a.warehouse}. Lo que no estaba en la lista ({n0(a.removed ?? 0)} productos, {n0(a.removed_units ?? 0)} und.) quedó en 0.
                </p>
              ) : null}
              <div className={`grid grid-cols-2 gap-2 ${hasNet ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
                {tile("✅", "Cuadran", n0(a.matched), `de ${n0(a.counted)} contados`, "#10b981")}
                {tile("➕", "Sobran", n0(a.over), `+${n0(a.over_units)} und.${d.can_cost ? ` · ${signedMoney(a.over_value)}` : ""}`, "#0ea5e9")}
                {tile("➖", "Faltan", n0(a.short), `−${n0(a.short_units)} und.${d.can_cost ? ` · ${signedMoney(-Number(a.short_value ?? 0))}` : ""}`, "#ef4444")}
                {start
                  ? tile("🧹", "Se sacaron", n0(a.removed ?? 0), `−${n0(a.removed_units ?? 0)} und.${d.can_cost ? ` · ${signedMoney(-Number(a.removed_value ?? 0))}` : ""}`, "#ef4444")
                  : tile("❓", "Sin contar", n0(a.uncounted), `${n0(a.uncounted_units)} und.${d.can_cost ? ` · ${money(a.uncounted_value ?? 0)}` : ""}`, "#f59e0b")}
                {hasNet ? tile("💰", "Diferencia neta", signedMoney(a.net_value), `${signedUnits(netUnits)} und. al costo`, Number(a.net_value) < 0 ? "#ef4444" : Number(a.net_value) > 0 ? "#10b981" : "var(--t-text)") : null}
              </div>
              {!start && a.uncounted ? (
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  ⏳ Hoy siguen pendientes por contar <b>{n0(stillPending)}</b> de los {n0(a.uncounted)} que quedaron sin contar.
                  {a.recent ? ` ${n0(a.recent)} no se pidieron porque se habían contado en los últimos 30 días.` : ""}
                </p>
              ) : null}
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {([["short", `➖ Faltan (${shortRows.length})`], ["over", `➕ Sobran (${overRows.length})`],
                  start ? ["removed", `🧹 Se sacaron (${removedRows.length})`] : ["uncounted", `❓ Sin contar (${d.uncounted.length})`]] as Array<[typeof tab, string]>).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setTab(k)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold"
                    style={tab === k ? { background: k === "removed" ? "#ef4444" : "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{label}</button>
                ))}
              </div>
              {tab === "removed" ? (
                <div className="space-y-1.5">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en lo que se sacó"
                    className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
                  {rem.slice(0, 300).map((u) => (
                    <div key={u.product_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "color-mix(in oklab, #ef4444 35%, var(--t-card-border))" }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-red-500">{u.name}</span>
                        <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{u.sku ? `${u.sku} · ` : ""}tenía {u.qty} → quedó en 0{u.qty < 0 ? " (estaba en negativo)" : ""}</span>
                      </span>
                      {d.can_cost && u.unit_cost !== null ? <span className="shrink-0 text-xs font-bold tabular-nums text-red-500">{signedMoney(-u.unit_cost * u.qty)}</span> : null}
                    </div>
                  ))}
                  {rem.length > 300 ? <p className="text-center text-xs" style={{ color: "var(--t-muted)" }}>Se muestran 300 de {n0(rem.length)}. Búscalo o bájalo en Excel.</p> : null}
                  {rem.length === 0 ? <p className="py-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>{removedRows.length ? "Nada con ese nombre." : "No se sacó nada: todo estaba en la lista 🎉"}</p> : null}
                </div>
              ) : tab !== "uncounted" ? (
                <div className="space-y-1.5">
                  {(tab === "short" ? shortRows : overRows).map((x) => (
                    <div key={x.product_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{x.name}</span>
                        <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{x.sku ? `${x.sku} · ` : ""}sistema {x.before} → contado {x.after}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block font-black tabular-nums ${x.diff < 0 ? "text-red-500" : "text-sky-500"}`}>{x.diff > 0 ? "+" : ""}{x.diff}</span>
                        {d.can_cost && x.unit_cost !== null ? <span className="block text-[11px] tabular-nums" style={{ color: "var(--t-muted)" }}>{signedMoney(x.unit_cost * x.diff)}</span> : null}
                      </span>
                    </div>
                  ))}
                  {(tab === "short" ? shortRows : overRows).length === 0 ? <p className="py-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>Ninguno 🎉</p> : null}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en lo que quedó sin contar"
                    className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
                  {unc.slice(0, 300).map((u) => (
                    <div key={u.product_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{u.name}</span>
                        <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{u.sku ? `${u.sku} · ` : ""}el sistema decía {u.qty}{d.can_cost && u.unit_cost !== null ? ` · ${money(u.unit_cost * u.qty)}` : ""}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${u.still_pending ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"}`}>
                        {u.still_pending ? "⏳ Pendiente" : "✅ Ya se contó"}
                      </span>
                    </div>
                  ))}
                  {unc.length > 300 ? <p className="text-center text-xs" style={{ color: "var(--t-muted)" }}>Se muestran 300 de {n0(unc.length)}. Búscalo o bájalo en Excel.</p> : null}
                  {unc.length === 0 ? <p className="py-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>{d.uncounted.length ? "Nada con ese nombre." : "No quedó nada sin contar 🎉"}</p> : null}
                </div>
              )}
            </>
          )}
        </Sheet>
  );
}

/** Historial de auditorías de conteo. */
export function AuditHistory({ storeId, refreshKey, onOpen }: { storeId: string; refreshKey: number; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [canCost, setCanCost] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_count_audits_list", { p_store: storeId, p_limit: 30 }).then(({ data, error }) => {
      if (!alive) return;
      if (error && MISSING_FN.test(error.message)) return setMissing(true);
      const r = data as { ok: boolean; items?: AuditRow[]; can_cost?: boolean } | null;
      setRows(r?.ok ? r.items ?? [] : []);
      setCanCost(Boolean(r?.can_cost));
    });
    return () => { alive = false; };
  }, [storeId, refreshKey]);
  if (missing || !rows || rows.length === 0) return null;
  return (
    <Panel title="🔎 Auditorías de conteo" subtitle="Cada conteo físico guarda lo que cuadró, lo que sobró, lo que faltó y lo que quedó sin contar (o lo que se sacó, en un inventario inicial), con su diferencia en plata.">
      <div className="space-y-2">
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => onOpen(r.id)} className={`glass-soft flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${r.reverted_at ? "opacity-70" : ""}`}
            style={{ borderColor: r.mode === "start" && !r.reverted_at ? "color-mix(in oklab, #ef4444 40%, var(--t-card-border))" : "var(--t-card-border)" }}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.mode === "start" ? "🚩 Inventario inicial · " : ""}{r.warehouse}{r.adjustment_number ? ` · Ajuste #${r.adjustment_number}` : " · todo cuadró"}</span>
              <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{dateTime(r.created_at)} · {r.created_by_name ?? "—"}</span>
            </span>
            <span className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              {r.reverted_at ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-500">↩️ Revertido {dmy(r.reverted_at)}</span> : null}
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-500">✅ {n0(r.matched)}</span>
              {r.over ? <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-500">➕ {n0(r.over)}</span> : null}
              {r.short ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-500">➖ {n0(r.short)}{canCost && r.short_value ? ` · ${money(r.short_value)}` : ""}</span> : null}
              {r.removed ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-500">🧹 {n0(r.removed)} sacados{canCost && r.removed_value ? ` · ${money(r.removed_value)}` : ""}</span> : null}
              {r.uncounted ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-500">❓ {n0(r.uncounted)} sin contar</span> : null}
              {canCost && r.net_value !== undefined && r.net_value !== null && Math.round(Number(r.net_value)) !== 0
                ? <span className={`rounded-full px-2 py-0.5 ${Number(r.net_value) < 0 ? "bg-red-500/15 text-red-500" : "bg-emerald-500/15 text-emerald-500"}`}>💰 {signedMoney(r.net_value)}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
