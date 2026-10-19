"use client";

import { IconBtn } from "@/app/dashboard/IconBtn";
import { WithDv, docWithDv } from "@/app/dashboard/nit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AttachmentPicker, uploadStaged, type Staged } from "./AttachmentsUI";
import { LineEditor, type Line, type LineEditorHandle } from "./LineEditor";
import { clearDraft, loadDraftFiles, readDraft, saveDraftFiles, timeAgo, writeDraft } from "./draft";
import {
  Btn, Empty, Panel, askReason, confirmAction, errorMessage, inputClass, inputStyle, money, tableWrap, td, th, toast, useRunOnChange,
  type ErpCtx, type Warehouse,
} from "./shared";
import { DateField } from "@/components/forms/Fields";
import { PurchaseHistory } from "./PurchaseHistory";
import { usePurchaseSearch, type PurchaseRow } from "./purchase-search";
import { MarkupToolbar } from "./MarkupToolbar";
import { QuickProductModal } from "./QuickProductModal";
import { lineFromHit } from "./LineEditor";
import { usePurchasePricing } from "./purchase-pricing";

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
      <Panel title="Proveedores" subtitle="Cada proveedor también aparece en Terceros y cartera (menú principal), con todos sus datos.">
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


type PurchaseForm = {
  supplier: string;
  warehouse: string;
  invoiceDate: string;
  checkedBy: string;
  invoiceRef: string;
  paymentType: "cash" | "credit";
  dueDate: string;
  notes: string;
  lines: Line[];
};

type Editing = { id: string; number: number };
type PurchaseDraft = { v: 1; savedAt: string; editing: Editing | null; form: PurchaseForm };

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (): PurchaseForm => ({
  supplier: "", warehouse: "", invoiceDate: today(), checkedBy: "", invoiceRef: "", paymentType: "cash", dueDate: "", notes: "", lines: [],
});
/** Hay trabajo que cuidar: productos, número de factura o notas (el proveedor solo no cuenta). */
const formHasWork = (f: PurchaseForm) => Boolean(f.lines.length || f.invoiceRef.trim() || f.notes.trim());

