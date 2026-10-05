"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  Btn, Empty, Kpi, Panel, errorMessage, inputClass, inputStyle, money, tableWrap, td, th, toast,
  type ErpCtx, type Warehouse,
} from "./shared";

type Overview = {
  inventory_value: number;
  units: number;
  out_of_stock: number;
  low_stock: number;
  transfers_in_transit: number;
  purchases_month: number;
  payables_total: number;
  payables_overdue: number;
  receivables_total: number;
  warehouses: number;
  suppliers: number;
};

export function OverviewTab({ ctx }: { ctx: ErpCtx }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabaseBrowser()
      .rpc("erp_overview", { p_store: ctx.storeId })
      .then(({ data: result, error: err }) => {
        if (!alive) return;
        if (err) setError(errorMessage(err));
        else setData(result as Overview);
      });
    return () => {
      alive = false;
    };
  }, [ctx.storeId]);

  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="Calculando indicadores…" />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon="💰" label="Inventario valorizado" value={money(data.inventory_value)} />
        <Kpi icon="📦" label="Unidades en existencia" value={String(data.units)} />
        <Kpi icon="⚠️" label="Stock bajo (1-5)" value={String(data.low_stock)} tone={data.low_stock ? "warn" : "good"} />
        <Kpi icon="⛔" label="Agotados" value={String(data.out_of_stock)} tone={data.out_of_stock ? "bad" : "good"} />
        <Kpi icon="🚚" label="Traslados en tránsito" value={String(data.transfers_in_transit)} tone={data.transfers_in_transit ? "warn" : undefined} />
        <Kpi icon="🛒" label="Compras del mes" value={money(data.purchases_month)} />
        <Kpi icon="📤" label="Cuentas por pagar" value={money(data.payables_total)} tone={data.payables_overdue ? "warn" : undefined} />
        <Kpi icon="⏰" label="Por pagar vencido" value={money(data.payables_overdue)} tone={data.payables_overdue ? "bad" : "good"} />
        <Kpi icon="📥" label="Cartera por cobrar" value={money(data.receivables_total)} />
        <Kpi icon="🏬" label="Bodegas activas" value={String(data.warehouses)} />
        <Kpi icon="🏭" label="Proveedores activos" value={String(data.suppliers)} />
      </div>
      <Panel title="Cómo se conecta todo" subtitle="Cada operación actualiza varios módulos a la vez, dentro de una sola transacción.">
        <ul className="grid gap-2 text-sm sm:grid-cols-2" style={{ color: "var(--t-muted)" }}>
          <li><b style={{ color: "var(--t-text)" }}>Ingreso de factura</b> → proveedor → inventario → kardex → costo promedio → cuenta por pagar → auditoría.</li>
          <li><b style={{ color: "var(--t-text)" }}>Traslado</b> → sale de la bodega origen → en tránsito → entra a destino → kardex → auditoría.</li>
          <li><b style={{ color: "var(--t-text)" }}>Ajuste</b> → motivo + responsable + diferencia → inventario → kardex → auditoría.</li>
          <li><b style={{ color: "var(--t-text)" }}>Venta / pedido</b> → descuenta stock, queda con punto, vendedor y consecutivo propio del punto.</li>
        </ul>
      </Panel>
    </div>
  );
}

type StockRow = { id: string; name: string; sku: string | null; cost_price: number; total: number; levels: Record<string, number>; total_count: number };
const PAGE = 25;

