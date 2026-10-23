/**
 * Excel (.xlsx) sin librerías: un ZIP sin comprimir con las hojas en XML.
 * Sirve para exportar y volver a importar el mismo archivo (read-excel-file lo lee).
 * Los textos van como «inlineStr»; los números como número; el encabezado en negrita y fijo.
 */

export type XCell = string | number | boolean | null | undefined;
export type XSheet = { name: string; head: string[]; rows: XCell[][]; widths?: number[] };

const enc = new TextEncoder();
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Caracteres de control que Excel no acepta.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Nombre de hoja válido y único (máx. 31, sin : \ / ? * [ ]). */
function sheetNames(sheets: XSheet[]) {
  const used = new Set<string>();
  return sheets.map((s) => {
    const base = (s.name.replace(/[:\\/?*[\]]/g, " ").trim() || "Hoja").slice(0, 31);
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${k++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetXml(s: XSheet) {
  const cell = (v: XCell, r: number, c: number, style = 0) => {
    const ref = `${colName(c)}${r}`;
    const st = style ? ` s="${style}"` : "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    if (v === null || v === undefined || v === "") return "";
    const t = typeof v === "boolean" ? (v ? "Sí" : "No") : String(v);
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
  };
  const widths = s.head.map((h, i) => s.widths?.[i] ?? Math.min(48, Math.max(10, h.length + 2,
    ...s.rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 1))));
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const head = `<row r="1">${s.head.map((h, c) => cell(h, 1, c, 1)).join("")}</row>`;
  const body = s.rows.map((r, i) => `<row r="${i + 2}">${r.map((v, c) => cell(v, i + 2, c)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `${cols}<sheetData>${head}${body}</sheetData>`
    + (s.rows.length ? `<autoFilter ref="A1:${colName(Math.max(0, s.head.length - 1))}${s.rows.length + 1}"/>` : "")
    + `</worksheet>`;
}

// ---- ZIP sin compresión (método 0) ------------------------------------------------
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
function zip(files: Array<[string, string]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text), nb = enc.encode(name), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nb.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true); dir.setUint16(28, nb.length, true);
    dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nb, data);
    central.push(new Uint8Array(dir.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/** Libro de Excel con varias hojas, listo para descargar. */
export function buildXlsx(sheets: XSheet[]): Uint8Array {
  const list = sheets.length ? sheets : [{ name: "Hoja", head: ["Sin datos"], rows: [] }];
  const names = sheetNames(list);
  const files: Array<[string, string]> = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
      + `</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
      + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
      + `</sheets>`
      + (list.some((s) => s.rows.length) ? `<definedNames>${list.map((s, i) => s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$1:$${colName(Math.max(0, s.head.length - 1))}$${s.rows.length + 1}</definedName>` : "").join("")}</definedNames>` : "")
      + `</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`
      + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6D28D9"/><bgColor indexed="64"/></patternFill></fill></fills>`
      + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...list.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ];
  return zip(files);
}

/** Descarga el libro en el navegador. */
export function downloadXlsx(fileName: string, sheets: XSheet[]) {
  const bytes = buildXlsx(sheets);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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
