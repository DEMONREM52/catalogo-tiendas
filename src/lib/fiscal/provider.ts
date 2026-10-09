// Capa «Fiscal Provider Adapter»: el POS y el centro fiscal nunca hablan directo con
// Alegra, Siigo u otro proveedor; hablan con esta interfaz. Cada proveedor la implementa
// en src/lib/fiscal/providers/<proveedor>.ts y se registra en providers/index.ts.
import type { FiscalDocumentType, FiscalEnvironment } from "./types";

export type IssuerSnapshot = {
  entity_id: string;
  legal_name: string;
  trade_name: string | null;
  person_type: "natural" | "juridica";
  document_type: string;
  document_number: string | null;
  verification_digit: string | null;
  tax_regime: string | null;
  tax_responsibilities: string[];
  economic_activities: string[];
  fiscal_address: string | null;
  city: string | null;
  city_code: string | null;
  department: string | null;
  department_code: string | null;
  country: string;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  establishment: { id: string; name: string; code: string | null; address: string | null; city: string | null; department: string | null } | null;
  point: { id: string; name: string; code: string } | null;
};

export type CustomerSnapshot = {
  id: string | null;
  final_consumer: boolean;
  person_type?: string | null;
  document_type: string;
  document_number: string;
  verification_digit?: string | null;
  name: string;
  trade_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  department?: string | null;
  country?: string | null;
  tax_regime?: string | null;
  is_tax_responsible?: boolean | null;
};

export type ClaimedLine = {
  line_no: number;
  product_id: string | null;
  sku: string | null;
  description: string;
  unit_code: string;
  qty: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  line_subtotal: number;
  line_tax: number;
  line_total: number;
  ref_line_no: number | null;
};

/** Lo que el servidor entrega al adaptador (resuelto en la base: el navegador no decide nada de esto). */
export type ClaimedDocument = {
  mode: "send" | "status";
  document: {
    id: string;
    store_id: string;
    point_id: string | null;
    fiscal_entity_id: string;
    document_type: FiscalDocumentType;
    environment: FiscalEnvironment;
    status: string;
    prefix: string | null;
    number: number | null;
    full_number: string | null;
    issue_date: string;
    due_date: string | null;
    currency: string;
    payment_form: "cash" | "credit";
    payment_method: string | null;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    issuer: IssuerSnapshot;
    customer: CustomerSnapshot;
    note_concept: string | null;
    note_reason: string | null;
    provider_document_id: string | null;
    cufe: string | null;
    attempts: number;
    metadata: Record<string, unknown>;
  };
  lines: ClaimedLine[];
  range: {
    id: string;
    prefix: string;
    resolution_number: string | null;
    resolution_date: string | null;
    valid_from: string | null;
    valid_until: string | null;
    range_from: number;
    range_to: number;
  };
  account: {
    id: string;
    provider: string;
    environment: FiscalEnvironment;
    external_account_id: string | null;
    settings: Record<string, unknown>;
    store_id: string;
  };
  related: {
    id: string;
    full_number: string | null;
    cufe: string | null;
    issue_date: string;
    total: number;
    document_type: FiscalDocumentType;
    provider_document_id: string | null;
  } | null;
};

export type ProviderContext = {
  account: ClaimedDocument["account"];
  environment: FiscalEnvironment;
  /** Credenciales ya descifradas por el servidor (nunca llegan al navegador). */
  credentials: Record<string, string>;
  /** Clave técnica de la numeración, si el proveedor la necesita. */
  technicalKey?: string | null;
  requestId: string;
  signal?: AbortSignal;
};

export type ProviderFile = { content: string | Uint8Array; contentType: string; fileName: string };

export type ProviderResult = {
  status: "ACCEPTED" | "REJECTED" | "SENT" | "ERROR";
  provider_document_id?: string | null;
  provider_request_id?: string | null;
  provider_status?: string | null;
  provider_message?: string | null;
  dian_status?: string | null;
  dian_message?: string | null;
  cufe?: string | null;
  qr_data?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  /** Se puede reintentar automáticamente (fallas de red, proveedor caído). */
  retryable?: boolean;
  /** El proveedor alcanzó a recibir el documento (para no anularlo sin consultar). */
  transmitted?: boolean;
  xml?: ProviderFile | null;
  pdf?: ProviderFile | null;
  /** Respuesta del proveedor SIN secretos (se guarda en la línea de tiempo). */
  payload?: Record<string, unknown>;
};

export type ProviderHealth = { ok: boolean; message: string; details?: Record<string, unknown> };

export type WebhookInput = { headers: Headers; rawBody: string; secret: string | null; now: Date };
export type WebhookVerification = { valid: boolean; reason?: string; eventId?: string | null; eventType?: string | null };
export type ParsedWebhook =
  | {
      kind: "document_status";
      status: "ACCEPTED" | "REJECTED" | "SENT" | "ERROR";
      provider_document_id?: string | null;
      cufe?: string | null;
      full_number?: string | null;
      provider_status?: string | null;
      dian_status?: string | null;
      dian_message?: string | null;
      error_message?: string | null;
      qr_data?: string | null;
      payload?: Record<string, unknown>;
    }
  | { kind: "ignored"; reason: string };

export type CredentialField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
};

