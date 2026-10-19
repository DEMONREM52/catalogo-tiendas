"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect } from "react";
import { cop } from "@/lib/print/list-prices";

/**
 * Nombre de la pestaña = nombre del PDF al guardar: «TRASLADO #6 · Bodega principal → SEDE PIONEROS · 19-10-2026».
 * Sin «/» ni otros caracteres que Windows no acepta en un nombre de archivo.
 */
function useDocumentTitle(kind: string, number: number | string, from: DocPlace, to: DocPlace) {
  useEffect(() => {
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    const d = new Date();
    const date = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    const route = [from?.name, to?.name].filter(Boolean).map((n) => clean(String(n))).join(" → ");
    const previous = document.title;
    document.title = [`${clean(kind).toUpperCase()} #${number}`, route, date].filter(Boolean).join(" · ");
    return () => { document.title = previous; };
  }, [kind, number, from?.name, to?.name]);
}

/**
 * Hoja imprimible de un movimiento de mercancía (traslado o pedido interno), en carta o tirilla de 80 mm.
 * Siempre en blanco y negro (no depende del tema del panel) para que se imprima bien en cualquier impresora.
 */
export type DocPlace = { name: string; address?: string | null; phone?: string | null } | null;
export type DocItem = {
  key: string; name: string; sku?: string | null;
  qty: number;
  /** Columnas extra de cantidades (ej. «Pidió», «Recibido»). */
  extra?: Array<number | null>;
  price2?: number | null;
  price3?: number | null;
};
export type DocSignature = { title: string; who: string; name?: string | null; doc?: string | null; image?: string | null; at?: string | null };

export type MovementDocProps = {
  kind: string;
  number: number | string;
  status: string;
  store: { name: string; logo_url?: string | null } | null;
  from: DocPlace;
  to: DocPlace;
  fromLabel?: string;
  toLabel?: string;
  meta: Array<[string, string]>;
  qtyLabel: string;
  extraLabels?: string[];
  items: DocItem[];
  showPrices: boolean;
  showRetail?: boolean;
  notes?: Array<[string, string]>;
  signatures: DocSignature[];
  qrUrl?: string | null;
  format: "carta" | "tirilla";
};

/** QR de una dirección: en el subdominio de la tienda va completa; si no, la ruta en remhub.co. */
function qrSrc(abs: string | null | undefined) {
  if (!abs) return null;
  try {
    const u = new URL(abs);
    const q: Record<string, string> = u.hostname.endsWith(".remhub.co") ? { url: u.toString() } : { path: u.pathname + u.search };
    return `/api/qr?${new URLSearchParams({ ...q, format: "svg", size: "256" }).toString()}`;
  } catch {
    return null;
  }
}

const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "");

