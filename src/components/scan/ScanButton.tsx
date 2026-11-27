"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ScanBarcode } from "lucide-react";
import Swal from "@/lib/swal";
import { parseScan } from "@/lib/scan/parse";

// La cámara y jsQR se cargan solo al abrir el lector.
const CameraScanner = dynamic(() => import("./CameraScanner").then((m) => m.CameraScanner), { ssr: false });

/**
 * Icono de escáner (lector de códigos con la cámara), aparte del de foto. Lo leído se ESCRIBE en el buscador
 * (`onCode`): no elige nada solo. Un QR de caja de RemHub ofrece abrir su pedido; un enlace de otro sitio no se abre.
 */
export function ScanButton({ onCode, className = "", style, title = "Escanear código con la cámara", label }: {
  onCode: (code: string) => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  async function handle(raw: string) {
    setOpen(false);
    const r = parseScan(raw, { hosts: [window.location.hostname] });
    if (r.kind === "empty") return;
    if (r.kind === "box") {
      const ok = await Swal.fire({ icon: "info", title: "📦 Es el QR de una caja", text: "¿Abrir su pedido interno?", showCancelButton: true, confirmButtonText: "Abrir", cancelButtonText: "No", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" });
      // Carga completa a propósito: la bandeja lee ?caja= al abrir (también si ya estabas en Pedidos).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (ok.isConfirmed) window.location.assign(`/dashboard/pedidos?tab=internos&caja=${r.token}`);
      return;
    }
    if (r.kind === "url") {
      void Swal.fire({ icon: "warning", title: "Es un enlace de otro sitio", text: `No lo abrimos aquí por seguridad: ${r.url.slice(0, 160)}`, background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    if (r.kind === "product") {
      // QR de la ficha de un producto (Label Studio): se busca por su referencia o, si no tiene, por su nombre.
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const { data } = await supabaseBrowser().from("products").select("sku,name").eq("id", r.id).maybeSingle();
      const p = data as { sku: string | null; name: string } | null;
      if (!p) return void Swal.fire({ icon: "info", title: "Ese producto no es de esta tienda", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return onCode(p.sku || p.name);
    }
    if (r.kind === "transfer") return void window.open(`/traslado/${encodeURIComponent(r.token)}`, "_blank", "noopener");
    onCode(r.code);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={title} aria-label={title}
        className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border px-2.5 ${className}`}
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)", ...style }}>
        <ScanBarcode size={18} />{label ? <span className="text-xs font-bold">{label}</span> : null}
      </button>
      {open ? <CameraScanner title="Escanear código" onClose={() => setOpen(false)} onCode={(c) => void handle(c)} hint="Lo que leas se escribe en el buscador; luego eliges el producto." /> : null}
    </>
  );
}
