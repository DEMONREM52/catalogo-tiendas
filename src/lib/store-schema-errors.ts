export function getStoreDataSchemaErrorMessage(error: unknown) {
  const message = String((error as Error)?.message ?? error);
  const normalized = message.toLowerCase();
  const missingPricingSchema =
    (normalized.includes("price_1") && normalized.includes("does not exist")) ||
    (normalized.includes("price_list") && normalized.includes("does not exist")) ||
    (normalized.includes("doc_number") && normalized.includes("null value"));

  if (missingPricingSchema) {
    return `${message}\n\nFalta actualizar el esquema de Supabase. Ejecuta supabase/pos-precios-clientes.sql y vuelve a cargar la página.`;
  }

  return message;
}
