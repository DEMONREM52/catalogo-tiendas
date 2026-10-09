// Tipos y etiquetas del módulo fiscal (se usan en el navegador y en el servidor).
// Las reglas tributarias NO están aquí: todo lo marcado «REQUIERE VALIDACIÓN CONTABLE»
// es configurable y debe confirmarlo la contadora o el proveedor tecnológico.

export type FiscalStatus =
  | "DRAFT"
  | "READY"
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "ACCEPTED"
  | "REJECTED"
  | "ERROR"
  | "CONTINGENCY"
  | "CANCEL_PENDING"
  | "CANCELLED"
  | "VOID";

export type FiscalTone = "neutral" | "info" | "good" | "warn" | "bad";

export const STATUS_INFO: Record<FiscalStatus, { label: string; tone: FiscalTone; help: string }> = {
  DRAFT: { label: "Borrador", tone: "neutral", help: "Aún no tiene número ni se ha enviado." },
  READY: { label: "Listo", tone: "info", help: "Validado y numerado; falta enviarlo." },
  QUEUED: { label: "En cola", tone: "info", help: "Numerado y esperando envío al proveedor." },
  PROCESSING: { label: "Enviando", tone: "info", help: "Se está transmitiendo al proveedor." },
  SENT: { label: "Enviado", tone: "info", help: "El proveedor lo recibió; esperando validación." },
  ACCEPTED: { label: "Aceptado", tone: "good", help: "Validado por el proveedor / DIAN." },
  REJECTED: { label: "Rechazado", tone: "bad", help: "Rechazado: corrígelo y reenvíalo, o anúlalo." },
  ERROR: { label: "Error de envío", tone: "warn", help: "No se pudo transmitir; se reintenta automáticamente." },
  CONTINGENCY: { label: "Contingencia", tone: "warn", help: "En cola mientras dura la contingencia." },
  CANCEL_PENDING: { label: "Anulación en curso", tone: "warn", help: "Esperando confirmación de la anulación." },
  CANCELLED: { label: "Anulado por nota", tone: "neutral", help: "Anulado con nota crédito (se conserva)." },
  VOID: { label: "Anulado sin transmitir", tone: "neutral", help: "Nunca se transmitió; el número queda registrado." },
};

export const FISCAL_STATUSES = Object.keys(STATUS_INFO) as FiscalStatus[];

export type FiscalDocumentType =
  | "invoice"
  | "pos_equivalent"
  | "credit_note"
  | "debit_note"
  | "support_document"
  | "support_adjustment"
  | "export_invoice"
  | "contingency_invoice";

export const DOC_TYPE_INFO: Record<FiscalDocumentType, { label: string; short: string; icon: string }> = {
  invoice: { label: "Factura electrónica de venta", short: "Factura", icon: "🧾" },
  pos_equivalent: { label: "Documento equivalente electrónico POS", short: "Doc. equivalente POS", icon: "🧾" },
  credit_note: { label: "Nota crédito", short: "Nota crédito", icon: "↩️" },
  debit_note: { label: "Nota débito", short: "Nota débito", icon: "➕" },
  support_document: { label: "Documento soporte", short: "Doc. soporte", icon: "📄" },
  support_adjustment: { label: "Nota de ajuste a documento soporte", short: "Ajuste soporte", icon: "📄" },
  export_invoice: { label: "Factura de exportación", short: "Exportación", icon: "🌎" },
  contingency_invoice: { label: "Factura de contingencia", short: "Contingencia", icon: "⚠️" },
};

export const FISCAL_DOC_TYPES = Object.keys(DOC_TYPE_INFO) as FiscalDocumentType[];

export type FiscalEnvironment = "sandbox" | "production";

export const ENV_INFO: Record<FiscalEnvironment, { label: string; badge: string; tone: FiscalTone }> = {
  sandbox: { label: "Pruebas (sandbox)", badge: "🧪 Sandbox", tone: "warn" },
  production: { label: "Producción", badge: "🟢 Producción", tone: "good" },
};

export type PointStatus = "draft" | "active" | "suspended" | "inactive";

export const POINT_STATUS_INFO: Record<PointStatus, { label: string; tone: FiscalTone; help: string }> = {
  draft: { label: "Borrador", tone: "neutral", help: "En configuración: todavía no opera." },
  active: { label: "Activo", tone: "good", help: "Opera normalmente (ventas, inventario, caja)." },
  suspended: { label: "Suspendido", tone: "warn", help: "Pausado temporalmente: no opera." },
  inactive: { label: "Inactivo", tone: "bad", help: "Cerrado: conserva su historial." },
};

