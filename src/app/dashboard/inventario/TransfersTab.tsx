"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TRANSFER_STEPS, transferTrackUrl, transferWhatsAppText, type TransferStep } from "@/lib/transfer-tracking";
import { ProductPicker, ProductSearchModal, Thumb, useThumbs } from "./LineEditor";
import { InternalCreditPreview } from "./InternalCredit";
import { clearDraft, readDraft, timeAgo, writeDraft } from "./draft";
import { TransferEditor } from "./TransferEditor";
import { reinsert, undoToast } from "@/lib/ui/undo";
import { ScanCounter } from "@/components/ScanCounter";
import { checkStockNow, friendlyStockError, shortListHtml, useLiveStock } from "@/lib/stock/live-stock";
import { DateField, ddmmyyyy } from "@/components/forms/Fields";
import {
  Btn, Empty, Panel, StatusPill, askReason, confirmAction, dateTime, errorMessage, inputClass, inputStyle,
  tableWrap, td, th, toast, useRunOnChange, type ErpCtx, type ProductHit, type Warehouse,
} from "./shared";

type PlanLine = { product_id: string; name: string; sku: string | null; available: number };
type Matrix = Record<string, Record<string, number>>;

type ItemProduct = { name: string; sku?: string | null; image_url?: string | null };
type TransferItem = { product_id: string; qty: number; received_qty: number | null; products: ItemProduct | ItemProduct[] | null };
type TransferRow = {
  id: string; number: number; status: string; notes: string | null; created_at: string; received_at: string | null;
  from_warehouse_id: string; to_warehouse_id: string; created_by_name: string | null; carrier_name: string | null;
  checked_by_name: string | null; received_by_name: string | null; received_notes: string | null;
  erp_transfer_items: TransferItem[];
  // Solo existen con 20261007_transfer_tracking_links.sql aplicado.
  track_token?: string; track_expires_at?: string;
  erp_transfer_signatures?: Array<{ step: TransferStep; signer_name: string; signed_at: string }>;
};

const BASE_COLUMNS =
  "id,number,status,notes,created_at,received_at,from_warehouse_id,to_warehouse_id,created_by_name,carrier_name,checked_by_name,received_by_name,received_notes,erp_transfer_items(product_id,qty,received_qty,products(name,sku,image_url))";
const TRACK_COLUMNS = `${BASE_COLUMNS},track_token,track_expires_at,erp_transfer_signatures(step,signer_name,signed_at)`;

function TrackProgress({ row }: { row: TransferRow }) {
  const signed = new Map((row.erp_transfer_signatures ?? []).map((s) => [s.step, s]));
  const nextKey = row.status === "in_transit" ? TRANSFER_STEPS.find((s) => !signed.has(s.key))?.key : undefined;
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {TRANSFER_STEPS.map((step) => {
        const sig = signed.get(step.key);
        const isNext = step.key === nextKey;
        return (
          <div
            key={step.key}
            className="rounded-xl border px-2.5 py-1.5 text-xs"
            style={{
              borderColor: sig ? "color-mix(in oklab, #22c55e 50%, transparent)" : isNext ? "var(--t-accent)" : "var(--t-card-border)",
              opacity: sig || isNext ? 1 : 0.55,
            }}
          >
            <p className="font-semibold">{sig ? "✓" : step.icon} {step.title}</p>
            <p className="truncate" style={{ color: "var(--t-muted)" }} title={sig ? `${sig.signer_name} · ${dateTime(sig.signed_at)}` : undefined}>
              {sig ? `${sig.signer_name} · ${dateTime(sig.signed_at)}` : isNext ? "Pendiente de firma" : "—"}
            </p>
          </div>
        );
      })}
    </div>
  );
}

const itemName = (item: TransferItem) => (Array.isArray(item.products) ? item.products[0]?.name : item.products?.name) ?? "Producto";

function WarehouseChip({ w, selected, onClick }: { w: Warehouse; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5"
      style={
        selected
          ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))", color: "var(--t-cta-text, #fff)", borderColor: "transparent" }
          : { background: "var(--t-card-bg)", color: "var(--t-text)", borderColor: "var(--t-card-border)" }
      }
    >
      {w.kind === "point" ? "📍" : "🏬"} {w.name}
    </button>
  );
}

/** Traslado a medio armar: se guarda en este equipo hasta que se envíe o se descarte. */
type TransferDraft = { v: 1; savedAt: string; from: string; targets: string[]; lines: PlanLine[]; matrix: Matrix; notes: string; carrier: string; checkedBy: string };

