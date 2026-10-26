"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Send, Unlock } from "lucide-react";
import { errorText, fiscalApi, fiscalRpc } from "@/lib/fiscal/client";
import type { FiscalAccess } from "./useFiscal";
import { Badge, Button, Card, EmptyState, Notice, SectionTitle, fmtDateTime, fmtMoney, notify, swal } from "./ui";
import { WhatsAppAlerts } from "./WhatsAppAlerts";

type Pending = {
  id: string; full_number: string; point_name: string | null; status: string; total: number; customer_name: string | null;
  paper_issued_at: string; synced_at: string; deadline: string; hours_left: number; attempts: number; last_error: string | null;
};
type Block = {
  id: string; point_name: string; device: string; prefix: string; from: number; to: number; status: "active" | "closed";
  reserved_by: string | null; reserved_at: string; used: number; free: number; voided: number; closed_at: string | null; closed_by: string | null; closed_reason: string | null;
};

/**
 * Facturar sin internet (contingencia del facturador, «tipo 03»): facturas de papel con la numeración de
 * contingencia, separada por equipo, que se transmiten a la DIAN apenas vuelve la conexión (plazo: 48 horas).
 */
export function OfflineFiscal({ access }: { access: FiscalAccess }) {
  const storeId = access.store?.id;
  const canManage = access.canAny(["fiscal_send", "fiscal_config", "fiscal_numbering"]);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    try {
      const p = await fiscalRpc<{ items: Pending[] }>("fiscal_contingency_pending", { p_store: storeId });
      setPending(p.items);
    } catch {
      setPending([]);
    }
    if (!canManage) return;
    try {
      const b = await fiscalRpc<{ items: Block[] }>("fiscal_offline_blocks_list", { p_store: storeId });
      setBlocks(b.items);
    } catch {
      setBlocks([]);
    }
  }, [storeId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(doc: Pending) {
    setBusy(doc.id);
    try {
      const r = await fiscalApi<{ result: { ok: boolean; message: string } }>("/api/fiscal/documents/send", { document_id: doc.id });
      await notify(r.result.ok ? `${doc.full_number} enviada` : "Aún no se pudo transmitir", r.result.ok ? "success" : "warning", r.result.message);
    } catch (err) {
      await notify("No se pudo enviar", "error", errorText(err));
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function release(b: Block) {
    const res = await Swal.fire({
      ...swal,
      icon: "warning",
      title: `Liberar ${b.free} números de ${b.point_name}`,
      html: `Equipo …${b.device} · ${b.prefix}${b.from} a ${b.prefix}${b.to}.<br/><small>Úsalo si el equipo se perdió, se dañó o ya no se usa. Los números sin usar quedan <b>anulados sin transmitir</b>. Si ese equipo ya había hecho facturas en papel, igual se registran al volver.</small>`,
      input: "text",
      inputPlaceholder: "Motivo (ej.: celular del punto perdido)",
      inputValidator: (v) => (v.trim().length < 5 ? "Escribe el motivo." : undefined),
      showCancelButton: true,
      confirmButtonText: "Liberar números",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
    });
    if (!res.isConfirmed) return;
    setBusy(b.id);
    try {
      const r = await fiscalRpc<{ voided: number }>("fiscal_offline_release", { p_block: b.id, p_reason: String(res.value).trim() });
      await notify(`${r.voided} números liberados`);
    } catch (err) {
      await notify("No se pudo liberar", "error", errorText(err));
    } finally {
      setBusy(null);
      void load();
    }
  }

  const hours = (h: number) => (h <= 0 ? "plazo vencido" : h < 1 ? "menos de 1 hora" : `${Math.floor(h)} h`);
  return (
    <div className="space-y-4">
      <SectionTitle title="Facturar sin internet" subtitle="Si se cae el internet en un punto, el POS imprime facturas de contingencia en papel y las transmite a la DIAN apenas vuelve la conexión." />
      <Card className="space-y-2 text-sm">
        <p className="font-black">¿Cómo queda en regla?</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Pide a la DIAN una <b>numeración de contingencia</b> (MUISCA → numeración de facturación, formulario 1876, tipo contingencia/talonario).</li>
          <li>Cárgala en <b>Numeración</b> como «Factura de contingencia» y autoriza los puntos que la usan.</li>
          <li>Cada equipo del POS separa solo 15 números mientras tiene conexión (nunca se repiten entre equipos).</li>
          <li>Sin internet, en «Factura» el POS imprime la factura de contingencia con su número y la resolución.</li>
          <li>Al volver la conexión, cada venta se registra sola y se envía a la DIAN como factura electrónica de contingencia. <b>Plazo: 48 horas.</b></li>
        </ol>
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Si quien falla es la DIAN o el proveedor (no tu internet), la factura electrónica se emite normal y queda en cola: RemHub la reintenta solo.</p>
      </Card>
      <Notice tone="warn" icon="⚖️">Confirma con tu contadora y con el proveedor tecnológico la numeración y el procedimiento de contingencia antes de usarlo en producción.</Notice>
      {storeId && canManage ? <WhatsAppAlerts storeId={storeId} /> : null}

      <div className="space-y-2">
        <p className="text-sm font-black">Facturas de contingencia por aceptar</p>
        {pending === null ? <p className="text-sm opacity-70">Cargando…</p> : pending.length === 0 ? (
          <EmptyState icon="✅" title="Nada pendiente" text="Todas las facturas hechas sin internet ya fueron aceptadas." />
        ) : pending.map((d) => (
          <Card key={d.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-black">
                🧾 {d.full_number}
                <Badge tone={d.status === "REJECTED" ? "bad" : d.status === "ERROR" ? "warn" : "info"}>{d.status}</Badge>
                <Badge tone={d.hours_left < 12 ? "bad" : "warn"}>{hours(d.hours_left)}</Badge>
              </p>
              <p className="text-sm">{d.customer_name ?? "Consumidor final"} · {fmtMoney(d.total)}{d.point_name ? ` · ${d.point_name}` : ""}</p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                En papel: {fmtDateTime(d.paper_issued_at)} · registrada: {fmtDateTime(d.synced_at)} · {d.attempts} intento{d.attempts === 1 ? "" : "s"}
                {d.last_error ? ` · ${d.last_error}` : ""}
              </p>
            </div>
            {canManage && ["QUEUED", "ERROR", "REJECTED"].includes(d.status) ? (
              <Button icon={<Send size={14} />} busy={busy === d.id} onClick={() => void send(d)}>Enviar ahora</Button>
            ) : null}
          </Card>
        ))}
      </div>

      {canManage ? (
        <div className="space-y-2">
          <p className="text-sm font-black">Números separados por equipo</p>
          {blocks === null ? <p className="text-sm opacity-70">Cargando…</p> : blocks.length === 0 ? (
            <EmptyState icon="📟" title="Ningún equipo ha separado números" text="Se separan solos cuando un equipo abre el POS de un punto con numeración de contingencia." />
          ) : blocks.map((b) => (
            <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-black">
                  {b.point_name} · equipo …{b.device}
                  <Badge tone={b.status === "active" ? "good" : "neutral"}>{b.status === "active" ? "Activo" : "Liberado"}</Badge>
                </p>
                <p className="text-sm">{b.prefix}{b.from} a {b.prefix}{b.to} · {b.used} usados · {b.free} libres{b.voided ? ` · ${b.voided} anulados` : ""}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Separados {fmtDateTime(b.reserved_at)}{b.reserved_by ? ` por ${b.reserved_by}` : ""}
                  {b.closed_at ? ` · liberados ${fmtDateTime(b.closed_at)}${b.closed_by ? ` por ${b.closed_by}` : ""}${b.closed_reason ? ` (${b.closed_reason})` : ""}` : ""}
                </p>
              </div>
              {b.status === "active" && b.free > 0 ? (
                <Button icon={<Unlock size={14} />} busy={busy === b.id} onClick={() => void release(b)}>Liberar</Button>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
