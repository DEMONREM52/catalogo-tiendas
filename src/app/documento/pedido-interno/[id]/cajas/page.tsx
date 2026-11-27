"use client";
/* eslint-disable @next/next/no-img-element */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { qrMatrix, qrPath } from "@/lib/labels/codes";
import { SR_STATUS, type SrDetail, type SrItem } from "@/app/dashboard/pedidos/internos/types";
import { boxUnits, distribution, distributionText, type SrBox, type SrBoxes } from "@/app/dashboard/pedidos/internos/boxes";

type Format = "carta" | "pos80" | "pos58";
type What = "todo" | "cajas" | "sin-caja" | "consolidado" | "etiquetas";

const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
/** El QR de una caja solo lleva un enlace con su código: los datos se ven con sesión y permisos. */
const boxUrl = (token: string) => `${window.location.origin}/dashboard/pedidos?tab=internos&caja=${token}`;

function Qr({ text, size }: { text: string; size: string }) {
  const svg = useMemo(() => {
    const m = qrMatrix(text, "M");
    const n = m.size + 4;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="100%" height="100%" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(m, 2)}" fill="#000"/></svg>`;
  }, [text]);
  return <span style={{ display: "inline-block", width: size, height: size, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Hoja de cajas de un pedido interno (con sesión): contenido de cada caja, lo que va sin caja, consolidado y etiquetas con QR. */
export default function BoxesPrintPage() {
  return <Suspense fallback={null}><BoxesPrint /></Suspense>;
}

function BoxesPrint() {
  const { id } = useParams<{ id: string }>();
  const q = useSearchParams();
  const [data, setData] = useState<SrDetail | null>(null);
  const [boxes, setBoxes] = useState<SrBox[] | null>(null);
  const [store, setStore] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState<Format>(() => (["carta", "pos80", "pos58"].includes(q.get("formato") ?? "") ? (q.get("formato") as Format) : "carta"));
  const what: What = (["todo", "cajas", "sin-caja", "consolidado", "etiquetas"].includes(q.get("que") ?? "") ? q.get("que") : "todo") as What;
  const photos = q.get("fotos") !== "0" && format === "carta";
  const withQr = q.get("qr") !== "0";
  const pagePerBox = q.get("pagina") === "1";
  const signatures = q.get("firmas") !== "0";
  const only = (q.get("cajas") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);

  useEffect(() => {
    void (async () => {
      const { data: session } = await supabaseBrowser().auth.getSession();
      if (!session.session) return setError("Inicia sesión en la tienda para imprimir las cajas.");
      const sb = supabaseBrowser();
      const [det, bx, access] = await Promise.all([
        sb.rpc("erp_stock_request_detail", { p_request: id }),
        sb.rpc("erp_sr_boxes", { p_request: id }),
        getDashboardStore().catch(() => null),
      ]);
      if (det.error || !det.data) return setError(det.error?.message ?? "No se encontró el pedido.");
      if (bx.error) return setError(/Could not find the function|schema cache/i.test(bx.error.message) ? "Falta ejecutar en Supabase la migración 20261348_cajas_pedidos.sql." : bx.error.message);
      setData(det.data as SrDetail);
      setBoxes((bx.data as SrBoxes).boxes);
      if (access?.store) setStore({ name: access.store.name, logo_url: access.store.logo_url });
    })();
  }, [id]);

  useEffect(() => {
    if (!data || !boxes || q.get("auto") !== "1") return;
    const t = window.setTimeout(() => window.print(), 700);
    return () => window.clearTimeout(t);
  }, [data, boxes, q]);

  if (error) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>🔒 {error}</p>;
  if (!data || !boxes) return <p style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>Preparando el documento…</p>;

  const r = data.request;
  const items = new Map(data.items.map((i) => [i.id, i]));
  const dist = distribution(data.items.map((i) => ({ id: i.id, toSend: i.qty_approved ?? i.qty_requested })), boxes);
  const chosen = only.length ? boxes.filter((b) => only.includes(b.number)) : boxes;
  const totalBoxes = boxes.length;
  const pending = data.items.filter((i) => (dist.unboxed.get(i.id) ?? 0) > 0);
  const pos = format !== "carta";
  const width = format === "pos58" ? "48mm" : format === "pos80" ? "72mm" : "100%";
  const title = what === "etiquetas" ? "Etiquetas de caja" : what === "consolidado" ? "Consolidado de envío" : what === "sin-caja" ? "Productos sin caja" : "Lista de empaque por cajas";

  const css = `
    @page { size: ${format === "carta" ? "letter" : `${format === "pos58" ? "58mm" : "80mm"} auto`}; margin: ${format === "carta" ? "12mm" : "2mm 4mm"}; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #e5e7eb; color: #000; font-family: ${pos ? "'Arial Narrow', Arial, sans-serif" : "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif"}; }
    .sheet { background: #fff; margin: 12px auto; padding: ${pos ? "2mm" : "10mm"}; width: ${format === "carta" ? "216mm" : format === "pos58" ? "58mm" : "80mm"}; max-width: 100%; }
    .sheet > .in { width: ${width}; margin: 0 auto; font-size: ${format === "pos58" ? "10px" : pos ? "11px" : "12px"}; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: ${pos ? "1.5px 0" : "4px 6px"}; vertical-align: middle; }
    ${pos ? "td.n, th.n { text-align: right; white-space: nowrap; font-weight: 800; }" : "th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; } td { border-bottom: 1px solid #e2e8f0; } td.n, th.n { text-align: right; font-weight: 800; white-space: nowrap; }"}
    .hr { border-top: 1px dashed #000; margin: 4px 0; }
    .box { break-inside: avoid; margin-top: ${pos ? "6px" : "14px"}; ${pos ? "" : "border: 1.5px solid #000; border-radius: 6px; overflow: hidden;"} }
    .boxhead { display: flex; align-items: center; gap: 8px; background: #000; color: #fff; padding: ${pos ? "3px 4px" : "6px 10px"}; font-weight: 900; }
    .chk { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #000; border-radius: 2px; }
    .page-break { break-after: page; }
    .toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 10px; background: #111827; color: #fff; font: 600 13px system-ui; }
    .toolbar a, .toolbar button { color: #fff; background: #374151; border: 0; border-radius: 999px; padding: 6px 12px; text-decoration: none; cursor: pointer; font: inherit; }
    .toolbar .on { background: #7c3aed; }
    .label { break-inside: avoid; border: 2px solid #000; border-radius: ${pos ? "0" : "10px"}; padding: ${pos ? "3mm" : "8mm"}; margin-bottom: ${pos ? "6mm" : "8mm"}; ${pos ? "" : "height: 120mm;"} display: flex; flex-direction: column; gap: 4px; }
    @media print { body { background: #fff; } .toolbar { display: none; } .sheet { margin: 0; padding: 0; width: auto; box-shadow: none; } }
  `;

  const header = (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {store?.logo_url && !pos ? <img src={store.logo_url} alt="" style={{ height: 34, width: "auto", objectFit: "contain" }} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: pos ? 13 : 16 }}>{store?.name ?? "RemHub"}</div>
          <div style={{ fontWeight: 800 }}>{title} · Pedido interno #{r.number}</div>
        </div>
        {!pos ? <div style={{ textAlign: "right", fontSize: 11 }}>{SR_STATUS[r.status]?.short ?? r.status}{r.priority === "urgent" ? " · URGENTE" : ""}<br />{dt(new Date().toISOString())}</div> : null}
      </div>
      <div className={pos ? "hr" : ""} style={pos ? undefined : { marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11, border: "1px solid #cbd5e1", borderRadius: 6, padding: 8 }}>
        {pos ? null : <>
          <div><b>SALE DE</b><br />{r.to_name}</div>
          <div><b>LLEGA A</b><br />{r.from_name}</div>
          <div><b>CAJAS</b><br />{totalBoxes} · {dist.totals.unitsBoxed} und. en cajas{dist.totals.unitsUnboxed ? ` · ${dist.totals.unitsUnboxed} sin caja` : ""}</div>
        </>}
      </div>
      {pos ? <div><b>Sale de:</b> {r.to_name}<br /><b>Llega a:</b> {r.from_name}<br /><b>Cajas:</b> {totalBoxes} · {dist.totals.unitsBoxed} und.{dist.totals.unitsUnboxed ? ` · ${dist.totals.unitsUnboxed} sin caja` : ""}<br />{dt(new Date().toISOString())}<div className="hr" /></div> : null}
    </div>
  );

  const rows = (list: Array<{ it: SrItem; qty: number; extra?: string }>) => (
    <table>
      {!pos ? <thead><tr>{photos ? <th style={{ width: 40 }} /> : null}<th>Producto</th><th>Ref.</th><th className="n">Cant.</th><th style={{ width: 28 }}>✓</th></tr></thead> : null}
      <tbody>
        {list.map(({ it, qty, extra }) => (
          <tr key={it.id}>
            {photos ? <td>{it.image_url ? <img src={it.image_url} alt="" loading="lazy" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 4 }} /> : null}</td> : null}
            <td style={{ fontWeight: 700 }}>{it.name}{pos && it.sku ? <div style={{ fontWeight: 400 }}>Ref. {it.sku}</div> : null}{extra ? <div style={{ fontWeight: 400, fontSize: "0.9em" }}>{extra}</div> : null}</td>
            {!pos ? <td>{it.sku ?? ""}</td> : null}
            <td className="n" style={{ fontSize: pos ? "1.15em" : undefined }}>{qty}</td>
            {!pos ? <td><span className="chk" /></td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const boxBlock = (b: SrBox, i: number, arr: SrBox[]) => {
    const list = b.items.map((x) => ({ it: items.get(x.item_id)!, qty: x.qty })).filter((x) => x.it);
    return (
      <div key={b.id} className={`box ${pagePerBox && i < arr.length - 1 ? "page-break" : ""}`}>
        <div className="boxhead">
          <span style={{ fontSize: pos ? 14 : 18 }}>CAJA {b.number} de {totalBoxes}</span>
          {b.name ? <span style={{ fontWeight: 700 }}>· {b.name}</span> : null}
          <span style={{ marginLeft: "auto", fontWeight: 700 }}>{b.items.length} ref. · {boxUnits(b)} und.</span>
        </div>
        <div style={{ padding: pos ? "2px 0" : "6px 10px", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: "0.92em" }}>
            {b.fragile ? <b>⚠️ FRÁGIL · </b> : null}
            {b.status === "closed" ? `Cerrada por ${b.closed_by_name ?? "—"} ${dt(b.closed_at)}` : `Abierta · armó ${b.created_by_name ?? "—"}`}
            {b.seal ? ` · Sello ${b.seal}` : ""}{b.weight_kg != null ? ` · ${String(b.weight_kg).replace(".", ",")} kg` : ""}{b.dims ? ` · ${b.dims}` : ""}
            {b.notes ? <div>📝 {b.notes}</div> : null}
          </div>
          {withQr ? <Qr text={boxUrl(b.token)} size={pos ? "18mm" : "22mm"} /> : null}
        </div>
        <div style={{ padding: pos ? 0 : "0 4px 4px" }}>{rows(list)}</div>
      </div>
    );
  };

  const unboxedBlock = pending.length ? (
    <div className="box">
      <div className="boxhead" style={{ background: "#fff", color: "#000", borderBottom: "2px solid #000" }}>
        <span style={{ fontSize: pos ? 13 : 16 }}>SIN CAJA</span>
        <span style={{ marginLeft: "auto", fontWeight: 700 }}>{dist.totals.refsUnboxed} ref. · {dist.totals.unitsUnboxed} und.</span>
      </div>
      <div style={{ padding: pos ? 0 : "0 4px 4px" }}>{rows(pending.map((it) => ({ it, qty: dist.unboxed.get(it.id) ?? 0 })))}</div>
    </div>
  ) : null;

  const consolidated = (
    <div className="box">
      <div className="boxhead"><span>CONSOLIDADO</span><span style={{ marginLeft: "auto", fontWeight: 700 }}>{data.items.length} ref. · {dist.totals.unitsToSend} und.</span></div>
      <div style={{ padding: pos ? 0 : "0 4px 4px" }}>
        {rows(data.items.map((it) => ({ it, qty: it.qty_approved ?? it.qty_requested, extra: distributionText(dist.perItem.get(it.id) ?? [], dist.unboxed.get(it.id) ?? 0) || undefined })))}
      </div>
    </div>
  );

  const signBlock = signatures && what !== "etiquetas" ? (
    <div style={{ marginTop: pos ? 10 : 22, display: "grid", gridTemplateColumns: pos ? "1fr" : "1fr 1fr 1fr", gap: pos ? 14 : 18, fontSize: 11, breakInside: "avoid" }}>
      {["Preparó / empacó", "Revisó", "Recibió"].map((t) => (
        <div key={t}><div style={{ borderTop: "1px solid #000", paddingTop: 3, marginTop: pos ? 18 : 30 }}><b>{t}</b><br />Nombre y cédula</div></div>
      ))}
    </div>
  ) : null;

  const labels = chosen.map((b) => (
    <div key={b.id} className="label">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: pos ? 22 : 44, lineHeight: 1 }}>CAJA {b.number}<span style={{ fontSize: "0.5em" }}> / {totalBoxes}</span></div>
          {b.name ? <div style={{ fontWeight: 800, fontSize: pos ? 13 : 20 }}>{b.name}</div> : null}
          <div style={{ fontWeight: 800, fontSize: pos ? 12 : 16, marginTop: 4 }}>Pedido interno #{r.number}</div>
        </div>
        {withQr ? <Qr text={boxUrl(b.token)} size={pos ? "26mm" : "42mm"} /> : null}
      </div>
      <div style={{ fontSize: pos ? 12 : 18, marginTop: 4 }}><b>DE:</b> {r.to_name}</div>
      <div style={{ fontSize: pos ? 14 : 24, fontWeight: 900 }}><b>PARA:</b> {r.from_name}</div>
      <div style={{ fontSize: pos ? 11 : 15 }}>{b.items.length} ref. · {boxUnits(b)} und.{b.weight_kg != null ? ` · ${String(b.weight_kg).replace(".", ",")} kg` : ""}{b.seal ? ` · Sello ${b.seal}` : ""}</div>
      <div style={{ fontSize: pos ? 10 : 13 }}>{store?.name ?? ""} · {dt(b.closed_at ?? b.created_at)} · {b.closed_by_name ?? b.created_by_name ?? ""}</div>
      {b.fragile ? <div style={{ marginTop: "auto", border: "3px solid #000", textAlign: "center", fontWeight: 900, fontSize: pos ? 16 : 30, letterSpacing: 2 }}>⚠️ FRÁGIL</div> : null}
    </div>
  ));

  const change = (f: Format) => {
    setFormat(f);
    const u = new URL(window.location.href);
    u.searchParams.set("formato", f);
    u.searchParams.delete("auto");
    window.history.replaceState(null, "", u.toString());
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="toolbar">
        <a href={`/dashboard/pedidos?tab=internos&pedido=${r.id}`}>← Volver al pedido</a>
        {(["carta", "pos80", "pos58"] as const).map((f) => <button key={f} type="button" className={format === f ? "on" : ""} onClick={() => change(f)}>{f === "carta" ? "Carta" : f === "pos80" ? "Tirilla 80 mm" : "Tirilla 58 mm"}</button>)}
        <button type="button" className="on" onClick={() => window.print()}>🖨️ Imprimir</button>
      </div>
      <div className="sheet">
        <div className="in">
          {what === "etiquetas" ? labels : (
            <>
              {header}
              {what === "todo" || what === "cajas" ? chosen.map(boxBlock) : null}
              {what === "todo" || what === "sin-caja" ? unboxedBlock : null}
              {what === "sin-caja" && !pending.length ? <p style={{ marginTop: 12 }}>No queda nada sin caja.</p> : null}
              {what === "consolidado" ? consolidated : null}
              {(what === "cajas" || what === "todo") && !chosen.length ? <p style={{ marginTop: 12 }}>Este pedido no tiene cajas.</p> : null}
              {signBlock}
              <p style={{ marginTop: 10, fontSize: 9, color: "#475569" }}>RemHub · Pedido #{r.number} · {r.to_name} → {r.from_name}. Documento interno para mover mercancía (sin costos ni precios).</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

