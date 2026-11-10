"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, MessageCircle, PenLine } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cop, rpcError, swalTheme } from "./shared";

type Sig = { role: "prepared" | "approved" | "beneficiary"; beneficiary_id: string | null; name: string; doc: string | null; signature: string; at: string; ip: string | null };
export type SignsData = { ok: boolean; has_link: boolean; token: string | null; signatures: Sig[]; approvers: Array<{ user_id: string; name: string }> };
type Line = { beneficiary_id: string; name: string; amount: number };

const when = (d: string) => new Date(d).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const settlementSignUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/firma-liquidacion/${token}`;

/** Avisa al celular (a quienes aprueban, o a quien preparó). Si las notificaciones no están configuradas, no pasa nada. */
export async function notifySettlement(id: string, event: "submitted" | "approved" | "rejected") {
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    await fetch("/api/push/settlement", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ id, event }) });
  } catch { /* sin conexión: el estado igual quedó guardado */ }
}

/**
 * Firmas de la liquidación (20261290): quién preparó, quién aprobó y cada beneficiario. Enlace para firmar
 * (copiar, WhatsApp o abrir aquí mismo para firmar con la sesión) y, mientras está abierta, a quién va la revisión.
 */
export function SettlementSigns({ id, number, status, lines, preparedBy, pointName }: {
  id: string; number: number; status: string; lines: Line[]; preparedBy: string | null; pointName: string | null;
}) {
  const [d, setD] = useState<SignsData | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_settlement_signs", { p_id: id });
    if (error) { setMissing(/erp_settlement_signs|schema cache|does not exist/i.test(error.message)); return; }
    setD(data as SignsData);
  }, [id]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  async function link(): Promise<string | null> {
    if (d?.token) return settlementSignUrl(d.token);
    const { data, error } = await supabaseBrowser().rpc("erp_settlement_sign_link", { p_id: id });
    if (error) { void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(error) }); return null; }
    await load();
    return settlementSignUrl((data as { token: string }).token);
  }
  async function copy() {
    const url = await link();
    if (!url) return;
    try { await navigator.clipboard.writeText(url); void Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title: "Enlace copiado", timer: 1400, showConfirmButton: false }); }
    catch { window.prompt("Copia el enlace:", url); }
  }
  async function whatsapp() {
    const url = await link();
    if (!url) return;
    const text = `Liquidación #${number}${pointName ? ` de ${pointName}` : ""}: revisa lo que te corresponde y fírmala aquí:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }
  async function open() {
    const url = await link();
    if (url) window.open(url, "_blank", "noopener");
  }

  if (missing) return <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">Para firmar liquidaciones ejecuta en Supabase la migración 20261290_firmas_liquidacion.sql.</p>;
  if (!d) return null;
  const sig = (role: Sig["role"], b?: string) => d.signatures.find((s) => s.role === role && (role !== "beneficiary" || s.beneficiary_id === b)) ?? null;
  const rows: Array<{ key: string; label: string; who: string; sig: Sig | null }> = [
    { key: "p", label: "Preparó", who: preparedBy ?? "—", sig: sig("prepared") },
    { key: "a", label: "Aprobó", who: ["approved", "partially_paid", "paid"].includes(status) ? "—" : "Falta aprobar", sig: sig("approved") },
    ...lines.map((l) => ({ key: l.beneficiary_id, label: `Beneficiario · ${cop(l.amount)}`, who: l.name, sig: sig("beneficiary", l.beneficiary_id) })),
  ];
  const done = rows.filter((r) => r.sig).length;
  const closed = status === "rejected" || status === "reverted";
  const open_ = status === "calculated" || status === "review";

  return (
    <section className="space-y-3">
      {open_ ? (
        <div className="rounded-xl border p-3 text-sm" style={{ borderColor: "color-mix(in oklab, #eda100 45%, var(--t-card-border))", background: "color-mix(in oklab, #eda100 8%, transparent)" }}>
          <p className="font-bold">{status === "review" ? "📨 En revisión: la puede aprobar" : "📨 Al enviarla a revisión, le llega aviso a"}</p>
          <p className="mt-0.5 text-xs">{d.approvers.length ? d.approvers.map((a) => a.name).join(" · ") : "Nadie más tiene «Aprobar liquidaciones» para este punto. Dale ese permiso a alguien en Usuarios."}</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Quien la preparó no la puede aprobar (salvo el dueño). Les llega notificación al celular si la tienen activada.</p>
        </div>
      ) : null}

      <div className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex flex-1 items-center gap-1.5 text-sm font-black"><PenLine size={15} /> Firmas · {done} de {rows.length}</p>
          {!closed ? (
            <>
              <button type="button" onClick={() => void open()} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}><ExternalLink size={12} /> Firmar ahora</button>
              <button type="button" onClick={() => void whatsapp()} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "#16a34a" }}><MessageCircle size={12} /> WhatsApp</button>
              <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Copy size={12} /> Enlace</button>
            </>
          ) : null}
        </div>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2 rounded-lg border p-2 text-xs" style={{ borderColor: r.sig ? "rgba(34,197,94,.45)" : "var(--t-card-border)" }}>
              {r.sig ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.sig.signature} alt={`Firma de ${r.sig.name}`} className="h-10 w-16 shrink-0 rounded bg-white object-contain" />
              ) : <span className="grid h-10 w-16 shrink-0 place-items-center rounded border border-dashed" style={{ borderColor: "var(--t-card-border)" }}>⏳</span>}
              <span className="min-w-0">
                <span className="block font-bold uppercase" style={{ color: "var(--t-muted)" }}>{r.label}</span>
                <span className="block truncate font-semibold">{r.sig ? r.sig.name : r.who}</span>
                <span className="block" style={{ color: "var(--t-muted)" }}>{r.sig ? `${r.sig.doc ? `Doc. ${r.sig.doc} · ` : ""}${when(r.sig.at)}` : "Falta firmar"}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Quien preparó y quien aprobó firman con su sesión («Firmar ahora»). A los beneficiarios mándales el enlace: firman con su nombre y cédula. Cada firma guarda fecha, hora, dispositivo y copia de los valores.</p>
      </div>
    </section>
  );
}
