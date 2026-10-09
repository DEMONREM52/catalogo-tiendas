"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronDown, RefreshCw, Settings } from "lucide-react";
import { errorText, fiscalApi } from "@/lib/fiscal/client";
import { statusLabel, type PointReadiness } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, Card, Dot, EmptyState, EnvBadge, Notice, Progress, SectionTitle, notify, type TONE } from "./ui";

type Tone = keyof typeof TONE;

export function readinessTone(p: PointReadiness): Tone {
  if (p.ready) return p.warnings.length ? "warn" : "good";
  return p.enabled ? "bad" : "warn";
}

/** Tarjeta de salud fiscal de un punto (🟢 listo · 🟡 advertencias · 🔴 no listo). */
export function ReadinessCard({ p, defaultOpen = false }: { p: PointReadiness; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = readinessTone(p);
  const label = p.ready ? (p.warnings.length ? "🟡 Listo con advertencias" : "🟢 Listo para facturar") : "🔴 No listo para facturar";
  const done = p.checks.filter((c) => c.ok).length;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-black"><Dot tone={tone} pulse={tone === "bad"} /> {p.point.name}</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
            {p.entity ? `${p.entity.legal_name} · ${p.entity.document_type} ${p.entity.document_number ?? ""}${p.entity.verification_digit ? `-${p.entity.verification_digit}` : ""}` : "Sin contribuyente"}
            {p.provider ? ` · ${p.provider.name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <EnvBadge env={p.environment} />
          <Badge tone={tone}>{label}</Badge>
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[11px]" style={{ color: "var(--t-muted)" }}>
          <span>Configuración</span>
          <span>{done} de {p.checks.length}</span>
        </div>
        <Progress value={(done / Math.max(p.checks.length, 1)) * 100} tone={tone} />
      </div>
      {p.range ? (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div><p style={{ color: "var(--t-muted)" }}>Numeración</p><p className="font-bold">{p.range.prefix || "Sin prefijo"} · sig. {p.range.next_number}</p></div>
          <div><p style={{ color: "var(--t-muted)" }}>Uso del rango</p><p className="font-bold" style={{ color: p.range.near_exhaustion ? "#d97706" : undefined }}>{p.range.used_pct}% · quedan {p.range.remaining}</p></div>
          <div><p style={{ color: "var(--t-muted)" }}>Vigencia</p><p className="font-bold" style={{ color: p.range.near_expiry ? "#d97706" : undefined }}>{p.range.days_left === null ? "Sin vencimiento" : `${p.range.days_left} días`}</p></div>
        </div>
      ) : null}
      {p.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-xs font-bold" style={{ color: "var(--t-accent)" }}>
        {open ? "Ocultar lista de verificación" : "Ver lista de verificación"}
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-1.5">
          {p.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5">{c.na ? "➖" : c.ok ? "✅" : "🔴"}</span>
              <span className="min-w-0">
                <span className="font-semibold">{c.label}</span>
                {c.detail ? <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{c.detail}</span> : null}
              </span>
            </li>
          ))}
        </motion.ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href={`/dashboard/puntos/${p.point.id}?tab=fiscal`} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
          <Settings size={13} /> Configurar fiscalidad del punto
        </Link>
      </div>
    </Card>
  );
}

export function SummaryTab({ access, data, reload, onOpen }: { access: FiscalAccess; data: FiscalOverview; reload: () => Promise<void>; onOpen: (tab: string, extra?: Record<string, string>) => void }) {
  const [busy, setBusy] = useState(false);
  const settings = data.settings;

  async function processQueue() {
    if (!access.store) return;
    setBusy(true);
    try {
      const res = await fiscalApi<{ documents: Array<{ status: string | null }> }>("/api/fiscal/jobs", { store_id: access.store.id });
      await notify(res.documents.length ? `Se procesaron ${res.documents.length} documentos` : "No hay documentos pendientes de envío");
      await reload();
    } catch (error) {
      await notify("No se pudo procesar la cola", "error", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {settings && !settings.fiscal_enabled ? (
        <Notice tone="warn" icon="⚠️">
          La facturación electrónica está <b>apagada para toda la tienda</b>. Configura cada punto y, cuando esté listo, actívala en{" "}
          <button type="button" className="font-bold underline" onClick={() => onOpen("configuracion")}>Configuración</button>.
        </Notice>
      ) : null}
      {data.queue.rejected > 0 ? (
        <Notice tone="bad" icon="⛔">
          Hay <b>{data.queue.rejected}</b> documentos rechazados.{" "}
          <button type="button" className="font-bold underline" onClick={() => onOpen("documentos", { estado: "REJECTED" })}>Revisarlos</button>
        </Notice>
      ) : null}
      {data.pending_sales > 0 ? (
        <Notice tone="warn" icon="🧾">
          <b>{data.pending_sales}</b> remisiones de venta de puntos habilitados aún no tienen documento fiscal.{" "}
          <button type="button" className="font-bold underline" onClick={() => onOpen("pendientes")}>Ver y facturar</button>
        </Notice>
      ) : null}

      <SectionTitle
        title="Salud fiscal por punto"
        subtitle="🟢 configuración correcta · 🟡 advertencias · 🔴 falta algo para facturar"
        actions={access.can("fiscal_send") ? <Button icon={<RefreshCw size={15} />} busy={busy} onClick={() => void processQueue()}>Procesar pendientes</Button> : null}
      />
      {data.points.length === 0 ? (
        <EmptyState icon="📍" title="Sin puntos" text="Crea los puntos de venta de tu tienda madre para configurar su facturación." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.points.map((p) => <ReadinessCard key={p.point.id} p={p} defaultOpen={!p.ready && data.points.length <= 2} />)}
        </div>
      )}

      <Card>
        <SectionTitle title="Este mes" subtitle="Documentos por estado" />
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.month.by_status).length === 0 ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Todavía no hay documentos este mes.</p> : null}
          {Object.entries(data.month.by_status).map(([status, n]) => (
            <button key={status} type="button" onClick={() => onOpen("documentos", { estado: status })} className="rounded-2xl border px-3 py-2 text-left text-xs" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="block font-semibold" style={{ color: "var(--t-muted)" }}>{statusLabel(status)}</span>
              <span className="text-lg font-black">{n}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