export type ProviderCapabilities = {
  production: boolean;
  webhooks: boolean;
  certificate: boolean;
  creditNotes: boolean;
  debitNotes: boolean;
  cancel: boolean;
  downloads: boolean;
  /** El proveedor crea/configura la empresa por API. */
  companyApi: boolean;
};

export class ProviderError extends Error {
  code: string;
  retryable: boolean;
  transmitted: boolean;
  constructor(message: string, options: { code?: string; retryable?: boolean; transmitted?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.code = options.code ?? "PROVIDER_ERROR";
    this.retryable = options.retryable ?? false;
    this.transmitted = options.transmitted ?? false;
  }
}

export class ProviderNotImplementedError extends ProviderError {
  constructor(provider: string, operation: string) {
    super(`${provider}: «${operation}» aún no está implementado en RemHub (TODO: completar con la documentación oficial del proveedor).`, {
      code: "NOT_IMPLEMENTED",
    });
  }
}

/**
 * Contrato que implementa cada proveedor tecnológico. Los métodos siguen el flujo:
 * empresa → numeración → crear documento → transmitir → estado → notas → anulación → archivos → webhooks.
 */
export interface ElectronicInvoicingProvider {
  readonly code: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  readonly credentialFields: CredentialField[];
  healthCheck(ctx: ProviderContext): Promise<ProviderHealth>;
  createCompany(ctx: ProviderContext, issuer: IssuerSnapshot): Promise<ProviderResult>;
  configureCompany(ctx: ProviderContext, issuer: IssuerSnapshot, settings: Record<string, unknown>): Promise<ProviderResult>;
  getNumbering(ctx: ProviderContext): Promise<Array<{ prefix: string; resolution_number: string; range_from: number; range_to: number; valid_until: string | null }>>;
  createInvoice(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult>;
  sendInvoice(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult>;
  getInvoiceStatus(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult>;
  createCreditNote(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult>;
  createDebitNote(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult>;
  cancelDocument(ctx: ProviderContext, doc: ClaimedDocument, reason: string): Promise<ProviderResult>;
  downloadXml(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderFile | null>;
  downloadPdf(ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderFile | null>;
  verifyWebhook(input: WebhookInput): WebhookVerification;
  processWebhook(payload: unknown): ParsedWebhook;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- métodos base: cada proveedor sobrescribe solo lo que soporta. */
/** Base con respuestas «no disponible» para lo que un proveedor no soporte todavía. */
export abstract class BaseInvoicingProvider implements ElectronicInvoicingProvider {
  abstract readonly code: string;
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;
  abstract readonly credentialFields: CredentialField[];
  abstract healthCheck(ctx: ProviderContext): Promise<ProviderHealth>;

  async createCompany(_ctx: ProviderContext, _issuer: IssuerSnapshot): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "crear empresa");
  }
  async configureCompany(_ctx: ProviderContext, _issuer: IssuerSnapshot, _settings: Record<string, unknown>): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "configurar empresa");
  }
  async getNumbering(_ctx: ProviderContext): Promise<Array<{ prefix: string; resolution_number: string; range_from: number; range_to: number; valid_until: string | null }>> {
    throw new ProviderNotImplementedError(this.name, "consultar numeración");
  }
  async createInvoice(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "crear factura");
  }
  async sendInvoice(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "enviar factura");
  }
  async getInvoiceStatus(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "consultar estado");
  }
  async createCreditNote(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "nota crédito");
  }
  async createDebitNote(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "nota débito");
  }
  async cancelDocument(_ctx: ProviderContext, _doc: ClaimedDocument, _reason: string): Promise<ProviderResult> {
    throw new ProviderNotImplementedError(this.name, "anular documento");
  }
  async downloadXml(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderFile | null> {
    return null;
  }
  async downloadPdf(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderFile | null> {
    return null;
  }
  verifyWebhook(_input: WebhookInput): WebhookVerification {
    return { valid: false, reason: `${this.name} no tiene webhooks configurados en RemHub.` };
  }
  processWebhook(_payload: unknown): ParsedWebhook {
    return { kind: "ignored", reason: "Sin procesador de webhooks." };
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/** Envía según el tipo de documento (factura, nota crédito o débito) o consulta su estado. */
export async function submitDocument(provider: ElectronicInvoicingProvider, ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult> {
  if (doc.mode === "status") return provider.getInvoiceStatus(ctx, doc);
  switch (doc.document.document_type) {
    case "credit_note":
      return provider.createCreditNote(ctx, doc);
    case "debit_note":
      return provider.createDebitNote(ctx, doc);
    default: {
      // createInvoice crea el documento en el proveedor. Si el proveedor crea y transmite en un solo
      // paso, devuelve el resultado final; si necesita un segundo paso responde transmitted: false.
      const created = await provider.createInvoice(ctx, doc);
      if (created.transmitted !== false || created.status === "ERROR" || !created.provider_document_id) return created;
      const sent = await provider.sendInvoice(ctx, { ...doc, document: { ...doc.document, provider_document_id: created.provider_document_id } });
      return { ...created, ...sent, provider_document_id: sent.provider_document_id ?? created.provider_document_id };
    }
  }
}

/** Quita cualquier campo que parezca secreto antes de guardar respuestas del proveedor. */
export function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizePayload(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /(secret|password|passwd|token|api[-_]?key|authorization|private|clave|certificate|pin)/i.test(key) ? "[oculto]" : sanitizePayload(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 4000) return value.slice(0, 4000) + "…";
  return value;
}
