"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { readSheet } from "read-excel-file/browser";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { cleanProductCode } from "../product-code";

/**
 * Importar productos desde Excel (.xlsx) o CSV: la forma más rápida de arrancar una tienda.
 * Columnas reconocidas (en cualquier orden, con o sin tildes): nombre, referencia, código de barras, categoría,
 * descripción, precio 1…5 (o «precio», «precio detal», «precio mayor»), unidades y costo.
 * Las unidades y el costo (opcionales) entran como un ingreso de factura: así el inventario y el costo quedan
 * con su kardex, igual que siempre (nunca se escriben directo en el producto).
 */

type Row = {
  line: number; name: string; sku: string; barcode: string; category: string; description: string;
  prices: Array<number | null>; qty: number; cost: number; error?: string; exists?: string | null;
};

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  // «$ 12.500», «12,500», «12500.50»: se toman los dígitos (los decimales de pesos no importan).
  const clean = s.replace(/[^\d,.-]/g, "");
  const n = Number(/[.,]\d{1,2}$/.test(clean) ? clean.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") : clean.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function columnOf(header: string): string | null {
  const h = fold(header);
  if (/^(nombre|producto|nombre del producto|descripcion corta|articulo|name)$/.test(h)) return "name";
  if (/^(referencia|ref|sku|codigo|codigo interno|cod)$/.test(h)) return "sku";
  if (/^(codigo de barras|cod barras|barras|barcode|ean|upc)$/.test(h)) return "barcode";
  if (/^(categoria|categorias|linea|grupo|category)$/.test(h)) return "category";
  if (/^(descripcion|detalle|description)$/.test(h)) return "description";
  const p = /^precio ?([1-5])$|^p([1-5])$/.exec(h);
  if (p) return `p${p[1] ?? p[2]}`;
  if (/^(precio|precio venta|precio de venta|venta|pvp)$/.test(h)) return "price";
  if (/^(precio detal|detal|precio al detal|precio publico)$/.test(h)) return "p3";
  if (/^(precio mayor|mayor|por mayor|precio por mayor|mayorista)$/.test(h)) return "p2";
  if (/^(unidades|cantidad|stock|existencias|inventario|cant)$/.test(h)) return "qty";
  if (/^(costo|costo unitario|precio compra|precio de compra|costo unit)$/.test(h)) return "cost";
  return null;
}

function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : first.includes("\t") ? "\t" : ",";
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => String(x).trim()));
}

function toRows(table: unknown[][]): { rows: Row[]; unknown: string[] } {
  const [head = [], ...body] = table;
  const cols = head.map((h) => columnOf(String(h ?? "")));
  const unknown = head.map(String).filter((h, i) => h.trim() && !cols[i]);
  const rows = body.map((cells, idx) => {
    const get = (k: string) => { const i = cols.indexOf(k); return i >= 0 ? cells[i] : undefined; };
    const price = num(get("price"));
    const prices = [1, 2, 3, 4, 5].map((l) => num(get(`p${l}`)) ?? price);
    // Si solo viene un precio, va en los 5; si vienen algunos, los vacíos toman el detal (P3) o el primero que haya.
    const fallback = prices[2] ?? prices.find((p) => p !== null) ?? null;
    const r: Row = {
      line: idx + 2,
      name: String(get("name") ?? "").trim().toUpperCase(),
      sku: cleanProductCode(String(get("sku") ?? "")) ?? "",
      barcode: String(get("barcode") ?? "").trim(),
      category: String(get("category") ?? "").trim().toUpperCase(),
      description: String(get("description") ?? "").trim(),
      prices: prices.map((p) => p ?? fallback),
      qty: Math.max(0, Math.floor(num(get("qty")) ?? 0)),
      cost: Math.max(0, num(get("cost")) ?? 0),
    };
    if (!r.name) r.error = "Falta el nombre";
    else if (r.prices.some((p) => p !== null && p < 0)) r.error = "Precio negativo";
    else if (r.qty > 0 && !(r.cost > 0)) r.error = "Tiene unidades pero no tiene costo";
    return r;
  });
  return { rows, unknown };
}

const TEMPLATE = "nombre;referencia;codigo de barras;categoria;precio 1;precio 2;precio 3;precio 4;precio 5;unidades;costo;descripcion\r\n"
  + "PARLANTE BLUETOOTH;PB-01;7701234567890;AUDIO;79000;55000;72000;72000;72000;10;32000;Parlante portátil\r\n"
  + "CABLE USB TIPO C;CB-C1;;CABLES;12000;6000;9000;9000;9000;50;2500;\r\n";

