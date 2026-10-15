"use client";

import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Check, Copy, FileDown, Lock, MessageCircle, Minus, Plus, Printer, RotateCcw, Save, Share2 } from "lucide-react";
import { PAY_LABEL, payLabel, type ReceiptPayment } from "./receipt-extras";

export type ScreenItem = { product_id: string; name: string; image_url: string | null; price: number; qty: number };
export type PaymentMethodLite = { id: string; name: string; provider: string };
export type HistoryRow = { token: string; created_at: string; total: number; status: string; receipt_no: number | null; doc_number: string | null };

const STATUS: Record<string, { emoji: string; label: string; hint: string; color: string }> = {
  draft: { emoji: "✏️", label: "Borrador", hint: "Aún puedes cambiar las cantidades", color: "#38bdf8" },
  sent: { emoji: "📤", label: "Enviado", hint: "Aún puedes cambiar las cantidades", color: "#a78bfa" },
  confirmed: { emoji: "✅", label: "Confirmado", hint: "Quedó registrado y bloqueado", color: "#22c55e" },
  completed: { emoji: "🎉", label: "Completado", hint: "Entregado y finalizado", color: "#22c55e" },
  cancelled: { emoji: "⊘", label: "Anulado", hint: "Este documento no tiene validez", color: "#ef4444" },
};

const card: CSSProperties = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
  boxShadow: "0 18px 50px color-mix(in oklab, black 28%, transparent)",
};
/** Campo «desnudo» dentro de una caja propia (anula el estilo global de inputs). */
const bare: CSSProperties = { border: "none", background: "transparent", boxShadow: "none", minHeight: 0, padding: 0, borderRadius: 0, outline: "none" };

function InfoCard({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
      <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>{icon} {label}</p>
      <div className="mt-1 text-sm font-semibold leading-snug">{children}</div>
    </div>
  );
}

