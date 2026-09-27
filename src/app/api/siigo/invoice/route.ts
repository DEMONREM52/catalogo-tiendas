import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSiigoInvoice, type SiigoConfig } from "@/lib/siigo";

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function getStoreSiigoConfig(
  admin: SupabaseClient,
  storeId: string,
): Promise<Partial<SiigoConfig>> {
  const { data, error } = await admin
    .from("billing_settings")
    .select(
      "siigo_api_url,siigo_api_token,siigo_api_key,siigo_company_id,siigo_invoice_path,siigo_username,siigo_access_key,siigo_partner_id,siigo_document_id,siigo_seller_id,siigo_payment_type_id, electronic_provider"
    )
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new RequestError(`No se pudo cargar la configuración de Siigo: ${error.message}`, 500);
  }

  if (!data) {
    return {};
  }

  return {
    apiUrl: data.siigo_api_url ?? undefined,
    apiToken: data.siigo_api_token ?? undefined,
    apiKey: data.siigo_api_key ?? data.siigo_access_key ?? undefined,
    companyId: data.siigo_company_id ?? undefined,
    invoicePath: data.siigo_invoice_path ?? undefined,
  };
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new RequestError("El servidor no tiene configuradas las credenciales de Supabase.", 500);
    }
    if (!accessToken) throw new RequestError("Inicia sesión para emitir una factura.", 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) throw new RequestError("La sesión no es válida.", 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const body = await request.json();
    const storeId = typeof body?.store_id === "string" ? body.store_id : "";
    if (!storeId) throw new RequestError("Falta el identificador de la tienda.", 400);

    const { data: store, error: storeError } = await admin
      .from("stores")
      .select("id,owner_id")
      .eq("id", storeId)
      .maybeSingle();
    if (storeError) throw new RequestError(storeError.message, 500);
    if (!store) throw new RequestError("No se encontró la tienda.", 404);

    let allowed = store.owner_id === authData.user.id;
    if (!allowed) {
      const { data: membership, error: membershipError } = await admin
        .from("store_users")
        .select("role,active,permissions")
        .eq("store_id", storeId)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (membershipError) throw new RequestError(membershipError.message, 500);
      allowed = Boolean(
        membership?.active &&
        (membership.role === "store_admin" || membership.permissions?.includes("pos")),
      );
    }
    if (!allowed) throw new RequestError("No tienes permiso para emitir facturas en esta tienda.", 403);

    const payload = body?.payload ?? body;
    const config = await getStoreSiigoConfig(admin, storeId);
    const result = await createSiigoInvoice(payload, config);

    const { error: logError } = await admin.from("siigo_invoices").insert({
      order_id: body.order_id ?? null,
      document_id: body.document_id ?? null,
      siigo_invoice_id: result?.id ?? result?.data?.id ?? null,
      status: result?.status ?? null,
      payload: body,
      response: result,
    });
    if (logError) {
      console.error("La factura se emitió, pero no se pudo registrar el seguimiento de Siigo:", logError.message);
      return NextResponse.json({
        ok: true,
        result,
        warning: "La factura se emitió, pero no se pudo guardar el registro de seguimiento.",
      });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error: unknown) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = String((error as Error)?.message ?? error);
    if (status >= 500) console.error("No se pudo emitir la factura Siigo:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}
