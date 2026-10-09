"use client";

import { useState } from "react";
import Swal from "sweetalert2";
import { TriangleAlert } from "lucide-react";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, Card, EmptyState, Notice, SectionTitle, fmtDateTime, notify, swal } from "./ui";

const KINDS: Array<[string, string]> = [["provider", "Proveedor tecnológico caído"], ["dian", "Servicio DIAN no disponible"], ["connectivity", "Sin internet en el punto"], ["power", "Sin energía"], ["other", "Otro"]];

export function ContingencyTab({ access, data, reload }: { access: FiscalAccess; data: FiscalOverview; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const can = access.canAny(["fiscal_send", "fiscal_config"]);
  const org = access.scope?.scope === "organization" || access.scope?.scope === "global";

  async function start() {
    const points = data.points.map((p) => `<option value="${p.point.id}">${p.point.name}</option>`).join("");
    const kinds = KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    const res = await Swal.fire({
      ...swal, title: "Abrir contingencia",
      html: `<div style="text-align:left;display:grid;gap:10px">
        <label style="font-size:12px">Punto<select id="ct-point" class="swal2-select" style="width:100%;margin:6px 0 0">${org ? '<option value="">Toda la tienda</option>' : ""}${points}</select></label>
        <label style="font-size:12px">Causa<select id="ct-kind" class="swal2-select" style="width:100%;margin:6px 0 0">${kinds}</select></label>
        <label style="font-size:12px">Qué está pasando<input id="ct-reason" class="swal2-input" style="width:100%;margin:6px 0 0" placeholder="Ej: el proveedor no responde desde las 9:00"/></label>
      </div>`,
      showCancelButton: true, confirmButtonText: "Abrir contingencia", cancelButtonText: "Cancelar", confirmButtonColor: "#f59e0b",
      preConfirm: () => {
        const reason = (document.getElementById("ct-reason") as HTMLInputElement).value.trim();
        if (reason.length < 5) return Swal.showValidationMessage("Describe qué está pasando.");
        return { point: (document.getElementById("ct-point") as HTMLSelectElement).value || null, kind: (document.getElementById("ct-kind") as HTMLSelectElement).value, reason };
      },
    });
    if (!res.isConfirmed) return;
    setBusy(true);
    try {
      await fiscalRpc("fiscal_contingency_start", { p_store: access.store?.id, p_point: res.value.point, p_kind: res.value.kind, p_reason: res.value.reason });
      await notify("Contingencia abierta", "warning", "Los documentos de ese alcance quedan en cola hasta cerrarla.");
      await reload();
    } catch (err) {
      await notify("No se pudo abrir", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string) {
    const res = await Swal.fire({ ...swal, title: "Cerrar contingencia", input: "text", inputPlaceholder: "Cómo se resolvió (opcional)", showCancelButton: true, confirmButtonText: "Cerrar y transmitir cola", cancelButtonText: "Cancelar" });
    if (!res.isConfirmed) return;
    try {
      const r = await fiscalRpc<{ requeued: number }>("fiscal_contingency_end", { p_id: id, p_notes: res.value || null });
      await notify(`Contingencia cerrada · ${r.requeued} documentos vuelven a la cola`);
      await reload();
    } catch (err) {
      await notify("No se pudo cerrar", "error", errorText(err));
    }
  }

  const pointName = (id: string | null) => (id ? data.points.find((p) => p.point.id === id)?.point.name ?? "Punto" : "Toda la tienda");
  return (
    <div className="space-y-4">
      <SectionTitle title="Contingencias" subtitle="Cuando el proveedor o la DIAN no responden, los documentos quedan en cola y se transmiten al cerrar la contingencia."
        actions={can ? <Button variant="primary" icon={<TriangleAlert size={15} />} busy={busy} onClick={() => void start()}>Abrir contingencia</Button> : null} />
      <Notice tone="warn" icon="⚖️">Las reglas exactas de contingencia (documentos de contingencia, plazos de transmisión) <b>requieren validación con el proveedor tecnológico y la contadora</b>. RemHub guarda la trazabilidad completa.</Notice>
      {data.contingencies.length === 0 ? <EmptyState icon="🌤️" title="Sin contingencias registradas" /> : (
        <div className="space-y-2">
          {data.contingencies.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-black">{pointName(c.point_id)} <Badge tone={c.status === "open" ? "warn" : "neutral"}>{c.status === "open" ? "Abierta" : "Cerrada"}</Badge></p>
                <p className="text-sm">{KINDS.find(([v]) => v === c.kind)?.[1]} · {c.reason}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Desde {fmtDateTime(c.started_at)} por {c.started_by_name ?? "—"}{c.ended_at ? ` · cerrada ${fmtDateTime(c.ended_at)} por ${c.ended_by_name ?? "—"}${c.end_notes ? ` · ${c.end_notes}` : ""}` : ""}</p>
              </div>
              {c.status === "open" && can ? <Button onClick={() => void end(c.id)}>Cerrar</Button> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
