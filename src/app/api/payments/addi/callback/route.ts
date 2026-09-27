import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AddiRequestError,
  addiCallbackSignature,
  createAddiAdminClient,
} from "@/lib/payments/addi-server";

export const runtime = "nodejs";

function isValidSignature(received: string | null, expected: string): boolean {
  if (!received || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const receivedBytes = Buffer.from(received, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function toCents(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function errorResponse(error: unknown) {
  const status = error instanceof AddiRequestError ? error.status : 500;
  if (status >= 500) console.error("No se pudo procesar el callback de ADDI.");
  return NextResponse.json(
    { ok: false, error: error instanceof AddiRequestError ? error.message : "No se pudo procesar la respuesta de ADDI." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const storeId = url.searchParams.get("store_id") ?? "";
    const state = url.searchParams.get("state");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AddiRequestError("El callback de ADDI no contiene un JSON válido.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AddiRequestError("La respuesta de ADDI no tiene un formato válido.", 400);
    }

    const event = body as Record<string, unknown>;
    const attemptId = typeof event.orderId === "string" ? event.orderId : "";
    const status = typeof event.status === "string" ? event.status.toUpperCase() : "";
    const applicationId = typeof event.applicationId === "string" ? event.applicationId.trim() : "";
    const timestamp = Number(event.statusTimestamp);

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)
    ) {
      throw new AddiRequestError("La referencia del pago ADDI no es válida.", 400);
    }
    if (!["APPROVED", "REJECTED", "DECLINED", "ABANDONED"].includes(status)) {
      throw new AddiRequestError("ADDI envió un estado de pago desconocido.", 400);
    }
    if (!applicationId || applicationId.length > 200) {
      throw new AddiRequestError("La referencia de aplicación enviada por ADDI no es válida.", 400);
    }
    if (typeof event.currency !== "string" || event.currency.toUpperCase() !== "COP") {
      throw new AddiRequestError("La moneda del callback de ADDI no coincide con COP.", 400);
    }
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new AddiRequestError("La fecha de respuesta de ADDI no es válida.", 400);
    }

    const expectedSignature = addiCallbackSignature(storeId, attemptId);
    if (!isValidSignature(state, expectedSignature)) {
      throw new AddiRequestError("La firma del callback de ADDI no es válida.", 401);
    }

    const admin = createAddiAdminClient();
    const { data: attempt, error: attemptError } = await admin
      .from("addi_payment_attempts")
      .select("id,status,expected_amount,currency,status_timestamp")
      .eq("id", attemptId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (attemptError) throw new AddiRequestError("No se pudo consultar el intento de pago de ADDI.", 500);
    if (!attempt) throw new AddiRequestError("No se encontró el intento de pago de ADDI.", 404);

    if (attempt.status === "approved" || (attempt.status_timestamp && timestamp <= attempt.status_timestamp)) {
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const approvedAmountCents = toCents(event.approvedAmount);
    const expectedAmountCents = toCents(attempt.expected_amount);
    if (approvedAmountCents === null || expectedAmountCents === null) {
      throw new AddiRequestError("El valor reportado por ADDI no es válido.", 400);
    }
    if (status === "APPROVED" && approvedAmountCents !== expectedAmountCents) {
      console.error("ADDI reportó un monto aprobado distinto al valor esperado.", { attemptId, storeId });
      throw new AddiRequestError("El valor aprobado por ADDI no coincide con el total del pedido.", 409);
    }

    const { data: processed, error: processError } = await admin.rpc("process_addi_callback", {
      p_store_id: storeId,
      p_attempt_id: attemptId,
      p_application_id: applicationId,
      p_status: status.toLowerCase(),
      p_approved_amount: approvedAmountCents / 100,
      p_currency: "COP",
      p_status_timestamp: timestamp,
    });
    if (processError) {
      const message = processError.message.toUpperCase();
      if (message.includes("ADDI_AMOUNT_MISMATCH")) {
        throw new AddiRequestError("El valor aprobado por ADDI no coincide con el total del pedido.", 409);
      }
      throw new AddiRequestError("No se pudo actualizar el estado del pago ADDI.", 500);
    }
    if (processed !== true) throw new AddiRequestError("No se encontró el intento de pago de ADDI.", 404);

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
