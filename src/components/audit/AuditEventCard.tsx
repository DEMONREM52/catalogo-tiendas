"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ACTOR, RESULT, ROLE, actionLabel, diffRows, entityLabel, fmtValue, moduleInfo, type AuditEvent } from "./audit-labels";

/** Un evento de auditoría: quién, qué, cuándo, dónde, antes → después y evidencia técnica. */
export function AuditEventCard({ e, showStore }: { e: AuditEvent; showStore?: boolean }) {
  const [open, setOpen] = useState(false);
  const mod = moduleInfo(e.module);
  const res = RESULT[e.result ?? "success"] ?? RESULT.success;
  const rows = diffRows(e);
  const update = e.action.endsWith(".update") || (e.before && e.after);
  const sev = e.severity === "critical" ? { t: "Crítico", c: "#ef4444" } : e.severity === "warning" ? { t: "Atención", c: "#f59e0b" } : null;

  return (
    <article className="rounded-2xl border p-3" style={{ borderColor: e.severity === "critical" ? "rgba(239,68,68,.5)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" }}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }} aria-hidden>{mod.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-sm font-black">{actionLabel(e)}</span>
            <span className="rounded-full px-2 py-0.5 font-bold" style={{ color: res.color, background: `color-mix(in oklab, ${res.color} 14%, transparent)` }}>{res.emoji} {res.label}</span>
            {sev ? <span className="rounded-full px-2 py-0.5 font-bold" style={{ color: sev.c, background: `color-mix(in oklab, ${sev.c} 14%, transparent)` }}>{sev.t}</span> : null}
          </div>
          <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
            <b style={{ color: "var(--t-text)" }}>{e.user_name ?? "Sistema"}</b>
            {e.actor_role ? ` · ${ROLE[e.actor_role] ?? e.actor_role}` : ""}
            {e.actor_type && e.actor_type !== "user" ? ` · ${ACTOR[e.actor_type] ?? e.actor_type}` : ""}
            {" · "}{new Date(e.created_at).toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {e.point_name ? ` · 📍 ${e.point_name}` : ""}
            {showStore && e.store_name ? ` · 🏪 ${e.store_name}` : ""}
          </p>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{mod.label} · {entityLabel(e.entity)}{typeof e.after?.producto === "string" ? ` · ${e.after.producto}` : typeof e.after?.name === "string" && !update ? ` · ${e.after.name}` : ""}</p>
        </div>
      </div>

      {rows.length && update ? (
        <div className="mt-2.5 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full text-xs">
            <thead><tr style={{ color: "var(--t-muted)" }}><th className="px-2.5 py-1.5 text-left font-bold">Campo</th><th className="px-2.5 py-1.5 text-left font-bold">Antes</th><th className="px-2.5 py-1.5 text-left font-bold">Después</th></tr></thead>
            <tbody>
              {rows.slice(0, open ? 60 : 6).map((r) => (
                <tr key={r.key} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className="px-2.5 py-1.5 font-semibold">{r.label}</td>
                  <td className="max-w-[180px] break-words px-2.5 py-1.5 text-red-400 line-through decoration-red-400/50">{fmtValue(r.before)}</td>
                  <td className="max-w-[180px] break-words px-2.5 py-1.5 font-semibold text-emerald-400">{fmtValue(r.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {e.reason ? <p className="mt-2 rounded-xl border px-2.5 py-1.5 text-xs" style={{ borderColor: "var(--t-card-border)" }}>💬 <b>Motivo:</b> {e.reason}</p> : null}

      <div className="mt-2 text-[11px]">
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 font-bold" style={{ color: "var(--t-muted)" }} aria-expanded={open}>
          <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} /> {open ? "Ocultar detalle" : "Ver detalle y evidencia"}
        </button>
      </div>
      {open ? (
        <dl className="mt-2 grid gap-x-3 gap-y-1 rounded-xl border p-2.5 text-[11px] sm:grid-cols-[auto_1fr]" style={{ borderColor: "var(--t-card-border)" }}>
          {!update && rows.length ? (<><dt className="font-bold" style={{ color: "var(--t-muted)" }}>Datos</dt><dd className="break-words">{rows.slice(0, 40).map((r) => `${r.label}: ${fmtValue(r.after ?? r.before)}`).join(" · ")}</dd></>) : null}
          {e.detail && Object.keys(e.detail).length ? (<><dt className="font-bold" style={{ color: "var(--t-muted)" }}>Contexto</dt><dd className="break-words font-mono">{JSON.stringify(e.detail)}</dd></>) : null}
          <dt className="font-bold" style={{ color: "var(--t-muted)" }}>Evento</dt><dd className="break-all font-mono">{e.id}</dd>
          {e.correlation_id ? (<><dt className="font-bold" style={{ color: "var(--t-muted)" }}>Operación</dt><dd className="break-all font-mono">{e.correlation_id}</dd></>) : null}
          {e.entity_id ? (<><dt className="font-bold" style={{ color: "var(--t-muted)" }}>Registro</dt><dd className="break-all font-mono">{e.entity_id}</dd></>) : null}
          {e.ip ? (<><dt className="font-bold" style={{ color: "var(--t-muted)" }}>Origen</dt><dd className="break-words">{e.ip}{e.user_agent ? ` · ${e.user_agent.slice(0, 90)}` : ""}</dd></>) : null}
          <dt className="font-bold" style={{ color: "var(--t-muted)" }}>Integridad</dt>
          <dd className="break-all font-mono">{e.hash ? `🔗 #${e.chain_seq} · ${e.hash.slice(0, 16)}…` : "Anterior a la cadena de integridad"}</dd>
        </dl>
      ) : null}
    </article>
  );
}
