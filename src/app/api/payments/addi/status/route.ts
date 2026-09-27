import { NextResponse } from "next/server";
import { AddiRequestError, createAddiAdminClient } from "@/lib/payments/addi-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token")?.trim();
    if (!token || token.length > 128) {
      throw new AddiRequestError("Referencia del pedido no válida.", 400);
    }

    const admin = createAddiAdminClient();
    const { data: approved, error: approvedError } = await admin
      .from("addi_payment_attempts")
      .select("status")
      .eq("order_token", token)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    if (approvedError) throw new AddiRequestError("No se pudo consultar el estado del pago ADDI.", 500);
    if (approved) {
      return NextResponse.json(
        { ok: true, payment_status: "paid", payment_method_type: "Addi" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data, error } = await admin
      .from("addi_payment_attempts")
      .select("status,updated_at")
      .eq("order_token", token)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new AddiRequestError("No se pudo consultar el estado del pago ADDI.", 500);

    const attemptIsStale =
      data?.status === "initiated" &&
      Date.now() - new Date(data.updated_at).getTime() >= 120000;
    const paymentStatus =
      data?.status === "approved"
        ? "paid"
        : data?.status === "pending" || (data?.status === "initiated" && !attemptIsStale)
          ? "pending"
          : attemptIsStale || (data && ["rejected", "declined", "abandoned", "failed"].includes(data.status))
            ? "failed"
            : "unpaid";

    return NextResponse.json(
      { ok: true, payment_status: paymentStatus, payment_method_type: paymentStatus === "paid" ? "Addi" : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    const status = error instanceof AddiRequestError ? error.status : 500;
    if (status >= 500) console.error("No se pudo consultar el estado del pago ADDI.");
    return NextResponse.json(
      { ok: false, error: error instanceof AddiRequestError ? error.message : "No se pudo consultar el pago ADDI." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
