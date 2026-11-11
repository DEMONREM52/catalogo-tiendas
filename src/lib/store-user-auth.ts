export const STORE_MENU_PERMISSIONS = [
  "store",
  "billing",
  "pos",
  "pos_credit",
  "pos_layaways",
  "pos_quotes",
  "pos_all_sales",
  "cash",
  "cash_manage",
  "sales_void",
  "sales_return",
  "price_approve",
  "exports",
  "clients",
  "clients_delete",
  "credit",
  "receivables",
  "users",
  "products",
  "products_view",
  "products_prices",
  "costs_view",
  "categories",
  "orders",
  "inventory",
  "inventory_adjust",
  "inventory_alerts",
  "transfers",
  "stock_requests",
  "stock_requests_manage",
  "notifications_config",
  "purchases",
  "purchases_void",
  "suppliers",
  "payables",
  "internal_credit",
  "internal_credit_manage",
  "audit",
  "reports",
  "points",
  "fiscal",
  "fiscal_send",
  "fiscal_notes",
  "fiscal_download",
  "fiscal_config",
  "fiscal_numbering",
  "fiscal_provider",
  "fiscal_audit",
  "profit_view",
  "profit_rules",
  "profit_approve",
  "profit_beneficiaries",
  "profit_settle",
  "profit_settle_approve",
  "profit_pay",
  "expenses",
  "expenses_pay",
  "budgets",
  "payroll",
  "payroll_approve",
  "payroll_pay",
  "payroll_electronic",
  // 20261285: permisos desglosados (antes venían dentro de «products» o «users»; los mensajes eran de todos).
  "products_create",
  "products_delete",
  "products_import",
  "catalogs",
  "landing",
  "messages",
  "security",
  "users_passwords",
  "users_delete",
] as const;

/**
 * Marca de la versión de permisos. Un usuario sin la marca se guardó antes de desglosar: hereda los permisos
 * nuevos de su permiso grande (como funcionaba) hasta que se corra la migración 20261285 o se le vuelvan a guardar.
 */
export const PERMISSIONS_V2_MARK = "perm_v2";
/** Marca del desglose del POS (20261319). Sin ella, quien tiene «pos» hereda crédito, apartados, cotizaciones y ver todas las ventas. */
export const POS_FINE_MARK = "perm_pos2";

export type StoreMenuPermission = (typeof STORE_MENU_PERMISSIONS)[number];

export const ERP_PERMISSIONS: StoreMenuPermission[] = [
  "inventory",
  "inventory_adjust",
  "transfers",
  "purchases",
  "purchases_void",
  "suppliers",
  "payables",
  "audit",
  "reports",
];

export function normalizeStoreUsername(username: string) {
  return username.trim().toLowerCase();
}

/** Usuario como se muestra: tal como lo escribieron (sin espacios). Para entrar no importan mayúsculas. */
export function displayStoreUsername(username: string) {
  return username.trim().replace(/\s+/g, "");
}

export function isValidStoreUsername(username: string) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizeStoreUsername(username));
}

/** Mínimo de caracteres de la contraseña de un trabajador. */
export const STORE_STAFF_MIN_PASSWORD = 4;

/**
 * Contraseña que se guarda en Supabase para un trabajador. Supabase exige mínimo 6 a 8 caracteres, así que
 * las contraseñas cortas (4 a 7) se completan siempre de la misma forma al crearlas y al entrar.
 * Las de 8 o más quedan iguales (los accesos que ya existen siguen funcionando).
 */
export function storeStaffAuthPassword(password: string) {
  return password.length < 8 ? `${password}#RemHub9` : password;
}

export function storeStaffAuthEmail(storeId: string, username: string) {
  return `staff+${storeId}.${normalizeStoreUsername(username)}@example.com`;
}
