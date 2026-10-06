"use client";

import { IconBtn } from "@/app/dashboard/IconBtn";
import { WithDv, docWithDv } from "@/app/dashboard/nit";
import { useCallback, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "../MoneyInput";
import { AttachmentPicker, PurchaseFilesButton, uploadStaged, type Staged } from "./AttachmentsUI";
import { LineEditor, type Line } from "./LineEditor";
import {
  Btn, Empty, Panel, StatusPill, askReason, dateTime, errorMessage, inputClass, inputStyle, money, tableWrap, td, th, toast, useRunOnChange,
  type ErpCtx, type Warehouse,
} from "./shared";

/** Comprobante imprimible (tipo factura) de un ingreso de mercancía. */
const purchaseReceiptUrl = (id: string, choose = false) => `/comprobante/ingreso/${id}${choose ? "?elegir=1" : ""}`;

type Supplier = { id: string; name: string; nit: string | null; contact_name: string | null; phone: string | null; email: string | null; payment_days: number; active: boolean };

export function useSuppliers(storeId: string) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const reload = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from("erp_suppliers")
      .select("id,name,nit,contact_name,phone,email,payment_days,active")
      .eq("store_id", storeId)
      .order("name");
    if (error) void toast("No se pudieron cargar los proveedores", "error", errorMessage(error));
    else setSuppliers((data ?? []) as Supplier[]);
  }, [storeId]);
  useRunOnChange(reload);
  return { suppliers, reload };
}

