"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Swal from "@/lib/swal";
import { pickSheet, readTable } from "@/lib/data/read-table";
import { expectOf, updatePayload, UPD_FIELDS, type CurrentProduct, type UpdField } from "@/lib/data/product-update";
import { matchRows, parseCsv, reviewRows, toRows, UUID_RE, type ImportMode as Mode, type ImportRow as Row, type RowKind as Kind } from "@/lib/data/product-import";
import { mapLimit } from "@/lib/net/map-limit";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";

/**
 * Importar o actualizar productos desde Excel (.xlsx) o CSV.
 * Columnas reconocidas (en cualquier orden, con o sin tildes): ID RemHub, nombre, referencia, código de barras, categoría,
 * descripción, precio 1…5 (o «precio», «precio detal», «precio mayor»), unidades y costo.
 *
 * Crear: como siempre. Actualizar (Data Studio §22): el producto se reconoce por su ID de RemHub, luego por la referencia
 * y luego por el código de barras (nunca por el nombre); se muestra campo por campo el antes y el después, solo cambian
 * los campos elegidos, una celda vacía conserva el valor (salvo que se pida dejarla vacía) y la base vuelve a revisar
 * al aplicar (products_bulk_update, migración 20261353): si alguien cambió el producto mientras tanto, no lo pisa.
 * Las unidades y el costo entran como un ingreso de factura (kardex y costo como siempre; nunca directo al producto).
 */

type Outcome = { updated: number; same: number; conflicts: Array<{ id: string; name?: string; fields: string }>; errors: Array<{ id: string; name?: string; error: string }>; created: number; notes: string[] };

const PRODUCT_COLS = "id,name,sku,barcode,category_id,description,price_1,price_2,price_3,price_4,price_5";
const cop = (v: unknown) => (v === null || v === undefined || v === "" ? "(vacío)" : typeof v === "number" ? `$ ${Math.round(v).toLocaleString("es-CO")}` : String(v));
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const fieldLabel = (f: string) => UPD_FIELDS.find((x) => x.key === f)?.label ?? f;
const dbFieldLabel = (f: string) => ({ name: "nombre", barcode: "código de barras", category_id: "categoría", description: "descripción" } as Record<string, string>)[f] ?? f.replace("price_", "precio ");

