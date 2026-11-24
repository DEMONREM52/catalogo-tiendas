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

/** Lo que el sistema dice que hay en la bodega (20261340). */
export type StockItem = {
  product_id: string; name: string; sku: string | null; barcode: string | null; image_url: string | null; qty: number;
  pending_since: string | null; last_counted_at: string | null; recent: boolean;
};

export type AuditRow = {
  id: string; warehouse_id: string; warehouse: string; adjustment_id: string | null; adjustment_number: number | null;
  created_at: string; created_by_name: string | null; notes: string | null;
  counted: number; matched: number; over: number; over_units: number; short: number; short_units: number;
  uncounted: number; uncounted_units: number; recent: number;
  over_value: number | null; short_value: number | null; uncounted_value: number | null;
};
type AuditDetail = {
  audit: AuditRow;
  diffs: Array<{ product_id: string; name: string; sku: string | null; before: number; after: number; diff: number; unit_cost: number | null }>;
  uncounted: Array<{ product_id: string; name: string; sku: string | null; qty: number; unit_cost: number | null; still_pending: boolean }>;
  can_cost: boolean;
};

const MISSING_FN = /Could not find the function|schema cache|does not exist/i;
export const AUDIT_MIGRATION = "Falta correr en Supabase la migración 20261340_auditoria_conteo.sql.";
const pad = (n: number) => String(n).padStart(2, "0");
const dmy = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const n0 = (n: number) => n.toLocaleString("es-CO");
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
export function AuditProgress({ items, lines, warehouseName, error, onAdd, onReload }: {
  items: StockItem[] | null; lines: Line[]; warehouseName: string; error: string;
  onAdd: (item: StockItem, qty: number) => void; onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const { missing, recent, units, pending } = useMemo(() => splitMissing(items, lines), [items, lines]);

  if (error) return <p className="mt-3 text-xs text-amber-500">⚠️ {error} <button type="button" className="underline" onClick={onReload}>Reintentar</button></p>;
  if (!items) return <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>Revisando lo que hay en {warehouseName}…</p>;

  const total = lines.length + missing.length;
  const pct = total ? Math.round((lines.length / total) * 100) : 100;
  const source = showRecent ? [...missing, ...recent] : missing;
  const term = q.trim().toLowerCase();
  const shown = term ? source.filter((i) => `${i.name} ${i.sku ?? ""} ${i.barcode ?? ""}`.toLowerCase().includes(term)) : source;

  async function count(item: StockItem) {
    const r = await Swal.fire({
      title: "¿Cuántos contaste?", html: `<b>${esc(item.name)}</b><br><small>El sistema dice ${item.qty}.</small>`,
      input: "number", inputAttributes: { min: "0", step: "1", inputmode: "numeric" }, inputPlaceholder: "Lo que contaste",
      showCancelButton: true, confirmButtonText: "Agregar al conteo", cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
      inputValidator: (v) => (v === "" || !Number.isInteger(Number(v)) || Number(v) < 0 ? "Escribe un número entero (0 o más)" : null),
    });
    if (r.isConfirmed) onAdd(item, Number(r.value));
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
export function AuditReport({ auditId, onClose }: { auditId: string | null; onClose: () => void }) {
  return <AnimatePresence>{auditId ? <AuditReportSheet key={auditId} auditId={auditId} onClose={onClose} /> : null}</AnimatePresence>;
}

function AuditReportSheet({ auditId, onClose }: { auditId: string; onClose: () => void }) {
  const [d, setD] = useState<AuditDetail | null>(null);
  const [tab, setTab] = useState<"short" | "over" | "uncounted">("short");
  const [q, setQ] = useState("");
  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_count_audit_get", { p_audit: auditId }).then(({ data, error }) => {
      if (!alive) return;
      const r = data as ({ ok: boolean; message?: string } & AuditDetail) | null;
      if (error || !r?.ok) { void toast("No se pudo abrir la auditoría", "error", error && MISSING_FN.test(error.message) ? AUDIT_MIGRATION : error?.message ?? r?.message); onClose(); return; }
      setD(r);
      setTab(r.audit.short ? "short" : r.audit.over ? "over" : "uncounted");
    });
    return () => { alive = false; };
  }, [auditId, onClose]);

  const a = d?.audit;
  const shortRows = d?.diffs.filter((x) => x.diff < 0) ?? [];
  const overRows = d?.diffs.filter((x) => x.diff > 0) ?? [];
  const term = q.trim().toLowerCase();
  const unc = (d?.uncounted ?? []).filter((u) => !term || `${u.name} ${u.sku ?? ""}`.toLowerCase().includes(term));
  const stillPending = d?.uncounted.filter((u) => u.still_pending).length ?? 0;
  const title = a ? `Auditoría · ${a.warehouse}` : "Auditoría";

  function exportXlsx() {
    if (!d || !a) return;
    const cost = d.can_cost;
    downloadXlsx(`auditoria-${a.warehouse}-${dmy(a.created_at).replace(/\//g, "-")}.xlsx`, [
      { name: "Resumen", head: ["Dato", "Valor"], rows: [
        ["Bodega", a.warehouse], ["Fecha", dateTime(a.created_at)], ["Hecha por", a.created_by_name ?? ""], ["Ajuste", a.adjustment_number ? `#${a.adjustment_number}` : "Sin ajuste (todo cuadró)"],
        ["Contados", a.counted], ["Cuadran", a.matched], ["Sobran (productos)", a.over], ["Sobran (unidades)", a.over_units],
        ["Faltan (productos)", a.short], ["Faltan (unidades)", a.short_units], ["Sin contar (productos)", a.uncounted], ["Sin contar (unidades)", a.uncounted_units],
        ...(cost ? [["Valor sobrante", a.over_value], ["Valor faltante", a.short_value], ["Valor sin contar", a.uncounted_value]] as Array<[string, number | null]> : []),
      ] },
      { name: "Diferencias", head: ["Producto", "Código", "Sistema", "Contado", "Diferencia", ...(cost ? ["Costo unitario", "Valor"] : [])],
        rows: d.diffs.map((x) => [x.name, x.sku, x.before, x.after, x.diff, ...(cost ? [x.unit_cost, (x.unit_cost ?? 0) * x.diff] : [])]) },
      { name: "Sin contar", head: ["Producto", "Código", "El sistema decía", "¿Sigue pendiente?", ...(cost ? ["Costo unitario", "Valor"] : [])],
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
      <span class="k">Sin contar: <b>${n0(a.uncounted)}</b> (${n0(a.uncounted_units)} und.${cost ? ` · ${money(a.uncounted_value ?? 0)}` : ""})</span></div>
      <h2>Faltan</h2>${table(["Producto", "Código", "Sistema", "Contado", "Diferencia"], shortRows.map((x) => [esc(x.name), esc(x.sku ?? ""), String(x.before), String(x.after), String(x.diff)]))}
      <h2>Sobran</h2>${table(["Producto", "Código", "Sistema", "Contado", "Diferencia"], overRows.map((x) => [esc(x.name), esc(x.sku ?? ""), String(x.before), String(x.after), `+${x.diff}`]))}
      <h2>Sin contar</h2>${table(["Producto", "Código", "El sistema decía", "Estado hoy"], d.uncounted.map((u) => [esc(u.name), esc(u.sku ?? ""), String(u.qty), u.still_pending ? "Pendiente" : "Ya se contó"]))}
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
        <Sheet wide icon="🔎" title={title} onClose={onClose}
          subtitle={a ? `${dateTime(a.created_at)} · ${a.created_by_name ?? "—"}${a.adjustment_number ? ` · Ajuste #${a.adjustment_number}` : " · Todo cuadró (sin ajuste)"}${a.notes ? ` · ${a.notes}` : ""}` : "Cargando…"}
          footer={d ? (<><Btn variant="ghost" onClick={exportXlsx}>📊 Excel</Btn><Btn variant="ghost" onClick={print}>🖨️ Imprimir</Btn><span className="flex-1" /><Btn onClick={onClose}>Listo</Btn></>) : null}>
          {!d || !a ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando el informe…</p> : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {tile("✅", "Cuadran", n0(a.matched), `de ${n0(a.counted)} contados`, "#10b981")}
                {tile("➕", "Sobran", n0(a.over), `+${n0(a.over_units)} und.${d.can_cost ? ` · ${money(a.over_value ?? 0)}` : ""}`, "#0ea5e9")}
                {tile("➖", "Faltan", n0(a.short), `−${n0(a.short_units)} und.${d.can_cost ? ` · ${money(a.short_value ?? 0)}` : ""}`, "#ef4444")}
                {tile("❓", "Sin contar", n0(a.uncounted), `${n0(a.uncounted_units)} und.${d.can_cost ? ` · ${money(a.uncounted_value ?? 0)}` : ""}`, "#f59e0b")}
              </div>
              {a.uncounted ? (
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  ⏳ Hoy siguen pendientes por contar <b>{n0(stillPending)}</b> de los {n0(a.uncounted)} que quedaron sin contar.
                  {a.recent ? ` ${n0(a.recent)} no se pidieron porque se habían contado en los últimos 30 días.` : ""}
                </p>
              ) : null}
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {([["short", `➖ Faltan (${shortRows.length})`], ["over", `➕ Sobran (${overRows.length})`], ["uncounted", `❓ Sin contar (${d.uncounted.length})`]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setTab(k)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold"
                    style={tab === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{label}</button>
                ))}
              </div>
              {tab !== "uncounted" ? (
                <div className="space-y-1.5">
                  {(tab === "short" ? shortRows : overRows).map((x) => (
                    <div key={x.product_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{x.name}</span>
                        <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{x.sku ? `${x.sku} · ` : ""}sistema {x.before} → contado {x.after}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block font-black tabular-nums ${x.diff < 0 ? "text-red-500" : "text-sky-500"}`}>{x.diff > 0 ? "+" : ""}{x.diff}</span>
                        {d.can_cost && x.unit_cost !== null ? <span className="block text-[11px] tabular-nums" style={{ color: "var(--t-muted)" }}>{money(x.unit_cost * x.diff)}</span> : null}
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
    <Panel title="🔎 Auditorías de conteo" subtitle="Cada conteo físico guarda lo que cuadró, lo que sobró, lo que faltó y lo que quedó sin contar.">
      <div className="space-y-2">
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="glass-soft flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.warehouse}{r.adjustment_number ? ` · Ajuste #${r.adjustment_number}` : " · todo cuadró"}</span>
              <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{dateTime(r.created_at)} · {r.created_by_name ?? "—"}</span>
            </span>
            <span className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-500">✅ {n0(r.matched)}</span>
              {r.over ? <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-500">➕ {n0(r.over)}</span> : null}
              {r.short ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-500">➖ {n0(r.short)}{canCost && r.short_value ? ` · ${money(r.short_value)}` : ""}</span> : null}
              {r.uncounted ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-500">❓ {n0(r.uncounted)} sin contar</span> : null}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
