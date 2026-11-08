"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SignaturePad, type SignaturePadHandle } from "../../traslado/[token]/SignaturePad";

/**
 * Firma de una liquidación (20261290). Firman quien la preparó y quien la aprobó (con su sesión de RemHub)
 * y cada beneficiario (nombre, cédula y «estoy de acuerdo»). Cada firma guarda copia de lo firmado.
 */

type Role = "prepared" | "approved" | "beneficiary";
type Line = { beneficiary_id: string; name: string; document: string | null; pct: number; share_amount: number; carried_amount: number; deductions: number; amount: number };
type Terms = {
  number: number; point: string | null; cutoff: string; mode: string | null; gross_total: number | null; expenses_total: number; pool_total: number; carried_total: number;
  shared_expenses_total: number; merch_cost: number | null; cost_advances_total: number | null; cost_due: number | null; prepared_by: string | null; lines: Line[];
};
type Sig = { role: Role; beneficiary_id: string | null; name: string; doc: string | null; signature: string; at: string };
type Data = { ok: boolean; status: string; terms: Terms; created_at: string; decided_by_name: string | null; decided_at: string | null;
  store: { name: string; logo_url: string | null } | null; can_sign_prepared: boolean; can_sign_approved: boolean; actor_name: string | null; signatures: Sig[] };

