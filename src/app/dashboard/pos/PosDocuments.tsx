"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FilePlus2, Printer, Search, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

export type PosDocument = {
  order_id: string;
  token: string;
  receipt_no: number | null;
  doc_number: string | null;
  doc_kind: "factura" | "remision";
  status: "draft" | "sent" | "confirmed" | "completed" | string;
  customer_name: string | null;
  customer_doc: string | null;
  customer_whatsapp: string | null;
  customer_note: string | null;
  total: number;
  created_at: string;
  seller_name: string | null;
  items: Array<{ product_id: string; name: string; qty: number; price: number; image_url: string | null }>;
};

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;
const when = (iso: string) => new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
const editable = (d: PosDocument) => d.status === "draft" || d.status === "sent";

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "Abierto", color: "#f59e0b" },
  sent: { label: "Enviado", color: "#3b82f6" },
  confirmed: { label: "Confirmado", color: "#22c55e" },
  completed: { label: "Completado", color: "#14b8a6" },
};

const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)" } as const;

export function PosDocuments({
  storeId, pointId, pointName, refreshKey, editingId, printFormat, onEdit,
}: {
  storeId: string | undefined;
  pointId: string;
  pointName: string;
  refreshKey: number;
  editingId: string | null;
  printFormat: "tirilla" | "carta";
  onEdit: (doc: PosDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<PosDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open || !storeId || !pointId) return;
    let alive = true;
    const t = window.setTimeout(() => {
      setLoading(true);
      void supabaseBrowser()
        .rpc("erp_pos_documents", { p_store: storeId, p_point: pointId, p_query: query.trim(), p_limit: 30 })
        .then(({ data, error: err }) => {
          if (!alive) return;
          setLoading(false);
          if (err) {
            setError(/Could not find the function|schema cache/i.test(err.message) ? "Falta ejecutar en Supabase el SQL 20261009_pos_documents.sql." : err.message);
            return;
          }
          setError("");
          setDocs((data ?? []) as PosDocument[]);
        });
    }, 280);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, storeId, pointId, query, refreshKey, reloadTick]);

  function openReceipt(doc: PosDocument) {
    window.open(`${window.location.origin}/pedido/${doc.token}?formato=${printFormat === "carta" ? "carta" : "t80"}`, "_blank");
  }

  async function confirmDoc(doc: PosDocument) {
    const label = doc.doc_number ?? `#${doc.receipt_no}`;
    const res = await Swal.fire({
      ...swalTheme,
      icon: "question",
      title: `Confirmar ${label}`,
      html: `Se descontará el inventario de <b>${pointName}</b> y el documento ya no se podrá editar.`,
      showCancelButton: true,
      confirmButtonText: "Confirmar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#22c55e",
    });
    if (!res.isConfirmed) return;
    const { error: err } = await supabaseBrowser().rpc("store_team_set_order_status", { p_order_id: doc.order_id, p_status: "confirmed" });
    if (err) return void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo confirmar", text: err.message });
    void Swal.fire({ ...swalTheme, icon: "success", title: `${label} confirmado`, timer: 1300, showConfirmButton: false });
    setReloadTick((n) => n + 1);
  }

  // Atajo: Ctrl/Cmd + K abre la búsqueda; Esc la cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && pointId) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && !Swal.isVisible()) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pointId]);

  if (!pointId) return null;

  return (
    <>
      <motion.button
        type="button"
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen(true)}
        title="Buscar remisión o factura (Ctrl + K)"
        aria-label="Buscar remisión o factura"
        className="grid h-9 w-9 place-items-center rounded-full shadow-md"
        style={{ background: "var(--t-cta)" }}
      >
        <Search className="h-4.5 w-4.5 text-white" strokeWidth={2.6} />
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[90] flex items-end justify-center p-2 sm:items-start sm:p-4 sm:pt-[9vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            style={{ background: "color-mix(in oklab, black 55%, transparent)", backdropFilter: "blur(6px)" }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`Documentos de ${pointName}`}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-3xl border"
              style={{
                background: "color-mix(in oklab, var(--t-bg-base) 90%, var(--t-card-bg))",
                borderColor: "var(--t-card-border)",
                color: "var(--t-text)",
                boxShadow: "0 30px 90px rgba(0,0,0,.45)",
              }}
            >
              <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "var(--t-cta)" }}>
                    <Search className="h-5 w-5 text-white" />
                  </span>
                  <div>
                    <h2 className="text-base font-bold">Documentos de {pointName}</h2>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>Ver, agregar productos o confirmar una remisión o factura</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90"
                  style={{ borderColor: "var(--t-card-border)" }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--t-muted)" }} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="N.º de pedido, REMZ-00002, nombre, cédula o WhatsApp del cliente…"
                  className="w-full rounded-xl border py-2.5 pl-9 pr-9 text-sm outline-none transition focus:ring-2"
                  style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" }}
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} aria-label="Limpiar" className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4" style={{ color: "var(--t-muted)" }} />
                  </button>
                ) : null}
              </div>

              <div className="mt-3 min-h-[140px] flex-1 space-y-2 overflow-y-auto pr-1">
                {error ? (
                  <p className="rounded-xl border border-dashed p-3 text-sm" style={{ borderColor: "#ef4444" }}>{error}</p>
                ) : loading && docs.length === 0 ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl" style={{ background: "var(--t-card-bg-soft)" }} />
                  ))
                ) : docs.length === 0 ? (
                  <p className="py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>
                    {query.trim() ? "No hay documentos de este punto con esa búsqueda." : "Este punto aún no tiene documentos."}
                  </p>
                ) : (
                  <AnimatePresence initial={false}>
                    {docs.map((doc, index) => {
                      const st = STATUS[doc.status] ?? { label: doc.status, color: "#94a3b8" };
                      const isOpen = expanded === doc.order_id;
                      const isEditing = editingId === doc.order_id;
                      return (
                        <motion.div
                          key={doc.order_id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 8) * 0.025 } }}
                          exit={{ opacity: 0 }}
                          className="rounded-xl border"
                          style={{
                            borderColor: isEditing ? "var(--t-accent)" : "var(--t-card-border)",
                            background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : doc.order_id)}
                            className="flex w-full items-center gap-3 p-2.5 text-left"
                          >
                            <span
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[10px] font-black uppercase"
                              style={{ background: "var(--t-card-bg-soft)", color: doc.doc_kind === "factura" ? "var(--t-accent)" : "var(--t-text)" }}
                            >
                              {doc.doc_kind === "factura" ? "FAC" : "REM"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-2 text-sm font-bold">
                                {doc.doc_number ?? `Pedido #${doc.receipt_no}`}
                                <span className="text-[11px] font-normal" style={{ color: "var(--t-muted)" }}>#{doc.receipt_no}</span>
                              </span>
                              <span className="block truncate text-xs" style={{ color: "var(--t-muted)" }}>
                                {doc.customer_name ?? "—"}{doc.customer_doc ? ` · ${doc.customer_doc}` : ""} · {when(doc.created_at)}
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="block text-sm font-bold">{money(doc.total)}</span>
                              <span
                                className="mt-0.5 inline-block rounded-full border px-2 text-[10px] font-bold"
                                style={{ color: st.color, borderColor: st.color }}
                              >
                                {isEditing ? "Editando" : st.label}
                              </span>
                            </span>
                          </button>

                          <AnimatePresence initial={false}>
                            {isOpen ? (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: "var(--t-card-border)" }}>
                                  <ul className="space-y-1 text-xs">
                                    {doc.items.map((it) => (
                                      <li key={it.product_id} className="flex justify-between gap-2">
                                        <span className="min-w-0 truncate">{it.qty} × {it.name}</span>
                                        <span className="shrink-0 font-semibold">{money(it.qty * it.price)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  {doc.seller_name ? (
                                    <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Atendió: {doc.seller_name}</p>
                                  ) : null}
                                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {editable(doc) ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onEdit(doc);
                                          setOpen(false);
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white"
                                        style={{ background: "var(--t-cta)" }}
                                      >
                                        <FilePlus2 className="h-3.5 w-3.5" /> Agregar / editar productos
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => openReceipt(doc)}
                                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
                                      style={{ borderColor: "var(--t-card-border)" }}
                                    >
                                      <Printer className="h-3.5 w-3.5" /> Ver e imprimir
                                    </button>
                                    {editable(doc) ? (
                                      <button
                                        type="button"
                                        onClick={() => void confirmDoc(doc)}
                                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
                                        style={{ borderColor: "color-mix(in oklab, #22c55e 55%, transparent)", color: "#22c55e" }}
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
                                      </button>
                                    ) : (
                                      <span className="self-center text-[11px]" style={{ color: "var(--t-muted)" }}>
                                        Confirmado: ya no se puede editar.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                )}
              </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
