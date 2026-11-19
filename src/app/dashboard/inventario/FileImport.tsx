"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fold, readTable, toNumber, type TableSheet } from "@/lib/data/read-table";
import { EMPTY_PRODUCT_DETAILS } from "@/lib/product-details";
import type { Line } from "./LineEditor";
import { ProductChooser } from "./XmlImport";
import { Btn, errorMessage, inputClass, inputStyle, money, toast, type ProductHit } from "./shared";

/**
 * «Cargar Excel o CSV»: la factura o remisión del proveedor en una hoja de cálculo (código, descripción, cantidad, costo).
 * La base reconoce cada línea (erp_purchase_import_match, 20261326): código aprendido, código, código de barras,
 * código dentro del nombre (88130 → «CLOSET … 88130») o mismo nombre. Lo que no exista se puede crear de una vez.
 * Antes de pasar a la factura se ve todo: qué se reutiliza, qué se crea, totales y si la factura ya se ingresó.
 * Nada se registra aquí: las líneas pasan al ingreso y se registra como siempre.
 */

import { FIELDS, cellText, detect, parseLines, type Field, type FileLine } from "@/lib/purchases/file-columns";

type MatchRow = {
  idx: number; how: string | null; product_id: string | null; name: string | null; sku: string | null; tax_rate: number | null;
  active: boolean | null; auto_inactive: boolean | null; stock: number; candidates: Array<{ id: string; name: string; sku: string | null }> | null; code_free: boolean;
};
type Pick = { product_id: string; name: string; sku: string | null; stock: number; tax_rate: number; how: string; inactive?: boolean } | null;

const HOW: Record<string, string> = {
  learned: "✓ código aprendido de este proveedor", sku: "✓ mismo código", barcode: "✓ código de barras", name_code: "✓ el código está en su nombre",
  name: "✓ mismo nombre · revisa que sea el mismo", manual: "elegido por ti", created: "🆕 se crea",
};

export type FileApply = { supplier: string; invoiceRef: string; lines: Line[] };

