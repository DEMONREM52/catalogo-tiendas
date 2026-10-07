"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, PenLine, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SignaturePad, type SignaturePadHandle } from "@/app/traslado/[token]/SignaturePad";
import { srError, type SrDetail, type SrSignature, type SrSignStep } from "./types";

export const SIGN_STEPS: Array<{ key: SrSignStep; icon: string; title: string; who: string; side: "attend" | "request" | "both"; declaration: (from: string, to: string) => string }> = [
  { key: "packed", icon: "📦", title: "Preparó", who: "Quien prepara el pedido", side: "attend", declaration: () => "Confirmo que preparé y empaqué la mercancía según el pedido." },
  { key: "sent", icon: "🔍", title: "Revisó", who: "Quien revisa lo preparado", side: "attend", declaration: () => "Confirmo que revisé la mercancía preparada y está completa." },
  { key: "delivered", icon: "🚚", title: "En camino", who: "Quien lleva la mercancía", side: "both", declaration: (from) => `Confirmo que recibí la mercancía revisada y la llevo hasta ${from}.` },
  { key: "received", icon: "✅", title: "Recibió", who: "Quien recibe en destino", side: "request", declaration: () => "Confirmo que conté la mercancía y las cantidades recibidas son las indicadas." },
];

const NAME_KEY = "remhub_transfer_signer";

/** Quién puede firmar cada paso ahora mismo. */
function canSign(data: SrDetail, step: (typeof SIGN_STEPS)[number]) {
  const s = data.request.status;
  if (s === "rejected" || s === "cancelled") return false;
  const sideOk = step.side === "both" ? data.access.attend || data.access.request : step.side === "attend" ? data.access.attend : data.access.request;
  if (!sideOk) return false;
  if (step.key === "packed") return s === "pending" || s === "preparing";
  if (step.key === "sent") return s === "preparing" && (data.signatures ?? []).some((x) => x.step === "packed");
  if (step.key === "delivered") return s === "dispatched";
  return s === "dispatched" || s === "received";
}

/** Firmas del pedido: nombre, cédula y firma de cada responsable (se sincronizan con el seguimiento del traslado). */
export function RequestSignatures({ data, onSigned, autoOpen, onAutoOpenDone, onCancel }: { data: SrDetail; onSigned: (step: SrSignStep) => void; autoOpen?: SrSignStep | null; onAutoOpenDone?: () => void; onCancel?: () => void }) {
  const signed = new Map((data.signatures ?? []).map((s) => [s.step, s]));
  const [signing, setSigning] = useState<SrSignStep | null>(null);
  const current = signing ?? (autoOpen && !signed.has(autoOpen) ? autoOpen : null);

  return (
    <section className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 60%, transparent)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold"><PenLine size={15} /> Firmas de responsables</p>
        <span className="text-xs" style={{ color: "var(--t-muted)" }}>{signed.size}/4</span>
      </div>
      <ol className="mt-2 grid gap-2 sm:grid-cols-2">
        {SIGN_STEPS.map((step, i) => {
          const sig = signed.get(step.key);
          const can = !sig && canSign(data, step);
          return (
            <li key={step.key} className="rounded-xl border p-2.5" style={{ borderColor: sig ? "color-mix(in oklab, #22c55e 45%, transparent)" : can ? "var(--t-accent)" : "var(--t-card-border)", background: sig ? "color-mix(in oklab, #22c55e 7%, transparent)" : "transparent" }}>
              <p className="flex items-center gap-1.5 text-xs font-bold">
                <span className="grid h-5 w-5 place-items-center rounded-full text-[10px]" style={sig ? { background: "#22c55e", color: "#fff" } : { background: "var(--t-card-border)" }}>{sig ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                {step.icon} {step.title}
              </p>
              {sig ? (
                <div className="mt-1">
                  <p className="truncate text-sm font-black tracking-wide" title={sig.signer_name}>{sig.signer_name}</p>
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {sig.signer_doc ? `CC ${sig.signer_doc} · ` : ""}{new Date(sig.signed_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}{sig.via === "link" ? " · por enlace" : ""}
                  </p>
                  {sig.signature ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sig.signature} alt={`Firma de ${sig.signer_name}`} className="mt-1.5 h-12 w-auto rounded-md border bg-white" style={{ borderColor: "var(--t-card-border)" }} />
                  ) : null}
                </div>
              ) : can ? (
                <button type="button" onClick={() => setSigning(step.key)} className="mt-1.5 w-full rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}>
                  ✍️ Firmar
                </button>
              ) : (
                <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{step.who}</p>
              )}
            </li>
          );
        })}
      </ol>
      {current ? (
        <SignModal
          key={current}
          data={data}
          step={SIGN_STEPS.find((s) => s.key === current)!}
          onClose={() => { setSigning(null); onAutoOpenDone?.(); onCancel?.(); }}
          onDone={() => { setSigning(null); onAutoOpenDone?.(); onSigned(current); }}
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
  const field = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-fuchsia-500/25";
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
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
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
                onChange={(e) => setName(e.target.value.toUpperCase())}
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
