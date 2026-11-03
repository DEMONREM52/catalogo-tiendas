import { NextResponse } from "next/server";
import { BUILD_RELEASE, RELEASES } from "@/lib/pwa/changelog";

export const dynamic = "force-dynamic";

/** La versión publicada y sus novedades (la app la compara con la que tiene la pestaña). No lleva datos privados. */
export function GET() {
  return NextResponse.json(
    { release: BUILD_RELEASE, releases: RELEASES.slice(-40) },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
