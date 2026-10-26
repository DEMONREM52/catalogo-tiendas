/**
 * Lee la factura electrónica de un proveedor (XML UBL 2.1 de la DIAN) para llenar el ingreso de compra.
 * Acepta la factura sola (<Invoice>) o el «AttachedDocument» que llega por correo, que trae la factura
 * dentro (en un CDATA). No usa el navegador: funciona igual en pruebas.
 */
export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export type DianLine = {
  line: number;
  description: string;
  /** Código del proveedor (SellersItemIdentification) y código estándar / de barras (StandardItemIdentification). */
  sellerCode: string | null;
  standardCode: string | null;
  qty: number;
  /** Costo unitario antes de IVA (valor de la línea ÷ cantidad: ya trae los descuentos). */
  unitCost: number;
  taxRate: number;
  lineTotal: number;
};
export type DianInvoice = {
  number: string;
  cufe: string | null;
  issueDate: string;
  dueDate: string | null;
  /** 1 = contado, 2 = crédito (PaymentMeans/ID). */
  credit: boolean;
  supplier: { nit: string; dv: string | null; name: string; email: string | null; phone: string | null; address: string | null };
  buyerNit: string | null;
  lines: DianLine[];
  subtotal: number;
  tax: number;
  total: number;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);
const local = (name: string) => name.slice(name.indexOf(":") + 1);

/** Lector XML mínimo (elementos, atributos, texto y CDATA): suficiente para UBL. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decode(xml.slice(i, lt));
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      stack[stack.length - 1].text += xml.slice(lt + 9, end < 0 ? xml.length : end);
      i = end < 0 ? xml.length : end + 3;
    } else if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      i = end < 0 ? xml.length : end + 3;
    } else if (xml[lt + 1] === "?" || xml[lt + 1] === "!") {
      const end = xml.indexOf(">", lt);
      i = end < 0 ? xml.length : end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      if (stack.length > 1) stack.pop();
      i = end < 0 ? xml.length : end + 1;
    } else {
      // Etiqueta de apertura (los atributos pueden traer «>» entre comillas).
      let j = lt + 1;
      let quote = "";
      while (j < xml.length) {
        const c = xml[j];
        if (quote) { if (c === quote) quote = ""; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      const body = xml.slice(lt + 1, j);
      const self = body.endsWith("/");
      const clean = self ? body.slice(0, -1) : body;
      const name = clean.match(/^[^\s/>]+/)?.[0] ?? "";
      const attrs: Record<string, string> = {};
      for (const m of clean.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[local(m[1])] = decode(m[3] ?? m[4] ?? "");
      const node: XmlNode = { name: local(name), attrs, children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!self) stack.push(node);
      i = j + 1;
    }
  }
  return root;
}

const kids = (n: XmlNode | undefined, name: string) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n: XmlNode | undefined, ...path: string[]): XmlNode | undefined => {
  let cur = n;
  for (const p of path) cur = cur?.children.find((c) => c.name === p);
  return cur;
};
const txt = (n: XmlNode | undefined, ...path: string[]) => {
  const v = kid(n, ...path)?.text.trim();
  return v ? v : null;
};
const num = (v: string | null | undefined) => {
  const x = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
function find(n: XmlNode, name: string): XmlNode | undefined {
  if (n.name === name) return n;
  for (const c of n.children) {
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

/** De un «AttachedDocument» saca la factura que trae adentro; si ya es la factura, la devuelve. */
function invoiceNode(xml: string): XmlNode {
  const root = parseXml(xml);
  const inv = find(root, "Invoice");
  if (inv) return inv;
  const attached = find(root, "AttachedDocument");
  if (attached) {
    // La factura va como texto (CDATA) en Attachment/ExternalReference/Description.
    const desc = kid(find(attached, "Attachment"), "ExternalReference", "Description")?.text ?? "";
    if (desc.includes("<")) {
      const inner = find(parseXml(desc), "Invoice");
      if (inner) return inner;
    }
  }
  const credit = find(root, "CreditNote");
  if (credit) throw new Error("Ese XML es una nota crédito, no una factura de compra.");
  throw new Error("Ese archivo no es una factura electrónica de la DIAN (no trae <Invoice>).");
}

