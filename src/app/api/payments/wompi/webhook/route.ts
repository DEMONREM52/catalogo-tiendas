import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let event: unknown;

  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON de evento no válido." }, { status: 400 });
  }

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return NextResponse.json({ ok: false, error: "Evento de Wompi no válido." }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseServer().rpc("process_wompi_event", {
      p_event: event,
    });

    if (error) {
      console.error("No se pudo procesar el evento de Wompi:", error.message);
      return NextResponse.json({ ok: false, error: "No se pudo validar el evento." }, { status: 500 });
    }

    if (data !== true) {
      return NextResponse.json({ ok: false, error: "Firma o transacción no válida." }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error inesperado al procesar evento de Wompi:", error);
    return NextResponse.json({ ok: false, error: "Error al procesar el evento de Wompi." }, { status: 500 });
  }
}