// Sugerencias del RUT (casilla 53). REQUIERE VALIDACIÓN CONTABLE: se pueden escribir otras.
export const TAX_RESPONSIBILITY_SUGGESTIONS: Array<[string, string]> = [
  ["O-13", "Gran contribuyente"],
  ["O-15", "Autorretenedor"],
  ["O-23", "Agente de retención IVA"],
  ["O-47", "Régimen simple de tributación"],
  ["R-99-PN", "No aplica – Otros"],
];

export const TAX_REGIME_OPTIONS: Array<[string, string]> = [
  ["responsable_iva", "Responsable de IVA"],
  ["no_responsable_iva", "No responsable de IVA"],
  ["regimen_simple", "Régimen simple de tributación"],
  ["gran_contribuyente", "Gran contribuyente"],
  ["autorretenedor", "Autorretenedor"],
  ["no_contribuyente", "No contribuyente"],
];

export const ENTITY_DOC_TYPES: Array<[string, string]> = [
  ["NIT", "NIT"],
  ["CC", "Cédula de ciudadanía"],
  ["CE", "Cédula de extranjería"],
  ["PP", "Pasaporte"],
  ["NIT_EXT", "NIT de otro país"],
  ["PPT", "Permiso por protección temporal"],
  ["PEP", "Permiso especial de permanencia"],
  ["OTRO", "Otro"],
];

// Conceptos de notas (REQUIERE VALIDACIÓN con el proveedor tecnológico y la contadora).
export const CREDIT_NOTE_CONCEPTS: Array<[string, string]> = [
  ["1", "Devolución parcial de los bienes o no aceptación del servicio"],
  ["2", "Anulación de la factura"],
  ["3", "Rebaja o descuento parcial o total"],
  ["4", "Ajuste de precio"],
  ["5", "Descuento comercial por pronto pago"],
  ["6", "Descuento comercial por volumen de ventas"],
];

export const DEBIT_NOTE_CONCEPTS: Array<[string, string]> = [
  ["1", "Intereses"],
  ["2", "Gastos por cobrar"],
  ["3", "Cambio del valor"],
  ["4", "Otros"],
];

export const FISCAL_PERMISSIONS = [
  "fiscal",
  "fiscal_send",
  "fiscal_notes",
  "fiscal_download",
  "fiscal_config",
  "fiscal_numbering",
  "fiscal_provider",
  "fiscal_audit",
] as const;

export type FiscalPermission = (typeof FISCAL_PERMISSIONS)[number];

export type AccessScope = {
  is_platform_admin: boolean;
  is_owner: boolean;
  role: string | null;
  permissions: string[];
  point_id: string | null;
  point_ids: string[] | null;
  scope: "global" | "organization" | "points" | "point";
};

export type ReadinessCheck = { key: string; label: string; ok: boolean; na: boolean; detail: string | null };

export type RangeInfo = {
  id: string;
  name: string | null;
  document_type: FiscalDocumentType;
  environment: FiscalEnvironment;
  prefix: string;
  resolution_number: string | null;
  resolution_date: string | null;
  valid_from: string | null;
  valid_until: string | null;
  range_from: number;
  range_to: number;
  next_number: number;
  remaining: number;
  used_pct: number;
  days_left: number | null;
  status: "draft" | "active" | "inactive" | "exhausted" | "expired";
  near_exhaustion: boolean;
  near_expiry: boolean;
  expired: boolean;
  point_ids: string[];
  requires_resolution: boolean;
  alert_percent: number;
  alert_days: number;
  technical_key_hint: string | null;
  fiscal_entity_id?: string;
  entity_name?: string | null;
};

export type PointReadiness = {
  point: { id: string; name: string; code: string; status: PointStatus; kind: "point" | "warehouse"; store_id: string };
  ready: boolean;
  checks: ReadinessCheck[];
  missing: string[];
  warnings: string[];
  environment: FiscalEnvironment;
  document_type: FiscalDocumentType;
  enabled: boolean;
  org_enabled: boolean;
  configured: boolean;
  pos_electronic_default: boolean;
  entity: { id: string; legal_name: string; document_type: string; document_number: string | null; verification_digit: string | null; status: string } | null;
  provider: { account_id: string; code: string; name: string; status: string; environment: FiscalEnvironment; provider_status: string } | null;
  range: RangeInfo | null;
  contingency_id: string | null;
};