export function MovementDocument(p: MovementDocProps) {
  useDocumentTitle(p.kind, p.number, p.from, p.to);
  const units = p.items.reduce((s, i) => s + i.qty, 0);
  const value = p.items.reduce((s, i) => s + i.qty * Number(i.price2 ?? 0), 0);
  const retail = p.items.reduce((s, i) => s + i.qty * Number(i.price3 ?? 0), 0);
  const narrow = p.format === "tirilla";
  const qr = qrSrc(p.qrUrl);

  return (
    <article className={`movement-doc ${narrow ? "doc-tirilla" : "doc-carta"}`}>
      <style>{`
        .movement-doc { background:#fff; color:#111; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; margin:0 auto; }
        .doc-carta { width: 100%; max-width: 820px; padding: 28px 32px; font-size: 12.5px; }
        .doc-tirilla { width: 76mm; padding: 4mm 3mm; font-size: 11px; }
        .movement-doc table { width:100%; border-collapse: collapse; }
        .movement-doc th { text-align:left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color:#555; border-bottom: 1.5px solid #111; padding: 6px 4px; }
        .movement-doc td { border-bottom: 1px solid #ddd; padding: 6px 4px; vertical-align: top; }
        .movement-doc .num { text-align:right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .movement-doc .muted { color:#666; }
        .movement-doc .box { border:1px solid #ccc; border-radius: 8px; padding: 8px 10px; }
        .movement-doc .sig { border-top: 1px solid #111; padding-top: 4px; min-height: 64px; }
        .doc-tirilla th, .doc-tirilla td { padding: 3px 1px; }
        /* El botón flotante de tema no va en los documentos. */
        .theme-control { display: none !important; }
        @media print {
          @page { size: ${narrow ? "80mm auto" : "letter"}; margin: ${narrow ? "2mm" : "12mm"}; }
          body { background:#fff !important; }
          .no-print { display:none !important; }
          .doc-carta { padding: 0; max-width: none; }
          .movement-doc tr { break-inside: avoid; }
        }
      `}</style>

      <header style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #111", paddingBottom: 10 }}>
        {p.store?.logo_url ? <img src={p.store.logo_url} alt="" style={{ height: narrow ? 34 : 52, width: narrow ? 34 : 52, objectFit: "cover", borderRadius: 8 }} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: narrow ? 13 : 17, textTransform: "uppercase" }}>{p.store?.name ?? "RemHub"}</div>
          <div className="muted" style={{ fontSize: narrow ? 10 : 11.5 }}>Documento interno · no es factura de venta</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 900, fontSize: narrow ? 14 : 20 }}>{p.kind} #{p.number}</div>
          <div style={{ fontSize: 11, fontWeight: 700, border: "1px solid #111", borderRadius: 999, padding: "1px 8px", display: "inline-block", marginTop: 2 }}>{p.status}</div>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 8, marginTop: 10 }}>
        {[[p.fromLabel ?? "Sale de", p.from], [p.toLabel ?? "Llega a", p.to]].map(([label, place]) => {
          const pl = place as DocPlace;
          return (
            <div key={String(label)} className="box">
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{String(label)}</div>
              <div style={{ fontWeight: 800, fontSize: narrow ? 12 : 14 }}>{pl?.name ?? "—"}</div>
              {pl?.address ? <div className="muted">{pl.address}</div> : null}
              {pl?.phone ? <div className="muted">Tel. {pl.phone}</div> : null}
            </div>
          );
        })}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(3, 1fr)", gap: "2px 16px", marginTop: 8 }}>
        {p.meta.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><span className="muted">{k}: </span><b style={{ textTransform: k.startsWith("Fecha") ? "none" : "uppercase" }}>{v}</b></div>
        ))}
      </section>

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            {narrow ? null : <th style={{ width: 24 }}>#</th>}
            <th>Producto</th>
            {(p.extraLabels ?? []).map((l) => <th key={l} className="num">{l}</th>)}
            <th className="num">{p.qtyLabel}</th>
            {p.showPrices ? <th className="num">P. mayor</th> : null}
            {p.showPrices && p.showRetail && !narrow ? <th className="num">P. detal</th> : null}
            {p.showPrices ? <th className="num">Subtotal</th> : null}
          </tr>
        </thead>
        <tbody>
          {p.items.map((i, idx) => (
            <tr key={i.key}>
              {narrow ? null : <td className="muted">{idx + 1}</td>}
              <td>
                <div style={{ fontWeight: 700 }}>{i.name}</div>
                {i.sku ? <div className="muted" style={{ fontSize: 10 }}>Ref. {i.sku}</div> : null}
              </td>
              {(i.extra ?? []).map((x, k) => <td key={k} className="num">{x ?? "—"}</td>)}
              <td className="num" style={{ fontWeight: 800 }}>{i.qty}</td>
              {p.showPrices ? <td className="num">{i.price2 ? cop(i.price2) : "—"}</td> : null}
              {p.showPrices && p.showRetail && !narrow ? <td className="num muted">{i.price3 ? cop(i.price3) : "—"}</td> : null}
              {p.showPrices ? <td className="num" style={{ fontWeight: 700 }}>{i.price2 ? cop(i.qty * i.price2) : "—"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <section style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <div className="box" style={{ minWidth: narrow ? "100%" : 280 }}>
          <Row k="Referencias" v={String(p.items.length)} />
          <Row k="Unidades" v={units.toLocaleString("es-CO")} />
          {p.showPrices ? <Row k="Valor a precio por mayor" v={cop(value)} strong /> : null}
          {p.showPrices && p.showRetail ? <Row k="Valor a precio detal" v={cop(retail)} /> : null}
        </div>
      </section>

      {p.notes?.filter(([, v]) => v).map(([k, v]) => (
        <p key={k} style={{ marginTop: 8 }}><b>{k}:</b> {v}</p>
      ))}

      <section style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginTop: narrow ? 14 : 26 }}>
        {p.signatures.map((s) => (
          <div key={s.title}>
            <div style={{ height: narrow ? 38 : 56, display: "flex", alignItems: "flex-end" }}>
              {s.image ? <img src={s.image} alt={`Firma ${s.title}`} style={{ maxHeight: narrow ? 38 : 56, maxWidth: "100%" }} /> : null}
            </div>
            <div className="sig">
              <div style={{ fontWeight: 800, fontSize: 11, textTransform: "uppercase" }}>{s.name || " "}</div>
              {s.doc ? <div className="muted" style={{ fontSize: 10 }}>CC {s.doc}</div> : null}
              <div className="muted" style={{ fontSize: 10 }}>{s.title} · {s.who}</div>
              {s.at ? <div className="muted" style={{ fontSize: 9.5 }}>{dt(s.at)}</div> : null}
            </div>
          </div>
        ))}
      </section>

      <footer style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, borderTop: "1px solid #ccc", paddingTop: 8 }}>
        {qr ? <img src={qr} alt="QR del seguimiento" style={{ height: narrow ? 64 : 76, width: narrow ? 64 : 76 }} /> : null}
        <div className="muted" style={{ fontSize: 10, flex: 1 }}>
          {qr ? <>Escanea el código para ver el seguimiento y las firmas en línea.<br /></> : null}
          Impreso el {dt(new Date().toISOString())} · Generado con RemHub
        </div>
      </footer>
    </article>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0", fontWeight: strong ? 900 : 500, fontSize: strong ? 14 : undefined }}>
      <span className={strong ? "" : "muted"}>{k}</span><span className="num">{v}</span>
    </div>
  );
}