export function StockTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const [query, setQuery] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const active = warehouses.filter((w) => w.active);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const { data, error } = await supabaseBrowser().rpc("erp_stock_page", {
        p_store: ctx.storeId, p_q: query, p_only_low: onlyLow, p_limit: PAGE, p_offset: page * PAGE,
      });
      if (id !== seq.current) return;
      setLoading(false);
      if (error) void toast("No se pudieron cargar las existencias", "error", errorMessage(error));
      else setRows((data ?? []) as StockRow[]);
    }, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [ctx.storeId, query, onlyLow, page]);

  const totalCount = rows[0]?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(totalCount / PAGE));

  return (
    <Panel
      title="Existencias por bodega"
      subtitle="Se consulta por páginas: solo se descarga lo que ves, así la base de datos no se cansa."
      actions={
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
          <input type="checkbox" checked={onlyLow} onChange={(e) => { setOnlyLow(e.target.checked); setPage(0); }} /> Solo stock bajo o agotado
        </label>
      }
    >
      <input className={`${inputClass} mb-3`} style={inputStyle} placeholder="Buscar por nombre o SKU…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
      {loading && rows.length === 0 ? (
        <Empty text="Cargando…" />
      ) : rows.length === 0 ? (
        <Empty text="No hay productos para mostrar." />
      ) : (
        <div className={tableWrap} style={{ borderColor: "var(--t-card-border)", opacity: loading ? 0.6 : 1 }}>
          <table className="w-full min-w-[640px]">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr>
                <th className={th}>Producto</th>
                {active.map((w) => <th key={w.id} className={th}>{w.name}</th>)}
                <th className={th}>Total</th>
                <th className={th}>Costo</th>
                <th className={th}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className={td}>
                    <div className="font-semibold">{p.name}</div>
                    {p.sku ? <div className="text-xs" style={{ color: "var(--t-muted)" }}>{p.sku}</div> : null}
                  </td>
                  {active.map((w) => <td key={w.id} className={td}>{p.levels?.[w.id] ?? 0}</td>)}
                  <td className={td} style={{ fontWeight: 700, color: p.total <= 0 ? "#ef4444" : p.total <= 5 ? "#f59e0b" : undefined }}>{p.total}</td>
                  <td className={td}>{money(p.cost_price)}</td>
                  <td className={td}>{money(Math.max(p.total, 0) * Number(p.cost_price ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-xs" style={{ color: "var(--t-muted)" }}>
        <span>{totalCount} producto(s) · página {page + 1} de {pages}</span>
        <div className="flex gap-2">
          <Btn variant="ghost" disabled={page === 0} onClick={() => setPage((v) => Math.max(0, v - 1))}>← Anterior</Btn>
          <Btn variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((v) => v + 1)}>Siguiente →</Btn>
        </div>
      </div>
    </Panel>
  );
}

type WhEdit = { name: string; address: string; phone: string; invoice_prefix: string; remision_prefix: string; next_invoice_number: string; next_remision_number: string };
const toEdit = (w: Warehouse): WhEdit => ({
  name: w.name, address: w.address ?? "", phone: w.phone ?? "", invoice_prefix: w.invoice_prefix ?? "FAC", remision_prefix: w.remision_prefix ?? "REM",
  next_invoice_number: String(w.next_invoice_number ?? 1), next_remision_number: String(w.next_remision_number ?? 1),
});

export function WarehousesTab({ ctx, warehouses, onChanged }: { ctx: ErpCtx; warehouses: Warehouse[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState<"warehouse" | "point">("point");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; form: WhEdit } | null>(null);
  const canEdit = ctx.can("inventory") && !ctx.pointId;

  async function create() {
    if (!name.trim() || !code.trim()) return void toast("Completa nombre y código", "warning");
    setSaving(true);
    const { error } = await supabaseBrowser().from("erp_warehouses").insert({
      store_id: ctx.storeId, name: name.trim(), code: code.trim().toUpperCase(), address: address.trim() || null, kind,
      invoice_prefix: code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 6) || "FAC",
    });
    setSaving(false);
    if (error) return void toast("No se pudo crear", "error", error.code === "23505" ? "Ya existe uno con ese código." : errorMessage(error));
    setName("");
    setCode("");
    setAddress("");
    void toast(kind === "point" ? "Punto físico creado" : "Bodega creada");
    onChanged();
  }

  async function toggle(w: Warehouse) {
    if (w.is_default) return void toast("La bodega principal no se puede desactivar", "warning");
    const { error } = await supabaseBrowser().from("erp_warehouses").update({ active: !w.active, updated_at: new Date().toISOString() }).eq("id", w.id);
    if (error) void toast("No se pudo actualizar", "error", errorMessage(error));
    else onChanged();
  }

  async function saveEdit() {
    if (!editing) return;
    const f = editing.form;
    if (!f.name.trim()) return void toast("El nombre es obligatorio", "warning");
    const prefixOk = /^[A-Za-z0-9-]{0,12}$/;
    if (!prefixOk.test(f.invoice_prefix) || !prefixOk.test(f.remision_prefix)) return void toast("Prefijo inválido", "warning", "Usa solo letras, números o guion (máx. 12).");
    const { error } = await supabaseBrowser().from("erp_warehouses").update({
      name: f.name.trim(), address: f.address.trim() || null, phone: f.phone.trim() || null,
      invoice_prefix: f.invoice_prefix.trim().toUpperCase(), remision_prefix: f.remision_prefix.trim().toUpperCase(),
      next_invoice_number: Math.max(1, Math.floor(Number(f.next_invoice_number) || 1)),
      next_remision_number: Math.max(1, Math.floor(Number(f.next_remision_number) || 1)),
      updated_at: new Date().toISOString(),
    }).eq("id", editing.id);
    if (error) return void toast("No se pudo guardar", "error", errorMessage(error));
    setEditing(null);
    void toast("Cambios guardados");
    onChanged();
  }

  const field = (label: string, key: keyof WhEdit, type = "text") => (
    <label className="block text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
      {label}
      <input
        type={type}
        className={`${inputClass} mt-1`}
        style={inputStyle}
        value={editing?.form[key] ?? ""}
        onChange={(e) => editing && setEditing({ ...editing, form: { ...editing.form, [key]: e.target.value } })}
      />
    </label>
  );

  return (
    <div className="space-y-5">
      {canEdit ? (
        <Panel title="Nuevo punto físico o bodega" subtitle="Los puntos venden y tienen sus propios prefijos de factura; las bodegas solo guardan mercancía.">
          <div className="grid gap-2 sm:grid-cols-5">
            <select className={inputClass} style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value as "warehouse" | "point")}>
              <option value="point">📍 Punto físico (vende)</option>
              <option value="warehouse">🏬 Bodega (almacena)</option>
            </select>
            <input className={inputClass} style={inputStyle} placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={inputClass} style={inputStyle} placeholder="Código (ej. SUC1)" value={code} onChange={(e) => setCode(e.target.value)} />
            <input className={inputClass} style={inputStyle} placeholder="Dirección (opcional)" value={address} onChange={(e) => setAddress(e.target.value)} />
            <Btn onClick={() => void create()} disabled={saving}>{saving ? "Guardando…" : "Crear"}</Btn>
          </div>
        </Panel>
      ) : null}
      <Panel title="Puntos y bodegas" subtitle="Edita aquí los prefijos y el siguiente consecutivo de facturas y remisiones de cada punto.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {warehouses.map((w) => (
            <div key={w.id} className="glass-soft rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", opacity: w.active ? 1 : 0.6 }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{w.kind === "point" ? "📍" : "🏬"} {w.name}</p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{w.code}{w.address ? ` · ${w.address}` : ""}</p>
                </div>
                {w.is_default ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)", color: "var(--t-accent)" }}>Principal</span> : null}
              </div>
              {w.kind === "point" ? (
                <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
                  Factura: <b style={{ color: "var(--t-text)" }}>{w.invoice_prefix}-{String(w.next_invoice_number).padStart(5, "0")}</b> · Remisión: <b style={{ color: "var(--t-text)" }}>{w.remision_prefix}-{String(w.next_remision_number).padStart(5, "0")}</b>
                </p>
              ) : null}
              {editing?.id === w.id ? (
                <div className="mt-3 space-y-2">
                  {field("Nombre", "name")}
                  {field("Dirección", "address")}
                  {field("Teléfono", "phone")}
                  <div className="grid grid-cols-2 gap-2">
                    {field("Prefijo factura", "invoice_prefix")}
                    {field("Próx. n.º factura", "next_invoice_number", "number")}
                    {field("Prefijo remisión", "remision_prefix")}
                    {field("Próx. n.º remisión", "next_remision_number", "number")}
                  </div>
                  <div className="flex gap-2">
                    <Btn onClick={() => void saveEdit()}>Guardar</Btn>
                    <Btn variant="ghost" onClick={() => setEditing(null)}>Cancelar</Btn>
                  </div>
                </div>
              ) : canEdit ? (
                <div className="mt-3 flex gap-2">
                  <Btn variant="ghost" onClick={() => setEditing({ id: w.id, form: toEdit(w) })}>Editar</Btn>
                  {!w.is_default ? <Btn variant="ghost" onClick={() => void toggle(w)}>{w.active ? "Desactivar" : "Activar"}</Btn> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}