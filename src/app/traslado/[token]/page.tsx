"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TRANSFER_STEPS, transferTrackUrl, type TransferStep } from "@/lib/transfer-tracking";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

type Place = { name: string; address: string | null; phone: string | null; kind: "warehouse" | "point" } | null;
type Item = { product_id: string; name: string; image_url: string | null; qty: number; received_qty: number | null };
type Signature = {
  step: TransferStep; signer_name: string; signer_doc: string | null; signature: string | null;
  notes: string | null; via: "link" | "dashboard"; signed_at: string;
};
type Track = {
  number: number; status: "in_transit" | "received" | "cancelled"; expired: boolean; expires_at: string;
  created_at: string; created_by_name: string | null; checked_by_name: string | null; carrier_name: string | null;
  notes: string | null; received_at: string | null; received_notes: string | null;
  store: { name: string; logo_url: string | null } | null; from: Place; to: Place;
  items: Item[]; signatures: Signature[];
};

const NAME_KEY = "remhub_transfer_signer";

const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";

const cleanError = (error: unknown) => {
  const msg = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (/Could not find the function|schema cache/i.test(msg)) return "El seguimiento de traslados aún no está activado en esta tienda.";
  return msg || "Ocurrió un error. Intenta de nuevo.";
};

const card = { background: "var(--t-card-bg)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;
const input =
  "w-full rounded-xl border px-3 py-2.5 text-[15px] outline-none transition focus:ring-2 focus:ring-[color:var(--t-accent)]";
const inputStyle = { background: "var(--t-card-bg-soft)", borderColor: "var(--t-card-border)", color: "var(--t-text)" } as const;

export default function TransferTrackPage() {
  const { token } = useParams<{ token: string }>();
  const [track, setTrack] = useState<Track | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    () =>
      supabaseBrowser()
        .rpc("erp_transfer_track", { p_token: token })
        .then(({ data, error }) => {
          setLoading(false);
          if (error) return setLoadError(cleanError(error));
          setLoadError("");
          setTrack(data as Track);
        }),
    [token],
  );

  useEffect(() => {
    void load();
    // Al volver a la pestaña se actualiza por si otro responsable ya firmó.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const signed = useMemo(() => new Map((track?.signatures ?? []).map((s) => [s.step, s])), [track]);
  const nextStep = track?.status === "in_transit" ? TRANSFER_STEPS.find((s) => !signed.has(s.key)) ?? null : null;
  const toName = track?.to?.name ?? "el destino";

  async function share() {
    const url = transferTrackUrl(token);
    const text = `Traslado #${track?.number}: ${track?.from?.name ?? ""} → ${toName}. Firma tu paso aquí:`;
    try {
      if (navigator.share) return void (await navigator.share({ title: `Traslado #${track?.number}`, text, url }));
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      void Swal.fire({ icon: "success", title: "Enlace copiado", timer: 1400, showConfirmButton: false });
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank");
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:py-10" style={{ background: "var(--t-bg), var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {loading ? (
          <div className="rounded-3xl border p-8 text-center" style={card}>Cargando traslado…</div>
        ) : loadError || !track ? (
          <div className="rounded-3xl border p-8 text-center" style={card}>
            <p className="text-3xl">🔒</p>
            <p className="mt-2 text-lg font-bold">No se pudo abrir el traslado</p>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{loadError || "El enlace no es válido."}</p>
          </div>
        ) : (
          <>
            <header className="rounded-3xl border p-5" style={{ ...card, boxShadow: "var(--t-shadow)" }}>
              <div className="flex items-center gap-3">
                {track.store?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={track.store.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{track.store?.name ?? "RemHub"}</p>
                  <h1 className="text-xl font-extrabold">Traslado #{track.number}</h1>
                </div>
                <StatusBadge track={track} />
              </div>

              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <PlaceBox label="Sale de" place={track.from} />
                <span className="text-xl" aria-hidden>→</span>
                <PlaceBox label="Llega a" place={track.to} />
              </div>

              <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>
                Creado {dateTime(track.created_at)}{track.created_by_name ? ` por ${track.created_by_name}` : ""}
                {track.checked_by_name ? ` · Revisó: ${track.checked_by_name}` : ""}
                {track.carrier_name ? ` · Traslada: ${track.carrier_name}` : ""}
              </p>
              {track.notes ? <p className="mt-1 text-sm">📝 {track.notes}</p> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void share()} className="rounded-full border px-3.5 py-1.5 text-sm font-semibold" style={inputStyle}>
                  🔗 Compartir enlace
                </button>
                <button type="button" onClick={() => void load()} className="rounded-full border px-3.5 py-1.5 text-sm font-semibold" style={inputStyle}>
                  ↻ Actualizar
                </button>
              </div>
            </header>

            <section className="rounded-3xl border p-5" style={card}>
              <h2 className="text-base font-bold">Recorrido</h2>
              <ol className="mt-4 space-y-0">
                {TRANSFER_STEPS.map((step, index) => {
                  const sig = signed.get(step.key);
                  const isNext = nextStep?.key === step.key;
                  const last = index === TRANSFER_STEPS.length - 1;
                  return (
                    <li key={step.key} className="relative flex gap-3 pb-5">
                      {!last ? (
                        <span className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-0.5" style={{ background: sig ? "var(--t-accent)" : "var(--t-card-border)" }} />
                      ) : null}
                      <span
                        className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-lg"
                        style={
                          sig
                            ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))", borderColor: "transparent" }
                            : isNext
                              ? { borderColor: "var(--t-accent)", background: "var(--t-card-bg-soft)" }
                              : { borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)", opacity: 0.6 }
                        }
                      >
                        {sig ? "✓" : step.icon}
                      </span>
                      <div className="min-w-0 flex-1 pt-1.5">
                        <p className="font-bold" style={{ opacity: sig || isNext ? 1 : 0.6 }}>
                          {index + 1}. {step.title}
                          {isNext ? <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "var(--t-accent)", color: "#fff" }}>Pendiente</span> : null}
                        </p>
                        {sig ? (
                          <div className="mt-1 text-sm">
                            <p>
                              <b>{sig.signer_name}</b>
                              {sig.signer_doc ? <span style={{ color: "var(--t-muted)" }}> · CC {sig.signer_doc}</span> : null}
                            </p>
                            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                              {dateTime(sig.signed_at)}{sig.via === "dashboard" ? " · desde el panel" : ""}
                            </p>
                            {sig.notes ? <p className="mt-1 text-xs">📝 {sig.notes}</p> : null}
                            {sig.signature ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={sig.signature} alt={`Firma de ${sig.signer_name}`} className="mt-2 h-16 w-auto rounded-lg border bg-white" style={{ borderColor: "var(--t-card-border)" }} />
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-xs" style={{ color: "var(--t-muted)" }}>{step.who}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {nextStep && !track.expired ? (
              <SignForm key={nextStep.key} token={token} track={track} step={nextStep} toName={toName} onSigned={setTrack} />
            ) : null}
            {track.status === "in_transit" && track.expired ? (
              <div className="rounded-3xl border p-5 text-center text-sm" style={card}>
                ⏰ Este enlace venció el {dateTime(track.expires_at)}. Pide a la tienda que lo renueve.
              </div>
            ) : null}

            <section className="rounded-3xl border p-5" style={card}>
              <h2 className="text-base font-bold">Mercancía ({track.items.reduce((s, i) => s + i.qty, 0)} unidades)</h2>
              <ul className="mt-3 divide-y" style={{ borderColor: "var(--t-card-border)" }}>
                {track.items.map((item) => (
                  <li key={item.product_id} className="flex items-center gap-3 py-2.5" style={{ borderColor: "var(--t-card-border)" }}>
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>
                    )}
                    <span className="min-w-0 flex-1 text-sm font-semibold">{item.name}</span>
                    <span className="text-right text-sm">
                      <b>{item.qty}</b> und.
                      {item.received_qty !== null ? (
                        <span className="block text-xs" style={{ color: item.received_qty < item.qty ? "#ef4444" : "var(--t-muted)" }}>
                          llegaron {item.received_qty}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {track.received_notes ? <p className="mt-2 text-sm">📝 Recepción: {track.received_notes}</p> : null}
            </section>

            <p className="pb-6 text-center text-xs" style={{ color: "var(--t-muted)" }}>
              Enlace válido hasta {dateTime(track.expires_at)}. Compártelo solo con los responsables del traslado.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ track }: { track: Track }) {
  const [label, color] =
    track.status === "received" ? ["Recibido", "#22c55e"] : track.status === "cancelled" ? ["Anulado", "#ef4444"] : ["En tránsito", "#f59e0b"];
  return (
    <span className="shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold" style={{ color, borderColor: color }}>
      {label}
    </span>
  );
}

function PlaceBox({ label, place }: { label: string; place: Place }) {
  return (
    <div className="min-w-0 rounded-2xl p-3" style={{ background: "var(--t-card-bg-soft)" }}>
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
      <p className="truncate font-bold">{place?.kind === "point" ? "📍" : "🏬"} {place?.name ?? "—"}</p>
      {place?.address ? <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{place.address}</p> : null}
      {place?.phone ? (
        <a href={`tel:${place.phone}`} className="text-xs font-semibold underline">{place.phone}</a>
      ) : null}
    </div>
  );
}

function SignForm({
  token, track, step, toName, onSigned,
}: {
  token: string; track: Track; step: (typeof TRANSFER_STEPS)[number]; toName: string; onSigned: (t: Track) => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [doc, setDoc] = useState("");
  const [notes, setNotes] = useState("");
  const [agree, setAgree] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(track.items.map((i) => [i.product_id, i.qty])));
  const isReceive = step.key === "received";
  const missing = isReceive ? track.items.reduce((s, i) => s + (i.qty - (counts[i.product_id] ?? i.qty)), 0) : 0;

  async function submit() {
    if (name.trim().length < 2) return void Swal.fire({ icon: "warning", title: "Escribe tu nombre completo" });
    if (!hasInk) return void Swal.fire({ icon: "warning", title: "Dibuja tu firma" });
    if (!agree) return void Swal.fire({ icon: "warning", title: "Marca la casilla de confirmación" });
    if (missing > 0 && !notes.trim()) return void Swal.fire({ icon: "warning", title: "Explica el faltante en las notas" });

    const ask = await Swal.fire({
      icon: "question",
      title: `Firmar "${step.title}"`,
      html: isReceive
        ? `Se sumará la mercancía al inventario de <b>${toName}</b>${missing > 0 ? ` y <b>${missing}</b> unidad(es) faltantes volverán al origen` : ""}. Esta acción no se puede deshacer.`
        : "Tu firma quedará registrada con fecha y hora.",
      showCancelButton: true,
      confirmButtonText: "Firmar",
      cancelButtonText: "Revisar",
    });
    if (!ask.isConfirmed) return;

    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_transfer_track_sign", {
      p_token: token,
      p_step: step.key,
      p_name: name.trim(),
      p_doc: doc.trim() || null,
      p_signature: padRef.current?.toDataUrl() ?? null,
      p_notes: notes.trim() || null,
      p_items: isReceive ? track.items.map((i) => ({ product_id: i.product_id, received_qty: counts[i.product_id] ?? i.qty })) : null,
    });
    setBusy(false);
    if (error) return void Swal.fire({ icon: "error", title: "No se pudo firmar", text: cleanError(error) });
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      /* el nombre recordado es solo una comodidad */
    }
    onSigned(data as Track);
    void Swal.fire({ icon: "success", title: "¡Firmado!", text: isReceive ? "Traslado recibido y sumado al inventario." : "Comparte el enlace con el siguiente responsable.", timer: 2200, showConfirmButton: false });
  }

  return (
    <section className="rounded-3xl border-2 p-5" style={{ ...card, borderColor: "var(--t-accent)", boxShadow: "var(--t-shadow)" }}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-accent)" }}>Tu turno</p>
      <h2 className="text-lg font-extrabold">{step.icon} Firmar: {step.title}</h2>
      <p className="text-sm" style={{ color: "var(--t-muted)" }}>{step.who} escribe su nombre y firma.</p>

      <div className="mt-4 space-y-3">
        {isReceive ? (
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-sm font-bold">Cuenta lo que llegó</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Si falta algo, baja la cantidad. Lo que no llegó vuelve al origen.</p>
            <div className="mt-2 space-y-2">
              {track.items.map((i) => (
                <label key={i.product_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1">{i.name} <span style={{ color: "var(--t-muted)" }}>(enviadas {i.qty})</span></span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={i.qty}
                    className={`${input} w-24 text-center`}
                    style={inputStyle}
                    value={counts[i.product_id] ?? i.qty}
                    onChange={(e) =>
                      setCounts({ ...counts, [i.product_id]: Math.min(i.qty, Math.max(0, Math.floor(Number(e.target.value) || 0))) })
                    }
                  />
                </label>
              ))}
            </div>
            {missing > 0 ? <p className="mt-2 text-sm font-semibold" style={{ color: "#ef4444" }}>Faltan {missing} unidad(es).</p> : null}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <input className={input} style={inputStyle} placeholder="Nombre completo *" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <input className={input} style={inputStyle} placeholder="Cédula (opcional)" inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} maxLength={30} />
        </div>
        <textarea
          className={input}
          style={inputStyle}
          rows={2}
          maxLength={500}
          placeholder={missing > 0 ? "Explica el faltante *" : "Notas (opcional): novedades, estado de las cajas, placa del vehículo…"}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <SignaturePad ref={padRef} onChange={setHasInk} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{step.declaration(toName)}</span>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="w-full rounded-2xl px-4 py-3 text-base font-bold transition disabled:opacity-60"
          style={{ background: "var(--t-cta)", color: "#fff" }}
        >
          {busy ? "Firmando…" : `✍️ Firmar ${step.title.toLowerCase()}`}
        </button>
      </div>
    </section>
  );
}
