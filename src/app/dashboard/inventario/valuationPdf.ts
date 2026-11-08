/**
 * Informe PDF completo de la liquidación de un punto (mercancía, cuenta con la bodega, movimientos,
 * comparación de listas, pérdidas, costos sospechosos y todos los productos).
 * Se arma con jsPDF (texto real que se puede buscar) y se descarga o comparte directo, sin captura.
 */

export type PdfLine = {
  name: string; sku: string | null; qty: number; cost: number | null; internal: number; sale: number;
  avg_cost?: number | null; last_cost?: number | null; frozen?: boolean;
};
export type PdfMove = {
  type: "doc" | "payment"; number?: number; kind: string; amount: number; note: string | null; status: string;
  transfer_number?: number | null; reference?: string | null; at: string; paid_at?: string;
};
export type PdfCharge = { number: number; kind: string; amount: number; pending: number; due_date: string | null; days_late: number | null; transfer_number: number | null };
export type PdfInput = {
  pointName: string;
  level: number;
  basisLabel: string;
  costs: boolean;
  totals: { products: number; units: number; cost: number; internal: number; sale: number };
  account: null | { balance: number; overdue: number; in_transit: number; paid: number; charged: number; next_due: string | null; credits?: number };
  pct: number | null;
  moves: PdfMove[];
  charges: PdfCharge[];
  compare: Array<{ lv: number; sale: number; point: number; chain: number; margin: string; lossN: number; lossV: number }>;
  losses: Array<PdfLine & { why: "below_cost" | "bodega" }>;
  suspects: PdfLine[];
  lines: PdfLine[];
  money: (n: number | null | undefined) => string;
};

const KIND: Record<string, string> = {
  transfer: "Traslado recibido", opening: "Deuda inicial", charge: "Cargo", return: "Devolución a la bodega",
  transfer_out: "Pasó a otro punto", loss: "Novedad aprobada", credit: "Nota crédito", payment: "Abono",
};

/** jsPDF con fuentes estándar solo tiene Latin-1: se cambian símbolos y se quitan emojis. */
const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/[−–—]/g, "-").replace(/[→⇒]/g, "->").replace(/≈/g, "~").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/ | /g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "").replace(/\s{2,}/g, " ").trim();
const n = (v: unknown) => Number(v ?? 0);
const d2 = (v: string | null | undefined) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");

type Col = { label: string; w: number; align?: "left" | "right" };

