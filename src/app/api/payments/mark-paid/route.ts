import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Los pagos solo se confirman al recibir un evento verificado de Wompi.",
    },
    { status: 410 },
  );
}
