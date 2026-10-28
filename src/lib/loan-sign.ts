// Firma de vales a empleados (20261262): lo que se acepta al firmar, igual en el enlace y en el vale impreso.

export type LoanTerms = {
  number: number; employee: string; document: string | null; kind: "product" | "cash"; description: string;
  items: Array<{ name: string; qty: number; price: number }>; principal: number; interest: number; interest_mode: string; interest_pct: number;
  total: number; installments: number; installment: number; pay_frequency: "weekly" | "biweekly" | "monthly"; start_on: string;
};
export type LoanSignature = { role: "employee" | "giver"; name: string; doc: string | null; signature: string; at: string };

const cop = (v: unknown) => `$${Math.round(Number(v ?? 0)).toLocaleString("es-CO")}`;
const fdate = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
export const LOAN_EVERY: Record<LoanTerms["pay_frequency"], string> = { weekly: "cada semana", biweekly: "cada quincena", monthly: "cada mes" };

/** Reconocimiento de deuda y autorización de descuento de nómina (art. 149 CST). */
export function loanDeclaration(t: LoanTerms, store: string) {
  const what = t.kind === "product" ? "los productos descritos, a satisfacción y en buen estado," : `la suma de ${cop(t.principal)} en calidad de préstamo`;
  return `Yo, ${t.employee}${t.document ? `, identificado(a) con documento ${t.document}` : ""}, declaro que recibí ${what} y reconozco que debo a ${store} la suma total de ${cop(t.total)}${t.interest ? ` (incluye ${cop(t.interest)} de interés)` : ""}. Autorizo de manera libre, expresa y voluntaria que este valor me sea descontado de mi salario en ${t.installments} cuota${t.installments === 1 ? "" : "s"} de ${cop(t.installment)} ${LOAN_EVERY[t.pay_frequency]}, a partir del ${fdate(t.start_on)}. Si mi contrato termina antes de completar el pago, autorizo que el saldo pendiente se descuente de mi liquidación (artículo 149 del Código Sustantivo del Trabajo).`;
}

export const loanSignUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/firma-vale/${token}`;
