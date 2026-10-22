"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { DateField } from "@/components/forms/Fields";

/**
 * Garantías y devoluciones (20261229): qué trajo el cliente, qué falla, a quién se mandó y cómo terminó.
 * Si hay que sacar el producto dañado del inventario, se hace con un ajuste («Producto dañado»).
 */

type Claim = {
  id: string; number: number; point: string | null; product_id: string | null; product_name: string; qty: number; customer_name: string; customer_phone: string | null;
  sale_doc: string | null; bought_on: string | null; problem: string; kind: "warranty" | "return"; status: string; supplier: string | null; resolution: string | null;
  events: Array<{ at: string; status: string; by: string | null; note: string | null }>; created_by_name: string | null; created_at: string; days: number;
};

const STATUS: Record<string, [string, string]> = {
  received: ["📥 Recibido", "#8b5cf6"], supplier: ["🏭 Con el proveedor", "#f59e0b"], repair: ["🔧 En reparación", "#f59e0b"],
  replaced: ["🔁 Cambiado", "#0ea5e9"], refunded: ["💸 Dinero devuelto", "#0ea5e9"], rejected: ["⛔ No aplica", "#ef4444"], delivered: ["✅ Entregado al cliente", "#10b981"],
};
const NEXT: Record<string, string[]> = {
  received: ["supplier", "repair", "replaced", "refunded", "rejected"], supplier: ["repair", "replaced", "refunded", "rejected"], repair: ["replaced", "delivered", "rejected"],
  replaced: ["delivered"], refunded: [], rejected: ["delivered"], delivered: [],
};
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const field = "w-full rounded-xl border px-3 py-2.5 text-sm";
const fs = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const dmy = (v: string) => new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString("es-CO", { day: "numeric", month: "short" });

