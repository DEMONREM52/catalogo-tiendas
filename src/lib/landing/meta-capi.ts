// API de Conversiones de Meta (servidor → Meta). Complementa el píxel del navegador:
// el pedido llega a Meta aunque el cliente tenga bloqueador o el iPhone limite el rastreo.
// Mismo event_id que el píxel: Meta junta los dos y no lo cuenta doble.
// Los datos del cliente viajan con SHA-256 (Meta nunca recibe el teléfono en claro).
import { createHash } from "node:crypto";

export const META_GRAPH_VERSION = "v23.0";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const clean = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function hashPhone(raw: string) {
  const digits = raw.replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
  return /^3\d{9}$/.test(digits) ? sha(`57${digits}`) : null;
}

export type CapiCustomer = { name?: string; whatsapp?: string; email?: string; city?: string; department?: string; document?: string };
export type CapiContext = { ip: string | null; userAgent: string | null; fbp?: string | null; fbc?: string | null; url: string };
export type CapiItem = { id: string; quantity: number; price: number };

export function buildUserData(customer: CapiCustomer, ctx: CapiContext) {
  const [first, ...rest] = (customer.name ?? "").trim().split(/\s+/);
  const out: Record<string, unknown> = { country: [sha("co")] };
  const ph = customer.whatsapp ? hashPhone(customer.whatsapp) : null;
  if (ph) out.ph = [ph];
  const email = customer.email?.trim().toLowerCase();
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) out.em = [sha(email)];
  if (first) out.fn = [sha(clean(first))];
  if (rest.length) out.ln = [sha(clean(rest[rest.length - 1]))];
  if (customer.city) out.ct = [sha(clean(customer.city))];
  if (customer.department) out.st = [sha(clean(customer.department))];
  if (customer.document) out.external_id = [sha(customer.document.replace(/\D/g, ""))];
  if (ctx.ip) out.client_ip_address = ctx.ip;
  if (ctx.userAgent) out.client_user_agent = ctx.userAgent;
  if (ctx.fbp && /^fb\.\d\.\d+\.\d+$/.test(ctx.fbp)) out.fbp = ctx.fbp;
  if (ctx.fbc && /^fb\.\d\.\d+\./.test(ctx.fbc)) out.fbc = ctx.fbc;
  return out;
}

export function buildOrderEvent(input: { eventName: "Purchase" | "Lead"; eventId: string; orderId: string; items: CapiItem[]; total: number; customer: CapiCustomer; ctx: CapiContext }) {
  return {
    event_name: input.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: "website",
    event_source_url: input.ctx.url,
    user_data: buildUserData(input.customer, input.ctx),
    custom_data: {
      currency: "COP",
      value: Math.round(input.total),
      order_id: input.orderId,
      content_type: "product",
      content_ids: input.items.map((i) => i.id),
      contents: input.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
      num_items: input.items.reduce((s, i) => s + i.quantity, 0),
    },
  };
}

export async function sendCapi(pixelId: string, token: string, events: unknown[], testCode?: string | null) {
  if (!/^\d{6,20}$/.test(pixelId)) throw new Error("ID del píxel no válido.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: events, ...(testCode ? { test_event_code: testCode } : {}) }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as { events_received?: number; error?: { message?: string } } | null;
    if (!res.ok || json?.error) throw new Error(json?.error?.message ?? `Meta respondió ${res.status}.`);
    return { received: json?.events_received ?? 0 };
  } finally {
    clearTimeout(timer);
  }
}
