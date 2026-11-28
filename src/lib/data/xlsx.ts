/**
 * RemHub Data Studio — motor de Excel (.xlsx) propio, sin librerías (Office Open XML escrito a mano).
 *
 * Lo que entrega (verificado abriéndolo en Microsoft Excel, ver docs/DATA_STUDIO.md):
 *  · Tipos correctos: referencias, códigos de barras, NIT y teléfonos como TEXTO (no pierden ceros ni pasan a
 *    notación científica); cantidades y plata como NÚMERO con formato (se pueden sumar); fechas como FECHA real.
 *  · Tablas nativas de Excel (filtros y orden), encabezado fijo, filas alternadas que siguen bien al ordenar,
 *    totales con fórmulas (SUBTOTAL: respetan los filtros), formato condicional, listas desplegables,
 *    enlaces, notas de impresión (horizontal, ajustado al ancho, encabezado repetido, página X de Y).
 *  · Hoja «Resumen» opcional con título, empresa, fecha, filtros, indicadores (con fórmulas) y el índice de hojas.
 *  · Imágenes (fotos de producto) y gráficos nativos ligados a los datos.
 *  · Seguridad: los textos van como texto literal (inlineStr): un nombre que empiece por «=» NO se vuelve fórmula.
 *    Solo los enlaces https (o rutas de RemHub) se vuelven hipervínculo.
 *
 * Compatibilidad: XSheet/XCell/buildXlsx/downloadXlsx/xDate siguen funcionando como antes. Las hojas de datos
 * dejan el encabezado en la fila 1, así que lo exportado se puede volver a importar.
 */

// ------------------------------------------------------------------ tipos

export type XColType = "text" | "code" | "int" | "number" | "money" | "percent" | "date" | "datetime" | "bool";
/** Fórmula de Excel (sin «=»), con su valor ya calculado para que se vea aunque no se recalcule. */
export type XFormula = { f: string; v?: number | string | null };
/** Texto o número con hipervínculo (solo https o ruta de RemHub). */
export type XLink = { v: string | number; link: string };
/** Imagen dentro de la celda (PNG o JPEG ya reducida). */
export type XImageCell = { image: Uint8Array; ext: "png" | "jpeg"; w: number; h: number; alt?: string };
export type XCell = string | number | boolean | Date | null | undefined | XFormula | XLink | XImageCell;

export type XTone = "bad" | "good" | "warn" | "info" | "muted";
/** Formato condicional de una columna (nativo de Excel: cambia solo si editas el dato). */
export type XCond =
  | { when: "lt" | "lte" | "gt" | "gte" | "eq" | "ne"; value: number | string; tone: XTone }
  | { when: "between"; value: number; value2: number; tone: XTone }
  | { when: "blank"; tone: XTone }
  | { when: "contains"; value: string; tone: XTone };

export type XColumn = {
  type?: XColType;
  width?: number;
  wrap?: boolean;
  /** Decimales para number/money/percent. */
  decimals?: number;
  /** Total al pie (con SUBTOTAL: respeta los filtros). */
  total?: "sum" | "avg" | "count" | "min" | "max";
  cond?: XCond[];
  /** Lista desplegable (validación de datos). */
  list?: string[];
  align?: "left" | "center" | "right";
  hidden?: boolean;
};

/** Gráfico nativo ligado a columnas de la misma hoja. */
export type XChart = {
  kind: "column" | "bar" | "line" | "pie";
  title: string;
  /** Columna de etiquetas y columnas de valores (índices de `head`). */
  catCol: number;
  valCols: number[];
  /** Solo las primeras N filas (p. ej. los 10 más vendidos). */
  maxRows?: number;
  /** Dónde va: columna y fila (0 = primera) y tamaño en celdas. */
  at?: { col: number; row: number; cols?: number; rows?: number };
};

export type XSheet = {
  name: string;
  head: string[];
  rows: XCell[][];
  widths?: number[];
  columns?: Array<XColumn | undefined>;
  /** Hoja de informe: título encima de la tabla (el encabezado ya no queda en la fila 1). */
  title?: string;
  subtitle?: string;
  /** Fila de totales al pie (columnas con `total`, o las de plata y cantidades si no se dice). */
  totals?: boolean;
  /** Tabla nativa de Excel (por defecto sí, si hay filas y los encabezados lo permiten). */
  table?: boolean;
  freezeCols?: number;
  landscape?: boolean;
  /** Alto (px) de las filas que llevan foto. */
  imageRowHeight?: number;
  charts?: XChart[];
};

export type XThemeKey = "amethyst" | "profesional" | "minimalista" | "corporativo" | "azul" | "verde" | "bn";
export type XKpi = { label: string; value?: number | string | null; formula?: string; type?: XColType; hint?: string };
export type XMeta = {
  company?: string;
  title?: string;
  subtitle?: string;
  user?: string;
  /** Filtros o datos del informe: [etiqueta, valor]. */
  filters?: Array<[string, string]>;
  theme?: XThemeKey | string;
  /** Hoja «Resumen» al inicio (por defecto sí si hay título o indicadores). */
  summary?: boolean;
  kpis?: XKpi[];
  notes?: string[];
  /** Momento del informe (para pruebas); por defecto ahora. */
  generatedAt?: Date;
};
export type XBook = { sheets: XSheet[]; meta?: XMeta };

// ------------------------------------------------------------------ temas

type Theme = { primary: string; onPrimary: string; band: string; soft: string; ink: string };
export const XTHEMES: Record<XThemeKey, Theme & { name: string }> = {
  amethyst: { name: "Amethyst", primary: "6D28D9", onPrimary: "FFFFFF", band: "F5F3FF", soft: "EDE9FE", ink: "3B0764" },
  profesional: { name: "Profesional", primary: "1F4E79", onPrimary: "FFFFFF", band: "F2F6FA", soft: "DDEBF7", ink: "1F2937" },
  minimalista: { name: "Minimalista", primary: "374151", onPrimary: "FFFFFF", band: "F9FAFB", soft: "F3F4F6", ink: "111827" },
  corporativo: { name: "Corporativo", primary: "0B3C5D", onPrimary: "FFFFFF", band: "F1F5F9", soft: "E2E8F0", ink: "0F172A" },
  azul: { name: "Azul empresarial", primary: "1D4ED8", onPrimary: "FFFFFF", band: "EFF6FF", soft: "DBEAFE", ink: "1E3A8A" },
  verde: { name: "Verde financiero", primary: "15803D", onPrimary: "FFFFFF", band: "F0FDF4", soft: "DCFCE7", ink: "14532D" },
  bn: { name: "Blanco y negro", primary: "000000", onPrimary: "FFFFFF", band: "F2F2F2", soft: "E5E5E5", ink: "000000" },
};
function themeOf(t?: string): Theme {
  if (t && t in XTHEMES) return XTHEMES[t as XThemeKey];
  const hex = (t ?? "").replace("#", "").toUpperCase();
  if (/^[0-9A-F]{6}$/.test(hex)) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
    const mix = (a: number, w: number) => Math.round(a + (255 - a) * w).toString(16).padStart(2, "0");
    return { primary: hex, onPrimary: light ? "000000" : "FFFFFF", band: `${mix(r, 0.94)}${mix(g, 0.94)}${mix(b, 0.94)}`.toUpperCase(), soft: `${mix(r, 0.85)}${mix(g, 0.85)}${mix(b, 0.85)}`.toUpperCase(), ink: "111827" };
  }
  return XTHEMES.amethyst;
}
const TONES: Record<XTone, { font: string; fill: string }> = {
  bad: { font: "9C0006", fill: "FFC7CE" },
  good: { font: "006100", fill: "C6EFCE" },
  warn: { font: "9C5700", fill: "FFEB9C" },
  info: { font: "1F4E79", fill: "DDEBF7" },
  muted: { font: "595959", fill: "EDEDED" },
};

