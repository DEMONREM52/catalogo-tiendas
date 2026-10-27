"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { CatalogPayload, CategoryRow, ProductRow } from "@/app/[slug]/[mode]/catalog-data";

/**
 * Catálogo en PDF para mandar por WhatsApp o imprimir:
 *   /documento/catalogo?tienda=<slug>&catalogo=<catálogo>[&key=<clave del catálogo privado>]
 * Usa los mismos datos y precios del catálogo público (el de ese punto o lista). «Guardar como PDF» en la ventana de impresión.
 */
export default function CatalogPdfPage() {
  return <Suspense fallback={null}><CatalogPdf /></Suspense>;
}

type Ok = Extract<CatalogPayload, { status: "ok" }>;
const money = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO");

function CatalogPdf() {
  const search = useSearchParams();
  const slug = search.get("tienda") ?? "";
  const mode = search.get("catalogo") ?? "";
  const key = search.get("key");
  const [payload, setPayload] = useState<Ok | null>(null);
  const [items, setItems] = useState<ProductRow[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("Preparando catálogo…");
  const [cols, setCols] = useState(3);
  const [group, setGroup] = useState(true);
  const [onlyStock, setOnlyStock] = useState(true);
  const [wholesale, setWholesale] = useState(false);
  const [desc, setDesc] = useState(false);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [withQr, setWithQr] = useState(true);

  useEffect(() => {
    void (async () => {
      const sb = supabaseBrowser();
      const { data, error: e } = await sb.rpc("catalog_public", { p_store: slug, p_catalog: mode, p_key: key });
      const p = (e ? null : data) as CatalogPayload | null;
      if (!p || p.status !== "ok") return setError(p?.status === "locked" ? "Ese catálogo es privado: abre el enlace con su clave." : "No se encontró el catálogo.");
      setPayload(p);
      const all: ProductRow[] = [];
      for (let offset = 0; offset < 3000; offset += 100) {
        setProgress(`Cargando productos… ${all.length}`);
        const { data: page, error: pe } = await sb.rpc("catalog_public_products", { p_store: p.store.slug, p_catalog: p.catalog.slug, p_key: key, p_category: null, p_q: null, p_limit: 100, p_offset: offset });
        if (pe) break;
        const rows = ((page as { items?: ProductRow[] } | null)?.items ?? []);
        all.push(...rows);
        if (rows.length < 100) break;
      }
      setItems(all);
    })();
  }, [slug, mode, key]);

  // QR de cada producto (lleva a su página para pedirlo por WhatsApp).
  useEffect(() => {
    if (!payload || !withQr || !items.length) return;
    let alive = true;
    void (async () => {
      const QR = (await import("qrcode")).default;
      const out: Record<string, string> = {};
      for (const p of items) {
        out[p.id] = await QR.toDataURL(`${window.location.origin}/${payload.store.slug}/producto/${p.id}`, { margin: 0, width: 120, errorCorrectionLevel: "L" });
      }
      if (alive) setQr(out);
    })();
    return () => { alive = false; };
  }, [payload, items, withQr]);

  const shown = useMemo(() => items.filter((p) => p.active !== false && (!onlyStock || p.stock === null || Number(p.stock) > 0)), [items, onlyStock]);
  const sections = useMemo(() => {
    if (!group || !payload) return [{ title: "", rows: shown }];
    const byCat = new Map<string, ProductRow[]>();
    for (const p of shown) byCat.set(p.category_id ?? "", [...(byCat.get(p.category_id ?? "") ?? []), p]);
    const cats: CategoryRow[] = [...payload.categories].sort((a, b) => a.sort_order - b.sort_order);
    return [...cats.map((c) => ({ title: c.name, rows: byCat.get(c.id) ?? [] })), { title: "Otros", rows: byCat.get("") ?? [] }].filter((s) => s.rows.length);
  }, [shown, group, payload]);

  if (error) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>🔒 {error}</p>;
  if (!payload || !items.length) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>{progress}</p>;

  const st = payload.store;
  const btn = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", borderRadius: 10, border: "1px solid #d1d5db", background: on ? "#111827" : "#fff", color: on ? "#fff" : "#111827", fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const today = new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div style={{ minHeight: "100vh", background: "#e5e7eb", fontFamily: "system-ui, sans-serif", color: "#111827" }}>
      <style>{`
        .theme-control { display: none !important; }
        @media print {
          .no-print { display: none !important; }
          body, html { background: #fff !important; }
          @page { size: letter; margin: 10mm; }
          .paper { box-shadow: none !important; padding: 0 !important; width: auto !important; }
        }
        .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 4mm; }
        .card { break-inside: avoid; page-break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 3mm; padding: 2.5mm; display: flex; flex-direction: column; gap: 1.5mm; }
        .card img.photo { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 2mm; background: #f3f4f6; }
        .card .nm { font-size: ${cols >= 4 ? 8 : 9.5}pt; font-weight: 700; line-height: 1.15; }
        .card .ds { font-size: 7.5pt; color: #4b5563; line-height: 1.2; max-height: 3.6em; overflow: hidden; }
        .card .pr { font-size: ${cols >= 4 ? 11 : 13}pt; font-weight: 900; }
        .card .row { display: flex; align-items: flex-end; justify-content: space-between; gap: 2mm; margin-top: auto; }
        .card .qr { width: 13mm; height: 13mm; image-rendering: pixelated; }
        h2.cat { font-size: 13pt; margin: 6mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 2px solid #111827; break-after: avoid; }
      `}</style>
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center", padding: 12, background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
        {[2, 3, 4].map((c) => <button key={c} type="button" style={btn(cols === c)} onClick={() => setCols(c)}>{c} por fila</button>)}
        <button type="button" style={btn(group)} onClick={() => setGroup((v) => !v)}>{group ? "✓ " : ""}Por categoría</button>
        <button type="button" style={btn(onlyStock)} onClick={() => setOnlyStock((v) => !v)}>{onlyStock ? "✓ " : ""}Solo disponibles</button>
        <button type="button" style={btn(wholesale)} onClick={() => setWholesale((v) => !v)}>{wholesale ? "✓ " : ""}Precio por mayor</button>
        <button type="button" style={btn(desc)} onClick={() => setDesc((v) => !v)}>{desc ? "✓ " : ""}Descripción</button>
        <button type="button" style={btn(withQr)} onClick={() => setWithQr((v) => !v)}>{withQr ? "✓ " : ""}QR</button>
        <button type="button" onClick={() => window.print()} style={{ ...btn(true), background: "#7c3aed", borderColor: "#7c3aed" }}>📄 Guardar PDF / imprimir ({shown.length})</button>
        <span style={{ width: "100%", textAlign: "center", fontSize: 12, color: "#6b7280" }}>En la ventana de impresión elige «Guardar como PDF» y mándalo por WhatsApp.</span>
      </div>
      <div style={{ padding: 16, display: "flex", justifyContent: "center" }}>
        <div className="paper" style={{ width: "205mm", background: "#fff", padding: "10mm", boxShadow: "0 1px 4px rgba(0,0,0,.15)" }}>
          <header style={{ display: "flex", alignItems: "center", gap: "4mm", borderBottom: "1px solid #e5e7eb", paddingBottom: "4mm" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {payload.catalog.logo_url || st.logo_url ? <img src={payload.catalog.logo_url || st.logo_url || ""} alt="" style={{ width: "18mm", height: "18mm", objectFit: "contain" }} /> : null}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "18pt", fontWeight: 900 }}>{st.name}</div>
              <div style={{ fontSize: "10pt", color: "#4b5563" }}>{payload.catalog.name} · Precios al {today}{st.whatsapp ? ` · Pedidos por WhatsApp ${st.whatsapp}` : ""}</div>
            </div>
          </header>
          {sections.map((s) => (
            <section key={s.title || "all"}>
              {s.title ? <h2 className="cat">{s.title}</h2> : <div style={{ height: "4mm" }} />}
              <div className="grid">
                {s.rows.map((p) => {
                  const price = wholesale && Number(p.price_wholesale) > 0 ? p.price_wholesale : p.price_retail;
                  return (
                    <div key={p.id} className="card">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.image_url ? <img className="photo" src={p.image_url} alt="" loading="eager" /> : <div className="photo" style={{ aspectRatio: 1, background: "#f3f4f6", borderRadius: "2mm" }} />}
                      <div className="nm">{p.name}</div>
                      {desc && p.description ? <div className="ds">{p.description}</div> : null}
                      <div className="row">
                        <div>
                          <div className="pr">{money(price)}</div>
                          {wholesale && p.min_wholesale ? <div style={{ fontSize: "7pt", color: "#6b7280" }}>desde {p.min_wholesale} und.</div> : null}
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {withQr && qr[p.id] ? <img className="qr" src={qr[p.id]} alt="" /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <footer style={{ marginTop: "6mm", fontSize: "8pt", color: "#6b7280", textAlign: "center" }}>Precios sujetos a cambio y a disponibilidad. Escanea el QR de un producto para pedirlo.</footer>
        </div>
      </div>
    </div>
  );
}
