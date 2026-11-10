"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { Camera, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ScanCounter } from "@/components/ScanCounter";
import { ProductPicker } from "./LineEditor";
import { Btn, Empty, Panel, money, toast, type ErpCtx, type Warehouse } from "./shared";

type CountRow = {
  id: string; warehouse_id: string; warehouse: string; zone: string; status: "counting" | "submitted" | "approved" | "rejected";
  created_by_name: string | null; created_at: string; submitted_at: string | null; decided_by_name: string | null; decided_at: string | null;
  lines: number; diffs: number; units_diff: number;
};
type Line = {
  product_id: string; name: string; sku: string | null; barcode: string | null; image_url: string | null;
  counted: number; system_qty: number; diff: number; now_qty: number; unit_cost: number | null;
};
type Detail = { count: CountRow & { notes: string | null; decision_note: string | null; adjustment_id: string | null }; lines: Line[]; can_approve: boolean; can_cost: boolean };

const STATUS: Record<CountRow["status"], { label: string; color: string; icon: string }> = {
  counting: { label: "Contando", color: "#0ea5e9", icon: "📷" },
  submitted: { label: "Por aprobar", color: "#f59e0b", icon: "⏳" },
  approved: { label: "Aprobado", color: "#10b981", icon: "✅" },
  rejected: { label: "Rechazado", color: "#ef4444", icon: "✖️" },
};
const dmy = (iso: string) => new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#14b8a6" } as const;

/**
 * Conteo por zonas con aprobación (función opcional, 20261313).
 * Se cuenta una zona (vitrina, estante, bodega del fondo) sin cerrar la tienda; al enviar, quien tiene
 * «Ajustar inventario» aprueba y se ajusta solo la diferencia contra lo que había al contar.
 */
