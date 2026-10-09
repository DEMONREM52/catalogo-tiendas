"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCheck2 } from "lucide-react";
import { errorText, fiscalApi, fiscalRpc, newIdempotencyKey } from "@/lib/fiscal/client";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, EmptyState, ErrorBox, Notice, SectionTitle, Skeleton, confirmDialog, fmtDateTime, fmtMoney, notify } from "./ui";

type Pending = {
  order_id: string; token: string; doc_number: string | null; doc_kind: string; point_id: string; point_name: string;
  customer_name: string | null; customer_doc: string | null; total: number; created_at: string; seller_name: string | null; age_days: number; overdue: boolean;
};

/** Ventas (remisiones) de puntos habilitados que siguen sin documento fiscal. No oculta nada: muestra lo que falta facturar. */
export function PendingTab({ access, data, onChanged }: { access: FiscalAccess; data: FiscalOverview; onChanged: () => void }) {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [maxDays, setMaxDays] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fiscalRpc<{ items: Pending[]; max_days: number }>("fiscal_pending_sales", { p_store: access.store?.id, p_point: null, p_limit: 300 });
      setRows(res.items);
      setMaxDays(res.max_days);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [access.store?.id]);
  useEffect(() => {
     
    void load();
  }, [load]);

  async function invoice(p: Pending) {
    const ok = await confirmDialog(`Facturar ${p.doc_number ?? "la venta"}`, `Se emitirá el documento electrónico de <b>${fmtMoney(p.total)}</b> en <b>${p.point_name}</b>, relacionado con esta remisión.`, "Emitir factura");
    if (!ok) return;
    setBusy(p.order_id);
    try {
      const res = await fiscalApi<{ document: { full_number: string }; send: { ok: boolean; message: string } | null }>("/api/fiscal/pos/invoice", {
        store_id: access.store?.id, token: p.token, point_id: p.point_id, idempotency_key: newIdempotencyKey("rem"),
      });
      await notify(`Factura ${res.document.full_number} emitida`, res.send?.ok === false ? "warning" : "success", res.send?.message);
      await load();
      onChanged();
    } catch (err) {
      await notify("No se pudo facturar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const policy = data.settings?.remission_policy ?? "warn";
  return (
    <div className="space-y-4">
      <SectionTitle title="Ventas pendientes de documento fiscal" subtitle={`Remisiones de venta de puntos con facturación electrónica activa. Plazo configurado: ${maxDays} días.`} />
      <Notice tone="info" icon="ℹ️">
        Las remisiones son documentos operativos. Si la operación debe facturarse según la normativa (lo valida tu contadora), factúrala aquí: la factura queda relacionada con su remisión.
        Regla actual de la tienda: <b>{policy === "block" ? "bloquear remisiones de venta" : policy === "warn" ? "avisar cuando venza el plazo" : "sin control"}</b>.
      </Notice>
      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
      {!rows && !error ? <Skeleton rows={4} /> : null}
      {rows && rows.length === 0 ? <EmptyState icon="✅" title="No hay ventas pendientes de facturar" /> : null}
      <div className="space-y-2">
        {rows?.map((p) => (
          <div key={p.order_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3" style={{ borderColor: p.overdue ? "color-mix(in oklab, #f59e0b 50%, transparent)" : "var(--t-card-border)" }}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-black">
                {p.doc_number ?? "Venta"} {p.overdue ? <Badge tone="warn">Hace {p.age_days} días</Badge> : <Badge>{p.age_days} días</Badge>}
              </p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.point_name} · {fmtDateTime(p.created_at)} · {p.customer_name ?? "Cliente"}{p.seller_name ? ` · ${p.seller_name}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <b className="tabular-nums">{fmtMoney(p.total)}</b>
              <a href={`/pedido/${p.token}`} target="_blank" rel="noreferrer" className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Ver remisión</a>
              {access.canAny(["fiscal_send", "pos"]) ? <Button variant="primary" icon={<FileCheck2 size={15} />} busy={busy === p.order_id} onClick={() => void invoice(p)}>Facturar</Button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