export type FiscalEntity = {
  id: string;
  store_id: string;
  person_type: "natural" | "juridica";
  legal_name: string;
  trade_name: string | null;
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
  dian_email: string | null;
  rut_date: string | null;
  prices_include_tax: boolean;
  status: "draft" | "active" | "inactive";
  notes: string | null;
  missing?: string[];
  points?: Array<{ id: string; name: string }>;
};

export type FiscalEstablishment = {
  id: string;
  store_id: string;
  fiscal_entity_id: string;
  point_id: string | null;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive";
};

export type ProviderInfo = {
  code: string;
  name: string;
  status: "available" | "planned" | "disabled";
  supports_production: boolean;
  supports_webhooks: boolean;
  requires_certificate: boolean;
  notes: string | null;
};

export type ProviderAccount = {
  id: string;
  store_id: string;
  fiscal_entity_id: string;
  provider: string;
  environment: FiscalEnvironment;
  label: string | null;
  external_account_id: string | null;
  settings: Record<string, unknown>;
  credentials_hint: Record<string, string>;
  status: "draft" | "connected" | "error" | "disconnected";
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
  webhook_status: "unknown" | "ok" | "failing" | "disabled";
  webhook_last_event_at: string | null;
  webhook_failures: number;
  provider_name?: string;
  provider_status?: string;
  supports_webhooks?: boolean;
  supports_production?: boolean;
  webhook_path?: string | null;
};

export type FiscalDocumentRow = {
  id: string;
  store_id: string;
  store_name?: string | null;
  point_id: string | null;
  point_name: string | null;
  document_type: FiscalDocumentType;
  environment: FiscalEnvironment;
  status: FiscalStatus;
  full_number: string | null;
  prefix: string | null;
  number: number | null;
  issue_date: string;
  total: number;
  tax_total: number;
  customer_name: string | null;
  customer_doc: string | null;
  cufe: string | null;
  provider: string | null;
  provider_status: string | null;
  dian_status: string | null;
  attempts: number;
  last_error_message: string | null;
  created_by_name: string | null;
  issuer_name: string | null;
  issuer_doc: string | null;
  related_document_id: string | null;
  source_number: string | null;
};

export type SearchPage<T> = { ok: true; items: T[]; next_cursor: { t: string; id: string } | null; totals?: { count: number; total: number; tax: number } | null };

export type OrgSettings = {
  store_id: string;
  shared_customers: boolean;
  fiscal_enabled: boolean;
  remission_policy: "allow" | "warn" | "block";
  remission_max_days: number;
  final_consumer_doc: string;
  final_consumer_name: string;
  updated_at: string;
  updated_by_name: string | null;
};

export type AuditRow = {
  id: string;
  store_id: string | null;
  store_name?: string | null;
  point_id: string | null;
  point_name?: string | null;
  user_id: string | null;
  user_name: string | null;
  category: "ops" | "fiscal" | "security" | "auth" | "users" | "config" | "export";
  severity: "info" | "warning" | "critical";
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export const AUDIT_CATEGORY_INFO: Record<AuditRow["category"], { label: string; icon: string }> = {
  ops: { label: "Operación", icon: "🧰" },
  fiscal: { label: "Fiscal", icon: "🏛️" },
  security: { label: "Seguridad", icon: "🛡️" },
  auth: { label: "Sesiones", icon: "🔑" },
  users: { label: "Usuarios y permisos", icon: "👥" },
  config: { label: "Configuración", icon: "⚙️" },
  export: { label: "Exportaciones y descargas", icon: "📤" },
};

// Respuesta estándar de las funciones fiscales de la base.
export type FiscalRpcError = { ok: false; code: string; message: string; missing?: string[]; checks?: ReadinessCheck[] };
export type FiscalRpcResult<T extends object> = (T & { ok: true }) | FiscalRpcError;

export function isRpcError(value: unknown): value is FiscalRpcError {
  return Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === false);
}

export const docLabel = (type: string) => DOC_TYPE_INFO[type as FiscalDocumentType]?.short ?? type;
export const statusLabel = (status: string) => STATUS_INFO[status as FiscalStatus]?.label ?? status;
