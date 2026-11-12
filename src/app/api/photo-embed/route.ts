import { rateLimited } from "@/lib/server/rate-limit";
import { embedPhoto } from "@/lib/server/photo-embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 400 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Búsqueda por foto en «modo liviano»: el celular manda una foto pequeña (256×256, ~15 KB) y recibe su huella.
 * La usan los celulares que no pueden con el modelo (o que todavía no lo han descargado). No guarda la foto ni
 * nada de la tienda: solo devuelve 512 números. Abierta también para el catálogo público, con freno por IP.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "photo-embed", 60, 60_000);
  if (limited) return limited;

  const type = request.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)\b/i.test(type)) {
    return Response.json({ ok: false, error: "Envía una imagen JPEG, PNG o WebP." }, { status: 415, headers: NO_STORE });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return Response.json({ ok: false, error: "La foto es muy grande." }, { status: 413, headers: NO_STORE });

  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length || body.length > MAX_BYTES) {
    return Response.json({ ok: false, error: body.length ? "La foto es muy grande." : "Falta la foto." }, { status: body.length ? 413 : 400, headers: NO_STORE });
  }

  try {
    const embedding = await embedPhoto(body);
    return Response.json({ ok: true, embedding }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const bad = /unsupported image|Input buffer|corrupt|VipsJpeg|pngload|webpload/i.test(message);
    if (!bad) console.error("photo-embed:", message);
    return Response.json(
      { ok: false, error: bad ? "No se pudo leer la foto." : "No se pudo analizar la foto en este momento." },
      { status: bad ? 400 : 503, headers: NO_STORE },
    );
  }
}
