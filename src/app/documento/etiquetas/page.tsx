"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PrinterChip } from "@/components/print/PrinterSetup";
import { labelsEscpos, type CodeKind } from "@/lib/print/labels";
import { MODE_INFO, usePrinterSettings } from "@/lib/print/settings";
import { sendEscpos } from "@/lib/print/transports";

/**
 * Etiquetas con código de barras y precio para imprimir.
 *   /documento/etiquetas?traslado=<id>   → productos y unidades del traslado; precio del punto que recibe
 *   /documento/etiquetas?ingreso=<id>    → productos y unidades de una factura de compra
 *   /documento/etiquetas?productos=a,b   → un producto por etiqueta
 * Se elige el punto (sus reglas de precio), el precio (1 a 5), una etiqueta por unidad o por producto, el tamaño
 * y si lleva código de barras o QR. Con una térmica conectada directo se imprime sin la ventana del navegador.
 */

type Prod = { id: string; name: string; sku: string | null; barcode: string | null; prices: number[] };
type Item = { product_id: string; qty: number };
type Point = { id: string; name: string };

const money = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");

export default function LabelsPage() {
  return <Suspense fallback={null}><Labels /></Suspense>;
}

function Labels() {
  const search = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<Map<string, Prod>>(new Map());
  const [points, setPoints] = useState<Point[]>([]);
  const [point, setPoint] = useState("");
  const [pointPrices, setPointPrices] = useState<Map<string, number[]>>(new Map());
  const [level, setLevel] = useState(3);
  const [perUnit, setPerUnit] = useState(true);
  const [size, setSize] = useState<"rollo" | "carta">("rollo");
  const [showName, setShowName] = useState(true);
  const [codeKind, setCodeKind] = useState<CodeKind>("barcode");
  const [sending, setSending] = useState(false);
  const printer = usePrinterSettings();
  const direct = MODE_INFO[printer.mode].escpos;
  const [error, setError] = useState("");
  const [storeId, setStoreId] = useState("");

  useEffect(() => {
    void (async () => {
      const sb = supabaseBrowser();
      const { data: session } = await sb.auth.getSession();
      if (!session.session) return setError("Inicia sesión en tu tienda para imprimir etiquetas.");
      const transferId = search.get("traslado");
      const purchaseId = search.get("ingreso");
      let list: Item[] = [];
      let defaultPoint = "";
      if (transferId) {
        const { data, error: e } = await sb.from("erp_transfers").select("store_id,to_warehouse_id,erp_transfer_items(product_id,qty)").eq("id", transferId).maybeSingle();
        if (e || !data) return setError("No se pudo abrir el traslado.");
        const t = data as { store_id: string; to_warehouse_id: string; erp_transfer_items: Item[] };
        list = t.erp_transfer_items;
        defaultPoint = t.to_warehouse_id;
        setStoreId(t.store_id);
      } else if (purchaseId) {
        const { data, error: e } = await sb.from("erp_purchases").select("store_id,erp_purchase_items(product_id,qty)").eq("id", purchaseId).maybeSingle();
        if (e || !data) return setError("No se pudo abrir la factura de compra.");
        const p = data as { store_id: string; erp_purchase_items: Item[] };
        list = p.erp_purchase_items;
        setStoreId(p.store_id);
      } else {
        list = (search.get("productos") ?? "").split(",").filter(Boolean).map((id) => ({ product_id: id, qty: 1 }));
      }
      // Suma el mismo producto repetido (una factura puede traerlo en varias líneas).
      const merged = new Map<string, number>();
      for (const it of list) merged.set(it.product_id, (merged.get(it.product_id) ?? 0) + Number(it.qty || 0));
      const ids = [...merged.keys()];
      if (!ids.length) return setError("No hay productos para las etiquetas.");
      const map = new Map<string, Prod>();
      let sid = "";
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await sb.from("products").select("id,store_id,name,sku,barcode,price_1,price_2,price_3,price_4,price_5").in("id", ids.slice(i, i + 200));
        for (const p of (data ?? []) as Array<{ id: string; store_id: string; name: string; sku: string | null; barcode: string | null; price_1: number; price_2: number; price_3: number; price_4: number; price_5: number }>) {
          sid = p.store_id;
          map.set(p.id, { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, prices: [p.price_1, p.price_2, p.price_3, p.price_4, p.price_5].map((v) => Number(v ?? 0)) });
        }
      }
      if (!map.size) return setError("No tienes permiso para ver estos productos.");
      setStoreId((cur) => cur || sid);
      setItems(ids.map((id) => ({ product_id: id, qty: Math.max(1, Math.round(merged.get(id) ?? 1)) })));
      setProducts(map);
      const { data: wh } = await sb.from("erp_warehouses").select("id,name").eq("store_id", sid).eq("active", true).order("name");
      setPoints((wh ?? []) as Point[]);
      setPoint(defaultPoint);
    })();
  }, [search]);

  // Reglas de precio del punto elegido (las mismas del POS de ese punto).
  useEffect(() => {
    if (!storeId || !point) { const t = window.setTimeout(() => setPointPrices(new Map()), 0); return () => window.clearTimeout(t); }
    let alive = true;
    void (async () => {
      const out = new Map<string, number[]>();
      for (let from = 0; ; from += 1000) {
        const { data, error: e } = await supabaseBrowser().rpc("erp_point_prices", { p_store: storeId, p_point: point }).range(from, from + 999);
        if (e || !Array.isArray(data)) break;
        for (const r of data as Array<{ product_id: string; price_1: number; price_2: number; price_3: number; price_4: number; price_5: number }>) {
          out.set(r.product_id, [r.price_1, r.price_2, r.price_3, r.price_4, r.price_5].map((v) => Number(v ?? 0)));
        }
        if (data.length < 1000) break;
      }
      if (alive) setPointPrices(out);
    })();
    return () => { alive = false; };
  }, [storeId, point]);

  const labels = useMemo(() => items.flatMap((it) => {
    const p = products.get(it.product_id);
    if (!p) return [];
    const price = (pointPrices.get(p.id) ?? p.prices)[level - 1] ?? 0;
    const one = { key: p.id, name: p.name, code: (p.barcode || p.sku || "").trim(), sku: p.sku, price };
    return Array.from({ length: perUnit ? Math.min(it.qty, 500) : 1 }, (_, i) => ({ ...one, key: `${p.id}-${i}` }));
  }), [items, products, pointPrices, level, perUnit]);

  if (error) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>🔒 {error}</p>;
  if (!products.size) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>Preparando etiquetas…</p>;

  const missing = labels.filter((l) => !l.code).length;
  async function printDirect() {
    setSending(true);
    const r = await sendEscpos(labelsEscpos(labels, printer, { code: codeKind, showName }), printer);
    setSending(false);
    if (!r.ok) window.alert(`No se pudo imprimir directo: ${r.message ?? "error"}`);
  }
  const btn = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", borderRadius: 10, border: "1px solid #d1d5db", background: on ? "#111827" : "#fff", color: on ? "#fff" : "#111827", fontWeight: 600, fontSize: 13, cursor: "pointer" });

  return (
    <div style={{ minHeight: "100vh", background: "#e5e7eb", fontFamily: "system-ui, sans-serif", color: "#111827" }}>
      <style>{`
        /* El botón flotante de tema no va en las etiquetas (ni en pantalla ni impreso). */
        .theme-control { display: none !important; }
        @media print {
          .no-print { display: none !important; }
          .theme-control, .theme-control * { display: none !important; visibility: hidden !important; }
          body, html { background: #fff !important; }
          @page { size: ${size === "rollo" ? "50mm 25mm" : "letter"}; margin: ${size === "rollo" ? "0" : "8mm"}; }
          .sheet { padding: 0 !important; background: #fff !important; box-shadow: none !important; display: block !important; }
          .rollo { display: block !important; gap: 0 !important; }
          .rollo .lbl { box-shadow: none !important; margin: 0 !important; }
          .carta { width: auto !important; padding: 0 !important; }
        }
        .lbl { break-inside: avoid; page-break-inside: avoid; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: #fff; }
        .rollo .lbl { width: 50mm; height: 25mm; box-sizing: border-box; padding: 1.2mm 1.5mm; gap: 0.4mm; }
        .rollo .lbl:not(:last-child) { page-break-after: always; break-after: page; }
        .lbl .nm { font-size: 7.5pt; font-weight: 700; line-height: 1.1; max-height: 2.2em; overflow: hidden; width: 100%; }
        .lbl .pr { font-size: 12pt; font-weight: 900; line-height: 1; }
        .carta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
        .carta .lbl { height: 25mm; border: 1px dashed #d1d5db; padding: 1.5mm; }
        .lbl svg { display: block; max-width: 100%; height: 11mm; flex-shrink: 0; }
        .lbl .qr { display: flex; align-items: center; gap: 1.2mm; font-size: 6.5pt; }
        .lbl .qr img { width: 12mm; height: 12mm; image-rendering: pixelated; }
      `}</style>
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center", padding: 12, background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Precios de{" "}
          <select value={point} onChange={(e) => setPoint(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
            <option value="">La tienda (sin reglas de punto)</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Precio{" "}
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))} style={{ padding: 6, borderRadius: 8 }}>
            {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Precio {l}{l === 2 ? " (por mayor)" : l === 3 ? " (detal)" : ""}</option>)}
          </select>
        </label>
        <button type="button" style={btn(perUnit)} onClick={() => setPerUnit(true)}>Una por unidad</button>
        <button type="button" style={btn(!perUnit)} onClick={() => setPerUnit(false)}>Una por producto</button>
        <button type="button" style={btn(size === "rollo")} onClick={() => setSize("rollo")}>🏷️ Rollo 50×25 mm</button>
        <button type="button" style={btn(size === "carta")} onClick={() => setSize("carta")}>📄 Hoja carta</button>
        <button type="button" style={btn(showName)} onClick={() => setShowName((v) => !v)}>{showName ? "✓ " : ""}Nombre</button>
        <button type="button" style={btn(codeKind === "barcode")} onClick={() => setCodeKind("barcode")}>▥ Barras</button>
        <button type="button" style={btn(codeKind === "qr")} onClick={() => setCodeKind("qr")}>▦ QR</button>
        <PrinterChip size="tirilla" />
        {direct ? (
          <button type="button" disabled={sending} onClick={() => void printDirect()} style={{ ...btn(true), background: "#16a34a", borderColor: "#16a34a" }} title="A la térmica conectada, sin ventana">⚡ {sending ? "Enviando…" : `Térmica ${labels.length}`}</button>
        ) : null}
        <button type="button" onClick={() => window.print()} style={{ ...btn(true), background: "#7c3aed", borderColor: "#7c3aed" }}>🖨️ Imprimir {labels.length}</button>
        {missing ? <span style={{ width: "100%", textAlign: "center", fontSize: 12, color: "#b45309" }}>⚠️ {missing} etiqueta(s) sin código de barras ni referencia: salen solo con nombre y precio.</span> : null}
      </div>
      <div className="sheet" style={{ padding: 16, display: "flex", justifyContent: "center" }}>
        <div className={size} style={size === "carta" ? { width: "200mm", background: "#fff", padding: "6mm" } : { display: "flex", flexDirection: "column", gap: 8 }}>
          {labels.map((l) => (
            <div key={l.key} className="lbl" style={size === "rollo" ? { boxShadow: "0 1px 3px rgba(0,0,0,.15)" } : undefined}>
              {showName ? <div className="nm">{l.name}</div> : null}
              {l.code ? (codeKind === "qr" ? <QrCode value={l.code} /> : <Barcode value={l.code} />) : null}
              <div className="pr">{money(l.price)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** QR con el código del producto (lo leen los lectores 2D y la cámara del celular). */
function QrCode({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode").then((m) => m.default.toDataURL(value, { errorCorrectionLevel: "M", margin: 0, width: 160 })).then((u) => { if (alive) setSrc(u); }, () => undefined);
    return () => { alive = false; };
  }, [value]);
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="qr">{src ? <img src={src} alt="" /> : null}<span>{value}</span></div>;
}

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", displayValue: true, fontSize: 9, height: 28, width: 1.3, margin: 0, textMargin: 0 });
    } catch {
      ref.current.innerHTML = "";
    }
  }, [value]);
  return <svg ref={ref} />;
}
