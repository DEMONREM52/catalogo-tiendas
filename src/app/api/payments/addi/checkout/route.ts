import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AddiRequestError,
  addiCallbackSignature,
  createAddiAdminClient,
  getSiteOrigin,
  requestAddiAccessToken,
  type AddiCredentials,
} from "@/lib/payments/addi-server";

export const runtime = "nodejs";

type AddiCustomerInput = {
  id_type?: unknown;
  id_number?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  cellphone?: unknown;
  address?: unknown;
  city?: unknown;
};

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new AddiRequestError(`${label} es obligatorio.`, 400);
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new AddiRequestError(`${label} es obligatorio y debe tener máximo ${maxLength} caracteres.`, 400);
  }
  return result;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "");
  if (!/^\d{10}$/.test(digits)) {
    throw new AddiRequestError("Ingresa un celular colombiano válido de 10 dígitos.", 400);
  }
  return digits;
}

function priceInCents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AddiRequestError("El pedido contiene un precio no válido.", 400);
  }
  return Math.round(amount * 100);
}

function secureImageUrl(value: unknown, fallback: string, siteOrigin: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const url = new URL(value, siteOrigin);
    return url.protocol === "https:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function allowedAddiRedirect(location: string): string {
  let redirect: URL;
  try {
    redirect = new URL(location);
  } catch {
    throw new AddiRequestError("ADDI no devolvió un enlace de pago válido.", 502);
  }

  const host = redirect.hostname.toLowerCase();
  const isAddiHost =
    host === "addi.com" ||
    host.endsWith(".addi.com") ||
    host === "addi-staging.com" ||
    host.endsWith(".addi-staging.com");
  if (redirect.protocol !== "https:" || !isAddiHost) {
    throw new AddiRequestError("ADDI devolvió un enlace de pago fuera de sus dominios seguros.", 502);
  }

  return redirect.toString();
}

