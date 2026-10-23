"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Facturación electrónica como adicional (20261241), vista del administrador de RemHub:
 * paquetes (precio, documentos incluidos, precio por extra), uso del mes de cada tienda, cobros de documentos extra,
 * dar o quitar el adicional a mano, cerrar un mes y el bloqueo (observar / frenar).
 */

type Addon = { id: string; name: string; tagline: string | null; monthly_price: number; yearly_price: number; included_docs: number; overage_price: number;
  public: boolean; active: boolean; highlight: boolean; sort_order: number; subscribers: number };
type StoreRow = { store_id: string; name: string; slug: string; active: boolean; expired: boolean; addon: { id: string; name: string } | null; until: string | null;
  used: number; included: number; extra: number; extra_cost: number; open_overages: number };
type Overage = { id: string; store_id: string; store_name: string; period: string; included: number; used: number; extra: number; unit_price: number; amount: number;
  status: "open" | "paid" | "waived"; payment_reference: string | null; note: string | null; paid_at: string | null };
type Overview = { ok: boolean; settings: { fiscal_enforce: boolean; fiscal_payg_price: number }; stores: StoreRow[]; overages: Overage[] };

const box = { borderColor: "var(--ap-card-border, rgba(255,255,255,.12))", background: "var(--ap-card-bg, rgba(255,255,255,.04))" } as const;
const muted = { color: "var(--ap-muted, #94a3b8)" } as const;
const swal = { background: "var(--t-bg-base, #0b0b14)", color: "var(--t-text, #fff)", confirmButtonColor: "#8b5cf6" };
const cop = (n: number | null | undefined) => `$${Math.round(Number(n ?? 0)).toLocaleString("es-CO")}`;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const esc = (t: unknown) => String(t ?? "").replace(/[<>&"]/g, "");
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function FiscalAdmin() {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [customers, setCustomers] = useState<Array<{ store_id: string; name: string }>>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [a, o, c] = await Promise.all([sb.rpc("saas_admin_addons"), sb.rpc("saas_admin_fiscal_overview"), sb.rpc("saas_admin_customers", { p_q: null, p_status: null, p_plan: null, p_limit: 1000, p_offset: 0 })]);
    setCustomers((((c.data as { rows?: Array<{ store_id: string; name: string }> } | null)?.rows) ?? []).map((x) => ({ store_id: x.store_id, name: x.name })));
    if (a.error || o.error) return setError(/saas_admin_|Could not find|schema cache/i.test((a.error ?? o.error)?.message ?? "") ? "Falta ejecutar en Supabase la migración 20261241_facturacion_electronica_planes.sql." : (a.error ?? o.error)!.message);
    setError(null);
    setAddons((a.data ?? []) as Addon[]);
    setOv(o.data as Overview);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function editAddon(a: Partial<Addon> | null) {
    const v = a ?? { id: "", name: "", tagline: "", monthly_price: 0, yearly_price: 0, included_docs: 100, overage_price: 400, public: true, active: true, highlight: false, sort_order: addons.length + 1 };
    const r = await Swal.fire({
      ...swal, title: a ? `Paquete ${esc(a.name)}` : "Nuevo paquete", width: 560, showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      html: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;font-size:12px">
        <label style="grid-column:span 2">Código<input id="a-id" class="swal2-input" style="margin:4px 0;width:100%" value="${esc(v.id)}" ${a ? "disabled" : ""} placeholder="fe_500"></label>
        <label style="grid-column:span 2">Nombre<input id="a-name" class="swal2-input" style="margin:4px 0;width:100%" value="${esc(v.name)}"></label>
        <label style="grid-column:span 2">Frase<input id="a-tag" class="swal2-input" style="margin:4px 0;width:100%" value="${esc(v.tagline ?? "")}"></label>
        <label>Documentos al mes<input id="a-docs" type="number" min="0" class="swal2-input" style="margin:4px 0;width:100%" value="${v.included_docs ?? 0}"></label>
        <label>Precio por extra ($)<input id="a-over" type="number" min="0" class="swal2-input" style="margin:4px 0;width:100%" value="${v.overage_price ?? 0}"></label>
        <label>Precio mensual ($)<input id="a-month" type="number" min="0" class="swal2-input" style="margin:4px 0;width:100%" value="${v.monthly_price ?? 0}"></label>
        <label>Precio anual ($)<input id="a-year" type="number" min="0" class="swal2-input" style="margin:4px 0;width:100%" value="${v.yearly_price ?? 0}"></label>
        <label>Orden<input id="a-sort" type="number" class="swal2-input" style="margin:4px 0;width:100%" value="${v.sort_order ?? 0}"></label>
        <div style="display:flex;flex-direction:column;gap:4px;justify-content:center">
          <label><input id="a-pub" type="checkbox" ${v.public ? "checked" : ""}> Se muestra en precios</label>
          <label><input id="a-act" type="checkbox" ${v.active ? "checked" : ""}> Se puede contratar</label>
          <label><input id="a-hi" type="checkbox" ${v.highlight ? "checked" : ""}> Destacado</label>
        </div>
        <label style="grid-column:span 2">Motivo del cambio<input id="a-why" class="swal2-input" style="margin:4px 0;width:100%" placeholder="Ej. Ajuste por costo de Alanube"></label>
      </div>
      <p style="font-size:11px;opacity:.7;margin-top:8px">Quien ya pagó el paquete renueva con su precio pactado. El nuevo precio aplica a quien lo active desde ahora.</p>`,
      preConfirm: () => {
        const g = (id: string) => (document.getElementById(id) as HTMLInputElement);
        return { p: { id: g("a-id").value, name: g("a-name").value, tagline: g("a-tag").value, included_docs: Number(g("a-docs").value), overage_price: Number(g("a-over").value),
          monthly_price: Number(g("a-month").value), yearly_price: Number(g("a-year").value), sort_order: Number(g("a-sort").value), public: g("a-pub").checked,
          active: g("a-act").checked, highlight: g("a-hi").checked }, why: g("a-why").value };
      },
    });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_save_addon", { p: r.value.p, p_reason: r.value.why });
    const res = data as { ok: boolean; error?: string } | null;
    if (e || !res?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: e?.message ?? res?.error });
    await load();
  }

  async function setStoreAddon(storeId?: string) {
    const opts = customers.map((c) => `<option value="${c.store_id}" ${c.store_id === storeId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    const r = await Swal.fire({
      ...swal, title: "Dar o quitar el adicional", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      html: `<div style="text-align:left;font-size:12px;display:grid;gap:6px">
        <label>Tienda<select id="s-store" class="swal2-select" style="margin:4px 0;width:100%">${opts}</select></label>
        <label>Paquete<select id="s-addon" class="swal2-select" style="margin:4px 0;width:100%"><option value="">— Quitar el adicional —</option>${addons.map((a) => `<option value="${a.id}">${esc(a.name)} (${a.included_docs} docs)</option>`).join("")}</select></label>
        <label>Vence (DD/MM/AAAA, vacío = sin vencimiento)<input id="s-until" class="swal2-input" style="margin:4px 0;width:100%" placeholder="30/11/2026"></label>
        <label>Motivo<input id="s-why" class="swal2-input" style="margin:4px 0;width:100%" placeholder="Pagó por transferencia / cortesía"></label></div>`,
      preConfirm: () => {
        const g = (id: string) => (document.getElementById(id) as HTMLInputElement);
        const u = g("s-until").value.trim();
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(u);
        if (u && !m) { Swal.showValidationMessage("La fecha debe ser DD/MM/AAAA."); return false; }
        return { store: g("s-store").value, addon: g("s-addon").value, until: m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null, why: g("s-why").value };
      },
    });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_set_fiscal_addon", { p_store: r.value.store, p_addon: r.value.addon || null, p_until: r.value.until, p_reason: r.value.why });
    const res = data as { ok: boolean; error?: string } | null;
    if (e || !res?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: e?.message ?? res?.error });
    await load();
  }

  async function overageSet(o: Overage, status: "paid" | "waived" | "open") {
    const r = await Swal.fire({ ...swal, title: status === "paid" ? `Marcar pagado ${cop(o.amount)}` : status === "waived" ? "Perdonar el cobro" : "Volver a abrir", input: "text",
      inputPlaceholder: status === "paid" ? "Cómo pagó (transferencia, Nequi…)" : "Motivo", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar" });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_overage_set", { p_id: o.id, p_status: status, p_note: String(r.value ?? "") });
    const res = data as { ok: boolean; error?: string } | null;
    if (e || !res?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: e?.message ?? res?.error });
    await load();
  }

  async function closeMonth() {
    const r = await Swal.fire({ ...swal, title: "Cerrar un mes", input: "text", inputValue: prevMonth(), inputPlaceholder: "AAAA-MM", showCancelButton: true, confirmButtonText: "Cerrar mes", cancelButtonText: "Cancelar",
      html: "<p style='font-size:12px'>Crea los cobros de documentos extra del mes (se hace solo el día 1). Si ya estaba cerrado no duplica nada.</p>" });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("saas_fiscal_close_month", { p_period: String(r.value).trim() });
    const res = data as { ok: boolean; error?: string; charges?: number } | null;
    if (e || !res?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: e?.message ?? res?.error });
    await Swal.fire({ ...swal, icon: "success", title: "Mes cerrado", text: `${res.charges ?? 0} cobro(s) nuevo(s) de documentos extra.` });
    await load();
  }

  async function settings() {
    if (!ov) return;
    const r = await Swal.fire({
      ...swal, title: "Ajustes de facturación electrónica", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      html: `<div style="text-align:left;font-size:13px;display:grid;gap:8px">
        <label><input id="f-enf" type="checkbox" ${ov.settings.fiscal_enforce ? "checked" : ""}> <b>Frenar</b>: sin el adicional no se puede emitir en producción</label>
        <p style="font-size:11px;opacity:.7;margin:0">Apagado = solo observar: se deja emitir y se anota quién emite sin paquete.</p>
        <label>Precio por documento sin paquete ($)<input id="f-payg" type="number" min="0" class="swal2-input" style="margin:4px 0;width:100%" value="${ov.settings.fiscal_payg_price}"></label>
        <label>Motivo<input id="f-why" class="swal2-input" style="margin:4px 0;width:100%"></label></div>`,
      preConfirm: () => ({ enforce: (document.getElementById("f-enf") as HTMLInputElement).checked, payg: Number((document.getElementById("f-payg") as HTMLInputElement).value), why: (document.getElementById("f-why") as HTMLInputElement).value }),
    });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_fiscal_settings", { p_enforce: r.value.enforce, p_payg: r.value.payg, p_reason: r.value.why });
    const res = data as { ok: boolean; error?: string } | null;
    if (e || !res?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: e?.message ?? res?.error });
    await load();
  }

  if (error) return <p className="rounded-2xl border p-4 text-sm" style={{ ...box, color: "#f59e0b" }}>{error}</p>;
  if (!ov) return <p className="text-sm" style={muted}>Cargando…</p>;
  const open = ov.overages.filter((o) => o.status === "open");
  const activeStores = ov.stores.filter((s) => s.active);
  const monthDocs = ov.stores.reduce((s, x) => s + x.used, 0);

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {([["Tiendas con el adicional", String(activeStores.length)], ["Documentos este mes", monthDocs.toLocaleString("es-CO")], ["Extras por cobrar", cop(open.reduce((s, o) => s + o.amount, 0))],
          ["Modo", ov.settings.fiscal_enforce ? "🔒 Frena sin adicional" : "👀 Solo observa"]] as const).map(([l, v]) => (
          <div key={l} className="rounded-2xl border p-3" style={box}><p className="text-xs" style={muted}>{l}</p><p className="text-xl font-black">{v}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void editAddon(null)} className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white">+ Paquete</button>
        <button type="button" onClick={() => void setStoreAddon()} className="rounded-xl border px-3 py-2 text-sm font-bold" style={box}>Dar / quitar a una tienda</button>
        <button type="button" onClick={() => void closeMonth()} className="rounded-xl border px-3 py-2 text-sm font-bold" style={box}>Cerrar un mes</button>
        <button type="button" onClick={() => void settings()} className="rounded-xl border px-3 py-2 text-sm font-bold" style={box}>Ajustes</button>
      </div>

      <div className="rounded-2xl border p-4" style={box}>
        <h3 className="mb-2 font-black">Paquetes</h3>
        <div className="grid gap-2 md:grid-cols-3">
          {addons.map((a) => (
            <button key={a.id} type="button" onClick={() => void editAddon(a)} className="rounded-xl border p-3 text-left text-sm transition hover:-translate-y-0.5" style={{ ...box, opacity: a.active ? 1 : 0.5 }}>
              <b>{a.name}</b> <span className="text-xs" style={muted}>· {a.id}{a.public ? "" : " · oculto"}{a.active ? "" : " · no se vende"}</span>
              <p className="mt-1">{cop(a.monthly_price)}/mes · {cop(a.yearly_price)}/año</p>
              <p className="text-xs" style={muted}>{a.included_docs.toLocaleString("es-CO")} documentos · extra {cop(a.overage_price)} · {a.subscribers} tienda(s)</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border p-4" style={box}>
        <h3 className="mb-2 font-black">Uso de este mes</h3>
        {!ov.stores.length ? <p className="text-sm" style={muted}>Ninguna tienda usa facturación electrónica todavía.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead style={muted}><tr>{["Tienda", "Paquete", "Vence", "Usados", "Extra", "Extras por cobrar", ""].map((h) => <th key={h} className="px-2 py-1.5 text-left text-xs">{h}</th>)}</tr></thead>
            <tbody>{ov.stores.map((s) => (
              <tr key={s.store_id} className="border-t" style={{ borderColor: "rgba(255,255,255,.08)" }}>
                <td className="px-2 py-1.5 font-semibold">{s.name}</td>
                <td className="px-2 py-1.5">{s.active ? s.addon?.name : s.expired ? <span className="text-red-400">Vencido</span> : <span style={muted}>Sin adicional</span>}</td>
                <td className="px-2 py-1.5">{s.active ? (s.until ? day(s.until) : "Sin vencimiento") : "—"}</td>
                <td className="px-2 py-1.5">{s.used}{s.included ? ` / ${s.included}` : ""}</td>
                <td className="px-2 py-1.5" style={s.extra ? { color: "#f59e0b" } : undefined}>{s.extra ? `${s.extra} (${cop(s.extra_cost)})` : "—"}</td>
                <td className="px-2 py-1.5">{s.open_overages ? cop(s.open_overages) : "—"}</td>
                <td className="px-2 py-1.5"><button type="button" onClick={() => void setStoreAddon(s.store_id)} className="text-xs underline">cambiar</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="rounded-2xl border p-4" style={box}>
        <h3 className="mb-2 font-black">Cobros de documentos extra</h3>
        {!ov.overages.length ? <p className="text-sm" style={muted}>Todavía no hay cobros de extras. Se crean solos el día 1 de cada mes.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead style={muted}><tr>{["Mes", "Tienda", "Usados", "Extra", "Valor", "Estado", ""].map((h) => <th key={h} className="px-2 py-1.5 text-left text-xs">{h}</th>)}</tr></thead>
            <tbody>{ov.overages.map((o) => (
              <tr key={o.id} className="border-t" style={{ borderColor: "rgba(255,255,255,.08)" }}>
                <td className="px-2 py-1.5">{o.period}</td>
                <td className="px-2 py-1.5">{o.store_name}</td>
                <td className="px-2 py-1.5">{o.used}{o.included ? ` / ${o.included}` : ""}</td>
                <td className="px-2 py-1.5">{o.extra} × {cop(o.unit_price)}</td>
                <td className="px-2 py-1.5 font-bold">{cop(o.amount)}</td>
                <td className="px-2 py-1.5" style={{ color: o.status === "open" ? "#f59e0b" : o.status === "paid" ? "#10b981" : "#94a3b8" }}>
                  {o.status === "open" ? "Por cobrar" : o.status === "paid" ? `Pagado ${day(o.paid_at)}` : "Perdonado"}{o.note ? <span className="block text-[11px]" style={muted}>{o.note}</span> : null}
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {o.status === "open" ? <><button type="button" onClick={() => void overageSet(o, "paid")} className="underline">pagado</button> · <button type="button" onClick={() => void overageSet(o, "waived")} className="underline">perdonar</button></>
                    : <button type="button" onClick={() => void overageSet(o, "open")} className="underline">reabrir</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}
