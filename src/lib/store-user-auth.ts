export const STORE_MENU_PERMISSIONS = [
  "store",
  "billing",
  "pos",
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

export function isValidStoreUsername(username: string) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizeStoreUsername(username));
}

export function storeStaffAuthEmail(storeId: string, username: string) {
  return `staff+${storeId}.${normalizeStoreUsername(username)}@example.com`;
}
