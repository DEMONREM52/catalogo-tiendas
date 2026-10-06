/* eslint-disable @next/next/no-img-element */
// Comprobante solo para impresión: hoja carta o tirilla de impresora POS (80 mm / 58 mm).

export type PrintFormat = "carta" | "t80" | "t58";

export const PRINT_FORMATS: Record<PrintFormat, string> = {
  carta: "Hoja carta",
  t80: "Tirilla POS 80 mm",
  t58: "Tirilla POS 58 mm",
};

export const PRINT_FORMAT_KEY = "remhub_print_format";

export function parsePrintFormat(value: string | null | undefined): PrintFormat | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "carta" || v === "letter") return "carta";
  if (v === "t80" || v === "tirilla" || v === "80") return "t80";
  if (v === "t58" || v === "58") return "t58";
  return null;
}

type Line = { product_id: string; name: string; qty: number; price: number; image_url?: string | null };

type Props = {
  format: PrintFormat;
  logo: string | null;
  businessName: string;
  nit?: string | null;
  address?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  docTitle: string;
  docNumber: string;
  pointName?: string | null;
  pointAddress?: string | null;
  sellerName?: string | null;
  customerDoc?: string | null;
  /** Texto de la resolución de facturación del punto (solo facturas). */
  resolution?: string | null;
  date: string;
  customer: string;
  note: string;
  items: Line[];
  total: number;
  money: (n: number) => string;
  footer: string;
};

