"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Facturación electrónica como adicional del plan (20261241): paquete de documentos al mes, uso del mes,
 * documentos extra y cobros pendientes. Se paga aparte del plan (Wompi de RemHub o por WhatsApp).
 */

type Addon = { id: string; name: string; tagline: string | null; monthly_price: number; yearly_price: number; included_docs: number; overage_price: number; highlight: boolean };
type State = {
  active: boolean; addon: (Addon & { monthly_price: number; yearly_price: number }) | null; until: string | null; expired: boolean; period: string;
  used: number; included: number; extra: number; unit_price: number; extra_cost: number; open_overages: number; enforce: boolean;
};
type Overage = { id: string; period: string; included: number; used: number; extra: number; unit_price: number; amount: number; status: "open" | "paid" | "waived"; paid_at: string | null; note: string | null };
type My = { ok: boolean; error?: string; state: State; is_owner: boolean; addons: Addon[]; overages: Overage[]; history: Array<{ period: string; used: number }> };

const REMHUB_WHATSAPP = process.env.NEXT_PUBLIC_REMHUB_WHATSAPP || "573218846041";
const cop = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1] ?? p} ${p.slice(0, 4)}`;
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

export function FiscalAddonCard({ storeId, period }: { storeId: string; period: "month" | "year" }) {
  const [my, setMy] = useState<My | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("saas_my_fiscal", { p_store: storeId });
    if (error) return setMissing(/saas_my_fiscal|Could not find|schema cache/i.test(error.message));
    setMy(data as My);
  }, [storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function pay(what: "addon" | "overages" | "both", addon: Addon | null, label: string, amount: number) {
    const ok = await Swal.fire({
      ...swal, icon: "question", title: label, showCancelButton: true, confirmButtonText: "Continuar", cancelButtonText: "Volver",
      html: `<p><b>${cop(amount)}</b></p><p style="font-size:12px;opacity:.75;margin-top:8px">Se paga aparte de tu plan. No es un cobro automático: te avisamos antes de que venza.</p>`,
    });
    if (!ok.isConfirmed) return;
    setBusy(addon?.id ?? what);
    const { data: s } = await supabaseBrowser().auth.getSession();
    const res = await fetch("/api/saas/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
      body: JSON.stringify({ storeId, kind: "fiscal", addon: addon?.id ?? "", what, period }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !j?.url) {
      if (j?.error && res?.status === 400) return void Swal.fire({ ...swal, icon: "info", title: "No se pudo", text: j.error });
      const text = `Hola! Quiero ${label.toLowerCase()} de RemHub (${cop(amount)}) para mi tienda. ¿Cómo pago?`;
      const r = await Swal.fire({ ...swal, icon: "info", title: "Págalo por WhatsApp", html: "Te enviamos los datos para pagar (transferencia o Nequi) y lo dejamos activo apenas recibamos el pago.", showCancelButton: true, confirmButtonText: "💬 Escribir por WhatsApp", cancelButtonText: "Ahora no", confirmButtonColor: "#22c55e" });
      if (r.isConfirmed) window.open(`https://wa.me/${REMHUB_WHATSAPP}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      return;
    }
    window.location.href = j.url;
  }

  if (missing) return null;
  if (!my?.ok) return null;
  const st = my.state;
  const owner = my.is_owner;
  const pct = st.included ? Math.min(100, Math.round((st.used / st.included) * 100)) : 0;
  const open = my.overages.filter((o) => o.status === "open");
  const priceOf = (a: Addon) => (period === "year" ? a.yearly_price : a.monthly_price);

  return (
    <section className="rounded-3xl border p-5" style={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Adicional</p>
          <h2 className="mt-1 text-2xl font-black">🧾 Facturación electrónica</h2>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Factura electrónica y documento POS ante la DIAN. Lo activas si lo necesitas, en cualquier plan.</p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-bold" style={st.active ? { background: "rgba(16,185,129,.15)", color: "#10b981" } : st.expired ? { background: "rgba(239,68,68,.15)", color: "#ef4444" } : { background: "rgba(148,163,184,.15)", color: "#94a3b8" }}>
          {st.active ? `Activo · ${st.addon?.name ?? ""}` : st.expired ? "Vencido" : "No activo"}
        </span>
      </div>

      {st.active || st.used > 0 ? (
        <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>Documentos de {monthName(st.period)}</span>
            <b>{st.used.toLocaleString("es-CO")} {st.included ? `de ${st.included.toLocaleString("es-CO")}` : ""}</b>
          </div>
          {st.included ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "linear-gradient(90deg,#8b5cf6,#3987e5)" }} />
            </div>
          ) : null}
          <p className="mt-2 text-xs" style={{ color: st.extra ? "#f59e0b" : "var(--t-muted)" }}>
            {st.extra
              ? `Vas ${st.extra} documento${st.extra === 1 ? "" : "s"} por encima${st.included ? " de tu paquete" : " (sin paquete)"}: ${cop(st.unit_price)} c/u · ${cop(st.extra_cost)} hasta ahora. Se cobra al cerrar el mes.`
              : st.active ? `Te quedan ${(st.included - st.used).toLocaleString("es-CO")} este mes. Los de más se cobran a ${cop(st.unit_price)} c/u.` : ""}
          </p>
          {st.active && st.until ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Paquete pagado hasta el <b>{date(st.until)}</b>.</p> : st.active ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Paquete sin vencimiento.</p> : null}
          <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Cuentan los documentos aceptados por la DIAN en el mes (hora de Colombia). Las pruebas no cuentan.</p>
        </div>
      ) : null}

      {!st.active && st.enforce ? <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">⚠️ Sin el adicional no puedes emitir documentos electrónicos ante la DIAN. Actívalo abajo.</p> : null}

      {open.length ? (
        <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, #f59e0b 50%, var(--t-card-border))", background: "rgba(245,158,11,.06)" }}>
          <p className="text-sm font-bold">Documentos extra por pagar: {cop(st.open_overages)}</p>
          <ul className="mt-1 text-xs">{open.map((o) => <li key={o.id}>• {monthName(o.period)}: {o.used} usados{ o.included ? ` de ${o.included}` : ""} → {o.extra} extra × {cop(o.unit_price)} = <b>{cop(o.amount)}</b></li>)}</ul>
          {owner ? <button type="button" disabled={!!busy} onClick={() => void pay("overages", null, "Pagar documentos extra", st.open_overages)} className="mt-2 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60" style={{ background: "#f59e0b" }}>{busy === "overages" ? "Abriendo pago…" : `Pagar ${cop(st.open_overages)}`}</button> : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {my.addons.map((a) => {
          const current = st.active && st.addon?.id === a.id;
          const price = current ? (period === "year" ? st.addon!.yearly_price : st.addon!.monthly_price) : priceOf(a);
          return (
            <div key={a.id} className="relative flex flex-col rounded-2xl border p-4" style={{ borderColor: a.highlight ? "color-mix(in oklab, var(--t-accent) 60%, transparent)" : "var(--t-card-border)" }}>
              {a.highlight ? <span className="absolute -top-2.5 left-4 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white" style={{ background: "var(--t-accent)" }}>Recomendado</span> : null}
              <p className="font-black">{a.name}</p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{a.tagline}</p>
              <p className="mt-2 text-2xl font-black">{cop(price)}</p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{period === "year" ? `al año · ${cop(price / 12)}/mes` : "al mes"}</p>
              <ul className="mt-2 flex-1 space-y-1 text-sm">
                <li>✓ {a.included_docs.toLocaleString("es-CO")} documentos al mes</li>
                <li>✓ Extra: {cop(a.overage_price)} por documento</li>
                <li>✓ Factura, POS y notas</li>
              </ul>
              {owner ? (
                <button type="button" disabled={!!busy} onClick={() => void pay(open.length ? "both" : "addon", a, current ? `Renovar ${a.name}` : `Activar ${a.name}`, price + (open.length ? st.open_overages : 0))}
                  className="mt-3 rounded-xl px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60" style={{ background: a.highlight ? "linear-gradient(135deg,#8b5cf6,#d946ef)" : "var(--t-accent)" }}>
                  {busy === a.id ? "Abriendo pago…" : current ? "Renovar" : st.active ? "Cambiar a este" : "Activar"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {open.length && owner ? <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Al activar o renovar un paquete se suman los documentos extra pendientes.</p> : null}
      {!owner ? <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>Solo el dueño de la tienda puede activar o pagar la facturación electrónica.</p> : null}

      {my.history.some((h) => h.used > 0) ? (
        <div className="mt-4 text-xs" style={{ color: "var(--t-muted)" }}>
          <p className="font-bold">Documentos aceptados por mes</p>
          <div className="mt-1 flex flex-wrap gap-2">{my.history.map((h) => <span key={h.period} className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>{monthName(h.period)}: <b style={{ color: "var(--t-text)" }}>{h.used}</b></span>)}</div>
        </div>
      ) : null}
    </section>
  );
}
