/**
 * Freno de peticiones por IP para las rutas públicas (pedidos de landing, cobros, contexto de acceso).
 * Ventana deslizante en memoria: cada instancia del servidor lleva su cuenta, así que es un freno contra
 * ráfagas y robots, no un límite exacto global. Lo importante (precios, existencias, firmas) lo valida la base.
 */
type Hit = { count: number; reset: number };

const buckets = new Map<string, Hit>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return ((forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip")) ?? "").trim() || "sin-ip";
}

/** true si todavía puede; false si pasó el límite (responder 429). */
export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfter: number } {
  sweep(now);
  const hit = buckets.get(key);
  if (!hit || hit.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  hit.count += 1;
  if (hit.count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((hit.reset - now) / 1000)) };
  return { ok: true, retryAfter: 0 };
}

/** Respuesta 429 lista (en español) o null si puede seguir. */
export function rateLimited(request: Request, scope: string, limit: number, windowMs: number): Response | null {
  const r = allowRequest(`${scope}:${clientIp(request)}`, limit, windowMs);
  if (r.ok) return null;
  return Response.json(
    { ok: false, code: "RATE_LIMITED", error: "Demasiados intentos seguidos. Espera un momento e intenta de nuevo." },
    { status: 429, headers: { "Retry-After": String(r.retryAfter) } },
  );
}
