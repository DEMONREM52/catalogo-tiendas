import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ancla externa de la auditoría: el último eslabón (número y hash) de cada cadena, firmado con una
 * llave que vive FUERA de la base (AUDIT_ANCHOR_SECRET en el hosting) y enviado fuera de Supabase.
 * Si después alguien reescribe la cadena o borra los últimos eventos, ya no coincide con el ancla.
 */
export type ChainHead = { chain: string; seq: number; hash: string; at: string };
export type Anchor = { version: 1; created_at: string; heads: ChainHead[]; verify: Array<{ chain: string; ok: boolean; checked: number; breaks: number }>; signature: string };

/** Texto canónico (orden fijo) que se firma. */
export function anchorPayload(a: Omit<Anchor, "signature">) {
  const heads = [...a.heads].sort((x, y) => x.chain.localeCompare(y.chain)).map((h) => `${h.chain}:${h.seq}:${h.hash}`);
  const verify = [...a.verify].sort((x, y) => x.chain.localeCompare(y.chain)).map((v) => `${v.chain}:${v.ok ? 1 : 0}:${v.checked}:${v.breaks}`);
  return [`v${a.version}`, a.created_at, ...heads, "--", ...verify].join("\n");
}

export function signAnchor(a: Omit<Anchor, "signature">, secret: string): Anchor {
  return { ...a, signature: createHmac("sha256", secret).update(anchorPayload(a)).digest("hex") };
}

/** Para comprobar un ancla guardada (por ejemplo, la de un correo) contra la llave. */
export function verifyAnchorSignature(a: Anchor, secret: string) {
  const expected = Buffer.from(createHmac("sha256", secret).update(anchorPayload(a)).digest("hex"));
  const given = Buffer.from(a.signature ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Compara dos anclas: una cadena cuyo número bajó o cuyo hash cambió para el mismo número fue reescrita. */
export function compareAnchors(prev: Anchor, now: Anchor) {
  const problems: string[] = [];
  const cur = new Map(now.heads.map((h) => [h.chain, h]));
  for (const p of prev.heads) {
    const n = cur.get(p.chain);
    if (!n) problems.push(`${p.chain}: la cadena desapareció`);
    else if (n.seq < p.seq) problems.push(`${p.chain}: tenía ${p.seq} eventos y ahora ${n.seq} (se borraron)`);
    else if (n.seq === p.seq && n.hash !== p.hash) problems.push(`${p.chain}: mismo número de eventos con otro hash (reescrita)`);
  }
  return problems;
}

/** Solo el programador de tareas (Vercel Cron envía «Authorization: Bearer CRON_SECRET»). */
export function cronAuthorized(request: Request, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}
