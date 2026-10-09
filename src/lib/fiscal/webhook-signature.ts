// Firma de webhooks (HMAC-SHA256 sobre «timestamp.cuerpo»), con tolerancia de tiempo
// para evitar que un mensaje viejo se reenvíe. Lo usa el simulador y sirve de base
// para proveedores que firmen de forma parecida (cada adaptador decide su esquema).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-remhub-signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, timestamp: number, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/** Cabecera «t=1700000000,v1=abcd…». */
export function buildSignatureHeader(secret: string, rawBody: string, now: Date = new Date()) {
  const timestamp = Math.floor(now.getTime() / 1000);
  return `t=${timestamp},v1=${signPayload(secret, timestamp, rawBody)}`;
}

export type SignatureCheck = { valid: boolean; reason?: string; timestamp?: number };

export function verifySignatureHeader(input: {
  header: string | null | undefined;
  secret: string | null | undefined;
  rawBody: string;
  now?: Date;
  toleranceSeconds?: number;
}): SignatureCheck {
  const { header, secret, rawBody } = input;
  if (!secret) return { valid: false, reason: "La cuenta no tiene secreto de webhook configurado." };
  if (!header) return { valid: false, reason: "Falta la firma del webhook." };
  const parts = header.split(",").map((p) => p.trim());
  const timestamp = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(timestamp) || signatures.length === 0) return { valid: false, reason: "Firma con formato inválido." };
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return { valid: false, reason: "La firma está vencida (posible reenvío).", timestamp };
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody), "hex");
  const match = signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { valid: true, timestamp } : { valid: false, reason: "La firma no coincide.", timestamp };
}
