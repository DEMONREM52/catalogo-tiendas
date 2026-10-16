import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dnsRecordsFor } from "@/lib/share/store-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dominio propio de una tienda: lo agrega, lo verifica y lo quita en Vercel (el proyecto de RemHub).
 * Los permisos los valida la base (las funciones se llaman CON la sesión del usuario: «Mi tienda»).
 * Variables (solo servidor): VERCEL_API_TOKEN, VERCEL_PROJECT_ID y, si el proyecto es de un equipo, VERCEL_TEAM_ID.
 * Sin ellas, el dominio queda registrado y se muestran los pasos para conectarlo a mano.
 */

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userClient(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}
function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

function vercel() {
  const token = process.env.VERCEL_API_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return null;
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`https://api.vercel.com${path}${team}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
  };
  return { project, call };
}

async function checkAndSave(domain: string) {
  const v = vercel();
  const admin = serviceClient();
  if (!v || !admin) return { status: "pending" as const, detail: "manual", dns: dnsRecordsFor(domain, null) };
  const info = await v.call("GET", `/v9/projects/${v.project}/domains/${domain}`);
  if (!info.ok) {
    await admin.rpc("store_domain_set_status", { p_domain: domain, p_status: "error", p_detail: "Vercel no tiene este dominio", p_dns: null });
    return { status: "error" as const, detail: "Vercel no tiene este dominio", dns: dnsRecordsFor(domain, null) };
  }
  if (!info.data.verified) await v.call("POST", `/v9/projects/${v.project}/domains/${domain}/verify`);
  const config = await v.call("GET", `/v6/domains/${domain}/config`);
  const verified = Boolean(info.data.verified);
  const misconfigured = Boolean(config.data.misconfigured);
  const status = verified && !misconfigured ? "active" : "pending";
  const detail = status === "active" ? "Conectado ✅" : !verified ? "Falta el registro de verificación (TXT)" : "Falta apuntar el DNS a RemHub";
  const dns = dnsRecordsFor(domain, info.data.verification);
  await admin.rpc("store_domain_set_status", { p_domain: domain, p_status: status, p_detail: detail, p_dns: dns });
  return { status, detail, dns };
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const body = (await request.json().catch(() => null)) as { store_id?: string; action?: string; domain?: string; target?: string } | null;
  const storeId = String(body?.store_id ?? "");
  const domain = String(body?.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "");
  const action = String(body?.action ?? "");
  if (!token || !UUID.test(storeId) || !["add", "check", "remove", "primary"].includes(action) || !DOMAIN.test(domain)) {
    return NextResponse.json({ ok: false, error: "Datos incompletos." }, { status: 400 });
  }
  const sb = userClient(token);
  if (!sb) return NextResponse.json({ ok: false, error: "Falta configurar Supabase." }, { status: 500 });

  // El usuario debe poder administrar la tienda y (salvo al agregar) el dominio debe ser suyo.
  const list = await sb.rpc("store_domain_list", { p_store: storeId });
  const listed = list.data as { ok?: boolean; domains?: Array<{ domain: string }> } | null;
  if (list.error || !listed?.ok) return NextResponse.json({ ok: false, error: "Necesitas el permiso «Mi tienda»." }, { status: 403 });
  if (action !== "add" && !listed.domains?.some((d) => d.domain === domain)) {
    return NextResponse.json({ ok: false, error: "Ese dominio no está en tu tienda." }, { status: 404 });
  }

  const v = vercel();
  if (action === "add") {
    const { error } = await sb.rpc("store_domain_add", { p_store: storeId, p_domain: domain, p_target: body?.target || "detal" });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (v) {
      const added = await v.call("POST", `/v10/projects/${v.project}/domains`, { name: domain });
      // 409 = ya estaba en el proyecto (se sigue con la verificación).
      if (!added.ok && added.status !== 409) {
        const msg = String((added.data.error as { message?: string } | undefined)?.message ?? "Vercel no aceptó el dominio");
        await serviceClient()?.rpc("store_domain_set_status", { p_domain: domain, p_status: "error", p_detail: msg.slice(0, 280), p_dns: null });
        return NextResponse.json({ ok: false, error: `Vercel: ${msg}` }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true, automatic: Boolean(v), ...(await checkAndSave(domain)) });
  }
  if (action === "check") return NextResponse.json({ ok: true, automatic: Boolean(v), ...(await checkAndSave(domain)) });
  if (action === "primary") {
    const { error } = await sb.rpc("store_domain_set_primary", { p_store: storeId, p_domain: domain });
    return error ? NextResponse.json({ ok: false, error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  // remove
  const { error } = await sb.rpc("store_domain_remove", { p_store: storeId, p_domain: domain });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  if (v) await v.call("DELETE", `/v9/projects/${v.project}/domains/${domain}`);
  return NextResponse.json({ ok: true });
}