function Stepper({ status, paid }: { status: string; paid: boolean }) {
  if (status === "cancelled") return null;
  const confirmed = status === "confirmed" || status === "completed";
  const done = status === "completed" || paid;
  const steps = [
    { label: "Creado", emoji: "🛒", on: true },
    { label: "Confirmado", emoji: "✅", on: confirmed },
    { label: paid ? "Pagado" : "Completado", emoji: paid ? "💳" : "🎉", on: done },
  ];
  const progress = done ? 100 : confirmed ? 50 : 0;
  return (
    <div className="relative mt-5 px-2">
      <div className="absolute left-[16%] right-[16%] top-4 h-1 rounded-full" style={{ background: "color-mix(in oklab, var(--t-card-border) 80%, transparent)" }} />
      <motion.div className="absolute left-[16%] top-4 h-1 rounded-full" initial={{ width: 0 }} animate={{ width: `${(progress / 100) * 68}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
        style={{ background: "linear-gradient(90deg,#22c55e,#10b981)" }} />
      <div className="relative grid grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.label} className="flex flex-col items-center gap-1 text-center">
            <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 * i }}
              className="grid h-9 w-9 place-items-center rounded-full border-2 text-base"
              style={s.on ? { borderColor: "#22c55e", background: "color-mix(in oklab, #22c55e 18%, var(--t-card-bg))" } : { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", filter: "grayscale(1)", opacity: 0.6 }}>
              {s.emoji}
            </motion.span>
            <span className="text-[11px] font-bold" style={{ color: s.on ? "var(--t-text)" : "var(--t-muted)" }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Qty({ qty, disabled, onChange }: { qty: number; disabled: boolean; onChange: (n: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="inline-flex items-center rounded-full border" style={{ borderColor: "var(--t-card-border)", opacity: disabled ? 0.5 : 1 }}>
      <button type="button" aria-label="Quitar uno" disabled={disabled} onClick={() => onChange(qty - 1)} className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/10 active:scale-90"><Minus size={14} /></button>
      <input type="text" inputMode="numeric" aria-label="Cantidad" disabled={disabled} value={typed ?? String(qty)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { const t = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 5); setTyped(t); if (t && Number(t) > 0) onChange(Number(t)); }}
        onBlur={() => setTyped(null)}
        className="w-10 text-center text-sm font-black tabular-nums" style={bare} />
      <button type="button" aria-label="Agregar uno" disabled={disabled} onClick={() => onChange(qty + 1)} className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/10 active:scale-90"><Plus size={14} /></button>
    </div>
  );
}

export function OrderScreen(props: {
  status: string;
  docKindLabel: string;
  docNumber: string;
  orderNumber: string | number | null;
  businessName: string;
  businessLine: string;
  logo: string | null;
  customerName: string;
  customerDoc: string | null;
  customerNote: string;
  pointName: string | null;
  sellerName: string | null;
  createdAt: string;
  catalogLabel: string;
  items: ScreenItem[];
  total: number;
  money: (n: number) => string;
  locked: boolean;
  saving: boolean;
  dirty: boolean;
  canWhatsApp: boolean;
  paymentStatus: string;
  paymentMethodType: string | null;
  paymentMethods: PaymentMethodLite[];
  startingAddi: boolean;
  onQty: (productId: string, qty: number) => void;
  onSave: () => void;
  onConfirm: () => void;
  onWhatsApp: () => void;
  onPrint: () => void;
  onPay: (m: PaymentMethodLite) => void;
  payment: ReceiptPayment | null;
  qr: string | null;
  history: HistoryRow[];
  onPdf: () => Promise<void>;
  /** Volver a pedir: en el catálogo (cliente) o en el POS (equipo de la tienda). */
  reorderCatalog: string | null;
  reorderPos: string | null;
}) {
  const p = props;
  const st = STATUS[p.status] ?? { emoji: "📄", label: p.status, hint: "", color: "var(--t-accent)" };
  const units = p.items.reduce((s, i) => s + Number(i.qty), 0);
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const paid = p.paymentStatus === "paid";
  const confirmed = p.status === "confirmed" || p.status === "completed";
  // Compartir nativo (celular): solo en el navegador, para que el servidor y el cliente pinten lo mismo.
  const canShare = useSyncExternalStore(() => () => {}, () => typeof navigator.share === "function", () => false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href.split("?")[0]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* el navegador no deja copiar */ }
  }
  function share() {
    void navigator.share?.({ title: `${p.docKindLabel} ${p.docNumber}`, text: `${p.businessName} · ${p.docKindLabel} ${p.docNumber} · Total ${p.money(p.total)}`, url: window.location.href.split("?")[0] }).catch(() => null);
  }

  const mainAction = p.locked ? null : p.dirty ? (
    <button type="button" onClick={p.onSave} disabled={p.saving} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-black text-white transition active:scale-[0.99] disabled:opacity-60"
      style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)", boxShadow: "0 14px 34px rgba(245,158,11,.3)" }}>
      <Save size={18} /> {p.saving ? "Guardando…" : "Guardar cambios"}
    </button>
  ) : (
    <button type="button" onClick={p.onConfirm} disabled={p.saving} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-black text-white transition active:scale-[0.99] disabled:opacity-60"
      style={{ background: "linear-gradient(135deg,#22c55e,#10b981)", boxShadow: "0 14px 34px rgba(34,197,94,.3)" }}>
      <Check size={18} /> {p.saving ? "Procesando…" : "Confirmar pedido"}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-5xl pb-28 lg:pb-0">
      {/* ===== Encabezado ===== */}
      <motion.header initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="overflow-hidden rounded-3xl border" style={card}>
        <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${st.color}, var(--t-accent))` }} />
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "var(--t-card-border)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.logo ? <img src={p.logo} alt="" className="h-full w-full object-contain" /> : <span className="text-2xl">🏪</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-black">{p.businessName}</p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.businessLine}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black"
              style={{ color: st.color, background: `color-mix(in oklab, ${st.color} 16%, transparent)`, border: `1px solid color-mix(in oklab, ${st.color} 40%, transparent)` }}>
              {st.emoji} {st.label}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>{p.docKindLabel}</p>
              <p className="text-3xl font-black tracking-tight sm:text-4xl">{p.docNumber}</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                {p.orderNumber ? `Pedido #${p.orderNumber} · ` : ""}{p.catalogLabel} · {st.hint}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-bold" style={{ color: "var(--t-muted)" }}>Total</p>
              <motion.p key={p.total} initial={{ scale: 1.08 }} animate={{ scale: 1 }} className="text-3xl font-black tabular-nums">{p.money(p.total)}</motion.p>
            </div>
          </div>

          {p.status === "cancelled" ? (
            <div className="mt-4 rounded-2xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "rgba(239,68,68,.5)", background: "rgba(239,68,68,.12)", color: "#ef4444" }}>
              ⊘ Este documento fue ANULADO y no tiene validez.
            </div>
          ) : (
            <Stepper status={p.status} paid={paid} />
          )}
        </div>
      </motion.header>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ===== Columna principal ===== */}
        <div className="space-y-4">
          <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <InfoCard icon="👤" label="Cliente">
              <span className="block break-words">{p.customerName || "—"}</span>
              {p.customerDoc ? <span className="block text-[11px] font-medium" style={{ color: "var(--t-muted)" }}>Doc. {p.customerDoc}</span> : null}
            </InfoCard>
            <InfoCard icon="🕒" label="Fecha">{p.createdAt}</InfoCard>
            <InfoCard icon="📍" label="Punto">{p.pointName ?? "—"}</InfoCard>
            <InfoCard icon="🧑‍💼" label="Vendedor">{p.sellerName ?? "—"}</InfoCard>
          </motion.section>

          {p.customerNote ? (
            <div className="rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 35%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 7%, transparent)" }}>
              💬 <b>Nota:</b> {p.customerNote}
            </div>
          ) : null}

          <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} className="overflow-hidden rounded-3xl border" style={card}>
            <div className="flex items-center justify-between gap-2 border-b px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-sm font-black">🛍️ Productos</p>
              <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{p.items.length} producto{p.items.length === 1 ? "" : "s"} · {units} und.</p>
            </div>
            <ul className="divide-y" style={{ borderColor: "var(--t-card-border)" }}>
              <AnimatePresence initial={false}>
                {p.items.map((i, idx) => (
                  <motion.li key={i.product_id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * idx }}
                    className="flex gap-3 px-4 py-3 sm:px-5" style={{ borderColor: "var(--t-card-border)" }}>
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {i.image_url ? <img src={i.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full place-items-center text-xl">🛍️</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-bold leading-tight">{i.name}</p>
                      <p className="mt-0.5 text-xs tabular-nums" style={{ color: "var(--t-muted)" }}>{p.money(i.price)} c/u{p.locked ? ` × ${i.qty}` : ""}</p>
                      {!p.locked ? <div className="mt-1.5"><Qty qty={i.qty} disabled={p.saving} onChange={(n) => p.onQty(i.product_id, n)} /></div> : null}
                    </div>
                    <p className="shrink-0 self-center text-base font-black tabular-nums">{p.money(i.price * i.qty)}</p>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <div className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 6%, transparent)" }}>
              <span className="text-sm font-bold">Total a pagar</span>
              <span className="text-2xl font-black tabular-nums">{p.money(p.total)}</span>
            </div>
          </motion.section>

          {p.payment ? (
            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border p-5" style={card}>
              <p className="text-sm font-black">💰 Forma de pago</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(p.payment.method === "mixto" ? p.payment.parts : [{ method: p.payment.method, amount: p.total }]).map((x, i) => (
                  <span key={i} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    <span className="text-lg">{PAY_LABEL[x.method]?.emoji ?? "💳"}</span> {payLabel(x.method)} <span className="tabular-nums">{p.money(x.amount)}</span>
                  </span>
                ))}
              </div>
              {(p.payment.received ?? 0) > p.total || (p.payment.change ?? 0) > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                    <p className="text-[10px] font-black uppercase" style={{ color: "var(--t-muted)" }}>Recibido</p>
                    <p className="text-lg font-black tabular-nums">{p.money(p.payment.received ?? p.total)}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <p className="text-[10px] font-black uppercase text-emerald-400">Vuelto</p>
                    <p className="text-lg font-black tabular-nums text-emerald-400">{p.money(p.payment.change ?? 0)}</p>
                  </div>
                </div>
              ) : null}
            </motion.section>
          ) : null}

          {p.history.length ? (
            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl border" style={card}>
              <div className="flex items-center justify-between gap-2 border-b px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-sm font-black">🧾 Otros pedidos de {p.customerName.split(" ")[0] || "este cliente"}</p>
                <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{p.history.length}</p>
              </div>
              <ul className="max-h-80 divide-y overflow-y-auto" style={{ borderColor: "var(--t-card-border)" }}>
                {p.history.map((h) => {
                  const hs = STATUS[h.status] ?? { emoji: "📄", label: h.status, hint: "", color: "var(--t-muted)" };
                  return (
                    <li key={h.token} style={{ borderColor: "var(--t-card-border)" }}>
                      <Link href={`/pedido/${h.token}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-white/5">
                        <span className="text-lg">{hs.emoji}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold">{h.doc_number ?? (h.receipt_no ? `Pedido #${h.receipt_no}` : "Pedido")}</span>
                          <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>
                            {new Date(h.created_at).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })} · {hs.label}
                          </span>
                        </span>
                        <span className="text-sm font-black tabular-nums">{p.money(Number(h.total))}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </motion.section>
          ) : null}

          {/* Pago en línea (solo con pasarela activa y pedido confirmado) */}
          {confirmed && p.paymentMethods.length ? (
            <section className="rounded-3xl border p-5" style={card}>
              <p className="text-sm font-black">💳 Pago en línea</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>La tienda recibe la confirmación cuando la pasarela aprueba el pago.</p>
              {paid ? (
                <p className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-semibold">✅ Pago aprobado{p.paymentMethodType ? ` con ${p.paymentMethodType}` : ""}. ¡Gracias por tu compra!</p>
              ) : p.paymentStatus === "pending" ? (
                <p className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">⏳ Esperando la respuesta de {p.paymentMethodType || "la pasarela"}… se actualiza sola.</p>
              ) : p.paymentStatus === "failed" ? (
                <p className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm">❌ El último intento no fue aprobado. Puedes intentarlo otra vez.</p>
              ) : null}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {p.paymentMethods.map((m) => (
                  <button key={m.id} type="button" onClick={() => p.onPay(m)} disabled={p.paymentStatus === "pending" || paid || p.startingAddi}
                    className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
                    <span className="block text-sm font-black">{m.provider === "addi" ? "🗓️" : "💳"} Pagar con {m.name}</span>
                    <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{m.provider === "addi" ? "A cuotas, sujeto a aprobación de Addi" : "Tarjeta, PSE, Nequi y más"}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* ===== Columna lateral: acciones ===== */}
        <aside className="space-y-3 lg:sticky lg:top-4">
          <section className="rounded-3xl border p-4" style={card}>
            {p.locked ? (
              <p className="flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                <Lock size={14} /> {p.status === "cancelled" ? "Documento anulado: no se puede editar." : "Confirmado: ya no se puede editar."}
              </p>
            ) : (
              <>
                <div className="hidden lg:block">{mainAction}</div>
                <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {p.dirty ? "⚠️ Tienes cambios sin guardar. Guárdalos antes de confirmar o enviar." : "Revisa las cantidades y confirma: al confirmar se bloquea el pedido."}
                </p>
              </>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <button type="button" onClick={p.onWhatsApp} disabled={!p.canWhatsApp || p.saving || p.dirty} className="col-span-2 flex items-center justify-center gap-2 rounded-2xl px-3 py-3 font-black text-white transition hover:brightness-110 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }} title={p.dirty ? "Guarda los cambios antes de enviar" : undefined}>
                <MessageCircle size={17} /> Enviar por WhatsApp
              </button>
              <button type="button" onClick={p.onPrint} className="flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                <Printer size={15} /> Imprimir
              </button>
              <button type="button" onClick={canShare ? share : copyLink} className="flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                {canShare ? <><Share2 size={15} /> Compartir</> : copied ? <><Check size={15} /> ¡Copiado!</> : <><Copy size={15} /> Copiar link</>}
              </button>
              <button type="button" disabled={pdfBusy} onClick={async () => { setPdfBusy(true); try { await p.onPdf(); } finally { setPdfBusy(false); } }}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 font-bold transition hover:-translate-y-0.5 disabled:opacity-60" style={{ borderColor: "var(--t-card-border)" }}>
                <FileDown size={15} /> {pdfBusy ? "Creando PDF…" : "Descargar PDF"}
              </button>
            </div>
            {canShare ? (
              <div className="mt-2 text-[11px]"><button type="button" onClick={copyLink} className="w-full text-center text-[11px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--t-muted)" }}>
                {copied ? "✅ Enlace copiado" : "🔗 Copiar enlace del comprobante"}
              </button></div>
            ) : null}
          </section>
          {p.reorderCatalog || p.reorderPos ? (
            <section className="rounded-3xl border p-4" style={card}>
              <p className="flex items-center gap-1.5 text-sm font-black"><RotateCcw size={15} /> Volver a pedir</p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Arma un pedido nuevo con estos mismos productos, a los precios de hoy. Lo puedes cambiar antes de enviarlo.</p>
              <div className="mt-3 grid gap-2 text-sm">
                {p.reorderCatalog ? (
                  <Link href={p.reorderCatalog} className="flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 font-black text-white transition hover:brightness-110" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
                    🛍️ Pedir otra vez
                  </Link>
                ) : null}
                {p.reorderPos ? (
                  <Link href={p.reorderPos} className="flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                    💳 Cargar en el POS
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}
          {p.qr ? (
            <section className="flex items-center gap-3 rounded-3xl border p-4" style={card}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.qr} alt="Código QR del comprobante" className="h-24 w-24 shrink-0 rounded-xl bg-white p-1.5" />
              <div className="min-w-0">
                <p className="text-sm font-black">📲 Ábrelo en tu celular</p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Escanea el código con la cámara. También sale impreso en la tirilla y en el PDF.</p>
              </div>
            </section>
          ) : null}
          <p className="px-2 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>🔖 Guarda este enlace: siempre podrás volver a ver tu comprobante.</p>
        </aside>
      </div>

      {/* Celular: acción principal siempre a mano */}
      {mainAction ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t p-3 backdrop-blur-xl lg:hidden"
          style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 88%, transparent)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="shrink-0">
              <p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Total</p>
              <p className="text-lg font-black tabular-nums">{p.money(p.total)}</p>
            </div>
            <div className="min-w-0 flex-1">{mainAction}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
