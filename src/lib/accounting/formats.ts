// Formatos de importación de los programas contables más usados en Colombia, y el formato propio.
// Los de cada programa siguen sus plantillas de importación de movimiento contable; como cada versión y cada
// contador las ajusta, todos se pueden copiar como «formato propio» y cambiar columna por columna.
import type { Column, CustomFormat, Field, FormatSpec } from "./config";
import type { JLine } from "./journal";

const c = (header: string, field: Field, fixed?: string): Column => (fixed === undefined ? { header, field } : { header, field, fixed });

export const BUILTIN_FORMATS: FormatSpec[] = [
  {
    id: "generico", name: "Genérico (libro diario)", program: "Cualquier programa",
    note: "Un renglón por cada débito o crédito. Lo abre cualquier contador en Excel y sirve para importar en casi cualquier programa.",
    file: "xlsx", separator: ";", date: "dd/mm/yyyy", decimal: ",", headers: true,
    columns: [c("Fecha", "date"), c("Comprobante", "doc_code"), c("Número", "doc_number"), c("Documento soporte", "doc_ref"), c("Cuenta", "account"),
      c("NIT tercero", "third_id"), c("Nombre tercero", "third_name"), c("Detalle", "description"), c("Centro de costo", "cost_center"),
      c("Débito", "debit"), c("Crédito", "credit"), c("Base", "base"), c("Vence", "due_date")],
  },
  {
    id: "siigo_nube", name: "Siigo Nube", program: "Siigo Nube",
    note: "Plantilla «Importación de comprobantes contables». En Siigo crea antes los tipos de comprobante (los códigos de abajo) y los terceros.",
    file: "xlsx", separator: ";", date: "dd/mm/yyyy", decimal: ",", headers: true,
    columns: [c("Tipo de comprobante", "doc_code"), c("Consecutivo comprobante", "doc_number"), c("Fecha de elaboración", "date"),
      c("Sigla moneda", "fixed", ""), c("Tasa de cambio", "fixed", ""), c("Código cuenta contable", "account"), c("Identificación tercero", "third_id"),
      c("Sucursal", "fixed", ""), c("Código producto", "blank"), c("Código de bodega", "blank"), c("Acción", "blank"), c("Cantidad producto", "blank"),
      c("Prefijo", "blank"), c("Consecutivo", "doc_ref"), c("No. cuota", "blank"), c("Fecha vencimiento", "due_date"), c("Código impuesto", "blank"),
      c("Código grupo activo fijo", "blank"), c("Código activo fijo", "blank"), c("Descripción", "description"), c("Código centro/subcentro de costos", "cost_center"),
      c("Débito", "debit"), c("Crédito", "credit"), c("Observaciones", "blank"), c("Base gravable libro compras/ventas", "base"),
      c("Base exenta libro compras/ventas", "blank"), c("Mes de cierre", "blank")],
  },
  {
    id: "siigo_pyme", name: "Siigo Pyme (escritorio)", program: "Siigo Pyme / Contador",
    note: "Interfaz de movimiento contable de Siigo Windows: un renglón por secuencia con naturaleza D o C. El tipo de comprobante es la letra y el código su número.",
    file: "xlsx", separator: ";", date: "yyyymmdd", decimal: ".", headers: true,
    columns: [c("TIPO DE COMPROBANTE", "doc_code"), c("CÓDIGO COMPROBANTE", "fixed", "1"), c("NÚMERO DE DOCUMENTO", "doc_number"), c("CUENTA CONTABLE", "account"),
      c("DÉBITO O CRÉDITO", "nature"), c("VALOR DE LA SECUENCIA", "amount"), c("AÑO DEL DOCUMENTO", "year"), c("MES DEL DOCUMENTO", "month"),
      c("DÍA DEL DOCUMENTO", "day"), c("SECUENCIA", "seq"), c("CENTRO DE COSTO", "cost_center"), c("NIT", "third_id"), c("DESCRIPCIÓN DE LA SECUENCIA", "description"),
      c("BASE DE RETENCIÓN", "base"), c("FECHA VENCIMIENTO", "due_date")],
  },
  {
    id: "world_office", name: "World Office", program: "World Office (escritorio y nube)",
    note: "Plantilla de importación de documentos contables (encabezado y detalle en el mismo renglón). En «Empresa» va el nombre corto con que el contador creó la empresa.",
    file: "xlsx", separator: ";", date: "dd/mm/yyyy", decimal: ",", headers: true,
    columns: [c("Encab: Empresa", "fixed", ""), c("Encab: Tipo Documento", "doc_code"), c("Encab: Prefijo", "blank"), c("Encab: Documento Número", "doc_number"),
      c("Encab: Fecha", "date"), c("Encab: Tercero Interno", "fixed", ""), c("Encab: Tercero Externo", "third_id"), c("Encab: Nota", "doc_ref"),
      c("Encab: FormaPago", "blank"), c("Encab: Verificado", "fixed", "0"), c("Encab: Anulado", "fixed", "0"),
      c("Detalle Contab: Cuenta Contable", "account"), c("Detalle Contab: Nota", "description"), c("Detalle Contab: Tercero Externo", "third_id"),
      c("Detalle Contab: Centro de Costos", "cost_center"), c("Detalle Contab: Débito", "debit"), c("Detalle Contab: Crédito", "credit"),
      c("Detalle Contab: Base", "base"), c("Detalle Contab: Vencimiento", "due_date")],
  },
  {
    id: "alegra", name: "Alegra", program: "Alegra Contabilidad",
    note: "Importación de comprobantes contables (asientos manuales) desde Excel. Los terceros deben existir en Alegra con la misma identificación.",
    file: "xlsx", separator: ",", date: "dd/mm/yyyy", decimal: ".", headers: true,
    columns: [c("Fecha", "date"), c("Tipo de comprobante", "doc_code"), c("Número", "doc_number"), c("Cuenta contable", "account"),
      c("Identificación del tercero", "third_id"), c("Nombre del tercero", "third_name"), c("Descripción", "description"),
      c("Centro de costo", "cost_center"), c("Débito", "debit"), c("Crédito", "credit"), c("Observaciones", "doc_ref")],
  },
  {
    id: "helisa", name: "Helisa", program: "Helisa NIIF",
    note: "Archivo plano de movimiento contable separado por punto y coma, sin encabezados, para la utilidad de importación de Helisa.",
    file: "txt", separator: ";", date: "yyyymmdd", decimal: ".", headers: false,
    columns: [c("Comprobante", "doc_code"), c("Número", "doc_number"), c("Fecha", "date"), c("Cuenta", "account"), c("NIT", "third_id"),
      c("Centro de costo", "cost_center"), c("Detalle", "description"), c("Documento referencia", "doc_ref"), c("Débito", "debit"), c("Crédito", "credit"), c("Base", "base")],
  },
  {
    id: "contapyme", name: "ContaPyme", program: "ContaPyme / AgroWin",
    note: "Movimiento contable para la importación desde Excel de ContaPyme (operaciones contables).",
    file: "xlsx", separator: ";", date: "dd/mm/yyyy", decimal: ",", headers: true,
    columns: [c("Tipo documento", "doc_code"), c("Número documento", "doc_number"), c("Fecha", "date"), c("Cuenta", "account"), c("Tercero", "third_id"),
      c("Centro de costos", "cost_center"), c("Descripción", "description"), c("Documento cruce", "doc_ref"), c("Fecha vencimiento", "due_date"),
      c("Débito", "debit"), c("Crédito", "credit"), c("Base", "base")],
  },
  {
    id: "csv_universal", name: "CSV universal", program: "Otro programa (SAG, Novasoft, Ofimática, Loggro…)",
    note: "Texto separado por punto y coma con el libro diario completo. Casi todos los programas lo importan; si el tuyo pide otro orden, cópialo como formato propio.",
    file: "csv", separator: ";", date: "dd/mm/yyyy", decimal: ",", headers: true,
    columns: [c("FECHA", "date"), c("COMPROBANTE", "doc_code"), c("NUMERO", "doc_number"), c("SECUENCIA", "seq"), c("CUENTA", "account"), c("NIT", "third_id"),
      c("NOMBRE", "third_name"), c("DETALLE", "description"), c("CENTRO_COSTO", "cost_center"), c("DEBITO", "debit"), c("CREDITO", "credit"),
      c("BASE", "base"), c("DOC_REFERENCIA", "doc_ref"), c("VENCE", "due_date")],
  },
];

