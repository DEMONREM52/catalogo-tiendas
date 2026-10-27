// Pasarela de Bold en el navegador: carga su librería oficial y abre el pago con la configuración
// que firmó el servidor (la llave secreta nunca llega aquí).
export type BoldCheckoutClient = {
  reference: string; orderId: string; currency: string; amount: string; apiKey: string; integritySignature: string;
  description: string; redirectionUrl: string; renderMode?: string; customerData?: string; test?: boolean;
};

type BoldWindow = Window & { BoldCheckout?: new (cfg: Record<string, string>) => { open: () => void } };
const SRC = "https://checkout.bold.co/library/boldPaymentButton.js";
let loading: Promise<void> | null = null;

export function loadBold(): Promise<void> {
  const w = window as BoldWindow;
  if (w.BoldCheckout) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const done = () => (w.BoldCheckout ? resolve() : reject(new Error("No cargó Bold.")));
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.onload = () => window.setTimeout(done, 50);
    script.onerror = () => { loading = null; reject(new Error("No se pudo cargar Bold. Revisa tu conexión.")); };
    document.head.appendChild(script);
  });
  return loading;
}

/** Abre la pasarela de Bold encima de la página. Al terminar, Bold vuelve a redirectionUrl con ?bold-order-id. */
export async function openBold(cfg: BoldCheckoutClient) {
  await loadBold();
  const Ctor = (window as BoldWindow).BoldCheckout;
  if (!Ctor) throw new Error("No cargó Bold.");
  const options: Record<string, string> = {
    orderId: cfg.orderId, currency: cfg.currency, amount: cfg.amount, apiKey: cfg.apiKey,
    integritySignature: cfg.integritySignature, description: cfg.description, redirectionUrl: cfg.redirectionUrl,
    renderMode: cfg.renderMode ?? "embedded",
  };
  if (cfg.customerData) options.customerData = cfg.customerData;
  new Ctor(options).open();
}

/** Referencia del pago con la que Bold devolvió al cliente (o null). */
export function boldReturn(): { reference: string; status: string } | null {
  const q = new URLSearchParams(window.location.search);
  const reference = q.get("bold-order-id") ?? "";
  return /^[A-Za-z0-9_-]{6,60}$/.test(reference) ? { reference, status: (q.get("bold-tx-status") ?? "").toLowerCase() } : null;
}

export type BoldStatus = { status: string; amount?: number; method?: string | null; mode?: string };

/** Espera el resultado real del pago (el aviso de Bold o la consulta), hasta ~1 minuto. */
export async function waitBold(reference: string, onTick?: (s: BoldStatus) => void): Promise<BoldStatus> {
  let last: BoldStatus = { status: "pending" };
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`/api/payments/bold/status?ref=${encodeURIComponent(reference)}`, { cache: "no-store" });
      const j = (await res.json()) as BoldStatus & { ok?: boolean };
      if (j.ok && j.status) {
        last = j;
        onTick?.(j);
        if (!["created", "pending"].includes(j.status)) return j;
      }
    } catch { /* se reintenta */ }
    await new Promise((r) => window.setTimeout(r, i < 5 ? 2500 : 4000));
  }
  return last;
}

export const BOLD_LABEL: Record<string, string> = {
  approved: "✅ Pago aprobado", rejected: "❌ Pago rechazado", failed: "⚠️ El pago falló", voided: "↩️ Pago anulado",
  pending: "⏳ Pago en proceso", created: "⏳ Esperando el pago", mismatch: "⚠️ Pago por revisar",
};
