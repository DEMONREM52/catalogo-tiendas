"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LineEditor, ProductPicker, type Line } from "./LineEditor";
import {
  ADJUST_REASONS, Btn, Empty, MOVEMENT_LABELS, Panel, confirmAction, dateTime, errorMessage,
  inputClass, inputStyle, tableWrap, td, th, toast, useRunOnChange, type ErpCtx, type Warehouse,
} from "./shared";
import { DateField } from "@/components/forms/Fields";
import Swal from "sweetalert2";

type AdjustmentRow = {
  id: string; number: number; reason: string; notes: string | null; created_at: string; created_by_name: string | null; warehouse_id: string;
  erp_adjustment_items: Array<{ product_id: string; products: { name: string } | { name: string }[] | null; qty_before: number; qty_after: number; diff: number }>;
};

export function AdjustmentsTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const active = warehouses.filter((w) => w.active);
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [pickedWarehouse, setWarehouse] = useState("");
  const warehouse = ctx.pointId ?? pickedWarehouse;
  const [reason, setReason] = useState("count");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const canAdjust = ctx.can("inventory_adjust");
  const names = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [countCat, setCountCat] = useState("");
  const [loadingCount, setLoadingCount] = useState(false);

  useEffect(() => {
    void supabaseBrowser().from("product_categories").select("id,name").eq("store_id", ctx.storeId).eq("active", true).order("name")
      .then(({ data }) => setCategories((data ?? []) as Array<{ id: string; name: string }>));
  }, [ctx.storeId]);

  /** Conteo por partes: trae todos los productos activos de una categoría con lo que dice el sistema; solo se cuenta esa parte. */
  async function loadCategory() {
    if (!warehouse || !countCat) return;
    setLoadingCount(true);
    const sb = supabaseBrowser();
    const ids = new Set<string>();
    const rows: Array<{ id: string; name: string; sku: string | null }> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("products").select("id,name,sku").eq("store_id", ctx.storeId).eq("active", true)
        .eq("category_id", countCat).order("name").range(from, from + 999);
      if (error) break;
      for (const p of (data ?? []) as typeof rows) if (!ids.has(p.id)) { ids.add(p.id); rows.push(p); }
      if ((data ?? []).length < 1000) break;
    }
    const links = await sb.from("product_category_links").select("product_id").eq("category_id", countCat).limit(5000);
    const extra = ((links.data ?? []) as Array<{ product_id: string }>).map((l) => l.product_id).filter((id) => !ids.has(id));
    for (let i = 0; i < extra.length; i += 200) {
      const { data } = await sb.from("products").select("id,name,sku").eq("active", true).in("id", extra.slice(i, i + 200));
      for (const p of (data ?? []) as typeof rows) if (!ids.has(p.id)) { ids.add(p.id); rows.push(p); }
    }
    const have = new Map<string, number>();
    const all = [...ids];
    for (let i = 0; i < all.length; i += 200) {
      const { data } = await sb.from("erp_stock_levels").select("product_id,qty").eq("warehouse_id", warehouse).in("product_id", all.slice(i, i + 200));
      for (const r of (data ?? []) as Array<{ product_id: string; qty: number }>) have.set(r.product_id, Number(r.qty));
    }
    setLoadingCount(false);
    if (!rows.length) return void toast("Esa categoría no tiene productos activos", "warning");
    rows.sort((a, b) => a.name.localeCompare(b.name, "es"));
    setLines((cur) => {
      const kept = cur.filter((l) => !ids.has(l.product_id));
      return [...kept, ...rows.map((p) => ({
        product_id: p.id, name: p.name, sku: p.sku, current: have.get(p.id) ?? 0, qty: have.get(p.id) ?? 0,
        unit_cost: 0, tax_rate: 0, warehouse_id: warehouse,
      }))];
    });
    setReason("count");
    void toast(`${rows.length} productos para contar`, "success", "Escribe lo que cuentes; los que no cambies no se ajustan.");
  }

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from("erp_adjustments")
      .select("id,number,reason,notes,created_at,created_by_name,warehouse_id,erp_adjustment_items(product_id,products(name),qty_before,qty_after,diff)")
      .eq("store_id", ctx.storeId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) void toast("No se pudieron cargar los ajustes", "error", errorMessage(error));
    else setRows((data ?? []) as unknown as AdjustmentRow[]);
  }, [ctx.storeId]);

  useRunOnChange(load);

  async function post() {
    if (!warehouse) return void toast("Elige la bodega", "warning");
    let changed = lines.filter((l) => l.qty !== l.current);
    if (!changed.length) return void toast("No hay diferencias para ajustar", "warning");
    // ¿Se vendió o trasladó algo mientras contabas? Se revisa lo que dice la base ahora mismo.
    const now = new Map<string, number>();
    const ids = changed.map((l) => l.product_id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabaseBrowser().from("erp_stock_levels").select("product_id,qty").eq("warehouse_id", warehouse).in("product_id", ids.slice(i, i + 200));
      for (const r of (data ?? []) as Array<{ product_id: string; qty: number }>) now.set(r.product_id, Number(r.qty));
    }
    const moved = changed.filter((l) => (now.get(l.product_id) ?? 0) !== l.current);
    if (moved.length) {
      const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const pick = await Swal.fire({
        icon: "warning", title: "Hubo movimientos mientras contabas",
        html: `<div style="text-align:left;font-size:13px;line-height:1.6">${moved.map((l) => { const d = (now.get(l.product_id) ?? 0) - l.current; return `• <b>${esc(l.name)}</b>: el sistema decía ${l.current}, ahora dice ${now.get(l.product_id) ?? 0} (${d > 0 ? "+" : ""}${d}) · contaste ${l.qty}`; }).join("<br>")}</div>
          <p style="font-size:12px;margin-top:10px;opacity:.85">Si contaste antes de esas ventas o traslados, lo correcto es <b>descontarlas de tu conteo</b>.</p>`,
        showDenyButton: true, showCancelButton: true,
        confirmButtonText: "Descontar lo que se movió (recomendado)", denyButtonText: "Dejar lo que conté", cancelButtonText: "Volver",
        background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6", denyButtonColor: "#64748b",
      });
      if (pick.isDismissed) return;
      if (pick.isConfirmed) {
        changed = changed.map((l) => (moved.includes(l) ? { ...l, qty: Math.max(0, l.qty + ((now.get(l.product_id) ?? 0) - l.current)), current: now.get(l.product_id) ?? 0 } : l));
      } else {
        changed = changed.map((l) => (moved.includes(l) ? { ...l, current: now.get(l.product_id) ?? 0 } : l));
      }
      changed = changed.filter((l) => l.qty !== l.current);
      if (!changed.length) return void toast("Con esos movimientos ya no queda diferencia", "success");
    }
    if (!(await confirmAction("Aplicar ajuste", `Se modificará el inventario de ${changed.length} producto(s) y quedará registrado con tu usuario.`))) return;
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_post_adjustment", {
      p_store: ctx.storeId, p_warehouse: warehouse, p_reason: reason, p_notes: notes,
      p_items: changed.map((l) => ({ product_id: l.product_id, qty_after: l.qty })),
    });
    setBusy(false);
    if (error) return void toast("No se pudo aplicar el ajuste", "error", errorMessage(error));
    setLines([]);
    setNotes("");
    void toast("Ajuste aplicado");
    void load();
  }

  return (
    <div className="space-y-5">
      {canAdjust ? (
        <Panel title="Nuevo ajuste de inventario" subtitle="Indica la cantidad real contada; el sistema calcula la diferencia y la registra en el kardex.">
          <div className="grid gap-2 sm:grid-cols-3">
            <select className={inputClass} style={inputStyle} value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setLines([]); }}>
              <option value="">Bodega…</option>
              {active.filter((w) => !ctx.pointId || w.id === ctx.pointId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select className={inputClass} style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
              {ADJUST_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className={inputClass} style={inputStyle} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {warehouse ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="text-sm font-semibold">📋 Contar por partes:</span>
              <select className={`${inputClass} w-auto min-w-[200px] flex-1 sm:flex-none`} style={inputStyle} value={countCat} onChange={(e) => setCountCat(e.target.value)} aria-label="Categoría a contar">
                <option value="">Elige una categoría…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Btn variant="ghost" onClick={() => void loadCategory()} disabled={!countCat || loadingCount}>{loadingCount ? "Cargando…" : "Traer productos para contar"}</Btn>
              <span className="w-full text-[11px]" style={{ color: "var(--t-muted)" }}>Trae todos los productos de esa categoría con lo que dice el sistema. Solo se ajustan los que cambies; si alguien vende mientras cuentas, te avisamos al aplicar.</span>
            </div>
          ) : null}
          {warehouse ? <div className="mt-3"><LineEditor storeId={ctx.storeId} lines={lines} onChange={setLines} mode="adjust" warehouseId={warehouse} /></div> : null}
          <div className="mt-3"><Btn onClick={() => void post()} disabled={busy}>{busy ? "Aplicando…" : "✅ Aplicar ajuste"}</Btn></div>
        </Panel>
      ) : null}

      <Panel title="Historial de ajustes">
        {rows.length === 0 ? <Empty icon="🛠️" title="Aún no hay ajustes" text="Cuando cuentes la mercancía y algo no cuadre, ajústalo arriba. Con «Contar por partes» puedes contar una categoría a la vez." /> : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="glass-soft rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="font-semibold">#{row.number} · {names.get(row.warehouse_id) ?? "—"} · {ADJUST_REASONS.find(([v]) => v === row.reason)?.[1] ?? row.reason}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>{dateTime(row.created_at)} · {row.created_by_name ?? "—"}{row.notes ? ` · ${row.notes}` : ""}</p>
                <p className="mt-2 text-sm">
                  {row.erp_adjustment_items.map((i) => `${(Array.isArray(i.products) ? i.products[0]?.name : i.products?.name) ?? "Producto"}: ${i.qty_before} → ${i.qty_after} (${i.diff > 0 ? "+" : ""}${i.diff})`).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

type KardexRow = {
  id: string; created_at: string; product_name: string; warehouse_name: string | null; movement_type: string | null;
  kind: string; qty: number; qty_before: number | null; qty_after: number | null; unit_cost: number | null; note: string | null; reason: string | null;
};

export function KardexTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [warehouse, setWarehouse] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<KardexRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseBrowser().rpc("erp_kardex", {
      p_store: ctx.storeId,
      p_product: product?.id ?? null,
      p_warehouse: warehouse || null,
      p_from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
      p_to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
    });
    setLoading(false);
    if (error) void toast("No se pudo cargar el kardex", "error", errorMessage(error));
    else setRows((data ?? []) as KardexRow[]);
  }, [ctx.storeId, product, warehouse, from, to]);

  useRunOnChange(load);

  return (
    <Panel title="Kardex" subtitle="Todos los movimientos de inventario: quién, cuándo, cuánto y por qué (máximo 500 recientes).">
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          {product ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="truncate font-semibold">{product.name}</span>
              <button type="button" onClick={() => setProduct(null)} className="text-xs font-semibold" style={{ color: "var(--t-accent)" }}>Quitar</button>
            </div>
          ) : (
            <ProductPicker storeId={ctx.storeId} placeholder="Todos los productos (buscar uno…)" onPick={(hit) => setProduct({ id: hit.id, name: hit.name })} />
          )}
        </div>
        <select className={inputClass} style={inputStyle} value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
          <option value="">Todas las bodegas</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <DateField value={from} onChange={(v) => setFrom(v)} ariaLabel="Desde" />
        <DateField value={to} onChange={(v) => setTo(v)} ariaLabel="Hasta" />
      </div>
      {loading ? <Empty text="Cargando…" /> : rows.length === 0 ? <Empty text="Sin movimientos para este filtro." /> : (
        <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full min-w-[760px]">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr>
                <th className={th}>Fecha</th><th className={th}>Producto</th><th className={th}>Bodega</th><th className={th}>Tipo</th>
                <th className={th}>Cant.</th><th className={th}>Antes → después</th><th className={th}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className={td}>{dateTime(r.created_at)}</td>
                  <td className={td}>{r.product_name}</td>
                  <td className={td}>{r.warehouse_name ?? "—"}</td>
                  <td className={td}>{MOVEMENT_LABELS[r.movement_type ?? ""] ?? r.movement_type ?? "—"}</td>
                  <td className={td} style={{ fontWeight: 700, color: r.kind === "in" ? "#10b981" : "#ef4444" }}>{r.kind === "in" ? "+" : "−"}{r.qty}</td>
                  <td className={td}>{r.qty_before ?? "—"} → {r.qty_after ?? "—"}</td>
                  <td className={td}>{[r.note, r.reason].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

type AuditRow = { id: string; created_at: string; user_name: string | null; action: string; entity: string; detail: Record<string, unknown> };

export function AuditTab({ ctx }: { ctx: ErpCtx }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    supabaseBrowser()
      .from("erp_audit_logs")
      .select("id,created_at,user_name,action,entity,detail")
      .eq("store_id", ctx.storeId)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) void toast("No se pudo cargar la auditoría", "error", errorMessage(error));
        else setRows((data ?? []) as AuditRow[]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ctx.storeId]);

  return (
    <Panel title="Auditoría" subtitle="Registro inmutable de operaciones críticas. Nadie puede editarlo ni borrarlo.">
      {loading ? <Empty text="Cargando…" /> : rows.length === 0 ? <Empty text="Aún no hay operaciones registradas." /> : (
        <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full min-w-[640px]">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr><th className={th}>Fecha</th><th className={th}>Acción</th><th className={th}>Usuario</th><th className={th}>Detalle</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className={td}>{dateTime(r.created_at)}</td>
                  <td className={td} style={{ fontWeight: 600 }}>{r.action}</td>
                  <td className={td}>{r.user_name ?? "sistema"}</td>
                  <td className={td} style={{ color: "var(--t-muted)" }}>{JSON.stringify(r.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
