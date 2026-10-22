"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Cliente fiel (20261230): clientes con puntos por su cédula, historial y ajustes (regalar o quitar con motivo).
 * La configuración (tasa general y por punto de venta) está en Mi tienda → Cliente fiel.
 */

type Row = { doc: string; name: string | null; orders: number; last_at: string | null; earned: number; used: number; adjusted: number; points: number };
type Hist = { at: string; kind: "earn" | "redeem" | "adjust"; points: number; detail: string; point?: string | null; by?: string | null };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const box = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" };
const esc = (t: string) => t.replace(/[<>&"]/g, "");

export function LoyaltyCustomers({ storeId, canAdjust }: { storeId: string; canAdjust: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [pointValue, setPointValue] = useState(10);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_loyalty_customers", { p_store: storeId });
    const r = data as { ok: boolean; error?: string; enabled?: boolean; point_value?: number; customers?: Row[] } | null;
    if (e || !r?.ok) { setError(e && /Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261230_puntos_por_cedula.sql." : r?.error ?? e?.message ?? "No se pudo cargar."); setRows([]); return; }
    setEnabled(Boolean(r.enabled)); setPointValue(Number(r.point_value ?? 10)); setRows(r.customers ?? []); setError("");
  }, [storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const shown = useMemo(() => {
    const w = q.trim().toLowerCase().replace(/[.\s-]/g, "");
    return (rows ?? []).filter((r) => !w || r.doc.toLowerCase().includes(w) || (r.name ?? "").toLowerCase().replace(/\s/g, "").includes(w));
  }, [rows, q]);

  async function history(r: Row) {
    const { data } = await supabaseBrowser().rpc("erp_loyalty_history", { p_store: storeId, p_doc: r.doc });
    const items = ((data as { items?: Hist[] } | null)?.items ?? []);
    const label = { earn: "🛍️", redeem: "🎁", adjust: "✍️" } as const;
    await Swal.fire({
      title: `⭐ ${esc(r.name ?? r.doc)}`,
      html: `<p style="font-size:13px">Documento ${esc(r.doc)} · <b>${r.points} puntos</b> (${money(r.points * pointValue)})</p>
        <div style="text-align:left;max-height:50vh;overflow:auto;font-size:12px;line-height:1.6">${items.map((h) => `${label[h.kind]} ${new Date(h.at).toLocaleDateString("es-CO")} · <b style="color:${h.points >= 0 ? "#10b981" : "#ef4444"}">${h.points > 0 ? "+" : ""}${h.points}</b> · ${esc(h.detail ?? "")}${h.point ? ` · ${esc(h.point)}` : ""}${h.by ? ` · ${esc(h.by)}` : ""}`).join("<br>") || "Sin movimientos."}</div>`,
      ...swal,
    });
  }
  async function adjust(r: Row) {
    const res = await Swal.fire({
      title: `Ajustar puntos · ${esc(r.name ?? r.doc)}`,
      html: `<p style="font-size:13px">Tiene <b>${r.points}</b> puntos. Escribe un número positivo para regalar o negativo para quitar.</p><input id="pts" class="swal2-input" placeholder="Ej. 100 o -50" inputmode="numeric">`,
      input: "text", inputPlaceholder: "Motivo (ej. cumpleaños, error en una venta)", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      preConfirm: (reason) => ({ reason: String(reason ?? ""), points: Number(((document.getElementById("pts") as HTMLInputElement | null)?.value ?? "").replace(/[^\d-]/g, "")) }), ...swal,
    });
    if (!res.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_loyalty_adjust", { p_store: storeId, p_doc: r.doc, p_points: res.value.points, p_reason: res.value.reason, p_name: r.name });
    const v = data as { ok: boolean; error?: string } | null;
    if (e || !v?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: e?.message ?? v?.error, ...swal });
    void load();
  }
  async function newAdjust() {
    const res = await Swal.fire({
      title: "Regalar puntos",
      html: `<input id="doc" class="swal2-input" placeholder="Cédula o NIT *"><input id="nm" class="swal2-input" placeholder="Nombre (opcional)"><input id="pts" class="swal2-input" placeholder="Puntos *" inputmode="numeric">`,
      input: "text", inputPlaceholder: "Motivo *", showCancelButton: true, confirmButtonText: "Regalar", cancelButtonText: "Cancelar",
      preConfirm: (reason) => ({
        reason: String(reason ?? ""), doc: (document.getElementById("doc") as HTMLInputElement).value, name: (document.getElementById("nm") as HTMLInputElement).value,
        points: Number((document.getElementById("pts") as HTMLInputElement).value.replace(/\D/g, "")),
      }), ...swal,
    });
    if (!res.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_loyalty_adjust", { p_store: storeId, p_doc: res.value.doc, p_points: res.value.points, p_reason: res.value.reason, p_name: res.value.name });
    const v = data as { ok: boolean; error?: string } | null;
    if (e || !v?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: e?.message ?? v?.error, ...swal });
    void load();
  }

  const total = (rows ?? []).reduce((s, r) => s + r.points, 0);
  return (
    <section className="space-y-4">
      {error ? <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)" }}>⚠️ {error}</p> : null}
      {!enabled && !error ? <p className="rounded-2xl border p-4 text-sm" style={box}>El programa de puntos está apagado. Enciéndelo en <b>Mi tienda → Cliente fiel</b> (ahí pones cuánto gana el cliente en general y en cada punto de venta).</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input className="w-full rounded-full border py-2 pr-4 text-sm outline-none" style={{ ...box, paddingLeft: "2.3rem", color: "var(--t-text)" }} placeholder="Buscar por cédula o nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canAdjust ? <button type="button" onClick={() => void newAdjust()} className="rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>🎁 Regalar puntos</button> : null}
        {rows?.length ? <span className="text-sm" style={{ color: "var(--t-muted)" }}>{rows.length} clientes · {total.toLocaleString("es-CO")} puntos ({money(total * pointValue)}) por canjear</span> : null}
      </div>
      {rows && !shown.length && enabled && !error ? <p className="rounded-2xl border p-6 text-center text-sm" style={{ ...box, color: "var(--t-muted)" }}>Todavía nadie tiene puntos. Escribe la cédula o NIT del cliente al vender y empezará a sumar.</p> : null}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {shown.slice(0, 200).map((r) => (
          <div key={r.doc} className="rounded-2xl border p-3 text-sm" style={box}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><b className="block truncate">{r.name ?? "Sin nombre"}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>Doc. {r.doc} · {r.orders} compra(s)</span></div>
              <span className="shrink-0 text-right"><b className="block text-lg">⭐ {r.points}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{money(r.points * pointValue)}</span></span>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Ganó {r.earned}{r.adjusted ? ` · ajustes ${r.adjusted > 0 ? "+" : ""}${r.adjusted}` : ""}{r.used ? ` · canjeó ${r.used}` : ""}</p>
            <div className="mt-2 flex gap-2 text-xs">
              <button type="button" onClick={() => void history(r)} className="rounded-lg border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>📜 Historial</button>
              {canAdjust ? <button type="button" onClick={() => void adjust(r)} className="rounded-lg border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>✍️ Ajustar</button> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
