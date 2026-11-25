import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Ajustes de un punto con crédito (20261342): lo que falta baja su deuda con la bodega y lo que sobra la sube.
 * Vista previa antes de aplicar y aviso después. Los $ solo para quien ve la cuenta con puntos, costos o rentabilidad.
 * Sin la migración, no se muestra nada (el ajuste funciona igual que antes).
 */

type Preview = {
  ok: boolean; applies?: boolean; money?: boolean; point?: string;
  short_units?: number; short_value?: number; over_units?: number; over_value?: number;
  balance_before?: number; balance_after?: number; no_price?: number;
};

const money = (n: number) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("es-CO")}`;
/** Saldo: si es negativo queda a favor del punto. */
const owes = (n: number) => (Number(n) < 0 ? `${money(n)} a favor del punto` : money(n));
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML para el resumen antes de aplicar ("" si el punto no tiene crédito o no hay diferencias). */
export async function debtPreviewHtml(storeId: string, warehouseId: string, items: Array<{ product_id: string; qty_after: number }>): Promise<string> {
  try {
    const { data, error } = await supabaseBrowser().rpc("erp_adjustment_debt_preview", { p_store: storeId, p_warehouse: warehouseId, p_items: items });
    const r = data as Preview | null;
    if (error || !r?.ok || !r.applies) return "";
    const short = Number(r.short_units ?? 0), over = Number(r.over_units ?? 0);
    if (!short && !over) return "";
    const point = esc(r.point ?? "el punto");
    const box = (inner: string) =>
      `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in oklab,#0ea5e9 40%,transparent);background:color-mix(in oklab,#0ea5e9 8%,transparent);text-align:left;font-size:13px;line-height:1.55">${inner}</div>`;
    if (!r.money) {
      return box(`🤝 <b>${point}</b> tiene crédito con la bodega: lo que falta (${short} und.) <b>baja su deuda</b> y lo que sobra (${over} und.) <b>la sube</b>, a precio de bodega.`);
    }
    const net = Number(r.balance_after ?? 0) - Number(r.balance_before ?? 0);
    const parts = [
      short ? `➖ Faltan ${short} und.: baja <b style="color:#10b981">${money(r.short_value ?? 0)}</b>` : "",
      over ? `➕ Sobran ${over} und.: sube <b style="color:#ef4444">${money(r.over_value ?? 0)}</b>` : "",
    ].filter(Boolean).join("<br>");
    return box(`🤝 <b>Deuda de ${point} con la bodega</b><br>${parts}<br>`
      + `Debe ${owes(r.balance_before ?? 0)} → queda <b>${owes(r.balance_after ?? 0)}</b> (${net < 0 ? "baja" : "sube"} ${money(net)})`
      + (r.no_price ? `<br><small style="opacity:.8">${r.no_price} producto(s) sin costo no mueven la deuda.</small>` : ""));
  } catch {
    return "";
  }
}

/** Después de aplicar: texto del aviso con cómo quedó la deuda (null si no aplica). */
export async function debtAfterText(adjustmentId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseBrowser().rpc("erp_adjustment_debt", { p_adjustment: adjustmentId });
    const r = data as { ok: boolean; applies?: boolean; money?: boolean; point?: string; kind?: string; amount?: number; balance_after?: number } | null;
    if (error || !r?.ok || !r.applies) return null;
    if (!r.money) return `La deuda de ${r.point ?? "el punto"} con la bodega ${r.kind === "loss" ? "bajó" : "subió"} por este ajuste.`;
    return `Deuda de ${r.point ?? "el punto"}: ${Number(r.amount) < 0 ? "bajó" : "subió"} ${money(r.amount ?? 0)} · queda ${owes(r.balance_after ?? 0)}.`;
  } catch {
    return null;
  }
}
