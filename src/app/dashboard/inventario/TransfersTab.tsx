"use client";

import { useCallback, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TRANSFER_STEPS, transferTrackUrl, transferWhatsAppText, type TransferStep } from "@/lib/transfer-tracking";
import { ProductPicker } from "./LineEditor";
import {
  Btn, Empty, Panel, StatusPill, askReason, confirmAction, dateTime, errorMessage, inputClass, inputStyle,
  tableWrap, td, th, toast, useRunOnChange, type ErpCtx, type ProductHit, type Warehouse,
} from "./shared";

type PlanLine = { product_id: string; name: string; sku: string | null; available: number };
type Matrix = Record<string, Record<string, number>>;

type TransferItem = { product_id: string; qty: number; received_qty: number | null; products: { name: string } | { name: string }[] | null };
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
  "id,number,status,notes,created_at,received_at,from_warehouse_id,to_warehouse_id,created_by_name,carrier_name,checked_by_name,received_by_name,received_notes,erp_transfer_items(product_id,qty,received_qty,products(name))";
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

export function TransfersTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const active = warehouses.filter((w) => w.active);
  const names = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const canTransfer = ctx.can("transfers");

  const [pickedFrom, setFrom] = useState("");
  const from = ctx.pointId ?? pickedFrom;
  const [targets, setTargets] = useState<string[]>([]);
  const [lines, setLines] = useState<PlanLine[]>([]);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [notes, setNotes] = useState("");
  const [carrier, setCarrier] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  const [busy, setBusy] = useState(false);

  const [filter, setFilter] = useState<"all" | "in_transit" | "received">("all");
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [receiving, setReceiving] = useState<{ id: string; qty: Record<string, number>; notes: string } | null>(null);

  const load = useCallback(async () => {
    const run = (columns: string) => {
      let query = supabaseBrowser()
        .from("erp_transfers")
        .select(columns)
        .eq("store_id", ctx.storeId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (filter !== "all") query = query.eq("status", filter);
      return query;
    };
    let { data, error } = await run(TRACK_COLUMNS);
    // Sin la migración de seguimiento se muestran los traslados sin enlace ni firmas.
    if (error) ({ data, error } = await run(BASE_COLUMNS));
    if (error) void toast("No se pudieron cargar los traslados", "error", errorMessage(error));
    else setRows((data ?? []) as unknown as TransferRow[]);
  }, [ctx.storeId, filter]);

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
  const overdrawn = lines.some((l) => used(l.product_id) > l.available);

  function addProduct(hit: ProductHit) {
    setLines((prev) => [...prev, { product_id: hit.id, name: hit.name, sku: hit.sku, available: hit.wh_qty }]);
  }

  function setQty(productId: string, dest: string, qty: number) {
    setMatrix((prev) => ({ ...prev, [productId]: { ...(prev[productId] ?? {}), [dest]: Math.max(0, Math.floor(qty || 0)) } }));
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

    const units = plan.reduce((sum, leg) => sum + leg.items.reduce((s, i) => s + i.qty, 0), 0);
    if (!(await confirmAction("Enviar mercancía", `Se crearán ${plan.length} traslado(s) con ${units} unidades. Quedarán en tránsito hasta que cada destino las reciba.`, "Enviar"))) return;

    setBusy(true);
    const sb = supabaseBrowser();
    const { data: ids, error } = await sb.rpc("erp_dispatch_transfers", {
      p_store: ctx.storeId, p_from: from, p_notes: notes, p_carrier: carrier, p_checked_by: checkedBy, p_plan: plan,
    });
    if (error) {
      setBusy(false);
      return void toast("No se pudo enviar", "error", errorMessage(error));
    }
    resetPlan();
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
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>3 · Productos y cantidades</p>
                <ProductPicker
                  storeId={ctx.storeId}
                  warehouseId={from}
                  inStockOnly
                  excludeIds={lines.map((l) => l.product_id)}
                  placeholder={`Buscar en ${names.get(from) ?? "origen"} (solo con existencias)…`}
                  onPick={addProduct}
                />
                {lines.length > 0 ? (
                  <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
                    <table className="w-full min-w-[560px]">
                      <thead style={{ color: "var(--t-muted)" }}>
                        <tr>
                          <th className={th}>Producto</th>
                          <th className={th}>Disponible</th>
                          {targets.map((t) => <th key={t} className={th}>→ {names.get(t)}</th>)}
                          <th className={th}>Queda</th>
                          <th className={th} />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => {
                          const left = line.available - used(line.product_id);
                          return (
                            <tr key={line.product_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                              <td className={td}>
                                <div className="font-semibold">{line.name}</div>
                                {line.sku ? <div className="text-xs" style={{ color: "var(--t-muted)" }}>{line.sku}</div> : null}
                              </td>
                              <td className={td}>{line.available}</td>
                              {targets.map((t) => (
                                <td key={t} className={td}>
                                  <input
                                    type="number"
                                    min={0}
                                    className={`${inputClass} w-24`}
                                    style={inputStyle}
                                    value={matrix[line.product_id]?.[t] ?? 0}
                                    onChange={(e) => setQty(line.product_id, t, Number(e.target.value))}
                                  />
                                </td>
                              ))}
                              <td className={td} style={{ fontWeight: 700, color: left < 0 ? "#ef4444" : undefined }}>{left}</td>
                              <td className={td}>
                                <Btn variant="ghost" onClick={() => setLines((prev) => prev.filter((l) => l.product_id !== line.product_id))}>Quitar</Btn>
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
                  <input className={`${inputClass} font-semibold uppercase`} style={inputStyle} placeholder="¿QUIÉN REVISÓ LA MERCANCÍA? *" value={checkedBy} onChange={(e) => setCheckedBy(e.target.value.toUpperCase())} />
                  <input className={`${inputClass} font-semibold uppercase`} style={inputStyle} placeholder="¿QUIÉN LA TRASLADA? *" value={carrier} onChange={(e) => setCarrier(e.target.value.toUpperCase())} />
                  <input className={inputClass} style={inputStyle} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>El usuario que envía queda registrado automáticamente.</p>
                <Btn onClick={() => void send()} disabled={busy || overdrawn}>{busy ? "Enviando…" : "🚚 Enviar mercancía"}</Btn>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Traslados"
        actions={
          <div className="flex gap-1.5">
            {([["all", "Todos"], ["in_transit", "En tránsito"], ["received", "Recibidos"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                style={filter === key ? { background: "var(--t-accent)", color: "var(--t-cta-text, #fff)", borderColor: "transparent" } : { borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? <Empty text="No hay traslados para este filtro." /> : (
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
                    <p className="text-sm font-semibold">Cuenta lo que llegó</p>
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
                ) : (
                  <p className="mt-2 text-sm">
                    {row.erp_transfer_items.map((i) => `${i.qty}${i.received_qty !== null && i.received_qty !== i.qty ? ` (llegaron ${i.received_qty})` : ""} × ${itemName(i)}`).join(" · ")}
                  </p>
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
      </Panel>
    </div>
  );
}
