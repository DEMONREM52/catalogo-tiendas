/**
 * Leer un Excel/CSV de productos y decidir qué pasa con cada fila (crear, actualizar, saltar), sin tocar la base.
 * Lo usa «Importar productos» (src/app/dashboard/products/importar). Probado en tests/data/product-import.test.ts
 * (incluye la vuelta completa: exportar → editar → volver a subir).
 */
import { matchProduct, productChanges, type Change, type CurrentProduct, type FileValues, type UpdField } from "./product-update";

export type ImportRow = {
  line: number; id: string; name: string; sku: string; barcode: string; category: string; description: string;
  prices: Array<number | null>; qty: number; cost: number;
  /** Solo las columnas que trae el archivo (para actualizar sin tocar lo demás). */
  raw: FileValues;
  /** Error al leer o reconocer la fila (no depende del modo). */
  problem?: string;
  exists?: string | null;
};
export type ImportMode = "skip" | "update" | "update_only";
export type RowKind = "new" | "update" | "same" | "skip" | "missing" | "error";
export type RowReview = { row: ImportRow; kind: RowKind; changes: Change[]; errors: string[]; newCategory: string | null; warns?: string[] };

/** Código del producto como se guarda: sin espacios a los lados y en mayúscula (vacío = usa el número interno). */
export function cleanProductCode(value: string | null | undefined) {
  const code = (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return code ? code.slice(0, 40) : null;
}

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «$ 12.500», «12,500», «12500.50» → número (los decimales de pesos no importan). */
export function readNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const clean = s.replace(/[^\d,.-]/g, "");
  if (!/\d/.test(clean)) return null;
  const n = Number(/[.,]\d{1,2}$/.test(clean) ? clean.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") : clean.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Qué es cada encabezado (en cualquier orden, con o sin tildes). */
export function columnOf(header: string): string | null {
  const h = fold(header);
  if (/^(id remhub|id remhub no cambiar|id|id producto|id del producto)$/.test(h)) return "id";
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

export function parseCsv(text: string): string[][] {
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

const isPrice = (f: string) => /^p[1-5]$/.test(f);

/** Filas del archivo. `present`: los campos que se pueden actualizar porque el archivo trae su columna. */
export function toRows(table: unknown[][]): { rows: ImportRow[]; unknown: string[]; present: Set<UpdField>; hasId: boolean } {
  const [head = [], ...body] = table;
  const cols = head.map((h) => columnOf(String(h ?? "")));
  const unknown = head.map(String).filter((h, i) => h.trim() && !cols[i]);
  const has = (k: string) => cols.includes(k);
  const present = new Set<UpdField>();
  for (const f of ["name", "barcode", "category", "description"] as const) if (has(f)) present.add(f);
  for (const l of [1, 2, 3, 4, 5]) if (has(`p${l}`) || has("price")) present.add(`p${l}` as UpdField);
  const rows = body.map((cells, idx) => {
    const get = (k: string) => { const i = cols.indexOf(k); return i >= 0 ? cells[i] : undefined; };
    const price = readNumber(get("price"));
    const prices = [1, 2, 3, 4, 5].map((l) => readNumber(get(`p${l}`)) ?? price);
    // Crear: si solo viene un precio, va en los 5; si vienen algunos, los vacíos toman el detal (P3) o el primero que haya.
    const fallback = prices[2] ?? prices.find((p) => p !== null) ?? null;
    // Actualizar: solo lo que trae el archivo (sin rellenar). Una sola columna «Precio» cuenta para los 5 (como al crear).
    const raw: FileValues = {};
    for (const f of present) {
      const v = isPrice(f) ? (has(f) ? get(f) : get("price")) : get(f);
      raw[f] = v === undefined || v === null ? "" : v instanceof Date ? v.toISOString() : (v as string | number);
    }
    const r: ImportRow = {
      line: idx + 2,
      id: String(get("id") ?? "").trim(),
      name: String(get("name") ?? "").trim().toUpperCase(),
      sku: cleanProductCode(String(get("sku") ?? "")) ?? "",
      barcode: String(get("barcode") ?? "").trim(),
      category: String(get("category") ?? "").trim().toUpperCase(),
      description: String(get("description") ?? "").trim(),
      prices: prices.map((p) => p ?? fallback),
      qty: Math.max(0, Math.floor(readNumber(get("qty")) ?? 0)),
      cost: Math.max(0, readNumber(get("cost")) ?? 0),
      raw,
    };
    return r;
  });
  return { rows, unknown, present, hasId: has("id") };
}

/**
 * Qué producto de la tienda es cada fila (ID de RemHub → referencia → código de barras único; nunca el nombre) y
 * cuáles se repiten en el archivo. Cambia `exists` y `problem` de cada fila.
 */
export function matchRows(rows: ImportRow[], found: Iterable<CurrentProduct>) {
  const byId = new Map<string, string>(), bySku = new Map<string, string>(), byBarcode = new Map<string, string[]>();
  for (const p of found) {
    byId.set(p.id.toLowerCase(), p.id);
    if (p.sku) bySku.set(p.sku.toUpperCase(), p.id);
    if (p.barcode) byBarcode.set(p.barcode, [...(byBarcode.get(p.barcode) ?? []), p.id]);
  }
  const seen = new Map<string, number>();
  for (const r of rows) {
    const m = matchProduct({ id: r.id, sku: r.sku, barcode: r.barcode }, { byId, bySku, byBarcode });
    r.exists = m.id;
    if (m.problem) r.problem = m.problem;
    // La misma fila dos veces: la segunda no se usa (no se sabe cuál vale).
    const key = m.id ?? (r.sku || r.name);
    if (key && !r.problem) {
      if (seen.has(key)) r.problem = `Repetido en el archivo (igual que la fila ${seen.get(key)})`;
      else seen.set(key, r.line);
    }
  }
  return rows;
}

/** Lo que pasa con cada fila según el modo y los campos elegidos (no toca nada). */
export function reviewRows(rows: ImportRow[], o: { mode: ImportMode; fields: Set<UpdField>; empty: "keep" | "clear"; current: Map<string, CurrentProduct>; catName: Map<string, string> }): RowReview[] {
  return rows.map((row) => {
    const base = { row, changes: [] as Change[], errors: [] as string[], newCategory: null as string | null };
    if (row.problem) return { ...base, kind: "error", errors: [row.problem] };
    if (row.qty > 0 && !(row.cost > 0)) return { ...base, kind: "error", errors: ["Tiene unidades pero no tiene costo"] };
    if (!row.exists) {
      if (o.mode === "update_only") return { ...base, kind: "missing" };
      if (!row.name) return { ...base, kind: "error", errors: ["Falta el nombre (para crearlo)"] };
      if (row.prices.some((p) => p !== null && p < 0)) return { ...base, kind: "error", errors: ["Precio negativo"] };
      return { ...base, kind: "new", newCategory: row.category && ![...o.catName.values()].some((n) => n.toUpperCase() === row.category) ? row.category : null };
    }
    if (o.mode === "skip") return { ...base, kind: "skip" };
    const cur = o.current.get(row.exists);
    if (!cur) return { ...base, kind: "error", errors: ["No se pudo leer el producto actual"] };
    const r = productChanges(cur, row.raw, { fields: o.fields, empty: o.empty, catName: o.catName });
    if (r.errors.length) return { ...base, kind: "error", errors: r.errors, changes: r.changes };
    // La referencia solo sirve para reconocerlo: si el archivo trae otra, se avisa (no se cambia desde aquí).
    const warns = row.sku && cur.sku && row.sku.toUpperCase() !== cur.sku.toUpperCase()
      ? [`La referencia del archivo (${row.sku}) no es la del producto (${cur.sku}): se reconoció por el ID y la referencia no se cambia aquí`] : [];
    return { ...base, kind: r.changes.length ? "update" : "same", changes: r.changes, newCategory: r.newCategory, warns };
  });
}
