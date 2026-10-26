"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { logExport } from "@/lib/permission-runtime";
import { DateField } from "@/components/forms/Fields";
import { downloadXlsx, type XSheet } from "@/lib/data/xlsx";
import {
  ACCOUNT_LABELS, DOC_LABELS, METHOD_LABELS, mergeConfig,
  type Accounts, type AccountingConfig, type Column, type CustomFormat, type DocKind, type Field, type FormatSpec, type PayKey,
} from "@/lib/accounting/config";
import { buildJournal, trialBalance, type Issue, type JLine } from "@/lib/accounting/journal";
import { BUILTIN_FORMATS, FIELD_LABELS, allFormats, cloneFormat, formatRows, formatText, nitDv } from "@/lib/accounting/formats";
import { loadLookups, loadPeriod, type Lookups } from "./load";

/**
 * Para el contador: RemHub no lleva la contabilidad; arma los asientos del periodo y los entrega en el formato
 * del programa del contador (o en uno propio). El contador configura cuentas y códigos una sola vez.
 */

const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const input = "w-full rounded-xl border px-3 py-2 text-sm outline-none";
const inputStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const money = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const KINDS = Object.keys(DOC_LABELS) as DocKind[];
const FIELDS = Object.keys(FIELD_LABELS) as Field[];

type Result = { lines: JLine[]; issues: Issue[]; skipped: Array<{ kind: DocKind; reason: string }>; costHidden: boolean; from: string; to: string };

function monthRange(offset: number) {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const b = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: iso(a), to: iso(b > now ? now : b) };
}