/** Reglas @page e impresión según el formato elegido. */
export function PrintStyles({ format }: { format: PrintFormat }) {
  // Margen 0: el navegador no imprime fecha/URL; el espacio lo da el propio comprobante.
  // En tirilla no se fija el alto: lo define el rollo configurado en el driver de la impresora POS.
  const page = format === "carta" ? "size: letter portrait; margin: 0;" : "margin: 0;";
  const pad = format === "carta" ? "12mm 14mm" : "1mm 2mm";
  const css = `
    @media print {
      @page { ${page} }
      html, body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; min-height: 0 !important; }
      body * { visibility: hidden !important; }
      .receipt-print, .receipt-print * { visibility: visible !important; }
      .receipt-host { min-height: 0 !important; padding: 0 !important; margin: 0 !important; background: #fff !important; }
      .receipt-print { display: block !important; position: absolute; left: 0; top: 0; padding: ${pad}; box-sizing: border-box; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-shadow: none !important; text-shadow: none !important; }
    }
    @media screen { .receipt-print { display: none !important; } }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

export function PrintReceipt(props: Props) {
  return props.format === "carta" ? <LetterReceipt {...props} /> : <TicketReceipt {...props} />;
}

function LetterReceipt(p: Props) {
  // Colores pensados para imprimir sin "gráficos de fondo": nada depende de un fondo oscuro.
  const ink = "#000";
  const soft = "#334155";
  const line = "#94a3b8";
  const units = p.items.reduce((sum, i) => sum + i.qty, 0);
  const label = { fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: soft, marginBottom: 4 } as const;
  const card = { border: `1px solid ${line}`, borderRadius: 8, padding: "9px 11px" } as const;
  const th = { padding: "8px 8px", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: ink, borderTop: `2px solid ${ink}`, borderBottom: `2px solid ${ink}` } as const;
  const td = { padding: "7px 8px", borderBottom: `1px solid ${line}`, verticalAlign: "middle" } as const;

  return (
    <div className="receipt-print" style={{ width: "100%", fontFamily: "Inter, Arial, Helvetica, sans-serif", fontSize: 11.5, color: ink, lineHeight: 1.4 }}>
      {/* Encabezado */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0 }}>
          {p.logo ? <img src={p.logo} alt="" style={{ width: 74, height: 74, objectFit: "contain", flexShrink: 0 }} /> : null}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 900, letterSpacing: -0.2 }}>{p.businessName}</div>
            {p.pointName ? <div style={{ color: soft }}>{p.pointName}</div> : null}
            {p.nit ? <div>NIT: {p.nit}</div> : null}
            {p.address ? <div>{p.address}</div> : null}
            {[p.whatsapp, p.email].filter(Boolean).length ? <div>{[p.whatsapp, p.email].filter(Boolean).join(" · ")}</div> : null}
          </div>
        </div>
        <div style={{ border: `2px solid ${ink}`, borderRadius: 10, padding: "8px 14px", textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase" }}>{p.docTitle}</div>
          <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.15 }}>{p.docNumber}</div>
          <div style={{ fontSize: 10, color: soft }}>{p.date}</div>
        </div>
      </div>

      {/* Datos */}
      <div style={{ display: "grid", gridTemplateColumns: p.note && p.note !== "—" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 10, marginTop: 16 }}>
        <div style={card}>
          <div style={label}>Cliente</div>
          <div style={{ fontWeight: 800 }}>{p.customer}</div>
          {p.customerDoc ? <div>Doc.: {p.customerDoc}</div> : null}
        </div>
        <div style={card}>
          <div style={label}>Venta</div>
          <div>Fecha: {p.date}</div>
          {p.sellerName ? <div>Atendió: {p.sellerName}</div> : null}
        </div>
        {p.note && p.note !== "—" ? (
          <div style={card}>
            <div style={label}>Observaciones</div>
            <div>{p.note}</div>
          </div>
        ) : null}
      </div>

      {/* Productos */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 28, textAlign: "center", borderTopLeftRadius: 6 }}>#</th>
            <th style={{ ...th, textAlign: "left" }}>Descripción</th>
            <th style={{ ...th, width: 54, textAlign: "center" }}>Cant.</th>
            <th style={{ ...th, width: 100, textAlign: "right" }}>Vr. unitario</th>
            <th style={{ ...th, width: 104, textAlign: "right", borderTopRightRadius: 6 }}>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((i, index) => (
            <tr key={i.product_id} style={{ breakInside: "avoid", background: "#fff" }}>
              <td style={{ ...td, textAlign: "center", color: soft }}>{index + 1}</td>
              <td style={td}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {i.image_url ? (
                    <img src={i.image_url} alt="" style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 5, border: `1px solid ${line}`, flexShrink: 0 }} />
                  ) : null}
                  <span style={{ fontWeight: 600 }}>{i.name}</span>
                </div>
              </td>
              <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{i.qty}</td>
              <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{p.money(i.price)}</td>
              <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{p.money(i.price * i.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totales */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, marginTop: 14, alignItems: "flex-start", breakInside: "avoid" }}>
        <div style={{ fontSize: 10.5, color: soft, maxWidth: "55%" }}>
          <div>{p.items.length} producto{p.items.length === 1 ? "" : "s"} · {units} unidad{units === 1 ? "" : "es"}</div>
          {p.resolution ? <div style={{ marginTop: 6 }}>{p.resolution}</div> : null}
        </div>
        <div style={{ width: 250, border: `2px solid ${ink}`, borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 12px" }}>
            <span>Subtotal</span>
            <span>{p.money(p.total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", background: "#f1f5f9", borderTop: `2px solid ${ink}`, color: ink, fontSize: 15, fontWeight: 900 }}>
            <span>TOTAL</span>
            <span>{p.money(p.total)}</span>
          </div>
        </div>
      </div>

      {/* Pie */}
      <div style={{ marginTop: 26, paddingTop: 10, borderTop: `1px solid ${line}`, textAlign: "center", fontSize: 10, color: soft }}>
        <div style={{ fontWeight: 700, color: ink, fontSize: 11 }}>{p.footer}</div>
        <div style={{ marginTop: 3 }}>Documento de venta generado por la tienda. No reemplaza una factura electrónica validada por la DIAN.</div>
      </div>
    </div>
  );
}

function TicketReceipt(p: Props) {
  const narrow = p.format === "t58";
  const width = narrow ? "48mm" : "72mm"; // ancho imprimible real de cada rollo
  const font = narrow ? 10 : 11.5;
  const rule = { borderTop: "1px dashed #000", margin: "6px 0" } as const;
  const row = { display: "flex", justifyContent: "space-between", gap: 6 } as const;
  return (
    <div
      className="receipt-print"
      style={{ width, fontFamily: "'Courier New', Consolas, monospace", fontSize: font, lineHeight: 1.3, color: "#000", wordBreak: "break-word" }}
    >
      <div style={{ textAlign: "center" }}>
        {p.logo ? <img src={p.logo} alt="" style={{ width: narrow ? 36 : 48, height: narrow ? 36 : 48, objectFit: "contain", filter: "grayscale(1)" }} /> : null}
        <div style={{ fontSize: font + 2, fontWeight: 800 }}>{p.businessName}</div>
        {p.nit ? <div>NIT: {p.nit}</div> : null}
        {p.address ? <div>{p.address}</div> : null}
        {p.whatsapp ? <div>Tel/WA: {p.whatsapp}</div> : null}
        {p.pointName ? <div>Punto: {p.pointName}</div> : null}
        {p.pointAddress ? <div>{p.pointAddress}</div> : null}
      </div>
      <div style={rule} />
      <div style={{ textAlign: "center", fontWeight: 800, textTransform: "uppercase" }}>{p.docTitle}</div>
      <div style={{ textAlign: "center", fontWeight: 800, fontSize: font + 2 }}>{p.docNumber}</div>
      <div style={{ textAlign: "center" }}>{p.date}</div>
      <div style={rule} />
      <div>Cliente: <b>{p.customer}</b></div>
      {p.customerDoc ? <div>Doc: {p.customerDoc}</div> : null}
      {p.sellerName ? <div>Atendió: {p.sellerName}</div> : null}
      {p.note && p.note !== "—" ? <div>Obs: {p.note}</div> : null}
      <div style={rule} />
      {p.items.map((i) => (
        <div key={i.product_id} style={{ marginBottom: 4, breakInside: "avoid" }}>
          <div style={{ fontWeight: 700 }}>{i.name}</div>
          <div style={row}>
            <span>{i.qty} x {p.money(i.price)}</span>
            <span style={{ fontWeight: 700 }}>{p.money(i.price * i.qty)}</span>
          </div>
        </div>
      ))}
      <div style={rule} />
      <div style={{ ...row, fontSize: font + 3, fontWeight: 800 }}>
        <span>TOTAL</span>
        <span>{p.money(p.total)}</span>
      </div>
      <div style={{ ...row, fontSize: font - 1 }}>
        <span>Unidades</span>
        <span>{p.items.reduce((s, i) => s + i.qty, 0)}</span>
      </div>
      <div style={rule} />
      <div style={{ textAlign: "center", fontSize: font - 1 }}>
        <div>{p.footer}</div>
        {p.resolution ? <div style={{ marginTop: 4, fontSize: font - 2 }}>{p.resolution}</div> : null}
        <div style={{ marginTop: 4 }}>No reemplaza la factura electrónica DIAN.</div>
      </div>
      <div style={{ height: "6mm" }} />
    </div>
  );
}
