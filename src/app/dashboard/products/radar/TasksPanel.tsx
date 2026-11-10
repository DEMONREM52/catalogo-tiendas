"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { Check, ClipboardList, Eye, Loader2, RotateCcw, Trash2 } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ddmmyyyy, ISSUES, type IssueKey } from "@/lib/products/radar";
import { Sheet } from "./RadarWidgets";

export type ProductTask = {
  id: string; title: string; note: string | null; issue: string | null; product_ids: string[]; count: number;
  assignee: string; assignee_name: string | null; mine: boolean; created_by_name: string | null;
  status: "open" | "done" | "cancelled"; created_at: string; done_at: string | null;
};

const toast = (title: string, icon: "success" | "error" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2400, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

export function useProductTasks(storeId: string | null) {
  const [tasks, setTasks] = useState<ProductTask[] | null>(null);
  const load = useCallback(async () => {
    if (!storeId) return;
    const { data } = await supabaseBrowser().rpc("product_task_list", { p_store: storeId, p_all: true });
    const d = data as { ok?: boolean; tasks?: ProductTask[] } | null;
    setTasks(d?.ok ? d.tasks ?? [] : []);
  }, [storeId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  return { tasks, reload: load };
}

export function TasksPanel({ storeId, tasks, reload, onShow }: { storeId: string; tasks: ProductTask[] | null; reload: () => void; onShow: (t: ProductTask) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [only, setOnly] = useState<"mine" | "all">("mine");
  async function setStatus(t: ProductTask, status: ProductTask["status"]) {
    setBusy(t.id);
    const { data, error } = await supabaseBrowser().rpc("product_task_set_status", { p_store: storeId, p_task: t.id, p_status: status });
    setBusy(null);
    const d = data as { ok?: boolean; message?: string } | null;
    if (error || !d?.ok) { toast(error?.message ?? d?.message ?? "No se pudo", "error"); return; }
    toast(status === "done" ? "✅ Tarea terminada" : status === "open" ? "Tarea reabierta" : "Tarea anulada");
    reload();
  }
  if (!tasks) return <p className="p-4 text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="mr-1 inline animate-spin" /> Cargando tareas…</p>;
  const list = tasks.filter((t) => only === "all" || t.mine);
  const open = list.filter((t) => t.status === "open");
  const closed = list.filter((t) => t.status !== "open");
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {(["mine", "all"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setOnly(k)} className="rounded-xl border px-3 py-1.5 text-xs font-bold"
            style={only === k ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 15%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
            {k === "mine" ? `Mis tareas (${tasks.filter((t) => t.mine && t.status === "open").length})` : `Todas (${tasks.filter((t) => t.status === "open").length})`}
          </button>
        ))}
        <p className="ml-auto text-[11px]" style={{ color: "var(--t-muted)" }}>Para asignar: selecciona productos y toca «Asignar».</p>
      </div>
      {open.length === 0 ? (
        <div className="rounded-2xl border p-6 text-center" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <p className="text-3xl">🧘</p><p className="mt-1 font-black">Sin tareas pendientes</p>
        </div>
      ) : null}
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {[...open, ...closed].map((t) => {
            const issue = t.issue && t.issue in ISSUES ? ISSUES[t.issue as IssueKey] : null;
            const isOpen = t.status === "open";
            return (
              <motion.li key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: isOpen ? 1 : 0.6, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-wrap items-center gap-3 rounded-2xl border p-3" style={{ borderColor: t.mine && isOpen ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>{issue?.emoji ?? "📋"}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-black ${isOpen ? "" : "line-through"}`}>{t.title}</p>
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                    👤 <b style={{ color: "var(--t-text)" }}>{t.mine ? "Tú" : t.assignee_name}</b> · {t.count} producto{t.count === 1 ? "" : "s"} · {ddmmyyyy(t.created_at)} por {t.created_by_name ?? "—"}
                    {t.status === "done" && t.done_at ? ` · ✅ ${ddmmyyyy(t.done_at)}` : t.status === "cancelled" ? " · anulada" : ""}
                  </p>
                  {t.note ? <p className="mt-0.5 text-xs">{t.note}</p> : null}
                </div>
                <div className="flex items-center gap-1.5">
                  {t.count ? <button type="button" onClick={() => onShow(t)} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}><Eye size={12} /> Ver productos</button> : null}
                  {isOpen ? (
                    <>
                      <button type="button" disabled={busy === t.id} onClick={() => void setStatus(t, "done")} className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-black text-white disabled:opacity-50" style={{ background: "#10b981" }}>
                        {busy === t.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Terminada
                      </button>
                      <button type="button" disabled={busy === t.id} onClick={() => void setStatus(t, "cancelled")} className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} title="Anular" aria-label="Anular"><Trash2 size={12} /></button>
                    </>
                  ) : (
                    <button type="button" disabled={busy === t.id} onClick={() => void setStatus(t, "open")} className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} title="Reabrir" aria-label="Reabrir"><RotateCcw size={12} /></button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}

type Member = { id: string; name: string; me: boolean };

export function AssignDialog({ storeId, productIds, issue, onClose, onDone }: { storeId: string; productIds: string[]; issue: IssueKey | null; onClose: () => void; onDone: () => void }) {
  const [team, setTeam] = useState<Member[] | null>(null);
  const [who, setWho] = useState("");
  const [title, setTitle] = useState(issue ? `Arreglar: ${ISSUES[issue].label.toLowerCase()}` : "Revisar estos productos");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabaseBrowser().rpc("product_team", { p_store: storeId }).then(({ data }) => setTeam(Array.isArray(data) ? (data as Member[]) : []));
  }, [storeId]);
  async function create() {
    if (!who || !title.trim()) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("product_task_create", { p_store: storeId, p_assignee: who, p_title: title, p_note: note, p_products: productIds, p_issue: issue });
    setBusy(false);
    const d = data as { ok?: boolean; message?: string } | null;
    if (error || !d?.ok) { toast(error?.message ?? d?.message ?? "No se pudo", "error"); return; }
    toast(`📋 Tarea asignada a ${team?.find((m) => m.id === who)?.name ?? "la persona"}`);
    onDone();
    onClose();
  }
  const style = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  return (
    <Sheet title={`Asignar ${productIds.length} producto${productIds.length === 1 ? "" : "s"}`} icon={<ClipboardList size={20} />} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-xs font-bold">¿A quién?</p>
        {!team ? <p className="text-xs" style={{ color: "var(--t-muted)" }}><Loader2 size={12} className="mr-1 inline animate-spin" /> Cargando equipo…</p> : (
          <div className="flex flex-wrap gap-1.5">
            {team.map((m) => (
              <button key={m.id} type="button" onClick={() => setWho(m.id)} className="rounded-full border px-3 py-1.5 text-xs font-bold"
                style={who === m.id ? { borderColor: "var(--t-accent)", background: "var(--t-accent)", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
                {m.me ? `${m.name} (yo)` : m.name}
              </button>
            ))}
            {team.length === 0 ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>No hay personas con permiso de Productos.</p> : null}
          </div>
        )}
        <label className="block"><span className="text-xs font-bold">Qué hay que hacer</span>
          <input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={style} /></label>
        <label className="block"><span className="text-xs font-bold">Nota (opcional)</span>
          <textarea value={note} maxLength={600} rows={2} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" style={style} placeholder="Ej: fotos con fondo blanco, para el viernes" /></label>
        <button type="button" onClick={() => void create()} disabled={busy || !who || !title.trim()} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,var(--t-accent),#ec4899)" }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />} Asignar tarea
        </button>
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Le llega a su campana (y al celular a la hora del aviso diario).</p>
      </div>
    </Sheet>
  );
}
