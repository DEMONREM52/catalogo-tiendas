import type { SupabaseClient } from "@supabase/supabase-js";

export type StorePaymentMethod = {
  id?: string;
  provider: string;
  name: string;
  enabled: boolean;
  credentials?: Record<string, unknown> | null;
};

export type StoreBillingRecord = {
  id?: string;
  store_id?: string;
  business_name?: string | null;
  nit?: string | null;
  address?: string | null;
  phone?: string | null;
  city?: string | null;
  email?: string | null;
  currency?: string | null;
  default_print_format?: string | null;
  invoice_prefix?: string | null;
  remision_prefix?: string | null;
  electronic_provider?: string | null;
  siigo_api_url?: string | null;
  siigo_api_token?: string | null;
  siigo_api_key?: string | null;
  siigo_company_id?: string | null;
  siigo_invoice_path?: string | null;
  siigo_username?: string | null;
  siigo_access_key?: string | null;
  siigo_partner_id?: string | null;
  siigo_document_id?: string | null;
  siigo_seller_id?: string | null;
  siigo_payment_type_id?: string | null;
  electronic_test_mode?: boolean | null;
  default_tax_rate?: number | null;
  payment_methods?: StorePaymentMethod[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const TABLE_CANDIDATES = ["billing_settings", "store_billing_settings"] as const;

export async function fetchStoreBillingSettings(
  client: SupabaseClient,
  storeId: string,
): Promise<StoreBillingRecord | null> {
  let lastError: Error | null = null;

  for (const tableName of TABLE_CANDIDATES) {
    const { data, error } = await client
      .from(tableName)
      .select("*")
      .eq("store_id", storeId)
      .maybeSingle();

    if (!error && data) {
      return data as StoreBillingRecord;
    }

    lastError = error ? new Error(error.message) : lastError;
  }

  if (lastError) {
    console.warn("billing_settings fallback error:", lastError.message);
  }

  return null;
}

export async function upsertStoreBillingSettings(
  client: SupabaseClient,
  storeId: string,
  payload: Record<string, unknown>,
): Promise<StoreBillingRecord | null> {
  const normalized = { ...payload, store_id: storeId };
  let lastError: Error | null = null;

  for (const tableName of TABLE_CANDIDATES) {
    const { data, error } = await client
      .from(tableName)
      .upsert(normalized, { onConflict: "store_id" })
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return data as StoreBillingRecord;
    }

    lastError = error ? new Error(error.message) : lastError;
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}
