"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ScanEye, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuditEventCard } from "./AuditEventCard";
import { useAuditAccess, type AuditEvent, type AuditFilters } from "./audit-labels";

const SCAN_CSS = `
@keyframes remhub-scan { 0% { transform: translateY(-140%); } 100% { transform: translateY(140%); } }
.remhub-spy .remhub-scan { animation: remhub-scan 2.6s ease-in-out infinite alternate; }
@media (prefers-reduced-motion: reduce) { .remhub-spy .remhub-scan { animation: none; opacity: 0; } }
`;

/** Insignia «espía»: ojo que escanea. Solo aparece si el usuario puede consultar la auditoría. */
export function AuditSpyButton({ storeId, title = "Auditoría de este espacio", filters, size = "md", label }: {
  storeId: string | null | undefined; title?: string; filters?: AuditFilters; size?: "sm" | "md"; label?: string;
}) {
  const access = useAuditAccess(storeId);
  const [open, setOpen] = useState(false);
  if (!storeId || !access?.scope) return null;
  const px = size === "sm" ? 30 : 36;
  return (
    <>
      <style>{SCAN_CSS}</style>
      <button type="button" onClick={() => setOpen(true)} title={title} aria-label={title}
        className="remhub-spy group relative inline-flex shrink-0 items-center gap-1.5 overflow-hidden rounded-full border font-bold transition hover:-translate-y-0.5 focus-visible:outline-2"
        style={{ height: px, minWidth: px, padding: label ? "0 12px 0 8px" : 0, justifyContent: "center", borderColor: "color-mix(in oklab, #22d3ee 45%, var(--t-card-border))", background: "linear-gradient(135deg, color-mix(in oklab, #0f172a 85%, transparent), color-mix(in oklab, #0e7490 35%, transparent))", color: "#67e8f9", boxShadow: "0 0 0 1px rgba(34,211,238,.12), 0 6px 18px rgba(8,145,178,.25)" }}>
        <span className="remhub-scan pointer-events-none absolute inset-x-0 top-1/2 h-px" style={{ background: "linear-gradient(90deg, transparent, #67e8f9, transparent)", boxShadow: "0 0 8px #22d3ee" }} aria-hidden />
        <ScanEye size={size === "sm" ? 15 : 17} className="relative" aria-hidden />
        {label ? <span className="relative text-xs">{label}</span> : null}
      </button>
      <AnimatePresence>{open ? <AuditDrawer storeId={storeId} title={title} filters={filters ?? {}} onClose={() => setOpen(false)} /> : null}</AnimatePresence>
    </>
  );
}

/** Panel lateral con los eventos del espacio o del registro (paginación en el servidor). */
export function AuditDrawer({ storeId, title, filters, onClose }: { storeId: string; title: string; filters: AuditFilters; onClose: () => void }) {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filters);

  const load = useCallback(async (next: unknown) => {
    setLoading(true);
    const { data, error: e } = await supabaseBrowser().rpc("erp_audit_search", { p_store: storeId, p_filters: JSON.parse(key), p_limit: 20, p_cursor: next });
    setLoading(false);
    const r = data as { ok: boolean; message?: string; items?: AuditEvent[]; next_cursor?: unknown } | null;
    if (e || !r?.ok) return setError(e?.message ?? r?.message ?? "No se pudo consultar la auditoría.");
    setError(null);
    setItems((cur) => (next ? [...cur, ...(r.items ?? [])] : r.items ?? []));
    setCursor(r.next_cursor ?? null);
  }, [storeId, key]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(null), 0);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [load, onClose]);

  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)])).toString();
  return (
    <motion.div className="fixed inset-0 z-[150]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)", paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "rgba(34,211,238,.14)", color: "#67e8f9" }}><ScanEye size={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{title}</p>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Solo lectura · los eventos no se pueden editar ni borrar</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }}><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
          {items.map((e) => <AuditEventCard key={e.id} e={e} />)}
          {!loading && !error && !items.length ? <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>🕵️ Todavía no hay eventos aquí.</p> : null}
          {loading ? <p className="py-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>Consultando…</p> : null}
          {cursor && !loading ? (
            <button type="button" onClick={() => void load(cursor)} className="w-full rounded-2xl border py-2.5 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cargar más</button>
          ) : null}
        </div>
        <footer className="border-t p-3 text-sm" style={{ borderColor: "var(--t-card-border)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <Link href={`/dashboard/auditoria${qs ? `?${qs}` : ""}`} onClick={onClose} className="flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 font-black text-white" style={{ background: "linear-gradient(135deg,#0891b2,#6366f1)" }}>
            🕵️ Abrir el centro de auditoría
          </Link>
        </footer>
      </motion.aside>
    </motion.div>
  );
}
