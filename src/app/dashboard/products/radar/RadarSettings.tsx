"use client";

import { useState } from "react";
import { Loader2, Settings } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Sheet } from "./RadarWidgets";

export type RadarSettingsValue = { daily_target: number; push_hour: number | null; health_goal: number };
export const DEFAULT_SETTINGS: RadarSettingsValue = { daily_target: 5, push_hour: 9, health_goal: 85 };

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "a. m." : "p. m."}`;

export function RadarSettings({ storeId, value, onClose, onSaved }: { storeId: string; value: RadarSettingsValue; onClose: () => void; onSaved: (v: RadarSettingsValue) => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("product_radar_settings_save", { p_store: storeId, p_daily_target: v.daily_target, p_push_hour: v.push_hour, p_health_goal: v.health_goal });
    setBusy(false);
    const d = data as { ok?: boolean; message?: string; settings?: RadarSettingsValue } | null;
    if (error || !d?.ok) {
      void Swal.fire({ icon: "error", title: "No se guardó", text: error?.message ?? d?.message, background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    onSaved(d.settings ?? v);
    onClose();
  }
  const field = "w-full rounded-xl border px-3 py-2.5 text-sm";
  const style = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  return (
    <Sheet title="Ajustes del Radar" icon={<Settings size={20} />} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="font-bold">🗓️ Productos para publicar al día</span>
          <input type="number" min={1} max={100} value={v.daily_target} onChange={(e) => setV({ ...v, daily_target: Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))) })} className={`${field} mt-1`} style={style} />
          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>El «Plan de hoy» te propone esta cantidad (lo atrasado primero).</span>
        </label>
        <label className="block">
          <span className="font-bold">📲 Aviso al celular</span>
          <select value={v.push_hour === null ? "" : String(v.push_hour)} onChange={(e) => setV({ ...v, push_hour: e.target.value === "" ? null : Number(e.target.value) })} className={`${field} mt-1`} style={style}>
            <option value="">No avisar al celular</option>
            {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>Todos los días a las {hourLabel(h)}</option>)}
          </select>
          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Le llega a quienes trabajan productos (si tienen activadas las notificaciones): cuántos toca publicar y sus tareas.</span>
        </label>
        <label className="block">
          <span className="font-bold">🎯 Meta de salud del catálogo</span>
          <input type="range" min={50} max={100} step={5} value={v.health_goal} onChange={(e) => setV({ ...v, health_goal: Number(e.target.value) })} className="mt-2 w-full" />
          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Llegar a <b style={{ color: "var(--t-text)" }}>{v.health_goal}</b> de 100 en promedio.</span>
        </label>
        <button type="button" onClick={() => void save()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#10b981,#0ea5e9)" }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} Guardar
        </button>
      </div>
    </Sheet>
  );
}
