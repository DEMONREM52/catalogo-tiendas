"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m as motion } from "framer-motion";
import { Check, PenLine, Share2, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SignaturePad, type SignaturePadHandle } from "@/app/traslado/[token]/SignaturePad";
import { srError, type SrDetail, type SrSignature, type SrSignStep } from "./types";
import { transferTrackUrl } from "@/lib/transfer-tracking";
import QRCode from "qrcode";

export const SIGN_STEPS: Array<{ key: SrSignStep; icon: string; title: string; who: string; side: "attend" | "request" | "both"; declaration: (from: string, to: string) => string }> = [
  { key: "packed", icon: "📦", title: "Preparó", who: "Quien prepara el pedido", side: "attend", declaration: () => "Confirmo que preparé y empaqué la mercancía según el pedido." },
  { key: "sent", icon: "🔍", title: "Revisó", who: "Quien revisa lo preparado", side: "attend", declaration: () => "Confirmo que revisé la mercancía preparada y está completa." },
  { key: "delivered", icon: "🚚", title: "En camino", who: "Quien lleva la mercancía", side: "both", declaration: (from) => `Confirmo que recibí la mercancía revisada y la llevo hasta ${from}.` },
  { key: "received", icon: "✅", title: "Recibió", who: "Quien recibe en destino", side: "request", declaration: () => "Confirmo que conté la mercancía y las cantidades recibidas son las indicadas." },
];

const NAME_KEY = "remhub_transfer_signer";
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

/**
 * Enviar el enlace de firmas del pedido (/firma-pedido/<enlace>, sin iniciar sesión) por WhatsApp, copiarlo,
 * compartirlo o mostrar el código QR. Sirve para los cuatro pasos: antes de salir se firma ahí mismo «Preparó» y
 * «Revisó»; cuando sale, esa misma página lleva al seguimiento del envío para «En camino» y «Recibió».
 */
async function shareSignLink(data: SrDetail, step: (typeof SIGN_STEPS)[number] | null) {
  const r = data.request;
  const { data: link, error } = await supabaseBrowser().rpc("erp_sr_sign_link", { p_request: r.id });
  let url: string;
  const sent = r.status === "dispatched" || r.status === "received";
  const transferToken = (link as { transfer_token?: string | null } | null)?.transfer_token ?? data.transfer?.track_token ?? null;
  // Ya salió: el mismo enlace de un traslado normal (seguimiento, firmas «En camino»/«Recibió» y guía).
  if (sent && transferToken) url = transferTrackUrl(transferToken);
  else if (!error && link) url = `${window.location.origin}/firma-pedido/${(link as { token: string }).token}`;
  else if (transferToken) url = transferTrackUrl(transferToken); // sin la migración 20261276
  else return void Swal.fire({ ...swal, icon: "info", title: "Falta un paso", text: error && /Could not find the function|schema cache/i.test(error.message) ? "Ejecuta en Supabase la migración 20261276_firma_pedido_enlace.sql." : srError(error) });
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 }).catch(() => null);
  const text = [
    sent && data.transfer ? `🚚 Traslado #${data.transfer.number} · Pedido interno #${r.number}` : step ? `✍️ Firma «${step.title}» · Pedido interno #${r.number}` : `✍️ Firmas del pedido interno #${r.number}`,
    `🏬 ${r.to_name} → 📍 ${r.from_name}`,
    step ? `${step.who}: abre el enlace, revisa los productos, escribe tu nombre y firma con el dedo. No necesitas iniciar sesión.` : "Abre el enlace, revisa los productos y firma tu paso con el dedo. No necesitas iniciar sesión.",
    url,
  ].join("\n");
  const res = await Swal.fire({
    ...swal, title: step ? `🔗 Que firmen «${step.title}»` : "🔗 Enlace de firmas del pedido",
    html: `<p style="font-size:13px;opacity:.8">Mándalo al bodeguero o a quien corresponda: firma desde su celular, sin cuenta. Vale 15 días y sirve para los 4 pasos.</p>`
      + (qr ? `<img src="${qr}" alt="Código QR" style="margin:12px auto 4px;width:180px;height:180px;border-radius:14px;background:#fff;padding:6px"/><p style="font-size:11px;opacity:.7">O que lo escaneen aquí mismo con la cámara</p>` : "")
      + `<p style="font-size:11px;word-break:break-all;margin-top:8px;padding:8px;border-radius:10px;background:rgba(127,127,127,.12)">${url}</p>`,
    showDenyButton: true, showCancelButton: true,
    confirmButtonText: "📲 WhatsApp", denyButtonText: "📋 Copiar", cancelButtonText: typeof navigator !== "undefined" && "share" in navigator ? "↗️ Compartir…" : "Cerrar",
    confirmButtonColor: "#16a34a", denyButtonColor: "#8b5cf6",
  });
  if (res.isConfirmed) window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  else if (res.isDenied) {
    try { await navigator.clipboard.writeText(text); void Swal.fire({ ...swal, toast: true, position: "top-end", timer: 2000, showConfirmButton: false, icon: "success", title: "Enlace copiado" }); }
    catch { void Swal.fire({ ...swal, icon: "info", title: "Copia el enlace", text: url }); }
  } else if (res.dismiss === Swal.DismissReason.cancel && "share" in navigator) {
    try { await navigator.share({ title: `Pedido interno #${r.number}`, text }); } catch { /* el usuario cerró el menú */ }
  }
}

