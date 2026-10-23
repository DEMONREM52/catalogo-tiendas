"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { logExport } from "@/lib/permission-runtime";
import { DateField } from "@/components/forms/Fields";
import { downloadXlsx, type XSheet } from "@/lib/data/xlsx";
import { fold, readTable, type TableSheet } from "@/lib/data/read-table";
import { EXPORTS, type ExportDef } from "./exports";
import { IMPORTS, type ImportDef, type Prepared, type Result } from "./imports";

/**
 * Importar y exportar: todo lo de la tienda en Excel.
 *  · Exportar: escoge los temas (y el rango de fechas para ventas, compras, traslados, gastos y caja) y baja un
 *    solo Excel con una hoja por tema. Cada descarga queda en la auditoría.
 *  · Importar: plantilla → subir archivo → RemHub revisa cada fila contra la base y muestra qué va a pasar →
 *    al confirmar vuelve a revisar y guarda. Nada se guarda sin que lo veas antes.
 */

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ACTION: Record<Prepared["action"], [string, string]> = {
  create: ["Nuevo", "#22c55e"], update: ["Actualiza", "#0ea5e9"], skip: ["Se omite", "#94a3b8"], error: ["Error", "#ef4444"],
};

type Access = { storeId: string; slug: string; can: (p: string) => boolean };

