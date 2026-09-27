import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type AddiEnvironment = "staging" | "production";

export type AddiCredentials = {
  clientId: string;
  clientSecret: string;
  environment: AddiEnvironment;
};

export class AddiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function createAddiAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AddiRequestError("El servidor no tiene configuradas las credenciales privadas de Supabase.", 500);
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getAuthenticatedUser(request: Request): Promise<User> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!url || !anonKey) {
    throw new AddiRequestError("El servidor no tiene configurada la autenticación de Supabase.", 500);
  }
  if (!accessToken) throw new AddiRequestError("Inicia sesión para continuar.", 401);

  const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) throw new AddiRequestError("La sesión no es válida.", 401);
  return data.user;
}

export async function assertStoreOwner(
  admin: SupabaseClient,
  storeId: string,
  user: User,
): Promise<void> {
  const { data: store, error } = await admin
    .from("stores")
    .select("owner_id")
    .eq("id", storeId)
    .maybeSingle();

  if (error) throw new AddiRequestError("No se pudo validar la tienda.", 500);
  if (!store) throw new AddiRequestError("No se encontró la tienda.", 404);
  if (store.owner_id !== user.id) {
    throw new AddiRequestError("Solo el propietario puede configurar ADDI para esta tienda.", 403);
  }
}

export function getSiteOrigin(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configuredUrl) {
    throw new AddiRequestError("Configura NEXT_PUBLIC_SITE_URL con el dominio HTTPS de la tienda.", 503);
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new AddiRequestError("NEXT_PUBLIC_SITE_URL no es una URL válida.", 500);
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new AddiRequestError("NEXT_PUBLIC_SITE_URL debe usar HTTPS y no incluir credenciales.", 500);
  }

  return url.origin;
}

export async function requestAddiAccessToken(credentials: AddiCredentials): Promise<string> {
  const staging = credentials.environment === "staging";
  const authUrl = staging
    ? "https://auth.addi-staging.com/oauth/token"
    : "https://auth.addi.com/oauth/token";
  const audience = staging ? "https://api.staging.addi.com" : "https://api.addi.com";

  let response: Response;
  try {
    response = await fetch(authUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        audience,
        grant_type: "client_credentials",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AddiRequestError("No se pudo conectar con el servicio de autenticación de ADDI.", 502);
  }

  if (!response.ok) {
    throw new AddiRequestError(
      response.status === 401 || response.status === 403
        ? "ADDI no aceptó las credenciales o el ambiente seleccionado."
        : "ADDI no pudo validar las credenciales en este momento.",
      response.status === 401 || response.status === 403 ? 400 : 502,
    );
  }

  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("access_token" in result)) {
    throw new AddiRequestError("ADDI no devolvió un token de acceso válido.", 502);
  }

  const accessToken = (result as { access_token?: unknown }).access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new AddiRequestError("ADDI no devolvió un token de acceso válido.", 502);
  }

  return accessToken;
}

export function addiCallbackSignature(storeId: string, attemptId: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new AddiRequestError("El servidor no tiene configurada la firma privada de callbacks.", 500);
  }

  return createHmac("sha256", secret)
    .update(`${storeId}:${attemptId}`)
    .digest("hex");
}
