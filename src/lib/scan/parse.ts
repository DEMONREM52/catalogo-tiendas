/**
 * Qué es lo que se escaneó (código de barras, QR o lo que escribió un lector USB). Probado en tests/scan/parse.test.ts.
 *
 *  · Nunca se cambia el código: se respetan ceros iniciales, mayúsculas y espacios internos (solo se quitan los
 *    saltos de línea o espacios que el lector agrega al principio y al final).
 *  · Un enlace de RemHub se reconoce por su ruta (caja de un pedido, ficha de producto), sin consultar la dirección.
 *  · Un enlace de otro sitio NO se abre: se muestra como texto.
 */
export type ScanResult =
  | { kind: "box"; token: string; raw: string }
  | { kind: "product"; id: string; raw: string }
  | { kind: "transfer"; token: string; raw: string }
  | { kind: "url"; url: string; raw: string }
  | { kind: "code"; code: string; raw: string }
  | { kind: "empty"; raw: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Dominios de RemHub (y sus subdominios por tienda). */
const REMHUB_HOSTS = [/(^|\.)remhub\.co$/i, /(^|\.)remhub\.store$/i, /^localhost$/i, /^127\.0\.0\.1$/];

export function isRemhubHost(host: string, extra: string[] = []): boolean {
  const h = host.toLowerCase();
  return REMHUB_HOSTS.some((r) => r.test(h)) || extra.map((x) => x.toLowerCase()).includes(h);
}

export function parseScan(input: string, opts: { hosts?: string[] } = {}): ScanResult {
  const raw = String(input ?? "");
  // Lo que agrega el lector (Enter, Tab, espacios a los lados). Los espacios del medio se respetan.
  const text = raw.replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, "");
  if (!text) return { kind: "empty", raw };
  if (/^https?:\/\//i.test(text)) {
    let u: URL;
    try { u = new URL(text); } catch { return { kind: "code", code: text, raw }; }
    if (!isRemhubHost(u.hostname, opts.hosts)) return { kind: "url", url: text, raw };
    const caja = u.searchParams.get("caja");
    if (caja && UUID.test(caja)) return { kind: "box", token: caja.toLowerCase(), raw };
    const prod = u.pathname.match(/\/producto\/([0-9a-f-]{36})(?:\/|$)/i);
    if (prod && UUID.test(prod[1])) return { kind: "product", id: prod[1].toLowerCase(), raw };
    const tr = u.pathname.match(/^\/traslado\/([^/?#]{8,})/);
    if (tr) return { kind: "transfer", token: decodeURIComponent(tr[1]), raw };
    return { kind: "url", url: text, raw };
  }
  return { kind: "code", code: text, raw };
}

/** ¿El código coincide exacto con la referencia o el código de barras? Sin tildes ni mayúsculas, pero los ceros cuentan. */
export function sameCode(code: string, ...candidates: Array<string | null | undefined>): boolean {
  const c = code.trim().toUpperCase();
  if (!c) return false;
  return candidates.some((x) => x != null && String(x).trim().toUpperCase() === c);
}
