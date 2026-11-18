"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import Swal from "@/lib/swal";

/**
 * Códigos con que cada proveedor llama a este producto (20261325): el buscador del ingreso, del POS y de los
 * traslados lo encuentra también por ellos. Se aprenden solos al registrar facturas (XML o «+ cód. proveedor»).
 * Solo lo ve quien tiene el permiso de Ingresos; se guarda de una vez (no espera a «Guardar cambios»).
 */
type Code = { supplier_id: string; supplier: string; code: string };
type Supplier = { id: string; name: string };

export function SupplierCodesPanel({ storeId, productId }: { storeId: string; productId: string }) {
  const [items, setItems] = useState<Code[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [adding, setAdding] = useState(false);
  const [sup, setSup] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_supplier_codes", { p_store: storeId, p_product: productId });
    const d = data as { ok?: boolean; items?: Code[] } | null;
    setItems(error || !d?.ok ? null : d.items ?? []);
  }, [storeId, productId]);

  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  useEffect(() => {
    if (!adding || suppliers.length) return;
    void supabaseBrowser().from("erp_suppliers").select("id,name").eq("store_id", storeId).eq("active", true).order("name").limit(500)
      .then(({ data }) => setSuppliers((data ?? []) as Supplier[]));
  }, [adding, suppliers.length, storeId]);

  if (items === null) return null; // Sin permiso de Ingresos o sin la migración: no se muestra.

  const fire = (title: string, icon: "success" | "error" | "warning", text?: string) =>
    Swal.fire({ toast: true, position: "top", icon, title, text, timer: 2600, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

  async function add() {
    const c = code.trim().toUpperCase();
    if (!sup || !c) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_supplier_item_map_save", { p_store: storeId, p_supplier: sup, p_items: [{ code: c, product_id: productId }] });
    setBusy(false);
    const d = data as { ok?: boolean; message?: string } | null;
    if (error || !d?.ok) return void fire("No se guardó", "error", d?.message ?? error?.message);
    setCode(""); setAdding(false);
    void fire("✅ Código guardado", "success");
    void load();
  }

  async function remove(c: Code) {
    const ok = await Swal.fire({ icon: "question", title: `¿Quitar el código ${c.code}?`, text: `${c.supplier} ya no se reconocerá por ese código.`, showCancelButton: true,
      confirmButtonText: "Quitar", cancelButtonText: "Cancelar", background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!ok.isConfirmed) return;
    const { data } = await supabaseBrowser().rpc("erp_supplier_code_delete", { p_store: storeId, p_supplier: c.supplier_id, p_code: c.code });
    if (!(data as { ok?: boolean } | null)?.ok) return void fire("No se quitó", "error");
    void load();
  }

  const box = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">🏷️ Códigos de proveedores</p>
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="rounded-xl border px-2.5 py-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>+ Agregar</button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
        Cómo llama cada proveedor a este producto. Al buscar ese código (en ingresos, POS o traslados) sale este producto. Se aprenden solos al registrar facturas.
      </p>
      {items.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((c) => (
            <span key={`${c.supplier_id}:${c.code}`} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
              <b>{c.code}</b> <span style={{ color: "var(--t-muted)" }}>{c.supplier}</span>
              <button type="button" onClick={() => void remove(c)} aria-label={`Quitar el código ${c.code}`} className="font-bold" style={{ color: "#e5484d" }}>×</button>
            </span>
          ))}
        </div>
      ) : !adding ? <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Todavía ninguno.</p> : null}
      {adding ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <select value={sup} onChange={(e) => setSup(e.target.value)} className="min-w-0 flex-1 rounded-xl border px-2 py-2 text-sm" style={box} aria-label="Proveedor">
            <option value="">Elige el proveedor…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input value={code} maxLength={60} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Su código (ej. 88130)"
            className="w-40 rounded-xl border px-2 py-2 text-sm uppercase" style={box} aria-label="Código del proveedor"
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <button type="button" disabled={busy || !sup || !code.trim()} onClick={() => void add()} className="rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-50" style={{ background: "var(--t-accent)" }}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={() => { setAdding(false); setCode(""); }} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
        </div>
      ) : null}
    </div>
  );
}
