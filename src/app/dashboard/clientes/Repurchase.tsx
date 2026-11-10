"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fillMessage, waLink } from "@/lib/features";

type Due = {
  name: string; phone: string; orders: number; total: number; avg: number; days_since: number; every_days: number | null;
  top: string[]; reason: string; contacted_at: string | null;
};
type Bday = { id: string; name: string; phone: string | null; birthday: string; days_until: number; contacted: boolean };
type HistOrder = { id: string; receipt_no: number | null; at: string; total: number; status: string; point: string | null; items: Array<{ name: string; qty: number; price: number; image_url: string | null }> };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const dmy = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
const first = (n: string) => { const w = n.trim().split(/\s+/)[0] ?? ""; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
const DEF_RE = "Hola {cliente} 👋, hace {dias} días llevaste {producto} en {tienda}. ¿Te mando lo nuevo o te separo otro? 😊";
const DEF_BD = "¡Feliz cumpleaños, {cliente}! 🎂🎉 En {tienda} te queremos consentir hoy. Escríbenos y te tenemos un detalle.";

/** Recompra y cumpleaños (función opcional 20261313): a quién escribirle hoy y el historial de cada cliente. */
export function Repurchase({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [data, setData] = useState<{ due: Due[]; birthdays: Bday[]; settings: Record<string, unknown>; days: number } | null>(null);
  const [error, setError] = useState("");
  const [hist, setHist] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabaseBrowser().rpc("erp_repurchase", { p_store: storeId });
    const r = d as { ok: boolean; message?: string; due?: Due[]; birthdays?: Bday[]; settings?: Record<string, unknown>; days?: number } | null;
    if (e || !r?.ok) return setError(e && /Could not find|schema cache/i.test(e.message) ? "Falta correr en Supabase la migración 20261313_clientes_y_operacion_opcional.sql." : e?.message ?? r?.message ?? "No se pudo leer.");
    setError("");
    setData({ due: r.due ?? [], birthdays: r.birthdays ?? [], settings: r.settings ?? {}, days: r.days ?? 0 });
  }, [storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function mark(who: string, kind: "recompra" | "cumple") {
    await supabaseBrowser().rpc("erp_repurchase_mark", { p_store: storeId, p_who: who, p_kind: kind });
  }
  function writeDue(c: Due) {
    const tpl = String(data?.settings.message ?? "") || DEF_RE;
    window.open(waLink(c.phone, fillMessage(tpl, { cliente: first(c.name), dias: String(c.days_since), producto: c.top[0] ?? "lo que te gustó", tienda: storeName })), "_blank", "noopener");
    void mark(c.name, "recompra");
    setData((p) => (p ? { ...p, due: p.due.filter((x) => x.name !== c.name) } : p));
  }
  function writeBday(b: Bday) {
    if (!b.phone) return;
    const tpl = String(data?.settings.birthday ?? "") || DEF_BD;
    window.open(waLink(b.phone, fillMessage(tpl, { cliente: first(b.name), tienda: storeName })), "_blank", "noopener");
    void mark(b.name, "cumple");
    setData((p) => (p ? { ...p, birthdays: p.birthdays.map((x) => (x.id === b.id ? { ...x, contacted: true } : x)) } : p));
  }

  if (error) return <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f59e0b" }}>⚠️ {error}</p>;
  if (!data) return <p className="text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="mr-1 inline animate-spin" /> Buscando a quién escribirle…</p>;

  return (
    <section className="space-y-5">
      <div className="vm-hero rounded-[24px] border p-4" style={{ borderColor: "var(--t-card-border)" }}>
        <h2 className="text-lg font-black">🔁 Recompra y cumpleaños</h2>
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>
          {data.days > 0 ? `Clientes que llevan ${data.days} días o más sin comprar.` : "Clientes que ya deberían volver según cada cuánto compran."} Al escribirle sale de la lista por 14 días.
          {" "}El mensaje se cambia en Funciones opcionales → Recompra → Ajustes.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-black uppercase tracking-wide" style={{ color: "#ec4899" }}>🎂 Cumpleaños esta semana ({data.birthdays.length})</h3>
        {data.birthdays.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.birthdays.map((b) => (
              <li key={b.id} className="vm-row flex items-center gap-3 rounded-2xl border p-3" style={{ borderColor: b.days_until === 0 ? "#ec4899" : "var(--t-card-border)", background: b.days_until === 0 ? "color-mix(in oklab, #ec4899 9%, transparent)" : undefined }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: "color-mix(in oklab, #ec4899 15%, transparent)" }} aria-hidden>{b.days_until === 0 ? "🎉" : "🎂"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold">{b.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{b.days_until === 0 ? "¡Hoy!" : b.days_until === 1 ? "Mañana" : `En ${b.days_until} días`} · {b.phone ?? "Sin celular"}</p>
                </div>
                {b.contacted ? <span className="text-[11px] font-bold" style={{ color: "#10b981" }}>✅ Saludado</span> : b.phone ? (
                  <button type="button" onClick={() => writeBday(b)} className="shrink-0 rounded-xl px-3 py-2 text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#ec4899,#f97316)" }}>🎁 Felicitar</button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="rounded-2xl border border-dashed p-4 text-center text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Nadie cumple esta semana. La fecha de cumpleaños se pone en la ficha del cliente (Terceros).</p>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-black uppercase tracking-wide" style={{ color: "#f59e0b" }}>🔁 Ya deberían volver ({data.due.length})</h3>
        {data.due.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.due.map((c) => (
              <li key={c.name} className="vm-row rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{c.name}</p>
                    <p className="text-[11px] font-bold" style={{ color: "#f59e0b" }}>⏰ {c.reason}</p>
                    <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{c.orders} compra(s) · {money(c.total)} · le gusta: {c.top.slice(0, 2).join(", ") || "—"}</p>
                  </div>
                  <p className="shrink-0 text-right text-xs font-black">{money(c.avg)}<span className="block text-[10px] font-bold opacity-60">por compra</span></p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => writeDue(c)} className="rounded-xl px-3 py-2 text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}>💬 Escribirle</button>
                  <button type="button" onClick={() => setHist(c.name)} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>🧾 Historial</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-2xl border border-dashed p-4 text-center text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>🎉 Tus clientes están al día. Cuando alguien tarde más de lo normal en volver, aparece aquí.</p>}
      </div>

      {hist ? <CustomerHistory storeId={storeId} name={hist} onClose={() => setHist(null)} /> : null}
    </section>
  );
}

/** Historial de compras de un cliente (por el nombre como queda en el documento). */
export function CustomerHistory({ storeId, name, onClose }: { storeId: string; name: string; onClose: () => void }) {
  const [orders, setOrders] = useState<HistOrder[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void supabaseBrowser().rpc("erp_customer_history", { p_store: storeId, p_name: name, p_limit: 40 }).then(({ data, error: e }) => {
      const r = data as { ok: boolean; message?: string; orders?: HistOrder[] } | null;
      if (e || !r?.ok) setError(e?.message ?? r?.message ?? "No se pudo leer.");
      else setOrders(r.orders ?? []);
    });
  }, [storeId, name]);
  const total = (orders ?? []).reduce((a, o) => a + Number(o.total), 0);
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-end bg-black/50 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Historial de ${name}`}>
      <div className="vm-sheet max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border p-5 sm:rounded-[28px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-black">🧾 {name}</h3>
            {orders ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{orders.length} compra(s) · {money(total)}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">✕</button>
        </div>
        {error ? <p className="mt-3 text-sm" style={{ color: "#ef4444" }}>{error}</p> : null}
        {!orders && !error ? <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="mr-1 inline animate-spin" /> Cargando…</p> : null}
        <ol className="mt-4 space-y-3">
          {(orders ?? []).map((o) => (
            <li key={o.id} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-black">{dmy(o.at)}{o.receipt_no ? ` · #${o.receipt_no}` : ""}{o.point ? ` · ${o.point}` : ""}</span>
                <span className="font-black">{money(o.total)}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {o.items.map((i, k) => (
                  <li key={k} className="flex items-center gap-2 text-xs">
                    {i.image_url ? <img src={i.image_url} alt="" loading="lazy" className="h-7 w-7 rounded-lg object-cover" /> : <span className="grid h-7 w-7 place-items-center">🛍️</span>}
                    <span className="min-w-0 flex-1 truncate">{i.qty}× {i.name}</span>
                    <span className="opacity-70">{money(i.price)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
