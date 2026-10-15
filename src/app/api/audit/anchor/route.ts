import { createClient } from "@supabase/supabase-js";
import { cronAuthorized, signAnchor, type ChainHead } from "@/lib/audit/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tarea diaria (vercel.json → crons): verifica la cadena de auditoría de la plataforma y de cada tienda,
 * y envía el ancla firmada FUERA de Supabase (correo con Resend y/o un webhook).
 * Variables (solo servidor): CRON_SECRET, AUDIT_ANCHOR_SECRET, y al menos una de
 * RESEND_API_KEY + AUDIT_ANCHOR_EMAIL (+ AUDIT_ANCHOR_FROM) o AUDIT_ANCHOR_WEBHOOK_URL.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ ok: false }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.AUDIT_ANCHOR_SECRET;
  if (!url || !service) return Response.json({ ok: false, error: "Falta configurar Supabase." }, { status: 500 });
  if (!secret || secret.length < 32) return Response.json({ ok: false, error: "Falta AUDIT_ANCHOR_SECRET (mínimo 32 caracteres)." }, { status: 500 });
  const sb = createClient(url, service, { auth: { persistSession: false } });

  // 1. Verificar cada cadena (las últimas 20.000 de cada una). Cada verificación queda guardada en la base.
  const { data: headsData, error: headsError } = await sb.rpc("erp_audit_chain_heads");
  if (headsError) return Response.json({ ok: false, error: "No se pudo leer la cadena. ¿Ya corriste la migración 20261117?" }, { status: 500 });
  const heads = ((headsData ?? []) as Array<{ chain: string; seq: number; hash: string; at: string }>).map((h): ChainHead => ({ chain: h.chain, seq: Number(h.seq), hash: h.hash, at: h.at }));
  const verify: Array<{ chain: string; ok: boolean; checked: number; breaks: number }> = [];
  for (const h of heads) {
    const { data } = await sb.rpc("erp_audit_verify", { p_store: h.chain === "platform" ? null : h.chain, p_limit: 20000 });
    const v = data as { ok: boolean; checked: number; breaks: unknown[] } | null;
    verify.push({ chain: h.chain, ok: Boolean(v?.ok), checked: Number(v?.checked ?? 0), breaks: v?.breaks?.length ?? -1 });
  }

  // 2. Firmar el ancla con la llave que NO está en la base.
  const anchor = signAnchor({ version: 1, created_at: new Date().toISOString(), heads, verify }, secret);
  const failed = verify.filter((v) => !v.ok);

  // 3. Enviarla fuera de Supabase.
  const sent: string[] = [];
  const webhook = process.env.AUDIT_ANCHOR_WEBHOOK_URL;
  if (webhook && /^https:\/\//.test(webhook)) {
    const r = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(anchor), signal: AbortSignal.timeout(10000), redirect: "error" }).catch(() => null);
    if (r?.ok) sent.push("webhook");
  }
  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.AUDIT_ANCHOR_EMAIL;
  if (resendKey && to) {
    const subject = failed.length
      ? `🚨 RemHub · auditoría con ${failed.length} cadena(s) con problemas · ${anchor.created_at.slice(0, 10)}`
      : `🔗 RemHub · ancla de auditoría · ${anchor.created_at.slice(0, 10)} · ${heads.length} cadenas íntegras`;
    const text = [
      "Ancla diaria de la auditoría de RemHub. Guarda este correo: sirve para probar que la historia no se reescribió.",
      failed.length ? `ATENCIÓN: ${failed.map((f) => `${f.chain} (${f.breaks} problema/s)`).join(", ")}` : "Todas las cadenas verificadas sin problemas.",
      "",
      "Ancla firmada (JSON):",
      JSON.stringify(anchor, null, 2),
    ].join("\n");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.AUDIT_ANCHOR_FROM ?? "RemHub Auditoría <auditoria@remhub.store>", to: to.split(",").map((x) => x.trim()).filter(Boolean), subject, text }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (r?.ok) sent.push("email");
  }

  return Response.json({ ok: failed.length === 0, chains: heads.length, failed: failed.length, sent, external: sent.length > 0 },
    { headers: { "Cache-Control": "private, no-store" } });
}
