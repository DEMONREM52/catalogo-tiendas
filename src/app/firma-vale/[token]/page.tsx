"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SignaturePad, type SignaturePadHandle } from "../../traslado/[token]/SignaturePad";
import { LOAN_EVERY, loanDeclaration, type LoanSignature, type LoanTerms } from "@/lib/loan-sign";

/**
 * Firma de un vale o préstamo a un empleado (20261262). El empleado abre el enlace, lee lo que recibe y la deuda,
 * acepta el descuento de nómina y firma. Quien entrega firma aquí mismo con su sesión de RemHub.
 */

type Role = LoanSignature["role"];
type Terms = LoanTerms;
type Sig = LoanSignature;
type Data = { ok: boolean; status: string; terms: Terms; notes: string | null; created_at: string; created_by_name: string | null; store: { name: string; logo_url: string | null } | null;
  can_sign_giver: boolean; actor_name: string | null; signatures: Sig[]; changed: boolean };

const cop = (v: unknown) => `$${Math.round(Number(v ?? 0)).toLocaleString("es-CO")}`;
const fdate = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const when = (iso: string) => new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const EVERY = LOAN_EVERY;
const card = { background: "var(--t-card-bg)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const input = "w-full rounded-xl border px-3 py-2.5 text-[15px] outline-none transition focus:ring-2 focus:ring-[color:var(--t-accent)]";
const inputStyle = { background: "var(--t-card-bg-soft)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const cleanError = (e: { message?: string }) => (/Could not find the function|schema cache/i.test(e.message ?? "") ? "Falta activar las firmas de vales en la tienda." : e.message ?? "No se pudo.");

export default function LoanSignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: d } = await supabaseBrowser().rpc("loan_sign_get", { p_token: token });
    setData((d as Data | null)?.ok ? (d as Data) : null);
    setLoading(false);
  }, [token]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  if (loading) return <Shell><div className="rounded-3xl border p-8 text-center" style={card}>Cargando el vale…</div></Shell>;
  if (!data) return (
    <Shell>
      <div className="rounded-3xl border p-8 text-center" style={card}>
        <p className="text-3xl">🔒</p>
        <p className="mt-2 text-lg font-bold">No se pudo abrir el vale</p>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>El enlace no es válido. Pídele a la tienda que te lo envíe de nuevo.</p>
      </div>
    </Shell>
  );

  const t = data.terms;
  const store = data.store?.name ?? "la empresa";
  const sig = (role: Role) => data.signatures.find((s) => s.role === role) ?? null;
  const done = !!sig("employee") && !!sig("giver");

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
            <h1 className="text-xl font-extrabold">{t.kind === "product" ? "Vale de mercancía" : "Préstamo"} #{t.number}</h1>
          </div>
          <span className="rounded-full px-3 py-1 text-xs font-bold" style={done ? { background: "#16a34a22", color: "#16a34a" } : { background: "#f59e0b22", color: "#b45309" }}>
            {data.status === "void" ? "Anulado" : done ? "✅ Firmado" : "Por firmar"}
          </span>
        </div>
        <p className="mt-3 text-sm"><b>Empleado:</b> {t.employee}{t.document ? ` · Doc. ${t.document}` : ""}</p>
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Entregado el {fdate(data.created_at.slice(0, 10))}{data.created_by_name ? ` por ${data.created_by_name}` : ""}</p>
      </header>

      <section className="rounded-3xl border p-5" style={card}>
        <h2 className="font-extrabold">{t.kind === "product" ? "🛍️ Lo que recibe" : "💵 Lo que recibe"}</h2>
        {t.kind === "product" ? (
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}><th className="py-1">Producto</th><th className="px-3 py-1 text-right">Cant.</th><th className="py-1 text-right">Valor</th></tr></thead>
            <tbody>
              {t.items.map((i, k) => (
                <tr key={k} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className="py-1.5 pr-2 [overflow-wrap:anywhere]">{i.name}<span className="block text-xs" style={{ color: "var(--t-muted)" }}>{cop(i.price)} c/u</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{i.qty}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{cop(i.qty * i.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-2 text-sm">Préstamo en dinero de <b>{cop(t.principal)}</b>.</p>}
        <div className="mt-3 space-y-1 rounded-2xl p-3 text-sm" style={{ background: "var(--t-card-bg-soft)" }}>
          {t.interest ? <p>Interés ({t.interest_pct} % {t.interest_mode === "monthly" ? "mensual" : "total"}): <b>{cop(t.interest)}</b></p> : null}
          <p className="text-base">Total que debe: <b>{cop(t.total)}</b></p>
          <p>Se descuenta de la nómina en <b>{t.installments} cuota{t.installments === 1 ? "" : "s"} de {cop(t.installment)}</b> {EVERY[t.pay_frequency]}, desde el {fdate(t.start_on)}.</p>
        </div>
        {data.notes ? <p className="mt-2 text-sm">📝 {data.notes}</p> : null}
      </section>

      {data.changed ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">⚠️ Este vale cambió después de firmarse. Las firmas anteriores quedaron guardadas, pero hay que firmar de nuevo con los valores de ahora.</p>
      ) : null}

      <section className="rounded-3xl border p-5 text-sm leading-relaxed" style={card}>
        <h2 className="mb-1 font-extrabold">📄 Reconocimiento de deuda y autorización de descuento</h2>
        <p>{loanDeclaration(t, store)}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <SignedBox title="Firma de quien recibe (empleado)" sig={sig("employee")} />
        <SignedBox title="Firma de quien entrega" sig={sig("giver")} />
      </div>

      {data.status !== "void" && !sig("employee") ? <SignForm token={token} role="employee" defaultName={t.employee} defaultDoc={t.document ?? ""} declaration={loanDeclaration(t, store)} onSigned={setData} /> : null}
      {data.status !== "void" && !sig("giver") ? (
        data.can_sign_giver ? <SignForm token={token} role="giver" defaultName={data.actor_name ?? ""} defaultDoc="" declaration={`Entregué ${t.kind === "product" ? "los productos" : "el dinero"} de este vale a ${t.employee}.`} onSigned={setData} />
          : <p className="no-print rounded-2xl border p-3 text-center text-xs" style={{ ...card, color: "var(--t-muted)" }}>Quien entrega firma desde su cuenta de RemHub.</p>
      ) : null}

      <button type="button" onClick={() => window.print()} className="no-print w-full rounded-2xl border px-4 py-3 text-sm font-bold" style={card}>🖨️ Imprimir o guardar en PDF</button>
      <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Cada firma queda guardada con fecha, hora y el dispositivo desde donde se firmó.</p>
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

function SignForm({ token, role, defaultName, defaultDoc, declaration, onSigned }: {
  token: string; role: Role; defaultName: string; defaultDoc: string; declaration: string; onSigned: (d: Data) => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(defaultName.toUpperCase());
  const [doc, setDoc] = useState(defaultDoc);
  const [agree, setAgree] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const employee = role === "employee";

  async function submit() {
    if (name.trim().length < 3) return void Swal.fire({ icon: "warning", title: "Escribe tu nombre completo" });
    if (employee && doc.replace(/\D/g, "").length < 5) return void Swal.fire({ icon: "warning", title: "Escribe tu número de cédula" });
    if (!hasInk) return void Swal.fire({ icon: "warning", title: "Dibuja tu firma en el recuadro" });
    if (!agree) return void Swal.fire({ icon: "warning", title: "Marca la casilla para confirmar" });
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("loan_sign", {
      p_token: token, p_role: role, p_name: name.trim(), p_doc: doc.trim() || null, p_signature: padRef.current?.toDataUrl() ?? null, p_accept: agree,
    });
    setBusy(false);
    if (error) return void Swal.fire({ icon: "error", title: "No se pudo firmar", text: cleanError(error) });
    onSigned(data as Data);
    void Swal.fire({ icon: "success", title: "¡Firmado!", text: employee ? "Tu firma quedó guardada. Puedes descargar el vale en PDF." : "Tu firma quedó guardada.", timer: 2200, showConfirmButton: false });
  }

  return (
    <section className="no-print rounded-3xl border-2 p-5" style={{ ...card, borderColor: "var(--t-accent)", boxShadow: "var(--t-shadow)" }}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-accent)" }}>{employee ? "Firma del empleado" : "Firma de quien entrega"}</p>
      <h2 className="text-lg font-extrabold">✍️ {employee ? "Recibo y acepto" : "Entregué"}</h2>
      <div className="mt-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <input className={`${input} font-bold uppercase tracking-wide`} style={inputStyle} placeholder="NOMBRE COMPLETO *" autoComplete="name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={120} />
          <input className={input} style={inputStyle} placeholder={employee ? "Cédula *" : "Cédula (opcional)"} inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} maxLength={20} />
        </div>
        <SignaturePad ref={padRef} onChange={setHasInk} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" style={{ minHeight: 0, padding: 0 }} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{employee ? <>Leí el <b>reconocimiento de deuda y autorización de descuento</b> de arriba y estoy de acuerdo.</> : declaration}</span>
        </label>
        <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-2xl px-4 py-3 text-base font-bold transition disabled:opacity-60" style={{ background: "var(--t-cta)", color: "#fff" }}>
          {busy ? "Firmando…" : employee ? "✍️ Firmar: recibo y acepto la deuda" : "✍️ Firmar como quien entrega"}
        </button>
      </div>
    </section>
  );
}