export function CountsTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const [rows, setRows] = useState<CountRow[] | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const places = warehouses.filter((w) => w.active && (!ctx.pointId || w.id === ctx.pointId));

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("count_list", { p_store: ctx.storeId, p_status: null });
    const r = data as { ok: boolean; message?: string; items?: CountRow[]; can_approve?: boolean } | null;
    if (e || !r?.ok) return setError(e && /Could not find|schema cache/i.test(e.message) ? "Falta correr en Supabase la migración 20261313_clientes_y_operacion_opcional.sql." : e?.message ?? r?.message ?? "No se pudo leer.");
    setError("");
    setRows(r.items ?? []);
    setCanApprove(Boolean(r.can_approve));
  }, [ctx.storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function start() {
    const opts = Object.fromEntries(places.map((w) => [w.id, `${w.kind === "point" ? "📍" : "🏬"} ${w.name}`]));
    const res = await Swal.fire({
      ...swal, title: "📷 Nuevo conteo",
      html: `<p style="font-size:13px;margin:0 0 10px">Cuenta una zona a la vez, sin cerrar la tienda. Lo que vendan mientras cuentas no se pierde.</p>
        <select id="cw" class="swal2-select" style="width:100%;margin:0 0 8px">${Object.entries(opts).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <input id="cz" class="swal2-input" style="width:100%;margin:0" maxlength="60" placeholder="Zona: Vitrina 1, Estante B, Bodega fondo…" />`,
      showCancelButton: true, confirmButtonText: "Empezar a contar", cancelButtonText: "Cancelar",
      preConfirm: () => {
        const w = (document.getElementById("cw") as HTMLSelectElement | null)?.value ?? "";
        const z = (document.getElementById("cz") as HTMLInputElement | null)?.value.trim() ?? "";
        if (!z) { Swal.showValidationMessage("Escribe el nombre de la zona"); return false; }
        return { w, z };
      },
    });
    if (!res.isConfirmed || !res.value) return;
    const { data, error: e } = await supabaseBrowser().rpc("count_start", { p_store: ctx.storeId, p_warehouse: res.value.w, p_zone: res.value.z, p_notes: null });
    const r = data as { ok: boolean; message?: string; id?: string } | null;
    if (e || !r?.ok || !r.id) return void toast("No se pudo empezar", "error", e?.message ?? r?.message);
    await load();
    setOpenId(r.id);
  }

  if (openId) return <CountEditor ctx={ctx} id={openId} onBack={() => { setOpenId(null); void load(); }} />;

  const pending = (rows ?? []).filter((r) => r.status === "submitted");
  return (
    <Panel title="📷 Conteos por zonas" subtitle="Cuenta por partes con la cámara del celular o un lector. Las diferencias se ajustan solo cuando alguien con «Ajustar inventario» las aprueba."
      actions={places.length ? <Btn onClick={() => void start()}>＋ Nuevo conteo</Btn> : undefined}>
      {error ? <p className="mb-3 text-sm" style={{ color: "#ef4444" }}>⚠️ {error}</p> : null}
      {canApprove && pending.length ? (
        <p className="mb-3 rounded-2xl border p-3 text-sm font-bold" style={{ borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 10%, transparent)" }}>
          ⏳ Tienes {pending.length} conteo(s) por aprobar.
        </p>
      ) : null}
      {!rows && !error ? <p className="text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="mr-1 inline animate-spin" /> Cargando…</p> : null}
      {rows && !rows.length ? <Empty icon="📷" title="Aún no hay conteos" text="Empieza por una zona pequeña, como una vitrina: cuentas, envías y alguien lo aprueba." action={places.length ? { label: "Nuevo conteo", onClick: () => void start() } : undefined} /> : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {(rows ?? []).map((r) => {
          const st = STATUS[r.status];
          return (
            <li key={r.id}>
              <button type="button" onClick={() => setOpenId(r.id)} className="vm-row flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                style={{ borderColor: `color-mix(in oklab, ${st.color} 40%, var(--t-card-border))` }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: `color-mix(in oklab, ${st.color} 15%, transparent)` }} aria-hidden>{st.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{r.zone} <span className="text-xs font-bold opacity-60">· {r.warehouse}</span></span>
                  <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {r.lines} producto(s){r.diffs ? ` · ${r.diffs} con diferencia (${r.units_diff > 0 ? "+" : ""}${r.units_diff} und.)` : r.lines ? " · sin diferencias" : ""} · {r.created_by_name ?? ""} · {dmy(r.created_at)}
                  </span>
                </span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{ background: st.color }}>{st.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CountEditor({ ctx, id, onBack }: { ctx: ErpCtx; id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Map<string, { counted: number; name: string; sku: string | null }>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("count_get", { p_count: id });
    const r = data as ({ ok: boolean; message?: string } & Partial<Detail>) | null;
    if (e || !r?.ok || !r.count) return setError(e?.message ?? r?.message ?? "No se pudo leer.");
    setError("");
    setD({ count: r.count, lines: r.lines ?? [], can_approve: Boolean(r.can_approve), can_cost: Boolean(r.can_cost) });
    setDraft(new Map((r.lines ?? []).map((l) => [l.product_id, { counted: l.counted, name: l.name, sku: l.sku }])));
    setDirty(false);
  }, [id]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const editable = d?.count.status === "counting";
  const lines = useMemo(() => [...draft.entries()].map(([pid, v]) => ({ pid, ...v, server: d?.lines.find((l) => l.product_id === pid) ?? null })), [draft, d]);

  function setQty(pid: string, name: string, sku: string | null, counted: number) {
    setDraft((p) => { const n = new Map(p); n.set(pid, { name, sku, counted: Math.max(0, Math.floor(counted || 0)) }); return n; });
    setDirty(true);
  }
  function remove(pid: string) {
    setDraft((p) => { const n = new Map(p); n.delete(pid); return n; });
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    if (!d) return false;
    const removed = d.lines.filter((l) => !draft.has(l.product_id)).map((l) => ({ product_id: l.product_id, counted: 0, remove: true }));
    const payload = [...lines.map((l) => ({ product_id: l.pid, counted: l.counted })), ...removed];
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("count_save_lines", { p_count: id, p_lines: payload });
    setBusy(false);
    const r = data as { ok: boolean; message?: string } | null;
    if (e || !r?.ok) { void toast("No se pudo guardar", "error", e?.message ?? r?.message); return false; }
    await load();
    return true;
  }

  async function submit() {
    if (dirty && !(await save())) return;
    const ask = await Swal.fire({ ...swal, icon: "question", title: "¿Enviar para aprobar?", text: "Ya no se podrá cambiar. Quien aprueba verá las diferencias.", showCancelButton: true, confirmButtonText: "Sí, enviar", cancelButtonText: "Seguir contando" });
    if (!ask.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("count_submit", { p_count: id });
    const r = data as { ok: boolean; message?: string } | null;
    if (e || !r?.ok) return void toast("No se pudo enviar", "error", e?.message ?? r?.message);
    void toast("Enviado para aprobar");
    void load();
  }

  async function decide(approve: boolean) {
    const res = await Swal.fire({
      ...swal, icon: approve ? "question" : "warning", title: approve ? "¿Aprobar y ajustar?" : "¿Rechazar el conteo?",
      text: approve ? "Se ajusta solo la diferencia contra lo que había al contar. Queda en el kardex y en la auditoría." : "No cambia las existencias.",
      input: "text", inputPlaceholder: "Nota (opcional)", showCancelButton: true,
      confirmButtonText: approve ? "Aprobar" : "Rechazar", cancelButtonText: "Cancelar", confirmButtonColor: approve ? "#10b981" : "#ef4444",
    });
    if (!res.isConfirmed) return;
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("count_decide", { p_count: id, p_approve: approve, p_note: (res.value as string) || null });
    setBusy(false);
    const r = data as { ok: boolean; message?: string; adjusted?: number } | null;
    if (e || !r?.ok) return void toast("No se pudo", "error", e?.message ?? r?.message);
    void toast(approve ? `Aprobado${r.adjusted ? `: ${r.adjusted} producto(s) ajustado(s)` : " sin diferencias"}` : "Rechazado");
    void load();
  }

  async function reopen() {
    const { data, error: e } = await supabaseBrowser().rpc("count_reopen", { p_count: id });
    if (e || !(data as { ok?: boolean } | null)?.ok) return void toast("No se pudo", "error", e?.message);
    void load();
  }

  async function del() {
    const ask = await Swal.fire({ ...swal, icon: "warning", title: "¿Borrar este conteo?", showCancelButton: true, confirmButtonText: "Borrar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" });
    if (!ask.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("count_delete", { p_count: id });
    const r = data as { ok: boolean; message?: string } | null;
    if (e || !r?.ok) return void toast("No se pudo", "error", e?.message ?? r?.message);
    onBack();
  }

  if (error) return <Panel title="Conteo"><p className="text-sm" style={{ color: "#ef4444" }}>{error}</p><Btn variant="ghost" onClick={onBack}>← Volver</Btn></Panel>;
  if (!d) return <p className="text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="mr-1 inline animate-spin" /> Cargando conteo…</p>;
  const st = STATUS[d.count.status];
  const diffs = d.lines.filter((l) => l.diff !== 0);
  const value = d.can_cost ? diffs.reduce((a, l) => a + l.diff * Number(l.unit_cost ?? 0), 0) : null;

  return (
    <Panel title={`${st.icon} ${d.count.zone} · ${d.count.warehouse}`} subtitle={`${st.label} · empezó ${d.count.created_by_name ?? ""} el ${dmy(d.count.created_at)}${d.count.decided_by_name ? ` · decidió ${d.count.decided_by_name}` : ""}`}
      actions={<Btn variant="ghost" onClick={() => { if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Salir igual?")) return; onBack(); }}>← Conteos</Btn>}>
      {editable ? (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setScan(true)} className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#14b8a6,#0ea5e9)" }}>
              <Camera size={18} /> Contar escaneando
            </button>
            <div className="min-w-[240px] flex-1">
              <ProductPicker storeId={ctx.storeId} warehouseId={d.count.warehouse_id} addedQty={Object.fromEntries(lines.map((l) => [l.pid, l.counted]))}
                placeholder="🔎 O busca el producto y escribe cuántos hay…"
                onPick={(p) => setQty(p.id, p.name, p.sku, (draft.get(p.id)?.counted ?? 0) + 1)} />
            </div>
          </div>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>💡 Cuenta lo que hay físicamente en esta zona. Aquí no se muestra lo que dice el sistema, para que el conteo sea limpio.</p>
        </div>
      ) : null}

      {!editable && diffs.length ? (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}><p className="text-[11px] font-bold uppercase" style={{ color: "#f59e0b" }}>Con diferencia</p><p className="text-xl font-black">{diffs.length}</p></div>
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}><p className="text-[11px] font-bold uppercase" style={{ color: "#0ea5e9" }}>Unidades</p><p className="text-xl font-black">{diffs.reduce((a, l) => a + l.diff, 0) > 0 ? "+" : ""}{diffs.reduce((a, l) => a + l.diff, 0)}</p></div>
          {value !== null ? <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}><p className="text-[11px] font-bold uppercase" style={{ color: value < 0 ? "#ef4444" : "#10b981" }}>Valor al costo</p><p className="text-xl font-black">{money(value)}</p></div> : null}
        </div>
      ) : null}

      {!lines.length ? <Empty icon="📦" text={editable ? "Escanea o busca los productos de esta zona." : "Este conteo no tiene productos."} /> : null}
      <ul className="space-y-2">
        {lines.map((l) => {
          const s = l.server;
          return (
            <li key={l.pid} className="flex items-center gap-3 rounded-2xl border p-2.5" style={{ borderColor: !editable && s && s.diff !== 0 ? (s.diff < 0 ? "#ef4444" : "#10b981") : "var(--t-card-border)" }}>
              {s?.image_url ? <img src={s.image_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl">📦</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{l.name}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {l.sku ?? ""}
                  {!editable && s ? <> · sistema al contar {s.system_qty} · contado {s.counted} · <b style={{ color: s.diff === 0 ? "#10b981" : s.diff < 0 ? "#ef4444" : "#0ea5e9" }}>{s.diff === 0 ? "✓ igual" : `${s.diff > 0 ? "+" : ""}${s.diff}`}</b>{d.count.status === "submitted" && s.now_qty !== s.system_qty ? ` · hoy hay ${s.now_qty} (se movió después)` : ""}</> : null}
                </p>
              </div>
              {editable ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setQty(l.pid, l.name, l.sku, l.counted - 1)} className="grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Uno menos"><Minus size={14} /></button>
                  <input type="number" inputMode="numeric" min={0} value={l.counted} onChange={(e) => setQty(l.pid, l.name, l.sku, Number(e.target.value))} className="h-9 w-16 rounded-xl border text-center text-sm font-black" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label={`Cantidad contada de ${l.name}`} />
                  <button type="button" onClick={() => setQty(l.pid, l.name, l.sku, l.counted + 1)} className="grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Uno más"><Plus size={14} /></button>
                  <button type="button" onClick={() => remove(l.pid)} className="grid h-9 w-9 place-items-center rounded-xl" style={{ color: "#ef4444" }} aria-label="Quitar"><Trash2 size={14} /></button>
                </div>
              ) : <span className="shrink-0 text-lg font-black">{s?.counted ?? l.counted}</span>}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {d.count.status === "counting" || d.count.status === "submitted" ? <Btn variant="ghost" onClick={() => void del()}>🗑️ Borrar</Btn> : null}
        {editable ? (
          <>
            <Btn variant="ghost" onClick={() => void save()} disabled={!dirty || busy}>{busy ? "Guardando…" : dirty ? "💾 Guardar avance" : "✓ Guardado"}</Btn>
            <Btn onClick={() => void submit()} disabled={busy || !lines.length}>📨 Enviar para aprobar</Btn>
          </>
        ) : null}
        {d.count.status === "submitted" ? (
          <>
            <Btn variant="ghost" onClick={() => void reopen()}>↩️ Volver a contar</Btn>
            {d.can_approve ? (
              <>
                <Btn variant="ghost" onClick={() => void decide(false)} disabled={busy}>✖️ Rechazar</Btn>
                <Btn onClick={() => void decide(true)} disabled={busy}>✅ Aprobar y ajustar</Btn>
              </>
            ) : <span className="self-center text-xs" style={{ color: "var(--t-muted)" }}>Espera a que alguien con «Ajustar inventario» lo apruebe.</span>}
          </>
        ) : null}
      </div>

      {scan ? (
        <ScanCounter storeId={ctx.storeId} title={`Contar ${d.count.zone}`} onClose={() => setScan(false)}
          initial={lines.map((l) => ({ product_id: l.pid, name: l.name, sku: l.sku, qty: l.counted }))}
          onDone={(counts) => {
            setDraft(new Map(counts.map((c) => [c.product_id, { name: c.name, sku: c.sku, counted: c.qty }])));
            setDirty(true);
            setScan(false);
          }} />
      ) : null}
    </Panel>
  );
}
