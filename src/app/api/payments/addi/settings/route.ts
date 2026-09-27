import { NextResponse } from "next/server";
import {
  AddiRequestError,
  assertStoreOwner,
  createAddiAdminClient,
  getAuthenticatedUser,
  requestAddiAccessToken,
  type AddiEnvironment,
} from "@/lib/payments/addi-server";

export const runtime = "nodejs";

function validStoreId(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function errorResponse(error: unknown) {
  const status = error instanceof AddiRequestError ? error.status : 500;
  if (status >= 500) console.error("No se pudo gestionar la configuración privada de ADDI.");
  return NextResponse.json(
    { ok: false, error: error instanceof AddiRequestError ? error.message : "No se pudo guardar la configuración de ADDI." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    const storeId = new URL(request.url).searchParams.get("store_id");
    if (!validStoreId(storeId)) throw new AddiRequestError("Identificador de tienda no válido.", 400);

    const user = await getAuthenticatedUser(request);
    const admin = createAddiAdminClient();
    await assertStoreOwner(admin, storeId, user);

    const { data, error } = await admin
      .from("store_addi_credentials")
      .select("environment")
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw new AddiRequestError("No se pudo consultar la configuración de ADDI.", 500);

    return NextResponse.json(
      { ok: true, configured: Boolean(data), environment: data?.environment ?? "staging" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AddiRequestError("El JSON de configuración no es válido.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AddiRequestError("La configuración enviada no es válida.", 400);
    }

    const value = body as Record<string, unknown>;
    const storeId = typeof value.store_id === "string" ? value.store_id : null;
    const clientId = typeof value.client_id === "string" ? value.client_id.trim() : "";
    const clientSecret = typeof value.client_secret === "string" ? value.client_secret.trim() : "";
    const environment = value.environment;

    if (!validStoreId(storeId)) throw new AddiRequestError("Identificador de tienda no válido.", 400);
    if (!clientId || clientId.length > 250 || !clientSecret || clientSecret.length > 1000) {
      throw new AddiRequestError("Ingresa el client ID y el client secret entregados por ADDI.", 400);
    }
    if (environment !== "staging" && environment !== "production") {
      throw new AddiRequestError("Selecciona un ambiente válido de ADDI.", 400);
    }

    const user = await getAuthenticatedUser(request);
    const admin = createAddiAdminClient();
    await assertStoreOwner(admin, storeId, user);

    const credentials = {
      clientId,
      clientSecret,
      environment: environment as AddiEnvironment,
    };
    await requestAddiAccessToken(credentials);

    const { error } = await admin.from("store_addi_credentials").upsert(
      {
        store_id: storeId,
        client_id: clientId,
        client_secret: clientSecret,
        environment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );
    if (error) throw new AddiRequestError("No se pudieron guardar las credenciales de ADDI.", 500);

    return NextResponse.json(
      { ok: true, configured: true, environment },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