export default function ImportProductsPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [dup, setDup] = useState<"skip" | "update">("skip");
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; is_default: boolean }>>([]);
  const [supplier, setSupplier] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const s = access?.store;
      if (!s) return setAllowed(false);
      setStoreId(s.id);
      setAllowed(hasStorePermission(access, "products"));
      const sb = supabaseBrowser();
      const [sup, wh] = await Promise.all([
        sb.from("erp_suppliers").select("id,name").eq("store_id", s.id).order("name"),
        sb.from("erp_warehouses").select("id,name,is_default").eq("store_id", s.id).eq("active", true).order("name"),
      ]);
      setSuppliers((sup.data ?? []) as typeof suppliers);
      const w = (wh.data ?? []) as typeof warehouses;
      setWarehouses(w);
      setWarehouse(w.find((x) => x.is_default)?.id ?? w[0]?.id ?? "");
    })();
  }, []);

  async function onFile(file: File) {
    setFileName(file.name);
    try {
      const table: unknown[][] = /\.(csv|txt)$/i.test(file.name) ? parseCsv(await file.text()) : ((await readSheet(file)) as unknown[][]);
      const { rows: parsed, unknown: extra } = toRows(table);
      // ¿Ya existe esa referencia o ese nombre en la tienda?
      if (storeId) {
        const sb = supabaseBrowser();
        const skus = [...new Set(parsed.map((r) => r.sku).filter(Boolean))];
        const found = new Map<string, string>();
        for (let i = 0; i < skus.length; i += 150) {
          const { data } = await sb.from("products").select("id,sku").eq("store_id", storeId).in("sku", skus.slice(i, i + 150));
          for (const p of (data ?? []) as Array<{ id: string; sku: string }>) found.set(p.sku.toUpperCase(), p.id);
        }
        const seen = new Set<string>();
        for (const r of parsed) {
          r.exists = r.sku ? found.get(r.sku.toUpperCase()) ?? null : null;
          const key = r.sku || r.name;
          if (!r.error && seen.has(key)) r.error = "Repetido en el archivo";
          seen.add(key);
        }
      }
      setRows(parsed);
      setUnknown(extra);
    } catch (e) {
      void Swal.fire({ icon: "error", title: "No se pudo leer el archivo", text: e instanceof Error ? e.message : "Usa un archivo .xlsx o .csv", background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
  }

  const ok = rows.filter((r) => !r.error);
  const withStock = ok.filter((r) => r.qty > 0);
  const toCreate = ok.filter((r) => !r.exists);
  const toUpdate = dup === "update" ? ok.filter((r) => r.exists) : [];
  const summary = useMemo(() => ({ bad: rows.length - ok.length, skip: dup === "skip" ? ok.filter((r) => r.exists).length : 0 }), [rows, ok, dup]);

  async function run() {
    if (!storeId || !ok.length) return;
    if (withStock.length && (!supplier || !warehouse)) return void Swal.fire({ icon: "warning", title: "Falta el proveedor y la bodega", text: "Las unidades entran como un ingreso de factura: elige a qué proveedor y bodega van.", background: "var(--t-bg-base)", color: "var(--t-text)" });
    const go = await Swal.fire({
      icon: "question", title: "Importar productos",
      html: `<div style="text-align:left;font-size:14px;line-height:1.7">• Crear <b>${toCreate.length}</b> producto(s)<br>• Actualizar <b>${toUpdate.length}</b><br>${summary.skip ? `• Saltar ${summary.skip} que ya existen<br>` : ""}${withStock.length ? `• Ingreso con unidades de <b>${withStock.length}</b> producto(s)<br>` : ""}${summary.bad ? `• <span style="color:#ef4444">${summary.bad} fila(s) con error no se importan</span>` : ""}</div>`,
      showCancelButton: true, confirmButtonText: "Importar", cancelButtonText: "Volver", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
    });
    if (!go.isConfirmed) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const errors: string[] = [];
    try {
      // 1. Categorías: las que no existan se crean.
      setProgress("Revisando categorías…");
      const names = [...new Set(ok.map((r) => r.category).filter(Boolean))];
      const cats = new Map<string, string>();
      if (names.length) {
        const { data } = await sb.from("product_categories").select("id,name").eq("store_id", storeId);
        for (const c of (data ?? []) as Array<{ id: string; name: string }>) cats.set(c.name.toUpperCase(), c.id);
        for (const n of names.filter((x) => !cats.has(x))) {
          const { data: c, error } = await sb.from("product_categories").insert({ store_id: storeId, name: n, active: true }).select("id,name").single();
          if (error) errors.push(`Categoría ${n}: ${error.message}`);
          else cats.set(n, (c as { id: string }).id);
        }
      }
      const payload = (r: Row) => ({
        name: r.name, description: r.description,
        ...(r.barcode ? { barcode: r.barcode } : {}),
        ...(r.category && cats.get(r.category) ? { category_id: cats.get(r.category) } : {}),
        ...Object.fromEntries(r.prices.map((p, i) => [`price_${i + 1}`, p ?? 0])),
        price_retail: r.prices[2] ?? 0, price_wholesale: r.prices[1] ?? 0,
      });
      // 2. Crear (de a 100).
      const ids = new Map<number, string>();
      for (let i = 0; i < toCreate.length; i += 100) {
        setProgress(`Creando productos ${Math.min(i + 100, toCreate.length)} de ${toCreate.length}…`);
        const chunk = toCreate.slice(i, i + 100);
        const { data, error } = await sb.from("products").insert(chunk.map((r) => ({
          store_id: storeId, ...payload(r), ...(r.sku ? { sku: r.sku } : {}), cost_price: 0, stock: 0, active: true, min_wholesale: 1,
        }))).select("id,name");
        if (error) { errors.push(`Filas ${chunk[0].line}–${chunk[chunk.length - 1].line}: ${error.message}`); continue; }
        (data ?? []).forEach((p: { id: string }, k: number) => ids.set(chunk[k].line, p.id));
      }
      // 3. Actualizar los que ya existen (si se pidió).
      for (const [k, r] of toUpdate.entries()) {
        if (k % 20 === 0) setProgress(`Actualizando ${k + 1} de ${toUpdate.length}…`);
        const { error } = await sb.from("products").update(payload(r)).eq("id", r.exists!);
        if (error) errors.push(`Fila ${r.line} (${r.name}): ${error.message}`);
        else ids.set(r.line, r.exists!);
      }
      // 4. Unidades y costo: un solo ingreso de factura (kardex y costo como siempre).
      let purchase: string | null = null;
      const items = withStock.filter((r) => ids.has(r.line)).map((r) => ({ product_id: ids.get(r.line)!, qty: r.qty, unit_cost: r.cost, warehouse_id: warehouse, tax_rate: 0 }));
      if (items.length) {
        setProgress("Registrando las unidades como ingreso…");
        const { data, error } = await sb.rpc("erp_receive_invoice", {
          p_store: storeId, p_supplier: supplier, p_invoice_ref: `IMPORTACION ${new Date().toLocaleDateString("es-CO")}`, p_invoice_date: new Date().toISOString().slice(0, 10),
          p_checked_by: "IMPORTACIÓN DESDE EXCEL", p_payment_type: "cash", p_due_date: null, p_notes: `Inventario inicial importado desde ${fileName}`, p_items: items,
        });
        if (error) errors.push(`Ingreso de unidades: ${error.message}`);
        else purchase = String(data);
      }
      setBusy(false);
      setProgress("");
      await Swal.fire({
        icon: errors.length ? "warning" : "success",
        title: errors.length ? "Importación con avisos" : "¡Productos importados!",
        html: `<div style="text-align:left;font-size:13px;line-height:1.6">Creados: <b>${[...ids.keys()].filter((l) => toCreate.some((r) => r.line === l)).length}</b> · Actualizados: <b>${toUpdate.length - errors.filter((e) => e.startsWith("Fila")).length}</b>${purchase ? "<br>Las unidades quedaron en un ingreso de factura (con su costo y kardex)." : ""}${errors.length ? `<br><br><b>Avisos:</b><br>${errors.slice(0, 12).map((e) => `• ${e.replace(/[<>&]/g, "")}`).join("<br>")}` : ""}</div>`,
        background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
      });
      if (!errors.length) { setRows([]); setFileName(""); }
    } catch (e) {
      setBusy(false);
      setProgress("");
      void Swal.fire({ icon: "error", title: "Se detuvo la importación", text: e instanceof Error ? e.message : String(e), background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
  }

  function downloadTemplate() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${TEMPLATE}`], { type: "text/csv;charset=utf-8" }));
    a.download = "plantilla-productos-remhub.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" };
  if (allowed === false) return <main className="p-6"><p className="rounded-2xl border p-4 text-sm" style={box}>🔒 Necesitas el permiso de <b>Productos</b> para importar.</p></main>;
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">📥 Importar productos desde Excel</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sube todos tus productos de una vez. Revisa la vista previa antes de importar.</p>
        </div>
        <Link href="/dashboard/products" className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>← Volver a productos</Link>
      </header>

      <section className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[1fr_auto]" style={box}>
        <div className="space-y-1 text-sm">
          <p><b>1.</b> Descarga la plantilla (o usa tu propio Excel con columnas como «nombre», «referencia», «precio», «unidades», «costo»).</p>
          <p><b>2.</b> Llénala y súbela aquí (.xlsx o .csv).</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Si solo pones un precio, se usa en los 5. Las unidades y el costo son opcionales y entran como un ingreso de factura.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadTemplate} className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Plantilla</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>📂 Elegir archivo</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        </div>
      </section>

      {rows.length ? (
        <>
          <section className="flex flex-wrap items-center gap-3 rounded-2xl border p-4 text-sm" style={box}>
            <span>📄 <b>{fileName}</b>: {rows.length} filas · <b style={{ color: "#10b981" }}>{toCreate.length} nuevas</b> · {ok.length - toCreate.length} ya existen{summary.bad ? <> · <b style={{ color: "#ef4444" }}>{summary.bad} con error</b></> : null}</span>
            <label className="flex items-center gap-2">Si la referencia ya existe:
              <select value={dup} onChange={(e) => setDup(e.target.value as "skip" | "update")} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
                <option value="skip">Saltarla</option><option value="update">Actualizar nombre y precios</option>
              </select>
            </label>
            {unknown.length ? <span className="w-full text-xs text-amber-500">Columnas que no se usan: {unknown.join(", ")}</span> : null}
          </section>
          {withStock.length ? (
            <section className="flex flex-wrap items-center gap-2 rounded-2xl border p-4 text-sm" style={box}>
              <span>📦 {withStock.length} producto(s) traen unidades. Entran como ingreso de factura de:</span>
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Proveedor">
                <option value="">Proveedor…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span>a la bodega</span>
              <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Bodega">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {!suppliers.length ? <span className="text-xs text-amber-500">Crea primero un proveedor (ej. «INVENTARIO INICIAL») en Inventario → Proveedores.</span> : null}
            </section>
          ) : null}
          <div className="overflow-x-auto rounded-2xl border" style={box}>
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>
                <th className="p-2">Fila</th><th className="p-2">Nombre</th><th className="p-2">Referencia</th><th className="p-2">Categoría</th><th className="p-2 text-right">P1</th><th className="p-2 text-right">P2</th><th className="p-2 text-right">P3</th><th className="p-2 text-right">Und.</th><th className="p-2 text-right">Costo</th><th className="p-2">Estado</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.line} className="border-t" style={{ borderColor: "var(--t-card-border)", background: r.error ? "color-mix(in oklab, #ef4444 8%, transparent)" : undefined }}>
                    <td className="p-2" style={{ color: "var(--t-muted)" }}>{r.line}</td>
                    <td className="p-2 font-semibold">{r.name || "—"}</td>
                    <td className="p-2">{r.sku || <span style={{ color: "var(--t-muted)" }}>automática</span>}</td>
                    <td className="p-2">{r.category}</td>
                    {[0, 1, 2].map((i) => <td key={i} className="p-2 text-right tabular-nums">{r.prices[i] ? `$ ${Math.round(r.prices[i]!).toLocaleString("es-CO")}` : "—"}</td>)}
                    <td className="p-2 text-right tabular-nums">{r.qty || ""}</td>
                    <td className="p-2 text-right tabular-nums">{r.cost ? `$ ${Math.round(r.cost).toLocaleString("es-CO")}` : ""}</td>
                    <td className="p-2 text-xs font-semibold">{r.error ? <span className="text-red-500">❌ {r.error}</span> : r.exists ? <span className="text-amber-500">{dup === "update" ? "↻ Se actualiza" : "⏭ Ya existe"}</span> : <span className="text-emerald-500">✓ Nuevo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 ? <p className="p-2 text-xs" style={{ color: "var(--t-muted)" }}>Se muestran 500 de {rows.length} filas; se importan todas.</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {progress ? <span className="text-sm" style={{ color: "var(--t-muted)" }}>⏳ {progress}</span> : null}
            <button type="button" onClick={() => { setRows([]); setFileName(""); }} className="rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
            <button type="button" disabled={busy || !(toCreate.length || toUpdate.length)} onClick={() => void run()} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>
              {busy ? "Importando…" : `📥 Importar ${toCreate.length + toUpdate.length} producto(s)`}
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}
