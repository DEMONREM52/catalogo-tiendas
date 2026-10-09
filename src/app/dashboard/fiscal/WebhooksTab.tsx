"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorText, fiscalApi } from "@/lib/fiscal/client";
import type { FiscalAccess } from "./useFiscal";
import { Badge, Button, EmptyState, ErrorBox, SectionTitle, Skeleton, fmtDateTime, notify } from "./ui";

type Event = {
  id: string; provider: string; external_event_id: string | null; event_type: string | null; signature_valid: boolean; status: string;
  attempts: number; next_retry_at: string | null; last_error: string | null; received_at: string; processed_at: string | null; source_ip: string | null;
};

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" | "info" }> = {
  received: { label: "Recibido", tone: "info" }, processing: { label: "Procesando", tone: "info" }, processed: { label: "Procesado", tone: "good" },
  failed: { label: "Falló (reintento)", tone: "warn" }, dead: { label: "Sin éxito (manual)", tone: "bad" }, rejected: { label: "Firma inválida", tone: "bad" }, ignored: { label: "Ignorado", tone: "neutral" },
};

export function WebhooksTab({ access }: { access: FiscalAccess }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabaseBrowser().from("fiscal_webhook_events")
      .select("id,provider,external_event_id,event_type,signature_valid,status,attempts,next_retry_at,last_error,received_at,processed_at,source_ip")
      .eq("store_id", access.store?.id ?? "").order("received_at", { ascending: false }).limit(100);
    if (filter) q = q.eq("status", filter);
    const { data, error: err } = await q;
    if (err) setError(errorText(err));
    else {
      setRows((data ?? []) as Event[]);
      setError(null);
    }
  }, [access.store?.id, filter]);
  useEffect(() => {
     
    void load();
  }, [load]);

  async function retry(e: Event) {
    setBusy(e.id);
    try {
      const res = await fiscalApi<{ result: { ok: boolean; message: string } }>("/api/fiscal/webhooks/retry", { event_id: e.id });
      await notify(res.result.ok ? "Evento procesado" : "Sigue fallando", res.result.ok ? "success" : "warning", res.result.message);
      await load();
    } catch (err) {
      await notify("No se pudo reintentar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="Webhooks del proveedor" subtitle="Cada evento se guarda una sola vez, se verifica su firma y se reintenta con espera creciente si falla." />
      <div className="flex flex-wrap gap-1.5">
        {[["", "Todos"], ["failed", "Con falla"], ["dead", "Sin éxito"], ["rejected", "Firma inválida"], ["processed", "Procesados"]].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFilter(v)} className="rounded-full border px-3 py-1 text-xs font-semibold" style={filter === v ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{l}</button>
        ))}
      </div>
      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
      {!rows && !error ? <Skeleton rows={4} /> : null}
      {rows && !rows.length ? <EmptyState icon="📭" title="Sin eventos" text="Aquí aparecen las notificaciones que envía el proveedor tecnológico." /> : null}
      <div className="space-y-2">
        {rows?.map((e) => {
          const st = STATUS[e.status] ?? STATUS.received;
          return (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-bold">{e.event_type ?? "evento"} <Badge tone={st.tone}>{st.label}</Badge> {!e.signature_valid ? <Badge tone="bad">🛡️ sin firma válida</Badge> : null}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  {e.provider} · {fmtDateTime(e.received_at)} · {e.attempts} intentos{e.source_ip ? ` · IP ${e.source_ip}` : ""}{e.next_retry_at ? ` · próximo ${fmtDateTime(e.next_retry_at)}` : ""}
                </p>
                {e.last_error ? <p className="text-xs text-red-500">{e.last_error}</p> : null}
              </div>
              {(e.status === "failed" || e.status === "dead") && e.signature_valid && access.can("fiscal_provider") ? (
                <Button icon={<RotateCcw size={14} />} busy={busy === e.id} onClick={() => void retry(e)}>Reintentar</Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
