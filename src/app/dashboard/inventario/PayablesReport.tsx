"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField } from "@/components/forms/Fields";
import { downloadXlsx } from "@/lib/data/xlsx";
import { Chip, Field, Modal, Toggle } from "./dialog";
import { buildPayablesReport, ddmmyyyy, type ReportGroup, type ReportOptions } from "./payables-report";
import type { PayableRow } from "./payables-shared";
import { Btn, inputClass, inputStyle, money } from "./shared";

const NEXT = [7, 15, 30, 60, 90];
const GROUPS: Array<[ReportGroup, string]> = [["supplier", "Por proveedor"], ["date", "Por fecha"], ["point", "Por punto"], ["none", "Sin agrupar"]];
const KEY = "remhub:payables-report";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const when = (d: number | null) => (d === null ? "" : d < 0 ? `vencida hace ${-d} d` : d === 0 ? "hoy" : `en ${d} d`);

function initial(): ReportOptions {
  const base: ReportOptions = { range: { kind: "next", days: 15 }, overdue: true, supplierId: "", point: "", group: "supplier" };
  try {
    // Se recuerda el último informe en este equipo.
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ReportOptions> | null;
    return saved ? { ...base, ...saved } : base;
  } catch {
    return base;
  }
}

/** Informe a la medida: lo que vence en los próximos N días (o entre dos fechas), con o sin lo vencido. */
export function PayablesReport({ rows, today, storeId, suppliers, supplierName, onClose }: {
  rows: PayableRow[]; today: string; storeId: string; suppliers: Array<{ id: string; name: string }>;
  supplierName: (r: PayableRow) => string; onClose: () => void;
}) {
  const [o, setO] = useState<ReportOptions>(initial);
  const [storeName, setStoreName] = useState("");
  useEffect(() => {
    void supabaseBrowser().from("stores").select("name").eq("id", storeId).maybeSingle().then(({ data }) => setStoreName((data as { name: string } | null)?.name ?? ""));
  }, [storeId]);
  const patch = (c: Partial<ReportOptions>) => setO((cur) => {
    const next = { ...cur, ...c };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
    return next;
  });
  const r = useMemo(() => buildPayablesReport(rows, o, today, supplierName), [rows, o, today, supplierName]);
  const points = useMemo(() => [...new Set(rows.map((x) => x.warehouse_name).filter(Boolean) as string[])].sort(), [rows]);
  const withSuppliers = useMemo(() => suppliers.filter((s) => rows.some((x) => x.supplier_id === s.id && x.status === "open")), [suppliers, rows]);
  const title = `Cuentas por pagar · ${o.overdue ? "vencidas y " : ""}del ${ddmmyyyy(r.from)} al ${ddmmyyyy(r.to)}`;

  function print() {
    const body = r.sections.map((s) => `
      ${o.group !== "none" ? `<tr class="g"><td colspan="5">${esc(s.title)}</td><td class="n">${money(s.balance)}</td></tr>` : ""}
      ${s.rows.map((x) => `<tr${x.days !== null && x.days < 0 ? ' class="late"' : ""}><td>${ddmmyyyy(x.due)}<small> ${when(x.days)}</small></td><td>${esc(x.supplier)}</td><td>${esc(x.invoice ?? "")}</td><td>${x.purchase ?? ""}</td><td>${esc(x.point)}</td><td class="n">${money(x.balance)}</td></tr>`).join("")}`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:12px system-ui,sans-serif;color:#111;margin:24px} h1{font-size:16px;margin:0} p{margin:4px 0 12px;color:#555}
      table{width:100%;border-collapse:collapse} th,td{padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:left} th{background:#f3f4f6}
      .n{text-align:right;white-space:nowrap} .g td{background:#f9fafb;font-weight:800;border-top:2px solid #111} .late td{color:#b91c1c} small{color:#6b7280}
      tfoot td{font-weight:900;font-size:13px;border-top:2px solid #111} @page{margin:12mm}</style></head><body>
      <h1>${esc(storeName)} · ${esc(title)}</h1>
      <p>${r.rows.length} cuenta(s) · Total ${money(r.total)}${r.overdue ? ` · Vencido ${money(r.overdue)}` : ""} · Generado ${ddmmyyyy(today)}</p>
      <table><thead><tr><th>Vence</th><th>Proveedor</th><th>Factura</th><th>Ingreso</th><th>Punto</th><th class="n">Saldo</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><td colspan="5">Total</td><td class="n">${money(r.total)}</td></tr></tfoot></table>
      <script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }

  function excel() {
    downloadXlsx(`cuentas-por-pagar-${r.from}-a-${r.to}.xlsx`, [{
      name: "Por pagar",
      head: ["Vence", "Días", "Proveedor", "Factura", "Ingreso", "Punto", "Total", "Saldo"],
      rows: r.rows.map((x) => [ddmmyyyy(x.due), x.days, x.supplier, x.invoice, x.purchase, x.point, x.total, x.balance]),
      widths: [12, 8, 32, 16, 10, 20, 14, 14],
    }]);
  }

  function whatsapp() {
    const lines = r.sections.flatMap((s) => [
      ...(o.group !== "none" ? [`*${s.title}* · ${money(s.balance)}`] : []),
      ...s.rows.map((x) => `• ${ddmmyyyy(x.due)} ${o.group === "supplier" ? "" : `${x.supplier} `}${x.invoice ? `FV ${x.invoice} ` : ""}${money(x.balance)}${x.days !== null && x.days < 0 ? " ⚠️ vencida" : ""}`),
    ]);
    const text = `📋 ${storeName}\n${title}\n\n${lines.join("\n")}\n\n*Total: ${money(r.total)}*${r.overdue ? `\nVencido: ${money(r.overdue)}` : ""}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text.slice(0, 3500))}`, "_blank");
  }

  return (
    <Modal wide title="📋 Informe de cuentas por pagar" subtitle="Elige el rango y cómo agruparlo. Se imprime, se baja a Excel o se manda por WhatsApp." onClose={onClose}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
        <Btn variant="ghost" disabled={!r.rows.length} onClick={whatsapp}>💬 WhatsApp</Btn>
        <Btn variant="ghost" disabled={!r.rows.length} onClick={excel}>📊 Excel</Btn>
        <Btn disabled={!r.rows.length} onClick={print}>🖨️ Imprimir / PDF</Btn>
      </>}>
      <Field label="¿Qué vence?">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {NEXT.map((d) => <Chip key={d} on={o.range.kind === "next" && o.range.days === d} onClick={() => patch({ range: { kind: "next", days: d } })}>Próximos {d} días</Chip>)}
          <Chip on={o.range.kind === "dates"} onClick={() => patch({ range: { kind: "dates", from: r.from, to: r.to } })}>Entre fechas</Chip>
        </div>
        {o.range.kind === "dates" ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <DateField value={o.range.from} onChange={(v) => patch({ range: { kind: "dates", from: v, to: o.range.kind === "dates" ? o.range.to : v } })} ariaLabel="Desde" />
            <DateField value={o.range.to} min={o.range.from} onChange={(v) => patch({ range: { kind: "dates", from: o.range.kind === "dates" ? o.range.from : v, to: v } })} ariaLabel="Hasta" />
          </div>
        ) : null}
      </Field>
      <Toggle label="Incluir también lo que ya está vencido" on={o.overdue} onChange={(v) => patch({ overdue: v })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Proveedor">
          <select className={inputClass} style={inputStyle} value={o.supplierId} onChange={(e) => patch({ supplierId: e.target.value })}>
            <option value="">Todos</option>
            {withSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Punto o bodega">
          <select className={inputClass} style={inputStyle} value={o.point} onChange={(e) => patch({ point: e.target.value })}>
            <option value="">Todos</option>
            {points.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Agrupar">
          <select className={inputClass} style={inputStyle} value={o.group} onChange={(e) => patch({ group: e.target.value as ReportGroup })}>
            {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>

      <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
        <p className="mb-2 font-bold">{r.rows.length} cuenta(s) · Total {money(r.total)}{r.overdue ? <span style={{ color: "#ef4444" }}> · Vencido {money(r.overdue)}</span> : null}</p>
        {!r.rows.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>No hay cuentas en ese rango.</p> : (
          <div className="max-h-72 space-y-2 overflow-auto text-xs">
            {r.sections.map((s) => (
              <div key={s.title || "all"}>
                {o.group !== "none" ? <p className="flex justify-between font-bold"><span>{s.title}</span><span>{money(s.balance)}</span></p> : null}
                {s.rows.map((x, i) => (
                  <p key={i} className="flex justify-between gap-2 pl-2" style={{ color: x.days !== null && x.days < 0 ? "#ef4444" : "var(--t-muted)" }}>
                    <span className="truncate">{ddmmyyyy(x.due)} ({when(x.days)}) · {x.supplier}{x.invoice ? ` · FV ${x.invoice}` : ""} · {x.point}</span>
                    <b>{money(x.balance)}</b>
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