export default function WarrantiesPage() {
  const [store, setStore] = useState<{ id: string; name: string } | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [points, setPoints] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<Claim[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ kind: "warranty", point_id: "", product_id: "", product_name: "", qty: 1, customer_name: "", customer_phone: "", sale_doc: "", bought_on: "", problem: "" });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const s = access?.store;
      if (!s) return setAllowed(false);
      setAllowed(["pos", "inventory", "sales_return"].some((p) => hasStorePermission(access, p)));
      setStore({ id: s.id, name: s.name });
      const { data } = await supabaseBrowser().from("erp_warehouses").select("id,name").eq("store_id", s.id).eq("active", true).order("name");
      setPoints((data ?? []) as typeof points);
    })();
  }, []);
  const load = useCallback(async () => {
    if (!store) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_warranty_list", { p_store: store.id, p_open: onlyOpen });
    if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261229_equipo_y_posventa.sql." : e.message);
    setRows(((data as { items?: Claim[] } | null)?.items ?? []));
  }, [store, onlyOpen]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);
  useEffect(() => {
    const term = q.trim().replace(/[,()*%\\"]/g, " ");
    if (!store || term.length < 2) { const t = window.setTimeout(() => setHits([]), 0); return () => window.clearTimeout(t); }
    const t = window.setTimeout(() => {
      void supabaseBrowser().from("products").select("id,name").eq("store_id", store.id).or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.ilike.*${term}*`).limit(8)
        .then(({ data }) => setHits((data ?? []) as typeof hits));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, store]);

  async function save() {
    if (!store) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_warranty_save", { p_store: store.id, p: { ...form, product_name: form.product_name || q } });
    const r = data as { ok: boolean; error?: string; number?: number } | null;
    if (e || !r?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: e?.message ?? r?.error, ...swal });
    setOpen(false);
    setForm({ ...form, product_id: "", product_name: "", qty: 1, customer_name: "", customer_phone: "", sale_doc: "", bought_on: "", problem: "" });
    setQ("");
    void Swal.fire({ icon: "success", title: `${form.kind === "return" ? "Devolución" : "Garantía"} #${r.number} recibida`, timer: 1600, showConfirmButton: false, ...swal });
    void load();
  }
  async function move(c: Claim, status: string) {
    const r = await Swal.fire({ title: STATUS[status][0], input: "text", inputPlaceholder: status === "supplier" ? "¿A qué proveedor y con qué guía?" : "Nota (opcional)", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Volver", ...swal });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_warranty_update", { p_id: c.id, p_status: status, p_note: r.value || null, p_supplier: null });
    if (e || !(data as { ok?: boolean } | null)?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: e?.message, ...swal });
    const link = waLink(c, status);
    if (link) {
      const go = await Swal.fire({ icon: "success", title: "Guardado", text: "¿Le avisas al cliente?", showCancelButton: true, confirmButtonText: "💬 Avisarle", cancelButtonText: "No", ...swal });
      if (go.isConfirmed) window.open(link, "_blank", "noopener");
    }
    void load();
  }
  function waLink(c: Claim, status: string) {
    const d = (c.customer_phone ?? "").replace(/\D/g, "");
    if (d.length < 7) return null;
    const msg: Record<string, string> = {
      supplier: "lo enviamos al proveedor para revisión. Te avisamos apenas tengamos respuesta.",
      repair: "está en reparación. Te avisamos cuando esté listo.",
      replaced: "ya tenemos tu cambio listo. Puedes pasar por él.",
      refunded: "se aprobó la devolución de tu dinero.",
      rejected: "la revisión indica que la garantía no aplica. Escríbenos si tienes dudas.",
      delivered: "quedó entregado. ¡Gracias por tu paciencia!",
    };
    return `https://wa.me/${d.length === 10 ? `57${d}` : d}?text=${encodeURIComponent(`Hola ${c.customer_name.split(" ")[0]}! Sobre tu ${c.kind === "return" ? "devolución" : "garantía"} #${c.number} (${c.product_name}) en ${store?.name}: ${msg[status] ?? "hay novedades."}`)}`;
  }

  if (allowed === false) return <main className="p-6"><p className="rounded-2xl border p-4 text-sm" style={card}>🔒 Necesitas el permiso de POS, Inventario o Devoluciones.</p></main>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">🛠️ Garantías y devoluciones</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Lo que traen los clientes: qué falla, a quién se mandó y cómo terminó. Si el producto dañado sale del inventario, regístralo en Ajustes → «Producto dañado».</p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>{open ? "Cerrar" : "➕ Recibir garantía o devolución"}</button>
      </header>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}
      {open ? (
        <div className="grid gap-2 rounded-2xl border p-4 sm:grid-cols-2" style={card}>
          <select className={field} style={fs} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Tipo"><option value="warranty">Garantía (falla)</option><option value="return">Devolución (no lo quiere)</option></select>
          <select className={field} style={fs} value={form.point_id} onChange={(e) => setForm({ ...form, point_id: e.target.value })} aria-label="Punto"><option value="">Punto…</option>{points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <div className="relative sm:col-span-2">
            <input className={field} style={fs} placeholder="Producto *" value={form.product_id ? form.product_name : q} onChange={(e) => { setForm({ ...form, product_id: "", product_name: "" }); setQ(e.target.value); }} />
            {hits.length && !form.product_id ? (
              <div className="absolute z-10 mt-1 w-full rounded-xl border p-1 shadow-xl" style={{ ...fs, background: "var(--t-bg-base)" }}>
                {hits.map((h) => <button key={h.id} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm" onClick={() => { setForm({ ...form, product_id: h.id, product_name: h.name }); setHits([]); }}>{h.name}</button>)}
              </div>
            ) : null}
          </div>
          <input className={field} style={fs} placeholder="Cliente *" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value.toUpperCase() })} />
          <input className={field} style={fs} placeholder="Celular" inputMode="tel" value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
          <input className={field} style={fs} placeholder="Factura / remisión de la venta" value={form.sale_doc} onChange={(e) => setForm({ ...form, sale_doc: e.target.value.toUpperCase() })} />
          <DateField value={form.bought_on} onChange={(v) => setForm({ ...form, bought_on: v })} ariaLabel="Fecha de compra" placeholder="Compró el DD/MM/AAAA" />
          <textarea className={`${field} sm:col-span-2`} style={fs} rows={2} placeholder="¿Qué falla o por qué lo devuelve? *" value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} />
          <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white sm:col-span-2" style={{ background: "var(--t-cta)" }}>💾 Recibir</button>
        </div>
      ) : null}
      <div className="flex gap-1.5 text-sm">
        <button type="button" onClick={() => setOnlyOpen(true)} className="rounded-full border px-3 py-1.5 font-semibold" style={onlyOpen ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>Abiertas</button>
        <button type="button" onClick={() => setOnlyOpen(false)} className="rounded-full border px-3 py-1.5 font-semibold" style={!onlyOpen ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>Todas</button>
      </div>
      {!rows.length && !error ? <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>No hay garantías {onlyOpen ? "abiertas" : ""}. Cuando un cliente traiga un producto, regístralo aquí y síguelo hasta entregarlo.</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((c) => {
          const [label, color] = STATUS[c.status] ?? [c.status, "var(--t-muted)"];
          return (
            <div key={c.id} className="rounded-2xl border p-4 text-sm" style={card}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><b>#{c.number} · {c.product_name}</b>{c.qty > 1 ? ` ×${c.qty}` : ""}<p className="text-xs" style={{ color: "var(--t-muted)" }}>{c.kind === "return" ? "Devolución" : "Garantía"} · {c.customer_name}{c.customer_phone ? ` · ${c.customer_phone}` : ""}{c.point ? ` · ${c.point}` : ""}</p></div>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}>{label}</span>
              </div>
              <p className="mt-1">🗒️ {c.problem}</p>
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{c.sale_doc ? `Venta ${c.sale_doc} · ` : ""}{c.bought_on ? `compró el ${dmy(c.bought_on)} · ` : ""}hace {c.days} día(s)</p>
              <ol className="mt-2 space-y-0.5 border-l pl-3 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>
                {c.events.map((e, i) => <li key={i}><b>{STATUS[e.status]?.[0] ?? e.status}</b> · {dmy(e.at)}{e.by ? ` · ${e.by}` : ""}{e.note ? ` — ${e.note}` : ""}</li>)}
              </ol>
              {NEXT[c.status]?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {NEXT[c.status].map((s) => <button key={s} type="button" onClick={() => void move(c, s)} className="rounded-lg border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{STATUS[s][0]}</button>)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
