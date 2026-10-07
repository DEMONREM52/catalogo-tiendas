"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRunOnChange } from "../inventario/shared";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, FileText, HandCoins, MessageCircle, PlusCircle, Printer, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { docWithDv } from "../nit";
import { CreditMeter, KindBadge } from "./CreditMeter";
import { PAY_METHODS, errorText, kindInfo, methodLabel, money, shortDate, waLink, type CreditState, type ThirdParty } from "./terceros";

type Receivable = {
  id: string; kind: string; doc_number: string | null; description: string | null; total: number; balance: number;
  issue_date: string; due_date: string; status: "open" | "paid" | "void"; void_reason: string | null; days_overdue: number;
  point: string | null; order_token: string | null; created_by_name: string | null;
};
type Payment = {
  id: string; receivable_id: string; amount: number; method: string; reference: string | null; notes: string | null; paid_at: string;
  created_by_name: string | null; voided: boolean; voided_reason: string | null; doc_number: string | null;
};
type Statement = { state: CreditState; totals: { billed: number; paid: number; open: number; documents: number }; receivables: Receivable[]; payments: Payment[] };

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

/** Pide valor, forma de pago y referencia de un abono. */
export async function askPayment(title: string, max: number, suggested: number) {
  const methods = PAY_METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  const res = await Swal.fire({
    ...swal,
    title,
    html: `
      <div style="text-align:left;display:grid;gap:10px">
        <label style="font-size:12px;opacity:.8">Valor del abono (máximo ${money(max)})
          <input id="pay-amount" class="swal2-input" inputmode="numeric" style="margin:6px 0 0;width:100%" value="${Math.round(suggested)}" />
        </label>
        <label style="font-size:12px;opacity:.8">Forma de pago
          <select id="pay-method" class="swal2-select" style="margin:6px 0 0;width:100%;display:block">${methods}</select>
        </label>
        <label style="font-size:12px;opacity:.8">Referencia / comprobante (opcional)
          <input id="pay-ref" class="swal2-input" style="margin:6px 0 0;width:100%" placeholder="N.º de transferencia, recibo…" />
        </label>
      </div>`,
    showCancelButton: true,
    confirmButtonText: "Registrar abono",
    cancelButtonText: "Cancelar",
    didOpen: () => {
      const el = document.getElementById("pay-amount") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    },
    preConfirm: () => {
      const amount = Number(String((document.getElementById("pay-amount") as HTMLInputElement).value).replace(/\D/g, ""));
      if (!amount || amount <= 0) return Swal.showValidationMessage("Escribe un valor mayor a cero.");
      if (amount > max + 0.5) return Swal.showValidationMessage(`El abono no puede superar ${money(max)}.`);
      return {
        amount,
        method: (document.getElementById("pay-method") as HTMLSelectElement).value,
        reference: (document.getElementById("pay-ref") as HTMLInputElement).value,
      };
    },
  });
  return res.isConfirmed ? (res.value as { amount: number; method: string; reference: string }) : null;
}

