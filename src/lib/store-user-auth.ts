export const STORE_MENU_PERMISSIONS = [
  "store",
  "billing",
  "pos",
  "sales_void",
  "sales_return",
  "clients",
  "clients_delete",
  "credit",
  "receivables",
  "users",
  "products",
  "products_view",
  "categories",
  "orders",
  "inventory",
  "inventory_adjust",
  "transfers",
  "stock_requests",
  "stock_requests_manage",
  "purchases",
  "suppliers",
  "payables",
  "audit",
  "points",
  "fiscal",
  "fiscal_send",
  "fiscal_notes",
  "fiscal_download",
  "fiscal_config",
  "fiscal_numbering",
  "fiscal_provider",
  "fiscal_audit",
] as const;

export type StoreMenuPermission = (typeof STORE_MENU_PERMISSIONS)[number];

export const ERP_PERMISSIONS: StoreMenuPermission[] = [
  "inventory",
  "inventory_adjust",
  "transfers",
  "purchases",
  "suppliers",
  "payables",
  "audit",
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