export function PurchasesTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const active = warehouses.filter((w) => w.active);
  const { suppliers } = useSuppliers(ctx.storeId);
  const [nextNumber, setNextNumber] = useState<number | null>(null);
  const [form, setForm] = useState<PurchaseForm>(emptyForm);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [online, setOnline] = useState(true);
  const [, setTick] = useState(0);
  const editorRef = useRef<LineEditorHandle>(null);
  const formTopRef = useRef<HTMLDivElement>(null);
  const canBuy = ctx.can("purchases");
  const canVoid = ctx.can("purchases_void");
  // % de ganancia desde la factura: solo con permiso de precios.
  const canPrices = ctx.can("products_prices");
  // Crear producto rápido sin salir de la factura (null = cerrado; texto = nombre sugerido).
  const [quickName, setQuickName] = useState<string | null>(null);
  const canCreateProducts = ctx.can("products");
  const pricing = usePurchasePricing(ctx.storeId, form.lines.map((l) => l.product_id), canBuy && canPrices);
  const search = usePurchaseSearch(ctx.storeId, suppliers);
  const reloadHistory = search.reload;
  const defaultWh = form.warehouse || active.find((w) => w.is_default)?.id || active[0]?.id || "";

  const draftBase = `remhub:purchase-draft:v1:${ctx.storeId}`;
  const draftKey = (mode: Editing | null) => `${draftBase}:${mode ? `edit:${mode.id}` : "new"}`;
  const editPointer = `${draftBase}:editing`;

  const patchForm = (change: Partial<PurchaseForm>) => setForm((cur) => ({ ...cur, ...change }));

  const load = useCallback(async () => {
    // El consecutivo real lo asigna erp_receive_invoice (erp_counters); aquí solo se muestra el siguiente.
    const [{ data: last }] = await Promise.all([
      supabaseBrowser().from("erp_purchases").select("number").eq("store_id", ctx.storeId).order("number", { ascending: false }).limit(1).maybeSingle(),
      reloadHistory(),
    ]);
    setNextNumber(Number(last?.number ?? 0) + 1);
  }, [ctx.storeId, reloadHistory]);

  useRunOnChange(load);

  // Recupera el borrador al entrar (ingreso nuevo o edición que quedó a medias).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const pointer = readDraft<Editing>(editPointer);
      const mode = pointer && readDraft<PurchaseDraft>(draftKey(pointer)) ? pointer : null;
      const draft = readDraft<PurchaseDraft>(draftKey(mode));
      const files = await loadDraftFiles(draftKey(mode));
      if (!alive) return;
      if (draft?.form && (formHasWork(draft.form) || mode)) {
        setForm({ ...emptyForm(), ...draft.form });
        setEditing(mode);
        setSavedAt(draft.savedAt);
        setRestored(true);
      }
      if (files.length) setStaged(files);
      setDraftReady(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.storeId]);

  // Guardado automático del borrador (cada cambio, con una pequeña espera).
  useEffect(() => {
    if (!draftReady) return;
    const key = draftKey(editing);
    const timer = window.setTimeout(() => {
      if (!editing && !formHasWork(form) && !staged.length) {
        clearDraft(key);
        setSavedAt(null);
        return;
      }
      const at = new Date().toISOString();
      if (writeDraft(key, { v: 1, savedAt: at, editing, form } satisfies PurchaseDraft)) setSavedAt(at);
      void saveDraftFiles(key, staged);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, staged, editing, draftReady]);

  useEffect(() => {
    if (!draftReady) return;
    if (editing) writeDraft(editPointer, editing);
    else clearDraft(editPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draftReady]);

  // Estado de conexión y reloj del "guardado hace…".
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const timer = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.clearInterval(timer);
    };
  }, []);

  // Atajos: F2 agrega producto, Ctrl + Enter registra.
  useEffect(() => {
    if (!canBuy) return;
    function onKey(e: globalThis.KeyboardEvent) {
      // Con «Crear producto» abierto, sus atajos (Enter / Ctrl + Enter) son de esa ventana, no de la factura.
      if (quickName !== null) return;
      if (e.key === "F2") {
        e.preventDefault();
        editorRef.current?.openPicker();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const totals = useMemo(() => {
    const sub = form.lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
    const tax = form.lines.reduce((s, l) => s + (l.qty * l.unit_cost * l.tax_rate) / 100, 0);
    return { sub, tax, total: sub + tax };
  }, [form.lines]);

  function releaseStaged() {
    staged.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
  }

  async function switchMode(next: Editing | null, nextForm?: PurchaseForm) {
    releaseStaged();
    const draft = readDraft<PurchaseDraft>(draftKey(next));
    const files = await loadDraftFiles(draftKey(next));
    setEditing(next);
    setForm(nextForm ?? (draft?.form ? { ...emptyForm(), ...draft.form } : emptyForm()));
    setStaged(files);
    setSavedAt(draft?.savedAt ?? null);
    setRestored(false);
  }

  async function startEdit(row: PurchaseRow) {
    if (editing?.id === row.id) {
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (editing && !(await confirmAction("Ya estás editando otro ingreso", `Tus cambios del ingreso #${editing.number} quedan guardados como borrador. ¿Abrir el #${row.number}?`, "Abrir"))) return;
    const pending = readDraft<PurchaseDraft>(draftKey({ id: row.id, number: row.number }));
    if (pending?.form) {
      const resume = await confirmAction(`Tienes cambios sin guardar del ingreso #${row.number}`, `Guardados ${timeAgo(pending.savedAt)}. ¿Quieres continuar donde ibas?`, "Continuar");
      if (resume) {
        await switchMode({ id: row.id, number: row.number });
        setRestored(true);
        formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      clearDraft(draftKey({ id: row.id, number: row.number }));
    }
    setLoadingEdit(row.id);
    const sb = supabaseBrowser();
    const [{ data: head, error: headError }, { data: items, error: itemsError }] = await Promise.all([
      sb.from("erp_purchases").select("supplier_id,invoice_ref,invoice_date,payment_type,due_date,notes,checked_by_name,warehouse_id,status").eq("id", row.id).maybeSingle(),
      sb.from("erp_purchase_items").select("product_id,qty,unit_cost,tax_rate,warehouse_id,note,line_no,products(name,sku)").eq("purchase_id", row.id)
        // Si aún no existe la columna de comentarios, se abre igual sin ellos.
        .then((res) => (res.error ? sb.from("erp_purchase_items").select("product_id,qty,unit_cost,tax_rate,warehouse_id,products(name,sku)").eq("purchase_id", row.id) : res)),
    ]);
    setLoadingEdit(null);
    if (headError || itemsError || !head) return void toast("No se pudo abrir el ingreso", "error", errorMessage(headError ?? itemsError));
    if (head.status !== "received") return void toast("Este ingreso está anulado y no se puede editar", "warning");
    type ItemRow = { product_id: string; qty: number; unit_cost: number; tax_rate: number; warehouse_id: string | null; note?: string | null; line_no?: number | null; products: { name: string; sku: string | null } | { name: string; sku: string | null }[] | null };
    // Mismo orden en que se agregaron (los ingresos viejos sin orden quedan como los devuelve la base).
    const ordered = [...((items ?? []) as unknown as ItemRow[])].sort((a, b) => (a.line_no ?? 1e9) - (b.line_no ?? 1e9));
    const lines: Line[] = ordered.map((it) => {
      const product = Array.isArray(it.products) ? it.products[0] : it.products;
      return {
        product_id: it.product_id,
        name: product?.name ?? "Producto",
        sku: product?.sku ?? null,
        current: 0,
        qty: Number(it.qty),
        unit_cost: Number(it.unit_cost),
        tax_rate: Number(it.tax_rate ?? 0),
        warehouse_id: it.warehouse_id ?? head.warehouse_id,
        note: it.note ?? "",
      };
    });
    await switchMode({ id: row.id, number: row.number }, {
      supplier: head.supplier_id,
      warehouse: head.warehouse_id ?? "",
      invoiceDate: head.invoice_date ?? today(),
      checkedBy: head.checked_by_name ?? "",
      invoiceRef: head.invoice_ref ?? "",
      paymentType: head.payment_type === "credit" ? "credit" : "cash",
      dueDate: head.due_date ?? "",
      notes: head.notes ?? "",
      lines,
    });
    formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function cancelEdit() {
    if (!editing) return;
    if (!(await confirmAction(`¿Salir de la edición del #${editing.number}?`, "Se descartan los cambios que no guardaste en este ingreso.", "Salir sin guardar"))) return;
    clearDraft(draftKey(editing));
    await switchMode(null);
  }

  async function discardDraft() {
    if (!(await confirmAction("¿Descartar el borrador?", "Se borran los productos y datos que llevas en este ingreso.", "Descartar"))) return;
    clearDraft(draftKey(editing));
    releaseStaged();
    setStaged([]);
    setRestored(false);
    if (editing) await switchMode(null);
    else setForm(emptyForm());
  }

  async function save() {
    if (busy) return;
    const f = form;
    if (!f.supplier) return void toast("Elige el proveedor", "warning");
    if (!f.invoiceRef.trim()) return void toast("Escribe el número de la factura del proveedor", "warning");
    if (!f.checkedBy.trim()) return void toast("Indica quién revisó la mercancía", "warning");
    const valid = f.lines.filter((l) => l.qty > 0);
    if (!valid.length) return void toast("Agrega al menos un producto", "warning");
    if (valid.length < f.lines.length && !(await confirmAction("Hay productos con cantidad 0", "Esos productos no se registrarán. ¿Continuar?", "Continuar"))) return;
    if (!navigator.onLine) return void toast("Sin conexión a internet", "warning", "Tu ingreso quedó guardado como borrador en este equipo. Regístralo cuando vuelva la conexión.");
    const items = valid.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.unit_cost, tax_rate: l.tax_rate, warehouse_id: l.warehouse_id }));
    // Orden y comentario de cada producto (se guardan aparte para no tocar el registro del ingreso).
    const notes = valid.map((l) => ({ product_id: l.product_id, warehouse_id: l.warehouse_id, note: (l.note ?? "").trim().toUpperCase() }));
    // Los % de ganancia escritos se guardan en cada producto (los 5 precios); la base recalcula los precios con el nuevo costo.
    const marked = canPrices ? valid.filter((l) => l.markup !== null && l.markup !== undefined) : [];
    const saveMarkups = async () => {
      if (!marked.length) return;
      const sb = supabaseBrowser();
      let failed = 0;
      const uniq = [...new Map(marked.map((l) => [l.product_id, Number(l.markup)])).entries()];
      for (let i = 0; i < uniq.length; i += 8) {
        const res = await Promise.all(uniq.slice(i, i + 8).map(([id, m]) =>
          sb.from("products").update({ markup_1: m, markup_2: m, markup_3: m, markup_4: m, markup_5: m }).eq("id", id).eq("store_id", ctx.storeId)));
        failed += res.filter((r) => r.error).length;
      }
      if (failed) void toast("Algunos % de ganancia no se guardaron", "warning", `${failed} de ${uniq.length} producto(s). Revisa tu permiso «Precios de productos».`);
      else void toast(`Precios actualizados en ${uniq.length} producto(s)`, "success", "Con el % que escribiste para los 5 precios.");
    };
    const saveNotes = async (purchaseId: string) => {
      const { error: noteError } = await supabaseBrowser().rpc("erp_purchase_set_notes", { p_purchase: purchaseId, p_notes: notes });
      if (noteError) void toast("Los comentarios de los productos no se guardaron", "warning", /erp_purchase_set_notes|Could not find/i.test(noteError.message) ? "Ejecuta en Supabase la migración 20261029_orden_productos_ingreso.sql." : errorMessage(noteError));
    };

    if (editing) {
      const ask = await Swal.fire({
        icon: "question",
        title: `Guardar cambios del ingreso #${editing.number}`,
        html: "Se ajustará el inventario solo por la diferencia, se corregirá el costo promedio y la cuenta por pagar.",
        input: "text",
        inputPlaceholder: "Motivo del cambio (opcional)",
        showCancelButton: true,
        confirmButtonText: "Guardar cambios",
        cancelButtonText: "Seguir editando",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#8b5cf6",
      });
      if (!ask.isConfirmed) return;
      setBusy(true);
      const { error } = await supabaseBrowser().rpc("erp_update_purchase", {
        p_purchase: editing.id, p_supplier: f.supplier, p_invoice_ref: f.invoiceRef.trim(), p_invoice_date: f.invoiceDate || null,
        p_payment_type: f.paymentType, p_due_date: f.paymentType === "credit" && f.dueDate ? f.dueDate : null, p_notes: f.notes,
        p_checked_by: f.checkedBy, p_items: items, p_reason: String(ask.value ?? "").trim() || null,
      });
      if (error) {
        setBusy(false);
        const missing = /erp_update_purchase|Could not find the function/i.test(error.message ?? "");
        return void toast("No se pudieron guardar los cambios", "error", missing ? "Ejecuta en Supabase la migración 20261016_smart_search_purchase_edit_tracking.sql." : errorMessage(error));
      }
      await saveNotes(editing.id);
      await saveMarkups();
      const filesFailed = staged.length ? await uploadStaged(ctx.storeId, editing.id, staged) : 0;
      const done = editing;
      clearDraft(draftKey(done));
      await switchMode(null);
      setBusy(false);
      void load();
      const res = await Swal.fire({
        icon: filesFailed ? "warning" : "success",
        title: `Ingreso #${done.number} actualizado`,
        text: filesFailed ? "Los cambios se guardaron, pero algunos archivos no se subieron." : "Inventario, costo promedio y cuenta por pagar quedaron al día.",
        showCancelButton: true,
        confirmButtonText: "🧾 Ver comprobante",
        cancelButtonText: "Cerrar",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonColor: "#8b5cf6",
      });
      if (res.isConfirmed) window.open(purchaseReceiptUrl(done.id, true), "_blank");
      return;
    }

    setBusy(true);
    // La pestaña del comprobante se abre ya (los navegadores bloquean ventanas abiertas después de esperar).
    const receiptWin = window.open("", "_blank");
    const { data: purchaseId, error } = await supabaseBrowser().rpc("erp_receive_invoice", {
      p_store: ctx.storeId, p_supplier: f.supplier, p_invoice_ref: f.invoiceRef.trim(), p_invoice_date: f.invoiceDate || null, p_checked_by: f.checkedBy,
      p_payment_type: f.paymentType, p_due_date: f.paymentType === "credit" && f.dueDate ? f.dueDate : null, p_notes: f.notes,
      p_items: items,
    });
    if (error) {
      receiptWin?.close();
      setBusy(false);
      return void toast("No se pudo registrar la factura", "error", `${errorMessage(error)} · Tu borrador sigue guardado.`);
    }
    if (purchaseId) await saveNotes(purchaseId as string);
    if (purchaseId) await saveMarkups();
    const { data: created } = purchaseId
      ? await supabaseBrowser().from("erp_purchases").select("id,number").eq("id", purchaseId as string).maybeSingle()
      : { data: null };
    let filesFailed = 0;
    if (staged.length) {
      filesFailed = created?.id ? await uploadStaged(ctx.storeId, created.id as string, staged) : staged.length;
      releaseStaged();
      setStaged([]);
    }
    setBusy(false);
    if (filesFailed) void toast("Factura registrada, pero algunos archivos no se subieron", "warning", "Revisa que hayas ejecutado erp_purchase_files.sql");
    clearDraft(draftKey(null));
    setRestored(false);
    // Se conservan proveedor, fecha, forma de pago, bodega y quién revisó para la siguiente factura.
    setForm((cur) => ({ ...cur, lines: [], invoiceRef: "", notes: "" }));
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
    if (editing?.id === row.id) {
      clearDraft(draftKey(editing));
      await switchMode(null);
    }
    void toast("Compra anulada");
    void load();
  }

  const hasWork = formHasWork(form) || staged.length > 0;
  const draftLabel = !hasWork && !editing
    ? null
    : savedAt
      ? `Borrador guardado ${timeAgo(savedAt)}`
      : "Guardando borrador…";

  return (
    <div className="space-y-5">
      {canBuy ? (
        <div ref={formTopRef} className="scroll-mt-4">
          <Panel
            title={editing ? `✏️ Editando ingreso N.º ${editing.number}` : "Ingreso de factura de proveedor"}
            subtitle={editing
              ? "Corrige lo que necesites: cantidades, costos, IVA, bodega, proveedor o pago. Al guardar solo se ajusta la diferencia."
              : "Elige a qué bodega entra cada producto. Al guardar suma al inventario, recalcula el costo promedio, pone los precios por % con el costo de esta factura y, si es a crédito, crea la cuenta por pagar."}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {!online ? (
                  <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)", color: "#f59e0b" }}>
                    📴 Sin internet · tu trabajo está a salvo aquí
                  </span>
                ) : null}
                {draftLabel ? (
                  <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }} title="Se guarda solo en este equipo mientras escribes">
                    💾 {draftLabel}
                  </span>
                ) : null}
                {editing ? <Btn variant="ghost" onClick={() => void cancelEdit()}>Salir de la edición</Btn> : null}
              </div>
            }
          >
            {restored && hasWork ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, transparent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>
                <span>📝 Recuperamos tu borrador{editing ? ` de la edición del #${editing.number}` : ""} ({form.lines.length} producto{form.lines.length === 1 ? "" : "s"}). Sigue donde ibas.</span>
                <span className="flex gap-2">
                  <Btn variant="ghost" onClick={() => setRestored(false)}>Entendido</Btn>
                  <Btn variant="danger" onClick={() => void discardDraft()}>Descartar borrador</Btn>
                </span>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input readOnly className={inputClass} style={{ ...inputStyle, fontWeight: 700, cursor: "default" }} value={editing ? `N.º ${editing.number} (editando)` : nextNumber ? `N.º ${nextNumber}` : "N.º …"} aria-label="Número interno del ingreso" title="Consecutivo interno asignado automáticamente al guardar" />
              <select className={inputClass} style={inputStyle} value={form.supplier} onChange={(e) => patchForm({ supplier: e.target.value })} aria-label="Proveedor">
                <option value="">Proveedor…</option>
                {suppliers.filter((s) => s.active || s.id === form.supplier).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <DateField value={form.invoiceDate} onChange={(v) => patchForm({ invoiceDate: v })} ariaLabel="Fecha de la factura" />
              <input className={inputClass} style={inputStyle} placeholder="N.º factura del proveedor *" value={form.invoiceRef} onChange={(e) => patchForm({ invoiceRef: e.target.value })} />
              <select className={inputClass} style={inputStyle} value={form.paymentType} onChange={(e) => patchForm({ paymentType: e.target.value as "cash" | "credit" })} aria-label="Forma de pago">
                <option value="cash">Pago de contado</option>
                <option value="credit">A crédito (cuenta por pagar)</option>
              </select>
              {form.paymentType === "credit" ? (
                <DateField value={form.dueDate} onChange={(v) => patchForm({ dueDate: v })} ariaLabel="Vencimiento" />
              ) : null}
              <input className={inputClass} style={inputStyle} placeholder="¿Quién revisó la mercancía? *" value={form.checkedBy} onChange={(e) => patchForm({ checkedBy: e.target.value })} />
              <input className={inputClass} style={inputStyle} placeholder="Notas (opcional)" value={form.notes} onChange={(e) => patchForm({ notes: e.target.value })} />
            </div>
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span style={{ color: "var(--t-muted)" }}>Bodega para los productos nuevos:</span>
                <select className={`${inputClass} w-auto`} style={inputStyle} value={defaultWh} onChange={(e) => patchForm({ warehouse: e.target.value })}>
                  {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <span className="text-xs" style={{ color: "var(--t-muted)" }}>(puedes cambiarla producto por producto)</span>
              </div>
              {pricing && form.lines.length ? (
                <MarkupToolbar lines={form.lines} pricing={pricing} onChange={(lines) => patchForm({ lines })} />
              ) : null}
              <LineEditor
                editorRef={editorRef}
                storeId={ctx.storeId}
                lines={form.lines}
                onChange={(next) => {
                  patchForm({ lines: next });
                  setStaged((cur) => cur.filter((f) => !f.product_id || next.some((l) => l.product_id === f.product_id)));
                }}
                mode="purchase"
                warehouseId={defaultWh}
                warehouses={warehouses}
                pricing={pricing}
                onCreateProduct={canCreateProducts ? (name) => setQuickName(name) : undefined}
              />
              {quickName !== null ? (
                <QuickProductModal
                  storeId={ctx.storeId}
                  initialName={quickName}
                  withMarkup={Boolean(pricing)}
                  onClose={() => setQuickName(null)}
                  onCreated={(hit, extra) => setForm((cur) => ({
                    ...cur,
                    lines: [...cur.lines, { ...lineFromHit(hit, "purchase", defaultWh), ...extra }],
                  }))}
                />
              ) : null}
            </div>
            <div className="mt-3"><AttachmentPicker staged={staged} onChange={setStaged} /></div>

            {/* Barra fija: siempre a la mano, sin tener que subir. */}
            <div
              className="sticky bottom-2 z-30 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:px-4"
              style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 86%, transparent)" }}
            >
              <p className="min-w-0 text-sm" style={{ color: "var(--t-muted)" }}>
                <span className="hidden sm:inline">Subtotal {money(totals.sub)} · IVA {money(totals.tax)} · </span>
                <b className="text-base" style={{ color: "var(--t-text)" }}>Total {money(totals.total)}</b>
                <span className="ml-2 text-xs">{form.lines.length} prod. · {form.lines.reduce((s, l) => s + l.qty, 0)} und.</span>
              </p>
              <div className="flex flex-1 flex-wrap justify-end gap-2 sm:flex-none">
                {canCreateProducts ? (
                  <Btn variant="ghost" onClick={() => setQuickName("")}>
                    <span title="Crea el producto sin salir de la factura">✨ Crear producto</span>
                  </Btn>
                ) : null}
                <Btn variant="ghost" onClick={() => editorRef.current?.openPicker()}>
                  <span title="Atajo: F2">➕ Agregar producto</span>
                </Btn>
                <Btn onClick={() => void save()} disabled={busy}>
                  <span title="Atajo: Ctrl + Enter">{busy ? "Guardando…" : editing ? "💾 Guardar cambios" : "📥 Registrar ingreso"}</span>
                </Btn>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      <PurchaseHistory
        search={search}
        suppliers={suppliers}
        editingId={editing?.id ?? null}
        loadingEdit={loadingEdit}
        canBuy={canBuy}
        canVoid={canVoid}
        onEdit={(r) => void startEdit(r)}
        onCancel={(r) => void cancel(r)}
      />
    </div>
  );
}