/** Estado de cuenta del tercero: cupo, documentos pendientes, abonos y acciones. */
export function StatementDrawer({
  party,
  onClose,
  canPay,
  canCredit,
  onChanged,
}: {
  party: ThirdParty | null;
  onClose: () => void;
  canPay: boolean;
  canCredit: boolean;
  onChanged: () => void;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [loaded, setLoaded] = useState<{ id: string; data: Statement } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "all" | "payments">("open");
  const [busy, setBusy] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const partyId = party?.id ?? null;
  const load = useCallback(async () => {
    if (!partyId) return;
    const { data: res, error: err } = await supabaseBrowser().rpc("erp_customer_statement", { p_customer: partyId });
    if (err) {
      setError(errorText(err));
      return;
    }
    setError(null);
    setLoaded({ id: partyId, data: res as Statement });
  }, [partyId]);
  // Solo se muestran los datos del tercero abierto (nunca los del anterior).
  const data = loaded && loaded.id === partyId ? loaded.data : null;
  useRunOnChange(load);

  useEffect(() => {
    if (!party) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [party]);

  async function refresh() {
    await load();
    onChanged();
  }

  async function payGeneral() {
    if (!party || !data) return;
    const v = await askPayment(`Abono de ${party.name}`, data.totals.open, data.totals.open);
    if (!v) return;
    setBusy(true);
    const { data: res, error: err } = await supabaseBrowser().rpc("erp_customer_pay", { p_customer: party.id, p_amount: v.amount, p_method: v.method, p_reference: v.reference, p_notes: null });
    setBusy(false);
    if (err) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo registrar", text: errorText(err) });
    void Swal.fire({ ...swal, icon: "success", title: "Abono registrado", text: `Se aplicó a ${(res as { documents: number }).documents} documento(s), empezando por el más antiguo.`, timer: 2200, showConfirmButton: false });
    await refresh();
  }

  async function payOne(r: Receivable) {
    const v = await askPayment(`Abono a ${r.doc_number ?? "documento"}`, r.balance, r.balance);
    if (!v) return;
    setBusy(true);
    const { error: err } = await supabaseBrowser().rpc("erp_receivable_pay", { p_receivable: r.id, p_amount: v.amount, p_method: v.method, p_reference: v.reference, p_notes: null });
    setBusy(false);
    if (err) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo registrar", text: errorText(err) });
    void Swal.fire({ ...swal, icon: "success", title: "Abono registrado", timer: 1300, showConfirmButton: false });
    await refresh();
  }

  async function addManual() {
    if (!party) return;
    const res = await Swal.fire({
      ...swal,
      title: "Agregar saldo por cobrar",
      html: `<div style="text-align:left;display:grid;gap:10px">
        <label style="font-size:12px;opacity:.8">Valor<input id="m-amount" class="swal2-input" inputmode="numeric" style="margin:6px 0 0;width:100%" /></label>
        <label style="font-size:12px;opacity:.8">Vence<input id="m-due" type="date" class="swal2-input" style="margin:6px 0 0;width:100%" /></label>
        <label style="font-size:12px;opacity:.8">Concepto<input id="m-desc" class="swal2-input" style="margin:6px 0 0;width:100%" placeholder="Saldo inicial, venta anterior…" /></label>
        <label style="font-size:12px;opacity:.8">N.º de documento (opcional)<input id="m-doc" class="swal2-input" style="margin:6px 0 0;width:100%" /></label>
      </div>`,
      showCancelButton: true,
      confirmButtonText: "Agregar",
      cancelButtonText: "Cancelar",
      preConfirm: () => {
        const amount = Number(String((document.getElementById("m-amount") as HTMLInputElement).value).replace(/\D/g, ""));
        if (!amount) return Swal.showValidationMessage("Escribe el valor.");
        return {
          amount,
          due: (document.getElementById("m-due") as HTMLInputElement).value || null,
          desc: (document.getElementById("m-desc") as HTMLInputElement).value,
          doc: (document.getElementById("m-doc") as HTMLInputElement).value,
        };
      },
    });
    if (!res.isConfirmed) return;
    const v = res.value as { amount: number; due: string | null; desc: string; doc: string };
    const { error: err } = await supabaseBrowser().rpc("erp_receivable_manual", { p_customer: party.id, p_amount: v.amount, p_due: v.due, p_description: v.desc, p_doc: v.doc });
    if (err) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo agregar", text: errorText(err) });
    await refresh();
  }

  async function voidPayment(p: Payment) {
    const res = await Swal.fire({ ...swal, icon: "warning", title: `Anular abono de ${money(p.amount)}`, input: "text", inputPlaceholder: "Motivo (obligatorio)", showCancelButton: true, confirmButtonText: "Anular", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444", inputValidator: (v) => (v.trim() ? null : "Escribe el motivo.") });
    if (!res.isConfirmed) return;
    const { error: err } = await supabaseBrowser().rpc("erp_receivable_payment_void", { p_payment: p.id, p_reason: res.value });
    if (err) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo anular", text: errorText(err) });
    await refresh();
  }

  async function voidReceivable(r: Receivable) {
    const res = await Swal.fire({ ...swal, icon: "warning", title: `Anular ${r.doc_number ?? "cuenta"}`, text: "La deuda deja de contar en la cartera.", input: "text", inputPlaceholder: "Motivo (obligatorio)", showCancelButton: true, confirmButtonText: "Anular", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444", inputValidator: (v) => (v.trim() ? null : "Escribe el motivo.") });
    if (!res.isConfirmed) return;
    const { error: err } = await supabaseBrowser().rpc("erp_receivable_void", { p_receivable: r.id, p_reason: res.value });
    if (err) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo anular", text: errorText(err) });
    await refresh();
  }

  const reminder = party && data
    ? waLink(party.mobile, `Hola ${party.name.split(" ")[0]}, te recordamos que tienes un saldo pendiente de ${money(data.totals.open)}${data.state.overdue > 0 ? `, de los cuales ${money(data.state.overdue)} ya están vencidos` : ""}. ¡Gracias por tu pago!`)
    : null;
  const rows = data ? data.receivables.filter((r) => (tab === "open" ? r.status === "open" : true)) : [];

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {party ? (
        <motion.div key="statement" className="fixed inset-0 z-120 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`Estado de cuenta de ${party.name}`}
            className="relative flex h-dvh w-full max-w-3xl flex-col border-l print:max-w-none"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>Estado de cuenta</p>
                <h3 className="mt-0.5 truncate text-lg font-black">{party.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--t-muted)" }}>
                  {party.document_number ? <span>{party.document_type} {docWithDv(party.document_number)}</span> : null}
                  {party.kinds.map((k) => <KindBadge key={k} {...kindInfo(k)} />)}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => window.print()} className="grid h-9 w-9 place-items-center rounded-full border print:hidden" style={{ borderColor: "var(--t-card-border)" }} aria-label="Imprimir" title="Imprimir">
                  <Printer size={15} />
                </button>
                <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border transition hover:rotate-90 print:hidden" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}
              {!data && !error ? <div className="h-40 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)" }} /> : null}
              {data ? (
                <>
                  <div className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
                    <CreditMeter size="lg" enabled={data.state.enabled} blocked={data.state.blocked} limit={data.state.limit} used={data.state.used} overdue={data.state.overdue} overdueCount={data.state.overdue_count} />
                    {data.state.blocked && data.state.blocked_reason ? <p className="mt-2 text-xs text-red-400">Motivo del bloqueo: {data.state.blocked_reason}</p> : null}
                    <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Plazo: {data.state.days} días</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["Facturado a crédito", data.totals.billed, "var(--t-text)"],
                      ["Abonado", data.totals.paid, "#22c55e"],
                      ["Saldo pendiente", data.totals.open, data.state.overdue > 0 ? "#ef4444" : "var(--t-text)"],
                    ].map(([label, value, color]) => (
                      <div key={label as string} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label as string}</p>
                        <p className="mt-1 text-base font-black tabular-nums sm:text-lg" style={{ color: color as string }}>{money(value as number)}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2 print:hidden">
                    {canPay && data.totals.open > 0 ? (
                      <button type="button" disabled={busy} onClick={() => void payGeneral()} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: "#16a34a" }}>
                        <HandCoins size={16} /> Registrar abono
                      </button>
                    ) : null}
                    {reminder && data.totals.open > 0 ? (
                      <a href={reminder} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                        <MessageCircle size={16} /> Recordar por WhatsApp
                      </a>
                    ) : null}
                    {canCredit ? (
                      <button type="button" onClick={() => void addManual()} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                        <PlusCircle size={16} /> Agregar saldo
                      </button>
                    ) : null}
                  </div>

                  <div className="flex gap-1 rounded-full border p-1 text-xs font-bold print:hidden" style={{ borderColor: "var(--t-card-border)" }}>
                    {([["open", `Pendientes (${data.receivables.filter((r) => r.status === "open").length})`], ["all", "Todos los documentos"], ["payments", `Abonos (${data.payments.length})`]] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setTab(k)} className="flex-1 rounded-full px-3 py-1.5 transition" style={tab === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
                        {l}
                      </button>
                    ))}
                  </div>

                  {tab !== "payments" ? (
                    rows.length === 0 ? (
                      <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                        {tab === "open" ? "🎉 No tiene saldos pendientes." : "Aún no tiene documentos a crédito."}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {rows.map((r) => {
                          const late = r.status === "open" && r.days_overdue > 0;
                          const soon = r.status === "open" && !late && new Date(`${r.due_date}T23:59:59`).getTime() - nowMs < 7 * 86400000;
                          return (
                            <div key={r.id} className="rounded-2xl border p-3" style={{ borderColor: late ? "color-mix(in oklab, #ef4444 45%, transparent)" : "var(--t-card-border)", opacity: r.status === "void" ? 0.55 : 1 }}>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                                    <FileText size={14} /> {r.doc_number ?? (r.kind === "manual" ? "Saldo manual" : "Documento")}
                                    {late ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-400">Vencida hace {r.days_overdue} día{r.days_overdue === 1 ? "" : "s"}</span> : null}
                                    {soon ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-500">Vence pronto</span> : null}
                                    {r.status === "paid" ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-500">Pagada</span> : null}
                                    {r.status === "void" ? <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px]">Anulada</span> : null}
                                  </p>
                                  <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                                    {shortDate(r.issue_date)} → vence {shortDate(r.due_date)}{r.point ? ` · ${r.point}` : ""}{r.description ? ` · ${r.description}` : ""}
                                  </p>
                                  {r.void_reason ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Motivo: {r.void_reason}</p> : null}
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-black tabular-nums">{money(r.balance)}</p>
                                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>de {money(r.total)}</p>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5 print:hidden">
                                {canPay && r.status === "open" ? (
                                  <button type="button" disabled={busy} onClick={() => void payOne(r)} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "color-mix(in oklab, #22c55e 45%, transparent)", color: "#22c55e" }}>
                                    Abonar
                                  </button>
                                ) : null}
                                {r.order_token ? (
                                  <a href={`/pedido/${r.order_token}`} target="_blank" rel="noreferrer" className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                                    Ver documento
                                  </a>
                                ) : null}
                                {canCredit && r.status !== "void" && r.balance === r.total ? (
                                  <button type="button" onClick={() => void voidReceivable(r)} className="rounded-lg border px-2.5 py-1 text-xs font-semibold text-red-400" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }}>
                                    Anular
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : data.payments.length === 0 ? (
                    <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Aún no hay abonos.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.payments.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", opacity: p.voided ? 0.55 : 1 }}>
                          <div className="min-w-0">
                            <p className="text-sm font-bold" style={{ textDecoration: p.voided ? "line-through" : undefined }}>
                              {money(p.amount)} · {methodLabel(p.method)}
                            </p>
                            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                              {new Date(p.paid_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })} · {p.doc_number ?? "—"}{p.reference ? ` · Ref ${p.reference}` : ""}{p.created_by_name ? ` · ${p.created_by_name}` : ""}
                            </p>
                            {p.voided ? <p className="text-xs text-red-400">Anulado: {p.voided_reason}</p> : null}
                          </div>
                          {canCredit && !p.voided ? (
                            <button type="button" onClick={() => void voidPayment(p)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold text-red-400 print:hidden" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }}>
                              <Ban size={12} /> Anular
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
