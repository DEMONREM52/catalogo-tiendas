// Pasos del seguimiento de traslados (ver supabase/migrations/20261007_transfer_tracking_links.sql).

export type TransferStep = "packed" | "sent" | "delivered" | "received";

export const TRANSFER_STEPS: Array<{
  key: TransferStep;
  icon: string;
  title: string;
  who: string;
  declaration: (to: string) => string;
}> = [
  {
    key: "packed",
    icon: "📦",
    title: "Empacado",
    who: "Quien empaca",
    declaration: () => "Confirmo que alisté y empaqué la mercancía completa según la lista.",
  },
  {
    key: "sent",
    icon: "🚚",
    title: "Enviado",
    who: "Quien despacha",
    declaration: (to) => `Confirmo que despaché la mercancía empacada con destino a ${to}.`,
  },
  {
    key: "delivered",
    icon: "🤝",
    title: "Entregado",
    who: "Quien entrega",
    declaration: (to) => `Confirmo que transporté y entregué la mercancía en ${to}.`,
  },
  {
    key: "received",
    icon: "✅",
    title: "Recibido",
    who: "Quien recibe",
    declaration: () => "Confirmo que conté la mercancía y las cantidades recibidas son las indicadas.",
  },
];

export const transferTrackUrl = (token: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/traslado/${token}`;

export function transferWhatsAppText(number: number, from: string, to: string, token: string) {
  return [
    `🚚 Traslado #${number}: ${from} → ${to}`,
    "Abre este enlace para firmar tu paso (empaca, envía, entrega o recibe). No necesitas iniciar sesión:",
    transferTrackUrl(token),
  ].join("\n");
}
