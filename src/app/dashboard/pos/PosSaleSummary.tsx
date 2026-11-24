"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import type { PointReadiness } from "@/lib/fiscal/types";

/** Lo que se sabe de la venta antes de cobrar: con esto se arma la frase «qué va a pasar». */
export type SaleSummaryInput = {
  /** Número del documento que se está editando (si es una edición). */
  editing: string | null;
  documentKind: "remision" | "factura";
  fiscalOn: boolean;
  fiscal: PointReadiness | null;
  /** Factura normal con factura electrónica de Siigo pedida. */
  siigo: boolean;
  pointName: string | null;
  /** Próximo número del documento (en la factura electrónica lo confirma el servidor al crear). */
  nextNumber: string | null;
  clientName: string;
  clientDoc: string | null;
  units: number;
  total: number;
  paymentType: "contado" | "credito";
  /** «💵 Efectivo · vuelto $5.000», «🏦 Transferencia»… */
  payLabel: string;
  dueDays: number;
  sellerName: string | null;
  printLabel: string;
  /** Sin conexión: «internet» o «base de datos». */
  offline: string | null;
  contingencyLeft: number;
  money: (n: number) => string;
};

type Tone = "ok" | "warn" | "bad";

const pad = (n: number) => String(n).padStart(2, "0");
/** DD/MM/AAAA. */
export function ddmmyyyy(d: Date) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** La frase corta (con lo importante en negrilla) y el detalle para quien quiera ver más. */
export function describeSale(s: SaleSummaryInput): { tone: Tone; text: ReactNode; details: Array<[string, string]> } {
  const units = `${s.units} und.`;
  const from = s.pointName ? <> de <b>{s.pointName}</b></> : <> del inventario</>;
  const client = <b>{s.clientName}</b>;
  const credit = s.paymentType === "credito"
    ? <> Queda debiendo <b>{s.money(s.total)}</b> a {s.dueDays} días (vence el {ddmmyyyy(new Date(Date.now() + s.dueDays * 86400000))}).</>
    : null;
  const electronic = s.documentKind === "factura" && s.fiscalOn;
  const kindName = electronic ? "Factura electrónica" : s.documentKind === "factura" ? (s.siigo ? "Factura (electrónica por Siigo)" : "Factura (no electrónica)") : "Remisión";

  const details: Array<[string, string]> = [["Documento", kindName]];
  if (s.nextNumber) details.push(["Número", electronic ? `${s.nextNumber} · el número exacto lo da el servidor al crear` : s.nextNumber]);
  if (electronic && s.fiscal) {
    if (s.fiscal.range) details.push(["Resolución", `quedan ${s.fiscal.range.remaining.toLocaleString("es-CO")} números`]);
    details.push(["Ambiente", s.fiscal.environment === "production" ? "🟢 Producción (vale ante la DIAN)" : "🧪 Pruebas (no vale ante la DIAN)"]);
    if (s.fiscal.entity) details.push(["Factura a nombre de", `${s.fiscal.entity.legal_name} · NIT ${s.fiscal.entity.document_number ?? "—"}${s.fiscal.entity.verification_digit ? `-${s.fiscal.entity.verification_digit}` : ""}`]);
    if (s.fiscal.provider) details.push(["Proveedor", s.fiscal.provider.name]);
  }
  details.push(["Sale de", s.pointName ?? "Sin punto"]);
  details.push(["Cliente", `${s.clientName}${s.clientDoc ? ` · ${s.clientDoc}` : ""}`]);
  details.push(["Pago", s.paymentType === "credito" ? `💳 Crédito a ${s.dueDays} días` : s.payLabel]);
  if (s.sellerName) details.push(["Vendedor", s.sellerName]);
  details.push(["Impresión", s.printLabel]);
  details.push(["Conexión", s.offline ? `⚠️ Sin ${s.offline}` : "🟢 En línea"]);
  if (electronic && s.fiscal) for (const w of s.fiscal.warnings) details.push(["Aviso", w]);

  if (s.editing) return { tone: "ok", text: <>Se guardan los cambios en <b>{s.editing}</b>: productos, cantidades y precios.</>, details };

  if (s.offline) {
    if (electronic && s.contingencyLeft) {
      return { tone: "warn", text: <>Sin {s.offline}: sale una <b>factura de contingencia</b> a {client} y se reporta a la DIAN cuando vuelva la conexión.{credit}</>, details };
    }
    if (electronic) return { tone: "warn", text: <>Sin {s.offline}: la factura se guarda en este equipo y <b>se emite sola</b> cuando vuelva la conexión.</>, details };
    return { tone: "warn", text: <>Sin {s.offline}: la venta se guarda en este equipo y <b>se envía sola</b> cuando vuelva la conexión.</>, details };
  }

  if (electronic) {
    if (!s.fiscal) return { tone: "warn", text: <>Revisando si este punto puede hacer factura electrónica…</>, details };
    if (!s.fiscal.ready) {
      return {
        tone: "bad",
        text: <>Este punto <b>no puede hacer factura electrónica</b>{s.fiscal.missing[0] ? `: ${s.fiscal.missing[0]}` : ""}. Cambia a <b>Remisión</b> mientras se completa la configuración.</>,
        details: [...details, ...s.fiscal.missing.map((m): [string, string] => ["Falta", m])],
      };
    }
    const test = s.fiscal.environment !== "production";
    return {
      tone: test ? "warn" : "ok",
      text: <>Se crea la <b>factura electrónica{s.nextNumber ? ` ${s.nextNumber}` : ""}</b> a {client}, se descuentan <b>{units}</b>{from} y <b>se envía a la DIAN</b>.{test ? " 🧪 Está en pruebas: no vale ante la DIAN." : ""}{credit}</>,
      details,
    };
  }

  const num = s.nextNumber ? ` ${s.nextNumber}` : "";
  if (s.documentKind === "factura") {
    return {
      tone: "ok",
      text: <>Se crea la <b>factura{num}</b> a {client} y se descuentan <b>{units}</b>{from}. {s.siigo ? "Se pide la factura electrónica a Siigo." : "No es electrónica: no va a la DIAN."}{credit}</>,
      details,
    };
  }
  return { tone: "ok", text: <>Se crea la <b>remisión{num}</b> a {client} y se descuentan <b>{units}</b>{from}. No va a la DIAN.{credit}</>, details };
}