export default function AccountantPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [denied, setDenied] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AccountingConfig>(() => mergeConfig(null));
  const [savedInfo, setSavedInfo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lookups, setLookups] = useState<Lookups>({ points: [], categories: [] });
  const [range, setRange] = useState(() => monthRange(-1));
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [panel, setPanel] = useState<"accounts" | "format" | null>(null);

  useEffect(() => {
    void (async () => {
      const a = await getDashboardStore().catch(() => null);
      if (!a?.store) return setDenied("No tienes una tienda abierta.");
      if (!hasStorePermission(a, "exports")) return setDenied("Necesitas el permiso «Exportar datos» para preparar la información del contador.");
      setStoreId(a.store.id);
      setStoreName(a.store.name ?? "");
      const [{ data, error }, lk] = await Promise.all([
        supabaseBrowser().rpc("erp_accounting_settings_get", { p_store: a.store.id }),
        loadLookups(a.store.id),
      ]);
      setLookups(lk);
      const r = data as { ok: boolean; config?: Partial<AccountingConfig>; updated_at?: string; updated_by_name?: string; message?: string } | null;
      if (error) setSavedInfo(/Could not find the function|schema cache/i.test(error.message) ? "⚠️ Falta ejecutar la migración 20261248 en Supabase: la configuración no se podrá guardar." : error.message);
      else if (r?.ok) {
        setCfg(mergeConfig(r.config));
        if (r.updated_at) setSavedInfo(`Configuración guardada el ${new Date(r.updated_at).toLocaleDateString("es-CO")}${r.updated_by_name ? ` por ${r.updated_by_name}` : ""}.`);
      }
    })();
  }, []);

  const formats = useMemo(() => allFormats(cfg.customFormats), [cfg.customFormats]);
  const format = formats.find((f) => f.id === cfg.format) ?? BUILTIN_FORMATS[0];
  const patch = (c: Partial<AccountingConfig>) => { setCfg((cur) => ({ ...cur, ...c })); setDirty(true); setResult(null); };

  async function save() {
    if (!storeId) return;
    setBusy("save");
    const { data, error } = await supabaseBrowser().rpc("erp_accounting_settings_save", { p_store: storeId, p_config: cfg });
    setBusy(null);
    const r = data as { ok: boolean; message?: string } | null;
    if (error || !r?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: error?.message ?? r?.message });
    setDirty(false);
    setSavedInfo(`Configuración guardada hoy.`);
    void Swal.fire({ ...swal, icon: "success", title: "Guardado", text: "La próxima vez sale igual, para cualquiera de tu equipo.", timer: 1600, showConfirmButton: false });
  }

  async function prepare() {
    if (!storeId) return;
    if (range.from > range.to) return void Swal.fire({ ...swal, icon: "warning", title: "Revisa las fechas", text: "La fecha inicial es después de la final." });
    setBusy("Preparando…");
    try {
      const loaded = await loadPeriod(storeId, range.from, range.to, cfg.include, (t) => setBusy(t));
      const { lines, issues } = buildJournal(loaded.sources, cfg);
      setResult({ lines, issues, skipped: loaded.skipped, costHidden: loaded.costHidden, from: range.from, to: range.to });
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo preparar", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  function download() {
    if (!result) return;
    const base = `contabilidad-${format.id}-${result.from}-a-${result.to}`;
    const thirds = new Map<string, { name: string; kinds: Set<string> }>();
    for (const l of result.lines) {
      if (!l.thirdId) continue;
      const t = thirds.get(l.thirdId) ?? { name: l.thirdName, kinds: new Set<string>() };
      if (!t.name && l.thirdName) t.name = l.thirdName;
      t.kinds.add(l.kind === "purchase" || l.kind === "payment" ? "Proveedor" : l.kind === "sale" || l.kind === "receipt" ? "Cliente" : "Otro");
      thirds.set(l.thirdId, t);
    }
    const extra: XSheet[] = [
      { name: "Terceros", head: ["Identificación", "DV", "Nombre", "Tipo"], rows: [...thirds].map(([id, t]) => [id, id.length >= 9 ? nitDv(id) : "", t.name, [...t.kinds].join(", ")]), widths: [16, 5, 40, 20] },
      { name: "Balance de prueba", head: ["Cuenta", "Débitos", "Créditos", "Saldo"], rows: trialBalance(result.lines).map((x) => [x.account, x.debit, x.credit, Math.round((x.debit - x.credit) * 100) / 100]), widths: [14, 16, 16, 16] },
      ...(result.issues.length ? [{ name: "Revisar", head: ["Tipo", "Documento", "Qué pasa"], rows: result.issues.map((i) => [DOC_LABELS[i.kind], i.docNumber, i.message]), widths: [24, 16, 60] }] : []),
    ];
    if (format.file === "xlsx") {
      downloadXlsx(`${base}.xlsx`, [{ name: "Movimiento", head: format.columns.map((c) => c.header), rows: formatRows(result.lines, format) }, ...extra]);
    } else {
      const text = formatText(result.lines, format);
      const blob = new Blob([format.file === "csv" ? "﻿" + text : text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.${format.file}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      // Terceros y balance de prueba siempre en Excel (el archivo plano solo lleva el movimiento).
      downloadXlsx(`${base}-terceros-y-balance.xlsx`, extra);
    }
    logExport(`contabilidad.${format.id}`, result.lines.length, { desde: result.from, hasta: result.to });
  }

  if (denied) return <p className="rounded-2xl border p-5 text-sm" style={card}>🔒 {denied}</p>;
  if (!storeId) return <p className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>;

  const totals = result ? result.lines.reduce((s, l) => ({ d: s.d + l.debit, c: s.c + l.credit }), { d: 0, c: 0 }) : null;
  const docCount = (k: DocKind) => (result ? new Set(result.lines.filter((l) => l.kind === k).map((l) => l.docNumber)).size : 0);

  return (
    <main className="space-y-4">
      <section className="rounded-3xl border p-5" style={card}>
        <h1 className="text-xl font-black">🧮 Para el contador</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
          RemHub no reemplaza a tu contador: le entrega el mes listo. Ventas, compras, abonos, pagos, gastos y nómina salen como asientos contables
          (débito y crédito con cuentas del PUC) en el formato de su programa, para que los importe en minutos en vez de digitarlos.
        </p>
        {savedInfo ? <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>{savedInfo}</p> : null}
      </section>

      {/* 1. Programa */}
      <section className="rounded-3xl border p-5" style={card}>
        <h2 className="font-black">1. ¿Qué programa usa tu contador?</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {formats.map((f) => (
            <button key={f.id} type="button" onClick={() => patch({ format: f.id })} className="rounded-2xl border p-3 text-left text-sm"
              style={{ borderColor: f.id === format.id ? "var(--t-accent)" : "var(--t-card-border)", background: f.id === format.id ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : undefined }}>
              <b className="block">{"custom" in f ? "🛠️ " : ""}{f.name}</b>
              <span className="text-xs" style={{ color: "var(--t-muted)" }}>{f.program} · {f.file.toUpperCase()}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>💡 {format.note}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => setPanel(panel === "format" ? null : "format")}>
            {"custom" in format ? "✏️ Editar este formato" : "🛠️ Crear un formato propio a partir de este"}
          </button>
        </div>
        {panel === "format" ? <FormatEditor key={format.id} format={format} onChange={(f) => {
          const exists = cfg.customFormats.some((x) => x.id === f.id);
          patch({ customFormats: exists ? cfg.customFormats.map((x) => (x.id === f.id ? f : x)) : [...cfg.customFormats, f], format: f.id });
        }} onDelete={(id) => patch({ customFormats: cfg.customFormats.filter((x) => x.id !== id), format: "generico" })} /> : null}
      </section>

      {/* 2. Qué incluir */}
      <section className="rounded-3xl border p-5" style={card}>
        <h2 className="font-black">2. ¿Qué incluir?</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.include[k]} onChange={(e) => patch({ include: { ...cfg.include, [k]: e.target.checked } })} /> {DOC_LABELS[k]}
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-bold">IVA
            <select className={`${input} mt-1`} style={inputStyle} value={cfg.vatMode} onChange={(e) => patch({ vatMode: e.target.value as AccountingConfig["vatMode"] })}>
              <option value="products">Responsable de IVA (según la tarifa de cada producto)</option>
              <option value="none">No responsable de IVA</option>
            </select>
          </label>
          <label className="text-xs font-bold">Numeración de los comprobantes
            <select className={`${input} mt-1`} style={inputStyle} value={cfg.numbering} onChange={(e) => patch({ numbering: e.target.value as AccountingConfig["numbering"] })}>
              <option value="remhub">El número de RemHub (REM-15, compra 7…)</option>
              <option value="sequence">Consecutivo numérico (lo piden Siigo y World Office)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-5 text-sm">
            <input type="checkbox" checked={cfg.includeCost} onChange={(e) => patch({ includeCost: e.target.checked })} /> Costo de ventas (inventario permanente)
          </label>
        </div>
        <button type="button" className="mt-4 rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => setPanel(panel === "accounts" ? null : "accounts")}>
          ⚙️ Cuentas, centros de costo y códigos {panel === "accounts" ? "▲" : "▼"}
        </button>
        {panel === "accounts" ? <AccountsEditor cfg={cfg} lookups={lookups} patch={patch} /> : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy === "save"} onClick={() => void save()} className="rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-accent)" }}>
            💾 Guardar configuración
          </button>
          {dirty ? <span className="text-xs" style={{ color: "#f59e0b" }}>Tienes cambios sin guardar.</span> : null}
        </div>
      </section>

      {/* 3. Periodo y descarga */}
      <section className="rounded-3xl border p-5" style={card}>
        <h2 className="font-black">3. Periodo</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[[-1, "Mes pasado"], [0, "Este mes"], [-2, "Hace dos meses"]].map(([o, l]) => (
            <button key={l} type="button" className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => { setRange(monthRange(Number(o))); setResult(null); }}>{l}</button>
          ))}
          <DateField value={range.from} onChange={(v) => { setRange((r) => ({ ...r, from: v })); setResult(null); }} ariaLabel="Desde" className="w-40" />
          <DateField value={range.to} min={range.from} onChange={(v) => { setRange((r) => ({ ...r, to: v })); setResult(null); }} ariaLabel="Hasta" className="w-40" />
          <button type="button" disabled={Boolean(busy)} onClick={() => void prepare()} className="rounded-full px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ background: "var(--t-cta)", color: "#0b0b0b" }}>
            {busy && busy !== "save" ? busy : "Preparar"}
          </button>
        </div>

        {result && totals ? (
          <div className="mt-4 space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {KINDS.filter((k) => cfg.include[k]).map((k) => (
                <div key={k} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                  <b className="block text-lg">{docCount(k)}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{DOC_LABELS[k]}</span>
                </div>
              ))}
            </div>
            <p>
              {result.lines.length.toLocaleString("es-CO")} renglones · Débitos <b>{money(totals.d)}</b> · Créditos <b>{money(totals.c)}</b>{" "}
              {Math.abs(totals.d - totals.c) < 0.01 ? <span style={{ color: "#22c55e" }}>✓ cuadra</span> : <span style={{ color: "#ef4444" }}>⚠️ no cuadra</span>}
            </p>
            {result.skipped.map((s) => <p key={s.kind} className="text-xs" style={{ color: "#f59e0b" }}>⚠️ {DOC_LABELS[s.kind]}: no se pudo leer ({s.reason}). Quedó por fuera.</p>)}
            {result.costHidden && cfg.includeCost ? <p className="text-xs" style={{ color: "#f59e0b" }}>⚠️ No tienes permiso de ver costos: el costo de ventas no se pudo calcular.</p> : null}
            {result.issues.length ? (
              <details className="rounded-2xl border p-3 text-xs" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)" }}>
                <summary className="cursor-pointer font-bold">Para revisar: {result.issues.length} (van en la hoja «Revisar»)</summary>
                {result.issues.slice(0, 50).map((i, n) => <p key={n}>{DOC_LABELS[i.kind]} {i.docNumber}: {i.message}</p>)}
              </details>
            ) : null}
            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
              <table className="w-full min-w-[720px] text-xs">
                <thead><tr>{format.columns.map((c, i) => <th key={i} className="px-2 py-1.5 text-left font-semibold" style={{ color: "var(--t-muted)" }}>{c.header}</th>)}</tr></thead>
                <tbody>
                  {formatRows(result.lines.slice(0, 15), format).map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>{r.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{typeof v === "number" ? v.toLocaleString("es-CO") : v}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={!result.lines.length} onClick={download} className="rounded-full px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#16a34a" }}>
                ⬇️ Descargar para {format.name}
              </button>
              <span className="text-xs" style={{ color: "var(--t-muted)" }}>Incluye las hojas de terceros (para crearlos antes en el programa) y el balance de prueba del periodo.</span>
            </div>
          </div>
        ) : null}
      </section>

      <p className="px-1 text-xs" style={{ color: "var(--t-muted)" }}>
        {storeName ? `${storeName} · ` : ""}Las plantillas de cada programa cambian con sus versiones: la primera vez, que tu contador haga la importación de prueba con un mes corto.
        Si su programa pide otro orden o columnas, crea un formato propio y queda guardado.
      </p>
    </main>
  );
}

