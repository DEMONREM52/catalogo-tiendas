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

type Line = { product_id: string; name: string; qty: number; price: number };

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
  // En tirilla no se fija el alto: lo define el rollo configurado en el driver de la impresora POS.
  const page = format === "carta" ? "size: letter portrait; margin: 12mm;" : "margin: 0;";
  const css = `
    @media print {
      @page { ${page} }
      html, body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; min-height: 0 !important; }
      .receipt-host { min-height: 0 !important; padding: 0 !important; margin: 0 !important; background: #fff !important; }
      .receipt-print { display: block !important; ${format === "carta" ? "" : "padding: 1mm 2mm;"} }
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
  const cell = { padding: "7px 6px", borderBottom: "1px solid #ddd" } as const;
  return (
    <div className="receipt-print" style={{ width: "100%", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 12, color: "#000" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          {p.logo ? <img src={p.logo} alt="" style={{ width: 72, height: 72, objectFit: "contain" }} /> : null}
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{p.businessName}</div>
            {p.nit ? <div>NIT: {p.nit}</div> : null}
            {p.address ? <div>{p.address}</div> : null}
            {p.email ? <div>{p.email}</div> : null}
            {p.whatsapp ? <div>WhatsApp: {p.whatsapp}</div> : null}
            {p.pointName ? <div>Punto de venta: <b>{p.pointName}</b>{p.pointAddress ? ` · ${p.pointAddress}` : ""}</div> : null}
          </div>
        </div>
        <div style={{ textAlign: "right", border: "1px solid #000", borderRadius: 6, padding: "8px 12px" }}>
          <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{p.docTitle}</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{p.docNumber}</div>
          <div style={{ fontSize: 11 }}>{p.date}</div>
        </div>
      </div>

      <div style={{ marginTop: 14, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
        <div>Cliente: <b>{p.customer}</b>{p.customerDoc ? ` · Doc. ${p.customerDoc}` : ""}</div>
        {p.sellerName ? <div style={{ marginTop: 2 }}>Atendió: {p.sellerName}</div> : null}
        {p.note && p.note !== "—" ? <div style={{ marginTop: 2 }}>Observaciones: {p.note}</div> : null}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
        <thead>
          <tr style={{ background: "#f1f1f1" }}>
            <th style={{ ...cell, textAlign: "center", width: 60 }}>Cant.</th>
            <th style={{ ...cell, textAlign: "left" }}>Descripción</th>
            <th style={{ ...cell, textAlign: "right", width: 110 }}>Vr. unitario</th>
            <th style={{ ...cell, textAlign: "right", width: 110 }}>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => (
            <tr key={i.product_id} style={{ breakInside: "avoid" }}>
              <td style={{ ...cell, textAlign: "center" }}>{i.qty}</td>
              <td style={cell}>{i.name}</td>
              <td style={{ ...cell, textAlign: "right" }}>{p.money(i.price)}</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{p.money(i.price * i.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <div style={{ minWidth: 240, border: "1px solid #000", borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700 }}>TOTAL</span>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{p.money(p.total)}</span>
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 10, color: "#333" }}>
        <div>Documento de venta generado por la tienda. No reemplaza una factura electrónica validada por la DIAN.</div>
        <div>{p.footer}</div>
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
        <div style={{ marginTop: 4 }}>No reemplaza la factura electrónica DIAN.</div>
      </div>
      <div style={{ height: "6mm" }} />
    </div>
  );
}
