"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Hoja de la cotización para el cliente (cualquiera con el enlace): imprimir o guardar en PDF. Sin costos. */

type Quote = {
  number: number; customer_name: string | null; customer_doc: string | null; items: Array<{ name: string; sku: string | null; image_url: string | null; qty: number; price: number }>;
  total: number; valid_until: string; status: string; note: string | null; created_at: string; created_by_name: string | null; expired: boolean;
  store: { name: string; logo_url: string | null; whatsapp: string | null }; point: { name: string; address: string | null } | null;
};

const money = (n: number) => `$ ${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const dmy = (v: string) => new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

export default function QuotePage() {
  const { token } = useParams<{ token: string }>();
  const [q, setQ] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void supabaseBrowser().rpc("erp_quote_public", { p_token: token }).then(({ data, error: e }) => {
      if (e || !data) setError("Esta cotización no existe o el enlace está incompleto.");
      else { setQ(data as Quote); document.title = `Cotización #${(data as Quote).number} · ${(data as Quote).store.name}`; }
    });
  }, [token]);
  if (error) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>🔒 {error}</p>;
  if (!q) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>Cargando cotización…</p>;
  const wa = (q.store.whatsapp ?? "").replace(/\D/g, "");
  const waLink = wa ? `https://wa.me/${wa.length === 10 ? `57${wa}` : wa}?text=${encodeURIComponent(`Hola! Quiero confirmar la cotización #${q.number} por ${money(q.total)}.`)}` : null;
  return (
    <div style={{ minHeight: "100vh", background: "#e5e7eb", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: "#111827" }}>
      <style>{`.theme-control{display:none!important}@media print{.no-print{display:none!important}body{background:#fff!important}.sheet{box-shadow:none!important;margin:0!important;max-width:none!important}@page{size:letter;margin:12mm}}`}</style>
      <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", padding: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => window.print()} style={{ padding: "8px 16px", borderRadius: 999, background: "#7c3aed", color: "#fff", fontWeight: 700, border: 0, cursor: "pointer" }}>🖨️ Imprimir / guardar PDF</button>
        {waLink && q.status === "open" && !q.expired ? <a href={waLink} target="_blank" rel="noreferrer" style={{ padding: "8px 16px", borderRadius: 999, background: "#16a34a", color: "#fff", fontWeight: 700, textDecoration: "none" }}>💬 Confirmar por WhatsApp</a> : null}
      </div>
      <div className="sheet" style={{ maxWidth: 820, margin: "0 auto 24px", background: "#fff", padding: 32, boxShadow: "0 8px 30px rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, borderBottom: "2px solid #111", paddingBottom: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {q.store.logo_url ? <img src={q.store.logo_url} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }} /> : null}
            <div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{q.store.name}</div>
              {q.point ? <div style={{ fontSize: 12, color: "#555" }}>{q.point.name}{q.point.address ? ` · ${q.point.address}` : ""}</div> : null}
              {wa ? <div style={{ fontSize: 12, color: "#555" }}>WhatsApp {q.store.whatsapp}</div> : null}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>Cotización #{q.number}</div>
            <div style={{ fontSize: 12, color: "#555" }}>{dmy(q.created_at)}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: q.expired ? "#dc2626" : "#111" }}>{q.status === "accepted" ? "✅ Aceptada" : q.status === "cancelled" ? "Anulada" : q.expired ? `Venció el ${dmy(q.valid_until)}` : `Válida hasta el ${dmy(q.valid_until)}`}</div>
          </div>
        </div>
        {q.customer_name ? <p style={{ margin: "14px 0 0", fontSize: 14 }}>Para: <b>{q.customer_name}</b>{q.customer_doc ? ` · ${q.customer_doc}` : ""}</p> : null}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #111", fontSize: 11, textTransform: "uppercase", color: "#555" }}>
            <th style={{ padding: "6px 4px" }}>Producto</th><th style={{ padding: "6px 4px", textAlign: "right" }}>Cant.</th><th style={{ padding: "6px 4px", textAlign: "right" }}>Precio</th><th style={{ padding: "6px 4px", textAlign: "right" }}>Subtotal</th>
          </tr></thead>
          <tbody>
            {q.items.map((i, k) => (
              <tr key={k} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 4px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {i.image_url ? <img src={i.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #eee" }} /> : null}
                    <div><b>{i.name}</b>{i.sku ? <div style={{ fontSize: 10, color: "#777" }}>Ref. {i.sku}</div> : null}</div>
                  </div>
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{i.qty}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{money(i.price)}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 700 }}>{money(i.qty * i.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Total {money(q.total)}</div>
        </div>
        {q.note ? <p style={{ marginTop: 12, fontSize: 13 }}><b>Nota:</b> {q.note}</p> : null}
        <p style={{ marginTop: 24, fontSize: 11, color: "#777" }}>Precios sujetos a disponibilidad de inventario. Cotización elaborada por {q.created_by_name ?? q.store.name}. Hecho con RemHub.</p>
      </div>
    </div>
  );
}