function AccountsEditor({ cfg, lookups, patch }: { cfg: AccountingConfig; lookups: Lookups; patch: (c: Partial<AccountingConfig>) => void }) {
  const acc = (k: keyof Accounts, v: string) => patch({ accounts: { ...cfg.accounts, [k]: v.replace(/\s/g, "") } });
  return (
    <div className="mt-3 space-y-4 text-xs">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(ACCOUNT_LABELS) as Array<keyof Accounts>).map((k) => (
          <label key={k} className="font-bold">{ACCOUNT_LABELS[k]}<input className={`${input} mt-1`} style={inputStyle} inputMode="numeric" value={cfg.accounts[k]} onChange={(e) => acc(k, e.target.value)} /></label>
        ))}
      </div>
      <div>
        <p className="mb-1 font-black">Medios de pago → caja o banco</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(METHOD_LABELS) as PayKey[]).map((k) => (
            <label key={k} className="font-bold">{METHOD_LABELS[k]}<input className={`${input} mt-1`} style={inputStyle} inputMode="numeric" value={cfg.methods[k]} onChange={(e) => patch({ methods: { ...cfg.methods, [k]: e.target.value.replace(/\s/g, "") } })} /></label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-black">Código del comprobante en su programa</p>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {KINDS.map((k) => (
            <label key={k} className="font-bold">{DOC_LABELS[k]}
              <input className={`${input} mt-1`} style={inputStyle} value={cfg.docCodes[k]} onChange={(e) => patch({ docCodes: { ...cfg.docCodes, [k]: e.target.value } })} />
              {cfg.numbering === "sequence" ? (
                <input className={`${input} mt-1`} style={inputStyle} inputMode="numeric" title="Empieza en" placeholder="Empieza en" value={cfg.startAt[k]}
                  onChange={(e) => patch({ startAt: { ...cfg.startAt, [k]: Number(e.target.value.replace(/\D/g, "")) || 1 } })} />
              ) : null}
            </label>
          ))}
        </div>
      </div>
      {lookups.categories.length ? (
        <div>
          <p className="mb-1 font-black">Cuenta de cada categoría de gasto</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {lookups.categories.map((c) => (
              <label key={c.id} className="font-bold">{c.name}
                <input className={`${input} mt-1`} style={inputStyle} inputMode="numeric" placeholder={cfg.accounts.expenseDefault} value={cfg.expenseAccounts[c.id] ?? ""}
                  onChange={(e) => patch({ expenseAccounts: { ...cfg.expenseAccounts, [c.id]: e.target.value.replace(/\s/g, "") } })} />
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {lookups.points.length ? (
        <div>
          <p className="mb-1 font-black">Centro de costo de cada punto o bodega (opcional)</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {lookups.points.map((p) => (
              <label key={p.id} className="font-bold">{p.name}
                <input className={`${input} mt-1`} style={inputStyle} value={cfg.costCenters[p.id] ?? ""} onChange={(e) => patch({ costCenters: { ...cfg.costCenters, [p.id]: e.target.value.trim() } })} />
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="font-bold">Identificación del consumidor final<input className={`${input} mt-1`} style={inputStyle} value={cfg.finalConsumerId} onChange={(e) => patch({ finalConsumerId: e.target.value.replace(/\D/g, "") })} /></label>
        <label className="font-bold">NIT de la tienda (gastos y nómina)<input className={`${input} mt-1`} style={inputStyle} value={cfg.storeNit} onChange={(e) => patch({ storeNit: e.target.value.replace(/\D/g, "") })} /></label>
      </div>
    </div>
  );
}

function FormatEditor({ format, onChange, onDelete }: { format: FormatSpec; onChange: (f: CustomFormat) => void; onDelete: (id: string) => void }) {
  const isCustom = "custom" in format;
  const [f, setF] = useState<CustomFormat>(() => (isCustom ? (format as CustomFormat) : cloneFormat(format, `Mi formato (${format.name})`)));
  const set = (c: Partial<CustomFormat>) => setF((cur) => ({ ...cur, ...c }));
  const setCol = (i: number, c: Partial<Column>) => set({ columns: f.columns.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const move = (i: number, d: number) => {
    const cols = [...f.columns];
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    set({ columns: cols });
  };
  return (
    <div className="mt-3 space-y-3 rounded-2xl border p-4 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <label className="font-bold sm:col-span-2">Nombre<input className={`${input} mt-1`} style={inputStyle} value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="font-bold">Archivo
          <select className={`${input} mt-1`} style={inputStyle} value={f.file} onChange={(e) => set({ file: e.target.value as CustomFormat["file"] })}>
            <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option><option value="txt">Plano (.txt)</option>
          </select>
        </label>
        <label className="font-bold">Separador
          <select className={`${input} mt-1`} style={inputStyle} value={f.separator} onChange={(e) => set({ separator: e.target.value as CustomFormat["separator"] })}>
            <option value=";">Punto y coma ;</option><option value=",">Coma ,</option><option value={"\t"}>Tabulador</option><option value="|">Barra |</option>
          </select>
        </label>
        <label className="font-bold">Fecha
          <select className={`${input} mt-1`} style={inputStyle} value={f.date} onChange={(e) => set({ date: e.target.value as CustomFormat["date"] })}>
            <option value="dd/mm/yyyy">DD/MM/AAAA</option><option value="dd-mm-yyyy">DD-MM-AAAA</option><option value="yyyy-mm-dd">AAAA-MM-DD</option><option value="yyyymmdd">AAAAMMDD</option><option value="mm/dd/yyyy">MM/DD/AAAA</option>
          </select>
        </label>
        <label className="font-bold">Decimales
          <select className={`${input} mt-1`} style={inputStyle} value={f.decimal} onChange={(e) => set({ decimal: e.target.value as CustomFormat["decimal"] })}>
            <option value=",">Coma (1234,50)</option><option value=".">Punto (1234.50)</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={f.headers} onChange={(e) => set({ headers: e.target.checked })} /> Primera fila con encabezados</label>
      <div className="space-y-1">
        {f.columns.map((col, i) => (
          <div key={i} className="grid items-center gap-1 sm:grid-cols-[2rem_1fr_1fr_1fr_auto]">
            <span style={{ color: "var(--t-muted)" }}>{i + 1}</span>
            <input className={input} style={inputStyle} value={col.header} onChange={(e) => setCol(i, { header: e.target.value })} aria-label="Encabezado" />
            <select className={input} style={inputStyle} value={col.field} onChange={(e) => setCol(i, { field: e.target.value as Field })} aria-label="Dato">
              {FIELDS.map((x) => <option key={x} value={x}>{FIELD_LABELS[x]}</option>)}
            </select>
            {col.field === "fixed" ? <input className={input} style={inputStyle} placeholder="Valor fijo" value={col.fixed ?? ""} onChange={(e) => setCol(i, { fixed: e.target.value })} /> : <span />}
            <span className="flex gap-1">
              <button type="button" className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)" }} onClick={() => move(i, -1)} aria-label="Subir">↑</button>
              <button type="button" className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)" }} onClick={() => move(i, 1)} aria-label="Bajar">↓</button>
              <button type="button" className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)" }} onClick={() => set({ columns: f.columns.filter((_, j) => j !== i) })} aria-label="Quitar">✕</button>
            </span>
          </div>
        ))}
        <button type="button" className="font-bold underline" onClick={() => set({ columns: [...f.columns, { header: "Nueva columna", field: "blank" }] })}>+ Agregar columna</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-full px-4 py-2 font-bold text-white" style={{ background: "var(--t-accent)" }} disabled={!f.columns.length || !f.name.trim()} onClick={() => onChange(f)}>
          {isCustom ? "Aplicar cambios" : "Crear este formato"}
        </button>
        {isCustom ? <button type="button" className="rounded-full border px-4 py-2 font-bold" style={{ borderColor: "#ef4444", color: "#ef4444" }} onClick={() => onDelete(f.id)}>Eliminar formato</button> : null}
        <span className="self-center" style={{ color: "var(--t-muted)" }}>Después toca «Guardar configuración» para que quede para todos.</span>
      </div>
    </div>
  );
}
