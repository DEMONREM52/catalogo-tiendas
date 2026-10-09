// Adaptador preparado para Alegra. NO hay endpoints, campos ni autenticación inventados:
// la integración NO está aprobada ni probada. Para activarla:
//   1. Confirmar con Alegra (contrato de proveedor tecnológico) la documentación oficial vigente:
//      URL base por ambiente (pruebas/producción), autenticación, recurso de facturas y notas,
//      consulta de estado, descarga de XML/PDF y el esquema de firma de sus webhooks.
//   2. Completar los TODO de este archivo con esa documentación.
//   3. Cambiar fiscal_providers.status a 'available' para 'alegra' (SQL) cuando esté probado en pruebas.
// Mientras tanto la base marca a Alegra como «pendiente» y ningún punto puede facturar con él.
import {
  BaseInvoicingProvider,
  ProviderNotImplementedError,
  type ClaimedDocument,
  type CredentialField,
  type ParsedWebhook,
  type ProviderCapabilities,
  type ProviderContext,
  type ProviderHealth,
  type ProviderResult,
  type WebhookInput,
  type WebhookVerification,
} from "../provider";
import { PROVIDER_CREDENTIAL_FIELDS } from "../provider-fields";

/* eslint-disable @typescript-eslint/no-unused-vars -- pendiente de la documentación oficial (TODO). */
export class AlegraProvider extends BaseInvoicingProvider {
  readonly code = "alegra";
  readonly name = "Alegra";
  // TODO: confirmar capacidades reales con la documentación oficial.
  readonly capabilities: ProviderCapabilities = {
    production: true,
    webhooks: true,
    certificate: false,
    creditNotes: true,
    debitNotes: true,
    cancel: false,
    downloads: true,
    companyApi: true,
  };
  // TODO: los campos exactos se definen en provider-fields.ts al confirmar el contrato con Alegra.
  readonly credentialFields: CredentialField[] = PROVIDER_CREDENTIAL_FIELDS.alegra;

  async healthCheck(ctx: ProviderContext): Promise<ProviderHealth> {
    const missing = this.credentialFields.filter((f) => f.required && !ctx.credentials[f.key]).map((f) => f.label);
    if (missing.length) return { ok: false, message: `Faltan credenciales: ${missing.join(", ")}.` };
    // TODO: llamar al endpoint oficial de verificación de Alegra (no se inventa aquí).
    return { ok: false, message: "Integración con Alegra pendiente: completa el adaptador con la documentación oficial vigente." };
  }

  async createInvoice(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderResult> {
    // TODO: mapear ClaimedDocument (emisor, cliente, líneas, impuestos, resolución) al formato oficial de Alegra.
    throw new ProviderNotImplementedError(this.name, "crear factura");
  }

  async getInvoiceStatus(_ctx: ProviderContext, _doc: ClaimedDocument): Promise<ProviderResult> {
    // TODO: consultar el estado (proveedor / DIAN) con el identificador provider_document_id.
    throw new ProviderNotImplementedError(this.name, "consultar estado");
  }

  verifyWebhook(_input: WebhookInput): WebhookVerification {
    // TODO: implementar la verificación EXACTA que documente Alegra (cabeceras, algoritmo, tiempo).
    // Hasta entonces todo webhook se rechaza por seguridad.
    return { valid: false, reason: "Verificación de webhooks de Alegra pendiente de implementar." };
  }

  processWebhook(_payload: unknown): ParsedWebhook {
    // TODO: traducir el evento oficial de Alegra a { kind: 'document_status', status, provider_document_id, cufe }.
    return { kind: "ignored", reason: "Procesador de webhooks de Alegra pendiente." };
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