/** Barra de opciones de impresión (no sale en la hoja). */
export function PrintToolbar({ format, onFormat, showPrices, onShowPrices, pricesAvailable, pricesReason, showRetail, onShowRetail, backHref }: {
  format: "carta" | "tirilla"; onFormat: (f: "carta" | "tirilla") => void;
  showPrices: boolean; onShowPrices: (v: boolean) => void; pricesAvailable: boolean;
  /** Por qué no hay precios (para decirlo claro en la barra). */
  pricesReason?: "loading" | "ok" | "no_session" | "denied";
  showRetail: boolean; onShowRetail: (v: boolean) => void; backHref?: string;
}) {
  const btn = (active: boolean) => ({
    border: "1px solid #ccc", borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 700,
    background: active ? "#111" : "#fff", color: active ? "#fff" : "#111", cursor: "pointer",
  } as const);
  return (
    <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 10, background: "#f4f4f5", borderBottom: "1px solid #ddd", padding: "10px 12px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
      {backHref ? <a href={backHref} style={{ ...btn(false), textDecoration: "none" }}>← Volver</a> : null}
      <button type="button" style={btn(format === "carta")} onClick={() => onFormat("carta")}>📄 Carta</button>
      <button type="button" style={btn(format === "tirilla")} onClick={() => onFormat("tirilla")}>🧾 Tirilla 80 mm</button>
      {pricesAvailable ? (
        <>
          <button type="button" style={btn(showPrices)} onClick={() => onShowPrices(!showPrices)}>{showPrices ? "💲 Con precios" : "🚫 Sin precios"}</button>
          {showPrices ? <button type="button" style={btn(showRetail)} onClick={() => onShowRetail(!showRetail)}>{showRetail ? "✓ " : ""}Ver también precio detal</button> : null}
        </>
      ) : (
        <span style={{ fontSize: 12.5, color: "#b45309", fontWeight: 700, maxWidth: 520 }}>
          {pricesReason === "loading" ? "Cargando precios…"
            : pricesReason === "denied" ? "⚠️ Tu usuario no puede ver los precios de estos productos."
            : <>⚠️ Sin precios: aquí no hay sesión iniciada ({typeof window !== "undefined" ? window.location.host : ""}). <Link href="/login" style={{ color: "#7c3aed" }}>Inicia sesión</Link> y vuelve a abrir esta hoja.</>}
        </span>
      )}
      <button type="button" style={{ ...btn(true), background: "#7c3aed", borderColor: "#7c3aed" }} onClick={() => window.print()}>🖨️ Imprimir</button>
    </div>
  );
}
