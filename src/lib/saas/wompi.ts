import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Wompi de REMHUB (cobro de suscripciones). Es otra cuenta y otras llaves que las de las tiendas:
 * las tiendas configuran su propio Wompi en «Facturación y pagos» para cobrar SUS ventas.
 *
 * Variables (solo servidor, NUNCA con NEXT_PUBLIC_):
 *   WOMPI_REMHUB_ENV               sandbox | production   (por defecto sandbox)
 *   WOMPI_REMHUB_PUBLIC_KEY        pub_test_… / pub_prod_…
 *   WOMPI_REMHUB_PRIVATE_KEY       prv_test_… / prv_prod_…  (para consultar la transacción)
 *   WOMPI_REMHUB_INTEGRITY_SECRET  test_integrity_… / prod_integrity_…
 *   WOMPI_REMHUB_EVENTS_SECRET     test_events_… / prod_events_…
 * Documentación: docs.wompi.co (Web Checkout, Eventos, Ambientes y llaves).
 */

export type WompiEnv = "sandbox" | "production";

export function remhubWompi() {
  const env: WompiEnv = process.env.WOMPI_REMHUB_ENV === "production" ? "production" : "sandbox";
  const cfg = {
    env,
    publicKey: process.env.WOMPI_REMHUB_PUBLIC_KEY ?? "",
    privateKey: process.env.WOMPI_REMHUB_PRIVATE_KEY ?? "",
    integritySecret: process.env.WOMPI_REMHUB_INTEGRITY_SECRET ?? "",
    eventsSecret: process.env.WOMPI_REMHUB_EVENTS_SECRET ?? "",
    apiBase: env === "production" ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1",
  };
  // Las llaves de pruebas nunca se usan en producción (y al revés): se revisa el prefijo.
  const want = env === "production" ? "prod" : "test";
  const problems: string[] = [];
  if (!cfg.publicKey) problems.push("WOMPI_REMHUB_PUBLIC_KEY");
  else if (!cfg.publicKey.startsWith(`pub_${want}_`)) problems.push(`WOMPI_REMHUB_PUBLIC_KEY no es de ${env}`);
  if (!cfg.integritySecret) problems.push("WOMPI_REMHUB_INTEGRITY_SECRET");
  else if (!cfg.integritySecret.startsWith(`${want}_integrity_`)) problems.push(`WOMPI_REMHUB_INTEGRITY_SECRET no es de ${env}`);
  if (!cfg.eventsSecret) problems.push("WOMPI_REMHUB_EVENTS_SECRET");
  else if (!cfg.eventsSecret.startsWith(`${want}_events_`)) problems.push(`WOMPI_REMHUB_EVENTS_SECRET no es de ${env}`);
  if (cfg.privateKey && !cfg.privateKey.startsWith(`prv_${want}_`)) problems.push(`WOMPI_REMHUB_PRIVATE_KEY no es de ${env}`);
  return { ...cfg, ready: problems.length === 0, problems };
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Firma de integridad del Web Checkout: SHA-256 de <referencia><centavos><moneda>[<expiración>]<secreto>. */
export function integritySignature(reference: string, amountInCents: number, currency: string, secret: string, expirationTime?: string) {
  return sha256(`${reference}${amountInCents}${currency}${expirationTime ?? ""}${secret}`);
}

/** Dirección del Web Checkout de Wompi con todos sus datos firmados. */
export function checkoutUrl(p: { publicKey: string; reference: string; amountInCents: number; currency: string; signature: string; redirectUrl: string; email?: string | null; expirationTime?: string }) {
  const q = new URLSearchParams({
    "public-key": p.publicKey,
    currency: p.currency,
    "amount-in-cents": String(p.amountInCents),
    reference: p.reference,
    "signature:integrity": p.signature,
    "redirect-url": p.redirectUrl,
  });
  if (p.expirationTime) q.set("expiration-time", p.expirationTime);
  if (p.email) q.set("customer-data:email", p.email);
  return `https://checkout.wompi.co/p/?${q.toString()}`;
}

type WompiEvent = {
  event?: string;
  data?: Record<string, unknown>;
  environment?: string;
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number;
};

/** Revisa el checksum del evento: valores de signature.properties (en su orden) + timestamp + secreto de eventos. */
export function verifyEventChecksum(body: WompiEvent, secret: string, headerChecksum?: string | null) {
  const props = body.signature?.properties;
  const given = String(headerChecksum || body.signature?.checksum || "").toLowerCase();
  if (!Array.isArray(props) || !props.length || !given || typeof body.timestamp !== "number" || !secret) return false;
  const values = props.map((path) => {
    let cur: unknown = body.data;
    for (const key of path.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined;
    return cur === undefined || cur === null ? "" : String(cur);
  });
  const expected = sha256(`${values.join("")}${body.timestamp}${secret}`);
  const a = Buffer.from(expected, "utf8"), b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WompiTx = { id: string; status: string; reference: string; amount_in_cents: number; currency: string; payment_method_type?: string };

/** Consulta a Wompi el estado REAL de la transacción (no se confía solo en el aviso). */
export async function fetchTransaction(apiBase: string, key: string, id: string): Promise<WompiTx | null> {
  const res = await fetch(`${apiBase}/transactions/${encodeURIComponent(id)}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: WompiTx };
  return json.data ?? null;
}