export function SuppliersTab({ ctx }: { ctx: ErpCtx }) {
  const { suppliers, reload } = useSuppliers(ctx.storeId);
  const [form, setForm] = useState({ name: "", nit: "", contact_name: "", phone: "", email: "", payment_days: "0" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = ctx.can("suppliers");

  function startEdit(sp: Supplier) {
    setEditingId(sp.id);
    setForm({ name: sp.name, nit: sp.nit ?? "", contact_name: sp.contact_name ?? "", phone: sp.phone ?? "", email: sp.email ?? "", payment_days: String(sp.payment_days) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ name: "", nit: "", contact_name: "", phone: "", email: "", payment_days: "0" });
  }

  async function create() {
    if (!form.name.trim()) return void toast("El nombre es obligatorio", "warning");
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      nit: form.nit.trim() || null,
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      payment_days: Math.max(0, Math.floor(Number(form.payment_days) || 0)),
    };
    const sb = supabaseBrowser();
    const { error } = editingId
      ? await sb.from("erp_suppliers").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editingId)
      : await sb.from("erp_suppliers").insert({ store_id: ctx.storeId, ...payload });
    setSaving(false);
    if (error) return void toast(editingId ? "No se pudo modificar el tercero" : "No se pudo crear el proveedor", "error", errorMessage(error));
    cancelEdit();
    void toast(editingId ? "Tercero modificado ✅" : "Proveedor creado");
    void reload();
  }

  async function toggle(s: Supplier) {
    const { error } = await supabaseBrowser().from("erp_suppliers").update({ active: !s.active, updated_at: new Date().toISOString() }).eq("id", s.id);
    if (error) void toast("No se pudo actualizar", "error", errorMessage(error));
    else void reload();
  }

  return (
    <div className="space-y-5">
      {canEdit ? (
        <Panel title={editingId ? "✏️ Modificar tercero (proveedor)" : "Nuevo proveedor"}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input className={inputClass} style={inputStyle} placeholder="Nombre / razón social *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <WithDv value={form.nit}><input className={inputClass} style={inputStyle} placeholder="NIT" value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} /></WithDv>
            <input className={inputClass} style={inputStyle} placeholder="Contacto" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            <input className={inputClass} style={inputStyle} placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className={inputClass} style={inputStyle} placeholder="Correo" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input type="number" min={0} className={inputClass} style={inputStyle} placeholder="Días de crédito" value={form.payment_days} onChange={(e) => setForm({ ...form, payment_days: e.target.value })} />
          </div>
          <div className="mt-3 flex gap-2"><Btn onClick={() => void create()} disabled={saving}>{saving ? "Guardando…" : editingId ? "💾 Guardar cambios" : "Crear proveedor"}</Btn>{editingId ? <Btn variant="ghost" onClick={cancelEdit}>Cancelar</Btn> : null}</div>
        </Panel>
      ) : null}
      <Panel title="Proveedores">
        {suppliers.length === 0 ? <Empty text="Aún no tienes proveedores." /> : (
          <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
            <table className="w-full min-w-[620px]">
              <thead style={{ color: "var(--t-muted)" }}>
                <tr><th className={th}>Proveedor</th><th className={th}>NIT</th><th className={th}>Contacto</th><th className={th}>Crédito</th><th className={th} /></tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t" style={{ borderColor: "var(--t-card-border)", opacity: s.active ? 1 : 0.55 }}>
                    <td className={td} style={{ fontWeight: 600 }}>{s.name}</td>
                    <td className={td}>{s.nit ? docWithDv(s.nit) : "—"}</td>
                    <td className={td}>{[s.contact_name, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={td}>{s.payment_days} días</td>
                    <td className={td}>{canEdit ? <div className="flex gap-2"><IconBtn icon="edit" title="Modificar tercero" onClick={() => startEdit(s)} /><IconBtn icon="power" tone={s.active ? "amber" : "green"} title={s.active ? "Desactivar" : "Activar"} onClick={() => void toggle(s)} /></div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

type PurchaseRow = {
  id: string; number: number; status: string; invoice_ref: string | null; payment_type: string; due_date: string | null;
  total: number; created_at: string; supplier_id: string; invoice_date: string | null;
  created_by_name: string | null; checked_by_name: string | null; received_by_name: string | null;
};

export function PurchasesTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const active = warehouses.filter((w) => w.active);
  const { suppliers } = useSuppliers(ctx.storeId);
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [nextNumber, setNextNumber] = useState<number | null>(null);
  const [supplier, setSupplier] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const defaultWh = warehouse || active.find((w) => w.is_default)?.id || active[0]?.id || "";
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [checkedBy, setCheckedBy] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [paymentType, setPaymentType] = useState<"cash" | "credit">("cash");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const canBuy = ctx.can("purchases");
  const supplierNames = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data, error }, { data: last }] = await Promise.all([
      sb.from("erp_purchases")
        .select("id,number,status,invoice_ref,payment_type,due_date,total,created_at,supplier_id,invoice_date,created_by_name,checked_by_name,received_by_name")
        .eq("store_id", ctx.storeId)
        .order("created_at", { ascending: false })
        .limit(50),
      // El consecutivo real lo asigna erp_receive_invoice (erp_counters); aquí solo se muestra el siguiente.
      sb.from("erp_purchases").select("number").eq("store_id", ctx.storeId).order("number", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error) void toast("No se pudieron cargar las compras", "error", errorMessage(error));
    else {
      setRows((data ?? []) as PurchaseRow[]);
      setNextNumber(Number(last?.number ?? 0) + 1);
    }
  }, [ctx.storeId]);

  useRunOnChange(load);

  const totals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
    const tax = lines.reduce((s, l) => s + (l.qty * l.unit_cost * l.tax_rate) / 100, 0);
    return { sub, tax, total: sub + tax };
  }, [lines]);

  async function save() {
    if (!supplier) return void toast("Elige el proveedor", "warning");
    if (!invoiceRef.trim()) return void toast("Escribe el número de la factura del proveedor", "warning");
    if (!checkedBy.trim()) return void toast("Indica quién revisó la mercancía", "warning");
    const valid = lines.filter((l) => l.qty > 0);
    if (!valid.length) return void toast("Agrega al menos un producto", "warning");
    setBusy(true);
    // La pestaña del comprobante se abre ya (los navegadores bloquean ventanas abiertas después de esperar).
    const receiptWin = window.open("", "_blank");
    const { data: purchaseId, error } = await supabaseBrowser().rpc("erp_receive_invoice", {
      p_store: ctx.storeId, p_supplier: supplier, p_invoice_ref: invoiceRef.trim(), p_invoice_date: invoiceDate || null, p_checked_by: checkedBy,
      p_payment_type: paymentType, p_due_date: paymentType === "credit" && dueDate ? dueDate : null, p_notes: notes,
      p_items: valid.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.unit_cost, tax_rate: l.tax_rate, warehouse_id: l.warehouse_id })),
    });
    if (error) {
      receiptWin?.close();
      setBusy(false);
      return void toast("No se pudo registrar la factura", "error", errorMessage(error));
    }
    const { data: created } = purchaseId
      ? await supabaseBrowser().from("erp_purchases").select("id,number").eq("id", purchaseId as string).maybeSingle()
      : { data: null };
    let filesFailed = 0;
    if (staged.length) {
      filesFailed = created?.id ? await uploadStaged(ctx.storeId, created.id as string, staged) : staged.length;
      staged.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setStaged([]);
    }
    setBusy(false);
    if (filesFailed) void toast("Factura registrada, pero algunos archivos no se subieron", "warning", "Revisa que hayas ejecutado erp_purchase_files.sql");
    setLines([]);
    setInvoiceRef("");
    setNotes("");
    if (purchaseId) {
      const url = purchaseReceiptUrl(purchaseId as string, true);
      if (receiptWin && !receiptWin.closed) receiptWin.location.href = url;
      else window.open(url, "_blank");
    } else {
      receiptWin?.close();
    }
    void toast(`Ingreso #${created?.number ?? ""} registrado: inventario, costo y cuenta por pagar actualizados`, "success", "Se abrió el comprobante: elige si lo quieres a costo o con Precio 1 a 5 y se imprime.");
    void load();
  }

  async function cancel(row: PurchaseRow) {
    const reason = await askReason(`Anular compra #${row.number}`);
    if (!reason) return;
    const { error } = await supabaseBrowser().rpc("erp_cancel_purchase", { p_purchase: row.id, p_reason: reason });
    if (error) return void toast("No se pudo anular", "error", errorMessage(error));
    void toast("Compra anulada");
    void load();
  }

  return (
    <div className="space-y-5">
      {canBuy ? (
        <Panel title="Ingreso de factura de proveedor" subtitle="Elige a qué bodega entra cada producto. Al guardar suma al inventario, recalcula el costo promedio y, si es a crédito, crea la cuenta por pagar.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input readOnly className={inputClass} style={{ ...inputStyle, fontWeight: 700, cursor: "default" }} value={nextNumber ? `N.º ${nextNumber}` : "N.º …"} aria-label="Número interno del ingreso" title="Consecutivo interno asignado automáticamente al guardar" />
            <select className={inputClass} style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Proveedor…</option>
              {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" className={inputClass} style={inputStyle} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} aria-label="Fecha de la factura" title="Fecha de la factura" />
            <input className={inputClass} style={inputStyle} placeholder="N.º factura del proveedor *" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
            <select className={inputClass} style={inputStyle} value={paymentType} onChange={(e) => setPaymentType(e.target.value as "cash" | "credit")}>
              <option value="cash">Pago de contado</option>
              <option value="credit">A crédito (cuenta por pagar)</option>
            </select>
            {paymentType === "credit" ? (
              <input type="date" className={inputClass} style={inputStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Vencimiento" />
            ) : null}
            <input className={inputClass} style={inputStyle} placeholder="¿Quién revisó la mercancía? *" value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} />
            <input className={inputClass} style={inputStyle} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="mt-3"><div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span style={{ color: "var(--t-muted)" }}>Bodega para los productos nuevos:</span>
              <select className={`${inputClass} w-auto`} style={inputStyle} value={defaultWh} onChange={(e) => setWarehouse(e.target.value)}>
                {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <span className="text-xs" style={{ color: "var(--t-muted)" }}>(puedes cambiarla producto por producto)</span>
            </div>
            <LineEditor storeId={ctx.storeId} lines={lines} onChange={(next) => { setLines(next); setStaged((cur) => cur.filter((f) => !f.product_id || next.some((l) => l.product_id === f.product_id))); }} mode="purchase" warehouseId={defaultWh} warehouses={warehouses} /></div>
          <div className="mt-3"><AttachmentPicker staged={staged} onChange={setStaged} /></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              Subtotal {money(totals.sub)} · IVA {money(totals.tax)} · <b style={{ color: "var(--t-text)" }}>Total {money(totals.total)}</b>
            </p>
            <Btn onClick={() => void save()} disabled={busy}>{busy ? "Guardando…" : "📥 Registrar ingreso"}</Btn>
          </div>
        </Panel>
      ) : null}

      <Panel title="Historial de ingresos">
        {rows.length === 0 ? <Empty text="Todavía no hay ingresos de factura." /> : (
          <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
            <table className="w-full min-w-[720px]">
              <thead style={{ color: "var(--t-muted)" }}>
                <tr><th className={th}>N.º</th><th className={th}>Fecha</th><th className={th}>Proveedor</th><th className={th}>Revisó / Recibió</th><th className={th}>Pago</th><th className={th}>Total</th><th className={th}>Estado</th><th className={th} /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                    <td className={td} style={{ fontWeight: 600 }}>#{r.number}{r.invoice_ref ? <span className="block text-xs font-normal" style={{ color: "var(--t-muted)" }}>{r.invoice_ref}</span> : null}</td>
                    <td className={td}>{r.invoice_date ?? dateTime(r.created_at)}</td>
                    <td className={td}>{supplierNames.get(r.supplier_id) ?? "—"}</td>
                    <td className={td}>{r.checked_by_name ?? "—"} / {r.received_by_name ?? r.created_by_name ?? "—"}</td>
                    <td className={td}>{r.payment_type === "credit" ? `Crédito${r.due_date ? ` · vence ${r.due_date}` : ""}` : "Contado"}</td>
                    <td className={td}>{money(r.total)}</td>
                    <td className={td}><StatusPill status={r.status} /></td>
                    <td className={td}><div className="flex flex-wrap gap-1"><Btn variant="ghost" onClick={() => window.open(purchaseReceiptUrl(r.id, true), "_blank")}>🧾 Comprobante</Btn><PurchaseFilesButton purchaseId={r.id} />{canBuy && r.status === "received" ? <Btn variant="danger" onClick={() => void cancel(r)}>Anular</Btn> : null}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

type PayableRow = { id: string; supplier_id: string; purchase_id: string | null; total: number; balance: number; due_date: string | null; status: string; created_at: string };

export function PayablesTab({ ctx }: { ctx: ErpCtx }) {
  const { suppliers } = useSuppliers(ctx.storeId);
  const [rows, setRows] = useState<PayableRow[]>([]);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const canPay = ctx.can("payables");
  const names = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from("erp_payables")
      .select("id,supplier_id,purchase_id,total,balance,due_date,status,created_at")
      .eq("store_id", ctx.storeId)
      .order("status")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(100);
    if (error) void toast("No se pudieron cargar las cuentas por pagar", "error", errorMessage(error));
    else setRows((data ?? []) as PayableRow[]);
  }, [ctx.storeId]);

  useRunOnChange(load);

  async function pay(row: PayableRow) {
    const value = Number(amount);
    if (!value || value <= 0) return void toast("Escribe el monto del pago", "warning");
    const { error } = await supabaseBrowser().rpc("erp_pay_supplier", { p_payable: row.id, p_amount: value, p_method: method, p_reference: reference });
    if (error) return void toast("No se pudo registrar el pago", "error", errorMessage(error));
    setPayingId(null);
    setAmount("");
    setReference("");
    void toast("Pago registrado");
    void load();
  }

  const pending = rows.filter((r) => r.status === "open").reduce((s, r) => s + Number(r.balance), 0);

  return (
    <Panel title="Cuentas por pagar" subtitle={`Saldo pendiente con proveedores: ${money(pending)}`}>
      {rows.length === 0 ? <Empty text="No hay cuentas por pagar. Se crean al registrar compras a crédito." /> : (
        <div className="space-y-3">
          {rows.map((r) => {
            const overdue = r.status === "open" && r.due_date && r.due_date < today;
            return (
              <div key={r.id} className="glass-soft rounded-2xl border p-4" style={{ borderColor: overdue ? "color-mix(in oklab, #ef4444 45%, transparent)" : "var(--t-card-border)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{names.get(r.supplier_id) ?? "Proveedor"}</p>
                  <div className="flex items-center gap-2">{overdue ? <StatusPill status="cancelled" /> : null}<StatusPill status={r.status} /></div>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                  Total {money(r.total)} · Saldo <b style={{ color: "var(--t-text)" }}>{money(r.balance)}</b>{r.due_date ? ` · vence ${r.due_date}` : ""}{overdue ? " (vencida)" : ""}
                </p>
                {canPay && r.status === "open" ? (
                  payingId === r.id ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      <MoneyInput allowEmpty className={inputClass} style={inputStyle} placeholder="$ Monto" value={amount === "" ? null : Math.min(Number(amount), r.balance)} onValueChange={(v) => setAmount(v === null ? "" : String(Math.min(v, r.balance)))} />
                      <select className={inputClass} style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
                        <option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="card">Tarjeta</option><option value="other">Otro</option>
                      </select>
                      <input className={inputClass} style={inputStyle} placeholder="Referencia" value={reference} onChange={(e) => setReference(e.target.value)} />
                      <div className="flex gap-2"><Btn onClick={() => void pay(r)}>Pagar</Btn><Btn variant="ghost" onClick={() => setPayingId(null)}>Cancelar</Btn></div>
                    </div>
                  ) : (
                    <div className="mt-3"><Btn onClick={() => { setPayingId(r.id); setAmount(String(r.balance)); }}>💸 Registrar pago</Btn></div>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