export async function buildValuationPdf(d: PdfInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const CW = W - M * 2;
  let y = M;
  const m = (v: number | null | undefined) => clean(d.money(v));
  const accent: [number, number, number] = [109, 40, 217];
  const good: [number, number, number] = [5, 150, 105];
  const bad: [number, number, number] = [185, 28, 28];

  const ensure = (h: number) => { if (y + h > H - 14) { doc.addPage(); y = M; return true; } return false; };
  const section = (title: string, sub?: string) => {
    ensure(34);
    y += 3;
    doc.setFillColor(...accent).rect(M, y, 1.4, 6, "F");
    doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(20).text(clean(title).toUpperCase(), M + 3.5, y + 4.6);
    y += 8;
    if (sub) {
      doc.setFont("helvetica", "normal").setFontSize(8);
      const ls = doc.splitTextToSize(clean(sub), CW);
      doc.setTextColor(100).text(ls, M, y + 2.5);
      y += ls.length * 3.4 + 1.5;
    }
    doc.setTextColor(0);
  };
  const boxes = (items: Array<{ k: string; v: string; sub?: string; tone?: "good" | "bad" | "accent" }>, perRow = 3) => {
    const gap = 3, bw = (CW - gap * (perRow - 1)) / perRow, bh = 19;
    items.forEach((it, i) => {
      const col = i % perRow;
      if (col === 0) { ensure(bh + 2); }
      const x = M + col * (bw + gap);
      doc.setDrawColor(210).setLineWidth(0.3).roundedRect(x, y, bw, bh, 2, 2);
      doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(110).text(clean(it.k).toUpperCase(), x + 3, y + 5, { maxWidth: bw - 6 });
      const c = it.tone === "good" ? good : it.tone === "bad" ? bad : it.tone === "accent" ? accent : ([17, 17, 17] as [number, number, number]);
      doc.setFontSize(13).setTextColor(...c).text(clean(it.v), x + 3, y + 11.5, { maxWidth: bw - 6 });
      if (it.sub) doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120).text(clean(it.sub), x + 3, y + 16, { maxWidth: bw - 6 });
      if (col === perRow - 1 || i === items.length - 1) y += bh + gap;
    });
    doc.setTextColor(0);
  };
  const note = (text: string, tone: "warn" | "info" | "good" = "info") => {
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    const ls = doc.splitTextToSize(clean(text), CW - 8);
    const h = ls.length * 3.8 + 5;
    ensure(h + 2);
    const fill: [number, number, number] = tone === "warn" ? [254, 243, 199] : tone === "good" ? [209, 250, 229] : [237, 233, 254];
    doc.setFillColor(...fill).roundedRect(M, y, CW, h, 2, 2, "F");
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(30).text(ls, M + 4, y + 4.8);
    y += h + 3;
    doc.setTextColor(0);
  };
  /** Tabla con encabezado repetido en cada página. colorFn: color por celda (p. ej. negativos en rojo). */
  const table = (cols: Col[], rows: string[][], colorFn?: (r: number, c: number) => [number, number, number] | null, boldCols: number[] = []) => {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const ws = cols.map((c) => (c.w / total) * CW);
    const head = () => {
      doc.setFillColor(243, 244, 246).rect(M, y, CW, 6.5, "F");
      doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(70);
      let x = M;
      cols.forEach((c, i) => {
        doc.text(clean(c.label).toUpperCase(), c.align === "right" ? x + ws[i] - 1.5 : x + 1.5, y + 4.4, { align: c.align === "right" ? "right" : "left", maxWidth: ws[i] - 3 });
        x += ws[i];
      });
      y += 7.5;
      doc.setTextColor(0);
    };
    ensure(16);
    head();
    rows.forEach((r, ri) => {
      doc.setFont("helvetica", "normal").setFontSize(8);
      const first = doc.splitTextToSize(clean(r[0]), ws[0] - 3) as string[];
      const lines = first.slice(0, 2);
      const h = Math.max(5, lines.length * 3.5 + 1.6);
      if (ensure(h + 1)) head();
      if (ri % 2 === 1) doc.setFillColor(250, 250, 252).rect(M, y - 1, CW, h, "F");
      let x = M;
      r.forEach((cell, ci) => {
        const c = cols[ci];
        const color = colorFn?.(ri, ci);
        doc.setFont("helvetica", boldCols.includes(ci) ? "bold" : "normal").setFontSize(8).setTextColor(...(color ?? ([17, 17, 17] as [number, number, number])));
        if (ci === 0) doc.text(lines, x + 1.5, y + 2.6);
        else doc.text(clean(cell), c.align === "right" ? x + ws[ci] - 1.5 : x + 1.5, y + 2.6, { align: c.align === "right" ? "right" : "left", maxWidth: ws[ci] - 2 });
        x += ws[ci];
      });
      doc.setDrawColor(235).setLineWidth(0.15).line(M, y + h - 1, W - M, y + h - 1);
      y += h;
    });
    y += 3;
    doc.setTextColor(0);
  };

  // ------------------------------------------------------------ portada
  doc.setFillColor(...accent).rect(0, 0, W, 26, "F");
  doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(255).text(clean(`Liquidación · ${d.pointName}`), M, 12);
  doc.setFont("helvetica", "normal").setFontSize(9)
    .text(clean(`Informe de mercancía y cuenta con la bodega · precio de venta con la lista P${d.level} · costo: ${d.basisLabel}`), M, 18.5)
    .text(clean(`Generado el ${new Date().toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}`), M, 23);
  doc.setTextColor(0);
  y = 33;

  const t = d.totals;
  section(`La mercancía del punto (${t.units.toLocaleString("es-CO")} unidades · ${t.products} productos)`, "Lo que hay hoy en el punto: lo que costó, lo que vale para la bodega y lo que vale a precio de venta.");
  const gainPoint = t.sale - t.internal, gainBodega = t.internal - t.cost, gainChain = t.sale - t.cost;
  const pctTxt = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %` : "-");
  boxes([
    ...(d.costs ? [{ k: "1. Costo real", v: m(t.cost), sub: `Lo que pagó la bodega (${d.basisLabel.toLowerCase()})` }] : []),
    { k: "2. Precio de bodega", v: m(t.internal), sub: d.pct != null ? `Costo + ${d.pct} % de la bodega` : "Lo que el punto le debe a la bodega", tone: "accent" },
    { k: `3. A precio de venta (P${d.level})`, v: m(t.sale), sub: "Si vende todo a su precio de lista" },
    ...(d.costs ? [{ k: "Ganancia de la bodega", v: m(gainBodega), sub: "2 - 1", tone: gainBodega < 0 ? "bad" as const : "good" as const }] : []),
    { k: "Ganancia del punto", v: m(gainPoint), sub: `3 - 2 · margen ${pctTxt(gainPoint, t.sale)}`, tone: gainPoint < 0 ? "bad" : "good" },
    ...(d.costs ? [{ k: "Ganancia total (cadena)", v: m(gainChain), sub: `3 - 1 · margen ${pctTxt(gainChain, t.sale)}`, tone: gainChain < 0 ? "bad" as const : "good" as const }] : []),
  ]);

  // ------------------------------------------------------------ cuenta con la bodega
  if (d.account) {
    const a = d.account;
    section("La cuenta con la bodega", "Lo que el punto le debe a la bodega por la mercancía recibida, menos lo que ha abonado.");
    boxes([
      { k: "Debe hoy", v: m(a.balance), tone: a.balance > 0 ? "bad" : "good", sub: a.next_due ? `Próximo vencimiento ${d2(a.next_due)}` : undefined },
      { k: "Vencido", v: m(a.overdue), tone: a.overdue > 0 ? "bad" : "good", sub: a.overdue > 0 ? "Tiene pagos atrasados" : "Al día" },
      { k: "En camino", v: m(a.in_transit), sub: "Traslados sin recibir" },
      { k: "Total cobrado", v: m(a.charged), sub: "Traslados, cargos y deuda inicial" },
      { k: "Notas crédito", v: m(n(a.credits)), sub: "Devoluciones, rebajas y cuadres" },
      { k: "Ha abonado", v: m(a.paid), sub: "Abonos y liquidaciones", tone: "good" },
    ]);
    const gap = a.balance - t.internal;
    if (Math.abs(gap) < 1) note("La deuda es igual a la mercancía que tiene a precio de bodega: está cuadrada.", "good");
    else if (gap > 0) note(`El punto debe ${m(gap)} más de lo que vale la mercancía que le queda (a precio de bodega). Ese dinero corresponde a lo que ya vendió y no ha abonado: debería estar en su caja.`, "warn");
    else note(`La mercancía que tiene (${m(t.internal)} a precio de bodega) cubre su deuda y le sobran ${m(-gap)} en mercancía ya pagada.`, "good");

    const pend = d.charges.filter((c) => n(c.pending) > 0);
    if (pend.length) {
      section("Por pagar", "Lo más antiguo se paga primero.");
      table(
        [{ label: "Concepto", w: 50 }, { label: "Valor original", w: 18, align: "right" }, { label: "Vence", w: 15, align: "right" }, { label: "Atraso", w: 12, align: "right" }, { label: "Pendiente", w: 18, align: "right" }],
        pend.map((c) => [`${KIND[c.kind] ?? c.kind}${c.transfer_number ? ` #${c.transfer_number}` : ""} · doc ${c.number}`, m(c.amount), d2(c.due_date), c.days_late ? `${c.days_late} días` : "-", m(c.pending)]),
        (r, c) => (c === 3 && pend[r].days_late ? bad : null), [4],
      );
    }
    if (d.moves.length) {
      section("Movimientos de la cuenta", "Cargos suben la deuda; abonos y notas crédito la bajan. Los anulados no cuentan.");
      const sorted = [...d.moves].sort((p, q) => p.at.localeCompare(q.at));
      let bal = 0;
      const rows = sorted.map((mv) => {
        const voided = mv.status === "void";
        if (!voided) bal += n(mv.amount);
        const label = `${KIND[mv.type === "payment" ? "payment" : mv.kind] ?? mv.kind}${mv.transfer_number ? ` #${mv.transfer_number}` : ""}${mv.number ? ` · doc ${mv.number}` : ""}${mv.reference ? ` · ${mv.reference}` : ""}${mv.note ? ` · ${mv.note}` : ""}${voided ? " (ANULADO)" : ""}`;
        return [label, d2(mv.paid_at ?? mv.at), n(mv.amount) > 0 ? m(mv.amount) : "", n(mv.amount) < 0 ? m(-n(mv.amount)) : "", voided ? "-" : m(bal)];
      });
      table(
        [{ label: "Concepto", w: 58 }, { label: "Fecha", w: 13, align: "right" }, { label: "Cargo", w: 15, align: "right" }, { label: "Abono", w: 15, align: "right" }, { label: "Saldo", w: 16, align: "right" }],
        rows, (r, c) => (c === 3 && rows[r][3] ? good : sorted[r].status === "void" ? [150, 150, 150] : null), [4],
      );
    }
  }

  // ------------------------------------------------------------ comparar listas
  if (d.compare.length) {
    section("Comparar listas de precio", "Cuánto vale la mercancía y cuánto ganaría el punto vendiéndola con cada lista.");
    table(
      [{ label: "Lista", w: 10 }, { label: "Total venta", w: 18, align: "right" }, { label: "Gana el punto", w: 18, align: "right" }, ...(d.costs ? [{ label: "Gana la cadena", w: 18, align: "right" as const }] : []), { label: "Margen punto", w: 13, align: "right" }, { label: "Con pérdida", w: 12, align: "right" }, { label: "Pérdidas", w: 15, align: "right" }],
      d.compare.map((c) => [`P${c.lv}${c.lv === d.level ? " (esta)" : ""}`, m(c.sale), m(c.point), ...(d.costs ? [m(c.chain)] : []), c.margin, String(c.lossN), m(c.lossV)]),
      (r, c) => { const last = d.costs ? 6 : 5; return c === last && d.compare[r].lossV < 0 ? bad : c === 2 && d.compare[r].point < 0 ? bad : null; },
    );
  }

  // ------------------------------------------------------------ pérdidas y alertas
  section(`Productos con pérdida en P${d.level} (${d.losses.length})`, "Se venderían por debajo del precio de bodega. «Bajo el costo»: el precio de lista es menor que lo que costó.");
  if (d.losses.length) {
    const rows = d.losses.slice(0, 80);
    table(
      [{ label: "Producto", w: 46 }, { label: "Und.", w: 7, align: "right" }, ...(d.costs ? [{ label: "Costo", w: 13, align: "right" as const }] : []), { label: "Bodega", w: 13, align: "right" }, { label: "Venta", w: 13, align: "right" }, { label: "Pierde", w: 14, align: "right" }, { label: "Motivo", w: 16 }],
      rows.map((l) => [`${l.name}${l.sku ? ` · ${l.sku}` : ""}`, String(l.qty), ...(d.costs ? [m(l.cost)] : []), m(l.internal), m(l.sale), m((l.sale - l.internal) * l.qty), l.why === "below_cost" ? "Bajo el costo" : "Bajo la bodega"]),
      (_r, c) => (c === (d.costs ? 5 : 4) ? bad : null),
    );
    if (d.losses.length > rows.length) note(`Y ${d.losses.length - rows.length} producto(s) más con pérdida: están en la lista completa de productos.`);
  } else note("Ningún producto se vendería por debajo del precio de bodega con esta lista.", "good");

  if (d.costs && d.suspects.length) {
    section(`Costos para revisar (${d.suspects.length})`, "El costo promedio y el de la última factura difieren 50 % o más: puede haber un costo mal digitado.");
    table(
      [{ label: "Producto", w: 50 }, { label: "Und.", w: 8, align: "right" }, { label: "Costo promedio", w: 17, align: "right" }, { label: "Última factura", w: 17, align: "right" }],
      d.suspects.slice(0, 60).map((l) => [`${l.name}${l.sku ? ` · ${l.sku}` : ""}`, String(l.qty), m(l.avg_cost), m(l.last_cost)]),
    );
  }

  // ------------------------------------------------------------ todos los productos
  section(`Todos los productos (${d.lines.length})`, `Ordenados por valor de venta. Precio de venta con la lista P${d.level}. «*» = precio de bodega fijado al trasladar.`);
  const prodCols: Col[] = [{ label: "Producto", w: 44 }, { label: "Und.", w: 7, align: "right" }, ...(d.costs ? [{ label: "Costo", w: 12, align: "right" as const }] : []),
    { label: "Bodega", w: 12, align: "right" }, { label: "Venta", w: 12, align: "right" }, { label: "Total venta", w: 15, align: "right" }, { label: "Gana el punto", w: 15, align: "right" }];
  const sortedLines = [...d.lines].sort((a, b) => b.qty * b.sale - a.qty * a.sale);
  table(prodCols,
    sortedLines.map((l) => [`${l.name}${l.sku ? ` · ${l.sku}` : ""}`, String(l.qty), ...(d.costs ? [m(l.cost)] : []), `${m(l.internal)}${l.frozen ? "*" : ""}`, m(l.sale), m(l.sale * l.qty), m((l.sale - l.internal) * l.qty)]),
    (r, c) => (c === prodCols.length - 1 && (sortedLines[r].sale - sortedLines[r].internal) < 0 ? bad : null), [prodCols.length - 1]);
  ensure(10);
  doc.setFont("helvetica", "bold").setFontSize(9).text(clean(`Totales: ${t.units.toLocaleString("es-CO")} unidades · ${d.costs ? `costo ${m(t.cost)} · ` : ""}bodega ${m(t.internal)} · venta ${m(t.sale)}`), M, y + 3);

  // ------------------------------------------------------------ pie
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(140);
    doc.text(clean(`Liquidación · ${d.pointName} · RemHub`), M, H - 7);
    doc.text(`Página ${i} de ${pages}`, W - M, H - 7, { align: "right" });
  }
  return doc.output("blob");
}
