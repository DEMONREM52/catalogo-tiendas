// Simulador RemHub: permite probar todo el flujo (emitir, rechazar, reintentar, notas,
// webhooks) sin un proveedor real. NUNCA transmite a la DIAN y nunca se usa en producción.
// El «CUFE» que genera empieza por SIM- para que no se confunda con uno real.
import { createHash } from "node:crypto";
import {
  BaseInvoicingProvider,
  type ClaimedDocument,
  type CredentialField,
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
import { SIGNATURE_HEADER, verifySignatureHeader } from "../webhook-signature";

type SimulationMode = "accept" | "reject" | "error" | "pending";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function simulationMode(ctx: ProviderContext): SimulationMode {
  const mode = String(ctx.account.settings?.simulate ?? "accept");
  return mode === "reject" || mode === "error" || mode === "pending" ? mode : "accept";
}

function simulatedCufe(doc: ClaimedDocument) {
  const d = doc.document;
  const base = [d.full_number, d.issue_date, d.total.toFixed(2), d.tax_total.toFixed(2), d.issuer.document_number, d.customer.document_number, d.environment].join("|");
  return "SIM-" + createHash("sha384").update(base).digest("hex");
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
}

function simulatedXml(doc: ClaimedDocument, cufe: string): ProviderFile {
  const d = doc.document;
  const lines = doc.lines
    .map((l) => `    <Linea n="${l.line_no}" cantidad="${l.qty}" precio="${l.unit_price}" iva="${l.tax_rate}" base="${l.line_subtotal}" impuesto="${l.line_tax}" total="${l.line_total}">${escapeXml(l.description)}</Linea>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIMULACIÓN REMHUB: este archivo NO es un documento electrónico válido ante la DIAN. -->
<DocumentoSimulado tipo="${d.document_type}" ambiente="${d.environment}">
  <Numero prefijo="${escapeXml(d.prefix)}">${escapeXml(d.full_number)}</Numero>
  <Fecha>${escapeXml(d.issue_date)}</Fecha>
  <Resolucion numero="${escapeXml(doc.range.resolution_number)}" desde="${doc.range.range_from}" hasta="${doc.range.range_to}" vence="${escapeXml(doc.range.valid_until)}"/>
  <Emisor nit="${escapeXml(d.issuer.document_number)}" dv="${escapeXml(d.issuer.verification_digit)}">${escapeXml(d.issuer.legal_name)}</Emisor>
  <Adquiriente documento="${escapeXml(d.customer.document_number)}">${escapeXml(d.customer.name)}</Adquiriente>
  <Lineas>
${lines}
  </Lineas>
  <Totales subtotal="${d.subtotal}" impuestos="${d.tax_total}" total="${d.total}" moneda="${escapeXml(d.currency)}"/>
  <CUFE>${cufe}</CUFE>
</DocumentoSimulado>
`;
  return { content: xml, contentType: "application/xml", fileName: `${d.full_number ?? d.id}.xml` };
}

/** Validaciones de ejemplo para probar rechazos (no son las reglas oficiales de la DIAN). */
function validate(doc: ClaimedDocument): string | null {
  const d = doc.document;
  if (!d.full_number || !d.number) return "El documento no tiene número.";
  if (!d.issuer?.document_number) return "El emisor no tiene NIT.";
  const sum = doc.lines.reduce((s, l) => s + Number(l.line_total), 0);
  if (Math.abs(sum - Number(d.total)) > 1) return `Los totales no cuadran (${sum} vs ${d.total}).`;
  if (d.customer?.email && !EMAIL.test(d.customer.email)) return "El correo del adquiriente no es válido.";
  if (/RECHAZO/i.test(d.customer?.name ?? "")) return "Rechazo simulado (el nombre del cliente contiene «RECHAZO»).";
  if ((d.document_type === "credit_note" || d.document_type === "debit_note") && !doc.related) return "La nota no referencia el documento original.";
  return null;
}

export class SandboxProvider extends BaseInvoicingProvider {
  readonly code = "sandbox";
  readonly name = "Simulador RemHub";
  readonly capabilities: ProviderCapabilities = {
    production: false,
    webhooks: true,
    certificate: false,
    creditNotes: true,
    debitNotes: true,
    cancel: false,
    downloads: true,
    companyApi: false,
  };
  readonly credentialFields: CredentialField[] = PROVIDER_CREDENTIAL_FIELDS.sandbox;

  async healthCheck(ctx: ProviderContext): Promise<ProviderHealth> {
    if (ctx.environment !== "sandbox") return { ok: false, message: "El simulador solo funciona en el ambiente de pruebas." };
    return { ok: true, message: "Simulador listo (no transmite nada a la DIAN).", details: { mode: simulationMode(ctx) } };
  }

  private respond(ctx: ProviderContext, doc: ClaimedDocument): ProviderResult {
    if (ctx.environment !== "sandbox" || doc.document.environment !== "sandbox") {
      return { status: "ERROR", error_code: "SIM-ENV", error_message: "El simulador nunca transmite documentos de producción.", retryable: false };
    }
    const mode = simulationMode(ctx);
    const providerId = `sim_${doc.document.id}`;
    if (mode === "error") {
      return { status: "ERROR", provider_document_id: null, error_code: "SIM-NET", error_message: "Falla de conexión simulada: se reintentará.", retryable: true };
    }
    const problem = mode === "reject" ? "Rechazo simulado (modo «rechazar» de la cuenta de pruebas)." : validate(doc);
    if (problem) {
      return {
        status: "REJECTED", provider_document_id: providerId, provider_status: "rejected", dian_status: "Rechazado (simulado)",
        error_code: "SIM-REJ", error_message: problem, transmitted: true, payload: { simulated: true, reason: problem },
      };
    }
    if (mode === "pending") {
      return { status: "SENT", provider_document_id: providerId, provider_status: "processing", transmitted: true, payload: { simulated: true } };
    }
    return this.accepted(doc, providerId);
  }

  private accepted(doc: ClaimedDocument, providerId: string): ProviderResult {
    const cufe = simulatedCufe(doc);
    return {
      status: "ACCEPTED",
      provider_document_id: providerId,
      provider_request_id: `simreq_${doc.document.id.slice(0, 8)}_${doc.document.attempts}`,
      provider_status: "accepted",
      dian_status: "Aceptado (simulado)",
      dian_message: "Validación simulada: documento sin errores.",
      cufe,
      qr_data: `RemHub simulación · ${doc.document.full_number} · ${cufe.slice(0, 24)}`,
      transmitted: true,
      xml: simulatedXml(doc, cufe),
      payload: { simulated: true, provider_document_id: providerId },
    };
  }

  async createInvoice(ctx: ProviderContext, doc: ClaimedDocument) {
    return this.respond(ctx, doc);
  }
  async createCreditNote(ctx: ProviderContext, doc: ClaimedDocument) {
    return this.respond(ctx, doc);
  }
  async createDebitNote(ctx: ProviderContext, doc: ClaimedDocument) {
    return this.respond(ctx, doc);
  }
  async getInvoiceStatus(_ctx: ProviderContext, doc: ClaimedDocument): Promise<ProviderResult> {
    // En modo «pendiente» la segunda consulta ya responde aceptado.
    const problem = validate(doc);
    if (problem) return { status: "REJECTED", provider_document_id: doc.document.provider_document_id, error_code: "SIM-REJ", error_message: problem, transmitted: true };
    return this.accepted(doc, doc.document.provider_document_id ?? `sim_${doc.document.id}`);
  }
  async downloadXml(_ctx: ProviderContext, doc: ClaimedDocument) {
    return doc.document.cufe ? simulatedXml(doc, doc.document.cufe) : null;
  }

  verifyWebhook(input: WebhookInput): WebhookVerification {
    const check = verifySignatureHeader({ header: input.headers.get(SIGNATURE_HEADER), secret: input.secret, rawBody: input.rawBody, now: input.now });
    if (!check.valid) return { valid: false, reason: check.reason };
    let parsed: { id?: unknown; type?: unknown } = {};
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      return { valid: false, reason: "El cuerpo no es JSON." };
    }
    return { valid: true, eventId: typeof parsed.id === "string" ? parsed.id : null, eventType: typeof parsed.type === "string" ? parsed.type : null };
  }

  processWebhook(payload: unknown): ParsedWebhook {
    const body = (payload ?? {}) as { type?: string; data?: Record<string, unknown> };
    if (body.type !== "document.status" || !body.data) return { kind: "ignored", reason: "Evento sin estado de documento." };
    const status = String(body.data.status ?? "").toUpperCase();
    if (!["ACCEPTED", "REJECTED", "SENT", "ERROR"].includes(status)) return { kind: "ignored", reason: "Estado desconocido." };
    return {
      kind: "document_status",
      status: status as "ACCEPTED" | "REJECTED" | "SENT" | "ERROR",
      provider_document_id: typeof body.data.provider_document_id === "string" ? body.data.provider_document_id : null,
      cufe: typeof body.data.cufe === "string" ? body.data.cufe : null,
      full_number: typeof body.data.full_number === "string" ? body.data.full_number : null,
      dian_status: typeof body.data.dian_status === "string" ? body.data.dian_status : null,
      error_message: typeof body.data.message === "string" ? body.data.message : null,
      payload: { simulated: true },
    };
  }
}