export default function ImportProductsPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canPrices, setCanPrices] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [present, setPresent] = useState<Set<UpdField>>(new Set());
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<Mode>("skip");
  const [fields, setFields] = useState<Set<UpdField>>(new Set());
  const [empty, setEmpty] = useState<"keep" | "clear">("keep");
  const [current, setCurrent] = useState<Map<string, CurrentProduct>>(new Map());
  const [catName, setCatName] = useState<Map<string, string>>(new Map());
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; is_default: boolean }>>([]);
  const [supplier, setSupplier] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Llave del envío: un reintento (doble clic, se cayó la red) no aplica dos veces. Cambia después de cada envío. */
  const keyRef = useRef(newKey());

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const s = access?.store;
      if (!s) return setAllowed(false);
      setStoreId(s.id);
      setStoreName(String((s as { name?: string }).name ?? ""));
      setAllowed(hasStorePermission(access, "products") && hasStorePermission(access, "products_import"));
      setCanPrices(hasStorePermission(access, "products_prices"));
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

  /** Las categorías de la tienda (id → nombre), de a 1.000. */
  async function loadCategories(store: string) {
    const sb = supabaseBrowser();
    const out = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("product_categories").select("id,name").eq("store_id", store).order("name").range(from, from + 999);
      if (error) throw error;
      for (const c of (data ?? []) as Array<{ id: string; name: string }>) out.set(c.id, c.name);
      if ((data ?? []).length < 1000) break;
    }
    return out;
  }

  /** Lee de la base los productos que el archivo nombra (por ID, referencia o código de barras), en paralelo y de a 150. */
  async function loadCurrent(store: string, parsed: Row[]) {
    const sb = supabaseBrowser();
    const ids = [...new Set(parsed.map((r) => r.id.toLowerCase()).filter((x) => UUID_RE.test(x)))];
    const skus = [...new Set(parsed.map((r) => r.sku).filter(Boolean))];
    const codes = [...new Set(parsed.map((r) => r.barcode).filter(Boolean))];
    const jobs: Array<{ col: "id" | "sku" | "barcode"; values: string[] }> = [];
    for (const [col, list] of [["id", ids], ["sku", skus], ["barcode", codes]] as const) {
      for (let i = 0; i < list.length; i += 150) jobs.push({ col, values: list.slice(i, i + 150) });
    }
    const res = await mapLimit(jobs, 4, async (j) => {
      const { data, error } = await sb.from("products").select(PRODUCT_COLS).eq("store_id", store).in(j.col, j.values);
      if (error) throw error;
      return (data ?? []) as unknown as CurrentProduct[];
    });
    const found = new Map<string, CurrentProduct>();
    for (const r of res) {
      if (!r.ok) throw r.error;
      for (const p of r.value) found.set(p.id, p);
    }
    return found;
  }

  async function onFile(file: File) {
    if (!storeId) return;
    setFileName(file.name);
    setOutcome(null);
    try {
      // Libro con varias hojas (p. ej. con la portada «Resumen» de RemHub): se toma la de productos, no la primera.
      const book = /\.(csv|txt)$/i.test(file.name) ? null : await readTable(file);
      const table: unknown[][] = book
        ? (book[pickSheet(book, { name: "Productos", known: ["id remhub", "nombre", "referencia", "sku", "codigo", "precio", "precio 3", "categoria"] })]?.rows ?? [])
        : parseCsv(await file.text());
      const { rows: parsed, unknown: extra, present: cols, hasId } = toRows(table);
      const [found, cats] = await Promise.all([loadCurrent(storeId, parsed), loadCategories(storeId)]);
      matchRows(parsed, found.values());
      setRows(parsed);
      setUnknown(extra);
      setPresent(cols);
      setCurrent(found);
      setCatName(cats);
      // Un archivo exportado de RemHub (con su ID) es para actualizar: por defecto no crea productos nuevos.
      setMode(hasId ? "update_only" : "skip");
      setFields(new Set([...cols].filter((f) => canPrices || !f.startsWith("p") || f.length !== 2)));
      setEmpty("keep");
      keyRef.current = newKey();
    } catch (e) {
      void Swal.fire({ icon: "error", title: "No se pudo leer el archivo", text: e instanceof Error ? e.message : "Usa un archivo .xlsx o .csv", background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
  }

  const review = useMemo(() => reviewRows(rows, { mode, fields, empty, current, catName }), [rows, mode, fields, empty, current, catName]);
  const count = useMemo(() => {
    const c: Record<Kind, number> = { new: 0, update: 0, same: 0, skip: 0, missing: 0, error: 0 };
    for (const r of review) c[r.kind]++;
    return c;
  }, [review]);
  const changesByField = useMemo(() => {
    const m = new Map<UpdField, number>();
    for (const r of review) if (r.kind === "update") for (const c of r.changes) m.set(c.field, (m.get(c.field) ?? 0) + 1);
    return m;
  }, [review]);
  const withStock = review.filter((r) => (r.kind === "new" || ((r.kind === "update" || r.kind === "same") && mode !== "skip")) && r.row.qty > 0);
  const shown = onlyChanges && mode !== "skip" ? review.filter((r) => r.kind !== "same") : review;

  function toggleField(f: UpdField) {
    setFields((prev) => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  }

  async function downloadReview() {
    const { downloadXlsx } = await import("@/lib/data/xlsx");
    const state: Record<Kind, string> = { new: "Nuevo", update: "Cambia", same: "Sin cambios", skip: "Se salta (ya existe)", missing: "No está en la tienda (no se crea)", error: "Error" };
    const lines: Array<Array<string | number | null>> = [];
    for (const r of review) {
      const cur = r.row.exists ? current.get(r.row.exists) : undefined;
      const base = [r.row.line, r.row.exists ?? "", cur?.sku ?? r.row.sku, cur?.name ?? r.row.name, state[r.kind]];
      const detail = [...r.errors, ...(r.warns ?? [])].join(" · ");
      if (r.changes.length) for (const c of r.changes) lines.push([...base, fieldLabel(c.field), c.before ?? "", c.after ?? "", detail]);
      else lines.push([...base, "", "", "", detail]);
    }
    await downloadXlsx(`revision-productos-${new Date().toISOString().slice(0, 10)}.xlsx`, {
      meta: {
        company: storeName, title: "Revisión de productos desde Excel", subtitle: "Lo que pasaría al aplicar (todavía no se ha cambiado nada)",
        filters: [["Archivo", fileName], ["Modo", mode === "skip" ? "Crear nuevos y saltar los que existen" : mode === "update" ? "Crear nuevos y actualizar los que existen" : "Solo actualizar"],
          ["Campos", [...fields].map(fieldLabel).join(", ") || "—"], ["Celda vacía", empty === "keep" ? "Conserva el valor actual" : "Deja el campo vacío"]],
        kpis: [{ label: "Nuevos", value: count.new, type: "int" }, { label: "Con cambios", value: count.update, type: "int" }, { label: "Sin cambios", value: count.same, type: "int" }, { label: "Con error", value: count.error, type: "int" }],
      },
      sheets: [{
        name: "Revisión", head: ["Fila", "ID RemHub", "Referencia", "Producto", "Estado", "Campo", "Antes", "Después", "Detalle"], rows: lines,
        columns: [undefined, { type: "code" }, { type: "code" }, undefined, { cond: [{ when: "contains", value: "Error", tone: "bad" }, { when: "contains", value: "Cambia", tone: "info" }] }],
      }],
    });
  }

  async function run() {
    if (!storeId || busy) return;
    const toCreate = review.filter((r) => r.kind === "new");
    const toUpdate = review.filter((r) => r.kind === "update");
    if (!toCreate.length && !toUpdate.length && !withStock.length) return;
    if (withStock.length && (!supplier || !warehouse)) return void Swal.fire({ icon: "warning", title: "Falta el proveedor y la bodega", text: "Las unidades entran como un ingreso de factura: elige a qué proveedor y bodega van.", background: "var(--t-bg-base)", color: "var(--t-text)" });
    const fieldsLine = [...changesByField.entries()].map(([f, n]) => `${fieldLabel(f)} (${n})`).join(", ");
    const go = await Swal.fire({
      icon: "question", title: toUpdate.length ? "¿Aplicar los cambios?" : "Importar productos",
      html: `<div style="text-align:left;font-size:14px;line-height:1.7">${toCreate.length ? `• Crear <b>${toCreate.length}</b> producto(s)<br>` : ""}${toUpdate.length ? `• Cambiar <b>${toUpdate.length}</b> producto(s): ${fieldsLine.replace(/[<>&]/g, "")}<br>` : ""}${count.same ? `• ${count.same} sin cambios (no se tocan)<br>` : ""}${count.skip ? `• Saltar ${count.skip} que ya existen<br>` : ""}${count.missing ? `• ${count.missing} no están en la tienda (no se crean)<br>` : ""}${withStock.length ? `• Ingreso con unidades de <b>${withStock.length}</b> producto(s)<br>` : ""}${count.error ? `• <span style="color:#ef4444">${count.error} fila(s) con error no se usan</span><br>` : ""}<br><span style="font-size:12px;opacity:.8">Si alguien cambia uno de estos productos antes de aplicar, ese no se toca y te avisamos.</span></div>`,
      showCancelButton: true, confirmButtonText: toUpdate.length ? "Sí, aplicar" : "Importar", cancelButtonText: "Volver", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
    });
    if (!go.isConfirmed) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const notes: string[] = [];
    const result: Outcome = { updated: 0, same: 0, conflicts: [], errors: [], created: 0, notes };
    const key = keyRef.current;
    try {
      // 1. Categorías: las que no existan se crean.
      const cats = new Map<string, string>([...catName.entries()].map(([id, n]) => [n.toUpperCase(), id]));
      const wanted = [...new Set([
        ...toCreate.map((r) => r.row.category).filter(Boolean),
        ...toUpdate.flatMap((r) => r.changes.filter((c) => c.field === "category" && c.after !== null).map((c) => String(c.after))),
      ])].filter((n) => !cats.has(n));
      if (wanted.length) {
        setProgress("Creando categorías…");
        const made = await mapLimit(wanted, 3, async (n) => {
          const { data, error } = await sb.from("product_categories").insert({ store_id: storeId, name: n, active: true }).select("id").single();
          if (error) throw new Error(`Categoría ${n}: ${error.message}`);
          return [n, (data as { id: string }).id] as const;
        });
        for (const m of made) if (m.ok) cats.set(m.value[0], m.value[1]); else notes.push(m.error instanceof Error ? m.error.message : String(m.error));
      }
      const ids = new Map<number, string>();

      // 2. Crear (de a 100).
      for (let i = 0; i < toCreate.length; i += 100) {
        setProgress(`Creando productos ${Math.min(i + 100, toCreate.length)} de ${toCreate.length}…`);
        const chunk = toCreate.slice(i, i + 100).map((r) => r.row);
        const { data, error } = await sb.from("products").insert(chunk.map((r) => ({
          store_id: storeId, name: r.name, description: r.description,
          ...(r.barcode ? { barcode: r.barcode } : {}),
          ...(r.category && cats.get(r.category) ? { category_id: cats.get(r.category) } : {}),
          ...Object.fromEntries(r.prices.map((p, k) => [`price_${k + 1}`, p ?? 0])),
          price_retail: r.prices[2] ?? 0, price_wholesale: r.prices[1] ?? 0,
          ...(r.sku ? { sku: r.sku } : {}), cost_price: 0, stock: 0, active: true, min_wholesale: 1,
        }))).select("id");
        if (error) { notes.push(`Filas ${chunk[0].line}–${chunk[chunk.length - 1].line}: ${error.message}`); continue; }
        (data ?? []).forEach((p: { id: string }, k: number) => ids.set(chunk[k].line, p.id));
        result.created += (data ?? []).length;
      }

      // 3. Actualizar: solo lo revisado, en la base y de a 500 (la base revisa otra vez y no pisa cambios ajenos).
      const payload = toUpdate.map((r) => {
        const cur = current.get(r.row.exists!)!;
        const set = updatePayload(r.changes, (n) => cats.get(n.toUpperCase()) ?? null);
        // Una categoría que no se pudo crear no se manda (el resto de la fila sí).
        if ("category_id" in set && set.category_id === null && r.changes.some((c) => c.field === "category" && c.after !== null)) delete set.category_id;
        const expect = expectOf(cur, r.changes);
        return { id: cur.id, set, expect, line: r.row.line };
      }).filter((p) => Object.keys(p.set).length);
      const chunks: Array<typeof payload> = [];
      for (let i = 0; i < payload.length; i += 500) chunks.push(payload.slice(i, i + 500));
      if (chunks.length) setProgress(`Aplicando cambios a ${payload.length} producto(s)…`);
      const sent = await mapLimit(chunks, 2, async (c, i) => {
        const { data, error } = await sb.rpc("products_bulk_update", { p_store: storeId, p_key: `${key}:${i}`, p_file: fileName, p_rows: c.map(({ id, set, expect }) => ({ id, set, expect })) });
        if (error) throw new Error(/Could not find the function|schema cache/i.test(error.message) ? "Falta correr en Supabase la migración 20261353_actualizar_productos_excel.sql." : error.message);
        return data as Omit<Outcome, "created" | "notes">;
      });
      for (const [i, s] of sent.entries()) {
        if (!s.ok) { notes.push(s.error instanceof Error ? s.error.message : String(s.error)); continue; }
        result.updated += s.value.updated; result.same += s.value.same;
        result.conflicts.push(...s.value.conflicts); result.errors.push(...s.value.errors);
        const bad = new Set([...s.value.conflicts, ...s.value.errors].map((x) => x.id));
        for (const p of chunks[i]) if (!bad.has(p.id)) ids.set(p.line, p.id);
      }
      // Los que ya estaban iguales también reciben sus unidades.
      for (const r of review) if (r.kind === "same" && mode !== "skip" && r.row.exists) ids.set(r.row.line, r.row.exists);

      // 4. Unidades y costo: un solo ingreso de factura (kardex y costo como siempre).
      const stocked = withStock.filter((r) => ids.has(r.row.line));
      const items = stocked.map((r) => ({ product_id: ids.get(r.row.line)!, qty: r.row.qty, unit_cost: r.row.cost, warehouse_id: warehouse, tax_rate: 0 }));
      const ingested = new Set<number>();
      if (items.length) {
        setProgress("Registrando las unidades como ingreso…");
        const { error } = await sb.rpc("erp_receive_invoice", {
          p_store: storeId, p_supplier: supplier, p_invoice_ref: `IMPORTACION ${new Date().toLocaleDateString("es-CO")}`, p_invoice_date: new Date().toISOString().slice(0, 10),
          p_checked_by: "IMPORTACIÓN DESDE EXCEL", p_payment_type: "cash", p_due_date: null, p_notes: `Unidades importadas desde ${fileName}`, p_items: items,
        });
        if (error) notes.push(`Ingreso de unidades: ${error.message}`);
        else { notes.push("Las unidades quedaron en un ingreso de factura (con su costo y kardex)."); for (const r of stocked) ingested.add(r.row.line); }
      }
      // Lo ya creado o ya ingresado sale de la revisión: volver a aplicar nunca lo repite.
      const created = new Set(toCreate.filter((r) => ids.has(r.row.line)).map((r) => r.row.line));
      setRows((prev) => prev.filter((r) => !created.has(r.line)).map((r) => (ingested.has(r.line) ? { ...r, qty: 0, cost: 0 } : r)));
      keyRef.current = newKey();
      setOutcome(result);
      const problems = result.conflicts.length + result.errors.length + notes.filter((n) => !n.startsWith("Las unidades")).length;
      await Swal.fire({
        icon: problems ? "warning" : "success",
        title: problems ? "Listo, con avisos" : "¡Listo!",
        html: `<div style="text-align:left;font-size:13px;line-height:1.6">${result.created ? `Creados: <b>${result.created}</b><br>` : ""}${payload.length ? `Actualizados: <b>${result.updated}</b>${result.same ? ` · ya estaban así: ${result.same}` : ""}<br>` : ""}${result.conflicts.length ? `<b style="color:#f59e0b">${result.conflicts.length} cambiaron mientras revisabas</b> y no se tocaron: vuelve a revisar.<br>` : ""}${result.errors.length ? `<b style="color:#ef4444">${result.errors.length} con error</b> (abajo dice por qué).<br>` : ""}${notes.length ? `<br>${notes.slice(0, 8).map((e) => `• ${e.replace(/[<>&]/g, "")}`).join("<br>")}` : ""}</div>`,
        background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
      });
      if (!problems) { setRows([]); setFileName(""); }
      else {
        // Vuelve a leer lo actual: la revisión muestra lo que falta contra los valores de ahora.
        const fresh = await loadCurrent(storeId, rows).catch(() => null);
        if (fresh) setCurrent(fresh);
        setCatName(await loadCategories(storeId).catch(() => catName));
      }
    } catch (e) {
      void Swal.fire({ icon: "error", title: "Se detuvo", text: e instanceof Error ? e.message : String(e), background: "var(--t-bg-base)", color: "var(--t-text)" });
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function downloadTemplate() {
    const { downloadXlsx } = await import("@/lib/data/xlsx");
    await downloadXlsx("plantilla-productos-remhub.xlsx", [
      {
        name: "Productos",
        head: ["Nombre", "Referencia", "Código de barras", "Categoría", "Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5", "Unidades", "Costo", "Descripción"],
        rows: [
          ["PARLANTE BLUETOOTH", "PB-01", "7701234567890", "AUDIO", 79000, 55000, 72000, 72000, 72000, 10, 32000, "Parlante portátil"],
          ["CABLE USB TIPO C", "CB-C1", "", "CABLES", 12000, 6000, 9000, 9000, 9000, 50, 2500, ""],
        ],
        totals: false,
      },
      {
        name: "Instrucciones", head: ["Columna", "Qué va", "Obligatoria"], table: false,
        rows: [
          ["Nombre", "Nombre del producto (se guarda en MAYÚSCULA).", "Sí, para crear"],
          ["Referencia", "Tu código interno. Si ya existe en la tienda, el producto se reconoce por aquí.", "No (si falta, RemHub pone uno)"],
          ["Código de barras", "El del empaque. Se escribe como texto: no pierde los ceros.", "No"],
          ["Categoría", "Si no existe, se crea.", "No"],
          ["Precio 1 a Precio 5", "Precio 3 = detal, Precio 2 = por mayor. Si solo pones una columna «Precio», va en los 5 al crear.", "No"],
          ["Unidades y Costo", "Entran como un ingreso de factura (con kardex). Si pones unidades, el costo es obligatorio.", "No"],
          ["Descripción", "Texto libre.", "No"],
          ["ID RemHub", "Viene en «Importar y exportar → Productos». No lo cambies: con él se actualiza el producto exacto.", "Solo para actualizar"],
          ["Actualizar precios", "Exporta tus productos, cambia los precios en Excel y vuelve a subir el archivo aquí: ves antes y después y eliges qué aplicar.", ""],
        ],
      },
    ]);
  }

  const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" };
  const sel = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" };
  if (allowed === false) return <main className="p-6"><p className="rounded-2xl border p-4 text-sm" style={box}>🔒 Necesitas los permisos de <b>Editar productos</b> e <b>Importar productos</b>.</p></main>;
  const actionable = count.new + count.update + withStock.length;
  const tones: Record<Kind, string> = { new: "#10b981", update: "#3b82f6", same: "var(--t-muted)", skip: "#f59e0b", missing: "#f59e0b", error: "#ef4444" };
  const stateText: Record<Kind, string> = { new: "✓ Nuevo", update: "↻ Cambia", same: "= Sin cambios", skip: "⏭ Ya existe", missing: "⏭ No está (no se crea)", error: "❌ Error" };
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">📥 Importar o actualizar productos desde Excel</h1>
          <p className="hidden sm:block text-sm" style={{ color: "var(--t-muted)" }}>Crea productos nuevos o cambia precios y datos de muchos a la vez. Nada se cambia sin que veas antes y después.</p>
        </div>
        <Link href="/dashboard/products" className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>← Volver a productos</Link>
      </header>

      <section className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[1fr_auto]" style={box}>
        <div className="space-y-1 text-sm">
          <p><b>Crear:</b> descarga la plantilla, llénala y súbela.</p>
          <p><b>Actualizar:</b> exporta tus productos en <Link href="/dashboard/datos" className="font-semibold underline">Importar y exportar</Link>, cambia lo que quieras en Excel y súbelo aquí.</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>El producto se reconoce por su ID de RemHub, la referencia o el código de barras (nunca por el nombre). Las unidades y el costo entran como un ingreso de factura.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void downloadTemplate()} className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Plantilla</button>
          <button type="button" disabled={!storeId} onClick={() => fileRef.current?.click()} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>📂 Elegir archivo</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        </div>
      </section>

      {rows.length ? (
        <>
          <section className="space-y-3 rounded-2xl border p-4 text-sm" style={box}>
            <p>📄 <b>{fileName}</b>: {rows.length} filas</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(["new", "update", "same", "skip", "missing", "error"] as Kind[]).filter((k) => count[k] || k === "update" || k === "new").map((k) => (
                <div key={k} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                  <p className="text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>{({ new: "Nuevos", update: "Con cambios", same: "Sin cambios", skip: "Se saltan", missing: "No están", error: "Con error" } as Record<Kind, string>)[k]}</p>
                  <p className="text-xl font-black tabular-nums" style={{ color: tones[k] }}>{count[k].toLocaleString("es-CO")}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">Si el producto ya existe:
                <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="rounded-lg border px-2 py-1" style={sel}>
                  <option value="skip">Saltarlo (solo crear nuevos)</option>
                  <option value="update">Actualizarlo (y crear los nuevos)</option>
                  <option value="update_only">Solo actualizar (no crear nuevos)</option>
                </select>
              </label>
              {mode !== "skip" ? (
                <label className="flex items-center gap-2">Celda vacía:
                  <select value={empty} onChange={(e) => setEmpty(e.target.value as "keep" | "clear")} className="rounded-lg border px-2 py-1" style={sel}>
                    <option value="keep">Conservar el valor actual (recomendado)</option>
                    <option value="clear">Dejar el campo vacío</option>
                  </select>
                </label>
              ) : null}
            </div>
            {mode !== "skip" ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Qué campos actualizar (lo que no marques no se toca):</p>
                <div className="flex flex-wrap gap-2">
                  {UPD_FIELDS.filter((f) => present.has(f.key)).map((f) => {
                    const locked = f.key.startsWith("p") && f.key.length === 2 && !canPrices;
                    return (
                      <label key={f.key} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--t-card-border)", opacity: locked ? 0.5 : 1 }} title={locked ? "Necesitas el permiso «Cambiar precios»" : undefined}>
                        <input type="checkbox" checked={fields.has(f.key)} disabled={locked} onChange={() => toggleField(f.key)} />
                        {f.label}{changesByField.get(f.key) ? <b className="tabular-nums" style={{ color: "#3b82f6" }}>· {changesByField.get(f.key)}</b> : null}{locked ? " 🔒" : ""}
                      </label>
                    );
                  })}
                  {!present.size ? <span className="text-xs text-amber-500">El archivo no trae columnas para actualizar.</span> : null}
                </div>
                {empty === "clear" ? <p className="text-xs text-amber-500">Una celda vacía borra el código de barras, la categoría o la descripción. El nombre y los precios nunca se borran.</p> : null}
              </div>
            ) : null}
            {unknown.length ? <p className="text-xs text-amber-500">Columnas que no se usan: {unknown.join(", ")}</p> : null}
          </section>

          {withStock.length ? (
            <section className="flex flex-wrap items-center gap-2 rounded-2xl border p-4 text-sm" style={box}>
              <span>📦 {withStock.length} producto(s) traen unidades. Entran como ingreso de factura de:</span>
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="rounded-lg border px-2 py-1.5" style={sel} aria-label="Proveedor">
                <option value="">Proveedor…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span>a la bodega</span>
              <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="rounded-lg border px-2 py-1.5" style={sel} aria-label="Bodega">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {!suppliers.length ? <span className="text-xs text-amber-500">Crea primero un proveedor (ej. «INVENTARIO INICIAL») en Inventario → Proveedores.</span> : null}
            </section>
          ) : null}

          {outcome && (outcome.conflicts.length || outcome.errors.length) ? (
            <section className="space-y-1 rounded-2xl border p-4 text-sm" style={{ ...box, borderColor: "#f59e0b" }}>
              <p className="font-bold">Lo que no se aplicó</p>
              {outcome.conflicts.slice(0, 50).map((c) => <p key={`c${c.id}`} className="text-xs">⚠️ <b>{c.name ?? c.id}</b>: alguien cambió {c.fields.split(",").map(dbFieldLabel).join(", ")} mientras revisabas. La revisión de abajo ya muestra el valor de ahora.</p>)}
              {outcome.errors.slice(0, 50).map((e, i) => <p key={`e${i}`} className="text-xs text-red-500">❌ <b>{e.name ?? e.id}</b>: {e.error}</p>)}
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            {mode !== "skip" ? <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Ocultar los que no cambian</label> : <span />}
            <button type="button" onClick={() => void downloadReview()} className="rounded-lg border px-2.5 py-1.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Revisión en Excel</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border" style={box}>
            <table className="rt w-full min-w-[760px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>
                <th className="p-2">Fila</th><th className="p-2">Producto</th><th className="p-2">Referencia</th><th className="p-2">Qué pasa</th><th className="p-2">Antes → después</th><th className="p-2 text-right">Und.</th>
              </tr></thead>
              <tbody>
                {shown.slice(0, 500).map(({ row: r, kind, changes, errors, newCategory, warns }) => {
                  const cur = r.exists ? current.get(r.exists) : undefined;
                  return (
                    <tr key={r.line} className="border-t align-top" style={{ borderColor: "var(--t-card-border)", background: kind === "error" ? "color-mix(in oklab, #ef4444 8%, transparent)" : undefined }}>
                      <td className="p-2" style={{ color: "var(--t-muted)" }}>{r.line}</td>
                      <td className="p-2 font-semibold">{cur?.name ?? (r.name || "—")}</td>
                      <td className="p-2">{cur?.sku ?? (r.sku || <span style={{ color: "var(--t-muted)" }}>automática</span>)}</td>
                      <td className="p-2 text-xs font-semibold" style={{ color: tones[kind] }}>{stateText[kind]}</td>
                      <td className="p-2 text-xs">
                        {kind === "new" ? <span style={{ color: "var(--t-muted)" }}>{[r.category, ...r.prices.slice(0, 3).map((p, i) => (p ? `P${i + 1} ${cop(p)}` : ""))].filter(Boolean).join(" · ")}{newCategory ? " · categoría nueva" : ""}</span> : null}
                        {changes.map((c) => (
                          <p key={c.field}><span style={{ color: "var(--t-muted)" }}>{fieldLabel(c.field)}:</span> <s style={{ color: "var(--t-muted)" }}>{cop(c.before)}</s> → <b>{cop(c.after)}</b>{c.field === "category" && newCategory ? " (nueva)" : ""}</p>
                        ))}
                        {errors.map((e) => <p key={e} className="text-red-500">{e}</p>)}
                        {warns?.map((w) => <p key={w} className="text-amber-500">{w}</p>)}
                      </td>
                      <td className="p-2 text-right tabular-nums">{r.qty || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 500 ? <p className="p-2 text-xs" style={{ color: "var(--t-muted)" }}>Se muestran 500 de {shown.length} filas; se aplican todas. Descarga la revisión en Excel para verlas todas.</p> : null}
            {!shown.length ? <p className="p-4 text-sm" style={{ color: "var(--t-muted)" }}>Nada cambia con estos campos.</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {progress ? <span className="text-sm" style={{ color: "var(--t-muted)" }}>⏳ {progress}</span> : null}
            <button type="button" disabled={busy} onClick={() => { setRows([]); setFileName(""); setOutcome(null); }} className="rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
            <button type="button" disabled={busy || !actionable} onClick={() => void run()} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>
              {busy ? "Aplicando…" : count.update ? `✅ Aplicar: ${count.new ? `crear ${count.new} y ` : ""}cambiar ${count.update}` : `📥 Importar ${count.new} producto(s)`}
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}