/** Productos de un traslado: resumen corto y, al tocarlo, la lista con fotos. */
function TransferItemsList({ items }: { items: TransferItem[] }) {
  const [open, setOpen] = useState(false);
  const units = items.reduce((a, i) => a + Number(i.qty || 0), 0);
  const missing = items.filter((i) => i.received_qty !== null && i.received_qty !== i.qty).length;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:brightness-110"
        style={{ borderColor: "var(--t-card-border)" }}
        aria-expanded={open}
      >
        📦 {items.length} producto{items.length === 1 ? "" : "s"} · {units.toLocaleString("es-CO")} unidades
        {missing ? <span style={{ color: "#f59e0b" }}>· {missing} con diferencia</span> : null}
        <span aria-hidden>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => {
            const p = Array.isArray(i.products) ? i.products[0] : i.products;
            const diff = i.received_qty !== null && i.received_qty !== i.qty;
            return (
              <li key={i.product_id} className="flex items-center gap-2.5 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
                {p?.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg border object-cover" style={{ borderColor: "var(--t-card-border)" }} />
                ) : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border text-lg" style={{ borderColor: "var(--t-card-border)" }}>📦</span>}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-xs font-semibold">{p?.name ?? "Producto"}</span>
                  {p?.sku ? <span className="block text-[10px]" style={{ color: "var(--t-muted)" }}>{p.sku}</span> : null}
                </span>
                <span className="shrink-0 text-right">
                  <b className="block text-sm tabular-nums">× {i.qty}</b>
                  {diff ? <span className="block text-[10px] font-bold" style={{ color: "#f59e0b" }}>llegaron {i.received_qty}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function TransfersTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const active = warehouses.filter((w) => w.active);
  const names = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const canTransfer = ctx.can("transfers");

  const [pickedFrom, setFrom] = useState("");
  const from = ctx.pointId ?? pickedFrom;
  const [targets, setTargets] = useState<string[]>([]);
  const [lines, setLines] = useState<PlanLine[]>([]);
  // Existencias del origen en vivo: si otro usuario vende o traslada, «Disponible» baja aquí (también en un borrador viejo).
  const { stock: liveStock, setStock: setLiveStock, live: stockLive } = useLiveStock(ctx.storeId, from || null);
  const availOf = (l: PlanLine) => (liveStock ? liveStock.get(l.product_id) ?? 0 : l.available);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [notes, setNotes] = useState("");
  const [carrier, setCarrier] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  const [busy, setBusy] = useState(false);
  // Teclado como en el ingreso de facturas: al elegir un producto va a su cantidad, Enter sigue y F2 agrega otro.
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const [focusNext, setFocusNext] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const lineThumbs = useThumbs(lines.map((l) => l.product_id));
  // Borrador: se recupera al entrar y se guarda con cada cambio (se borra al enviar o al descartarlo).
  const draftKey = `remhub:transfer-draft:v1:${ctx.storeId}`;
  const [draftReady, setDraftReady] = useState(false);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const d = readDraft<TransferDraft>(draftKey);
    if (d?.v === 1 && (d.lines?.length || d.notes || d.carrier || d.checkedBy)) {
      // Un usuario de punto solo puede salir de su punto.
      if (!ctx.pointId || d.from === ctx.pointId) {
        setFrom(d.from ?? "");
        setTargets(d.targets ?? []);
        setLines(d.lines ?? []);
        setMatrix(d.matrix ?? {});
        setNotes(d.notes ?? "");
        setCarrier(d.carrier ?? "");
        setCheckedBy(d.checkedBy ?? "");
        setDraftAt(d.savedAt);
        void toast("Recuperamos tu traslado sin enviar", "success", `Borrador guardado ${timeAgo(d.savedAt)}.`);
      }
    }
    setDraftReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady) return;
    const hasWork = lines.length > 0 || notes.trim() || carrier.trim() || checkedBy.trim();
    if (!hasWork) {
      clearDraft(draftKey);
      setDraftAt(null);
      return;
    }
    const savedAt = new Date().toISOString();
    if (writeDraft(draftKey, { v: 1, savedAt, from, targets, lines, matrix, notes, carrier, checkedBy } satisfies TransferDraft)) setDraftAt(savedAt);
  }, [draftReady, draftKey, from, targets, lines, matrix, notes, carrier, checkedBy]);
  // Refresca el «guardado hace…».
  useEffect(() => {
    if (!draftAt) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [draftAt]);
  async function discardDraft() {
    if (!(await confirmAction("Descartar traslado", "Se borran los productos, cantidades y responsables que llevabas.", "Descartar"))) return;
    resetPlan();
    setCarrier("");
    setCheckedBy("");
    setTargets([]);
    clearDraft(draftKey);
    setDraftAt(null);
  }

  const [filter, setFilter] = useState<"all" | "in_transit" | "received" | "cancelled" | "diff">("all");
  const [rows, setRows] = useState<TransferRow[]>([]);
  // Filtros de la lista: texto (número, producto, código o persona), fechas, origen y destino; se cargan de a 30.
  // ?q=#12 abre la lista ya filtrada (desde el buscador Ctrl+K).
  const urlQ = () => { if (typeof window === "undefined") return ""; const p = new URLSearchParams(window.location.search); return p.get("tab") === "transfers" ? p.get("q") ?? "" : ""; };
  const [tf, setTf] = useState(() => ({ q: urlQ(), from: "", to: "", origin: "", dest: "" }));
  const [qLive, setQLive] = useState(urlQ);
  const [limit, setLimit] = useState(30);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => { setTf((cur) => (cur.q === qLive ? cur : { ...cur, q: qLive })); setLimit(30); }, qLive ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [qLive]);
  const setTfField = (k: keyof typeof tf, v: string) => { setTf((cur) => ({ ...cur, [k]: v })); setLimit(30); };
  const filtersOn = Boolean(tf.q || tf.from || tf.to || tf.origin || tf.dest || filter !== "all");
  const [receiving, setReceiving] = useState<{ id: string; qty: Record<string, number>; notes: string } | null>(null);
  const [scanReceive, setScanReceive] = useState(false);
  // Corrección de productos (solo en tránsito y antes de «Revisado»; 20261217).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editable = (row: TransferRow) => row.status === "in_transit" && !(row.erp_transfer_signatures ?? []).some((s) => s.step === "sent" || s.step === "delivered" || s.step === "received");

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    setLoadingList(true);
    // Texto: número (#12), persona (envió, revisó, trasladó, recibió) o producto (nombre, código, código de barras).
    const term = tf.q.replace(/[,()*%\\"]/g, " ").trim();
    let or: string | null = null;
    if (term) {
      const parts = [`created_by_name.ilike.*${term}*`, `carrier_name.ilike.*${term}*`, `checked_by_name.ilike.*${term}*`, `received_by_name.ilike.*${term}*`, `notes.ilike.*${term}*`];
      const num = term.replace(/^#/, "");
      if (/^\d{1,9}$/.test(num)) parts.push(`number.eq.${num}`);
      if (term.length >= 2) {
        const { data: prods } = await sb.from("products").select("id").eq("store_id", ctx.storeId)
          .or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.ilike.*${term}*`).limit(200);
        const ids = ((prods ?? []) as Array<{ id: string }>).map((p) => p.id);
        if (ids.length) {
          const { data: its } = await sb.from("erp_transfer_items").select("transfer_id").in("product_id", ids).limit(1000);
          const tids = [...new Set(((its ?? []) as Array<{ transfer_id: string }>).map((i) => i.transfer_id))].slice(0, 300);
          if (tids.length) parts.push(`id.in.(${tids.join(",")})`);
        }
      }
      or = parts.join(",");
    }
    const nextDay = (iso: string) => { const d = new Date(`${iso}T00:00:00-05:00`); d.setDate(d.getDate() + 1); return d.toISOString(); };
    const run = (columns: string) => {
      let query = sb
        .from("erp_transfers")
        .select(columns, { count: "exact" })
        .eq("store_id", ctx.storeId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (filter === "in_transit" || filter === "received" || filter === "cancelled") query = query.eq("status", filter);
      if (filter === "diff") query = query.eq("status", "received");
      if (tf.from) query = query.gte("created_at", new Date(`${tf.from}T00:00:00-05:00`).toISOString());
      if (tf.to) query = query.lt("created_at", nextDay(tf.to));
      if (tf.origin) query = query.eq("from_warehouse_id", tf.origin);
      if (tf.dest) query = query.eq("to_warehouse_id", tf.dest);
      if (or) query = query.or(or);
      return query;
    };
    let { data, error, count } = await run(TRACK_COLUMNS);
    // Sin la migración de seguimiento se muestran los traslados sin enlace ni firmas.
    if (error) ({ data, error, count } = await run(BASE_COLUMNS));
    setLoadingList(false);
    if (error) return void toast("No se pudieron cargar los traslados", "error", errorMessage(error));
    let list = (data ?? []) as unknown as TransferRow[];
    // «Llegó con diferencias»: recibidos donde algún producto no llegó completo.
    if (filter === "diff") list = list.filter((r) => r.erp_transfer_items.some((i) => i.received_qty !== null && i.received_qty !== i.qty));
    setRows(list);
    setTotal(filter === "diff" ? null : count ?? list.length);
  }, [ctx.storeId, filter, tf, limit]);

  const listSummary = useMemo(() => {
    const units = rows.reduce((a, r) => a + r.erp_transfer_items.reduce((b, i) => b + Number(i.qty || 0), 0), 0);
    const missing = rows.reduce((a, r) => a + r.erp_transfer_items.reduce((b, i) => b + (i.received_qty !== null ? Math.max(0, i.qty - i.received_qty) : 0), 0), 0);
    return { units, missing, inTransit: rows.filter((r) => r.status === "in_transit").length };
  }, [rows]);

  function exportList() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["N.º", "Fecha", "Sale de", "Llega a", "Estado", "Productos", "Unidades", "No llegaron", "Envió", "Revisó", "Trasladó", "Recibió", "Fecha recibido"];
    const lines = rows.map((r) => [r.number, ddmmyyyy(r.created_at.slice(0, 10)), names.get(r.from_warehouse_id), names.get(r.to_warehouse_id),
      r.status === "received" ? "Recibido" : r.status === "cancelled" ? "Anulado" : "En tránsito", r.erp_transfer_items.length,
      r.erp_transfer_items.reduce((a, i) => a + i.qty, 0), r.erp_transfer_items.reduce((a, i) => a + (i.received_qty !== null ? Math.max(0, i.qty - i.received_qty) : 0), 0),
      r.created_by_name, r.checked_by_name, r.carrier_name, r.received_by_name, r.received_at ? ddmmyyyy(r.received_at.slice(0, 10)) : ""].map(esc).join(";"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`\uFEFF${[head.map(esc).join(";"), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    a.download = `traslados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const quickRange = (k: "today" | "7" | "month" | "last") => {
    const t = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const r = k === "today" ? { from: iso(t), to: iso(t) }
      : k === "7" ? { from: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6)), to: iso(t) }
      : k === "month" ? { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) }
      : { from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)) };
    setTf((cur) => ({ ...cur, ...r }));
    setLimit(30);
  };

  async function copyLink(row: TransferRow) {
    if (!row.track_token) return;
    try {
      await navigator.clipboard.writeText(transferTrackUrl(row.track_token));
      void toast("Enlace copiado");
    } catch {
      window.prompt("Copia el enlace:", transferTrackUrl(row.track_token));
    }
  }

  function shareWhatsApp(row: TransferRow) {
    if (!row.track_token) return;
    const text = transferWhatsAppText(row.number, names.get(row.from_warehouse_id) ?? "Origen", names.get(row.to_warehouse_id) ?? "Destino", row.track_token);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  async function renewLink(row: TransferRow) {
    if (!(await confirmAction(`Renovar enlace #${row.number}`, "El enlace anterior dejará de funcionar y el nuevo durará 15 días.", "Renovar"))) return;
    const { error } = await supabaseBrowser().rpc("erp_transfer_track_renew", { p_transfer: row.id });
    if (error) return void toast("No se pudo renovar el enlace", "error", errorMessage(error));
    void toast("Enlace renovado");
    void load();
  }

  useRunOnChange(load);

  const used = (productId: string) => Object.values(matrix[productId] ?? {}).reduce((a, b) => a + b, 0);
  const overdrawn = lines.some((l) => used(l.product_id) > availOf(l));

  function addProduct(hit: ProductHit) {
    // Si ya está, no se duplica: se ilumina y el cursor va a su cantidad para cambiarla.
    if (lines.some((l) => l.product_id === hit.id)) void toast(`«${hit.name}» ya está en el traslado`, "success", "Te llevamos a su cantidad para que la cambies.");
    setLines((prev) => (prev.some((l) => l.product_id === hit.id) ? [...prev] : [...prev, { product_id: hit.id, name: hit.name, sku: hit.sku, available: hit.wh_qty }]));
    setFocusNext(hit.id);
    setFlashId(hit.id);
    window.setTimeout(() => setFlashId((cur) => (cur === hit.id ? null : cur)), 1400);
  }

  // Cuando el producto aparece en la tabla, el cursor va a su primera cantidad (seleccionada para escribir encima).
  useEffect(() => {
    if (!focusNext || !targets.length) return;
    const el = qtyRefs.current.get(`${focusNext}:${targets[0]}`);
    if (!el) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setFocusNext(null);
  }, [focusNext, lines, targets]);

  // Enter: siguiente destino del mismo producto; después del último, vuelve a buscar otro producto. ↑ / ↓ cambian de producto.
  function onQtyKey(productId: string, target: string) {
    return (e: React.KeyboardEvent<HTMLInputElement>) => {
      const li = lines.findIndex((l) => l.product_id === productId);
      const ti = targets.indexOf(target);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const other = lines[li + (e.key === "ArrowDown" ? 1 : -1)];
        if (other) { e.preventDefault(); const el = qtyRefs.current.get(`${other.product_id}:${target}`); el?.focus(); el?.select(); }
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const nextTarget = targets[ti + 1];
      if (nextTarget) { const el = qtyRefs.current.get(`${productId}:${nextTarget}`); el?.focus(); el?.select(); return; }
      searchRef.current?.focus();
    };
  }

  // F2: abre la ventana para agregar otro producto (como en el ingreso de facturas).
  useEffect(() => {
    if (!from || !targets.length) return;
    const onKey = (e: KeyboardEvent) => {
      // Si se está corrigiendo un traslado, F2 es de esa corrección.
      if (e.key === "F2" && !editingId) { e.preventDefault(); setPickerOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [from, targets.length, editingId]);

  function setQty(productId: string, dest: string, qty: number) {
    setMatrix((prev) => ({ ...prev, [productId]: { ...(prev[productId] ?? {}), [dest]: Math.max(0, Math.floor(qty || 0)) } }));
  }

  // Sugerencia según ventas (20261222): llena cantidades para cubrir N días en cada destino, sin pasar de lo que hay en el origen.
  async function suggest() {
    if (!from || !targets.length) return void toast("Elige el origen y al menos un destino", "warning");
    const ask = await Swal.fire({
      title: "💡 Sugerir según ventas",
      html: "<p style='font-size:13px;margin:0 0 8px'>Mira lo que vendió cada destino en los últimos 30 días y propone enviar lo necesario para que le alcance:</p>",
      input: "select", inputOptions: { 7: "7 días", 15: "15 días", 30: "30 días" }, inputValue: "15",
      showCancelButton: true, confirmButtonText: "Sugerir", cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
    });
    if (!ask.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_restock_suggestions", { p_store: ctx.storeId, p_from: from, p_targets: targets, p_days: Number(ask.value) || 15 });
    const r = data as { ok: boolean; error?: string; items?: Array<{ point_id: string; product_id: string; name: string; sku: string | null; qty: number; origin_qty: number; days_left: number | null; per_day: number }> } | null;
    if (error || !r?.ok) {
      const msg = error && /erp_restock_suggestions|Could not find/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261222_sugerencia_traslados.sql." : r?.error ?? errorMessage(error);
      return void toast("No se pudo sugerir", "error", msg);
    }
    const items = r.items ?? [];
    if (!items.length) return void toast("Nada que sugerir", "warning", "Los destinos tienen suficiente para esos días, o el origen no tiene lo que venden.");
    setLines((prev) => {
      const next = [...prev];
      for (const it of items) if (!next.some((l) => l.product_id === it.product_id)) next.push({ product_id: it.product_id, name: it.name, sku: it.sku, available: Number(it.origin_qty) });
      return next;
    });
    setMatrix((prev) => {
      const next = { ...prev };
      for (const it of items) next[it.product_id] = { ...(next[it.product_id] ?? {}), [it.point_id]: Number(it.qty) };
      return next;
    });
    const units = items.reduce((a, it) => a + Number(it.qty), 0);
    void toast(`Sugerencia lista: ${new Set(items.map((i) => i.product_id)).size} productos · ${units} unidades`, "success", "Revisa y cambia lo que quieras antes de enviar.");
  }

  function removeLine(productId: string) {
    const index = lines.findIndex((l) => l.product_id === productId);
    const gone = lines[index];
    const qty = matrix[productId];
    if (!gone) return;
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
    undoToast(`Quitaste «${gone.name}»`, () => {
      setLines((prev) => (prev.some((l) => l.product_id === productId) ? prev : reinsert(prev, gone, index)));
      if (qty) setMatrix((prev) => ({ ...prev, [productId]: qty }));
    });
  }

  function toggleTarget(id: string) {
    setTargets((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  function resetPlan() {
    setLines([]);
    setMatrix({});
    setNotes("");
  }

  async function send() {
    if (!from) return void toast("Elige la bodega o punto de origen", "warning");
    if (!targets.length) return void toast("Elige al menos un destino", "warning");
    if (overdrawn) return void toast("Hay productos con más unidades que las disponibles", "warning");
    if (!carrier.trim()) return void toast("Indica quién traslada la mercancía", "warning");
    if (!checkedBy.trim()) return void toast("Indica quién revisó la mercancía", "warning");

    const plan = targets
      .map((dest) => ({
        to: dest,
        items: lines
          .map((l) => ({ product_id: l.product_id, qty: matrix[l.product_id]?.[dest] ?? 0 }))
          .filter((i) => i.qty > 0),
      }))
      .filter((leg) => leg.items.length > 0);
    if (!plan.length) return void toast("Asigna cantidades a al menos un destino", "warning");

    // Justo antes de enviar se revisa contra la base: otro usuario pudo sacar esas unidades hace un momento.
    const short = await checkStockNow(ctx.storeId, from, lines.map((l) => ({ product_id: l.product_id, qty: used(l.product_id), name: l.name })));
    if (short.length) {
      setLiveStock((cur) => {
        const next = new Map(cur ?? []);
        for (const x of short) { if (x.available > 0) next.set(x.product_id, x.available); else next.delete(x.product_id); }
        return next;
      });
      await Swal.fire({ icon: "warning", title: "Las existencias cambiaron", html: `${shortListHtml(short)}<br><small>Otra persona acaba de vender o trasladar. Ajusta las cantidades marcadas y vuelve a enviar.</small>`,
        background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" });
      return;
    }

    const units = plan.reduce((sum, leg) => sum + leg.items.reduce((s, i) => s + i.qty, 0), 0);
    if (!(await confirmAction("Enviar mercancía", `Se crearán ${plan.length} traslado(s) con ${units} unidades. Quedarán en tránsito hasta que cada destino las reciba.`, "Enviar"))) return;

    setBusy(true);
    const sb = supabaseBrowser();
    const { data: ids, error } = await sb.rpc("erp_dispatch_transfers", {
      p_store: ctx.storeId, p_from: from, p_notes: notes, p_carrier: carrier, p_checked_by: checkedBy, p_plan: plan,
    });
    if (error) {
      setBusy(false);
      return void toast("No se pudo enviar", "error", friendlyStockError(errorMessage(error)) ?? errorMessage(error));
    }
    resetPlan();
    clearDraft(draftKey);
    setDraftAt(null);
    void load();
    const { data: created } = await sb
      .from("erp_transfers")
      .select("id,number,from_warehouse_id,to_warehouse_id,track_token")
      .in("id", (ids ?? []) as string[])
      .order("number");
    setBusy(false);
    const links = ((created ?? []) as Array<Pick<TransferRow, "id" | "number" | "from_warehouse_id" | "to_warehouse_id" | "track_token">>).filter((t) => t.track_token);
    if (!links.length) return void toast(`${plan.length} traslado(s) enviados`);
    await showLinks(links);
  }

  /** Muestra el enlace único de cada traslado recién creado para enviarlo por WhatsApp. */
  async function showLinks(links: Array<Pick<TransferRow, "id" | "number" | "from_warehouse_id" | "to_warehouse_id" | "track_token">>) {
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const html = links
      .map((t) => {
        const fromName = names.get(t.from_warehouse_id) ?? "Origen";
        const toName = names.get(t.to_warehouse_id) ?? "Destino";
        const url = transferTrackUrl(t.track_token!);
        const wa = `https://wa.me/?text=${encodeURIComponent(transferWhatsAppText(t.number, fromName, toName, t.track_token!))}`;
        return `<div style="text-align:left;border:1px solid rgba(127,127,127,.35);border-radius:14px;padding:10px 12px;margin-top:8px">
          <b>#${t.number} · ${esc(fromName)} → ${esc(toName)}</b>
          <div style="font-size:12px;word-break:break-all;opacity:.8;margin:4px 0">${esc(url)}</div>
          <a href="${wa}" target="_blank" rel="noopener" style="display:inline-block;background:#22c55e;color:#fff;border-radius:999px;padding:6px 12px;font-weight:700;font-size:13px;text-decoration:none">💬 Enviar por WhatsApp</a>
          <button type="button" data-copy="${esc(url)}" style="margin-left:6px;border:1px solid rgba(127,127,127,.5);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600">🔗 Copiar</button>
        </div>`;
      })
      .join("");
    await Swal.fire({
      icon: "success",
      title: links.length > 1 ? `${links.length} traslados creados` : `Traslado #${links[0].number} creado`,
      html: `<p style="font-size:14px">Envía el enlace a quien empaca, despacha, entrega y recibe. Cada uno firma su paso sin iniciar sesión, y tú ves todo el recorrido aquí.</p>${html}`,
      confirmButtonText: "Listo",
      didOpen: (popup) => {
        popup.querySelectorAll<HTMLButtonElement>("button[data-copy]").forEach((btn) => {
          btn.addEventListener("click", () => {
            void navigator.clipboard.writeText(btn.dataset.copy ?? "").then(() => { btn.textContent = "✓ Copiado"; });
          });
        });
      },
    });
  }

  function startReceive(row: TransferRow) {
    setReceiving({
      id: row.id,
      notes: "",
      qty: Object.fromEntries(row.erp_transfer_items.map((i) => [i.product_id, i.qty])),
    });
  }

  async function confirmReceive(row: TransferRow) {
    if (!receiving) return;
    const missing = row.erp_transfer_items.some((i) => (receiving.qty[i.product_id] ?? i.qty) < i.qty);
    if (missing && !receiving.notes.trim()) return void toast("Explica el faltante en las notas", "warning");
    if (!(await confirmAction(`Confirmar recepción #${row.number}`, `Quedará registrado que tú recibiste en ${names.get(row.to_warehouse_id) ?? "el destino"}.`, "Confirmar"))) return;
    const { error } = await supabaseBrowser().rpc("erp_confirm_transfer", {
      p_transfer: row.id,
      p_items: row.erp_transfer_items.map((i) => ({ product_id: i.product_id, received_qty: receiving.qty[i.product_id] ?? i.qty })),
      p_notes: receiving.notes,
    });
    if (error) return void toast("No se pudo confirmar", "error", errorMessage(error));
    setReceiving(null);
    void toast("Recepción confirmada");
    void load();
  }

  async function cancel(row: TransferRow) {
    const reason = await askReason(`Anular traslado #${row.number}`);
    if (!reason) return;
    const { error } = await supabaseBrowser().rpc("erp_cancel_transfer", { p_transfer: row.id, p_reason: reason });
    if (error) return void toast("No se pudo anular", "error", errorMessage(error));
    void toast("Traslado anulado, la mercancía volvió al origen");
    void load();
  }

  const destinations = active.filter((w) => w.id !== from);

  return (
    <div className="space-y-5">
      {canTransfer ? (
        <Panel
          title="Nueva distribución de mercancía"
          subtitle="Elige el origen, los productos y cuántas unidades van a cada punto o bodega. Cada destino recibe y confirma por separado."
        >
          <div className="space-y-4">
            {draftAt ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, #10b981 40%, transparent)", background: "color-mix(in oklab, #10b981 8%, transparent)" }}>
                <span>💾 Borrador guardado {timeAgo(draftAt)} en este equipo. Si sales, aquí sigue hasta que lo envíes.</span>
                <button type="button" className="ml-auto font-bold" style={{ color: "#ef4444" }} onClick={() => void discardDraft()}>Descartar</button>
              </div>
            ) : null}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>1 · Sale de</p>
              <div className="flex flex-wrap gap-2">
                {active.filter((w) => !ctx.pointId || w.id === ctx.pointId).map((w) => (
                  <WarehouseChip
                    key={w.id}
                    w={w}
                    selected={from === w.id}
                    onClick={() => {
                      setFrom(w.id);
                      setTargets((prev) => prev.filter((t) => t !== w.id));
                      resetPlan();
                    }}
                  />
                ))}
              </div>
            </div>

            {from ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>2 · Va hacia (puedes elegir varios)</p>
                <div className="flex flex-wrap gap-2">
                  {destinations.length === 0 ? <span className="text-sm" style={{ color: "var(--t-muted)" }}>Crea otra bodega o punto para poder trasladar.</span> : null}
                  {destinations.map((w) => (
                    <WarehouseChip key={w.id} w={w} selected={targets.includes(w.id)} onClick={() => toggleTarget(w.id)} />
                  ))}
                </div>
              </div>
            ) : null}

            {from && targets.length ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>3 · Productos y cantidades</p>
                  <Btn variant="ghost" onClick={() => void suggest()}><span title="Propone cantidades según lo que vendió cada destino en 30 días">💡 Sugerir según ventas</span></Btn>
                </div>
                <ProductPicker
                  storeId={ctx.storeId}
                  warehouseId={from}
                  inStockOnly
                  inputRef={searchRef}
                  addedQty={Object.fromEntries(lines.map((l) => [l.product_id, used(l.product_id)]))}
                  placeholder={`🔎 Buscar en ${names.get(from) ?? "origen"} (solo con existencias)…  ·  F2 para abrir la búsqueda`}
                  onPick={addProduct}
                />
                <ProductSearchModal
                  open={pickerOpen}
                  onClose={() => setPickerOpen(false)}
                  storeId={ctx.storeId}
                  warehouseId={from}
                  inStockOnly
                  addedQty={Object.fromEntries(lines.map((l) => [l.product_id, used(l.product_id)]))}
                  title={`Agregar producto al traslado (sale de ${names.get(from) ?? "origen"})`}
                  onPick={(hit) => { setPickerOpen(false); addProduct(hit); }}
                />
                {lines.length > 0 ? (
                  <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
                    <table className="w-full min-w-[560px]">
                      <thead style={{ color: "var(--t-muted)" }}>
                        <tr>
                          <th className={th}>Producto</th>
                          <th className={th}>Disponible{stockLive ? <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 align-middle" title="En vivo: baja sola si otra persona vende o traslada" /> : null}</th>
                          {targets.map((t) => <th key={t} className={th}>→ {names.get(t)}</th>)}
                          <th className={th}>Queda</th>
                          <th className={th} />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => {
                          const left = availOf(line) - used(line.product_id);
                          return (
                            <tr key={line.product_id} className="border-t transition-colors duration-500" style={{ borderColor: "var(--t-card-border)", background: flashId === line.product_id ? "color-mix(in oklab, #22c55e 12%, transparent)" : undefined }}>
                              <td className={td}>
                                <div className="flex items-center gap-3">
                                  <Thumb src={lineThumbs[line.product_id]} size={44} />
                                  <div className="min-w-0">
                                    <div className="font-semibold">{line.name}</div>
                                    {line.sku ? <div className="text-xs" style={{ color: "var(--t-muted)" }}>{line.sku}</div> : null}
                                  </div>
                                </div>
                              </td>
                              <td className={td}>
                                <span className="font-semibold tabular-nums">{availOf(line)}</span>
                                {liveStock && availOf(line) < line.available ? <span className="block text-[10px] font-semibold text-amber-500" title="Otra persona usó unidades mientras armabas el traslado">antes {line.available}</span> : null}
                              </td>
                              {targets.map((t) => (
                                <td key={t} className={td}>
                                  <input
                                    type="number"
                                    min={0}
                                    ref={(el) => { const k = `${line.product_id}:${t}`; if (el) qtyRefs.current.set(k, el); else qtyRefs.current.delete(k); }}
                                    onKeyDown={onQtyKey(line.product_id, t)}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className={`${inputClass} w-24`}
                                    style={inputStyle}
                                    value={matrix[line.product_id]?.[t] ?? 0}
                                    onChange={(e) => setQty(line.product_id, t, Number(e.target.value))}
                                  />
                                </td>
                              ))}
                              <td className={td} style={{ fontWeight: 700, color: left < 0 ? "#ef4444" : undefined }}>{left}</td>
                              <td className={td}>
                                <Btn variant="ghost" onClick={() => removeLine(line.product_id)}>Quitar</Btn>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>4 · Responsables</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className={`${inputClass} font-semibold uppercase`} style={inputStyle} placeholder="¿QUIÉN REVISÓ LA MERCANCÍA? *" value={checkedBy} onChange={(e) => { const el = e.target; const at = el.selectionStart; setCheckedBy(el.value.toUpperCase()); requestAnimationFrame(() => { try { el.setSelectionRange(at, at); } catch {} }); }} />
                  <input className={`${inputClass} font-semibold uppercase`} style={inputStyle} placeholder="¿QUIÉN LA TRASLADA? *" value={carrier} onChange={(e) => { const el = e.target; const at = el.selectionStart; setCarrier(el.value.toUpperCase()); requestAnimationFrame(() => { try { el.setSelectionRange(at, at); } catch {} }); }} />
                  <input className={inputClass} style={inputStyle} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>El usuario que envía queda registrado automáticamente.</p>
                <InternalCreditPreview
                  compact
                  storeId={ctx.storeId}
                  from={from}
                  legs={targets.map((dest) => ({ to: dest, items: lines.map((l) => ({ product_id: l.product_id, qty: matrix[l.product_id]?.[dest] ?? 0 })).filter((i) => i.qty > 0) }))}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Btn variant="ghost" onClick={() => setPickerOpen(true)}><span title="Atajo: F2">➕ Agregar producto (F2)</span></Btn>
                  <Btn onClick={() => void send()} disabled={busy || overdrawn}>{busy ? "Enviando…" : "🚚 Enviar mercancía"}</Btn>
                </div>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Elige un producto y escribe la cantidad · <b>Enter</b> pasa al siguiente destino y luego al buscador · <b>↑ ↓</b> cambian de producto · <b>F2</b> agrega otro.</p>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Traslados"
        actions={
          <div className="flex gap-1.5">
            {([["all", "Todos"], ["in_transit", "En tránsito"], ["received", "Recibidos"], ["diff", "Con diferencias"], ["cancelled", "Anulados"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setFilter(key); setLimit(30); }}
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                style={filter === key ? { background: "var(--t-accent)", color: "var(--t-cta-text, #fff)", borderColor: "transparent" } : { borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {/* Buscador y filtros */}
        <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative">
            <input className={inputClass} style={inputStyle} value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder="🔍 #12, producto, código o persona (envió, revisó, trasladó, recibió)" aria-label="Buscar traslados" />
            {qLive ? <button type="button" onClick={() => setQLive("")} className="absolute right-2 top-1/2 -translate-y-1/2 px-2 text-sm" style={{ color: "var(--t-muted)" }} aria-label="Borrar búsqueda">✕</button> : null}
          </div>
          <select className={inputClass} style={inputStyle} value={tf.origin} onChange={(e) => setTfField("origin", e.target.value)} aria-label="Sale de">
            <option value="">Sale de: todas</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.kind === "point" ? "📍 " : "🏬 "}{w.name}</option>)}
          </select>
          <select className={inputClass} style={inputStyle} value={tf.dest} onChange={(e) => setTfField("dest", e.target.value)} aria-label="Llega a">
            <option value="">Llega a: todos</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.kind === "point" ? "📍 " : "🏬 "}{w.name}</option>)}
          </select>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold" style={{ color: "var(--t-muted)" }}>Fecha:</span>
          <DateField compact value={tf.from} onChange={(v) => setTfField("from", v)} max={tf.to || undefined} ariaLabel="Desde" placeholder="Desde" className="w-36" />
          <span style={{ color: "var(--t-muted)" }}>a</span>
          <DateField compact value={tf.to} onChange={(v) => setTfField("to", v)} min={tf.from || undefined} ariaLabel="Hasta" placeholder="Hasta" className="w-36" />
          {([["today", "Hoy"], ["7", "Últimos 7 días"], ["month", "Este mes"], ["last", "Mes pasado"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => quickRange(k)} className="rounded-full border px-3 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{l}</button>
          ))}
          {filtersOn ? (
            <button type="button" onClick={() => { setQLive(""); setTf({ q: "", from: "", to: "", origin: "", dest: "" }); setFilter("all"); setLimit(30); }} className="rounded-full border px-3 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)" }}>✕ Limpiar filtros</button>
          ) : null}
          {rows.length ? <button type="button" onClick={exportList} className="ml-auto rounded-full border px-3 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Exportar</button> : null}
        </div>
        {rows.length ? (
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded-2xl border px-4 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 6%, transparent)" }}>
            <span><b>{total ?? rows.length}</b> traslado{(total ?? rows.length) === 1 ? "" : "s"}{total !== null && total > rows.length ? ` (viendo ${rows.length})` : ""}</span>
            <span><b>{listSummary.units.toLocaleString("es-CO")}</b> unidades</span>
            {listSummary.inTransit ? <span style={{ color: "#f59e0b" }}><b>{listSummary.inTransit}</b> en tránsito</span> : null}
            {listSummary.missing ? <span style={{ color: "#ef4444" }}><b>{listSummary.missing}</b> unidades no llegaron</span> : null}
            {loadingList ? <span style={{ color: "var(--t-muted)" }}>Buscando…</span> : null}
          </div>
        ) : null}
        {rows.length === 0 ? <Empty text={loadingList ? "Buscando…" : filtersOn ? "Ningún traslado coincide con los filtros." : "Con un traslado mueves mercancía de la bodega a un punto (o entre puntos): sale del origen, queda «en tránsito» y entra cuando el destino la recibe y firma."} icon={!loadingList && !filtersOn ? "🚚" : undefined} title={!loadingList && !filtersOn ? "Aún no hay traslados" : undefined} /> : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="glass-soft rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">#{row.number} · {names.get(row.from_warehouse_id) ?? "—"} → {names.get(row.to_warehouse_id) ?? "—"}</p>
                  <StatusPill status={row.status} />
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                  Envió: <b>{row.created_by_name ?? "—"}</b> · Revisó: <b>{row.checked_by_name ?? "—"}</b> · Traslada: <b>{row.carrier_name ?? "—"}</b> · {dateTime(row.created_at)}
                </p>
                {row.status === "received" ? (
                  <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                    Recibió: <b>{row.received_by_name ?? "—"}</b> · {dateTime(row.received_at)}{row.received_notes ? ` · ${row.received_notes}` : ""}
                  </p>
                ) : null}
                {row.notes ? <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>Nota: {row.notes}</p> : null}
                {row.track_token && row.status !== "cancelled" ? <TrackProgress row={row} /> : null}

                {receiving?.id === row.id ? (
                  <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Cuenta lo que llegó</p>
                      <Btn variant="ghost" onClick={() => setScanReceive(true)}><span title="Opcional: con la cámara del celular o un lector de códigos">📷 Recibir escaneando</span></Btn>
                    </div>
                    {scanReceive ? (
                      <ScanCounter
                        storeId={ctx.storeId}
                        title={`Recibir traslado #${row.number}`}
                        allowed={new Map(row.erp_transfer_items.map((i) => [i.product_id, { name: itemName(i), sku: (Array.isArray(i.products) ? i.products[0] : i.products)?.sku ?? null, max: i.qty }]))}
                        zeroOthersLabel="Lo que no escaneé no llegó (queda en 0)"
                        onClose={() => setScanReceive(false)}
                        onDone={(counts, zeroOthers) => {
                          setScanReceive(false);
                          const got = new Map(counts.map((c) => [c.product_id, c.qty]));
                          const qty = { ...receiving.qty };
                          for (const i of row.erp_transfer_items) {
                            if (got.has(i.product_id)) qty[i.product_id] = Math.min(i.qty, got.get(i.product_id)!);
                            else if (zeroOthers) qty[i.product_id] = 0;
                          }
                          setReceiving({ ...receiving, qty });
                          const short = row.erp_transfer_items.filter((i) => (qty[i.product_id] ?? i.qty) < i.qty).length;
                          void toast(short ? `Faltan unidades en ${short} producto(s)` : "Llegó todo completo", short ? "warning" : "success", short ? "Revisa y explica el faltante en las notas." : undefined);
                        }}
                      />
                    ) : null}
                    {row.erp_transfer_items.map((i) => (
                      <label key={i.product_id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">{itemName(i)} <span style={{ color: "var(--t-muted)" }}>(enviadas {i.qty})</span></span>
                        <input
                          type="number"
                          min={0}
                          max={i.qty}
                          className={`${inputClass} w-24`}
                          style={inputStyle}
                          value={receiving.qty[i.product_id] ?? i.qty}
                          onChange={(e) => setReceiving({ ...receiving, qty: { ...receiving.qty, [i.product_id]: Math.min(i.qty, Math.max(0, Math.floor(Number(e.target.value) || 0))) } })}
                        />
                      </label>
                    ))}
                    <input className={inputClass} style={inputStyle} placeholder="Notas de recepción (obligatorio si falta algo)" value={receiving.notes} onChange={(e) => setReceiving({ ...receiving, notes: e.target.value })} />
                    <div className="flex gap-2">
                      <Btn onClick={() => void confirmReceive(row)}>✅ Confirmar recepción</Btn>
                      <Btn variant="ghost" onClick={() => setReceiving(null)}>Cancelar</Btn>
                    </div>
                  </div>
                ) : editingId === row.id ? (
                  <TransferEditor
                    transferId={row.id} storeId={ctx.storeId} fromId={row.from_warehouse_id} fromName={names.get(row.from_warehouse_id)} number={row.number}
                    items={row.erp_transfer_items.map((i) => ({ product_id: i.product_id, name: itemName(i), sku: (Array.isArray(i.products) ? i.products[0] : i.products)?.sku ?? null, qty: i.qty }))}
                    packedSigned={(row.erp_transfer_signatures ?? []).some((s) => s.step === "packed")}
                    onClose={() => setEditingId(null)} onSaved={() => { setEditingId(null); void load(); }}
                  />
                ) : (
                  <TransferItemsList items={row.erp_transfer_items} />
                )}

                {receiving?.id !== row.id && (row.track_token || (canTransfer && row.status === "in_transit")) ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {row.track_token && row.status !== "cancelled" ? (
                      row.status === "in_transit" && row.track_expires_at && new Date(row.track_expires_at) < new Date() ? (
                        <Btn variant="ghost" onClick={() => void renewLink(row)}>⏰ Enlace vencido · Renovar</Btn>
                      ) : (
                        <>
                          <Btn onClick={() => shareWhatsApp(row)}>💬 Enviar enlace por WhatsApp</Btn>
                          <Btn variant="ghost" onClick={() => void copyLink(row)}>🔗 Copiar enlace</Btn>
                          {/* En el mismo espacio de la tienda (con la sesión): así la hoja incluye precios por mayor. */}
                          <a href={`/traslado/${row.track_token}/imprimir`} target="_blank" rel="noopener noreferrer"
                            className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                            🖨️ Imprimir
                          </a>
                          <a href={`/documento/etiquetas?traslado=${row.id}`} target="_blank" rel="noopener noreferrer" title="Etiquetas con código de barras y el precio del punto que recibe"
                            className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                            🏷️ Etiquetas
                          </a>
                          <a href={`/documento/rotulo?traslado=${row.id}`} target="_blank" rel="noopener noreferrer" title="Rótulo para cada bulto: para quién va, bulto N de M y QR para recibir"
                            className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                            📦 Rótulo
                          </a>
                          <a
                            href={transferTrackUrl(row.track_token)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold underline"
                            style={{ color: "var(--t-muted)" }}
                          >
                            Abrir seguimiento
                          </a>
                        </>
                      )
                    ) : null}
                    {canTransfer && row.status === "in_transit" ? (
                      <>
                        {editable(row) && editingId !== row.id ? <Btn variant="ghost" onClick={() => { setReceiving(null); setEditingId(row.id); }}>✏️ Corregir productos</Btn> : null}
                        <Btn variant="ghost" onClick={() => startReceive(row)}>Recibir desde el panel</Btn>
                        <Btn variant="danger" onClick={() => void cancel(row)}>Anular</Btn>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {total !== null && total > rows.length ? (
          <div className="mt-3 text-center">
            <Btn variant="ghost" onClick={() => setLimit((n) => n + 30)} disabled={loadingList}>{loadingList ? "Cargando…" : `Cargar más (${total - rows.length} restantes)`}</Btn>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
