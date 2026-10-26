"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { GraduationCap } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dayMonth, loadDrillStatus, monthName, type DrillStatus } from "@/lib/pos/drill";

/**
 * Inicio: simulacro mensual «vender sin internet».
 * Cajero: si ya lo hizo este mes o el botón para hacerlo. Administrador: quién lo hizo y la configuración.
 */
export function DrillCard({ storeId }: { storeId: string }) {
  const [st, setSt] = useState<DrillStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setSt(await loadDrillStatus(storeId)), [storeId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!st || (!st.must && !st.manager) || (!st.enabled && !st.manager)) return null;
  const team = st.team ?? [];
  const done = team.filter((t) => t.completed_at).length;
  const month = monthName(st.period);

  async function settings() {
    if (!st) return;
    const res = await Swal.fire({
      title: "Simulacro mensual",
      html: `<div style="text-align:left;display:grid;gap:10px;font-size:13px">
        <label><input id="dr-on" type="checkbox" ${st.enabled ? "checked" : ""}/> Pedir el simulacro cada mes a quienes usan el POS</label>
        <label>Día límite del mes<select id="dr-day" class="swal2-select" style="width:100%;margin:6px 0 0">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${st.due_day === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>
        <label><input id="dr-fiscal" type="checkbox" ${st.include_fiscal ? "checked" : ""}/> Incluir la factura de contingencia (en puntos que facturan electrónicamente)</label>
      </div>`,
      showCancelButton: true,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#8b5cf6",
      preConfirm: () => ({
        on: (document.getElementById("dr-on") as HTMLInputElement).checked,
        day: Number((document.getElementById("dr-day") as HTMLSelectElement).value),
        fiscal: (document.getElementById("dr-fiscal") as HTMLInputElement).checked,
      }),
    });
    if (!res.isConfirmed) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_drill_settings_save", { p_store: storeId, p_enabled: res.value.on, p_due_day: res.value.day, p_include_fiscal: res.value.fiscal });
    setBusy(false);
    const r = data as { ok?: boolean; message?: string } | null;
    if (error || !r?.ok) void Swal.fire({ icon: "error", title: "No se pudo guardar", text: error?.message ?? r?.message, background: "var(--t-bg-base)", color: "var(--t-text)" });
    void load();
  }

  return (
    <section id="simulacro" className="rounded-[28px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: "color-mix(in oklab, #8b5cf6 16%, transparent)", color: "#8b5cf6" }}><GraduationCap size={20} /></span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm">Simulacro de {month}: vender sin internet</b>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>
            {!st.enabled ? "Apagado." : st.manager && team.length ? `${done} de ${team.length} lo hicieron · día límite ${dayMonth(st.due_date)}` : st.mine?.completed_at ? `✅ Lo hiciste el ${dayMonth(st.mine.completed_at)}` : `Pendiente · hazlo antes del ${dayMonth(st.due_date)} (2 minutos)`}
          </span>
        </span>
        {st.must && st.enabled && !st.mine?.completed_at ? (
          <Link href="/dashboard/pos?simulacro=1" className="rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "#8b5cf6" }}>Hacerlo ahora</Link>
        ) : null}
        {st.manager ? (
          <button type="button" disabled={busy} onClick={() => void settings()} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Configurar</button>
        ) : null}
      </div>
      {st.manager && st.enabled && team.length ? (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {team.map((t) => (
            <li key={t.user_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
              <span>{t.completed_at ? "✅" : st.overdue ? "🔴" : "⏳"}</span>
              <span className="min-w-0 flex-1 truncate"><b>{t.name}</b>{t.point_name ? ` · ${t.point_name}` : ""}</span>
              <span style={{ color: "var(--t-muted)" }}>{t.completed_at ? dayMonth(t.completed_at) : t.last_completed ? `último ${dayMonth(t.last_completed)}` : "nunca"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