const cop = (v: unknown) => `$${Math.round(Number(v ?? 0)).toLocaleString("es-CO")}`;
const when = (iso: string) => new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const n = (v: unknown) => Number(v ?? 0);
const card = { background: "var(--t-card-bg)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const input = "w-full rounded-xl border px-3 py-2.5 text-[15px] outline-none transition focus:ring-2 focus:ring-[color:var(--t-accent)]";
const inputStyle = { background: "var(--t-card-bg-soft)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const STATUS: Record<string, string> = { calculated: "Calculada", review: "En revisión", approved: "Aprobada", partially_paid: "Pago parcial", paid: "Pagada", rejected: "Rechazada", reverted: "Revertida" };
const cleanError = (e: { message?: string }) => (/Could not find the function|schema cache/i.test(e.message ?? "") ? "Falta activar las firmas de liquidaciones en la tienda." : e.message ?? "No se pudo.");

export default function SettlementSignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState<string>("");

  const load = useCallback(async () => {
    const { data: d } = await supabaseBrowser().rpc("settlement_sign_get", { p_token: token });
    setData((d as Data | null)?.ok ? (d as Data) : null);
    setLoading(false);
  }, [token]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  if (loading) return <Shell><div className="rounded-3xl border p-8 text-center" style={card}>Cargando la liquidación…</div></Shell>;
  if (!data) return (
    <Shell>
      <div className="rounded-3xl border p-8 text-center" style={card}>
        <p className="text-3xl">🔒</p>
        <p className="mt-2 text-lg font-bold">No se pudo abrir la liquidación</p>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>El enlace no es válido. Pide que te lo envíen de nuevo.</p>
      </div>
    </Shell>
  );

  const t = data.terms;
  const store = data.store?.name ?? "la empresa";
  const closed = data.status === "rejected" || data.status === "reverted";
  const approved = ["approved", "partially_paid", "paid"].includes(data.status);
  const sig = (role: Role, b?: string) => data.signatures.find((s) => s.role === role && (role !== "beneficiary" || s.beneficiary_id === b)) ?? null;
  const pendingBens = t.lines.filter((l) => !sig("beneficiary", l.beneficiary_id));
  const total = 2 + t.lines.length;
  const done = data.signatures.length;
  const chosen = t.lines.find((l) => l.beneficiary_id === who) ?? null;

  return (
    <Shell>
      <header className="rounded-3xl border p-5" style={{ ...card, boxShadow: "var(--t-shadow)" }}>
        <div className="flex items-center gap-3">
          {data.store?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.store.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{store}</p>
            <h1 className="text-xl font-extrabold">Liquidación #{t.number}{t.point ? ` · ${t.point}` : " · Madre"}</h1>
          </div>
          <span className="rounded-full px-3 py-1 text-xs font-bold" style={done === total ? { background: "#16a34a22", color: "#16a34a" } : { background: "#f59e0b22", color: "#b45309" }}>
            {closed ? STATUS[data.status] : done === total ? "✅ Firmada" : `${done} de ${total} firmas`}
          </span>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Corte {when(t.cutoff)} · {STATUS[data.status] ?? data.status} · preparó {t.prepared_by ?? "—"}{data.decided_by_name ? ` · decidió ${data.decided_by_name}` : ""}</p>
      </header>

      <section className="rounded-3xl border p-5 text-sm" style={card}>
        <h2 className="mb-2 font-extrabold">🧮 Resumen</h2>
        {t.merch_cost !== null && t.merch_cost !== undefined ? (
          <p>Costo de la mercancía <b>{cop(t.merch_cost)}</b>{n(t.cost_advances_total) ? <> − anticipos ya entregados <b>{cop(t.cost_advances_total)}</b></> : null} = costo que falta entregar <b>{cop(t.cost_due)}</b></p>
        ) : null}
        <p className="mt-1">Ganancia <b>{cop(t.gross_total ?? t.pool_total)}</b>{n(t.expenses_total) ? <> − gastos y nómina <b>{cop(t.expenses_total)}</b></> : null}{n(t.carried_total) ? <> {n(t.carried_total) < 0 ? "−" : "+"} saldo traído <b>{cop(Math.abs(n(t.carried_total)))}</b></> : null}{n(t.shared_expenses_total) ? <> − gastos compartidos <b>{cop(t.shared_expenses_total)}</b></> : null}</p>
        <table className="mt-3 w-full">
          <thead><tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}><th className="py-1">Beneficiario</th><th className="py-1 text-right">%</th><th className="py-1 text-right">Le corresponde</th></tr></thead>
          <tbody>
            {t.lines.map((l) => (
              <tr key={l.beneficiary_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                <td className="py-1.5 pr-2"><b>{l.name}</b>{n(l.deductions) || n(l.carried_amount) ? <span className="block text-xs" style={{ color: "var(--t-muted)" }}>parte {cop(l.share_amount)}{n(l.carried_amount) ? ` · saldo ${cop(l.carried_amount)}` : ""}{n(l.deductions) ? ` · gastos −${cop(l.deductions)}` : ""}</span> : null}</td>
                <td className="py-1.5 text-right tabular-nums">{n(l.pct)} %</td>
                <td className="py-1.5 text-right font-bold tabular-nums">{cop(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {closed ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">⚠️ Esta liquidación fue {STATUS[data.status].toLowerCase()}: ya no se firma. Las firmas que tenía quedan como historial.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <SignedBox title="Preparó" sig={sig("prepared")} />
        <SignedBox title="Aprobó" sig={sig("approved")} />
        {t.lines.map((l) => <SignedBox key={l.beneficiary_id} title={`Beneficiario · ${l.name}`} sig={sig("beneficiary", l.beneficiary_id)} />)}
      </div>

      {!closed && !sig("prepared") && data.can_sign_prepared ? (
        <SignForm token={token} role="prepared" beneficiary={null} defaultName={data.actor_name ?? ""} needDoc={false}
          declaration={`Preparé la liquidación #${t.number} con estos valores y respondo por ellos.`} cta="✍️ Firmar como quien preparó" onSigned={setData} />
      ) : null}
      {!closed && !sig("approved") && data.can_sign_approved ? (
        approved ? (
          <SignForm token={token} role="approved" beneficiary={null} defaultName={data.actor_name ?? ""} needDoc={false}
            declaration={`Revisé y aprobé la liquidación #${t.number} con estos valores.`} cta="✍️ Firmar la aprobación" onSigned={setData} />
        ) : <p className="no-print rounded-2xl border p-3 text-center text-xs" style={{ ...card, color: "var(--t-muted)" }}>La aprobación se firma después de aprobar la liquidación en RemHub.</p>
      ) : null}
      {!closed && pendingBens.length ? (
        <section className="no-print rounded-3xl border p-5" style={card}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-accent)" }}>Firma del beneficiario</p>
          <h2 className="text-lg font-extrabold">¿Quién va a firmar?</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingBens.map((l) => (
              <button key={l.beneficiary_id} type="button" onClick={() => setWho(l.beneficiary_id)} className="rounded-full border px-4 py-2 text-sm font-bold"
                style={who === l.beneficiary_id ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                👤 {l.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {!closed && chosen && !sig("beneficiary", chosen.beneficiary_id) ? (
        <SignForm key={chosen.beneficiary_id} token={token} role="beneficiary" beneficiary={chosen.beneficiary_id} defaultName={chosen.name} defaultDoc={chosen.document ?? ""} needDoc
          declaration={`Revisé la liquidación #${t.number} y estoy de acuerdo con lo que le corresponde a ${chosen.name}: ${cop(chosen.amount)}.`} cta={`✍️ Firmar por ${chosen.name}`}
          onSigned={(d) => { setData(d); setWho(""); }} />
      ) : null}
      {!data.can_sign_prepared && !data.can_sign_approved && (!sig("prepared") || !sig("approved")) && !closed ? (
        <p className="no-print rounded-2xl border p-3 text-center text-xs" style={{ ...card, color: "var(--t-muted)" }}>Quien preparó y quien aprobó firman abriendo este enlace con su sesión de RemHub.</p>
      ) : null}

      <button type="button" onClick={() => window.print()} className="no-print w-full rounded-2xl border px-4 py-3 text-sm font-bold" style={card}>🖨️ Imprimir o guardar en PDF</button>
      <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Cada firma queda guardada con fecha, hora, el dispositivo desde donde se firmó y una copia de los valores firmados.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:py-10" style={{ background: "var(--t-bg), var(--t-bg-base)", color: "var(--t-text)" }}>
      <style>{"@media print{.no-print{display:none!important}main{background:#fff!important;color:#000!important}}"}</style>
      <div className="mx-auto w-full max-w-2xl space-y-4">{children}</div>
    </main>
  );
}

function SignedBox({ title, sig }: { title: string; sig: Sig | null }) {
  return (
    <div className="rounded-3xl border p-4" style={card}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{title}</p>
      {sig ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sig.signature} alt={`Firma de ${sig.name}`} className="mt-2 h-24 w-full rounded-xl border bg-white object-contain" style={{ borderColor: "var(--t-card-border)" }} />
          <p className="mt-2 text-sm font-bold">{sig.name}</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>{sig.doc ? `Doc. ${sig.doc} · ` : ""}{when(sig.at)}</p>
        </>
      ) : <p className="mt-6 pb-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>⏳ Falta firmar</p>}
    </div>
  );
}

function SignForm({ token, role, beneficiary, defaultName, defaultDoc = "", needDoc, declaration, cta, onSigned }: {
  token: string; role: Role; beneficiary: string | null; defaultName: string; defaultDoc?: string; needDoc: boolean; declaration: string; cta: string; onSigned: (d: Data) => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(defaultName.toUpperCase());
  const [doc, setDoc] = useState(defaultDoc);
  const [agree, setAgree] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (name.trim().length < 3) return void Swal.fire({ icon: "warning", title: "Escribe el nombre completo" });
    if (needDoc && doc.replace(/[^0-9A-Za-z]/g, "").length < 5) return void Swal.fire({ icon: "warning", title: "Escribe la cédula o NIT" });
    if (!hasInk) return void Swal.fire({ icon: "warning", title: "Dibuja la firma en el recuadro" });
    if (!agree) return void Swal.fire({ icon: "warning", title: "Marca la casilla para confirmar" });
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("settlement_sign", {
      p_token: token, p_role: role, p_beneficiary: beneficiary, p_name: name.trim(), p_doc: doc.trim() || null, p_signature: padRef.current?.toDataUrl() ?? null, p_accept: agree,
    });
    setBusy(false);
    if (error) return void Swal.fire({ icon: "error", title: "No se pudo firmar", text: cleanError(error) });
    onSigned(data as Data);
    void Swal.fire({ icon: "success", title: "¡Firmado!", text: "La firma quedó guardada.", timer: 2000, showConfirmButton: false });
  }

  return (
    <section className="no-print rounded-3xl border-2 p-5" style={{ ...card, borderColor: "var(--t-accent)", boxShadow: "var(--t-shadow)" }}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-accent)" }}>{role === "prepared" ? "Quien preparó" : role === "approved" ? "Quien aprobó" : "Beneficiario"}</p>
      <h2 className="text-lg font-extrabold">✍️ Firma</h2>
      <div className="mt-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <input className={`${input} font-bold uppercase tracking-wide`} style={inputStyle} placeholder="NOMBRE COMPLETO *" autoComplete="name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={120} />
          <input className={input} style={inputStyle} placeholder={needDoc ? "Cédula o NIT *" : "Cédula (opcional)"} value={doc} onChange={(e) => setDoc(e.target.value)} maxLength={20} />
        </div>
        <SignaturePad ref={padRef} onChange={setHasInk} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" style={{ minHeight: 0, padding: 0 }} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{declaration}</span>
        </label>
        <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-2xl px-4 py-3 text-base font-bold transition disabled:opacity-60" style={{ background: "var(--t-cta)", color: "#fff" }}>
          {busy ? "Firmando…" : cta}
        </button>
      </div>
    </section>
  );
}
