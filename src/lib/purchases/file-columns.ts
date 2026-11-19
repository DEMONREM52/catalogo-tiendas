/**
 * Leer una factura o remisión en Excel/CSV: qué fila es el encabezado, qué columna es cada cosa y las líneas.
 * (Sin React ni base de datos, para poder probarlo.)
 */
import { fold, toNumber } from "@/lib/data/read-table";

/** Código como se guarda en el producto (igual que cleanProductCode). */
const cleanCode = (v: string) => { const c = v.trim().replace(/s+/g, " ").toUpperCase(); return c ? c.slice(0, 40) : ""; };

export type Field = "code" | "description" | "qty" | "cost" | "total" | "tax";
export const FIELDS: Array<{ key: Field; label: string; need?: boolean }> = [
  { key: "code", label: "Código" }, { key: "description", label: "Descripción" }, { key: "qty", label: "Cantidad", need: true },
  { key: "cost", label: "Costo unitario" }, { key: "total", label: "Total de la línea" }, { key: "tax", label: "IVA %" },
];
// Palabras de los encabezados (sin tildes), de la más segura a la menos.
const KEYS: Record<Field, string[]> = {
  code: ["codigo", "cod", "referencia", "ref", "sku", "item", "codigo producto", "cod producto", "plu"],
  description: ["descripcion", "producto", "nombre", "articulo", "detalle", "concepto", "nombre producto"],
  qty: ["cantidad", "cant", "unidades", "und", "uds", "qty", "cantidades"],
  cost: ["costo", "costo unitario", "valor unitario", "vr unitario", "vlr unitario", "precio unitario", "v unitario", "unitario", "precio", "valor"],
  total: ["total", "valor total", "vr total", "vlr total", "subtotal", "importe", "total linea"],
  tax: ["iva", "iva %", "impuesto", "porcentaje iva"],
};

function scoreHeader(field: Field, h: string) {
  if (!h) return 0;
  if (field === "cost" && /total|importe|subtotal/.test(h)) return 0;
  if (field === "total" && !/total|importe/.test(h)) return 0;
  if (field === "code" && /barra/.test(h)) return 0;
  let best = 0;
  KEYS[field].forEach((k, i) => {
    const w = KEYS[field].length - i;
    if (h === k) best = Math.max(best, 300 + w);
    else if (h.startsWith(k + " ") || h.endsWith(" " + k)) best = Math.max(best, 200 + w);
    else if (k.length >= 4 && h.includes(k)) best = Math.max(best, 100 + w);
  });
  return best;
}

/** Fila de encabezados (entre las primeras 20) y qué columna es cada cosa. */
export function detect(rows: unknown[][]): { header: number; map: Record<Field, number> } {
  let header = 0, bestHits = -1;
  rows.slice(0, 20).forEach((r, i) => {
    const hits = (["code", "description", "qty", "cost", "total"] as Field[]).filter((f) => r.some((c) => scoreHeader(f, fold(c)) > 0)).length;
    if (hits > bestHits) { bestHits = hits; header = i; }
  });
  const heads = (rows[header] ?? []).map((c) => fold(c));
  const map = { code: -1, description: -1, qty: -1, cost: -1, total: -1, tax: -1 } as Record<Field, number>;
  const used = new Set<number>();
  for (const f of ["qty", "total", "cost", "code", "description", "tax"] as Field[]) {
    let col = -1, score = 0;
    heads.forEach((h, i) => { const s = scoreHeader(f, h); if (s > score && !used.has(i)) { score = s; col = i; } });
    if (col >= 0) { map[f] = col; used.add(col); }
  }
  return { header, map };
}

export const cellText = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : String(v ?? "").trim());

export type FileLine = { row: number; code: string; description: string; qty: number; qtyRounded: boolean; cost: number; fileTotal: number | null; tax: number | null };
export function parseLines(rows: unknown[][], header: number, map: Record<Field, number>): FileLine[] {
  const out: FileLine[] = [];
  rows.slice(header + 1).forEach((r, i) => {
    const get = (f: Field) => (map[f] >= 0 ? r[map[f]] : null);
    const code = cleanCode(cellText(get("code")));
    const description = cellText(get("description")).replace(/\s+/g, " ").slice(0, 160);
    const qtyRaw = toNumber(get("qty"));
    if (!qtyRaw || qtyRaw <= 0 || (!code && !description)) return;
    // Filas de totales al final de la hoja.
    if (!code && /^(sub ?total|total|iva|descuento|neto|valor a pagar)\b/.test(fold(description))) return;
    const fileTotal = toNumber(get("total"));
    const unit = toNumber(get("cost"));
    const qty = Math.round(qtyRaw);
    const cost = unit !== null && unit >= 0 ? unit : fileTotal !== null ? Math.round((fileTotal / qtyRaw) * 100) / 100 : 0;
    const taxN = toNumber(get("tax"));
    out.push({ row: header + 2 + i, code, description, qty, qtyRounded: qty !== qtyRaw, cost, fileTotal, tax: taxN !== null && taxN >= 0 && taxN <= 100 ? taxN : null });
  });
  return out;
}
