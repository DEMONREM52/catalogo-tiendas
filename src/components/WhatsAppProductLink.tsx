"use client";

import { MessageCircle } from "lucide-react";

type Props = {
  phone: string;
  productText: string;
};

export function WhatsAppProductLink({ phone, productText }: Props) {
  function openWhatsApp() {
    const message = `Hola, quiero más información sobre este producto:\n\n${productText}`;
    const number = phone.replace(/\D/g, "");
    window.open(
      `https://wa.me/${number}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <button
      type="button"
      onClick={openWhatsApp}
      className="product-whatsapp-button inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition hover:-translate-y-0.5"
    >
      <MessageCircle size={16} />
      Consultar por WhatsApp
    </button>
  );
}
