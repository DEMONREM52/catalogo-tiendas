"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { clearPracticeDrafts, getDrafts, restoreDrafts, subscribeDrafts } from "@/lib/pos/drafts";
import { syncOfflineDrafts } from "@/lib/pos/sync";
import { useNetStatus } from "@/lib/net/status";
import { askPersistentStorage } from "@/lib/offline/device";

/**
 * Envía solas las ventas hechas sin conexión, desde cualquier pantalla del panel (no solo el POS),
 * apenas vuelven el internet y la base. Muestra en la barra cuántas faltan por enviar o revisar.
 */
export function OfflineSync({ storeId }: { storeId: string }) {
  const all = useSyncExternalStore(subscribeDrafts, () => getDrafts(storeId), () => getDrafts(null));
  // Las ventas de la práctica «sin internet» no cuentan ni se envían.
  const drafts = all.filter((d) => !d.practice);
  const net = useNetStatus();
  const reach = net.online && net.db !== "down";
  const pending = drafts.filter((d) => !d.review).length;
  const review = drafts.length - pending;
  const [sending, setSending] = useState(false);

  // Al terminar la práctica «sin internet» (desde el aviso o el POS) se borran sus ventas.
  const wasPractice = useRef(net.simulated);
  useEffect(() => {
    if (wasPractice.current && !net.simulated) void clearPracticeDrafts(storeId);
    wasPractice.current = net.simulated;
  }, [net.simulated, storeId]);

  useEffect(() => {
    void restoreDrafts(storeId);
    // Que el navegador no borre las ventas guardadas cuando le falte espacio.
    void askPersistentStorage();
  }, [storeId]);

  useEffect(() => {
    if (!reach || pending === 0) return;
    let alive = true;
    const t = window.setTimeout(() => {
      setSending(true);
      void syncOfflineDrafts(storeId)
        .then((res) => {
          if (!alive || (!res.sent.length && !res.review)) return;
          const docs = res.sent.map((s) => s.doc).filter(Boolean);
          const warnings = res.sent.flatMap((s) => s.warnings);
          const esc = (v: string) => v.replace(/[<>&]/g, "");
          void Swal.fire({
            toast: true,
            position: "top-end",
            timer: warnings.length || res.review ? 12000 : 6000,
            timerProgressBar: true,
            showConfirmButton: false,
            icon: res.review || warnings.length ? "warning" : "success",
            title: res.sent.length
              ? `${res.sent.length} venta${res.sent.length === 1 ? "" : "s"} sin conexión registrada${res.sent.length === 1 ? "" : "s"}`
              : "Ventas sin conexión por revisar",
            html: [
              docs.length ? `<b>${esc(docs.slice(0, 6).join(", "))}${docs.length > 6 ? "…" : ""}</b>` : "",
              ...warnings.slice(0, 3).map((w) => `⚠️ ${esc(w)}`),
              res.review ? `${res.review} necesita${res.review === 1 ? "" : "n"} revisión en el POS.` : "",
            ].filter(Boolean).join("<br/>"),
            background: "var(--t-bg-base)",
            color: "var(--t-text)",
          });
        })
        .finally(() => alive && setSending(false));
    }, 1500);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [storeId, reach, pending]);

  if (!drafts.length) return null;
  const color = review ? "#ef4444" : "#f59e0b";
  return (
    <Link
      href="/dashboard/pos"
      title={review ? "Hay ventas sin conexión que no se pudieron registrar solas" : "Ventas hechas sin conexión: se envían solas al volver"}
      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5"
      style={{ borderColor: `color-mix(in oklab, ${color} 55%, transparent)`, background: `color-mix(in oklab, ${color} 14%, transparent)`, color: "var(--t-text)" }}
    >
      {sending ? "⏳" : review ? "⚠️" : "☁️"}
      <span>
        {pending ? `${pending} sin enviar` : ""}
        {pending && review ? " · " : ""}
        {review ? `${review} por revisar` : ""}
      </span>
    </Link>
  );
}