/**
 * Firmas del pedido, compactas: los 4 pasos en una línea (quién firmó) y el enlace para compartir el pedido.
 * Para firmar se usa el botón «👉 Te toca» de abajo, que abre aquí la ventana de firma del paso que sigue.
 * Las firmas hechas (nombre, cédula, imagen) quedan plegadas en «Ver firmas».
 */
export function RequestSignatures({ data, onSigned, autoOpen, onAutoOpenDone, onCancel }: { data: SrDetail; onSigned: (step: SrSignStep) => void; autoOpen?: SrSignStep | null; onAutoOpenDone?: () => void; onCancel?: () => void }) {
  const signed = new Map((data.signatures ?? []).map((s) => [s.step, s]));
  const current = autoOpen && !signed.has(autoOpen) ? autoOpen : null;
  // El enlace sirve mientras el pedido no se haya cerrado (antes de salir lleva a las firmas; después, al seguimiento).
  const st = data.request.status;
  const linkOpen = st === "pending" || st === "preparing" || st === "dispatched";

  return (
    <section className="rounded-2xl border p-2.5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 60%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-bold"><PenLine size={13} /> Firmas {signed.size}/4</span>
        {SIGN_STEPS.map((step) => {
          const sig = signed.get(step.key);
          return (
            <span key={step.key} title={sig ? `${step.title}: ${sig.signer_name}` : `${step.title}: ${step.who}`}
              className="inline-flex max-w-[11rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={sig ? { borderColor: "color-mix(in oklab, #22c55e 45%, transparent)", background: "color-mix(in oklab, #22c55e 10%, transparent)", color: "#22c55e" } : { borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
              {sig ? <Check size={11} strokeWidth={3} className="shrink-0" /> : <span aria-hidden>{step.icon}</span>}
              <span className="truncate">{step.title}{sig ? ` · ${sig.signer_name.split(" ")[0]}` : ""}</span>
            </span>
          );
        })}
        {linkOpen ? (
          <button type="button" onClick={() => void shareSignLink(data, null)} title="Para que alguien vea el pedido y firme desde su celular, sin cuenta"
            className="ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>
            <Share2 size={12} /> Compartir pedido
          </button>
        ) : null}
      </div>
      {signed.size ? (
        <details className="mt-1.5 text-xs">
          <summary className="cursor-pointer select-none font-semibold" style={{ color: "var(--t-muted)" }}>Ver firmas</summary>
          <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {SIGN_STEPS.filter((s) => signed.has(s.key)).map((step) => {
              const sig = signed.get(step.key)!;
              return (
                <li key={step.key} className="rounded-xl border p-2" style={{ borderColor: "color-mix(in oklab, #22c55e 35%, transparent)" }}>
                  <p className="text-[11px] font-bold">{step.icon} {step.title}</p>
                  <p className="truncate text-sm font-black tracking-wide" title={sig.signer_name}>{sig.signer_name}</p>
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {sig.signer_doc ? `CC ${sig.signer_doc} · ` : ""}{new Date(sig.signed_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}{sig.via === "link" ? " · por enlace" : ""}
                  </p>
                  {sig.signature ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sig.signature} alt={`Firma de ${sig.signer_name}`} loading="lazy" className="mt-1 h-12 w-auto rounded-md border bg-white" style={{ borderColor: "var(--t-card-border)" }} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      {current ? (
        <SignModal
          key={current}
          data={data}
          step={SIGN_STEPS.find((s) => s.key === current)!}
          onClose={() => { onAutoOpenDone?.(); onCancel?.(); }}
          onDone={() => { onAutoOpenDone?.(); onSigned(current); }}
        />
      ) : null}
    </section>
  );
}


function SignModal({ data, step, onClose, onDone }: { data: SrDetail; step: (typeof SIGN_STEPS)[number]; onClose: () => void; onDone: () => void }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const padRef = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(() => {
    try {
      return (localStorage.getItem(NAME_KEY) ?? "").toUpperCase();
    } catch {
      return "";
    }
  });
  const [doc, setDoc] = useState("");
  const [notes, setNotes] = useState("");
  const [agree, setAgree] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (name.trim().length < 3) return void Swal.fire({ icon: "warning", title: "Escribe el nombre completo", background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!hasInk) return void Swal.fire({ icon: "warning", title: "Dibuja la firma", background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!agree) return void Swal.fire({ icon: "warning", title: "Marca la casilla de confirmación", background: "var(--t-bg-base)", color: "var(--t-text)" });
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_stock_request_sign", {
      p_request: data.request.id, p_step: step.key, p_name: name.trim().toUpperCase(), p_doc: doc.trim() || null,
      p_signature: padRef.current?.toDataUrl() ?? null, p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) return void Swal.fire({ icon: "error", title: "No se pudo firmar", text: srError(error), background: "var(--t-bg-base)", color: "var(--t-text)" });
    try {
      localStorage.setItem(NAME_KEY, name.trim().toUpperCase());
    } catch {
      /* comodidad */
    }
    void Swal.fire({ icon: "success", title: "¡Firmado!", text: "Quedó registrado en el pedido, el chat y el seguimiento del traslado.", timer: 1800, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
    onDone();
  }

  if (!mounted) return null;
  const field = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/25";
  const fieldStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" };
  return createPortal(
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-130 flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]" onClick={onClose} />
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label={`Firmar: ${step.title}`}
          className="relative max-h-[94dvh] w-full overflow-y-auto rounded-t-[28px] border p-5 shadow-2xl sm:max-w-lg sm:rounded-[28px]"
          style={{ borderColor: "var(--t-accent)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>Pedido #{data.request.number}</p>
              <h3 className="text-lg font-black">{step.icon} Firmar: {step.title}</h3>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{step.who} escribe su nombre y firma.</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
              <X size={16} />
            </button>
          </div>
          <div className="mt-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
              <input
                className={`${field} font-bold uppercase tracking-wide`}
                style={fieldStyle}
                placeholder="NOMBRE COMPLETO *"
                autoComplete="name"
                value={name}
                maxLength={80}
                onChange={(e) => { const el = e.target; const at = el.selectionStart; setName(el.value.toUpperCase()); requestAnimationFrame(() => { try { el.setSelectionRange(at, at); } catch {} }); }}
              />
              <input className={field} style={fieldStyle} placeholder="Cédula (opcional)" inputMode="numeric" value={doc} maxLength={30} onChange={(e) => setDoc(e.target.value)} />
            </div>
            <textarea className={field} style={fieldStyle} rows={2} maxLength={500} placeholder="Notas (opcional): estado de las cajas, placa, novedades…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <SignaturePad ref={padRef} onChange={setHasInk} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{step.declaration(data.request.from_name, data.request.to_name)}</span>
            </label>
            <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-2xl px-4 py-3 text-base font-bold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
              {busy ? "Firmando…" : `✍️ Firmar: ${step.title.toLowerCase()}`}
            </button>
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

export type { SrSignature };