// ------------------------------------------------------------------ utilidades

const enc = new TextEncoder();
/** Texto seguro para XML (sin caracteres de control que Excel no acepta). */
export const xmlEsc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

export function colName(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Nombre de hoja válido y único (máx. 31, sin : \ / ? * [ ]). */
function sheetNames(names: string[]) {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = (raw.replace(/[:\\/?*[\]]/g, " ").replace(/^'+|'+$/g, "").trim() || "Hoja").slice(0, 31);
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${k++}`;
    used.add(name.toLowerCase());
    return name;
  });
}
/** Nombre de tabla de Excel válido (letras, números y _; empieza por letra). */
export function tableName(sheet: string, i: number) {
  const base = fold(sheet).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "datos";
  return `T${i + 1}_${base}`.slice(0, 60);
}
/** Columna de tabla para fórmulas estructuradas: T1_x[Precio 3] (escapa [ ] # '). */
export const tableCol = (table: string, head: string) => `${table}[${head.replace(/(['#[\]])/g, "'$1")}]`;
const quoteSheet = (n: string) => `'${n.replace(/'/g, "''")}'`;

/** Fecha de Excel (número de serie) desde Date, AAAA-MM-DD, DD/MM/AAAA o «DD/MM/AAAA HH:MM» (hora de Colombia). */
export function excelSerial(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const base = Date.UTC(1899, 11, 30);
  const fromParts = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => {
    const t = Date.UTC(y, mo - 1, d, h, mi, s);
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
    return (t - base) / 86400000;
  };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(v);
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return fromParts(g("year"), g("month"), g("day"), g("hour") % 24, g("minute"), g("second"));
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) return fromParts(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return fromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : excelSerial(d); }
  return null;
}

const isFormula = (v: XCell): v is XFormula => typeof v === "object" && v !== null && !(v instanceof Date) && "f" in v;
const isLink = (v: XCell): v is XLink => typeof v === "object" && v !== null && !(v instanceof Date) && "link" in v;
const isImage = (v: XCell): v is XImageCell => typeof v === "object" && v !== null && !(v instanceof Date) && "image" in v;
/** Solo enlaces https o rutas absolutas de RemHub (nada de javascript:, file:, etc.). */
export function safeLink(url: string): string | null {
  const u = String(url ?? "").trim();
  if (/^https:\/\/[^\s"<>]+$/i.test(u) && u.length <= 2000) return u;
  return null;
}

// ------------------------------------------------------------------ inferir el tipo de cada columna

const RE_CODE = /\b(referencia|ref|sku|codigo|cod|barras|nit|documento|cedula|cc|telefono|celular|movil|whatsapp|id|token|factura no|n de factura|numero de documento)\b/;
const RE_QTY = /\b(unidades|und|cantidad|cant|stock|existencias?|qty|contad[oa]s?|enviad[oa]s?|recibid[oa]s?|pedid[oa]s?|faltan|sobran|diferencia en unidades|personas|productos|referencias|lineas)\b/;
const RE_MONEY = /(precio|costo|valor|total|saldo|abono|monto|subtotal|iva|impuesto|utilidad|ganancia|debe|haber|pagad|deuda|vendid|efectivo|descuento|cuota|interes|salario|sueldo|plata|ingreso|egreso|gasto|cobro|credito|cartera)/;
const RE_DATE = /(fecha|vence|vencimiento|creado|actualizado|desde|hasta|registrad|aplicad|recibido el|enviado el|dia)/;
/** Plata que tiene sentido sumar al pie. */
const RE_SUMMABLE = /(valor|total|saldo|subtotal|pagad|deuda|abono|monto|vendid|venta|utilidad|ganancia|diferencia|ingreso|egreso|gasto|cobrad|debe|haber|plata)/;
const RE_LONG = /(nombre|producto|descripcion|detalle|nota|observacion|motivo|direccion|concepto|categoria)/;

export function inferType(head: string, values: XCell[]): XColType {
  const h = fold(head);
  // Las fórmulas cuentan por su valor ya calculado (una columna de «C2*D2» con plata es de plata).
  const sample = values.map((v) => (isFormula(v) ? v.v : v)).filter((v) => v !== null && v !== undefined && v !== "" && !isLink(v as XCell) && !isImage(v as XCell)).slice(0, 300) as XCell[];
  if (!sample.length) return RE_CODE.test(h) ? "code" : "text";
  if (sample.every((v) => v instanceof Date)) return "datetime";
  if (sample.every((v) => typeof v === "boolean")) return "bool";
  if (sample.every((v) => typeof v === "number")) {
    if (RE_CODE.test(h) && !RE_MONEY.test(h)) return "int";
    if (RE_QTY.test(h) && !RE_MONEY.test(h.replace(/total de/, ""))) return "int";
    if (RE_MONEY.test(h)) return "money";
    return sample.every((v) => Number.isInteger(v)) ? "int" : "number";
  }
  if (RE_CODE.test(h)) return "code";
  if (RE_DATE.test(h) && sample.every((v) => typeof v === "string" && excelSerial(v) !== null)) {
    return sample.some((v) => /\d{1,2}:\d{2}/.test(String(v))) ? "datetime" : "date";
  }
  return "text";
}

// ------------------------------------------------------------------ estilos

type Align = "left" | "center" | "right" | "";
type XfKey = { numFmt: number; font: number; fill: number; border: number; align: Align; wrap: boolean; vcenter: boolean; indent?: number };

class Styles {
  numFmts: string[] = [];
  fonts: string[] = ['<font><sz val="10"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>'];
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  dxfs: string[] = [];
  private keys = new Map<string, number>();
  private fmtIds = new Map<string, number>();

  numFmt(code: string): number {
    const builtin: Record<string, number> = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "@": 49 };
    if (code in builtin) return builtin[code];
    const got = this.fmtIds.get(code);
    if (got !== undefined) return got;
    const id = 164 + this.numFmts.length;
    this.numFmts.push(`<numFmt numFmtId="${id}" formatCode="${xmlEsc(code)}"/>`);
    this.fmtIds.set(code, id);
    return id;
  }
  private add(list: string[], xml: string) {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }
  font(o: { bold?: boolean; size?: number; color?: string; italic?: boolean; underline?: boolean }) {
    return this.add(this.fonts, `<font>${o.bold ? "<b/>" : ""}${o.italic ? "<i/>" : ""}${o.underline ? '<u/>' : ""}<sz val="${o.size ?? 10}"/><color rgb="FF${o.color ?? "1F2937"}"/><name val="Calibri"/><family val="2"/></font>`);
  }
  fill(rgb: string) {
    return this.add(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`);
  }
  border(kind: "row" | "box" | "top2") {
    const c = '<color rgb="FFD9D9D9"/>';
    const xml = kind === "row" ? `<border><left/><right/><top/><bottom style="thin">${c}</bottom><diagonal/></border>`
      : kind === "top2" ? `<border><left/><right/><top style="medium"><color rgb="FF6B7280"/></top><bottom style="thin">${c}</bottom><diagonal/></border>`
      : `<border><left style="thin">${c}</left><right style="thin">${c}</right><top style="thin">${c}</top><bottom style="thin">${c}</bottom><diagonal/></border>`;
    return this.add(this.borders, xml);
  }
  xf(k: XfKey) {
    const key = JSON.stringify(k);
    const got = this.keys.get(key);
    if (got !== undefined) return got;
    const al = k.align || k.wrap || k.vcenter || k.indent
      ? `<alignment${k.align ? ` horizontal="${k.align}"` : ""}${k.vcenter ? ' vertical="center"' : ""}${k.wrap ? ' wrapText="1"' : ""}${k.indent ? ` indent="${k.indent}"` : ""}/>` : "";
    const xml = `<xf numFmtId="${k.numFmt}" fontId="${k.font}" fillId="${k.fill}" borderId="${k.border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1"' : ""}>${al}</xf>`;
    this.xfs.push(xml);
    const i = this.xfs.length - 1;
    this.keys.set(key, i);
    return i;
  }
  dxf(font: string | null, fill: string | null, bold = false) {
    return this.add(this.dxfs, `<dxf>${font || bold ? `<font>${bold ? "<b/>" : ""}${font ? `<color rgb="FF${font}"/>` : ""}</font>` : ""}${fill ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor rgb="FF${fill}"/></patternFill></fill>` : ""}</dxf>`);
  }
  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + (this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.join("")}</numFmts>` : "")
      + `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>`
      + `<fills count="${this.fills.length}">${this.fills.join("")}</fills>`
      + `<borders count="${this.borders.length}">${this.borders.join("")}</borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
      + `<dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs>`
      + `<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }
}

function fmtFor(type: XColType, decimals?: number): string {
  const d = decimals ?? 0;
  const dec = d > 0 ? `.${"0".repeat(Math.min(6, d))}` : "";
  switch (type) {
    case "money": return `"$"#,##0${dec};[Red]-"$"#,##0${dec}`;
    case "int": return "#,##0;[Red]-#,##0";
    case "number": return `#,##0${d > 0 ? dec : ".00"};[Red]-#,##0${d > 0 ? dec : ".00"}`;
    case "percent": return `0${d > 0 ? dec : ".0"}%`;
    case "date": return "dd/mm/yyyy";
    case "datetime": return "dd/mm/yyyy hh:mm";
    case "code":
    case "text":
    case "bool": return "@";
  }
}

// ------------------------------------------------------------------ armar el libro

type Rel = { id: string; type: string; target: string; external?: boolean };
type Part = { path: string; content: string | Uint8Array; ctype?: string };

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = {
  sheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  table: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table",
  link: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  drawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  chart: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  core: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  app: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
};
const relsXml = (rels: Rel[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("") + `</Relationships>`;

const TOTAL_FN: Record<NonNullable<XColumn["total"]>, { code: number; name: string }> = {
  sum: { code: 109, name: "sum" }, avg: { code: 101, name: "average" }, count: { code: 103, name: "count" }, min: { code: 105, name: "min" }, max: { code: 104, name: "max" },
};

type Built = { parts: Part[]; sheetNames: string[] };

export function buildBook(book: XBook): Built {
  const meta = book.meta ?? {};
  const theme = themeOf(meta.theme);
  const st = new Styles();
  const now = meta.generatedAt ?? new Date();
  const dataSheets = book.sheets.length ? book.sheets : [{ name: "Hoja", head: ["Sin datos"], rows: [] }];
  const wantSummary = meta.summary ?? Boolean(meta.title || meta.kpis?.length);
  const allNames = sheetNames([...(wantSummary ? ["Resumen"] : []), ...dataSheets.map((s) => s.name)]);
  const names = wantSummary ? allNames.slice(1) : allNames;
  const summaryName = wantSummary ? allNames[0] : null;

  // Estilos base.
  const fHead = st.font({ bold: true, color: theme.onPrimary, size: 10 });
  const fillHead = st.fill(theme.primary);
  const fTitle = st.font({ bold: true, size: 16, color: theme.primary });
  const fSub = st.font({ size: 10, color: "6B7280" });
  const fBold = st.font({ bold: true, size: 10 });
  const fLink = st.font({ size: 10, color: "1D4ED8", underline: true });
  const fKpi = st.font({ bold: true, size: 14, color: theme.ink });
  const fillSoft = st.fill(theme.soft);
  const bRow = st.border("row");
  const bTop = st.border("top2");
  const bandDxf = st.dxf(null, theme.band);

  const parts: Part[] = [];
  const wbRels: Rel[] = [];
  const sheetEntries: Array<{ name: string; path: string }> = [];
  const definedNames: string[] = [];
  let tableNo = 0, drawingNo = 0, imageNo = 0, chartNo = 0;
  const mediaByBytes = new Map<Uint8Array, string>();
  const imageExts = new Set<string>();

  // ---------------- hojas de datos
  const tableNames: string[] = [];
  const sheetXmls: Array<{ name: string; xml: string; rels: Rel[] }> = [];

  dataSheets.forEach((s, si) => {
    const name = names[si];
    const ncol = Math.max(1, s.head.length);
    const rels: Rel[] = [];
    let rid = 0;
    const nextRid = () => `rId${++rid}`;
    const top = s.title ? (s.subtitle ? 3 : 2) : 0; // filas encima del encabezado
    const headRow = top + 1;
    const firstData = headRow + 1;
    const lastData = headRow + s.rows.length;
    // Tipo y estilo de cada columna.
    const cols = s.head.map((h, c) => {
      const spec = s.columns?.[c] ?? {};
      const type = spec.type ?? inferType(h, s.rows.map((r) => r[c]));
      const decimals = spec.decimals ?? (type === "money" && s.rows.some((r) => typeof r[c] === "number" && !Number.isInteger(r[c] as number)) ? 2 : undefined);
      const longText = type === "text" && RE_LONG.test(fold(h));
      const wrap = spec.wrap ?? longText;
      const align: Align = spec.align ?? (type === "money" || type === "int" || type === "number" || type === "percent" ? "right" : type === "bool" || type === "date" || type === "datetime" ? "center" : "left");
      const fmt = st.numFmt(fmtFor(type, decimals));
      // Total automático solo donde sumar tiene sentido: valores, saldos y cantidades (no precios ni costos unitarios).
      const hf = fold(h);
      const sumsUp = type === "money" ? RE_SUMMABLE.test(hf) && !/(precio|unitari|promedio|\bc\/u\b)/.test(hf) : type === "int" && RE_QTY.test(hf);
      const total = spec.total ?? (s.totals && sumsUp ? "sum" : undefined);
      return { head: h, type, decimals, wrap, align, fmt, total, spec };
    });
    const cellXf = cols.map((c) => st.xf({ numFmt: c.fmt, font: 0, fill: 0, border: bRow, align: c.align, wrap: c.wrap, vcenter: true }));
    const linkXf = cols.map((c) => st.xf({ numFmt: c.fmt, font: fLink, fill: 0, border: bRow, align: c.align, wrap: c.wrap, vcenter: true }));
    const headXf = st.xf({ numFmt: 0, font: fHead, fill: fillHead, border: 0, align: "center", wrap: true, vcenter: true });
    const totalLabelXf = st.xf({ numFmt: 0, font: fBold, fill: fillSoft, border: bTop, align: "left", wrap: false, vcenter: true });
    const totalXf = cols.map((c) => st.xf({ numFmt: c.fmt, font: fBold, fill: fillSoft, border: bTop, align: c.align, wrap: false, vcenter: true }));
    const titleXf = st.xf({ numFmt: 0, font: fTitle, fill: 0, border: 0, align: "left", wrap: false, vcenter: true });
    const subXf = st.xf({ numFmt: 0, font: fSub, fill: 0, border: 0, align: "left", wrap: false, vcenter: true });

    // ¿Tabla nativa? Encabezados únicos y no vacíos.
    const heads = s.head.map((h) => String(h ?? "").trim());
    const uniqueHeads = heads.every((h) => h) && new Set(heads.map((h) => h.toLowerCase())).size === heads.length;
    const useTable = (s.table ?? true) && s.rows.length > 0 && uniqueHeads;
    const tName = useTable ? tableName(name, tableNo) : "";
    if (useTable) tableNames[si] = tName;
    const hasTotals = Boolean(s.totals) && s.rows.length > 0 && cols.some((c) => c.total);
    const totalRow = hasTotals ? lastData + 1 : 0;

    const links: Array<{ ref: string; rid: string }> = [];
    const images: Array<{ col: number; row: number; img: XImageCell }> = [];

    const valueCell = (v: XCell, ref: string, c: number) => {
      const col = cols[c];
      if (isImage(v)) { images.push({ col: c, row: Number(ref.replace(/^[A-Z]+/, "")) - 1, img: v }); return v.alt ? `<c r="${ref}" s="${cellXf[c]}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v.alt)}</t></is></c>` : `<c r="${ref}" s="${cellXf[c]}"/>`; }
      if (isFormula(v)) {
        const cached = v.v === null || v.v === undefined ? "" : typeof v.v === "number" ? `<v>${Number.isFinite(v.v) ? v.v : 0}</v>` : `<v>${xmlEsc(String(v.v))}</v>`;
        return `<c r="${ref}" s="${cellXf[c]}"${typeof v.v === "string" ? ' t="str"' : ""}><f>${xmlEsc(v.f)}</f>${cached}</c>`;
      }
      let xf = cellXf[c];
      let val: Exclude<XCell, XFormula | XImageCell> = v;
      if (isLink(v)) {
        const url = safeLink(v.link);
        val = v.v;
        if (url) {
          const id = nextRid();
          rels.push({ id, type: REL.link, target: url, external: true });
          links.push({ ref, rid: id });
          xf = linkXf[c];
        }
      }
      if (val === null || val === undefined || val === "") return "";
      if (col.type === "date" || col.type === "datetime") {
        const serial = excelSerial(val);
        if (serial !== null) return `<c r="${ref}" s="${xf}"><v>${col.type === "date" ? Math.floor(serial) : serial}</v></c>`;
      }
      if (typeof val === "number" && Number.isFinite(val) && col.type !== "code" && col.type !== "text") return `<c r="${ref}" s="${xf}"><v>${val}</v></c>`;
      const text = typeof val === "boolean" ? (val ? "Sí" : "No") : val instanceof Date ? (excelSerial(val) ?? "").toString() : String(val);
      return `<c r="${ref}" s="${xf}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
    };

    const rowsXml: string[] = [];
    if (s.title) {
      rowsXml.push(`<row r="1" ht="26" customHeight="1"><c r="A1" s="${titleXf}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s.title)}</t></is></c></row>`);
      if (s.subtitle) rowsXml.push(`<row r="2"><c r="A2" s="${subXf}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s.subtitle)}</t></is></c></row>`);
    }
    rowsXml.push(`<row r="${headRow}" ht="30" customHeight="1">${s.head.map((h, c) => `<c r="${colName(c)}${headRow}" s="${headXf}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(h ?? ""))}</t></is></c>`).join("")}</row>`);
    const imgRowHt = s.imageRowHeight ?? 60;
    s.rows.forEach((r, i) => {
      const rn = firstData + i;
      const hasImg = r.some((v) => isImage(v));
      rowsXml.push(`<row r="${rn}"${hasImg ? ` ht="${Math.round(imgRowHt * 0.75)}" customHeight="1"` : ""}>${r.slice(0, ncol).map((v, c) => valueCell(v, `${colName(c)}${rn}`, c)).join("")}</row>`);
    });
    if (hasTotals) {
      const cells = cols.map((c, ci) => {
        const ref = `${colName(ci)}${totalRow}`;
        if (ci === 0 && !c.total) return `<c r="${ref}" s="${totalLabelXf}" t="inlineStr"><is><t>Total</t></is></c>`;
        if (!c.total) return `<c r="${ref}" s="${totalLabelXf}"/>`;
        const fn = TOTAL_FN[c.total];
        const range = useTable ? tableCol(tName, c.head) : `${colName(ci)}${firstData}:${colName(ci)}${lastData}`;
        const nums = s.rows.map((r) => (isFormula(r[ci]) ? (r[ci] as XFormula).v : r[ci])).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        const cached = c.total === "sum" ? nums.reduce((a, b) => a + b, 0) : c.total === "count" ? s.rows.filter((r) => r[ci] !== null && r[ci] !== undefined && r[ci] !== "").length
          : c.total === "avg" ? (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0) : c.total === "min" ? (nums.length ? Math.min(...nums) : 0) : (nums.length ? Math.max(...nums) : 0);
        return `<c r="${ref}" s="${totalXf[ci]}"><f>SUBTOTAL(${fn.code},${xmlEsc(range)})</f><v>${cached}</v></c>`;
      });
      rowsXml.push(`<row r="${totalRow}">${cells.join("")}</row>`);
    }

    // Anchos: por contenido, con mínimo y máximo; las columnas largas se parten en varias líneas.
    const widths = cols.map((c, ci) => {
      if (s.widths?.[ci]) return s.widths[ci];
      if (c.spec.width) return c.spec.width;
      if (s.rows.some((r) => isImage(r[ci]))) return Math.max(10, Math.round((imgRowHt * 1.15) / 7));
      const lens = s.rows.slice(0, 500).map((r) => {
        const raw = r[ci];
        const v = isFormula(raw) ? raw.v : raw;
        if (v === null || v === undefined) return 0;
        if (isLink(v)) return String(v.v).length + 1;
        if (typeof v === "number") return (c.type === "money" ? 4 : 1) + Math.round(Math.abs(v)).toLocaleString("es-CO").length + (c.decimals ? c.decimals + 1 : 0);
        if (c.type === "date") return 11;
        if (c.type === "datetime") return 17;
        return Math.max(...String(v).split("\n").map((x) => x.length));
      });
      const content = Math.max(0, ...lens);
      const headLen = Math.min(28, String(c.head).length);
      const max = c.wrap ? 48 : c.type === "code" ? 40 : 60;
      return Math.max(c.type === "code" ? 12 : 8, Math.min(max, Math.max(headLen + 2, content + 2)));
    });
    const colsXml = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${cols[i].spec.hidden ? ' hidden="1"' : ""}/>`).join("")}</cols>`;

    // Formato condicional: filas alternadas (siguen bien al ordenar o filtrar) y las reglas de cada columna.
    const cf: string[] = [];
    let prio = 1;
    const dataRange = s.rows.length ? `A${firstData}:${colName(ncol - 1)}${lastData}` : "";
    cols.forEach((c, ci) => {
      for (const rule of c.spec.cond ?? []) {
        if (!s.rows.length) break;
        const tone = TONES[rule.tone];
        const dxf = st.dxf(tone.font, tone.fill);
        const sq = `${colName(ci)}${firstData}:${colName(ci)}${lastData}`;
        const first = `${colName(ci)}${firstData}`;
        const val = (x: number | string) => (typeof x === "number" ? String(x) : `"${xmlEsc(String(x).replace(/"/g, '""'))}"`);
        if (rule.when === "blank") cf.push(`<conditionalFormatting sqref="${sq}"><cfRule type="containsBlanks" dxfId="${dxf}" priority="${prio++}"><formula>LEN(TRIM(${first}))=0</formula></cfRule></conditionalFormatting>`);
        else if (rule.when === "contains") cf.push(`<conditionalFormatting sqref="${sq}"><cfRule type="containsText" dxfId="${dxf}" priority="${prio++}" operator="containsText" text="${xmlEsc(rule.value)}"><formula>NOT(ISERROR(SEARCH(${val(rule.value)},${first})))</formula></cfRule></conditionalFormatting>`);
        else if (rule.when === "between") cf.push(`<conditionalFormatting sqref="${sq}"><cfRule type="cellIs" dxfId="${dxf}" priority="${prio++}" operator="between"><formula>${rule.value}</formula><formula>${rule.value2}</formula></cfRule></conditionalFormatting>`);
        else {
          const op = { lt: "lessThan", lte: "lessThanOrEqual", gt: "greaterThan", gte: "greaterThanOrEqual", eq: "equal", ne: "notEqual" }[rule.when];
          cf.push(`<conditionalFormatting sqref="${sq}"><cfRule type="cellIs" dxfId="${dxf}" priority="${prio++}" operator="${op}"><formula>${val(rule.value)}</formula></cfRule></conditionalFormatting>`);
        }
      }
    });
    if (dataRange) cf.push(`<conditionalFormatting sqref="${dataRange}"><cfRule type="expression" dxfId="${bandDxf}" priority="${prio++}"><formula>MOD(ROW(),2)=${firstData % 2 === 0 ? 1 : 0}</formula></cfRule></conditionalFormatting>`);

    // Listas desplegables.
    const dv = cols.map((c, ci) => {
      if (!c.spec.list?.length) return "";
      const listText = c.spec.list.map((x) => x.replace(/[",]/g, " ")).join(",");
      if (listText.length > 250) return "";
      const sq = `${colName(ci)}${firstData}:${colName(ci)}${Math.max(lastData, firstData + 1000)}`;
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Valor no válido" error="Elige un valor de la lista." sqref="${sq}"><formula1>"${xmlEsc(listText)}"</formula1></dataValidation>`;
    }).filter(Boolean);

    // Fotos y gráficos (dibujo de la hoja).
    let drawingXml = "";
    const anchors: string[] = [];
    const drawingRels: Rel[] = [];
    let drid = 0;
    const EMU = 9525; // por píxel
    const relByMedia = new Map<string, string>();
    images.forEach((im, k) => {
      imageExts.add(im.img.ext);
      // La misma foto (mismos bytes) se guarda una sola vez en el libro y se reutiliza.
      let file = mediaByBytes.get(im.img.image);
      if (!file) {
        imageNo++;
        file = `image${imageNo}.${im.img.ext === "jpeg" ? "jpeg" : "png"}`;
        mediaByBytes.set(im.img.image, file);
        parts.push({ path: `xl/media/${file}`, content: im.img.image });
      }
      let rId = relByMedia.get(file);
      if (!rId) {
        rId = `rId${++drid}`;
        relByMedia.set(file, rId);
        drawingRels.push({ id: rId, type: REL.image, target: `../media/${file}` });
      }
      // Cabe en la celda sin deformarse (ancho de columna ≈ 7 px por carácter).
      const boxW = Math.round(widths[im.col] * 7) - 6, boxH = imgRowHt - 6;
      const scale = Math.min(boxW / Math.max(1, im.img.w), boxH / Math.max(1, im.img.h), 1);
      const w = Math.max(1, Math.round(im.img.w * scale)), h = Math.max(1, Math.round(im.img.h * scale));
      anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${3 * EMU}</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>${3 * EMU}</xdr:rowOff></xdr:from>`
        + `<xdr:ext cx="${w * EMU}" cy="${h * EMU}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="Foto ${k + 1}" descr="${xmlEsc(im.img.alt ?? "")}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
        + `<xdr:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
    });
    (s.charts ?? []).forEach((ch, k) => {
      if (!s.rows.length) return;
      chartNo++;
      const n = Math.min(s.rows.length, ch.maxRows ?? s.rows.length);
      const ref = (c: number) => `${quoteSheet(name)}!$${colName(c)}$${firstData}:$${colName(c)}$${firstData + n - 1}`;
      const series = ch.valCols.map((vc, i) => {
        const vals = s.rows.slice(0, n).map((r) => (typeof r[vc] === "number" ? (r[vc] as number) : isFormula(r[vc]) && typeof (r[vc] as XFormula).v === "number" ? ((r[vc] as XFormula).v as number) : 0));
        const cats = s.rows.slice(0, n).map((r) => { const v = r[ch.catCol]; return isLink(v) ? String(v.v) : v === null || v === undefined ? "" : String(isFormula(v) ? v.v ?? "" : v); });
        const color = i === 0 ? theme.primary : ["0EA5E9", "F59E0B", "10B981", "EF4444"][i % 4];
        return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${xmlEsc(`${quoteSheet(name)}!$${colName(vc)}$${headRow}`)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEsc(s.head[vc])}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
          + (ch.kind === "pie" ? "" : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${ch.kind === "line" ? `<a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>` : ""}</c:spPr>`)
          + `<c:cat><c:strRef><c:f>${xmlEsc(ref(ch.catCol))}</c:f><c:strCache><c:ptCount val="${n}"/>${cats.map((c2, j) => `<c:pt idx="${j}"><c:v>${xmlEsc(c2)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat>`
          + `<c:val><c:numRef><c:f>${xmlEsc(ref(vc))}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${vals.map((v, j) => `<c:pt idx="${j}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache></c:numRef></c:val>`
          + (ch.kind === "line" ? '<c:smooth val="0"/>' : "") + `</c:ser>`;
      }).join("");
      const axes = ch.kind === "pie" ? "" : `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="${ch.kind === "bar" ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${ch.kind === "bar" ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
        + `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${ch.kind === "bar" ? "b" : "l"}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="${ch.kind === "bar" ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`;
      const plot = ch.kind === "pie" ? `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`
        : ch.kind === "line" ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="500000001"/><c:axId val="500000002"/></c:lineChart>`
        : `<c:barChart><c:barDir val="${ch.kind === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/><c:axId val="500000001"/><c:axId val="500000002"/></c:barChart>`;
      const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}">`
        + `<c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-CO" sz="1200" b="1"/><a:t>${xmlEsc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
        + `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
        + `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
      parts.push({ path: `xl/charts/chart${chartNo}.xml`, content: chartXml, ctype: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml" });
      const rId = `rId${++drid}`;
      drawingRels.push({ id: rId, type: REL.chart, target: `../charts/chart${chartNo}.xml` });
      const at = ch.at ?? { col: ncol + 1, row: headRow - 1 + k * 18 };
      anchors.push(`<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${at.col + (at.cols ?? 8)}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${at.row + (at.rows ?? 16)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
        + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${1000 + k}" name="Gráfico ${k + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>`
        + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
    });
    if (anchors.length) {
      drawingNo++;
      parts.push({ path: `xl/drawings/drawing${drawingNo}.xml`, ctype: "application/vnd.openxmlformats-officedocument.drawing+xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}">${anchors.join("")}</xdr:wsDr>` });
      parts.push({ path: `xl/drawings/_rels/drawing${drawingNo}.xml.rels`, content: relsXml(drawingRels) });
      const id = nextRid();
      rels.push({ id, type: REL.drawing, target: `../drawings/drawing${drawingNo}.xml` });
      drawingXml = `<drawing r:id="${id}"/>`;
    }

    // Tabla nativa.
    let tablePartsXml = "";
    if (useTable) {
      tableNo++;
      const ref = `A${headRow}:${colName(ncol - 1)}${hasTotals ? totalRow : lastData}`;
      const tcols = cols.map((c, ci) => {
        const fn = c.total ? TOTAL_FN[c.total].name : null;
        return `<tableColumn id="${ci + 1}" name="${xmlEsc(heads[ci])}"${ci === 0 && hasTotals && !c.total ? ' totalsRowLabel="Total"' : ""}${hasTotals && fn ? ` totalsRowFunction="${fn}"` : ""}/>`;
      }).join("");
      parts.push({ path: `xl/tables/table${tableNo}.xml`, ctype: "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="${NS_MAIN}" id="${tableNo}" name="${tName}" displayName="${tName}" ref="${ref}"${hasTotals ? ' totalsRowCount="1"' : ' totalsRowShown="0"'}>`
          + `<autoFilter ref="A${headRow}:${colName(ncol - 1)}${lastData}"/><tableColumns count="${ncol}">${tcols}</tableColumns>`
          + `<tableStyleInfo name="TableStyleLight1" showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/></table>` });
      const id = nextRid();
      rels.push({ id, type: REL.table, target: `../tables/table${tableNo}.xml` });
      tablePartsXml = `<tableParts count="1"><tablePart r:id="${id}"/></tableParts>`;
    }

    // Vista: encabezado fijo (y columnas fijas si se pide).
    const xSplit = s.freezeCols ?? 0;
    const pane = `<pane${xSplit ? ` xSplit="${xSplit}"` : ""} ySplit="${headRow}" topLeftCell="${colName(xSplit)}${headRow + 1}" activePane="${xSplit ? "bottomRight" : "bottomLeft"}" state="frozen"/>`;
    const landscape = s.landscape ?? ncol > 6;
    definedNames.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${(wantSummary ? 1 : 0) + si}">${xmlEsc(quoteSheet(name))}!$${headRow}:$${headRow}</definedName>`);
    if (!useTable && s.rows.length) definedNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${(wantSummary ? 1 : 0) + si}" hidden="1">${xmlEsc(quoteSheet(name))}!$A$${headRow}:$${colName(ncol - 1)}$${lastData}</definedName>`);
    // Referencias y códigos guardados como texto a propósito (para no perder ceros): que Excel no los marque.
    const textCols = cols.map((c, ci) => (c.type === "code" || c.type === "text" ? ci : -1)).filter((ci) => ci >= 0);
    const ignoredXml = textCols.length && s.rows.length
      ? `<ignoredErrors><ignoredError sqref="${textCols.map((ci) => `${colName(ci)}${firstData}:${colName(ci)}${lastData}`).join(" ")}" numberStoredAsText="1"/></ignoredErrors>` : "";
    const footer = `<headerFooter><oddHeader>&amp;L&amp;"Calibri,Bold"${xmlEsc((meta.company ?? "").replace(/&/g, "&&"))}&amp;C${xmlEsc((s.title ?? meta.title ?? name).replace(/&/g, "&&"))}&amp;R&amp;D</oddHeader><oddFooter>&amp;LRemHub&amp;CPágina &amp;P de &amp;N</oddFooter></headerFooter>`;

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`
      + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
      + `<dimension ref="A1:${colName(ncol - 1)}${Math.max(headRow, hasTotals ? totalRow : lastData)}"/>`
      + `<sheetViews><sheetView workbookViewId="0" zoomScale="100">${pane}</sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/>`
      + colsXml + `<sheetData>${rowsXml.join("")}</sheetData>`
      + (!useTable && s.rows.length ? `<autoFilter ref="A${headRow}:${colName(ncol - 1)}${lastData}"/>` : "")
      + (s.title ? `<mergeCells count="${s.subtitle ? 2 : 1}"><mergeCell ref="A1:${colName(Math.max(0, Math.min(ncol, 8) - 1))}1"/>${s.subtitle ? `<mergeCell ref="A2:${colName(Math.max(0, Math.min(ncol, 8) - 1))}2"/>` : ""}</mergeCells>` : "")
      + cf.join("")
      + (dv.length ? `<dataValidations count="${dv.length}">${dv.join("")}</dataValidations>` : "")
      + (links.length ? `<hyperlinks>${links.map((l) => `<hyperlink ref="${l.ref}" r:id="${l.rid}"/>`).join("")}</hyperlinks>` : "")
      + `<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`
      + `<pageSetup paperSize="1" orientation="${landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>`
      + footer + ignoredXml + drawingXml + tablePartsXml + `</worksheet>`;
    sheetXmls[si] = { name, xml, rels };
  });

  // ---------------- hoja Resumen
  if (summaryName) {
    const rows: string[] = [];
    const xfTitle = st.xf({ numFmt: 0, font: st.font({ bold: true, size: 20, color: theme.primary }), fill: 0, border: 0, align: "left", wrap: false, vcenter: true });
    const xfSub = st.xf({ numFmt: 0, font: fSub, fill: 0, border: 0, align: "left", wrap: false, vcenter: true });
    const xfLabel = st.xf({ numFmt: 0, font: st.font({ size: 10, color: "6B7280" }), fill: 0, border: 0, align: "left", wrap: false, vcenter: true });
    const xfVal = st.xf({ numFmt: 49, font: fBold, fill: 0, border: 0, align: "left", wrap: true, vcenter: true });
    const xfSection = st.xf({ numFmt: 0, font: st.font({ bold: true, size: 11, color: theme.onPrimary }), fill: fillHead, border: 0, align: "left", wrap: false, vcenter: true, indent: 1 });
    const xfKpiLabel = st.xf({ numFmt: 0, font: st.font({ size: 10, color: theme.ink }), fill: fillSoft, border: st.border("box"), align: "left", wrap: true, vcenter: true, indent: 1 });
    const kpiXf = (t: XColType | undefined) => st.xf({ numFmt: st.numFmt(fmtFor(t ?? "int")), font: fKpi, fill: fillSoft, border: st.border("box"), align: "right", wrap: false, vcenter: true });
    const xfLinkS = st.xf({ numFmt: 0, font: fLink, fill: 0, border: 0, align: "left", wrap: false, vcenter: true });
    const xfIntS = st.xf({ numFmt: st.numFmt("#,##0"), font: 0, fill: 0, border: 0, align: "right", wrap: false, vcenter: true });
    const t = (ref: string, xf: number, text: string) => `<c r="${ref}" s="${xf}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
    let r = 1;
    rows.push(`<row r="${r}" ht="34" customHeight="1">${t(`B${r}`, xfTitle, meta.title ?? "Informe")}</row>`); r++;
    if (meta.subtitle) { rows.push(`<row r="${r}">${t(`B${r}`, xfSub, meta.subtitle)}</row>`); r++; }
    r++;
    const fecha = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    const info: Array<[string, string]> = [
      ...(meta.company ? [["Empresa", meta.company] as [string, string]] : []),
      ["Generado", fecha],
      ...(meta.user ? [["Por", meta.user] as [string, string]] : []),
      ...(meta.filters ?? []),
    ];
    // «Generado» va como fecha real de Excel (se puede ordenar o comparar); lo demás como texto.
    const xfWhen = st.xf({ numFmt: st.numFmt(fmtFor("datetime")), font: fBold, fill: 0, border: 0, align: "left", wrap: false, vcenter: true });
    for (const [k, v] of info) {
      const serial = k === "Generado" ? excelSerial(now) : null;
      rows.push(`<row r="${r}">${t(`B${r}`, xfLabel, k)}${serial !== null ? `<c r="C${r}" s="${xfWhen}"><v>${serial}</v></c>` : t(`C${r}`, xfVal, v)}</row>`);
      r++;
    }
    if (meta.kpis?.length) {
      r++;
      rows.push(`<row r="${r}" ht="22" customHeight="1">${t(`B${r}`, xfSection, "Indicadores")}<c r="C${r}" s="${xfSection}"/></row>`); r++;
      for (const k of meta.kpis) {
        const xf = kpiXf(k.type);
        const val = k.formula
          ? `<c r="C${r}" s="${xf}"${typeof k.value === "string" ? ' t="str"' : ""}><f>${xmlEsc(k.formula)}</f>${k.value === null || k.value === undefined ? "" : `<v>${typeof k.value === "number" ? k.value : xmlEsc(k.value)}</v>`}</c>`
          : typeof k.value === "number" ? `<c r="C${r}" s="${xf}"><v>${k.value}</v></c>` : t(`C${r}`, xf, String(k.value ?? "—"));
        rows.push(`<row r="${r}" ht="24" customHeight="1">${t(`B${r}`, xfKpiLabel, k.label)}${val}${k.hint ? t(`D${r}`, xfSub, k.hint) : ""}</row>`);
        r++;
      }
    }
    r++;
    rows.push(`<row r="${r}" ht="22" customHeight="1">${t(`B${r}`, xfSection, "Hojas de este libro")}<c r="C${r}" s="${xfSection}"/></row>`); r++;
    const sumLinks: string[] = [];
    dataSheets.forEach((s, i) => {
      rows.push(`<row r="${r}">${t(`B${r}`, xfLinkS, names[i])}<c r="C${r}" s="${xfIntS}"><v>${s.rows.length}</v></c>${t(`D${r}`, xfSub, s.rows.length === 1 ? "fila" : "filas")}</row>`);
      sumLinks.push(`<hyperlink ref="B${r}" location="${xmlEsc(`${quoteSheet(names[i])}!A1`)}" display="${xmlEsc(names[i])}"/>`);
      r++;
    });
    for (const note of meta.notes ?? []) { r++; rows.push(`<row r="${r}">${t(`B${r}`, xfSub, note)}</row>`); }
    r += 2;
    rows.push(`<row r="${r}">${t(`B${r}`, xfSub, "Hecho con RemHub · Los totales y los indicadores son fórmulas: se actualizan si cambias los datos.")}</row>`);
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`
      + `<sheetPr><tabColor rgb="FF${theme.primary}"/><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0" tabSelected="1"/></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="3" customWidth="1"/><col min="2" max="2" width="38" customWidth="1"/><col min="3" max="3" width="26" customWidth="1"/><col min="4" max="4" width="40" customWidth="1"/></cols>`
      + `<sheetData>${rows.join("")}</sheetData>`
      + (sumLinks.length ? `<hyperlinks>${sumLinks.join("")}</hyperlinks>` : "")
      + `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="1" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    sheetXmls.unshift({ name: summaryName, xml, rels: [] });
  }

  // ---------------- libro
  sheetXmls.forEach((sx, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    parts.push({ path, content: sx.xml, ctype: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" });
    if (sx.rels.length) parts.push({ path: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, content: relsXml(sx.rels) });
    wbRels.push({ id: `rId${i + 1}`, type: REL.sheet, target: `worksheets/sheet${i + 1}.xml` });
    sheetEntries.push({ name: sx.name, path });
  });
  wbRels.push({ id: `rId${sheetXmls.length + 1}`, type: REL.styles, target: "styles.xml" });
  parts.push({ path: "xl/workbook.xml", ctype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`
      + `<bookViews><workbookView activeTab="0"/></bookViews><sheets>`
      + sheetEntries.map((e, i) => `<sheet name="${xmlEsc(e.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets>`
      + (definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : "")
      + `<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` });
  parts.push({ path: "xl/_rels/workbook.xml.rels", content: relsXml(wbRels) });
  parts.push({ path: "xl/styles.xml", content: st.xml(), ctype: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" });
  const created = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  parts.push({ path: "docProps/core.xml", ctype: "application/vnd.openxmlformats-package.core-properties+xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:title>${xmlEsc(meta.title ?? "RemHub")}</dc:title><dc:creator>${xmlEsc(meta.user ?? "RemHub")}</dc:creator><cp:lastModifiedBy>RemHub</cp:lastModifiedBy>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` });
  parts.push({ path: "docProps/app.xml", ctype: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>RemHub</Application><Company>${xmlEsc(meta.company ?? "")}</Company></Properties>` });
  parts.push({ path: "_rels/.rels", content: relsXml([
    { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", target: "xl/workbook.xml" },
    { id: "rId2", type: REL.core, target: "docProps/core.xml" },
    { id: "rId3", type: REL.app, target: "docProps/app.xml" },
  ]) });
  const overrides = parts.filter((p) => p.ctype).map((p) => `<Override PartName="/${p.path}" ContentType="${p.ctype}"/>`).join("");
  parts.unshift({ path: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + (imageExts.has("png") ? `<Default Extension="png" ContentType="image/png"/>` : "") + (imageExts.has("jpeg") ? `<Default Extension="jpeg" ContentType="image/jpeg"/>` : "")
    + overrides + `</Types>` });
  return { parts, sheetNames: sheetEntries.map((e) => e.name) };
}

// ------------------------------------------------------------------ ZIP (sin comprimir o con deflate)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
type ZipEntry = { name: string; data: Uint8Array; stored: Uint8Array; method: 0 | 8 };
function zipEntries(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nb = enc.encode(e.name), crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, e.method, true);
    local.setUint32(14, crc, true); local.setUint32(18, e.stored.length, true); local.setUint32(22, e.data.length, true); local.setUint16(26, nb.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true); dir.setUint16(10, e.method, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, e.stored.length, true); dir.setUint32(24, e.data.length, true); dir.setUint16(28, nb.length, true);
    dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nb, e.stored);
    central.push(new Uint8Array(dir.buffer), nb);
    offset += 30 + nb.length + e.stored.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
const toBytes = (c: string | Uint8Array) => (typeof c === "string" ? enc.encode(c) : c);

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
  if (!CS) return null;
  try {
    const stream = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]).stream().pipeThrough(new CS("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Libro sin comprimir (síncrono; lo usan las pruebas y quien no puede esperar). */
export function buildXlsx(input: XSheet[] | XBook): Uint8Array {
  const book: XBook = Array.isArray(input) ? { sheets: input } : input;
  const { parts } = buildBook(book);
  return zipEntries(parts.map((p) => { const d = toBytes(p.content); return { name: p.path, data: d, stored: d, method: 0 as const }; }));
}

/** Libro comprimido (deflate) cuando el navegador lo permite: archivos mucho más livianos. */
export async function buildXlsxAsync(input: XSheet[] | XBook): Promise<Uint8Array> {
  const book: XBook = Array.isArray(input) ? { sheets: input } : input;
  const { parts } = buildBook(book);
  const entries: ZipEntry[] = [];
  for (const p of parts) {
    const data = toBytes(p.content);
    // Las imágenes ya vienen comprimidas; el XML se comprime muy bien.
    const z = typeof p.content === "string" && data.length > 512 ? await deflateRaw(data) : null;
    entries.push(z && z.length < data.length ? { name: p.path, data, stored: z, method: 8 } : { name: p.path, data, stored: data, method: 0 });
  }
  return zipEntries(entries);
}

/** Descarga el libro en el navegador (acepta la forma vieja: lista de hojas; o un libro con resumen y tema). */
export function downloadXlsx(fileName: string, input: XSheet[] | XBook): Promise<void> {
  return buildXlsxAsync(input).then((bytes) => {
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
}

/** Fecha DD/MM/AAAA (con hora si se pide), en hora de Colombia. */
export function xDate(v: unknown, withTime = false): string {
  if (!v) return "";
  const s = String(v);
  // Fechas sin hora (AAAA-MM-DD) se muestran tal cual, sin correrse por la zona horaria.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const parts = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")}${withTime ? ` ${g("hour")}:${g("minute")}` : ""}`;
}

/** Texto para CSV sin riesgo de fórmula (= + - @ al inicio se escapan con ' — «CSV injection»). */
export function csvSafe(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
