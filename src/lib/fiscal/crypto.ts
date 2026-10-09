// Cifrado de credenciales del proveedor tecnológico (solo servidor).
// AES-256-GCM con la llave FISCAL_SECRETS_KEY (32 bytes en base64). Nunca usar NEXT_PUBLIC_.
// El texto cifrado queda «atado» a su dueño (AAD): no sirve si se copia a otra cuenta.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

export class FiscalConfigError extends Error {
  code = "SERVER_CONFIG";
}

function assertServer() {
  if (typeof window !== "undefined") throw new Error("Las credenciales fiscales solo se manejan en el servidor.");
}

function readKey(envName: string): Buffer | null {
  const raw = process.env[envName]?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new FiscalConfigError(`${envName} debe ser una llave de 32 bytes en base64.`);
  }
  return key;
}

function currentKey(): Buffer {
  const key = readKey("FISCAL_SECRETS_KEY");
  if (!key) {
    throw new FiscalConfigError(
      "Falta configurar FISCAL_SECRETS_KEY en el servidor (32 bytes en base64). Genera una con: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return key;
}

/** Hay llave para cifrar credenciales (para mostrar avisos claros en la interfaz). */
export function hasSecretsKey() {
  try {
    return readKey("FISCAL_SECRETS_KEY") !== null;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string, aad: string): string {
  assertServer();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", currentKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(payload: string, aad: string): string {
  assertServer();
  const [version, iv, tag, body] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("Credencial cifrada con un formato desconocido.");
  // Se intenta con la llave actual y, si se está rotando, con la anterior.
  const keys = [currentKey(), readKey("FISCAL_SECRETS_KEY_PREVIOUS")].filter((k): k is Buffer => Boolean(k));
  let lastError: unknown = null;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("No se pudo descifrar la credencial (llave distinta o dato alterado).", { cause: lastError });
}

/** «••••1234»: nunca se muestra una credencial completa. */
export function maskSecret(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  return "••••" + (clean.length > 8 ? clean.slice(-4) : "");
}

export function secretAad(ownerType: string, ownerId: string, name: string) {
  return `${ownerType}:${ownerId}:${name}`;
}

export function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}
