// Adaptador de Alanube (API «e-Provider» de Alegra para Colombia).
// Documentación: https://developer.alanube.co/v1.0-COL/docs/informacion-general
//   · Pruebas:     https://sandbox-api.alegra.com/e-provider/col/v1  (habilitación de la DIAN)
//   · Producción:  https://api.alegra.com/e-provider/col/v1          (DIAN real)
//   · Autenticación: «Authorization: Bearer <token de la cuenta de Alanube>».
//   · Cada NIT emisor es una «compañía» en Alanube: su id va en «Identificador de la empresa en el proveedor».
//   · Emisión: POST /invoices · /equivalent-documents/pos · /credit-notes · /debit-notes · /adjustment-note-equivalent-documents
//              · /support-documents · /adjustment-note-support-documents (documento soporte a no obligados)
//     Respuesta: status (REGISTERED, WAITING_RESPONSE, FAILED, SENT) + legalStatus (ACCEPTED, ACCEPTED_WITH_OBSERVATIONS, REJECTED).
//     WAITING_RESPONSE no se reenvía: se consulta. FAILED sí se reenvía. SENT no es aceptación: manda legalStatus.
//   · Idempotency-Key (UUID v4): el mismo intento usa la misma llave; reintentar no duplica el documento.
//   · Archivos: files.zip (enlace firmado de 60 min) con el AttachedDocument XML y el PDF. No se guarda el enlace.
//   · Webhooks por compañía (POST con los headers que configuremos): se valida un secreto en «x-remhub-webhook».
import { createHash, timingSafeEqual } from "node:crypto";
import {
  BaseInvoicingProvider,
  ProviderError,
  type ClaimedDocument,
  type ClaimedLine,
  type CredentialField,
  type IssuerSnapshot,
  type ParsedWebhook,
  type ProviderCapabilities,
  type ProviderContext,
  type ProviderFile,
  type ProviderHealth,
  type ProviderResult,
  type WebhookInput,
  type WebhookVerification,
} from "../provider";
import { PROVIDER_CREDENTIAL_FIELDS } from "../provider-fields";
import { readZip } from "../zip";

const BASE = { sandbox: "https://sandbox-api.alegra.com/e-provider/col/v1", production: "https://api.alegra.com/e-provider/col/v1" } as const;
export const ALANUBE_WEBHOOK_HEADER = "x-remhub-webhook";

// ---------------------------------------------------------------- tablas DIAN
/** Tipo de documento de identificación (tabla DIAN). */
const ID_TYPE: Record<string, string> = { RC: "11", TI: "12", CC: "13", TE: "21", CE: "22", NIT: "31", PP: "41", PAS: "41", DIE: "42", PEP: "47", PPT: "48", NIT_EXT: "50", OTRO: "13" };
/** Medio de pago (tabla DIAN). */
function paymentMethod(method: string | null | undefined): string {
  const m = (method ?? "").toLowerCase();
  if (/efectivo|cash/.test(m)) return "10";
  if (/cr[eé]dito.*tarjeta|tarjeta.*cr[eé]dito|credit_card/.test(m)) return "48";
  if (/d[eé]bito|tarjeta|card|dat[aá]fono/.test(m)) return "49";
  if (/transfer|nequi|daviplata|bre-?b|pse|qr/.test(m)) return "47";
  if (/consignaci/.test(m)) return "42";
  if (/cheque/.test(m)) return "20";
  return m ? "ZZZ" : "10";
}
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/** Fecha (AAAA-MM-DD) en hora de Colombia: un documento de las 8 p. m. no debe quedar con la fecha del día siguiente (UTC). */
const BOGOTA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
const bogotaDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : BOGOTA_DAY.format(new Date(iso)));

function issuerTaxCode(issuer: IssuerSnapshot): string {
  // 01 = IVA (responsable); ZZ = no aplica (no responsable de IVA).
  const r = (issuer.tax_responsibilities ?? []).join(";").toUpperCase();
  return /R-99-PN/.test(r) && !/O-/.test(r) ? "ZZ" : "01";
}

function companyBlock(issuer: IssuerSnapshot, companyId: string) {
  return {
    id: companyId,
    organizationType: issuer.person_type === "juridica" ? 1 : 2,
    identificationType: ID_TYPE[issuer.document_type] ?? "31",
    identificationNumber: digits(issuer.document_number),
    ...(issuer.verification_digit ? { dv: String(issuer.verification_digit) } : {}),
    name: issuer.legal_name,
    ...(issuer.trade_name ? { tradeName: issuer.trade_name } : {}),
    regimeCode: (issuer.tax_responsibilities?.length ? issuer.tax_responsibilities.join(";") : issuer.tax_regime) || "R-99-PN",
    taxCode: { id: issuerTaxCode(issuer) },
    ...(issuer.email ? { email: issuer.email } : {}),
    ...(issuer.phone ? { phone: issuer.phone } : {}),
    address: {
      address: issuer.fiscal_address ?? "",
      city: issuer.city_code ?? "",
      department: issuer.department_code ?? "",
      ...(issuer.postal_code ? { postalCode: issuer.postal_code } : {}),
      country: issuer.country || "CO",
    },
  };
}

