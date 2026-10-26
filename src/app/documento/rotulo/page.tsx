"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PrinterChip } from "@/components/print/PrinterSetup";
import { rotuloEscpos, type Rotulo } from "@/lib/print/labels";
import { MODE_INFO, usePrinterSettings } from "@/lib/print/settings";
import { sendEscpos } from "@/lib/print/transports";
import { transferTrackUrl } from "@/lib/transfer-tracking";

/**
 * Rótulo de despacho para pegar en cada bulto de un traslado:
 *   /documento/rotulo?traslado=<id>
 * Para quién va (grande), de dónde sale, número, unidades, «Bulto N de M» y un QR con el seguimiento del
 * traslado: quien recibe lo escanea con el celular y confirma. Hoja carta (4 por hoja), 100×150 mm o térmica directa.
 */
export default function RotuloPage() {
  return <Suspense fallback={null}><RotuloView /></Suspense>;
}

const ddmm = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });

function RotuloView() {
  const search = useSearchParams();
  const [r, setR] = useState<Rotulo | null>(null);
  const [error, setError] = useState("");
  const [boxes, setBoxes] = useState(1);
  const [size, setSize] = useState<"guia" | "carta">("carta");
  const [qr, setQr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const printer = usePrinterSettings();
  const direct = MODE_INFO[printer.mode].escpos;

  useEffect(() => {
    void (async () => {
      const sb = supabaseBrowser();
      const { data: session } = await sb.auth.getSession();
      if (!session.session) return setError("Inicia sesión en tu tienda para imprimir el rótulo.");
      const id = search.get("traslado");
      if (!id) return setError("Falta el traslado.");
      const { data, error: e } = await sb.from("erp_transfers")
        .select("number,created_at,notes,track_token,store_id,from_warehouse_id,to_warehouse_id,erp_transfer_items(qty)")
        .eq("id", id).maybeSingle();
      if (e || !data) return setError("No se pudo abrir el traslado.");
      const t = data as { number: number; created_at: string; notes: string | null; track_token: string | null; store_id: string; from_warehouse_id: string; to_warehouse_id: string; erp_transfer_items: Array<{ qty: number }> };
      const [{ data: wh }, { data: store }] = await Promise.all([
        sb.from("erp_warehouses").select("id,name").in("id", [t.from_warehouse_id, t.to_warehouse_id]),
        sb.from("stores").select("name").eq("id", t.store_id).maybeSingle(),
      ]);
      const name = (wid: string) => (wh as Array<{ id: string; name: string }> | null)?.find((w) => w.id === wid)?.name ?? "—";
      const url = t.track_token ? transferTrackUrl(t.track_token) : null;
      setR({
        store: (store as { name: string } | null)?.name ?? "RemHub",
        number: t.number,
        date: ddmm(t.created_at),
        from: name(t.from_warehouse_id),
        to: name(t.to_warehouse_id),
        units: t.erp_transfer_items.reduce((s, i) => s + Number(i.qty || 0), 0),
        products: t.erp_transfer_items.length,
        notes: t.notes,
        url,
      });
      if (url) {
        const QR = (await import("qrcode")).default;
        setQr(await QR.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 360 }));
      }
    })();
  }, [search]);

  if (error) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>🔒 {error}</p>;
  if (!r) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>Preparando rótulo…</p>;

  async function printDirect() {
    if (!r) return;
    setSending(true);
    const res = await sendEscpos(rotuloEscpos(r, boxes, printer), printer);
    setSending(false);
    if (!res.ok) window.alert(`No se pudo imprimir directo: ${res.message ?? "error"}`);
  }

  const btn = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", borderRadius: 10, border: "1px solid #d1d5db", background: on ? "#111827" : "#fff", color: on ? "#fff" : "#111827", fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const n = Math.max(1, Math.min(99, boxes));

  return (
    <div style={{ minHeight: "100vh", background: "#e5e7eb", fontFamily: "system-ui, sans-serif", color: "#111827" }}>
      <style>{`
        .theme-control { display: none !important; }
        @media print {
          .no-print { display: none !important; }
          body, html { background: #fff !important; }
          @page { size: ${size === "guia" ? "100mm 150mm" : "letter"}; margin: ${size === "guia" ? "0" : "8mm"}; }
          .sheet { padding: 0 !important; background: #fff !important; }
          .rot { box-shadow: none !important; }
        }
        .rot { background: #fff; box-sizing: border-box; border: 2px solid #111827; border-radius: 4mm; padding: 5mm; display: flex; flex-direction: column; gap: 2.5mm; break-inside: avoid; page-break-inside: avoid; overflow: hidden; }
        .guia .rot { width: 100mm; height: 150mm; border-radius: 0; border: 0; }
        .guia .rot:not(:last-child) { page-break-after: always; break-after: page; }
        .carta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; width: 200mm; }
        .carta .rot { height: 125mm; }
        .rot .k { font-size: 9pt; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: .04em; }
        .rot .to { font-size: 24pt; font-weight: 900; line-height: 1.05; text-transform: uppercase; }
        .rot .box { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 3mm; border-top: 1.5px dashed #111827; padding-top: 3mm; }
        .rot .box b { font-size: 20pt; font-weight: 900; }
        .rot img { width: 32mm; height: 32mm; image-rendering: pixelated; }
      `}</style>
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center", padding: 12, background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Bultos{" "}
          <input type="number" min={1} max={99} value={boxes} onChange={(e) => setBoxes(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} style={{ width: 64, padding: 6, borderRadius: 8, border: "1px solid #d1d5db" }} />
        </label>
        <button type="button" style={btn(size === "carta")} onClick={() => setSize("carta")}>📄 Hoja carta</button>
        <button type="button" style={btn(size === "guia")} onClick={() => setSize("guia")}>🏷️ Guía 100×150 mm</button>
        <PrinterChip size="tirilla" />
        {direct ? (
          <button type="button" disabled={sending} onClick={() => void printDirect()} style={{ ...btn(true), background: "#16a34a", borderColor: "#16a34a" }}>⚡ {sending ? "Enviando…" : "Térmica"}</button>
        ) : null}
        <button type="button" onClick={() => window.print()} style={{ ...btn(true), background: "#7c3aed", borderColor: "#7c3aed" }}>🖨️ Imprimir {n}</button>
      </div>
      <div className="sheet" style={{ padding: 16, display: "flex", justifyContent: "center" }}>
        <div className={size} style={size === "guia" ? { display: "flex", flexDirection: "column", gap: 12 } : undefined}>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="rot" style={{ boxShadow: "0 1px 4px rgba(0,0,0,.15)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10pt", fontWeight: 800 }}><span>{r.store}</span><span>Traslado N.º {r.number}</span></div>
              <div><div className="k">Para</div><div className="to">{r.to}</div></div>
              <div><div className="k">De</div><div style={{ fontSize: "13pt", fontWeight: 800 }}>{r.from}</div></div>
              <div style={{ fontSize: "10pt" }}>{r.date} · {r.products} producto(s) · {r.units} unidad(es)</div>
              {r.notes ? <div style={{ fontSize: "9pt", color: "#374151" }}>Nota: {r.notes}</div> : null}
              <div className="box">
                <div><div className="k">Bulto</div><b>{i + 1} de {n}</b></div>
                {qr ? (
                  <div style={{ textAlign: "center", fontSize: "7pt", color: "#4b5563" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt="QR del traslado" />
                    <div>Escanea para ver y recibir</div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
