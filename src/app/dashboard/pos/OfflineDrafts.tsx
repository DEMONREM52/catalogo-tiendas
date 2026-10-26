"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, CloudOff, Printer, RefreshCw, Trash2, Upload } from "lucide-react";
import Swal from "sweetalert2";
import { draftKind, getDrafts, removeDraft, subscribeDrafts, updateDraft, type PosDraft } from "@/lib/pos/drafts";
import { resolveOfflineIssue, syncOfflineDrafts } from "@/lib/pos/sync";
import { useNetStatus } from "@/lib/net/status";
import { supabaseBrowser } from "@/lib/supabase/client";

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;
const KIND: Record<string, string> = { remision: "Remisión", factura: "Factura (al volver)", contingencia: "Factura de contingencia" };

type Issue = {
  client_id: string; point_name: string | null; kind: string | null; total: number | null; created_offline_at: string | null;
  code: string | null; message: string | null; attempts: number; last_by: string | null; customer_name: string | null; fiscal_number: string | null;
};

/**
 * Bandeja de ventas hechas sin conexión. Se envían solas al volver (desde cualquier pantalla del panel);
 * aquí se ven, se reimprimen y se revisan las que la base no aceptó sola (también las de otros equipos).
 */
export function OfflineDrafts({ storeId, activeId, onLoad, onPrint }: { storeId: string | undefined; activeId: string | null; onLoad: (d: PosDraft) => void; onPrint: (d: PosDraft) => void }) {
  const drafts = useSyncExternalStore(subscribeDrafts, () => getDrafts(storeId), () => getDrafts(null));
  const net = useNetStatus();
  // Se envía solo si hay internet y la base responde (si está caída, esperar evita errores a medias).
  const reach = net.online && net.db !== "down";
  const [open, setOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesTick, setIssuesTick] = useState(0);

  // Ventas por revisar de TODOS los equipos de la tienda (las de este equipo ya se ven abajo).
  useEffect(() => {
    if (!storeId || !reach) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_pos_offline_issues_list", { p_store: storeId }).then(({ data, error }) => {
      const r = data as { ok?: boolean; items?: Issue[] } | null;
      if (alive && !error && r?.ok) setIssues(r.items ?? []);
    });
    return () => {
      alive = false;
    };
  }, [storeId, reach, drafts.length, issuesTick]);

  const local = new Set(drafts.map((d) => d.id));
  const remote = issues.filter((i) => !local.has(i.client_id));
  if (!storeId || (drafts.length === 0 && remote.length === 0)) return null;
  const total = drafts.reduce((s, d) => s + d.total, 0);

  async function sendNow() {
    if (!storeId) return;
    setSending(true);
    try {
      const res = await syncOfflineDrafts(storeId, activeId);
      if (res.waiting) void Swal.fire({ toast: true, position: "top-end", timer: 4000, showConfirmButton: false, icon: "info", title: "Aún no hay conexión con la base: se reintenta solo.", background: "var(--t-bg-base)", color: "var(--t-text)" });
      setIssuesTick((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  async function discard(d: PosDraft) {
    const ok = await Swal.fire({
      icon: "warning",
      title: "¿Descartar esta venta?",
      text: `${d.customerName} · ${money(d.total)}. No se registrará.`,
      input: "text",
      inputPlaceholder: "¿Por qué? (ej.: el cliente no se la llevó)",
      inputValidator: (v) => (v.trim().length < 3 ? "Escribe el motivo." : undefined),
      showCancelButton: true,
      confirmButtonText: "Descartar",
      cancelButtonText: "Conservar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#ef4444",
    });
    if (!ok.isConfirmed) return;
    await removeDraft(storeId!, d.id);
    if (d.review) void resolveOfflineIssue(d.id, `Descartada en el POS: ${String(ok.value).trim()}`);
  }

  /** Factura de contingencia que no se pudo registrar sola: la cierra (con su nota) quien maneja la facturación. */
  async function resolvePaper(d: PosDraft) {
    const res = await Swal.fire({
      icon: "warning",
      title: `Cerrar ${d.fiscal?.full_number ?? "la factura"} a mano`,
      html: "Ya se entregó en papel con ese número. Úsalo solo si la registraste de otra forma (por ejemplo, desde el Centro fiscal).<br/><small>Requiere permiso de facturación electrónica. Queda en la auditoría.</small>",
      input: "text",
      inputPlaceholder: "¿Qué se hizo? (ej.: se facturó en el Centro fiscal con el mismo número)",
      inputValidator: (v) => (v.trim().length < 3 ? "Escribe qué se hizo." : undefined),
      showCancelButton: true,
      confirmButtonText: "Cerrar",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#ef4444",
    });
    if (!res.isConfirmed || !storeId) return;
    const { data, error } = await supabaseBrowser().rpc("erp_pos_offline_issue_resolve", { p_client: d.id, p_note: String(res.value).trim() });
    const r = data as { ok?: boolean; message?: string } | null;
    if (error || !r?.ok) {
      void Swal.fire({ icon: "error", title: "No se pudo cerrar", text: r?.message ?? error?.message ?? "Intenta de nuevo.", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    await removeDraft(storeId, d.id);
    setIssuesTick((n) => n + 1);
  }

  async function resolveRemote(i: Issue) {
    const res = await Swal.fire({
      icon: "question",
      title: "Marcar como resuelta",
      text: `${i.customer_name ?? "Cliente"} · ${money(Number(i.total ?? 0))}${i.fiscal_number ? ` · ${i.fiscal_number}` : ""}. ¿Qué se hizo con esta venta?`,
      input: "text",
      inputPlaceholder: "Ej.: se registró a mano en el otro equipo",
      inputValidator: (v) => (v.trim().length < 3 ? "Escribe qué se hizo." : undefined),
      showCancelButton: true,
      confirmButtonText: "Marcar resuelta",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
    });
    if (!res.isConfirmed) return;
    const { data } = await supabaseBrowser().rpc("erp_pos_offline_issue_resolve", { p_client: i.client_id, p_note: String(res.value).trim() });
    const r = data as { ok?: boolean; message?: string } | null;
    if (!r?.ok) void Swal.fire({ icon: "error", title: "No se pudo", text: r?.message ?? "Intenta de nuevo.", background: "var(--t-bg-base)", color: "var(--t-text)" });
    setIssuesTick((n) => n + 1);
  }

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border p-3"
      style={{ borderColor: "rgba(245,158,11,.5)", background: "color-mix(in oklab, #f59e0b 9%, var(--t-card-bg))" }}
    >
      <div className="flex w-full items-center gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: "#f59e0b" }}>
            <CloudOff size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-sm">
              {drafts.length
                ? `${drafts.length} venta${drafts.length === 1 ? "" : "s"} hecha${drafts.length === 1 ? "" : "s"} sin conexión · ${money(total)}`
                : `${remote.length} venta${remote.length === 1 ? "" : "s"} sin conexión por revisar en otros equipos`}
            </b>
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>
              {!reach
                ? "Se quedan en este equipo y se registran solas cuando vuelva la conexión (desde cualquier pantalla)."
                : sending
                  ? "Enviando…"
                  : "Las que necesitan revisión: corrige lo que dice y reintenta, o regístrala a mano."}
            </span>
          </span>
          <ChevronDown size={16} className={open ? "rotate-180 transition" : "transition"} />
        </button>
        {drafts.some((d) => !d.review && !d.practice) && reach ? (
          <button type="button" disabled={sending} onClick={() => void sendNow()} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#22c55e" }}>
            <RefreshCw size={13} className={sending ? "animate-spin" : ""} /> Enviar ya
          </button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="mt-2 space-y-1.5 overflow-hidden">
            {drafts.map((d) => {
              const kind = draftKind(d);
              const paper = kind === "contingencia";
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: d.id === activeId ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{d.practice ? "🎓 Práctica · " : ""}{paper ? `🧾 ${d.fiscal?.full_number} · ` : ""}{d.customerName}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                      {new Date(d.createdAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })} · {d.cart.reduce((s, i) => s + i.qty, 0)} und. · {KIND[kind]}
                      {d.payment ? ` · ${d.payment.method}` : ""}
                    </span>
                    {d.review ? (
                      <span className="mt-0.5 block text-xs text-amber-400">
                        ⚠️ {d.review}{" "}
                        {d.reviewCode !== "MIGRATION" ? (
                          <button type="button" onClick={() => void updateDraft(storeId, d.id, { review: undefined, reviewCode: undefined })} className="font-bold underline">Reintentar envío</button>
                        ) : null}
                        {paper && !d.practice && reach ? (
                          <>
                            {" · "}
                            <button type="button" onClick={() => void resolvePaper(d)} className="font-bold underline">Marcar resuelta</button>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <b className="tabular-nums">{money(d.total)}</b>
                  <button type="button" onClick={() => onPrint(d)} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Imprimir de nuevo" title="Imprimir de nuevo">
                    <Printer size={13} />
                  </button>
                  {/* Una factura de contingencia ya se entregó en papel con su número: no se rehace ni se borra aquí. */}
                  {/* Las de práctica nunca se registran: solo se borran. */}
                  {!paper && !d.practice ? (
                    <button type="button" disabled={!reach || d.id === activeId} onClick={() => onLoad(d)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: "#22c55e" }} title="Cargar al carrito y registrarla a mano">
                      <Upload size={13} /> {d.id === activeId ? "En el carrito" : "Registrar"}
                    </button>
                  ) : null}
                  {!paper || d.practice ? (
                    <button type="button" onClick={() => void (d.practice ? removeDraft(storeId, d.id) : discard(d))} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Descartar venta">
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </li>
              );
            })}
            {remote.map((i) => (
              <li key={i.client_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{i.fiscal_number ? `🧾 ${i.fiscal_number} · ` : ""}{i.customer_name ?? "Cliente"} <span className="font-normal opacity-70">· otro equipo</span></b>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                    {i.created_offline_at ? new Date(i.created_offline_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : ""} · {KIND[i.kind ?? "remision"] ?? i.kind}{i.point_name ? ` · ${i.point_name}` : ""}{i.last_by ? ` · ${i.last_by}` : ""} · {i.attempts} intento{i.attempts === 1 ? "" : "s"}
                  </span>
                  <span className="mt-0.5 block text-xs text-amber-400">⚠️ {i.message}</span>
                </span>
                <b className="tabular-nums">{money(Number(i.total ?? 0))}</b>
                <button type="button" onClick={() => void resolveRemote(i)} className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                  Marcar resuelta
                </button>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