function customerBlock(doc: ClaimedDocument) {
  const c = doc.document.customer;
  const final = c.final_consumer || !digits(c.document_number) || digits(c.document_number) === "222222222222";
  return {
    name: final ? "CONSUMIDOR FINAL" : c.name,
    organizationType: c.person_type === "juridica" ? 1 : 2,
    identificationType: final ? "13" : ID_TYPE[c.document_type] ?? "13",
    identificationNumber: final ? "222222222222" : digits(c.document_number),
    ...(!final && c.verification_digit ? { dv: String(c.verification_digit) } : {}),
    ...(c.trade_name ? { tradeName: c.trade_name } : {}),
    regimeCode: c.tax_regime || "R-99-PN",
    taxCode: { id: c.is_tax_responsible ? "01" : "ZZ" },
    ...(c.email ? { email: c.email } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(!final && c.address ? { address: { address: c.address, city: c.city ?? "", department: c.department ?? "", country: c.country || "CO" } } : {}),
  };
}

/**
 * Proveedor del documento soporte (va en «customer» del documento). En el DS la DIAN no acepta la cédula (13):
 * la persona natural se identifica con su NIT, que es la misma cédula con su dígito de verificación.
 */
function supplierBlock(doc: ClaimedDocument) {
  const c = doc.document.customer as ClaimedDocument["document"]["customer"] & { origin?: string | null; postal_code?: string | null };
  const idType = c.document_type === "CC" ? "31" : ID_TYPE[c.document_type] ?? "31";
  const city = digits(c.city);
  return {
    name: c.name,
    origin: c.origin === "11" ? "11" : "10",
    organizationType: c.person_type === "juridica" ? 1 : 2,
    identificationType: idType,
    identificationNumber: digits(c.document_number),
    ...(idType === "31" && c.verification_digit ? { dv: String(c.verification_digit) } : {}),
    regimeCode: c.tax_regime || "R-99-PN",
    taxCode: c.is_tax_responsible ? "01" : "ZZ",
    ...(c.email ? { email: c.email } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    address: { address: c.address ?? "", city, department: city.slice(0, 2), ...(c.postal_code ? { postalCode: String(c.postal_code) } : {}), country: c.country || "CO" },
  };
}

function itemsBlock(lines: ClaimedLine[]) {
  return lines.map((l) => {
    const discount = num(l.discount);
    const subtotal = num(l.line_subtotal);
    const qty = Number(l.qty);
    // Precio unitario ANTES de impuestos (la DIAN valida precio × cantidad − descuento = subtotal).
    const price = num((subtotal + discount) / (qty || 1));
    const taxed = Number(l.tax_rate) > 0;
    return {
      code: { identificationId: (l.sku || String(l.line_no)).slice(0, 50), id: "999" },
      description: l.description.slice(0, 300),
      price,
      ...(discount ? { discount: num((discount / Math.max(0.01, subtotal + discount)) * 100), discountAmount: discount } : { discount: 0, discountAmount: 0 }),
      quantity: qty,
      unitCode: l.unit_code || "94",
      subtotal,
      taxAmount: num(l.line_tax),
      total: num(l.line_total),
      ...(taxed ? { taxes: [{ taxCode: "01", taxAmount: num(l.line_tax), taxPercentage: Number(l.tax_rate).toFixed(2), taxableAmount: subtotal }] } : {}),
    };
  });
}

function totalsBlock(lines: ClaimedLine[], doc: ClaimedDocument) {
  const gross = num(lines.reduce((s, l) => s + Number(l.line_subtotal), 0));
  const taxable = num(lines.filter((l) => Number(l.tax_rate) > 0).reduce((s, l) => s + Number(l.line_subtotal), 0));
  const tax = num(lines.reduce((s, l) => s + Number(l.line_tax), 0));
  return { grossTotal: gross, taxableTotal: taxable, taxTotal: tax, discountTotal: 0, chargeTotal: 0, advanceTotal: 0, payableTotal: num(gross + tax), currencyCode: doc.document.currency || "COP" };
}

function paymentsBlock(doc: ClaimedDocument) {
  const credit = doc.document.payment_form === "credit";
  return [{
    paymentForm: credit ? "2" : "1",
    paymentMethod: paymentMethod(doc.document.payment_method),
    ...(credit ? { paymentDueDate: doc.document.due_date ?? bogotaDate(doc.document.issue_date) } : {}),
  }];
}

function resolutionBlock(doc: ClaimedDocument, ctx: ProviderContext, withKey: boolean) {
  const r = doc.range;
  return {
    resolutionNumber: r.resolution_number ?? "",
    ...(r.prefix ? { prefix: r.prefix } : {}),
    minNumber: Number(r.range_from),
    maxNumber: Number(r.range_to),
    startDate: bogotaDate(r.valid_from ?? r.resolution_date ?? doc.document.issue_date),
    endDate: bogotaDate(r.valid_until ?? doc.document.issue_date),
    ...(withKey ? { technicalKey: ctx.technicalKey ?? "" } : {}),
  };
}

/** Número sin prefijo de un consecutivo («FE1234» → 1234). */
const plainNumber = (full: string | null | undefined, prefix?: string | null) => Number(String(full ?? "").replace(prefix ?? "", "").replace(/\D/g, "")) || 0;

/** Llave de idempotencia (UUID v4) estable para un mismo intento del mismo documento. */
function idempotencyKey(doc: ClaimedDocument) {
  return uuidFrom(`${doc.document.id}:${doc.document.attempts}`);
}

/** UUID v4 estable a partir de un texto (misma operación = misma llave). */
export function uuidFrom(seed: string) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------- respuestas
type AlanubeDoc = {
  id?: string; status?: string; legalStatus?: string | null; cufe?: string | null; cude?: string | null; cuds?: string | null; cune?: string | null; fullNumber?: string | null; qrCodeContent?: string | null;
  governmentResponse?: { code?: string; message?: string; errorMessages?: string[] } | null; errors?: Array<{ code?: string; message?: string }>;
};
type AlanubeResponse = { files?: { xml?: string | null; attachedDocument?: string | null; zip?: string | null } | null } & Record<string, unknown>;

/** El documento dentro de la respuesta (cada recurso usa su propia llave). */
function pickDoc(res: Record<string, unknown>): AlanubeDoc | null {
  for (const key of ["invoice", "emission", "payroll", "supportDocument", "adjustmentNoteSupportDocument", "equivalent-document", "equivalentDocument", "equivalent-document-pos", "creditNote", "debitNote", "adjustmentNoteEquivalentdocument", "adjustmentNoteEquivalentDocument"]) {
    const v = res[key];
    if (v && typeof v === "object") return v as AlanubeDoc;
  }
  for (const v of Object.values(res)) if (v && typeof v === "object" && "status" in (v as object) && "id" in (v as object)) return v as AlanubeDoc;
  return null;
}

function toResult(d: AlanubeDoc | null, raw: Record<string, unknown>): ProviderResult {
  if (!d) return { status: "ERROR", error_code: "BAD_RESPONSE", error_message: "Alanube respondió sin el documento.", retryable: true, transmitted: true, payload: raw };
  const gov = d.governmentResponse ?? {};
  const reasons = [...(gov.errorMessages ?? []), ...(d.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim())].filter(Boolean);
  const base = {
    provider_document_id: d.id ?? null,
    provider_status: [d.status, d.legalStatus].filter(Boolean).join(" · ") || null,
    provider_message: gov.message ?? null,
    dian_status: d.legalStatus ?? null,
    dian_message: [gov.message, ...reasons].filter(Boolean).join(" | ").slice(0, 1500) || null,
    cufe: d.cufe ?? d.cude ?? d.cuds ?? d.cune ?? null,
    qr_data: d.qrCodeContent ?? null,
    payload: raw,
  };
  if (d.legalStatus === "ACCEPTED" || d.legalStatus === "ACCEPTED_WITH_OBSERVATIONS") return { ...base, status: "ACCEPTED", transmitted: true };
  if (d.legalStatus === "REJECTED") return { ...base, status: "REJECTED", transmitted: true, error_code: gov.code ?? "DIAN_REJECTED", error_message: reasons.join(" | ").slice(0, 1500) || gov.message || "La DIAN rechazó el documento." };
  // FAILED: falló la emisión y se debe reenviar (nueva llave en el siguiente intento).
  if (d.status === "FAILED") return { ...base, status: "ERROR", transmitted: false, retryable: true, error_code: d.errors?.[0]?.code ?? "FAILED", error_message: reasons.join(" | ") || "La emisión falló en Alanube; se reintentará." };
  // REGISTERED / WAITING_RESPONSE / SENT sin respuesta legal: se espera (webhook o consulta), no se reenvía.
  return { ...base, status: "SENT", transmitted: true };
}

async function api(ctx: ProviderContext, method: string, path: string, body?: unknown, idemKey?: string): Promise<Record<string, unknown>> {
  const token = ctx.credentials.api_token;
  if (!token) throw new ProviderError("Falta el token de Alanube en la cuenta del proveedor.", { code: "CONFIG" });
  const url = `${BASE[ctx.environment] ?? BASE.sandbox}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
        "X-Request-Id": ctx.requestId,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctx.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ProviderError(`No se pudo conectar con Alanube: ${error instanceof Error ? error.message : String(error)}`, { code: "NETWORK", retryable: true, transmitted: method !== "GET" });
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 2000) }; }
  if (res.ok) return json;
  const errs = (Array.isArray(json.errors) ? json.errors : Array.isArray(json) ? json : []) as Array<{ code?: string; message?: string }>;
  const code = errs[0]?.code ?? `HTTP_${res.status}`;
  const message = errs.map((e) => [e.code, e.message].filter(Boolean).join(": ")).join(" | ") || `Alanube respondió ${res.status}.`;
  if (res.status === 401 || res.status === 403) throw new ProviderError(`El token de Alanube no es válido o no tiene acceso (${res.status}).`, { code: "AUTH" });
  // 503 / EPR500 / EPR503: falla con la DIAN o tiempo agotado → reintentar.
  if (res.status >= 500 || /EPR50[03]/.test(code)) throw new ProviderError(message, { code, retryable: true, transmitted: method !== "GET" });
  // 409: la misma operación sigue en curso o su resultado no se pudo registrar → consultar/reintentar con la misma llave.
  if (res.status === 409) throw new ProviderError(message, { code, retryable: true, transmitted: true, cause: json });
  throw new ProviderError(message, { code, retryable: false, transmitted: false });
}

async function downloadZip(url: string | null | undefined): Promise<{ xml: ProviderFile | null; pdf: ProviderFile | null }> {
  if (!url) return { xml: null, pdf: null };
  try {
    // Enlace firmado: sin Authorization (la redirección a S3 lo rechaza).
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { xml: null, pdf: null };
    const entries = readZip(new Uint8Array(await res.arrayBuffer()));
    const xml = entries.find((e) => /\.xml$/i.test(e.name));
    const pdf = entries.find((e) => /\.pdf$/i.test(e.name));
    return {
      xml: xml ? { content: xml.data, contentType: "application/xml", fileName: xml.name } : null,
      pdf: pdf ? { content: pdf.data, contentType: "application/pdf", fileName: pdf.name } : null,
    };
  } catch {
    return { xml: null, pdf: null };
  }
}

function companyIdOf(ctx: ProviderContext): string {
  const id = ctx.account.external_account_id || String(ctx.account.settings?.company_id ?? "");
  if (!id) throw new ProviderError("Falta el identificador de la compañía en Alanube (créala con «Crear empresa en Alanube» o pégalo en la cuenta).", { code: "CONFIG" });
  return id;
}

/** Recurso de Alanube según el tipo de documento (y si la nota corrige un documento POS). */
function resourceOf(doc: ClaimedDocument): { create: string; get: (id: string) => string } {
  const t = doc.document.document_type;
  if (t === "pos_equivalent") return { create: "/equivalent-documents/pos", get: (id) => `/equivalent-documents/${id}` };
  if (t === "credit_note" && doc.related?.document_type === "pos_equivalent") return { create: "/adjustment-note-equivalent-documents", get: (id) => `/adjustment-note-equivalent-documents/${id}` };
  if (t === "credit_note") return { create: "/credit-notes", get: (id) => `/credit-notes/${id}` };
  if (t === "debit_note") return { create: "/debit-notes", get: (id) => `/debit-notes/${id}` };
  if (t === "support_document") return { create: "/support-documents", get: (id) => `/support-documents/${id}` };
  if (t === "support_adjustment") return { create: "/adjustment-note-support-documents", get: (id) => `/adjustment-note-support-documents/${id}` };
  return { create: "/invoices", get: (id) => `/invoices/${id}` };
}

/** Cuerpo para Alanube según el tipo de documento. */
export function alanubePayload(ctx: ProviderContext, doc: ClaimedDocument): Record<string, unknown> {
  const d = doc.document;
  const companyId = companyIdOf(ctx);
  const company = companyBlock(d.issuer, companyId);
  const items = itemsBlock(doc.lines);
  const totalAmounts = totalsBlock(doc.lines, doc);
  const payments = paymentsBlock(doc);
  const note = typeof d.metadata?.note === "string" && d.metadata.note.trim() ? [String(d.metadata.note).slice(0, 5000)] : undefined;
  const number = Number(d.number);

  if (d.document_type === "pos_equivalent") {
    const c = d.customer;
    const final = c.final_consumer || !digits(c.document_number) || digits(c.document_number) === "222222222222";
    return {
      number: String(number),
      resolution: resolutionBlock(doc, ctx, false),
      company,
      ...(final ? {} : { customer: customerBlock(doc) }),
      items, payments, totalAmounts,
      cashRegister: {
        plate: (d.issuer.point?.code ?? "CAJA1").slice(0, 30),
        location: (d.issuer.point?.name ?? d.issuer.establishment?.name ?? "Punto de venta").slice(0, 100),
        cashier: String(d.metadata?.cashier ?? d.metadata?.seller_name ?? "Caja").slice(0, 100),
        type: "POS",
        saleCode: d.full_number ?? String(number),
        subtotal: String(totalAmounts.grossTotal),
      },
      ...(note ? { note } : {}),
    };
  }
  // Documento soporte en adquisiciones a no obligados a facturar (el «cliente» es el proveedor).
  if (d.document_type === "support_document") {
    return {
      issueDate: bogotaDate(d.issue_date),
      number,
      resolution: resolutionBlock(doc, ctx, false),
      company,
      supplier: supplierBlock(doc),
      items: items.map(({ code, ...it }) => ({ standardCode: code, ...it })),
      payments, totalAmounts,
      ...(note ? { notes: note } : {}),
    };
  }
  if (d.document_type === "support_adjustment") {
    const r = doc.related;
    if (!r) throw new ProviderError("La nota de ajuste necesita el documento soporte original.", { code: "VALIDATION" });
    return {
      number,
      ...(doc.range?.prefix ? { prefix: doc.range.prefix } : {}),
      invoiceDocumentReference: r.provider_document_id
        ? { id: r.provider_document_id, date: bogotaDate(r.issue_date) }
        : { fullNumber: r.full_number, cuds: r.cufe, date: bogotaDate(r.issue_date) },
      discrepancies: [{ responseCode: Math.min(5, Math.max(1, Number(d.note_concept ?? 1))), description: (d.note_reason ?? "Ajuste").slice(0, 500) }],
      company,
      supplier: supplierBlock(doc),
      items, payments, totalAmounts,
      ...(note ? { note: note.join(" ") } : {}),
    };
  }
  if (d.document_type === "credit_note" && doc.related?.document_type === "pos_equivalent") {
    const r = doc.related;
    return {
      number: String(number),
      documentReference: r.provider_document_id
        ? { id: r.provider_document_id, issueDate: bogotaDate(r.issue_date) }
        : { fullNumber: r.full_number, cude: r.cufe, issueDate: bogotaDate(r.issue_date) },
      discrepancy: { responseCode: Math.min(5, Math.max(1, Number(d.note_concept ?? 1))), description: (d.note_reason ?? "Ajuste").slice(0, 500) },
      resolution: resolutionBlock(doc, ctx, false),
      company, items, payments, totalAmounts,
      ...(note ? { note } : {}),
    };
  }
  if (d.document_type === "credit_note" || d.document_type === "debit_note") {
    const r = doc.related;
    if (!r?.cufe) throw new ProviderError("La nota necesita el documento original aceptado (con CUFE).", { code: "VALIDATION" });
    const prefixOf = (r.full_number ?? "").replace(/\d+$/, "");
    return {
      number,
      conceptCode: String(d.note_concept ?? (d.document_type === "credit_note" ? "1" : "4")),
      ...(doc.range?.prefix ? { prefix: doc.range.prefix } : {}),
      associatedDocuments: [{ date: bogotaDate(r.issue_date), documentType: "01", number: plainNumber(r.full_number, prefixOf), ...(prefixOf ? { prefix: prefixOf } : {}), uuid: r.cufe }],
      company, customer: customerBlock(doc), items, payments, totalAmounts,
      note: [(d.note_reason ?? "Corrección").slice(0, 5000), ...(note ?? [])],
    };
  }
  // Factura de contingencia (talonario/papel hecha sin conexión): «04 · Contingencia Facturador Electrónico»,
  // con la factura en papel en additionalDocumentReference (obligatorio) y la clave técnica solo si la numeración la tiene.
  const contingency = d.document_type === "contingency_invoice";
  const paperNumber = String(d.metadata?.paper_number ?? d.full_number ?? number);
  const paperDate = bogotaDate(String(d.metadata?.paper_issued_at ?? d.issue_date));
  return {
    documentType: d.document_type === "export_invoice" ? "02" : contingency ? "04" : "01",
    number,
    resolution: resolutionBlock(doc, ctx, !contingency || Boolean(ctx.technicalKey)),
    ...(contingency ? { additionalDocumentReference: { number: paperNumber, issueDate: paperDate } } : {}),
    company, customer: customerBlock(doc), items, payments, totalAmounts,
    ...(note ? { note } : {}),
  };
}

/** Estado de un set de pruebas en palabras. */
const setStatus = (st: unknown) => ({ ACCEPTED: "✅ aceptado por la DIAN (habilitado)", REJECTED: "⛔ rechazado por la DIAN", FAILED: "⚠️ falló el envío", PENDING_TO_SEND: "⏳ por enviar", WAITING_RESPONSE: "🔄 esperando respuesta de la DIAN" } as Record<string, string>)[String(st ?? "")] ?? String(st ?? "en proceso");
const docLabel = (d: string) => ({ invoices: "factura electrónica", pos: "documento equivalente POS", supportDocuments: "documento soporte", payrolls: "nómina electrónica" } as Record<string, string>)[d] ?? d;

export class AlegraProvider extends BaseInvoicingProvider {
  readonly code = "alegra";
  readonly name = "Alanube (Alegra e-Provider)";
  readonly capabilities: ProviderCapabilities = {
    production: true, webhooks: true, certificate: false, creditNotes: true, debitNotes: true, cancel: false, downloads: true, companyApi: true,
  };
  readonly credentialFields: CredentialField[] = PROVIDER_CREDENTIAL_FIELDS.alegra;

  async healthCheck(ctx: ProviderContext): Promise<ProviderHealth> {
    if (!ctx.credentials.api_token) return { ok: false, message: "Falta el token de Alanube." };
    const self = await api(ctx, "GET", "/company");
    const main = (self.company ?? self) as Record<string, unknown>;
    const details: Record<string, unknown> = { main_company: main.name ?? null, main_id: main.id ?? null };
    const companyId = ctx.account.external_account_id;
    if (!companyId) return { ok: true, message: `Token válido (${main.name ?? "cuenta principal"}). Falta crear o pegar la compañía emisora.`, details };
    const one = await api(ctx, "GET", `/companies/${companyId}`);
    const c = (one.company ?? one) as Record<string, unknown>;
    details.company = c.name ?? null;
    details.governmentStatus = c.governmentStatus ?? null;
    details.webhooks = c.webhooks ? "configurados" : "sin configurar";
    return { ok: true, message: `Conectado a Alanube · ${c.name ?? companyId} · habilitación: ${JSON.stringify(c.governmentStatus ?? "sin dato")}`, details };
  }

  async createCompany(ctx: ProviderContext, issuer: IssuerSnapshot): Promise<ProviderResult> {
    const body = {
      name: issuer.legal_name,
      ...(issuer.trade_name ? { tradeName: issuer.trade_name } : {}),
      identification: digits(issuer.document_number),
      dv: String(issuer.verification_digit ?? ""),
      type: "associated",
      useAlegraCertificate: true,
      organizationType: issuer.person_type === "juridica" ? 1 : 2,
      identificationType: ID_TYPE[issuer.document_type] ?? "31",
      regimeCode: (issuer.tax_responsibilities?.length ? issuer.tax_responsibilities.join(";") : issuer.tax_regime) || "R-99-PN",
      taxCode: { id: issuerTaxCode(issuer) },
      ...(issuer.economic_activities?.length ? { economicActivities: issuer.economic_activities.map((a) => digits(a).slice(0, 4)).filter((a) => a.length === 4) } : {}),
      ...(issuer.email ? { email: issuer.email } : {}),
      ...(issuer.phone ? { phone: issuer.phone } : {}),
      address: { address: issuer.fiscal_address ?? "", city: issuer.city_code ?? "", department: issuer.department_code ?? "", country: "CO" },
      notificationByEmail: { enabled: true },
    };
    const res = await api(ctx, "POST", "/companies", body);
    const c = (res.company ?? res) as Record<string, unknown>;
    return { status: "ACCEPTED", provider_document_id: String(c.id ?? ""), provider_message: `Compañía creada en Alanube: ${c.name ?? ""}`, payload: res };
  }

  /** Registra los webhooks de la compañía hacia RemHub (settings: webhook_url, webhook_secret). */
  async configureCompany(ctx: ProviderContext, _issuer: IssuerSnapshot, settings: Record<string, unknown>): Promise<ProviderResult> {
    const companyId = companyIdOf(ctx);
    const url = String(settings.webhook_url ?? "");
    const secret = String(settings.webhook_secret ?? "");
    if (!/^https:\/\//.test(url) || !secret) throw new ProviderError("Falta la dirección pública (https) o el secreto del webhook.", { code: "CONFIG" });
    const hook = { url, headers: { [ALANUBE_WEBHOOK_HEADER]: secret }, status: "active" };
    const body = {
      webhooks: {
        general: { governmentStatusChanged: hook, enablementStatusChanged: hook },
        invoices: { emissionFinished: hook }, creditNotes: { emissionFinished: hook }, debitNotes: { emissionFinished: hook },
        equivalentDocuments: { emissionFinished: hook }, supportDocuments: { emissionFinished: hook },
      },
    };
    const res = await api(ctx, "PATCH", `/companies/${companyId}`, body);
    return { status: "ACCEPTED", provider_message: "Webhooks configurados en Alanube.", payload: { ok: true, company: (res.company as Record<string, unknown> | undefined)?.id ?? companyId } };
  }

  async getNumbering(ctx: ProviderContext): Promise<Array<{ prefix: string; resolution_number: string; range_from: number; range_to: number; valid_until: string | null }>> {
    const nit = digits(ctx.account.settings?.nit);
    if (!nit) throw new ProviderError("Falta el NIT para consultar las resoluciones.", { code: "CONFIG" });
    const res = await api(ctx, "GET", `/resolutions/${nit}`);
    return ((res.resolutions ?? []) as Array<Record<string, unknown>>).map((r) => ({
      prefix: String(r.prefix ?? ""), resolution_number: String(r.resolutionNumber ?? ""), range_from: Number(r.minNumber ?? 0), range_to: Number(r.maxNumber ?? 0), valid_until: (r.endDate as string) ?? null,
      technical_key: r.technicalKey ?? null, valid_from: r.startDate ?? null,
    }));
  }

  async createInvoice(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult> {
    // Ya se había enviado y está esperando: solo se consulta (no se reenvía un WAITING_RESPONSE).
    if (doc.document.provider_document_id && doc.document.status === "SENT") return this.getInvoiceStatus(ctx, doc);
    const resource = resourceOf(doc);
    const res = await api(ctx, "POST", resource.create, alanubePayload(ctx, doc), idempotencyKey(doc));
    return this.withFiles(toResult(pickDoc(res), res), res);
  }
  async createCreditNote(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult> { return this.createInvoice(ctx, doc); }
  async createDebitNote(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult> { return this.createInvoice(ctx, doc); }

  async getInvoiceStatus(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult> {
    const id = doc.document.provider_document_id;
    if (!id) return { status: "ERROR", error_code: "NO_ID", error_message: "Aún no hay identificador de Alanube para consultar.", retryable: false };
    const res = await api(ctx, "GET", resourceOf(doc).get(id));
    return this.withFiles(toResult(pickDoc(res), res), res);
  }

  /** Si ya está aceptado, se baja el ZIP (XML + PDF) para guardarlo en RemHub. */
  private async withFiles(result: ProviderResult, res: AlanubeResponse): Promise<ProviderResult> {
    if (result.status !== "ACCEPTED") return result;
    const files = await downloadZip(res.files?.zip);
    return { ...result, xml: files.xml, pdf: files.pdf, payload: { ...(result.payload ?? {}), files: res.files ? Object.keys(res.files) : null } };
  }

  async downloadXml(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderFile | null> {
    if (!doc.document.provider_document_id) return null;
    const res = await api(ctx, "GET", resourceOf(doc).get(doc.document.provider_document_id));
    return (await downloadZip((res as AlanubeResponse).files?.zip)).xml;
  }
  async downloadPdf(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderFile | null> {
    if (!doc.document.provider_document_id) return null;
    const res = await api(ctx, "GET", resourceOf(doc).get(doc.document.provider_document_id));
    return (await downloadZip((res as AlanubeResponse).files?.zip)).pdf;
  }

  /**
   * Nómina electrónica (módulo aparte): emitir, reemplazar, anular o consultar en /payrolls.
   * Mismas reglas de respuesta que los demás documentos (status + legalStatus; FAILED se reintenta).
   */
  async payroll(ctx: ProviderContext, op: "create" | "replace" | "cancel" | "status", input: { body?: unknown; id?: string | null; relatedId?: string | null; idempotencyKey?: string }): Promise<ProviderResult> {
    let res: Record<string, unknown>;
    if (op === "status") {
      if (!input.id) return { status: "ERROR", error_code: "NO_ID", error_message: "Aún no hay identificador de Alanube para consultar.", retryable: false };
      res = await api(ctx, "GET", `/payrolls/${encodeURIComponent(input.id)}`);
    } else if (op === "create") {
      res = await api(ctx, "POST", "/payrolls", input.body, input.idempotencyKey);
    } else {
      if (!input.relatedId) throw new ProviderError("Falta la nómina original aceptada en Alanube.", { code: "VALIDATION" });
      res = await api(ctx, "POST", `/payrolls/${encodeURIComponent(input.relatedId)}/${op}`, input.body, input.idempotencyKey);
    }
    return toResult(pickDoc(res), res);
  }

  /** Acciones de configuración desde el centro fiscal: set de pruebas y resoluciones. */
  async runAction(ctx: ProviderContext, action: string, input: Record<string, unknown>): Promise<ProviderHealth> {
    if (action === "test_set") {
      const type = ["invoices", "pos", "payrolls"].includes(String(input.type)) ? String(input.type) : "invoices";
      const governmentId = String(input.governmentId ?? "").trim() || (ctx.environment === "sandbox" ? "a70562e0-631e-4ceb-aa65-36887b57dc17" : "");
      if (!/^[0-9a-f-]{20,}$/i.test(governmentId)) return { ok: false, message: "Pega el código del set de pruebas (TestSetId) que muestra la DIAN." };
      const res = await api(ctx, "POST", "/test-sets", { company: { id: companyIdOf(ctx) }, type, governmentId });
      // Alanube responde «testSet» (uno) en la creación; algunas versiones usan «testSets» (lista).
      const set = ((res.testSet as Record<string, unknown> | undefined) ?? ((res.testSets ?? []) as Array<Record<string, unknown>>)[0] ?? {}) as Record<string, unknown>;
      return { ok: true, message: `Set de pruebas de ${docLabel(type)} enviado a la DIAN: ${setStatus(set.status)}. Puede tardar unos minutos; consulta con «Estado del set».`, details: { test_set_id: set.id ?? null, status: set.status ?? null } };
    }
    if (action === "test_set_status") {
      const id = String(input.id ?? "");
      if (!id) return { ok: false, message: "Falta el id del set de pruebas." };
      const res = await api(ctx, "GET", `/test-sets/${id}`);
      const raw = (res.testSet ?? res.testSets ?? res) as Record<string, unknown> | Array<Record<string, unknown>>;
      const set = (Array.isArray(raw) ? raw[0] ?? {} : raw) as Record<string, unknown>;
      const errs = (Array.isArray(set.errors) ? set.errors : Array.isArray(res.errors) ? res.errors : []).map((e) => (typeof e === "string" ? e : String((e as { message?: unknown }).message ?? ""))).filter(Boolean);
      return { ok: set.status !== "REJECTED" && set.status !== "FAILED", message: `Set de pruebas de ${docLabel(String(set.type ?? ""))}: ${setStatus(set.status)}${errs.length ? ` · ${errs.join(" · ")}` : ""}`, details: { status: set.status ?? null, errors: errs } };
    }
    // Habilitación inteligente: Alanube hace sola los sets de pruebas ante la DIAN con el AuthToken del portal de habilitación.
    if (action === "intelligent_start") {
      const tokenDIAN = String(input.tokenDIAN ?? "").trim();
      let ok = false;
      try { const u = new URL(tokenDIAN); ok = u.origin === "https://catalogo-vpfe-hab.dian.gov.co" && u.pathname.toLowerCase() === "/user/authtoken" && u.searchParams.has("rk") && u.searchParams.has("token"); } catch { ok = false; }
      if (!ok) return { ok: false, message: "Pega el enlace completo que genera la DIAN: empieza por https://catalogo-vpfe-hab.dian.gov.co/User/AuthToken?… (con rk y token)." };
      const allowed = ["invoices", "pos", "supportDocuments", "payrolls"];
      const docs = (Array.isArray(input.documents) ? input.documents : []).map(String).filter((d, i, a) => allowed.includes(d) && a.indexOf(d) === i);
      if (!docs.length) return { ok: false, message: "Escoge al menos un tipo de documento para habilitar." };
      try {
        const res = await api(ctx, "POST", "/test-sets/intelligent", { tokenDIAN, documents: docs, companyId: companyIdOf(ctx) });
        return { ok: true, message: `Habilitación iniciada (${docs.map(docLabel).join(", ")}). Alanube envía los sets de pruebas a la DIAN: revisa el avance en unos minutos.`, details: { process_id: res.processId ?? null, status: res.status ?? null, plan: res.executionPlan ?? [] } };
      } catch (error) {
        const body = error instanceof ProviderError ? (error.cause as Record<string, unknown> | undefined) : undefined;
        const active = ((body?.errors as Array<{ code?: string; activeProcessId?: string }> | undefined) ?? []).find((e) => e.activeProcessId)?.activeProcessId;
        if (active) return { ok: true, message: "Ya hay una habilitación en curso para esta empresa: te muestro su avance.", details: { process_id: active, status: "IN_PROCESS" } };
        if (error instanceof ProviderError && /COMPANY_DIAN_MISMATCH/.test(error.message)) return { ok: false, message: "El enlace de la DIAN es de otro NIT: genéralo entrando al portal con el NIT de esta empresa." };
        if (error instanceof ProviderError && /INVALID_DIAN_TOKEN/.test(error.message)) return { ok: false, message: "La DIAN no aceptó el enlace (puede haber vencido): genera uno nuevo en el portal y pégalo otra vez." };
        throw error;
      }
    }
    if (action === "intelligent_status") {
      const id = String(input.id ?? ctx.account.settings?.intelligent_process_id ?? "");
      if (!id) return { ok: false, message: "Todavía no has iniciado la habilitación automática." };
      const res = await api(ctx, "GET", `/test-sets/intelligent/${encodeURIComponent(id)}`);
      const plan = ((res.executionPlan ?? []) as Array<Record<string, unknown>>).filter((p) => p.requested || p.requiredBy);
      const ST: Record<string, string> = { PENDING: "⏳ en cola", IN_PROCESS: "🔄 en proceso", AUTHORIZED: "✅ habilitado", REJECTED: "⛔ rechazado", FAILED: "⚠️ falló" };
      const lines = plan.map((p) => `${docLabel(String(p.documentType))}: ${ST[String(p.status)] ?? String(p.status ?? "")}${p.errorMessage ? ` (${String(p.errorMessage)})` : ""}`);
      const global = res.status === "FINISHED" ? "Habilitación terminada." : res.status === "FAILED" ? `La habilitación falló${res.errorMessage ? `: ${String(res.errorMessage)}` : ""}.` : "Habilitación en proceso.";
      return { ok: res.status !== "FAILED", message: `${global} ${lines.join(" · ")}`, details: { process_id: id, status: res.status ?? null, error_code: res.errorCode ?? null, plan } };
    }
    if (action === "resolutions") {
      const list = await this.getNumbering({ ...ctx, account: { ...ctx.account, settings: { ...ctx.account.settings, nit: input.nit ?? ctx.account.settings?.nit } } });
      return { ok: true, message: list.length ? `${list.length} resolución(es) encontradas en la DIAN.` : "La DIAN no tiene resoluciones asociadas a Alegra para este NIT.", details: { resolutions: list } };
    }
    return { ok: false, message: "Acción no reconocida." };
  }

  verifyWebhook(input: WebhookInput): WebhookVerification {
    if (!input.secret) return { valid: false, reason: "La cuenta no tiene secreto de webhook: genera uno y vuelve a conectar los avisos." };
    const got = Buffer.from(input.headers.get(ALANUBE_WEBHOOK_HEADER) ?? "");
    const want = Buffer.from(input.secret);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { valid: false, reason: "El secreto del webhook no coincide." };
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(input.rawBody); } catch { return { valid: false, reason: "El cuerpo no es JSON." }; }
    const d = pickDoc(payload);
    const type = Object.keys(payload)[0] ?? "event";
    // Alanube no manda id de evento: se arma con el documento y su estado (un mismo estado no se procesa dos veces).
    const eventId = d?.id ? `${type}:${d.id}:${d.status ?? ""}:${d.legalStatus ?? ""}` : createHash("sha256").update(input.rawBody).digest("hex").slice(0, 40);
    return { valid: true, eventId, eventType: type };
  }

  processWebhook(payload: unknown): ParsedWebhook {
    if (!payload || typeof payload !== "object") return { kind: "ignored", reason: "Evento vacío." };
    const d = pickDoc(payload as Record<string, unknown>);
    if (!d?.id) return { kind: "ignored", reason: "Evento de compañía o sin documento (habilitación, etc.)." };
    const r = toResult(d, payload as Record<string, unknown>);
    return {
      kind: "document_status",
      status: r.status,
      provider_document_id: d.id,
      cufe: r.cufe ?? null,
      full_number: d.fullNumber ?? null,
      provider_status: r.provider_status ?? null,
      dian_status: r.dian_status ?? null,
      dian_message: r.dian_message ?? null,
      error_message: r.error_message ?? null,
      qr_data: r.qr_data ?? null,
      payload: payload as Record<string, unknown>,
    };
  }
}