export default function DataCenterPage() {
  const [access, setAccess] = useState<Access | null>(null);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<"export" | "import">("export");

  useEffect(() => {
    void (async () => {
      const a = await getDashboardStore().catch(() => null);
      if (!a?.store) return setDenied(true);
      setAccess({ storeId: a.store.id, slug: a.store.slug, can: (p: string) => hasStorePermission(a, p) });
    })();
  }, []);

  if (denied) return <p className="p-6 text-sm">No tienes una tienda abierta.</p>;
  if (!access) return <p className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>;

  return (
    <main className="space-y-4">
      <section className="rounded-3xl border p-5" style={card}>
        <h1 className="text-xl font-black">🔄 Importar y exportar</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
          Saca todo a Excel cuando quieras (tus datos siempre son tuyos) o sube de una vez tus productos, terceros, cartera, deudas con proveedores o un conteo de inventario.
        </p>
        <div className="mt-3 inline-flex rounded-full border p-1" style={{ borderColor: "var(--t-card-border)" }}>
          {([["export", "⬇️ Exportar"], ["import", "⬆️ Importar"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="rounded-full px-4 py-1.5 text-sm font-bold"
              style={tab === k ? { background: "var(--t-cta)", color: "#0b0b0b" } : undefined}>{l}</button>
          ))}
        </div>
      </section>
      {tab === "export" ? <ExportPanel access={access} /> : <ImportPanel access={access} />}
    </main>
  );
}

// ======================================================================== Exportar
function ExportPanel({ access }: { access: Access }) {
  const canExport = access.can("exports");
  const list = useMemo(() => EXPORTS.filter((e) => e.perms.some((p) => access.can(p))), [access]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(["productos", "terceros", "cartera"]));
  const [from, setFrom] = useState(() => iso(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const chosen = list.filter((e) => picked.has(e.key));
  const usesRange = chosen.some((e) => e.usesRange);

  async function run(defs: ExportDef[]) {
    if (!defs.length) return void Swal.fire({ ...swal, icon: "info", title: "Escoge qué exportar" });
    if (from > to) return void Swal.fire({ ...swal, icon: "warning", title: "Revisa las fechas", text: "La fecha «desde» va antes de «hasta»." });
    setBusy(true);
    const sheets: XSheet[] = [];
    const problems: string[] = [];
    const counts: Record<string, number> = {};
    for (const d of defs) {
      try {
        const out = await d.build({ storeId: access.storeId, can: access.can, range: { from, to }, step: setStep });
        sheets.push(...out);
        counts[d.key] = out.reduce((s, x) => s + x.rows.length, 0);
      } catch (e) {
        problems.push(`${d.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(false);
    if (!sheets.length) { setStep(""); return void Swal.fire({ ...swal, icon: "error", title: "No se pudo exportar", text: problems.join(" · ") }); }
    const name = defs.length === 1 ? defs[0].key : "datos";
    downloadXlsx(`${name}-${access.slug}-${iso(new Date())}${usesRange && defs.some((d) => d.usesRange) ? `_${from}_a_${to}` : ""}.xlsx`, sheets);
    logExport(`datos.${defs.map((d) => d.key).join("+")}`, Object.values(counts).reduce((a, b) => a + b, 0), { temas: counts, desde: from, hasta: to });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    setStep(`✅ Listo: ${sheets.length} hoja${sheets.length === 1 ? "" : "s"} con ${total.toLocaleString("es-CO")} filas.`);
    if (problems.length) void Swal.fire({ ...swal, icon: "warning", title: "Algunas hojas no salieron", html: problems.map((p) => `• ${p.replace(/[<>&]/g, "")}`).join("<br/>") });
  }

  if (!canExport) {
    return <p className="rounded-2xl border p-4 text-sm" style={card}>Para descargar a Excel necesitas el permiso <b>«Exportar a Excel/CSV»</b>. Pídeselo al dueño de la tienda (Ajustes → Usuarios).</p>;
  }

  return (
    <section className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((e) => {
          const on = picked.has(e.key);
          return (
            <label key={e.key} className="flex cursor-pointer gap-3 rounded-2xl border p-3 transition hover:-translate-y-0.5"
              style={{ ...card, borderColor: on ? "var(--t-accent)" : card.borderColor }}>
              <input type="checkbox" checked={on} onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(e.key)) n.delete(e.key); else n.add(e.key); return n; })} className="mt-1 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-black">{e.icon} {e.title}{e.usesRange ? <span className="ml-1 text-[10px] font-semibold" style={{ color: "var(--t-muted)" }}>📅 por fechas</span> : null}</span>
                <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{e.detail}</span>
              </span>
              <button type="button" disabled={busy} onClick={(ev) => { ev.preventDefault(); void run([e]); }} className="ml-auto shrink-0 self-start rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }} title={`Descargar solo ${e.title}`}>⬇️</button>
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border p-3" style={card}>
        {usesRange ? (
          <>
            <label className="text-xs font-semibold">Desde<DateField value={from} onChange={setFrom} className="mt-1 w-40" ariaLabel="Desde" /></label>
            <label className="text-xs font-semibold">Hasta<DateField value={to} onChange={setTo} className="mt-1 w-40" ariaLabel="Hasta" /></label>
          </>
        ) : null}
        <button type="button" onClick={() => setPicked(new Set(list.map((e) => e.key)))} className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Marcar todo</button>
        <button type="button" disabled={busy || !chosen.length} onClick={() => void run(chosen)} className="ml-auto rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50" style={{ background: "var(--t-cta)", color: "#0b0b0b" }}>
          {busy ? "Preparando…" : `⬇️ Descargar Excel (${chosen.length} tema${chosen.length === 1 ? "" : "s"})`}
        </button>
        {step ? <p className="w-full text-xs" style={{ color: "var(--t-muted)" }}>{step}</p> : null}
        {usesRange ? <p className="w-full text-[11px]" style={{ color: "var(--t-muted)" }}>Las fechas aplican a ventas, compras, traslados, gastos y caja. Lo demás sale completo.</p> : null}
      </div>
    </section>
  );
}

// ======================================================================== Importar
function ImportPanel({ access }: { access: Access }) {
  const list = IMPORTS.filter((d) => d.perms.some((p) => access.can(p)));
  const [open, setOpen] = useState<string | null>(null);
  const def = list.find((d) => d.key === open) ?? null;
  if (!list.length) return <p className="rounded-2xl border p-4 text-sm" style={card}>Tu usuario no tiene permisos para importar. Pídeselos al dueño de la tienda.</p>;
  if (def) return <Importer def={def} access={access} onBack={() => setOpen(null)} />;
  return (
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((d) => {
        const body = (
          <>
            <span className="block text-sm font-black">{d.icon} {d.title}</span>
            <span className="mt-0.5 block text-xs" style={{ color: "var(--t-muted)" }}>{d.detail}</span>
            <span className="mt-2 inline-block text-xs font-bold" style={{ color: "var(--t-accent)" }}>Importar →</span>
          </>
        );
        return d.link
          ? <Link key={d.key} href={d.link} className="rounded-2xl border p-3 transition hover:-translate-y-0.5" style={card}>{body}</Link>
          : <button key={d.key} type="button" onClick={() => setOpen(d.key)} className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5" style={card}>{body}</button>;
      })}
    </section>
  );
}

function Importer({ def, access, onBack }: { def: ImportDef; access: Access; onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<TableSheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [update, setUpdate] = useState(false);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [prepared, setPrepared] = useState<Prepared[] | null>(null);
  const [unknownCols, setUnknownCols] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [filter, setFilter] = useState<"all" | Prepared["action"]>("all");
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!def.needsWarehouse) return;
    void supabaseBrowser().from("erp_warehouses").select("id,name").eq("store_id", access.storeId).eq("active", true).order("name")
      .then(({ data }) => setWarehouses((data ?? []) as Array<{ id: string; name: string }>));
  }, [def.needsWarehouse, access.storeId]);

  /** Filas del archivo con cada columna reconocida (encabezado en la primera fila). */
  const mapped = useMemo(() => {
    const table = sheets[sheetIdx]?.rows ?? [];
    const [head = [], ...body] = table;
    const keyOf = head.map((h) => def.columns.find((c) => c.aliases.includes(fold(h)))?.key ?? null);
    const unknown = head.map((h, i) => (String(h ?? "").trim() && !keyOf[i] ? String(h) : "")).filter(Boolean);
    const lacking = def.columns.filter((c) => c.required && !keyOf.includes(c.key)).map((c) => c.label);
    const rows = body.map((cells, i) => {
      const v: Record<string, unknown> = {};
      keyOf.forEach((k, j) => { if (k && v[k] === undefined) v[k] = cells[j]; });
      return { line: i + 2, v };
    });
    return { rows, unknown, lacking };
  }, [sheets, sheetIdx, def]);

  async function check(): Promise<Prepared[] | null> {
    setUnknownCols(mapped.unknown);
    setMissing(mapped.lacking);
    if (mapped.lacking.length) { setPrepared(null); return null; }
    if (!mapped.rows.length) { setPrepared([]); return []; }
    try {
      return await def.prepare(mapped.rows, { storeId: access.storeId, can: access.can, opts: { update, warehouseId }, fileName: file?.name ?? "archivo", step: setStep });
    } catch (e) {
      await Swal.fire({ ...swal, icon: "error", title: "No se pudo revisar", text: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  // Revisa contra la base cada vez que cambia el archivo, la hoja o las opciones.
  useEffect(() => {
    if (!sheets.length) return;
    let alive = true;
    void (async () => {
      setBusy(true); setResult(null);
      const p = await check();
      if (alive) { setPrepared(p); setStep(""); setBusy(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets, sheetIdx, update, warehouseId]);

  async function pick(f: File | null) {
    if (!f) return;
    setBusy(true); setStep("Leyendo el archivo…"); setPrepared(null); setResult(null);
    try {
      const t = await readTable(f);
      // Si el archivo tiene varias hojas, se escoge la que se llame como el tema (ej. «Terceros»).
      const idx = Math.max(0, t.findIndex((s) => fold(s.name).includes(fold(def.title).split(" ")[0])));
      setFile(f); setSheetIdx(idx); setSheets(t);
    } catch (e) {
      setBusy(false); setStep("");
      await Swal.fire({ ...swal, icon: "error", title: "No pude leer el archivo", text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const counts = useMemo(() => {
    const c = { create: 0, update: 0, skip: 0, error: 0 };
    for (const r of prepared ?? []) c[r.action]++;
    return c;
  }, [prepared]);
  const toSave = counts.create + counts.update;

  async function save() {
    if (!prepared || !toSave) return;
    const ok = await Swal.fire({
      ...swal, icon: "question", title: `¿Importar ${toSave} fila${toSave === 1 ? "" : "s"}?`,
      html: `${counts.create ? `🟢 ${counts.create} nuevas<br/>` : ""}${counts.update ? `🔵 ${counts.update} se actualizan<br/>` : ""}${counts.skip ? `⚪ ${counts.skip} se omiten<br/>` : ""}${counts.error ? `🔴 ${counts.error} con error (no se importan)<br/>` : ""}<br/><small>Antes de guardar se vuelve a revisar contra la base, por si otra persona cambió algo.</small>`,
      showCancelButton: true, confirmButtonText: "Importar", cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;
    setBusy(true);
    setStep("Revisando otra vez con la base…");
    const fresh = await check();
    if (!fresh) { setBusy(false); setStep(""); return; }
    const freshSave = fresh.filter((r) => r.action === "create" || r.action === "update").length;
    if (freshSave !== toSave) {
      setPrepared(fresh); setBusy(false); setStep("");
      return void Swal.fire({ ...swal, icon: "info", title: "Algo cambió mientras tanto", text: `Ahora son ${freshSave} filas para importar (antes ${toSave}). Revisa la lista y vuelve a confirmar.` });
    }
    try {
      const res = await def.apply(fresh, { storeId: access.storeId, can: access.can, opts: { update, warehouseId }, fileName: file?.name ?? "archivo", step: setStep });
      setResult(res);
      setPrepared(null);
      setStep("");
      await Swal.fire({
        ...swal, icon: res.failed.length ? "warning" : "success", title: res.failed.length ? "Importación con avisos" : "¡Importado!",
        html: `✅ ${res.done} guardadas${res.skipped ? ` · ⚪ ${res.skipped} omitidas` : ""}${res.failed.length ? ` · 🔴 ${res.failed.length} no se pudieron` : ""}`,
      });
    } catch (e) {
      setStep("");
      await Swal.fire({ ...swal, icon: "error", title: "Se detuvo la importación", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  function template() {
    downloadXlsx(`plantilla-${def.key}`, [{ name: def.title.slice(0, 31), head: def.columns.map((c) => c.label), rows: def.sample }]);
  }
  function errorReport() {
    const rows: Array<Array<string | number>> = [];
    for (const r of prepared ?? []) if (r.action === "error") rows.push([r.line, r.label, r.message]);
    for (const f of result?.failed ?? []) rows.push([f.line, f.label, f.error]);
    downloadXlsx(`errores-${def.key}`, [{ name: "Errores", head: ["Fila del archivo", "Dato", "Problema"], rows }]);
  }

  const shown = (prepared ?? []).filter((r) => filter === "all" || r.action === filter);

  return (
    <section className="space-y-3">
      <div className="rounded-3xl border p-4" style={card}>
        <button type="button" onClick={onBack} className="text-xs underline" style={{ color: "var(--t-muted)" }}>← Volver</button>
        <h2 className="mt-1 text-lg font-black">{def.icon} Importar {def.title.toLowerCase()}</h2>
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>{def.detail}</p>

        <ol className="mt-3 grid gap-2 md:grid-cols-3">
          <li className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
            <b>1. Baja la plantilla</b>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>O usa tu propio Excel: las columnas se reconocen por su nombre.</p>
            <button type="button" onClick={template} className="mt-2 rounded-xl border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>📄 Plantilla de Excel</button>
          </li>
          <li className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
            <b>2. Sube tu archivo</b>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Excel (.xlsx) o CSV. {file ? <b>{file.name}</b> : null}</p>
            <input ref={inputRef} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-2 rounded-xl px-3 py-1.5 text-xs font-black disabled:opacity-50" style={{ background: "var(--t-cta)", color: "#0b0b0b" }}>📂 Escoger archivo</button>
          </li>
          <li className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
            <b>3. Revisa y confirma</b>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>RemHub te muestra qué es nuevo, qué ya existe y qué tiene errores. Nada se guarda hasta que confirmes.</p>
          </li>
        </ol>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {def.needsWarehouse ? (
            <label className="flex items-center gap-2 font-semibold">📍 Punto o bodega contada
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" style={{ ...card }}>
                <option value="">Escoge…</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          ) : null}
          {def.canUpdate ? (
            <label className="flex items-center gap-2"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} /> Actualizar los que ya existen <span className="text-xs" style={{ color: "var(--t-muted)" }}>(solo con los datos que vengan llenos)</span></label>
          ) : null}
          {sheets.length > 1 ? (
            <label className="flex items-center gap-2">Hoja
              <select value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))} className="rounded-xl border px-3 py-1.5 text-sm" style={{ ...card }}>
                {sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <details className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>
          <summary className="cursor-pointer font-semibold">Columnas que reconoce</summary>
          <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {def.columns.map((c) => <li key={c.key}><b>{c.label}</b>{c.required ? " *" : ""}{c.hint ? ` — ${c.hint}` : ""}</li>)}
          </ul>
        </details>
      </div>

      {step ? <p className="rounded-2xl border p-3 text-sm" style={card}>⏳ {step}</p> : null}
      {missing.length ? <p className="rounded-2xl border p-3 text-sm text-amber-500" style={card}>⚠️ Al archivo le falta la columna: <b>{missing.join(", ")}</b>. Usa la plantilla o cambia el título de la columna.</p> : null}
      {unknownCols.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Columnas que no se usan: {unknownCols.join(", ")}.</p> : null}

      {prepared ? (
        <div className="rounded-3xl border p-4" style={card}>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "create", "update", "skip", "error"] as const).map((k) => {
              const n = k === "all" ? prepared.length : counts[k];
              if (k !== "all" && !n) return null;
              const [label, color] = k === "all" ? ["Todas", "var(--t-accent)"] : ACTION[k];
              return <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full border px-3 py-1 text-xs font-bold"
                style={{ borderColor: filter === k ? color : "var(--t-card-border)", color: filter === k ? color : undefined }}>{label} · {n}</button>;
            })}
            {counts.error ? <button type="button" onClick={errorReport} className="ml-auto rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Errores en Excel</button> : null}
          </div>
          {!prepared.length ? <p className="mt-3 text-sm">El archivo no tiene filas debajo de los títulos.</p> : (
            <div className="mt-3 max-h-[55vh] overflow-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
              <table className="w-full min-w-[560px] text-xs">
                <thead className="sticky top-0" style={{ background: "var(--t-bg-base)", color: "var(--t-muted)" }}>
                  <tr><th className="px-2 py-1.5 text-left">Fila</th><th className="px-2 py-1.5 text-left">Dato</th><th className="px-2 py-1.5 text-left">Detalle</th><th className="px-2 py-1.5 text-left">Qué pasa</th></tr>
                </thead>
                <tbody>
                  {shown.slice(0, 1000).map((r) => {
                    const [label, color] = ACTION[r.action];
                    return (
                      <tr key={r.line} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                        <td className="px-2 py-1 tabular-nums">{r.line}</td>
                        <td className="px-2 py-1 font-semibold">{r.label}</td>
                        <td className="px-2 py-1" style={{ color: "var(--t-muted)" }}>{r.detail}</td>
                        <td className="px-2 py-1"><span className="mr-1 rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>{label}</span>{r.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length > 1000 ? <p className="p-2 text-xs" style={{ color: "var(--t-muted)" }}>Mostrando 1.000 de {shown.length}. Se importan todas.</p> : null}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {counts.error ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>Las filas con error no se importan. Corrígelas en tu Excel y súbelo de nuevo cuando quieras.</span> : null}
            <button type="button" disabled={busy || !toSave} onClick={() => void save()} className="rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50" style={{ background: "var(--t-cta)", color: "#0b0b0b" }}>
              {busy ? "Trabajando…" : toSave ? `✅ Importar ${toSave} fila${toSave === 1 ? "" : "s"}` : "No hay nada para importar"}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="rounded-3xl border p-4 text-sm" style={card}>
          <p className="font-black">Resultado</p>
          <p>✅ {result.done} guardadas · ⚪ {result.skipped} omitidas · 🔴 {result.failed.length} no se pudieron</p>
          {result.failed.length ? (
            <>
              <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5 text-xs">{result.failed.slice(0, 100).map((f) => <li key={`${f.line}-${f.error}`}>Fila {f.line} · {f.label}: {f.error}</li>)}</ul>
              <button type="button" onClick={errorReport} className="mt-2 rounded-xl border px-3 py-1.5 text-xs" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Descargar errores</button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