function errorResponse(error: unknown) {
  const status = error instanceof AddiRequestError ? error.status : 500;
  if (status >= 500) console.error("No se pudo iniciar el checkout de ADDI.");
  return NextResponse.json(
    { ok: false, error: error instanceof AddiRequestError ? error.message : "No se pudo iniciar el pago con ADDI." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let attemptId: string | null = null;
  let admin: SupabaseClient | null = null;
  let keepAttemptForRetry = false;

  try {
    admin = createAddiAdminClient();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AddiRequestError("La solicitud de pago no tiene un JSON válido.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AddiRequestError("Los datos del pago no son válidos.", 400);
    }

    const value = body as Record<string, unknown>;
    const orderToken = requiredText(value.order_token, "El pedido", 128);
    const customer = value.customer as AddiCustomerInput | null;
    if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
      throw new AddiRequestError("Completa los datos requeridos por ADDI.", 400);
    }

    const idType = requiredText(customer.id_type, "El tipo de documento", 8).toUpperCase();
    if (!["CC", "CE", "TI", "PA", "NIT"].includes(idType)) {
      throw new AddiRequestError("Selecciona un tipo de documento válido.", 400);
    }
    const idNumber = requiredText(customer.id_number, "El número de documento", 30).replace(/[.\s-]/g, "");
    if (!/^[A-Za-z0-9]+$/.test(idNumber)) {
      throw new AddiRequestError("El número de documento solo puede contener letras y números.", 400);
    }
    const firstName = requiredText(customer.first_name, "Los nombres", 100);
    const lastName = requiredText(customer.last_name, "Los apellidos", 100);
    const email = requiredText(customer.email, "El correo electrónico", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AddiRequestError("Ingresa un correo electrónico válido.", 400);
    }
    const cellphone = normalizePhone(requiredText(customer.cellphone, "El celular", 20));
    const addressLine = requiredText(customer.address, "La dirección de entrega", 160);
    const city = requiredText(customer.city, "La ciudad de entrega", 100);

    const { data: orderData, error: orderError } = await admin.rpc("get_order_by_token_v2", {
      p_token: orderToken,
    });
    if (orderError) throw new AddiRequestError("No se pudo consultar el pedido para el pago.", 500);

    const details = Array.isArray(orderData) ? orderData[0] : orderData;
    const order = details?.order;
    const items = details?.items;
    if (!order || !Array.isArray(items) || items.length === 0) {
      throw new AddiRequestError("No se encontró el pedido o no tiene productos.", 404);
    }
    if (!["confirmed", "completed"].includes(String(order.status))) {
      throw new AddiRequestError("La tienda debe confirmar el pedido antes de iniciar el pago.", 409);
    }
    if (String(order.currency ?? "COP").toUpperCase() !== "COP") {
      throw new AddiRequestError("ADDI solo admite pagos en pesos colombianos (COP).", 400);
    }
    if (String(order.payment_status ?? "").toLowerCase() === "paid") {
      throw new AddiRequestError("Este pedido ya está pagado.", 409);
    }

    const { data: currentPayment, error: currentPaymentError } = await admin.rpc(
      "get_wompi_payment_status",
      { p_token: orderToken },
    );
    if (currentPaymentError) {
      throw new AddiRequestError("No se pudo validar el estado actual del pago.", 500);
    }
    if (currentPayment?.payment_status === "paid") {
      throw new AddiRequestError("Este pedido ya está pagado.", 409);
    }
    if (currentPayment?.payment_status === "pending") {
      throw new AddiRequestError("Ya hay otro pago pendiente para este pedido. Espera su resultado antes de volver a pagar.", 409);
    }

    const storeId = String(order.store_id ?? details.store?.id ?? "");
    if (!storeId) throw new AddiRequestError("No se encontró la tienda asociada al pedido.", 500);
    const normalizedItems = items.map((item: Record<string, unknown>) => {
      const quantity = Number(item.qty);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
        throw new AddiRequestError("El pedido contiene una cantidad no válida.", 400);
      }
      const unitPriceCents = priceInCents(item.price);
      const productId = String(item.product_id ?? item.sku ?? "");
      if (!productId) throw new AddiRequestError("El pedido contiene un producto sin referencia.", 400);
      return {
        sku: productId,
        name: requiredText(item.name, "El nombre de un producto", 200),
        quantity,
        unitPriceCents,
        unitPrice: unitPriceCents / 100,
        pictureUrl: typeof item.image_url === "string" ? item.image_url : "",
      };
    });

    const { data: methods, error: methodsError } = await admin
      .from("store_payment_methods")
      .select("id")
      .eq("store_id", storeId)
      .eq("provider", "addi")
      .eq("enabled", true)
      .eq("show_on_invoice", true)
      .limit(1);
    if (methodsError) throw new AddiRequestError("No se pudo validar si ADDI está habilitado en esta tienda.", 500);
    if (!methods?.length) throw new AddiRequestError("ADDI no está habilitado para esta tienda.", 403);

    const { data: approvedAttempt, error: approvedError } = await admin
      .from("addi_payment_attempts")
      .select("id")
      .eq("store_id", storeId)
      .eq("order_token", orderToken)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    if (approvedError) throw new AddiRequestError("No se pudo validar el estado previo del pago ADDI.", 500);
    if (approvedAttempt) throw new AddiRequestError("Este pedido ya tiene un pago ADDI aprobado.", 409);

    const { data: storedCredentials, error: credentialsError } = await admin
      .from("store_addi_credentials")
      .select("client_id,client_secret,environment")
      .eq("store_id", storeId)
      .maybeSingle();
    if (credentialsError) throw new AddiRequestError("No se pudo consultar la configuración privada de ADDI.", 500);
    if (!storedCredentials?.client_id || !storedCredentials.client_secret) {
      throw new AddiRequestError("La tienda aún no ha configurado sus credenciales privadas de ADDI.", 409);
    }

    const credentials: AddiCredentials = {
      clientId: storedCredentials.client_id,
      clientSecret: storedCredentials.client_secret,
      environment: storedCredentials.environment,
    };
    const siteOrigin = getSiteOrigin();
    const totalCents = normalizedItems.reduce(
      (sum: number, item: { unitPriceCents: number; quantity: number }) =>
        sum + item.unitPriceCents * item.quantity,
      0,
    );
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
      throw new AddiRequestError("El total del pedido no permite iniciar un pago.", 400);
    }
    const expectedAmount = totalCents / 100;

    const { data: previousAttempt, error: previousError } = await admin
      .from("addi_payment_attempts")
      .select("id,status,redirect_url,created_at,updated_at")
      .eq("store_id", storeId)
      .eq("order_token", orderToken)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousError) throw new AddiRequestError("No se pudo consultar el intento anterior de ADDI.", 500);
    if (previousAttempt?.status === "pending" && previousAttempt.redirect_url) {
      return NextResponse.json(
        { ok: true, checkout_url: previousAttempt.redirect_url },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (
      previousAttempt?.status === "initiated" &&
      Date.now() - new Date(previousAttempt.updated_at).getTime() < 120000
    ) {
      throw new AddiRequestError("Ya se está preparando un pago para este pedido. Espera un momento.", 409);
    }

    if (previousAttempt?.status === "initiated") {
      const reservationTime = new Date().toISOString();
      const { data: reservedAttempt, error: reserveError } = await admin
        .from("addi_payment_attempts")
        .update({ updated_at: reservationTime })
        .eq("id", previousAttempt.id)
        .eq("store_id", storeId)
        .eq("status", "initiated")
        .lt("updated_at", new Date(Date.now() - 120000).toISOString())
        .select("id")
        .maybeSingle();
      if (reserveError) throw new AddiRequestError("No se pudo reservar el reintento de ADDI.", 500);
      if (!reservedAttempt) {
        throw new AddiRequestError("Ya se está preparando un pago para este pedido. Espera un momento.", 409);
      }
      attemptId = String(reservedAttempt.id);
    } else {
      const { data: attempt, error: attemptError } = await admin
        .from("addi_payment_attempts")
        .insert({
          store_id: storeId,
          order_token: orderToken,
          expected_amount: expectedAmount,
          currency: "COP",
          status: "initiated",
        })
        .select("id")
        .single();
      if (attemptError || !attempt) {
        throw new AddiRequestError("No se pudo registrar el intento de pago ADDI.", 500);
      }
      attemptId = String(attempt.id);
    }
    keepAttemptForRetry = true;

    const accessToken = await requestAddiAccessToken(credentials);
    const address = { lineOne: addressLine, city, country: "CO" };
    const callbackUrl = new URL(`${siteOrigin}/api/payments/addi/callback`);
    callbackUrl.searchParams.set("store_id", storeId);
    callbackUrl.searchParams.set("state", addiCallbackSignature(storeId, attemptId));
    const returnUrl = new URL(`/pedido/${encodeURIComponent(orderToken)}`, siteOrigin);
    returnUrl.searchParams.set("payment", "addi");
    const storeResult = await admin
      .from("stores")
      .select("name,logo_url")
      .eq("id", storeId)
      .maybeSingle();
    if (storeResult.error) throw new AddiRequestError("No se pudo consultar la identidad de la tienda.", 500);

    const application = {
      orderId: attemptId,
      totalAmount: expectedAmount.toFixed(2),
      shippingAmount: "0.00",
      totalTaxesAmount: "0.00",
      currency: "COP",
      items: normalizedItems.map((item: (typeof normalizedItems)[number]) => ({
        sku: item.sku,
        name: item.name,
        quantity: String(item.quantity),
        unitPrice: item.unitPrice,
        tax: 0,
        pictureUrl: secureImageUrl(
          item.pictureUrl,
          secureImageUrl(storeResult.data?.logo_url, `${siteOrigin}/favicon.ico`, siteOrigin),
          siteOrigin,
        ),
        category: "General",
        brand: "No especificada",
      })),
      client: {
        idType,
        idNumber,
        firstName,
        lastName,
        email,
        cellphone,
        cellphoneCountryCode: "+57",
        address,
      },
      shippingAddress: address,
      billingAddress: address,
      pickUpAddress: address,
      allyUrlRedirection: {
        logoUrl: secureImageUrl(storeResult.data?.logo_url, `${siteOrigin}/favicon.ico`, siteOrigin),
        callbackUrl: callbackUrl.toString(),
        redirectionUrl: returnUrl.toString(),
      },
    };

    const apiBase = credentials.environment === "staging"
      ? "https://api.addi-staging.com"
      : "https://api.addi.com";
    let response: Response;
    try {
      response = await fetch(`${apiBase}/v1/online-applications`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(application),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new AddiRequestError("No se pudo conectar con ADDI. Intenta nuevamente.", 502);
    }

    if (response.status !== 301) {
      if (response.status >= 400 && response.status < 500) keepAttemptForRetry = false;
      throw new AddiRequestError(
        response.status === 409
          ? "ADDI indica que este cliente ya tiene crédito activo. Contacta a la tienda para continuar."
          : "ADDI no pudo crear la solicitud de pago. Verifica la información e inténtalo de nuevo.",
        response.status === 400 || response.status === 409 ? 400 : 502,
      );
    }

    const location = response.headers.get("location");
    if (!location) throw new AddiRequestError("ADDI no devolvió la dirección para continuar el pago.", 502);
    const checkoutUrl = allowedAddiRedirect(location);

    const { error: updateError } = await admin
      .from("addi_payment_attempts")
      .update({
        status: "pending",
        redirect_url: checkoutUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attemptId)
      .eq("store_id", storeId)
      .eq("status", "initiated");
    if (updateError) throw new AddiRequestError("No se pudo registrar el enlace de pago de ADDI.", 500);

    return NextResponse.json(
      { ok: true, checkout_url: checkoutUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    if (attemptId && admin && !keepAttemptForRetry) {
      const { error: cleanupError } = await admin
        .from("addi_payment_attempts")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", attemptId)
        .eq("status", "initiated");
      if (cleanupError) {
        console.error("No se pudo cerrar el intento fallido de ADDI.", { attemptId });
      }
    }
    return errorResponse(error);
  }
}
