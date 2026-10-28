// Firmas y direcciones de Bold sin dependencias del servidor (se prueban aparte).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Firma de integridad: SHA-256 de {referencia}{monto}{divisa}{llave secreta}. */
export function boldIntegrity(reference: string, amount: number, currency: string, secret: string) {
  return createHash("sha256").update(`${reference}${amount}${currency}${secret}`).digest("hex");
}

/** Firma del webhook (x-bold-signature): HMAC-SHA256 en hexadecimal del cuerpo en base64. En pruebas Bold firma con llave vacía. */
export function boldWebhookValid(rawBody: string, header: string | null, secrets: string[]) {
  const got = (header ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(got)) return false;
  const encoded = Buffer.from(rawBody, "utf8").toString("base64");
  return secrets.some((secret) => {
    const want = createHmac("sha256", secret).update(encoded).digest("hex");
    return timingSafeEqual(Buffer.from(want, "hex"), Buffer.from(got, "hex"));
  });
}

/**
 * Con qué llave viene firmado el aviso: la de producción, la de pruebas (o la vacía de pruebas) o ninguna.
 * La firma de pruebas con llave vacía la puede calcular cualquiera: nunca debe mover un pago de producción.
 */
export function boldWebhookSigner(rawBody: string, header: string | null, keys: { prod: string | null; test: string | null }): "production" | "test" | null {
  if (keys.prod && boldWebhookValid(rawBody, header, [keys.prod])) return "production";
  if (boldWebhookValid(rawBody, header, ["", ...(keys.test ? [keys.test] : [])])) return "test";
  return null;
}

/** Referencia única que viaja a Bold (letras, números y guiones). */
export function boldReference(receipt: string | number | null) {
  return `rh${receipt ? `${String(receipt).replace(/\D/g, "").slice(0, 12)}-` : ""}${randomBytes(6).toString("hex")}`;
}

/** Dirección https a donde Bold devuelve al cliente: la misma página (mismo dominio de la solicitud). */
export function boldReturnUrl(request: Request, wanted: string | undefined, fallbackPath: string) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  try {
    const u = new URL(wanted ?? "");
    if (u.host.toLowerCase() === host && (u.protocol === "https:" || u.hostname === "localhost")) {
      u.hash = "";
      for (const k of ["bold-order-id", "bold-tx-status"]) u.searchParams.delete(k);
      return u.toString();
    }
  } catch { /* sin dirección: se usa la de respaldo */ }
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}${fallbackPath}`;
}
