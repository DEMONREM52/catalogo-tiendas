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
    title: "Preparado",
    who: "Quien prepara",
    declaration: () => "Confirmo que preparé y empaqué la mercancía según la lista.",
  },
  {
    key: "sent",
    icon: "🔍",
    title: "Revisado",
    who: "Quien revisa",
    declaration: () => "Confirmo que revisé la mercancía preparada y está completa.",
  },
  {
    key: "delivered",
    icon: "🚚",
    title: "En camino",
    who: "Quien lleva la mercancía",
    declaration: (to) => `Confirmo que recibí la mercancía revisada y la llevo hasta ${to}.`,
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