function party(p: XmlNode | undefined) {
  const party = kid(p, "Party");
  const tax = kid(party, "PartyTaxScheme");
  const legal = kid(party, "PartyLegalEntity");
  const idNode = kid(tax, "CompanyID") ?? kid(legal, "CompanyID");
  return {
    nit: (idNode?.text ?? "").replace(/\D/g, ""),
    dv: idNode?.attrs.schemeID ?? null,
    name: txt(tax, "RegistrationName") ?? txt(legal, "RegistrationName") ?? txt(party, "PartyName", "Name") ?? "Proveedor",
    email: txt(party, "Contact", "ElectronicMail"),
    phone: txt(party, "Contact", "Telephone"),
    address: txt(kid(tax, "RegistrationAddress") ?? kid(party, "PhysicalLocation", "Address"), "AddressLine", "Line"),
  };
}

export function parseDianInvoice(xml: string): DianInvoice {
  const inv = invoiceNode(xml);
  const lines = kids(inv, "InvoiceLine").map((l, idx): DianLine => {
    const qty = num(txt(l, "InvoicedQuantity")) || 1;
    const lineTotal = num(txt(l, "LineExtensionAmount"));
    const price = num(txt(l, "Price", "PriceAmount"));
    const item = kid(l, "Item");
    const rate = num(txt(kid(l, "TaxTotal", "TaxSubtotal"), "TaxCategory", "Percent") ?? txt(l, "TaxTotal", "TaxSubtotal", "Percent"));
    return {
      line: num(txt(l, "ID")) || idx + 1,
      description: (txt(item, "Description") ?? txt(item, "Name") ?? `Producto ${idx + 1}`).replace(/\s+/g, " "),
      sellerCode: txt(item, "SellersItemIdentification", "ID"),
      standardCode: txt(item, "StandardItemIdentification", "ID"),
      qty,
      unitCost: Math.round(((lineTotal || price * qty) / qty) * 100) / 100,
      taxRate: rate,
      lineTotal: lineTotal || price * qty,
    };
  });
  const totals = kid(inv, "LegalMonetaryTotal");
  const subtotal = num(txt(totals, "LineExtensionAmount")) || lines.reduce((s, l) => s + l.lineTotal, 0);
  const total = num(txt(totals, "PayableAmount"));
  const meansId = txt(inv, "PaymentMeans", "ID");
  const dueDate = txt(inv, "DueDate") ?? txt(inv, "PaymentMeans", "PaymentDueDate");
  const issueDate = txt(inv, "IssueDate") ?? new Date().toISOString().slice(0, 10);
  return {
    number: txt(inv, "ID") ?? "",
    cufe: txt(inv, "UUID"),
    issueDate,
    dueDate,
    credit: meansId === "2" || Boolean(dueDate && dueDate > issueDate),
    supplier: party(kid(inv, "AccountingSupplierParty")),
    buyerNit: party(kid(inv, "AccountingCustomerParty")).nit || null,
    lines,
    subtotal,
    tax: num(txt(inv, "TaxTotal", "TaxAmount")) || Math.max(0, total - subtotal),
    total: total || subtotal,
  };
}

/** Lee un .zip en el navegador (sin librerías) y devuelve el primer .xml de adentro. */
export async function xmlFromZip(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("El ZIP no es válido.");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const offset = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;
    if (!/\.xml$/i.test(name)) continue;
    const lNameLen = view.getUint16(offset + 26, true);
    const lExtra = view.getUint16(offset + 28, true);
    const data = bytes.subarray(offset + 30 + lNameLen + lExtra, offset + 30 + lNameLen + lExtra + size);
    if (method === 0) return dec.decode(data);
    if (method === 8) {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return dec.decode(await new Response(stream).arrayBuffer());
    }
  }
  throw new Error("El ZIP no trae el XML de la factura.");
}

/** Texto para comparar nombres sin tildes, mayúsculas ni signos. */
export const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
