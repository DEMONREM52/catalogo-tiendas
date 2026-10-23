/**
 * Leer un Excel (.xlsx) o CSV subido por el usuario: devuelve cada hoja como filas de celdas.
 * Los CSV se aceptan con ; , o tabulador (Excel en español guarda con ;).
 */
import readXlsxFile from "read-excel-file/browser";

export type TableSheet = { name: string; rows: unknown[][] };

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : first.includes("\t") ? "\t" : ",";
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) { if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && clean[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => String(x).trim()));
}

export async function readTable(file: File): Promise<TableSheet[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return [{ name: file.name, rows: parseCsv(await file.text()) }];
  if (name.endsWith(".xls")) throw new Error("Ese archivo es del formato viejo (.xls). Ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)» o como CSV.");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, rows: (s.data as unknown[][]).filter((r) => r.some((x) => x !== null && String(x).trim() !== "")) }));
}

/** Texto sin tildes ni mayúsculas, para comparar encabezados y nombres. */
export const fold = (t: unknown) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Número de un texto como «$ 12.500», «12,500» o «12500.50» (pesos: los puntos de miles se quitan). */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const clean = s.replace(/[^\d,.-]/g, "");
  if (!clean || clean === "-") return null;
  const n = Number(/[.,]\d{1,2}$/.test(clean) ? clean.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") : clean.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Fecha DD/MM/AAAA (o AAAA-MM-DD, o fecha de Excel) → AAAA-MM-DD. null si está vacía; "x" si no se entiende. */
export function toIsoDate(v: unknown): string | null | "x" {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCDate() === d && dt.getUTCMonth() === mo - 1 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "x";
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "x";
}

/** Sí / No → boolean (null si está vacío). */
export function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const f = fold(v);
  if (!f) return null;
  if (/^(si|s|x|1|true|verdadero|activo|activa|yes)$/.test(f)) return true;
  if (/^(no|n|0|false|falso|inactivo|inactiva)$/.test(f)) return false;
  return null;
}

/** Documento para comparar: solo letras y números, en mayúscula (1.098.765.432 = 1098765432). */
export const docKey = (v: unknown) => String(v ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
