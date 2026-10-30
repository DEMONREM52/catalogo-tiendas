"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SignaturePad, type SignaturePadHandle } from "@/app/traslado/[token]/SignaturePad";

/**
 * Firmas de un pedido interno sin iniciar sesión (20261276). Antes de que salga, los bodegueros firman
 * «Preparó» y «Revisó» aquí; cuando sale, esta misma página lleva al seguimiento del envío para «En camino» y «Recibió».
 */

type Step = "packed" | "sent" | "delivered" | "received";
type Sig = { step: Step; signer_name: string; signer_doc: string | null; signature: string | null; notes: string | null; via: "link" | "dashboard"; signed_at: string };
type Data = {
  number: number; status: "pending" | "preparing" | "dispatched" | "received" | "rejected" | "cancelled"; priority: string; note: string | null; needed_by: string | null;
  requested_by_name: string | null; handled_by_name: string | null; created_at: string; expires_at: string;
  store: { name: string; logo_url: string | null } | null; from: { name: string } | null; to: { name: string } | null;
  items: Array<{ name: string; image_url: string | null; sku: string | null; requested: number; approved: number | null; received: number | null; note: string | null }>;
  signatures: Sig[];
  transfer: { number: number; status: string; track_token: string | null } | null;
};

const STEPS: Array<{ key: Step; icon: string; title: string; who: string; declaration: string }> = [
  { key: "packed", icon: "📦", title: "Preparó", who: "Quien prepara el pedido", declaration: "Confirmo que preparé y empaqué la mercancía según el pedido." },
  { key: "sent", icon: "🔍", title: "Revisó", who: "Quien revisa lo preparado", declaration: "Confirmo que revisé la mercancía preparada y está completa." },
  { key: "delivered", icon: "🚚", title: "En camino", who: "Quien lleva la mercancía", declaration: "" },
  { key: "received", icon: "✅", title: "Recibió", who: "Quien recibe en destino", declaration: "" },
];
const STATUS: Record<Data["status"], [string, string, string]> = {
  pending: ["Esperando preparación", "#8b5cf6", "📨"], preparing: ["Preparando", "#f59e0b", "🧑‍🔧"], dispatched: ["En camino", "#0ea5e9", "🚚"],
  received: ["Recibido", "#22c55e", "✅"], rejected: ["Rechazado", "#ef4444", "⛔"], cancelled: ["Cancelado", "#94a3b8", "🚫"],
};
const NAME_KEY = "remhub_transfer_signer";
const card = { background: "var(--t-card-bg)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const inputCls = "w-full rounded-xl border px-3 py-2.5 text-[15px] outline-none transition focus:ring-2 focus:ring-[color:var(--t-accent)]";
const inputStyle = { background: "var(--t-card-bg-soft)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—");
const cleanError = (e: unknown) => {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "";
  return /Could not find the function|schema cache/i.test(m) ? "Las firmas por enlace aún no están activadas en esta tienda." : m || "Ocurrió un error. Intenta de nuevo.";
};

export default function SignRequestPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabaseBrowser().rpc("erp_sr_sign_link_get", { p_token: token });
    setLoading(false);
    if (e) return setError(cleanError(e));
    setError("");
    setData(d as Data);
  }, [token]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    // Al volver a la pestaña, por si otro ya firmó.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const signed = useMemo(() => new Map((data?.signatures ?? []).map((s) => [s.step, s])), [data]);
  const open = data?.status === "pending" || data?.status === "preparing";
  const next = open ? STEPS.slice(0, 2).find((s) => !signed.has(s.key)) ?? null : null;
  const track = data?.transfer?.track_token ?? null;
  const st = data ? STATUS[data.status] : null;
  const units = data?.items.reduce((s, i) => s + (i.approved ?? i.requested), 0) ?? 0;

  async function share() {
    const url = window.location.href;
    const text = `✍️ Firmas del pedido interno #${data?.number}: ${data?.to?.name ?? ""} → ${data?.from?.name ?? ""}. Abre el enlace y firma tu paso:`;
    try { if (navigator.share) return void (await navigator.share({ title: `Pedido interno #${data?.number}`, text, url })); } catch { return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:py-10" style={{ background: "var(--t-bg), var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {loading ? (
          <div className="rounded-3xl border p-8 text-center" style={card}><p className="animate-pulse text-3xl">✍️</p><p className="mt-2">Cargando pedido…</p></div>
        ) : error || !data ? (
          <div className="rounded-3xl border p-8 text-center" style={card}>
            <p className="text-4xl">🔒</p>
            <p className="mt-2 text-lg font-bold">No se pudo abrir el pedido</p>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{error || "El enlace no es válido."}</p>
          </div>
        ) : (
          <>
            {/* Encabezado */}
            <header className="overflow-hidden rounded-3xl border" style={{ ...card, boxShadow: "var(--t-shadow)" }}>
              <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${st![1]}, var(--t-accent))` }} />
              <div className="p-5">
                <div className="flex items-center gap-3">
                  {data.store?.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.store.logo_url} alt="" className="h-12 w-12 rounded-2xl object-cover" />
                  ) : <span className="grid h-12 w-12 place-items-center rounded-2xl text-2xl" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{data.store?.name ?? "RemHub"}</p>
                    <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
                      Pedido interno #{data.number}
                      {data.priority === "urgent" ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white">⚡ URGENTE</span> : null}
                    </h1>
                  </div>
                  <span className="shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white" style={{ background: st![1] }}>{st![2]} {st![0]}</span>
                </div>
                <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                    <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>🏬 Despacha</p>
                    <p className="font-bold leading-tight">{data.to?.name ?? "—"}</p>
                  </div>
                  <span className="text-2xl" aria-hidden>→</span>
                  <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                    <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>📍 Recibe</p>
                    <p className="font-bold leading-tight">{data.from?.name ?? "—"}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>
                  Pidió {data.requested_by_name ?? "—"} · {when(data.created_at)}
                  {data.needed_by ? ` · Para el ${new Date(`${data.needed_by}T12:00:00`).toLocaleDateString("es-CO")}` : ""}
                  {data.handled_by_name ? ` · Atiende ${data.handled_by_name}` : ""}
                </p>
                {data.note ? <p className="mt-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--t-card-bg-soft)" }}>📝 {data.note}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void share()} className="rounded-full border px-3.5 py-1.5 text-sm font-semibold" style={inputStyle}>🔗 Compartir enlace</button>
                  <button type="button" onClick={() => void load()} className="rounded-full border px-3.5 py-1.5 text-sm font-semibold" style={inputStyle}>↻ Actualizar</button>
                </div>
              </div>
            </header>

            {/* Recorrido de firmas */}
            <section className="rounded-3xl border p-5" style={card}>
              <h2 className="text-base font-bold">✍️ Firmas del recorrido</h2>
              <ol className="mt-4">
                {STEPS.map((s, i) => {
                  const sig = signed.get(s.key);
                  const isNext = next?.key === s.key || (!next && !sig && data.status === "dispatched" && STEPS.find((x) => !signed.has(x.key))?.key === s.key);
                  return (
                    <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
                      {i < STEPS.length - 1 ? <span className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-0.5" style={{ background: sig ? "#22c55e" : "var(--t-card-border)" }} /> : null}
                      <span className={`relative z-[1] grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg ${isNext ? "animate-pulse" : ""}`}
                        style={sig ? { background: "#22c55e", color: "#fff" } : isNext ? { background: "var(--t-accent)", color: "#fff" } : { background: "var(--t-card-bg-soft)" }}>
                        {sig ? "✓" : s.icon}
                      </span>
                      <div className="min-w-0 flex-1 pt-1">
                        <p className="font-bold">{i + 1}. {s.title} {isNext ? <span className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{ background: "var(--t-accent)" }}>AHORA</span> : null}</p>
                        {sig ? (
                          <>
                            <p className="text-sm font-black uppercase tracking-wide">{sig.signer_name}</p>
                            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{sig.signer_doc ? `CC ${sig.signer_doc} · ` : ""}{when(sig.signed_at)}{sig.via === "link" ? " · por enlace" : " · desde el panel"}</p>
                            {sig.notes ? <p className="text-xs">📝 {sig.notes}</p> : null}
                            {sig.signature ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={sig.signature} alt={`Firma de ${sig.signer_name}`} className="mt-1 h-12 w-auto rounded-lg border bg-white" style={{ borderColor: "var(--t-card-border)" }} />
                            ) : null}
                          </>
                        ) : <p className="text-xs" style={{ color: "var(--t-muted)" }}>{s.who}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Qué hacer ahora */}
            {next ? <SignForm key={next.key} token={token} step={next} onSigned={(d) => setData(d)} /> : null}
            {data.status === "dispatched" && track ? (
              <section className="rounded-3xl border-2 p-5 text-center" style={{ ...card, borderColor: "#0ea5e9" }}>
                <p className="text-4xl">🚚</p>
                <p className="mt-1 text-lg font-extrabold">El pedido ya salió{data.transfer ? ` (traslado #${data.transfer.number})` : ""}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>«En camino» y «Recibió» se firman en el seguimiento del envío, con el conteo de lo que llega.</p>
                <a href={`/traslado/${track}`} className="mt-4 inline-flex items-center gap-2 rounded-2xl px-5 py-3 font-bold text-white" style={{ background: "#0ea5e9" }}>Ir a firmar el envío →</a>
              </section>
            ) : null}
            {data.status === "received" ? (
              <section className="rounded-3xl border p-5 text-center" style={card}><p className="text-4xl">🎉</p><p className="mt-1 text-lg font-extrabold">Pedido recibido. ¡Gracias a todos!</p></section>
            ) : null}
            {data.status === "rejected" || data.status === "cancelled" ? (
              <section className="rounded-3xl border p-5 text-center" style={card}><p className="text-4xl">{st![2]}</p><p className="mt-1 font-bold">Este pedido fue {data.status === "rejected" ? "rechazado" : "cancelado"}: ya no hay nada que firmar.</p></section>
            ) : null}
            {open && !next ? (
              <section className="rounded-3xl border p-5 text-center" style={card}><p className="text-4xl">👍</p><p className="mt-1 font-bold">Preparó y Revisó ya están firmados.</p><p className="text-sm" style={{ color: "var(--t-muted)" }}>Cuando lo envíen, desde aquí mismo podrán firmar «En camino».</p></section>
            ) : null}

            {/* Productos */}
            <section className="rounded-3xl border p-5" style={card}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold">📦 Productos</h2>
                <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{data.items.length} referencias · {units} und.</span>
              </div>
              <ul className="mt-3 space-y-2">
                {data.items.map((it, k) => (
                  <li key={k} className="flex items-center gap-3 rounded-2xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
                    {it.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.image_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
                    ) : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-tight">{it.name}</p>
                      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{it.sku ? `${it.sku} · ` : ""}Pidió {it.requested}{it.received !== null ? ` · Llegó ${it.received}` : ""}</p>
                      {it.note ? <p className="text-[11px] font-semibold" style={{ color: "#a78bfa" }}>{it.note}</p> : null}
                    </div>
                    <span className="text-right">
                      <b className="block text-lg tabular-nums">{it.approved ?? it.requested}</b>
                      <span className="text-[10px] uppercase" style={{ color: "var(--t-muted)" }}>enviar</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <p className="pb-6 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Enlace válido hasta {when(data.expires_at)} · Hecho con RemHub</p>
          </>
        )}
      </div>
    </main>
  );
}

function SignForm({ token, step, onSigned }: { token: string; step: (typeof STEPS)[number]; onSigned: (d: Data) => void }) {
  const pad = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(() => { try { return (localStorage.getItem(NAME_KEY) ?? "").toUpperCase(); } catch { return ""; } });
  const [doc, setDoc] = useState("");
  const [notes, setNotes] = useState("");
  const [agree, setAgree] = useState(false);
  const [ink, setInk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (name.trim().length < 3) return void Swal.fire({ icon: "warning", title: "Escribe tu nombre completo" });
    if (!ink) return void Swal.fire({ icon: "warning", title: "Dibuja tu firma con el dedo" });
    if (!agree) return void Swal.fire({ icon: "warning", title: "Marca la casilla de confirmación" });
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_sr_sign_link_sign", {
      p_token: token, p_step: step.key, p_name: name.trim(), p_doc: doc.trim() || null, p_signature: pad.current?.toDataUrl() ?? null, p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) return void Swal.fire({ icon: "error", title: "No se pudo firmar", text: cleanError(error) });
    try { localStorage.setItem(NAME_KEY, name.trim().toUpperCase()); } catch { /* recordar el nombre es solo una comodidad */ }
    onSigned(data as Data);
    void Swal.fire({ icon: "success", title: `¡Firmaste «${step.title}»!`, text: step.key === "packed" ? "Ahora le toca a quien revisa: comparte este mismo enlace." : "Listo para enviar. Quien lo lleve firma «En camino» desde aquí.", confirmButtonText: "Listo" });
  }

  return (
    <section className="rounded-3xl border-2 p-5" style={{ ...card, borderColor: "var(--t-accent)", boxShadow: "var(--t-shadow)" }}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-accent)" }}>Tu turno</p>
      <h2 className="text-lg font-extrabold">{step.icon} Firmar: {step.title}</h2>
      <p className="text-sm" style={{ color: "var(--t-muted)" }}>{step.who}: escribe tu nombre y firma con el dedo.</p>
      <div className="mt-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <input className={`${inputCls} font-bold uppercase tracking-wide`} style={inputStyle} placeholder="NOMBRE COMPLETO *" autoComplete="name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={80} />
          <input className={inputCls} style={inputStyle} placeholder="Cédula (opcional)" inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} maxLength={30} />
        </div>
        <textarea className={inputCls} style={inputStyle} rows={2} maxLength={500} placeholder="Notas (opcional): cajas, novedades, faltantes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <SignaturePad ref={pad} onChange={setInk} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{step.declaration}</span>
        </label>
        <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-2xl px-4 py-3 text-base font-bold transition disabled:opacity-60" style={{ background: "var(--t-cta)", color: "#fff" }}>
          {busy ? "Firmando…" : `✍️ Firmar «${step.title}»`}
        </button>
      </div>
    </section>
  );
}
