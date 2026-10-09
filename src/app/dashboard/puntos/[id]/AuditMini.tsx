"use client";

import { AUDIT_CATEGORY_INFO, type AuditRow } from "@/lib/fiscal/types";
import { Badge, Card, EmptyState, SectionTitle, fmtDateTime } from "../../fiscal/ui";

type Row = { id: string; created_at: string; user_name: string | null; action: string; category: string; severity: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null };

/** Últimos cambios del punto (configuración, fiscal, usuarios y seguridad). */
export function AuditRowsMini({ rows }: { rows: Row[] }) {
  if (!rows.length) return <EmptyState icon="🗂️" title="Sin registros de auditoría para este punto" />;
  return (
    <Card>
      <SectionTitle title="Auditoría del punto" subtitle="Últimos 40 movimientos con valor anterior y nuevo." />
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="flex flex-wrap items-center gap-1.5 font-bold">
              {AUDIT_CATEGORY_INFO[r.category as AuditRow["category"]]?.icon} {r.action}
              {r.severity !== "info" ? <Badge tone={r.severity === "critical" ? "bad" : "warn"}>{r.severity === "critical" ? "Crítica" : "Advertencia"}</Badge> : null}
            </p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{fmtDateTime(r.created_at)} · {r.user_name ?? "Sistema"}{r.reason ? ` · Motivo: ${r.reason}` : ""}</p>
            {r.after && Object.keys(r.after).length ? (
              <p className="mt-1 break-words text-xs">
                {Object.keys(r.after).slice(0, 6).map((k) => (
                  <span key={k} className="mr-2"><b>{k}</b>: <span className="text-red-500 line-through">{JSON.stringify(r.before?.[k] ?? "")}</span> → <span className="text-emerald-600">{JSON.stringify(r.after?.[k])}</span></span>
                ))}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
