export const STORE_MENU_PERMISSIONS = [
  "store",
  "billing",
  "pos",
  "clients",
  "users",
  "products",
  "categories",
  "orders",
] as const;

export type StoreMenuPermission = (typeof STORE_MENU_PERMISSIONS)[number];

export function normalizeStoreUsername(username: string) {
  return username.trim().toLowerCase();
}

export function isValidStoreUsername(username: string) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizeStoreUsername(username));
}

export function storeStaffAuthEmail(storeId: string, username: string) {
  return `staff+${storeId}.${normalizeStoreUsername(username)}@example.com`;
}
