"use client";

import { Share2 } from "lucide-react";
import Swal from "sweetalert2";

export function ShareProductButton({
  title,
  text,
  compact = false,
  iconOnly = false,
}: {
  title: string;
  text: string;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      await Swal.fire({
        toast: true,
        position: "top",
        icon: "success",
        title: "Información copiada",
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await Swal.fire({
        icon: "error",
        title: "No se pudo compartir",
        text: error instanceof Error ? error.message : "Vuelve a intentarlo.",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      className={`product-share-button inline-flex items-center justify-center gap-2 font-bold transition hover:-translate-y-0.5 ${
        compact ? "product-row-action" : "rounded-2xl px-5 py-3 text-sm"
      }`}
      aria-label={`Compartir ${title}`}
      title={`Compartir ${title}`}
    >
      <Share2 size={16} />
      {iconOnly ? null : "Compartir"}
    </button>
  );
}
