// Avisos por WhatsApp (solo servidor). Dos formas:
//   · remhub   · WhatsApp Business oficial de Meta (Cloud API) con el número de RemHub. Mensajes con una
//                plantilla aprobada por Meta. Variables de Vercel:
//                  WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
//                  WHATSAPP_TEMPLATE_CONTINGENCY (por defecto «remhub_contingencia»), WHATSAPP_TEMPLATE_LANG («es»)
//                  WHATSAPP_GRAPH_VERSION (por defecto «v25.0»)
//   · callmebot · Gratis, para avisos personales: cada dueño activa su número con el bot y pega su clave.
// Nunca se guarda el token en la base ni llega al navegador.

export type WaProvider = "remhub" | "callmebot";
export type WaResult = { ok: boolean; error?: string };

/** Variables de la plantilla de contingencia (en este orden): tienda, cantidad, horas, vence. */
export type ContingencyVars = { store: string; count: string; hours: string; deadline: string };

export function remhubWhatsAppReady() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function withTimeout(url: string, init: RequestInit, ms = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** WhatsApp oficial (Meta): plantilla con variables en el cuerpo. */
async function sendMeta(to: string, vars: ContingencyVars): Promise<WaResult> {
  if (!remhubWhatsAppReady()) return { ok: false, error: "El WhatsApp de RemHub no está configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)." };
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
  try {
    const res = await withTimeout(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE_CONTINGENCY || "remhub_contingencia",
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "es" },
          components: [{ type: "body", parameters: [vars.store, vars.count, vars.hours, vars.deadline].map((text) => ({ type: "text", text: text.slice(0, 120) })) }],
        },
      }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, error: `Meta respondió ${res.status}: ${body?.error?.message ?? "error"}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** CallMeBot (gratis): texto libre al número que activó su clave con el bot. */
async function sendCallMeBot(to: string, apikey: string, text: string): Promise<WaResult> {
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=%2B${encodeURIComponent(to)}&text=${encodeURIComponent(text.slice(0, 900))}&apikey=${encodeURIComponent(apikey)}`;
    const res = await withTimeout(url, { method: "GET" });
    const body = (await res.text().catch(() => "")).slice(0, 400);
    // CallMeBot responde con una página: «Message queued…» cuando sale; «APIKey is invalid…» o similar cuando no.
    if (res.ok && (/queued|sent|success/i.test(body) || !/invalid|error|not\s+allowed/i.test(body))) return { ok: true };
    return { ok: false, error: `CallMeBot: ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || res.status}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Texto del aviso (CallMeBot y registro). Con Meta va en la plantilla aprobada. */
export function contingencyText(v: ContingencyVars, link: string) {
  return `⚠️ RemHub · ${v.store}: ${v.count} factura(s) de contingencia sin aceptar por la DIAN. ${v.hours} (vence ${v.deadline}). Revísalas: ${link}`;
}

export async function sendContingencyWhatsApp(provider: WaProvider, to: string, vars: ContingencyVars, link: string, apikey?: string | null): Promise<WaResult> {
  if (provider === "callmebot") {
    if (!apikey) return { ok: false, error: "Falta la clave de CallMeBot de ese número." };
    return sendCallMeBot(to, apikey, contingencyText(vars, link));
  }
  return sendMeta(to, vars);
}

/**
 * Aviso de texto libre al equipo (cuentas por pagar, cierre del día).
 * CallMeBot manda el texto tal cual; con el WhatsApp oficial va en la plantilla WHATSAPP_TEMPLATE_NOTICE
 * (cuerpo sugerido: «Aviso de RemHub para {{1}}: {{2}}»).
 */
export async function sendNoticeWhatsApp(provider: WaProvider, to: string, store: string, text: string, apikey?: string | null): Promise<WaResult> {
  if (provider === "callmebot") {
    if (!apikey) return { ok: false, error: "Falta la clave de CallMeBot de ese número." };
    return sendCallMeBot(to, apikey, text);
  }
  const template = process.env.WHATSAPP_TEMPLATE_NOTICE;
  if (!remhubWhatsAppReady() || !template) return { ok: false, error: "El WhatsApp oficial de RemHub aún no tiene la plantilla de avisos (WHATSAPP_TEMPLATE_NOTICE)." };
  try {
    const res = await withTimeout(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v25.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "es" },
          components: [{ type: "body", parameters: [store.slice(0, 120), text.replace(/\s+/g, " ").slice(0, 900)].map((t) => ({ type: "text", text: t })) }] },
      }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, error: `Meta respondió ${res.status}: ${body?.error?.message ?? "error"}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