const TONE: Record<Tone, { icon: string; border: string; bg: string }> = {
  ok: { icon: "📋", border: "var(--t-card-border)", bg: "color-mix(in oklab, var(--t-card-bg) 88%, transparent)" },
  warn: { icon: "🟠", border: "rgba(245,158,11,.45)", bg: "rgba(245,158,11,.08)" },
  bad: { icon: "⛔", border: "rgba(239,68,68,.5)", bg: "rgba(239,68,68,.09)" },
};

/** Una sola frase con lo que hace la venta; el «?» abre el detalle. */
export function SaleSummary({ input, className = "" }: { input: SaleSummaryInput; className?: string }) {
  const [open, setOpen] = useState(false);
  const { tone, text, details } = describeSale(input);
  const t = TONE[tone];
  return (
    <div className={`rounded-2xl border px-3 py-2 text-xs leading-snug ${className}`} style={{ borderColor: t.border, background: t.bg }}>
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-px shrink-0">{t.icon}</span>
        <p className="min-w-0 flex-1">{text}</p>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Ocultar el detalle" : "Ver el detalle de la venta"}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-black" style={{ borderColor: "var(--t-card-border)", background: open ? "var(--t-accent)" : "transparent", color: open ? "#fff" : "var(--t-text)" }}>
          {open ? "×" : "?"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.dl initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: "var(--t-card-border)" }}>
              {details.map(([k, v], i) => (
                <div key={`${k}-${i}`} className="flex gap-2">
                  <dt className="w-24 shrink-0 font-semibold" style={{ color: "var(--t-muted)" }}>{k}</dt>
                  <dd className="min-w-0 flex-1 break-words">{v}</dd>
                </div>
              ))}
            </div>
          </motion.dl>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