export const FIELD_LABELS: Record<Field, string> = {
  doc_code: "Tipo de comprobante", prefix: "Prefijo", doc_number: "Número del documento", date: "Fecha", year: "Año", month: "Mes", day: "Día",
  account: "Cuenta contable", third_id: "Identificación del tercero", third_dv: "Dígito de verificación", third_name: "Nombre del tercero",
  description: "Detalle", debit: "Débito", credit: "Crédito", amount: "Valor (sin signo)", nature: "Naturaleza (D/C)", base: "Base",
  cost_center: "Centro de costo", due_date: "Fecha de vencimiento", seq: "Secuencia (1, 2, 3…)", doc_ref: "Documento soporte", blank: "Vacía", fixed: "Valor fijo",
};

export function allFormats(custom: CustomFormat[]): FormatSpec[] {
  return [...BUILTIN_FORMATS, ...custom];
}

function fmtDate(iso: string, f: FormatSpec["date"]) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return f === "yyyy-mm-dd" ? `${y}-${m}-${d}` : f === "yyyymmdd" ? `${y}${m}${d}` : f === "dd-mm-yyyy" ? `${d}-${m}-${y}` : f === "mm/dd/yyyy" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

/** Dígito de verificación de la DIAN para un NIT (módulo 11). */
export function nitDv(nit: string) {
  const digits = nit.replace(/\D/g, "");
  if (!digits) return "";
  const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  for (let i = 0; i < digits.length && i < w.length; i++) sum += Number(digits[digits.length - 1 - i]) * w[i];
  const r = sum % 11;
  return String(r > 1 ? 11 - r : r);
}