export function FileImportButton({ storeId, warehouseId, suppliers, supplierId, invoiceRef, canCreateProducts, canPrices, onApply }: {
  storeId: string; warehouseId: string; suppliers: Array<{ id: string; name: string; active: boolean }>;
  supplierId: string; invoiceRef: string; canCreateProducts: boolean; canPrices: boolean; onApply: (d: FileApply) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [sheets, setSheets] = useState<{ file: File; sheets: TableSheet[] } | null>(null);
  const [reading, setReading] = useState(false);

  async function read(file: File) {
    setReading(true);
    try {
      const all = (await readTable(file)).filter((s) => s.rows.length > 1);
      if (!all.length) throw new Error("El archivo no trae filas con datos.");
      setSheets({ file, sheets: all });
    } catch (e) {
      void toast("No se pudo leer el archivo", "error", e instanceof Error ? e.message : String(e));
    } finally { setReading(false); }
  }

  return (
    <>
      <Btn variant="ghost" disabled={reading} onClick={() => input.current?.click()}>{reading ? "Leyendo…" : "📊 Cargar Excel o CSV"}</Btn>
      <input ref={input} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
      {sheets ? (
        <FileReview storeId={storeId} warehouseId={warehouseId} suppliers={suppliers} supplierId={supplierId} invoiceRef={invoiceRef}
          canCreateProducts={canCreateProducts} canPrices={canPrices} file={sheets.file} sheets={sheets.sheets}
          onClose={() => setSheets(null)} onApply={(d) => { setSheets(null); onApply(d); }} />
      ) : null}
    </>
  );
}

function FileReview({ storeId, warehouseId, suppliers, supplierId, invoiceRef, canCreateProducts, canPrices, file, sheets, onClose, onApply }: {
  storeId: string; warehouseId: string; suppliers: Array<{ id: string; name: string; active: boolean }>; supplierId: string; invoiceRef: string;
  canCreateProducts: boolean; canPrices: boolean; file: File; sheets: TableSheet[]; onClose: () => void; onApply: (d: FileApply) => void;
}) {
  const [sheetIdx, setSheetIdx] = useState(0);
  const rows = useMemo(() => sheets[sheetIdx]?.rows ?? [], [sheets, sheetIdx]);
  const auto = useMemo(() => detect(rows), [rows]);
  const [header, setHeader] = useState<number | null>(null);
  const [map, setMap] = useState<Record<Field, number> | null>(null);
  const h = header ?? auto.header;
  const m = map ?? auto.map;
  const heads = (rows[h] ?? []).map((c, i) => cellText(c) || `Columna ${i + 1}`);
  const [supplier, setSupplier] = useState(supplierId);
  const [ref, setRef] = useState(invoiceRef);
  const [expected, setExpected] = useState("");

  const [step, setStep] = useState<"map" | "review">("map");
  const [lines, setLines] = useState<FileLine[]>([]);
  const [match, setMatch] = useState<{ duplicate: { number: number } | null; rows: MatchRow[] } | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [create, setCreate] = useState<boolean[]>([]);
  const [skip, setSkip] = useState<boolean[]>([]);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);

  async function review() {
    if (m.qty < 0) return void toast("Elige la columna de la cantidad", "warning");
    if (m.code < 0 && m.description < 0) return void toast("Elige la columna del código o la de la descripción", "warning");
    if (m.cost < 0 && m.total < 0) return void toast("Elige la columna del costo unitario o la del total", "warning");
    const parsed = parseLines(rows, h, m);
    if (!parsed.length) return void toast("No encontré líneas con cantidad", "warning", "Revisa la fila de encabezados y las columnas.");
    if (parsed.length > 1000) return void toast("Máximo 1.000 líneas por archivo", "warning");
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_purchase_import_match", {
      p_store: storeId, p_supplier: supplier || null, p_invoice_ref: ref.trim() || null,
      p_lines: parsed.map((l) => ({ code: l.code, description: l.description })),
    });
    setBusy(false);
    const d = data as { ok?: boolean; message?: string; duplicate?: { number: number } | null; lines?: MatchRow[] } | null;
    if (error || !d?.ok) {
      return void toast("No se pudo revisar el archivo", "error", error && /Could not find the function|schema cache/i.test(error.message) ? "Falta correr la migración 20261326 en Supabase." : d?.message ?? (error ? errorMessage(error) : undefined));
    }
    const mr = d.lines ?? [];
    setLines(parsed);
    setMatch({ duplicate: d.duplicate ?? null, rows: mr });
    setPicks(parsed.map((_, i) => {
      const r = mr.find((x) => x.idx === i);
      return r?.product_id ? { product_id: r.product_id, name: r.name ?? "", sku: r.sku, stock: Number(r.stock ?? 0), tax_rate: Number(r.tax_rate ?? 0), how: r.how ?? "manual", inactive: r.active === false && !r.auto_inactive } : null;
    }));
    setCreate(parsed.map((_, i) => { const r = mr.find((x) => x.idx === i); return canCreateProducts && !r?.product_id && !r?.candidates?.length; }));
    setSkip(parsed.map(() => false));
    setStep("review");
  }

  const setAt = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, v: T) => set((cur) => cur.map((x, j) => (j === i ? v : x)));
  const fromHit = (x: ProductHit): Pick => ({ product_id: x.id, name: x.name, sku: x.sku, stock: Number(x.stock ?? 0), tax_rate: Number(x.tax_rate ?? 0), how: "manual", inactive: x.active === false && !x.auto_inactive });

  const live = lines.map((l, i) => ({ l, i })).filter(({ i }) => !skip[i]);
  const pending = live.filter(({ i }) => !picks[i] && !create[i]).length;
  const toCreate = live.filter(({ i }) => !picks[i] && create[i]).length;
  const reused = live.filter(({ i }) => picks[i]).length;
  const total = live.reduce((s, { l }) => s + l.qty * l.cost, 0);
  const exp = toNumber(expected);
  const diff = exp !== null ? Math.round(total - exp) : null;
  const badTotals = live.filter(({ l }) => l.fileTotal !== null && Math.abs(l.fileTotal - l.qty * l.cost) > 1).length;

  async function apply() {
    if (pending) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      // 1. Crear los que faltan (una vez por código o nombre, aunque vengan en varias líneas).
      const created = new Map<string, Pick>();
      const keyOf = (l: FileLine) => l.code || fold(l.description);
      const usedCodes = new Set<string>();
      const markup = canPrices && pct.trim() ? Math.min(1000, Math.max(0, Number(pct.replace(",", ".")))) : null;
      const pendingNew = live.filter(({ i }) => !picks[i] && create[i]);
      const rowsToInsert: Array<{ key: string; row: Record<string, unknown> }> = [];
      for (const { l, i } of pendingNew) {
        const key = keyOf(l);
        if (rowsToInsert.some((r) => r.key === key)) continue;
        const free = match?.rows.find((x) => x.idx === i)?.code_free;
        const sku = l.code && free && !usedCodes.has(l.code.toUpperCase()) ? l.code : null;
        if (sku) usedCodes.add(sku.toUpperCase());
        rowsToInsert.push({ key, row: {
          store_id: storeId, name: (l.description || l.code).toUpperCase(), ...(sku ? { sku } : {}),
          description: "", cost_price: 0, price_1: 0, price_2: 0, price_3: 0, price_4: 0, price_5: 0, price_retail: 0, price_wholesale: 0,
          min_wholesale: 1, stock: 0, active: true, product_details: EMPTY_PRODUCT_DETAILS,
          ...(markup !== null && Number.isFinite(markup) ? { markup_1: markup, markup_2: markup, markup_3: markup, markup_4: markup, markup_5: markup } : {}),
        } });
      }
      const failed: string[] = [];
      const insertOne = async (row: Record<string, unknown>) => {
        let res = await sb.from("products").insert(row).select("id,name,sku").single();
        if (res.error && /markup_|permission denied/i.test(res.error.message)) {
          const { markup_1: _a, markup_2: _b, markup_3: _c, markup_4: _d, markup_5: _e, ...rest } = row;
          void _a; void _b; void _c; void _d; void _e;
          res = await sb.from("products").insert(rest).select("id,name,sku").single();
        }
        return res;
      };
      for (let k = 0; k < rowsToInsert.length; k += 1) {
        const { key, row } = rowsToInsert[k];
        const res = await insertOne(row);
        if (res.error || !res.data) { failed.push(`${String(row.name)} (${res.error ? errorMessage(res.error) : "sin respuesta"})`); continue; }
        const p = res.data as { id: string; name: string; sku: string | null };
        created.set(key, { product_id: p.id, name: p.name, sku: p.sku, stock: 0, tax_rate: 0, how: "created" });
      }
      if (failed.length) {
        void toast(`No se crearon ${failed.length} producto(s)`, "error", `${failed.slice(0, 3).join(" · ")}${failed.length > 3 ? "…" : ""}. Los demás quedaron creados; vuelve a intentar.`);
        setPicks((cur) => cur.map((p, i) => p ?? (create[i] ? created.get(keyOf(lines[i])) ?? null : null)));
        setCreate((cur) => cur.map((c, i) => (c && created.has(keyOf(lines[i])) ? false : c)));
        return;
      }

      // 2. Aprender los códigos del proveedor (la próxima factura llega sola).
      const final = live.map(({ l, i }) => ({ l, p: (picks[i] ?? created.get(keyOf(l)))! }));
      if (supplier) {
        const learn = final.filter(({ l, p }) => l.code && p.how !== "learned" && l.code.toUpperCase() !== (p.sku ?? "").toUpperCase())
          .map(({ l, p }) => ({ code: l.code, product_id: p.product_id, description: l.description }));
        if (learn.length) await sb.rpc("erp_supplier_item_map_save", { p_store: storeId, p_supplier: supplier, p_items: learn });
      }

      // 3. Líneas de la factura (si un producto viene en varias filas, se suman con el costo promedio).
      const out: Line[] = [];
      for (const { l, p } of final) {
        const cur = out.find((x) => x.product_id === p.product_id);
        if (cur) {
          const qty = cur.qty + l.qty;
          cur.unit_cost = Math.round(((cur.unit_cost * cur.qty + l.cost * l.qty) / qty) * 100) / 100;
          cur.qty = qty;
          continue;
        }
        out.push({
          product_id: p.product_id, name: p.name, sku: p.sku, current: p.stock, qty: l.qty, unit_cost: l.cost,
          tax_rate: l.tax ?? 0, warehouse_id: warehouseId,
          ...(l.code && l.code.toUpperCase() !== (p.sku ?? "").toUpperCase() ? { supplier_code: l.code.toUpperCase() } : {}),
          ...(p.how === "created" && markup !== null ? { markup } : {}),
        });
      }
      onApply({ supplier, invoiceRef: ref.trim(), lines: out });
      void toast(`${file.name}: ${out.length} producto(s) en la factura`, "success",
        `${reused} reutilizado(s)${created.size ? ` · ${created.size} creado(s)` : ""}. Revisa cantidades, costos, IVA y bodega, y registra como siempre.`);
    } catch (e) {
      void toast("No se pudo cargar", "error", e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const sel = "rounded-xl border px-2 py-1.5 text-xs";
  const body = (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border" style={{ background: "var(--t-bg-base)", color: "var(--t-text)", borderColor: "var(--t-card-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-start gap-3 border-b p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="min-w-0 flex-1">
            <b className="block text-base">📊 {file.name}</b>
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>
              {step === "map" ? "1. Revisa qué columna es cada cosa · 2. Revisa los productos · 3. Pasan a la factura (nada se registra todavía)." : `${lines.length} línea(s) · ${reused} se reutilizan · ${toCreate} se crean${pending ? ` · ${pending} por resolver` : ""}`}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {step === "map" ? (
          <div className="flex-1 space-y-3 overflow-auto p-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-xs font-bold">Proveedor
                <select className={`${inputClass} mt-1`} style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                  <option value="">— Elige el proveedor —</option>
                  {suppliers.filter((s) => s.active || s.id === supplier).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold">N.º de factura o remisión
                <input className={`${inputClass} mt-1`} style={inputStyle} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ej. 30947" />
              </label>
              <label className="block text-xs font-bold">Total de la factura (para comparar)
                <input className={`${inputClass} mt-1`} style={inputStyle} value={expected} inputMode="numeric" onChange={(e) => setExpected(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
            {!supplier ? <p className="text-xs" style={{ color: "#d97706" }}>Sin proveedor no se usan ni se aprenden sus códigos, y no se revisa si la factura ya se ingresó.</p> : null}
            <div className="flex flex-wrap items-end gap-2">
              {sheets.length > 1 ? (
                <label className="text-xs font-bold">Hoja
                  <select className={`${sel} ml-1`} style={inputStyle} value={sheetIdx} onChange={(e) => { setSheetIdx(Number(e.target.value)); setHeader(null); setMap(null); }}>
                    {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="text-xs font-bold">Fila de encabezados
                <select className={`${sel} ml-1`} style={inputStyle} value={h} onChange={(e) => { setHeader(Number(e.target.value)); setMap(null); }}>
                  {rows.slice(0, 20).map((r, i) => <option key={i} value={i}>{i + 1}: {r.map(cellText).filter(Boolean).slice(0, 4).join(" · ").slice(0, 60)}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {FIELDS.map((f) => (
                <label key={f.key} className="block text-xs font-bold">{f.label}{f.need ? " *" : ""}
                  <select className={`${sel} mt-1 w-full`} style={inputStyle} value={m[f.key]}
                    onChange={(e) => setMap({ ...m, [f.key]: Number(e.target.value) })}>
                    <option value={-1}>— No viene —</option>
                    {heads.map((name, i) => <option key={i} value={i}>{name}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="overflow-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
              <table className="w-full text-xs">
                <thead><tr style={{ color: "var(--t-muted)" }}>{FIELDS.filter((f) => m[f.key] >= 0).map((f) => <th key={f.key} className="px-2 py-1 text-left">{f.label}</th>)}</tr></thead>
                <tbody>
                  {parseLines(rows, h, m).slice(0, 8).map((l) => (
                    <tr key={l.row} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      {m.code >= 0 ? <td className="px-2 py-1">{l.code}</td> : null}
                      {m.description >= 0 ? <td className="px-2 py-1">{l.description}</td> : null}
                      <td className="px-2 py-1 text-right">{l.qty}</td>
                      {m.cost >= 0 ? <td className="px-2 py-1 text-right">{money(l.cost)}</td> : null}
                      {m.total >= 0 ? <td className="px-2 py-1 text-right">{l.fileTotal === null ? "—" : money(l.fileTotal)}</td> : null}
                      {m.tax >= 0 ? <td className="px-2 py-1 text-right">{l.tax ?? "—"}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-2 py-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Así se leen las primeras líneas. Se saltan las filas sin cantidad y las de totales.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-4">
            {match?.duplicate ? (
              <p className="mb-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "#ef4444", color: "#ef4444" }}>
                ⚠️ Esta factura ya se ingresó (ingreso N.º {match.duplicate.number}). Si la registras de nuevo, la mercancía se suma dos veces.
              </p>
            ) : null}
            {canCreateProducts && toCreate ? (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                🆕 Se crearán <b>{toCreate}</b> producto(s) con la descripción como nombre y el código del archivo (si está libre).
                {canPrices ? (
                  <label className="ml-auto flex items-center gap-1 font-bold">% de ganancia para los nuevos
                    <input className="w-16 rounded-lg border px-2 py-1 text-right" style={inputStyle} value={pct} inputMode="decimal" onChange={(e) => setPct(e.target.value)} placeholder="—" />%
                  </label>
                ) : null}
              </div>
            ) : null}
            <table className="rt w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}>
                  <th className="py-1 pr-2">En el archivo</th><th className="px-2 text-right">Cant.</th><th className="px-2 text-right">Costo</th><th className="px-2 text-right">Total</th><th className="pl-2">Producto en RemHub</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = picks[i];
                  const mr = match?.rows.find((x) => x.idx === i);
                  return (
                    <tr key={i} className="border-t align-top" style={{ borderColor: "var(--t-card-border)", opacity: skip[i] ? 0.45 : 1 }}>
                      <td className="py-2 pr-2">
                        <span className="block font-semibold">{l.description || "—"}</span>
                        <span className="text-xs" style={{ color: "var(--t-muted)" }}>{l.code ? `Cód. ${l.code}` : "Sin código"} · fila {l.row}{l.qtyRounded ? " · ⚠️ cantidad con decimales (se redondeó)" : ""}</span>
                      </td>
                      <td className="px-2 py-2 text-right">{l.qty}</td>
                      <td className="px-2 py-2 text-right">{money(l.cost)}</td>
                      <td className="px-2 py-2 text-right">
                        {money(l.qty * l.cost)}
                        {l.fileTotal !== null && Math.abs(l.fileTotal - l.qty * l.cost) > 1 ? <span className="block text-[10px] font-bold" style={{ color: "#e5484d" }}>archivo: {money(l.fileTotal)}</span> : null}
                      </td>
                      <td className="py-2 pl-2">
                        {skip[i] ? (
                          <button type="button" className="text-xs underline" onClick={() => setAt<boolean>(setSkip, i, false)}>No se ingresa · deshacer</button>
                        ) : choosing === i ? (
                          <ProductChooser storeId={storeId} initial={l.description || l.code} onPick={(x) => { setAt<Pick>(setPicks, i, fromHit(x)); setAt<boolean>(setCreate, i, false); setChoosing(null); }} onCancel={() => setChoosing(null)} />
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {p ? (
                              <span className="min-w-0">
                                <b className="block">{p.name}{p.sku ? <span className="font-normal" style={{ color: "var(--t-muted)" }}> [{p.sku}]</span> : null}</b>
                                <span className="text-xs" style={{ color: p.how === "name" ? "#f59e0b" : "#22c55e" }}>{HOW[p.how] ?? p.how}</span>
                                {p.inactive ? <span className="ml-1 text-xs font-bold" style={{ color: "#e5484d" }}>· 🙈 inactivo</span> : null}
                              </span>
                            ) : create[i] ? (
                              <span className="text-xs font-bold" style={{ color: "#0ea5e9" }}>🆕 Se crea{l.code && mr?.code_free ? ` con el código ${l.code}` : l.code ? " (su código ya lo usa otro producto: queda con número interno)" : ""}</span>
                            ) : mr?.candidates?.length ? (
                              <span className="block text-xs">
                                <b style={{ color: "#f59e0b" }}>El código está en el nombre de varios:</b>
                                {mr.candidates.map((c) => (
                                  <button key={c.id} type="button" className="ml-1 mt-1 inline-block rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}
                                    onClick={() => setAt<Pick>(setPicks, i, { product_id: c.id, name: c.name, sku: c.sku, stock: 0, tax_rate: 0, how: "manual" })}>
                                    {c.name}
                                  </button>
                                ))}
                              </span>
                            ) : <span className="text-xs font-bold" style={{ color: "#f59e0b" }}>Sin emparejar</span>}
                            <button type="button" className="text-xs font-bold underline" onClick={() => setChoosing(i)}>{p ? "Cambiar" : "Elegir"}</button>
                            {!p && canCreateProducts && !create[i] ? <button type="button" className="text-xs font-bold underline" onClick={() => setAt<boolean>(setCreate, i, true)}>Crear</button> : null}
                            {!p && create[i] ? <button type="button" className="text-xs underline" onClick={() => setAt<boolean>(setCreate, i, false)}>No crear</button> : null}
                            <button type="button" className="text-xs underline" style={{ color: "var(--t-muted)" }} onClick={() => setAt<boolean>(setSkip, i, true)}>No ingresar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>
            {step === "review" ? (
              <>
                Total del archivo: <b style={{ color: "var(--t-text)" }}>{money(total)}</b> · {live.reduce((s, { l }) => s + l.qty, 0)} und.
                {diff !== null ? (diff === 0 ? <b style={{ color: "#10b981" }}> · ✓ cuadra con el total de la factura</b> : <b style={{ color: "#e5484d" }}> · ⚠️ difiere {money(Math.abs(diff))} del total de la factura ({diff > 0 ? "sobra" : "falta"})</b>) : null}
                {badTotals ? <b style={{ color: "#e5484d" }}> · {badTotals} línea(s) con total distinto a cantidad × costo</b> : null}
                {pending ? <b style={{ color: "#f59e0b" }}> · faltan {pending} por resolver (elegir, crear o «No ingresar»)</b> : null}
                {m.tax < 0 ? " · El archivo no trae IVA: queda en 0 %, cámbialo en la factura si aplica." : ""}
              </>
            ) : "Los códigos que se emparejen quedan aprendidos para la próxima factura de ese proveedor."}
          </span>
          <span className="flex gap-2">
            {step === "review" ? <Btn variant="ghost" onClick={() => setStep("map")}>← Columnas</Btn> : <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>}
            {step === "map"
              ? <Btn disabled={busy} onClick={() => void review()}>{busy ? "Revisando…" : "Revisar productos →"}</Btn>
              : <Btn disabled={busy || pending > 0 || !live.length} onClick={() => void apply()}>{busy ? "Cargando…" : toCreate ? `Crear ${toCreate} y pasar a la factura` : "Pasar a la factura"}</Btn>}
          </span>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
