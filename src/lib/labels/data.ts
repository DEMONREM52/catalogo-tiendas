/**
 * Variables de las etiquetas: {nombre}, {referencia}, {precio}…
 *
 * Reglas (seguras: nunca se ejecuta código del usuario):
 *  - «{campo}» se cambia por el valor de ese campo; si no existe o está vacío, por nada (nunca «undefined»).
 *  - «{campo1|campo2}» usa el primero que tenga valor (valor alternativo).
 *  - «{campo|"texto"}» usa el texto entre comillas si el campo está vacío.
 *  - Lo que no está entre llaves sale tal cual. «{{» y «}}» escriben una llave.
 */

export type LabelData = Record<string, string>;

export type VariableDef = { key: string; label: string; group: "Producto" | "Precios" | "Tienda" | "Enlaces" | "Otros"; sample: string };

/** Las variables que ofrece el editor (las que no están en LabelData salen vacías). */
export const VARIABLES: VariableDef[] = [
  { key: "nombre", label: "Nombre del producto", group: "Producto", sample: "MALUMETA DE 6.5 PULGADAS RYL002" },
  { key: "referencia", label: "Referencia (código del producto)", group: "Producto", sample: "RYL002" },
  { key: "barras", label: "Código de barras", group: "Producto", sample: "7701234567890" },
  { key: "codigo", label: "Código de barras o, si no tiene, referencia", group: "Producto", sample: "RYL002" },
  { key: "numero", label: "N.º del producto en RemHub", group: "Producto", sample: "529" },
  { key: "descripcion", label: "Descripción", group: "Producto", sample: "Maleta de 6,5 pulgadas" },
  { key: "categoria", label: "Categoría", group: "Producto", sample: "MALETAS" },
  { key: "precio", label: "Precio elegido al imprimir", group: "Precios", sample: "$330.000" },
  { key: "precio1", label: "Precio 1", group: "Precios", sample: "$330.000" },
  { key: "precio2", label: "Precio 2 (por mayor)", group: "Precios", sample: "$300.000" },
  { key: "precio3", label: "Precio 3 (detal)", group: "Precios", sample: "$330.000" },
  { key: "precio4", label: "Precio 4", group: "Precios", sample: "$320.000" },
  { key: "precio5", label: "Precio 5", group: "Precios", sample: "$310.000" },
  { key: "tienda", label: "Nombre de la tienda", group: "Tienda", sample: "LA VITRINA" },
  { key: "punto", label: "Punto de los precios", group: "Tienda", sample: "P. LA VITRINA 514" },
  { key: "whatsapp", label: "WhatsApp de la tienda", group: "Tienda", sample: "300 123 4567" },
  { key: "url_producto", label: "Enlace del producto en el catálogo", group: "Enlaces", sample: "https://remhub.co/lavitrina/producto/529" },
  { key: "url_whatsapp", label: "Enlace a WhatsApp de la tienda", group: "Enlaces", sample: "https://wa.me/573001234567" },
  { key: "fecha", label: "Fecha de hoy (DD/MM/AAAA)", group: "Otros", sample: "27/11/2026" },
  { key: "consecutivo", label: "Consecutivo de la etiqueta (1, 2, 3…)", group: "Otros", sample: "1" },
];

/** Datos de ejemplo (para diseñar sin elegir un producto). */
export const SAMPLE_DATA: LabelData = Object.fromEntries(VARIABLES.map((v) => [v.key, v.sample]));

const MAX_OUT = 4000;

/** Cambia las variables por sus valores. Nunca falla ni devuelve «undefined». */
export function resolveTokens(template: string, data: LabelData): string {
  const src = String(template ?? "");
  let out = "";
  for (let i = 0; i < src.length && out.length < MAX_OUT; i++) {
    const ch = src[i];
    if (ch === "{" && src[i + 1] === "{") { out += "{"; i++; continue; }
    if (ch === "}" && src[i + 1] === "}") { out += "}"; i++; continue; }
    if (ch !== "{") { out += ch; continue; }
    const end = src.indexOf("}", i + 1);
    if (end < 0) { out += src.slice(i); break; }
    out += pick(src.slice(i + 1, end), data);
    i = end;
  }
  return out.slice(0, MAX_OUT);
}

function pick(expr: string, data: LabelData): string {
  for (const raw of expr.split("|")) {
    const part = raw.trim();
    const quoted = /^"(.*)"$/.exec(part);
    if (quoted) return quoted[1];
    const key = part.toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(key)) continue;
    const v = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : "";
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return "";
}

/** Variables que usa un texto (para avisar si alguna no existe). */
export function tokensIn(template: string): string[] {
  const out: string[] = [];
  for (const m of String(template ?? "").replace(/\{\{|\}\}/g, "").matchAll(/\{([^}]*)\}/g)) {
    for (const p of m[1].split("|")) {
      const k = p.trim().toLowerCase();
      if (/^[a-z0-9_]{1,40}$/.test(k)) out.push(k);
    }
  }
  return out;
}

/** «$330.000» (pesos, sin decimales, como en Colombia). */
export function fmtLabelMoney(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  if (!Number.isFinite(v)) return "";
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** DD/MM/AAAA. */
export function fmtLabelDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Enlace de WhatsApp a partir de un número colombiano o internacional. */
export function whatsappUrl(phone: string | null | undefined, message?: string): string {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("3")) digits = `57${digits}`;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

export type ProductForLabel = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  product_no?: number | null;
  description?: string | null;
  category?: string | null;
  prices: number[];
};

/** Los datos de un producto para sus etiquetas (sin costos: las etiquetas son públicas). */
export function productLabelData(p: ProductForLabel, ctx: { store: string; point?: string; whatsapp?: string; productUrl?: string; level: number; today?: Date; seq?: number }): LabelData {
  const prices = p.prices.map((v) => fmtLabelMoney(v));
  const sku = (p.sku ?? "").trim();
  const barcode = (p.barcode ?? "").trim();
  return {
    nombre: p.name ?? "",
    referencia: sku,
    barras: barcode,
    codigo: barcode || sku,
    numero: p.product_no ? String(p.product_no) : "",
    descripcion: String(p.description ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
    categoria: p.category ?? "",
    precio: prices[Math.min(4, Math.max(0, ctx.level - 1))] ?? "",
    precio1: prices[0] ?? "", precio2: prices[1] ?? "", precio3: prices[2] ?? "", precio4: prices[3] ?? "", precio5: prices[4] ?? "",
    tienda: ctx.store,
    punto: ctx.point ?? "",
    whatsapp: ctx.whatsapp ?? "",
    url_producto: ctx.productUrl ?? "",
    url_whatsapp: whatsappUrl(ctx.whatsapp),
    fecha: fmtLabelDate(ctx.today ?? new Date()),
    consecutivo: ctx.seq ? String(ctx.seq) : "",
  };
}
