"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TRANSFER_STEPS, type TransferStep } from "@/lib/transfer-tracking";
import { useListPricesState } from "@/lib/print/list-prices";
import { MovementDocument, PrintToolbar, type DocSignature } from "@/components/print/MovementDocument";

type Place = { name: string; address: string | null; phone: string | null } | null;
type Track = {
  number: number; status: "in_transit" | "received" | "cancelled"; created_at: string; created_by_name: string | null;
  checked_by_name: string | null; carrier_name: string | null; notes: string | null; received_at: string | null; received_notes: string | null;
  store: { name: string; logo_url: string | null } | null; from: Place; to: Place;
  items: Array<{ product_id: string; name: string; qty: number; received_qty: number | null }>;
  signatures: Array<{ step: TransferStep; signer_name: string; signer_doc: string | null; signature: string | null; signed_at: string }>;
};
type Linked = { number: number; requested_by_name: string | null; items: Array<{ product_id: string; requested: number }> } | null;

const STATUS: Record<Track["status"], string> = { in_transit: "En tránsito", received: "Recibido", cancelled: "Anulado" };
const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "");

/** Hoja imprimible del traslado: carta o tirilla, con o sin precios por mayor (solo con sesión). */
export default function TransferPrintPage() {
  return <Suspense fallback={null}><TransferPrint /></Suspense>;
}

function TransferPrint() {
  const { token } = useParams<{ token: string }>();
  const search = useSearchParams();
  const [track, setTrack] = useState<Track | null>(null);
  const [linked, setLinked] = useState<Linked>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState<"carta" | "tirilla">(search.get("formato") === "tirilla" ? "tirilla" : "carta");
  const [showPrices, setShowPrices] = useState(search.get("precios") !== "0");
  const [showRetail, setShowRetail] = useState(false);

  useEffect(() => {
    void Promise.all([
      supabaseBrowser().rpc("erp_transfer_track", { p_token: token }),
      supabaseBrowser().rpc("erp_transfer_track_request", { p_token: token }),
    ]).then(([t, r]) => {
      if (t.error || !t.data) return setError("No se pudo abrir el traslado (el enlace no es válido o venció).");
      setTrack(t.data as Track);
      setLinked(r.error ? null : ((r.data as Linked) ?? null));
    });
  }, [token]);

  const { prices, reason: pricesReason } = useListPricesState(track?.items.map((i) => i.product_id) ?? []);
  const received = Boolean(track?.items.some((i) => i.received_qty !== null));
  const requested = useMemo(() => new Map((linked?.items ?? []).map((i) => [i.product_id, i.requested])), [linked]);

  // Al abrir con ?auto=1 se imprime solo cuando todo cargó.
  useEffect(() => {
    if (!track || search.get("auto") !== "1") return;
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, [track, prices, search]);

  if (error) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>🔒 {error}</p>;
  if (!track) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>Preparando el documento…</p>;

  const signed = new Map(track.signatures.map((s) => [s.step, s]));
  const signatures: DocSignature[] = TRANSFER_STEPS.map((s) => {
    const sig = signed.get(s.key);
    return { title: s.title, who: s.who, name: sig?.signer_name, doc: sig?.signer_doc, image: sig?.signature, at: sig?.signed_at };
  });
  const extraLabels = [...(linked ? ["Pidió"] : []), ...(received ? ["Recibido"] : [])];

  return (
    <div style={{ minHeight: "100vh", background: "#e5e7eb" }}>
      <PrintToolbar format={format} onFormat={setFormat} showPrices={showPrices} onShowPrices={setShowPrices} pricesAvailable={Boolean(prices)} pricesReason={pricesReason}
        showRetail={showRetail} onShowRetail={setShowRetail} backHref={`/traslado/${token}`} />
      <div style={{ padding: "16px 0" }}>
        <MovementDocument
          kind="Traslado"
          number={track.number}
          status={STATUS[track.status] ?? track.status}
          store={track.store}
          from={track.from}
          to={track.to}
          meta={[
            ["Fecha", dt(track.created_at)],
            ["Creó", track.created_by_name ?? ""],
            ["Revisó", track.checked_by_name ?? ""],
            ["Transporta", track.carrier_name ?? ""],
            ["Fecha de recibido", dt(track.received_at)],
            ["Pedido interno", linked ? `#${linked.number}${linked.requested_by_name ? ` · pidió ${linked.requested_by_name}` : ""}` : ""],
          ]}
          qtyLabel="Enviado"
          extraLabels={extraLabels}
          items={track.items.map((i) => ({
            key: i.product_id, name: i.name, sku: prices?.get(i.product_id)?.sku ?? null, qty: i.qty,
            extra: [...(linked ? [requested.get(i.product_id) ?? null] : []), ...(received ? [i.received_qty] : [])],
            price2: prices?.get(i.product_id)?.price2 ?? null, price3: prices?.get(i.product_id)?.price3 ?? null,
          }))}
          showPrices={Boolean(prices) && showPrices}
          showRetail={showRetail}
          notes={[["Observaciones", track.notes ?? ""], ["Novedades al recibir", track.received_notes ?? ""]]}
          signatures={signatures}
          qrUrl={typeof window !== "undefined" ? `${window.location.origin}/traslado/${token}` : null}
          format={format}
        />
      </div>
    </div>
  );
}
