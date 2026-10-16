"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { useListPricesState } from "@/lib/print/list-prices";
import { MovementDocument, PrintToolbar, type DocSignature } from "@/components/print/MovementDocument";
import { SR_STATUS, type SrDetail } from "@/app/dashboard/pedidos/internos/types";
import { SIGN_STEPS } from "@/app/dashboard/pedidos/internos/RequestSignatures";

const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "");

/** Hoja imprimible de un pedido interno (con sesión): qué se pidió, qué se envió, qué llegó, precios por mayor y firmas. */
export default function RequestPrintPage() {
  return <Suspense fallback={null}><RequestPrint /></Suspense>;
}

function RequestPrint() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [data, setData] = useState<SrDetail | null>(null);
  const [store, setStore] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState<"carta" | "tirilla">(search.get("formato") === "tirilla" ? "tirilla" : "carta");
  const [showPrices, setShowPrices] = useState(search.get("precios") !== "0");
  const [showRetail, setShowRetail] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: session } = await supabaseBrowser().auth.getSession();
      if (!session.session) return setError("Inicia sesión en la tienda para imprimir este pedido.");
      const [{ data: res, error: err }, access] = await Promise.all([
        supabaseBrowser().rpc("erp_stock_request_detail", { p_request: id }),
        getDashboardStore().catch(() => null),
      ]);
      if (err || !res) return setError(err?.message ?? "No se encontró el pedido.");
      setData(res as SrDetail);
      if (access?.store) setStore({ name: access.store.name, logo_url: access.store.logo_url });
    })();
  }, [id]);

  const { prices, reason: pricesReason } = useListPricesState(data?.items.map((i) => i.product_id) ?? []);

  useEffect(() => {
    if (!data || search.get("auto") !== "1") return;
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, [data, prices, search]);

  if (error) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>🔒 {error}</p>;
  if (!data) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>Preparando el documento…</p>;

  const r = data.request;
  const sent = data.items.some((i) => i.qty_approved !== null);
  const received = data.items.some((i) => i.qty_received !== null);
  const signed = new Map((data.signatures ?? []).map((s) => [s.step, s]));
  const signatures: DocSignature[] = SIGN_STEPS.map((s) => {
    const sig = signed.get(s.key);
    return { title: s.title, who: s.who, name: sig?.signer_name, doc: sig?.signer_doc, image: sig?.signature, at: sig?.signed_at };
  });
  const extraLabels = sent ? ["Pidió", ...(received ? ["Recibido"] : [])] : [];

  return (
    <div style={{ minHeight: "100vh", background: "#e5e7eb" }}>
      <PrintToolbar format={format} onFormat={setFormat} showPrices={showPrices} onShowPrices={setShowPrices} pricesAvailable={Boolean(prices)} pricesReason={pricesReason}
        showRetail={showRetail} onShowRetail={setShowRetail} backHref={`/dashboard/pedidos/internos?pedido=${r.id}`} />
      <div style={{ padding: "16px 0" }}>
        <MovementDocument
          kind="Pedido interno"
          number={r.number}
          status={`${SR_STATUS[r.status]?.short ?? r.status}${r.priority === "urgent" ? " · URGENTE" : ""}`}
          store={store}
          // La mercancía sale de quien atiende y llega a quien pidió.
          fromLabel="Despacha"
          from={{ name: r.to_name }}
          toLabel="Pidió / recibe"
          to={{ name: r.from_name }}
          meta={[
            ["Fecha", dt(r.created_at)],
            ["Pidió", r.requested_by_name ?? ""],
            ["Atendió", r.handled_by_name ?? ""],
            ["Para el", r.needed_by ? new Date(`${r.needed_by}T12:00:00`).toLocaleDateString("es-CO") : ""],
            ["Traslado", data.transfer ? `#${data.transfer.number}` : ""],
            ["Transporta", data.transfer?.carrier_name ?? ""],
          ]}
          qtyLabel={sent ? "Enviado" : "Pedido"}
          extraLabels={extraLabels}
          items={data.items.map((i) => ({
            key: i.id, name: i.name, sku: i.sku ?? prices?.get(i.product_id)?.sku ?? null,
            qty: sent ? i.qty_approved ?? 0 : i.qty_requested,
            extra: sent ? [i.qty_requested, ...(received ? [i.qty_received] : [])] : [],
            price2: prices?.get(i.product_id)?.price2 ?? null, price3: prices?.get(i.product_id)?.price3 ?? null,
          }))}
          showPrices={Boolean(prices) && showPrices}
          showRetail={showRetail}
          notes={[["Nota del pedido", r.note ?? ""], ["Motivo de cierre", r.close_reason ?? ""]]}
          signatures={signatures}
          qrUrl={data.transfer?.track_token && typeof window !== "undefined" ? `${window.location.origin}/traslado/${data.transfer.track_token}` : null}
          format={format}
        />
      </div>
    </div>
  );
}