/** Valor de una columna para un renglón (número o texto). */
export function cell(l: JLine, col: Column, f: FormatSpec): string | number {
  const date = l.date.slice(0, 10);
  switch (col.field) {
    case "doc_code": return l.docCode;
    case "prefix": return "";
    case "doc_number": return l.docNumber;
    case "doc_ref": return l.docRef;
    case "date": return fmtDate(date, f.date);
    case "year": return Number(date.slice(0, 4));
    case "month": return Number(date.slice(5, 7));
    case "day": return Number(date.slice(8, 10));
    case "account": return l.account;
    case "third_id": return l.thirdId;
    case "third_dv": return nitDv(l.thirdId);
    case "third_name": return l.thirdName;
    case "description": return l.description.slice(0, 250);
    case "debit": return l.debit;
    case "credit": return l.credit;
    case "amount": return l.debit || l.credit;
    case "nature": return l.debit ? "D" : "C";
    case "base": return l.base || "";
    case "cost_center": return l.costCenter;
    case "due_date": return l.dueDate ? fmtDate(l.dueDate, f.date) : "";
    case "seq": return l.seq;
    case "fixed": return col.fixed ?? "";
    default: return "";
  }
}

export function formatRows(lines: JLine[], f: FormatSpec): Array<Array<string | number>> {
  return lines.map((l) => f.columns.map((col) => cell(l, col, f)));
}

/** Archivo de texto (CSV o plano): números con el separador decimal elegido, sin miles. */
export function formatText(lines: JLine[], f: FormatSpec): string {
  const sep = f.separator;
  const q = (v: string | number) => {
    const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)).replace(".", f.decimal) : String(v ?? "");
    return s.includes(sep) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = formatRows(lines, f).map((r) => r.map(q).join(sep));
  if (f.headers) out.unshift(f.columns.map((col) => q(col.header)).join(sep));
  return out.join("\r\n") + "\r\n";
}

/** Copia editable de un formato (para el «formato propio»). */
export function cloneFormat(f: FormatSpec, name: string): CustomFormat {
  return { ...f, id: `propio_${Math.random().toString(36).slice(2, 8)}`, name, program: `Propio (basado en ${f.name})`, columns: f.columns.map((x) => ({ ...x })), custom: true };
}
